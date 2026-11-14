import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { postReply } from "../src/services/postReply.mjs";

const KEY = "opm_agent_secretvalue123";

describe("postReply", () => {
  it("masks the agent key and other secrets before posting", async () => {
    const posted = [];
    const client = {
      postComment: async (taskId, content) => {
        posted.push({ taskId, content });
        return { id: `c${posted.length}` };
      },
    };
    const ids = await postReply({
      client,
      taskId: "t1",
      text: `key ${KEY} and ghp_${"a".repeat(36)}`,
      apiKey: KEY,
    });
    assert.deepEqual(ids, ["c1"]);
    assert.deepEqual(posted, [
      { taskId: "t1", content: "key [redacted] and [redacted]" },
    ]);
  });

  it("splits a reply longer than one comment", async () => {
    const posted = [];
    const client = {
      postComment: async (_taskId, content) => {
        posted.push(content);
        return { id: String(posted.length) };
      },
    };
    await postReply({
      client,
      taskId: "t1",
      text: `${"a".repeat(9000)}\n${"b".repeat(9000)}`,
      apiKey: KEY,
    });
    assert.equal(posted.length, 2);
    assert.ok(posted.every((part) => part.length <= 10_000));
  });
});
