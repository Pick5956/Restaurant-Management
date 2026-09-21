import { describe, expect, it } from "vitest";

import { createSerialQueue } from "../serialQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createSerialQueue", () => {
  it("keeps every task and runs them in order, one at a time", async () => {
    const enqueue = createSerialQueue();
    const log: string[] = [];
    const first = deferred();

    const a = enqueue(async () => {
      log.push("a start");
      await first.promise;
      log.push("a end");
    });
    const b = enqueue(async () => {
      log.push("b");
    });

    await Promise.resolve();
    expect(log).toEqual(["a start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(log).toEqual(["a start", "a end", "b"]);
  });

  it("runs the next task after one that failed", async () => {
    const enqueue = createSerialQueue();
    const failed = enqueue(async () => {
      throw new Error("save failed");
    });
    const next = enqueue(async () => "saved");

    await expect(failed).rejects.toThrow("save failed");
    await expect(next).resolves.toBe("saved");
  });
});
