import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TOOL_DEFINITIONS,
  createChannelTools,
  createIdleTools,
} from "../src/services/channelTools.mjs";

describe("createIdleTools", () => {
  const message =
    "OnePM channel isn't active in this session: start Claude Code with ONEPM_AGENT=<name> claude --dangerously-load-development-channels plugin:onepm@onepm";
  const tools = createIdleTools(message);

  it("answers every channel tool with why the channel is idle", async () => {
    for (const { name } of TOOL_DEFINITIONS) {
      const result = await tools.call(name, { chat_id: "t1", text: "hi" });
      assert.equal(result.isError, true, name);
      assert.equal(result.content[0].text, message, name);
    }
  });

  it("still refuses an unknown tool by name", async () => {
    const result = await tools.call("nope", {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unknown tool: nope/);
  });
});

describe("reply", () => {
  const setup = (postComment) => {
    const stopped = [];
    const working = [];
    const tools = createChannelTools({
      client: { postComment },
      apiKey: "opm_agent_secret",
      getSelf: () => null,
      busy: {
        stop: (taskId) => stopped.push(taskId),
        work: (taskId) => working.push(taskId),
      },
    });
    return { tools, stopped, working };
  };

  it("stops being busy on the task once the reply is posted", async () => {
    const { tools, stopped } = setup(async () => ({}));

    const result = await tools.call("reply", { chat_id: "t1", text: "done" });

    assert.equal(result.isError, undefined);
    assert.deepEqual(stopped, ["t1"]);
  });

  it("keeps the task busy after a reply sent with working: true", async () => {
    const { tools, stopped, working } = setup(async () => ({}));

    const result = await tools.call("reply", {
      chat_id: "t1",
      text: "got it, starting",
      working: true,
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(working, ["t1"]);
    assert.deepEqual(stopped, []);
  });

  it("set_working marks and clears a task without a comment", async () => {
    let commented = false;
    const { tools, stopped, working } = setup(async () => {
      commented = true;
    });

    await tools.call("set_working", { chat_id: "t1", working: true });
    await tools.call("set_working", { chat_id: "t1", working: false });
    const missing = await tools.call("set_working", { chat_id: "t1" });

    assert.deepEqual(working, ["t1"]);
    assert.deepEqual(stopped, ["t1"]);
    assert.equal(missing.isError, true);
    assert.equal(commented, false);
  });

  it("stays busy when the reply couldn't be posted", async () => {
    const { tools, stopped } = setup(async () => {
      throw new Error("offline");
    });

    const result = await tools.call("reply", { chat_id: "t1", text: "done" });

    assert.equal(result.isError, true);
    assert.deepEqual(stopped, []);
  });
});
