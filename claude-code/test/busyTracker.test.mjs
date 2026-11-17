import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnepmHttpError } from "../src/services/onepmClient.mjs";
import { createBusyTracker } from "../src/services/busyTracker.mjs";

// Timers the test runs by hand.
const manualTimers = () => {
  let next = 1;
  const intervals = new Map();
  return {
    setInterval: (callback) => {
      const id = next++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
    tick: async () => {
      for (const callback of [...intervals.values()]) callback();
      await new Promise((resolve) => setImmediate(resolve));
    },
    count: () => intervals.size,
  };
};

const recordingClient = (fail) => {
  const calls = [];
  return {
    calls,
    setBusy: async (taskId, busy) => {
      calls.push([taskId, busy]);
      if (fail) throw fail;
      return { busy };
    },
  };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("createBusyTracker", () => {
  it("marks a task busy, refreshes it, and clears it on stop", async () => {
    const client = recordingClient();
    const timers = manualTimers();
    let now = 0;
    const busy = createBusyTracker({
      client,
      log: () => {},
      timers,
      now: () => now,
    });

    busy.start("t1");
    await settle();
    now = 15_000;
    await timers.tick();
    busy.stop("t1");
    await settle();

    assert.deepEqual(client.calls, [
      ["t1", true],
      ["t1", true],
      ["t1", false],
    ]);
    assert.equal(timers.count(), 0);
  });

  it("starting again on a busy task keeps one refresh", async () => {
    const client = recordingClient();
    const timers = manualTimers();
    const busy = createBusyTracker({ client, log: () => {}, timers });

    busy.start("t1");
    busy.start("t1");
    await settle();

    assert.equal(timers.count(), 1);
  });

  it("gives up refreshing after the longest a turn may take", async () => {
    const client = recordingClient();
    const timers = manualTimers();
    let now = 0;
    const busy = createBusyTracker({
      client,
      log: () => {},
      timers,
      now: () => now,
      maxMs: 60_000,
    });

    busy.start("t1");
    await settle();
    now = 60_000;
    await timers.tick();

    assert.deepEqual(client.calls.at(-1), ["t1", false]);
    assert.equal(timers.count(), 0);
  });

  it("keeps refreshing longer work until its own cap", async () => {
    const client = recordingClient();
    const timers = manualTimers();
    let now = 0;
    const busy = createBusyTracker({
      client,
      log: () => {},
      timers,
      now: () => now,
      maxMs: 60_000,
    });

    busy.start("t1", 600_000);
    await settle();
    now = 300_000;
    await timers.tick();
    assert.deepEqual(client.calls.at(-1), ["t1", true]);

    now = 600_000;
    await timers.tick();
    assert.deepEqual(client.calls.at(-1), ["t1", false]);
    assert.equal(timers.count(), 0);
  });

  it("goes quiet on a server without the busy route", async () => {
    const client = recordingClient(
      new OnepmHttpError("POST", "/project-agent/busy", 404),
    );
    const timers = manualTimers();
    const logged = [];
    const busy = createBusyTracker({
      client,
      log: (line) => logged.push(line),
      timers,
    });

    busy.start("t1");
    await settle();
    busy.start("t2");
    busy.stop("t1");
    await settle();

    assert.deepEqual(client.calls, [["t1", true]]);
    assert.equal(timers.count(), 0);
    assert.equal(logged.length, 1);
  });

  it("ignores a rate limit without logging", async () => {
    const client = recordingClient(
      new OnepmHttpError("POST", "/project-agent/busy", 429),
    );
    const logged = [];
    const busy = createBusyTracker({
      client,
      log: (line) => logged.push(line),
      timers: manualTimers(),
    });

    busy.start("t1");
    await settle();

    assert.deepEqual(logged, []);
  });

  it("stops every refresh on shutdown", async () => {
    const client = recordingClient();
    const timers = manualTimers();
    const busy = createBusyTracker({ client, log: () => {}, timers });

    busy.start("t1");
    busy.start("t2");
    busy.stopAll();
    await settle();

    assert.equal(timers.count(), 0);
    assert.deepEqual(client.calls.slice(-2), [
      ["t1", false],
      ["t2", false],
    ]);
  });
});
