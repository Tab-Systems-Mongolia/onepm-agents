import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOnepmClient } from "../src/services/onepmClient.mjs";

const recordingFetch = () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => [] };
  };
  return { requests, fetchImpl };
};

describe("createOnepmClient project reads", () => {
  it("reads the project, its columns and its repositories with the agent key", async () => {
    const { requests, fetchImpl } = recordingFetch();
    const client = createOnepmClient("https://pm.test", "opm_key", fetchImpl);

    await client.project("p/1");
    await client.columns("p1");
    await client.repositories("p1");

    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        "https://pm.test/api/project/p%2F1",
        "https://pm.test/api/column/p1",
        "https://pm.test/api/github-repository/project/p1",
      ],
    );
    for (const { init } of requests) {
      assert.equal(init.headers["x-api-key"], "opm_key");
    }
  });

  it("passes an abort signal through", async () => {
    const { requests, fetchImpl } = recordingFetch();
    const client = createOnepmClient("https://pm.test", "opm_key", fetchImpl);
    const { signal } = new AbortController();

    await client.self({ signal });
    await client.columns("p1", { signal });

    assert.equal(requests[0].init.signal, signal);
    assert.equal(requests[1].init.signal, signal);
  });

  it("says whether the agent is busy on a task", async () => {
    const { requests, fetchImpl } = recordingFetch();
    const client = createOnepmClient("https://pm.test", "opm_key", fetchImpl);

    await client.setBusy("t1", true);

    assert.equal(requests[0].url, "https://pm.test/api/project-agent/busy");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      taskId: "t1",
      busy: true,
    });
  });
});
