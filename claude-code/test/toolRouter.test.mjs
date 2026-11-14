import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolRouter } from "../src/services/toolRouter.mjs";

const definitions = [{ name: "reply" }, { name: "get_task" }];
const local = {
  call: async (name) => ({
    content: [{ type: "text", text: `local ${name}` }],
    ...(definitions.some((tool) => tool.name === name)
      ? {}
      : { isError: true }),
  }),
};
const remote = {
  list: async () => [{ name: "update_task" }],
  call: async (name) =>
    name === "update_task"
      ? { content: [{ type: "text", text: "remote update_task" }] }
      : null,
};

describe("createToolRouter", () => {
  it("lists the channel's tools first, then OnePM's", async () => {
    const router = createToolRouter({ definitions, local, remote });

    assert.deepEqual(
      (await router.list()).map(({ name }) => name),
      ["reply", "get_task", "update_task"],
    );
  });

  it("keeps the channel's own tools local", async () => {
    let remoteCalled = false;
    const router = createToolRouter({
      definitions,
      local,
      remote: {
        ...remote,
        call: async () => {
          remoteCalled = true;
          return null;
        },
      },
    });

    const result = await router.call("reply", {});

    assert.equal(result.content[0].text, "local reply");
    assert.equal(remoteCalled, false);
  });

  it("sends OnePM's tools to OnePM", async () => {
    const router = createToolRouter({ definitions, local, remote });

    const result = await router.call("update_task", {});

    assert.equal(result.content[0].text, "remote update_task");
  });

  it("refuses a name neither knows", async () => {
    const router = createToolRouter({ definitions, local, remote });

    const result = await router.call("nope", {});

    assert.equal(result.isError, true);
  });

  it("works with the channel's tools alone", async () => {
    const router = createToolRouter({ definitions, local, remote: null });

    assert.deepEqual(
      (await router.list()).map(({ name }) => name),
      ["reply", "get_task"],
    );
    assert.equal((await router.call("update_task", {})).isError, true);
  });
});
