/**
 * Runs tasks one after another, in the order they were queued. Unlike
 * `createSingleFlight`, nothing is dropped: two settings changed in quick
 * succession are both saved, the second after the first has answered, so it
 * builds on what the first one saved. A task that throws does not stop the
 * ones behind it.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
