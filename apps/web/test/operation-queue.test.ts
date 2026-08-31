import { describe, expect, it } from "vitest";

import { OperationQueue } from "@/lib/media/operation-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((value) => {
    resolve = value;
  });
  return { promise, resolve };
}

describe("negotiation queue", () => {
  it("never runs two negotiations at the same time", async () => {
    const queue = new OperationQueue();
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;

    const operation = (name: string, delay: number) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      log.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      log.push(`end:${name}`);
      active -= 1;
      return name;
    };

    const results = await Promise.all([
      queue.run(operation("publish", 20)),
      queue.run(operation("subscribe-a", 5)),
      queue.run(operation("subscribe-b", 1)),
    ]);

    expect(maxActive).toBe(1);
    expect(results).toEqual(["publish", "subscribe-a", "subscribe-b"]);
    expect(log).toEqual([
      "start:publish",
      "end:publish",
      "start:subscribe-a",
      "end:subscribe-a",
      "start:subscribe-b",
      "end:subscribe-b",
    ]);
  });

  it("keeps draining after a failed operation", async () => {
    const queue = new OperationQueue();
    const failure = queue.run(async () => {
      throw new Error("negotiation failed");
    });

    await expect(failure).rejects.toThrow("negotiation failed");
    await expect(queue.run(async () => "ok")).resolves.toBe("ok");
  });

  it("preserves submission order under back pressure", async () => {
    const queue = new OperationQueue();
    const gate = deferred();
    const order: number[] = [];

    const first = queue.run(async () => {
      await gate.promise;
      order.push(1);
    });
    const second = queue.run(async () => {
      order.push(2);
    });
    const third = queue.run(async () => {
      order.push(3);
    });

    expect(order).toEqual([]);
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });
});
