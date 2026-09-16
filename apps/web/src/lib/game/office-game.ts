import {
  DEFAULT_AVATAR_APPEARANCE,
  INTERPOLATION_DELAY_MS,
  MOVE_SEND_HZ,
  OFFICE_MAP,
  PLAYER_SPEED_PX_PER_S,
  TILE_SIZE,
  mapPixelSize,
  nearestDesk,
  normalizeAvatarAppearance,
  zoneAtPixel,
  type AvatarAppearance,
  type Direction,
  type PlayerState,
  type PublishedTrack,
  type ServerEvent,
} from "@virtual-office/shared";
import type PhaserNamespace from "phaser";

import {
  WALK_ARRIVE_DISTANCE_PX,
  cameraFitsWholeMap,
  clampWalkTarget,
  minZoomToFitMap,
  nextCameraZoom,
  walkVelocityToward,
} from "./camera-controls";
import { createAvatarSprite, syncAvatarSprite } from "./avatar-sprite";
import { isTypingTarget } from "./keyboard-guard";
import { pushSample, sampleAt, type TimedPosition } from "./interpolation";
import { startPresenceConnection } from "./presence-connection";

export interface OfficeGameOptions {
  container: HTMLElement;
  officeSlug: string;
  onStatus: (status: string) => void;
  onPresenceConnected?: (connected: boolean) => void;
  onTracks?: (tracks: PublishedTrack[]) => void;
  onPlayers?: (
    players: {
      userId: string;
      displayName: string;
      broadcastSpeakerSource?: "zone" | "manual" | null;
      inBroadcastZone?: boolean;
      broadcastCapacityBlocked?: boolean;
      appearance?: AvatarAppearance;
    }[],
  ) => void;
  onBroadcastState?: (state: {
    inBroadcastZone: boolean;
    broadcastCapacityBlocked: boolean;
    broadcastSpeakerSource: "zone" | "manual" | null;
  }) => void;
  onPositions?: (
    positions: Map<string, { x: number; y: number; zoneId: string | null }>,
    selfUserId: string | null,
  ) => void;
  onDeskState?: (state: {
    currentDeskId: string | null;
    nearestDeskId: string | null;
  }) => void;
  onSpatialChatMessage?: (message: {
    messageId: string;
    channelId: string;
    channelKind: "GENERAL" | "OFFICE" | "DIRECT" | "ZONE";
    authorUserId: string;
    displayName: string;
    body: string;
    createdAt: string;
  }) => void;
  initialAppearance?: AvatarAppearance;
}

export interface OfficeGameHandle {
  destroy: () => void;
  useNearestDesk: () => void;
  setBroadcastSpeaker: (targetUserId: string) => void;
  removeBroadcastSpeaker: (targetUserId: string) => void;
  zoomBy: (deltaY: number) => void;
  applyAppearance: (appearance: AvatarAppearance) => void;
  evictPublishedTrack: (ref: { sessionId: string; trackName: string }) => void;
}

interface RemotePlayer {
  state: PlayerState;
  buffer: TimedPosition[];
  body: PhaserNamespace.Physics.Arcade.Sprite;
  label: PhaserNamespace.GameObjects.Text;
}

const ZONE_COLORS: Record<string, number> = {
  "zone-meeting": 0x2f4368,
  "zone-focus": 0x463063,
  "zone-desks": 0x2c3a4d,
  "zone-rest": 0x2f4d3a,
  "zone-office": 0x3d4a66,
  "zone-commons": 0x2a4a3a,
  "zone-cowork": 0x3a4a5a,
  "zone-campfire-plaza": 0x3a2a18,
  "zone-campfire": 0xc45a20,
  "zone-future-flow": 0x304a5a,
};

