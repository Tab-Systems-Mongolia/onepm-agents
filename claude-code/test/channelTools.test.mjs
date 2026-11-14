import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TOOL_DEFINITIONS,
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
