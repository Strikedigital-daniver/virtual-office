import {
  HEARTBEAT_INTERVAL_MS,
  INTERPOLATION_DELAY_MS,
  MOVE_SEND_HZ,
  OFFICE_MAP,
  PLAYER_SPEED_PX_PER_S,
  ServerEventSchema,
  TILE_SIZE,
  mapPixelSize,
  type Direction,
  type PlayerState,
  type ServerEvent,
} from "@virtual-office/shared";
import type PhaserNamespace from "phaser";

import { pushSample, sampleAt, type TimedPosition } from "./interpolation";

export interface OfficeGameOptions {
  container: HTMLElement;
  officeSlug: string;
  onStatus: (status: string) => void;
}

export interface OfficeGameHandle {
  destroy: () => void;
}

interface RemotePlayer {
  state: PlayerState;
  buffer: TimedPosition[];
  body: PhaserNamespace.GameObjects.Rectangle;
  label: PhaserNamespace.GameObjects.Text;
}

const ZONE_COLORS: Record<string, number> = {
  "zone-meeting": 0x2f4368,
  "zone-focus": 0x463063,
  "zone-desks": 0x2c3a4d,
  "zone-rest": 0x2f4d3a,
};

export async function createOfficeGame(
  options: OfficeGameOptions,
): Promise<OfficeGameHandle> {
  const Phaser = (await import("phaser")).default;
  const { width: mapWidth, height: mapHeight } = mapPixelSize(OFFICE_MAP);

  let socket: WebSocket | null = null;
  let destroyed = false;
  let selfUserId: string | null = null;
  let seq = 0;
  let reconnectDelay = 1_000;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const remotes = new Map<string, RemotePlayer>();

  let sceneRef: PhaserNamespace.Scene | null = null;
  let selfBody: PhaserNamespace.GameObjects.Rectangle | null = null;
  let selfLabel: PhaserNamespace.GameObjects.Text | null = null;
  let selfPhysics: PhaserNamespace.Physics.Arcade.Body | null = null;
  let cursors: PhaserNamespace.Types.Input.Keyboard.CursorKeys | null = null;
  let wasd: Record<
    "W" | "A" | "S" | "D",
    PhaserNamespace.Input.Keyboard.Key
  > | null = null;
  let lastSent = { x: 0, y: 0, moving: false };
  let direction: Direction = "down";

  function addRemote(scene: PhaserNamespace.Scene, state: PlayerState): void {
    if (state.userId === selfUserId) return;
    const existing = remotes.get(state.userId);
    if (existing) {
      existing.state = state;
      return;
    }
    const body = scene.add
      .rectangle(state.x, state.y, 22, 26, 0xf2a65a)
      .setDepth(5);
    const label = scene.add
      .text(state.x, state.y - 24, state.displayName, {
        fontSize: "12px",
        color: "#e8e8f0",
      })
      .setOrigin(0.5, 1)
      .setDepth(6);
    remotes.set(state.userId, {
      state,
      buffer: [{ t: performance.now(), x: state.x, y: state.y }],
      body,
      label,
    });
  }

  function removeRemote(userId: string): void {
    const remote = remotes.get(userId);
    if (!remote) return;
    remote.body.destroy();
    remote.label.destroy();
    remotes.delete(userId);
  }

  function clearRemotes(): void {
    for (const userId of [...remotes.keys()]) removeRemote(userId);
  }

  function handleServerEvent(event: ServerEvent): void {
    const scene = sceneRef;
    if (!scene) return;
    switch (event.type) {
      case "office.snapshot": {
        selfUserId = event.selfUserId;
        clearRemotes();
        for (const player of event.players) {
          if (player.userId === event.selfUserId) {
            selfBody?.setPosition(player.x, player.y);
            selfPhysics?.reset(player.x, player.y);
          } else {
            addRemote(scene, player);
          }
        }
        options.onStatus("Conectado");
        break;
      }
      case "player.joined":
        addRemote(scene, event.player);
        break;
      case "player.updated": {
        if (event.player.userId === selfUserId) break;
        addRemote(scene, event.player);
        const remote = remotes.get(event.player.userId);
        if (remote) {
          remote.state = event.player;
          pushSample(remote.buffer, {
            t: performance.now(),
            x: event.player.x,
            y: event.player.y,
          });
        }
        break;
      }
      case "player.left":
        removeRemote(event.userId);
        break;
      case "player.corrected":
        selfBody?.setPosition(event.x, event.y);
        selfPhysics?.reset(event.x, event.y);
        break;
      case "pong":
      case "error":
        break;
    }
  }

  async function connect(): Promise<void> {
    if (destroyed) return;
    options.onStatus("Conectando…");
    let ticket: { ticket: string; url: string };
    try {
      const response = await fetch("/api/realtime-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeSlug: options.officeSlug }),
      });
      if (!response.ok) throw new Error(`ticket ${response.status}`);
      ticket = (await response.json()) as { ticket: string; url: string };
    } catch {
      scheduleReconnect();
      return;
    }
    if (destroyed) return;

    const ws = new WebSocket(
      `${ticket.url}?ticket=${encodeURIComponent(ticket.ticket)}`,
    );
    socket = ws;
    ws.onopen = () => {
      reconnectDelay = 1_000;
    };
    ws.onmessage = (message) => {
      if (typeof message.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data) as unknown;
      } catch {
        return;
      }
      const result = ServerEventSchema.safeParse(parsed);
      if (result.success) handleServerEvent(result.data);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    if (destroyed) return;
    options.onStatus("Reconectando…");
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
    setTimeout(() => {
      if (!destroyed && !socket) void connect();
    }, delay);
  }

  function sendMove(force = false): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || !selfBody) return;
    const moving = Boolean(
      selfPhysics &&
      (selfPhysics.velocity.x !== 0 || selfPhysics.velocity.y !== 0),
    );
    const x = Math.round(selfBody.x);
    const y = Math.round(selfBody.y);
    if (
      !force &&
      x === lastSent.x &&
      y === lastSent.y &&
      moving === lastSent.moving
    ) {
      return;
    }
    seq += 1;
    lastSent = { x, y, moving };
    socket.send(
      JSON.stringify({
        type: "player.move",
        seq,
        x,
        y,
        direction,
        moving,
        clientTime: Date.now(),
      }),
    );
  }

  class OfficeScene extends Phaser.Scene {
    constructor() {
      super("office");
    }

    create(): void {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      sceneRef = this;
      const graphics = this.add.graphics();
      graphics.fillStyle(0x171923, 1);
      graphics.fillRect(0, 0, mapWidth, mapHeight);

      for (const zone of OFFICE_MAP.zones) {
        graphics.fillStyle(ZONE_COLORS[zone.zoneId] ?? 0x222633, 0.55);
        graphics.fillRect(
          zone.x * TILE_SIZE,
          zone.y * TILE_SIZE,
          zone.width * TILE_SIZE,
          zone.height * TILE_SIZE,
        );
      }

      const walls = this.physics.add.staticGroup();
      for (let tileY = 0; tileY < OFFICE_MAP.heightTiles; tileY += 1) {
        const row = OFFICE_MAP.rows[tileY] ?? "";
        let runStart = -1;
        for (let tileX = 0; tileX <= OFFICE_MAP.widthTiles; tileX += 1) {
          const kind = row[tileX] ?? ".";
          const blocked = kind !== ".";
          if (blocked) {
            graphics.fillStyle(kind === "D" ? 0x6b5133 : 0x3a4056, 1);
            graphics.fillRect(
              tileX * TILE_SIZE,
              tileY * TILE_SIZE,
              TILE_SIZE,
              TILE_SIZE,
            );
            if (runStart < 0) runStart = tileX;
          }
          if (!blocked && runStart >= 0) {
            const widthTiles = tileX - runStart;
            const rect = this.add.rectangle(
              runStart * TILE_SIZE + (widthTiles * TILE_SIZE) / 2,
              tileY * TILE_SIZE + TILE_SIZE / 2,
              widthTiles * TILE_SIZE,
              TILE_SIZE,
            );
            rect.setVisible(false);
            walls.add(rect);
            runStart = -1;
          }
        }
      }

      graphics.lineStyle(1, 0xffffff, 0.04);
      for (let x = 0; x <= mapWidth; x += TILE_SIZE) {
        graphics.lineBetween(x, 0, x, mapHeight);
      }
      for (let y = 0; y <= mapHeight; y += TILE_SIZE) {
        graphics.lineBetween(0, y, mapWidth, y);
      }

      const body = this.add.rectangle(
        mapWidth / 2,
        mapHeight / 2,
        22,
        26,
        0x9be564,
      );
      body.setDepth(5);
      this.physics.add.existing(body);
      selfBody = body;
      selfPhysics = body.body as PhaserNamespace.Physics.Arcade.Body;
      selfPhysics.setCollideWorldBounds(true);
      this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
      this.physics.add.collider(body, walls);
      selfLabel = this.add
        .text(body.x, body.y - 24, "Tú", {
          fontSize: "12px",
          color: "#c7f2a4",
        })
        .setOrigin(0.5, 1)
        .setDepth(6);

      this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
      this.cameras.main.startFollow(body, true, 0.15, 0.15);
      this.cameras.main.setBackgroundColor(0x11131c);

      cursors = this.input.keyboard?.createCursorKeys() ?? null;
      wasd =
        (this.input.keyboard?.addKeys("W,A,S,D") as Record<
          "W" | "A" | "S" | "D",
          PhaserNamespace.Input.Keyboard.Key
        >) ?? null;

      this.time.addEvent({
        delay: 1_000 / MOVE_SEND_HZ,
        loop: true,
        callback: () => sendMove(),
      });

      void connect();
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    }

    override update(): void {
      if (!selfPhysics || !selfBody) return;
      const left = Boolean(cursors?.left.isDown || wasd?.A.isDown);
      const right = Boolean(cursors?.right.isDown || wasd?.D.isDown);
      const up = Boolean(cursors?.up.isDown || wasd?.W.isDown);
      const down = Boolean(cursors?.down.isDown || wasd?.S.isDown);

      let vx = 0;
      let vy = 0;
      if (left) vx -= 1;
      if (right) vx += 1;
      if (up) vy -= 1;
      if (down) vy += 1;
      const length = Math.hypot(vx, vy);
      if (length > 0) {
        vx = (vx / length) * PLAYER_SPEED_PX_PER_S;
        vy = (vy / length) * PLAYER_SPEED_PX_PER_S;
        if (Math.abs(vx) >= Math.abs(vy)) {
          direction = vx > 0 ? "right" : "left";
        } else {
          direction = vy > 0 ? "down" : "up";
        }
      }
      selfPhysics.setVelocity(vx, vy);
      selfLabel?.setPosition(selfBody.x, selfBody.y - 24);

      const renderTime = performance.now() - INTERPOLATION_DELAY_MS;
      for (const remote of remotes.values()) {
        const sampled = sampleAt(remote.buffer, renderTime);
        if (sampled) {
          remote.body.setPosition(sampled.x, sampled.y);
          remote.label.setPosition(sampled.x, sampled.y - 24);
        }
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.container,
    backgroundColor: "#11131c",
    physics: { default: "arcade" },
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: options.container.clientWidth || 960,
      height: options.container.clientHeight || 540,
    },
    scene: [OfficeScene],
  });

  return {
    destroy: () => {
      destroyed = true;
      if (heartbeat) clearInterval(heartbeat);
      socket?.close(1000, "leaving");
      socket = null;
      clearRemotes();
      sceneRef = null;
      game.destroy(true);
    },
  };
}