export async function createOfficeGame(
  options: OfficeGameOptions,
): Promise<OfficeGameHandle> {
  const Phaser = (await import("phaser")).default;
  const { width: mapWidth, height: mapHeight } = mapPixelSize(OFFICE_MAP);

  let socket: WebSocket | null = null;
  let selfUserId: string | null = null;
  let seq = 0;
  let stopPresence: (() => void) | null = null;
  const remotes = new Map<string, RemotePlayer>();

  let sceneRef: PhaserNamespace.Scene | null = null;
  let selfBody: PhaserNamespace.Physics.Arcade.Sprite | null = null;
  let selfLabel: PhaserNamespace.GameObjects.Text | null = null;
  let selfPhysics: PhaserNamespace.Physics.Arcade.Body | null = null;
  let cursors: PhaserNamespace.Types.Input.Keyboard.CursorKeys | null = null;
  let wasd: Record<
    "W" | "A" | "S" | "D",
    PhaserNamespace.Input.Keyboard.Key
  > | null = null;
  let lastSent = { x: 0, y: 0, moving: false };
  let lastPositionEmit = 0;
  let lastPointerDownAt = 0;
  let walkTarget: { x: number; y: number } | null = null;
  let direction: Direction = "down";
  let selfCurrentDeskId: string | null = null;
  let selfBroadcastSource: "zone" | "manual" | null = null;
  let selfInBroadcastZone = false;
  let selfBroadcastCapacityBlocked = false;
  let selfAppearance = normalizeAvatarAppearance(
    options.initialAppearance ?? DEFAULT_AVATAR_APPEARANCE,
  );
  const tracks = new Map<string, PublishedTrack>();

  function trackKeyOf(ref: { sessionId: string; trackName: string }): string {
    return `${ref.sessionId}:${ref.trackName}`;
  }

  function publishTracks(): void {
    options.onTracks?.([...tracks.values()]);
    refreshLabels();
  }

  function publishBroadcastState(): void {
    options.onBroadcastState?.({
      inBroadcastZone: selfInBroadcastZone,
      broadcastCapacityBlocked: selfBroadcastCapacityBlocked,
      broadcastSpeakerSource: selfBroadcastSource,
    });
  }

  function applySelfBroadcastState(state: PlayerState): void {
    selfInBroadcastZone = state.inBroadcastZone ?? false;
    selfBroadcastCapacityBlocked = state.broadcastCapacityBlocked ?? false;
    selfBroadcastSource = state.broadcastSpeakerSource ?? null;
    publishBroadcastState();
  }

  function broadcastIndicatorFor(state?: PlayerState): string {
    if (!state) return "";
    if (state.broadcastSpeakerSource === "manual") return " 📡";
    if (state.broadcastSpeakerSource === "zone") return " 🔥";
    if (state.inBroadcastZone) return " 🔥";
    return "";
  }

  function publishPlayers(): void {
    options.onPlayers?.(
      [...remotes.values()].map((remote) => ({
        userId: remote.state.userId,
        displayName: remote.state.displayName,
        broadcastSpeakerSource: remote.state.broadcastSpeakerSource ?? null,
        inBroadcastZone: remote.state.inBroadcastZone ?? false,
        broadcastCapacityBlocked:
          remote.state.broadcastCapacityBlocked ?? false,
        ...(remote.state.appearance
          ? { appearance: remote.state.appearance }
          : {}),
      })),
    );
  }

  function deskIndicatorFor(userId: string, state: PlayerState): string {
    if (state.currentDeskId) return " 🪑";
    return "";
  }

  function indicatorsFor(userId: string, state?: PlayerState): string {
    const owned = [...tracks.values()].filter(
      (track) => track.ownerUserId === userId,
    );
    const audio = owned.some((track) => track.kind === "audio") ? " 🎤" : "";
    const video = owned.some((track) => track.kind === "video") ? " 🎥" : "";
    const desk =
      state && state.currentDeskId ? deskIndicatorFor(userId, state) : "";
    const broadcast = broadcastIndicatorFor(state);
    return `${audio}${video}${desk}${broadcast}`;
  }

  function refreshLabels(): void {
    for (const remote of remotes.values()) {
      remote.label.setText(
        `${remote.state.displayName}${indicatorsFor(remote.state.userId, remote.state)}`,
      );
    }
    if (selfLabel) {
      const desk = selfCurrentDeskId ? " 🪑" : "";
      const broadcast =
        selfBroadcastSource === "manual"
          ? " 📡"
          : selfBroadcastSource === "zone" || selfInBroadcastZone
            ? " 🔥"
            : "";
      selfLabel.setText(`Tú${desk}${broadcast}`);
    }
  }

  function publishDeskState(x: number, y: number): void {
    options.onDeskState?.({
      currentDeskId: selfCurrentDeskId,
      nearestDeskId: nearestDesk(OFFICE_MAP, x, y)?.deskId ?? null,
    });
  }

  function appearanceOf(state: PlayerState): AvatarAppearance {
    return normalizeAvatarAppearance(
      state.appearance ?? DEFAULT_AVATAR_APPEARANCE,
    );
  }

  function addRemote(scene: PhaserNamespace.Scene, state: PlayerState): void {
    if (state.userId === selfUserId) return;
    const existing = remotes.get(state.userId);
    if (existing) {
      existing.state = {
        ...state,
        appearance: state.appearance ?? existing.state.appearance,
      };
      return;
    }
    const appearance = appearanceOf(state);
    const body = createAvatarSprite(
      scene,
      state.x,
      state.y,
      appearance,
      state.direction,
    );
    const label = scene.add
      .text(state.x, state.y - 38, state.displayName, {
        fontSize: "12px",
        color: "#e8e8f0",
      })
      .setOrigin(0.5, 1)
      .setDepth(10_000);
    remotes.set(state.userId, {
      state: { ...state, appearance },
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
            selfCurrentDeskId = player.currentDeskId ?? null;
            if (player.appearance) {
              selfAppearance = normalizeAvatarAppearance(player.appearance);
            }
            applySelfBroadcastState(player);
          } else {
            addRemote(scene, player);
          }
        }
        tracks.clear();
        for (const track of event.publishedTracks) {
          tracks.set(trackKeyOf(track), track);
        }
        options.onStatus("Conectado");
        options.onPresenceConnected?.(true);
        publishTracks();
        publishPlayers();
        refreshLabels();
        if (selfBody) publishDeskState(selfBody.x, selfBody.y);
        break;
      }
      case "media.track.available":
        tracks.set(trackKeyOf(event.track), event.track);
        publishTracks();
        break;
      case "media.track.revoked":
        tracks.delete(trackKeyOf(event));
        publishTracks();
        break;
      case "player.joined":
        addRemote(scene, event.player);
        publishPlayers();
        refreshLabels();
        break;
      case "player.updated": {
        if (event.player.userId === selfUserId) {
          // Keep local physics authoritative; server echoes would rubber-band
          // the sprite against the camera follow.
          selfCurrentDeskId = event.player.currentDeskId ?? null;
          applySelfBroadcastState(event.player);
          refreshLabels();
          if (selfBody) publishDeskState(selfBody.x, selfBody.y);
          break;
        }
        addRemote(scene, event.player);
        const remote = remotes.get(event.player.userId);
        if (remote) {
          pushSample(remote.buffer, {
            t: performance.now(),
            x: event.player.x,
            y: event.player.y,
          });
        }
        publishPlayers();
        refreshLabels();
        break;
      }
      case "player.left":
        removeRemote(event.userId);
        for (const [key, track] of tracks) {
          if (track.ownerUserId === event.userId) tracks.delete(key);
        }
        publishTracks();
        publishPlayers();
        break;
      case "player.avatar.updated": {
        if (event.userId === selfUserId) {
          selfAppearance = normalizeAvatarAppearance(event.appearance);
          break;
        }
        const remote = remotes.get(event.userId);
        if (remote) {
          remote.state = {
            ...remote.state,
            appearance: event.appearance,
          };
        }
        publishPlayers();
        break;
      }
      case "player.corrected":
        selfBody?.setPosition(event.x, event.y);
        selfPhysics?.reset(event.x, event.y);
        break;
      case "pong":
      case "error":
        break;
      case "chat.message.created":
        options.onSpatialChatMessage?.({
          messageId: event.messageId,
          channelId: event.channelId,
          channelKind: event.channelKind,
          authorUserId: event.authorUserId,
          displayName: event.displayName,
          body: event.body,
          createdAt: event.createdAt,
        });
        break;
    }
  }

  function setBroadcastSpeaker(targetUserId: string): void {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "broadcast.setSpeaker",
        targetUserId,
        clientTime: Date.now(),
      }),
    );
  }

  function removeBroadcastSpeaker(targetUserId: string): void {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "broadcast.removeSpeaker",
        targetUserId,
        clientTime: Date.now(),
      }),
    );
  }

  function zoomBy(deltaY: number): void {
    const camera = sceneRef?.cameras.main;
    if (!camera) return;
    const fit = minZoomToFitMap(
      camera.width,
      camera.height,
      mapWidth,
      mapHeight,
    );
    const next = nextCameraZoom(camera.zoom, deltaY, fit);
    camera.setZoom(next);
    if (
      cameraFitsWholeMap(camera.width, camera.height, next, mapWidth, mapHeight)
    ) {
      camera.stopFollow();
      camera.useBounds = false;
      camera.centerOn(mapWidth / 2, mapHeight / 2);
      return;
    }
    camera.useBounds = true;
    camera.setBounds(0, 0, mapWidth, mapHeight);
    if (selfBody) camera.startFollow(selfBody, false, 1, 1);
  }

  function applyWalkTarget(worldX: number, worldY: number): void {
    walkTarget = clampWalkTarget(worldX, worldY, mapWidth, mapHeight);
  }

  function useNearestDesk(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || !selfBody) return;
    const desk = nearestDesk(OFFICE_MAP, selfBody.x, selfBody.y);
    if (!desk) return;
    socket.send(
      JSON.stringify({
        type: "desk.use",
        deskId: desk.deskId,
        clientTime: Date.now(),
      }),
    );
  }

  function sendAppearance(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "player.avatar.set",
        appearance: selfAppearance,
        clientTime: Date.now(),
      }),
    );
  }

  function applyAppearance(appearance: AvatarAppearance): void {
    selfAppearance = normalizeAvatarAppearance(appearance);
    sendAppearance();
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

      for (const desk of OFFICE_MAP.desks ?? []) {
        graphics.fillStyle(0x4a5568, 0.35);
        graphics.fillRect(
          desk.tileX * TILE_SIZE + 4,
          desk.tileY * TILE_SIZE + 4,
          TILE_SIZE - 8,
          TILE_SIZE - 8,
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

      const body = createAvatarSprite(
        this,
        mapWidth / 2,
        mapHeight / 2,
        selfAppearance,
        direction,
      );
      selfBody = body;
      selfPhysics = body.body as PhaserNamespace.Physics.Arcade.Body;
      selfPhysics.setCollideWorldBounds(true);
      this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
      this.physics.add.collider(body, walls);
      selfLabel = this.add
        .text(body.x, body.y - 38, "Tú", {
          fontSize: "12px",
          color: "#c7f2a4",
        })
        .setOrigin(0.5, 1)
        .setDepth(10_000);

      this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
      this.cameras.main.startFollow(body, false, 1, 1);
      this.cameras.main.setBackgroundColor(0x11131c);

      cursors = this.input.keyboard?.createCursorKeys() ?? null;
      wasd =
        (this.input.keyboard?.addKeys("W,A,S,D", false) as Record<
          "W" | "A" | "S" | "D",
          PhaserNamespace.Input.Keyboard.Key
        >) ?? null;
      this.input.keyboard?.disableGlobalCapture();

      this.input.on("pointerdown", (pointer: PhaserNamespace.Input.Pointer) => {
        if (!pointer.leftButtonDown()) return;
        const now = this.time.now;
        if (now - lastPointerDownAt < 350) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          applyWalkTarget(world.x, world.y);
        }
        lastPointerDownAt = now;
      });

      this.time.addEvent({
        delay: 1_000 / MOVE_SEND_HZ,
        loop: true,
        callback: () => sendMove(),
      });

      stopPresence = startPresenceConnection({
        officeSlug: options.officeSlug,
        onSocket: (value) => {
          socket = value;
        },
        onOpen: sendAppearance,
        onEvent: handleServerEvent,
        onStatus: options.onStatus,
        onDisconnect: () => {
          selfUserId = null;
          selfCurrentDeskId = null;
          selfBroadcastSource = null;
          selfInBroadcastZone = false;
          selfBroadcastCapacityBlocked = false;
          tracks.clear();
          clearRemotes();
          publishTracks();
          publishPlayers();
          publishBroadcastState();
          options.onPositions?.(new Map(), null);
          options.onPresenceConnected?.(false);
        },
      });
    }

    override update(): void {
      if (!selfPhysics || !selfBody) return;
      const typing = isTypingTarget(document.activeElement);
      if (this.input.keyboard) this.input.keyboard.enabled = !typing;
      const left = !typing && Boolean(cursors?.left.isDown || wasd?.A.isDown);
      const right = !typing && Boolean(cursors?.right.isDown || wasd?.D.isDown);
      const up = !typing && Boolean(cursors?.up.isDown || wasd?.W.isDown);
      const down = !typing && Boolean(cursors?.down.isDown || wasd?.S.isDown);

      let vx = 0;
      let vy = 0;
      if (left) vx -= 1;
      if (right) vx += 1;
      if (up) vy -= 1;
      if (down) vy += 1;
      const length = Math.hypot(vx, vy);
      if (length > 0) {
        walkTarget = null;
        vx = (vx / length) * PLAYER_SPEED_PX_PER_S;
        vy = (vy / length) * PLAYER_SPEED_PX_PER_S;
        if (Math.abs(vx) >= Math.abs(vy)) {
          direction = vx > 0 ? "right" : "left";
        } else {
          direction = vy > 0 ? "down" : "up";
        }
      } else if (walkTarget) {
        const walk = walkVelocityToward(
          selfBody.x,
          selfBody.y,
          walkTarget.x,
          walkTarget.y,
          PLAYER_SPEED_PX_PER_S,
          WALK_ARRIVE_DISTANCE_PX,
        );
        if (walk.arrived) {
          walkTarget = null;
        } else {
          vx = walk.vx;
          vy = walk.vy;
          if (Math.abs(vx) >= Math.abs(vy)) {
            direction = vx > 0 ? "right" : "left";
          } else {
            direction = vy > 0 ? "down" : "up";
          }
        }
      }
      selfPhysics.setVelocity(vx, vy);
      if (selfBody && sceneRef) {
        syncAvatarSprite(sceneRef, selfBody, {
          appearance: selfAppearance,
          direction,
          moving: vx !== 0 || vy !== 0,
          currentDeskId: selfCurrentDeskId,
          nowMs: this.time.now,
        });
      }
      selfLabel?.setPosition(selfBody.x, selfBody.y - 38);

      const renderTime = performance.now() - INTERPOLATION_DELAY_MS;
      for (const remote of remotes.values()) {
        const sampled = sampleAt(remote.buffer, renderTime);
        if (sampled) {
          remote.body.setPosition(sampled.x, sampled.y);
          remote.label.setPosition(sampled.x, sampled.y - 38);
        }
        if (sceneRef) {
          syncAvatarSprite(sceneRef, remote.body, {
            appearance: appearanceOf(remote.state),
            direction: remote.state.direction,
            moving: remote.state.moving,
            currentDeskId: remote.state.currentDeskId ?? null,
            nowMs: this.time.now,
          });
        }
      }

      const now = performance.now();
      if (now - lastPositionEmit >= 100) {
        lastPositionEmit = now;
        const positions = new Map<
          string,
          { x: number; y: number; zoneId: string | null }
        >();
        if (selfBody && selfUserId) {
          positions.set(selfUserId, {
            x: selfBody.x,
            y: selfBody.y,
            zoneId: zoneAtPixel(OFFICE_MAP, selfBody.x, selfBody.y),
          });
        }
        for (const [userId, remote] of remotes) {
          positions.set(userId, {
            x: remote.body.x,
            y: remote.body.y,
            zoneId: zoneAtPixel(OFFICE_MAP, remote.body.x, remote.body.y),
          });
        }
        options.onPositions?.(positions, selfUserId);
        if (selfBody) publishDeskState(selfBody.x, selfBody.y);
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.container,
    backgroundColor: "#11131c",
    pixelArt: true,
    antialias: false,
    physics: { default: "arcade" },
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: options.container.clientWidth || 960,
      height: options.container.clientHeight || 540,
    },
    scene: [OfficeScene],
  });

  const resizeObserver = new ResizeObserver(() => {
    const width = options.container.clientWidth;
    const height = options.container.clientHeight;
    if (width > 0 && height > 0) game.scale.resize(width, height);
  });
  resizeObserver.observe(options.container);

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomBy(event.deltaY);
  };
  options.container.addEventListener("wheel", onWheel, { passive: false });

  function evictPublishedTrack(ref: {
    sessionId: string;
    trackName: string;
  }): void {
    tracks.delete(trackKeyOf(ref));
    publishTracks();
  }

  return {
    destroy: () => {
      options.container.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
      stopPresence?.();
      clearRemotes();
      sceneRef = null;
      game.destroy(true);
    },
    useNearestDesk,
    setBroadcastSpeaker,
    removeBroadcastSpeaker,
    zoomBy,
    applyAppearance,
    evictPublishedTrack,
  };
}
