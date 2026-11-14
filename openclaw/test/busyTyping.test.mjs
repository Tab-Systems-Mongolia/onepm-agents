import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBusyMarker } from "../src/services/busyTyping.mjs";
import {
  OnepmHttpError,
  createOnepmClient,
} from "../src/services/onepmClient.mjs";

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

describe("createBusyMarker", () => {
  it("gives OpenClaw typing callbacks that mark the task busy and clear it", async () => {
    const client = recordingClient();
    const typing = createBusyMarker({ client, log: () => {} }).typingFor("t1");

    await typing.start();
    await typing.start();
    await typing.stop();

    assert.deepEqual(client.calls, [
      ["t1", true],
      ["t1", true],
      ["t1", false],
    ]);
    assert.equal(typing.keepaliveIntervalMs, 15_000);
    assert.equal(typing.maxDurationMs, 600_000);
  });

  it("asks an older OnePM without the busy route only once", async () => {
    const client = recordingClient(
      new OnepmHttpError("POST", "/project-agent/busy", 404),
    );
    const logged = [];
    const marker = createBusyMarker({
      client,
      log: (line) => logged.push(line),
    });

    await marker.typingFor("t1").start();
    await marker.typingFor("t2").start();
    await marker.typingFor("t1").stop();

    assert.deepEqual(client.calls, [["t1", true]]);
    assert.equal(logged.length, 1);
  });

  it("ignores a rate limit, and reports other failures to OpenClaw", async () => {
    const limited = createBusyMarker({
      client: recordingClient(
        new OnepmHttpError("POST", "/project-agent/busy", 429),
      ),
      log: () => {},
    });
    await limited.typingFor("t1").start();

    const failing = createBusyMarker({
      client: recordingClient(new Error("offline")),
      log: () => {},
    });
    await assert.rejects(failing.typingFor("t1").start(), /offline/);
  });
});

describe("the busy request", () => {
  it("posts the task and whether the agent is busy", async () => {
    const requests = [];
    const client = createOnepmClient(
      "https://pm.test",
      "opm_key",
      async (url, init) => {
        requests.push({ url, init });
        return { ok: true, json: async () => ({}) };
      },
    );

    await client.setBusy("t1", false);

    assert.equal(requests[0].url, "https://pm.test/api/project-agent/busy");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      taskId: "t1",
      busy: false,
    });
  });
});
