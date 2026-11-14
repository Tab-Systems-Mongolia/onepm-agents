import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRemoteTools } from "../src/services/remoteTools.mjs";

const SECRET = "opm_agent_secret_value_1234";

const tool = (name) => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object", properties: {} },
});

// A stand-in for the SDK client connected to OnePM's /api/mcp.
const fakeRemote = ({ tools, pages, callTool } = {}) => {
  const calls = [];
  let closed = false;
  return {
    calls,
    get closed() {
      return closed;
    },
    listTools: async (params) => {
      if (pages) return pages[params?.cursor ?? "first"];
      return { tools: tools ?? [tool("list_tasks"), tool("update_task")] };
    },
    callTool: async (params) => {
      calls.push(params);
      if (callTool) return callTool(params);
      return {
        content: [{ type: "text", text: `ran ${params.name}` }],
        structuredContent: { ok: true },
      };
    },
    close: async () => {
      closed = true;
    },
  };
};

const setup = ({
  connect,
  reservedNames = ["reply", "get_task"],
  retryMs = 0,
  clock = { now: 0 },
} = {}) => {
  const logged = [];
  let available = 0;
  const remote = createRemoteTools({
    connect,
    reservedNames,
    log: (line) => logged.push(line),
    mask: (text) => text.replaceAll(SECRET, "[redacted]"),
    onAvailable: () => {
      available += 1;
    },
    retryMs,
    now: () => clock.now,
  });
  return {
    remote,
    logged,
    get available() {
      return available;
    },
  };
};

describe("createRemoteTools", () => {
  it("lists OnePM's tools once connected", async () => {
    const client = fakeRemote();
    const { remote } = setup({ connect: async () => client });

    const tools = await remote.list();

    assert.deepEqual(
      tools.map(({ name }) => name),
      ["list_tasks", "update_task"],
    );
  });

  it("follows the remote list's pages", async () => {
    const client = fakeRemote({
      pages: {
        first: { tools: [tool("a")], nextCursor: "two" },
        two: { tools: [tool("b")] },
      },
    });
    const { remote } = setup({ connect: async () => client });

    assert.deepEqual(
      (await remote.list()).map(({ name }) => name),
      ["a", "b"],
    );
  });

  it("skips a remote tool named like one of the channel's own, and says so", async () => {
    const client = fakeRemote({
      tools: [tool("get_task"), tool("list_tasks"), tool("reply")],
    });
    const { remote, logged } = setup({ connect: async () => client });

    const names = (await remote.list()).map(({ name }) => name);

    assert.deepEqual(names, ["list_tasks"]);
    assert.match(logged.join("\n"), /get_task/);
    assert.equal(await remote.call("get_task", {}), null);
    await remote.list();
    assert.equal(logged.filter((line) => /get_task/.test(line)).length, 1);
  });

  it("forwards a call to OnePM and returns its result unchanged", async () => {
    const client = fakeRemote();
    const { remote } = setup({ connect: async () => client });

    const result = await remote.call("update_task", { taskId: "t1" });

    assert.deepEqual(client.calls, [
      { name: "update_task", arguments: { taskId: "t1" } },
    ]);
    assert.deepEqual(result, {
      content: [{ type: "text", text: "ran update_task" }],
      structuredContent: { ok: true },
    });
  });

  it("passes OnePM's own refusal through as it is", async () => {
    const refusal = {
      content: [{ type: "text", text: "HTTP 403: missing scope task:delete" }],
      isError: true,
    };
    const client = fakeRemote({ callTool: async () => refusal });
    const { remote } = setup({ connect: async () => client });

    assert.deepEqual(await remote.call("update_task", {}), refusal);
  });

  it("returns null for a name OnePM doesn't have", async () => {
    const { remote } = setup({ connect: async () => fakeRemote() });

    assert.equal(await remote.call("nope", {}), null);
  });

  it("turns a failed call into an error result, with the key masked", async () => {
    const client = fakeRemote({
      callTool: async () => {
        throw new Error(`socket hang up (Bearer ${SECRET})`);
      },
    });
    const { remote, logged } = setup({ connect: async () => client });

    const result = await remote.call("update_task", {});

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /update_task failed: socket hang up/);
    assert.doesNotMatch(result.content[0].text, new RegExp(SECRET));
    assert.doesNotMatch(logged.join("\n"), new RegExp(SECRET));
  });

  it("works without OnePM's tools when it can't connect, and logs why", async () => {
    const { remote, logged } = setup({
      connect: async () => {
        throw new Error(`ECONNREFUSED with ${SECRET}`);
      },
    });

    assert.deepEqual(await remote.list(), []);
    const result = await remote.call("update_task", {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /OnePM's tools aren't available/);
    assert.match(logged.join("\n"), /ECONNREFUSED/);
    assert.doesNotMatch(logged.join("\n"), new RegExp(SECRET));
  });

  it("connects again on a later list, and announces the tools", async () => {
    let up = false;
    const clock = { now: 0 };
    const state = setup({
      connect: async () => {
        if (!up) throw new Error("ECONNREFUSED");
        return fakeRemote();
      },
      retryMs: 1000,
      clock,
    });

    assert.deepEqual(await state.remote.list(), []);
    up = true;
    // Too soon: it doesn't try again on every request.
    assert.deepEqual(await state.remote.list(), []);
    clock.now = 1000;
    const names = (await state.remote.list()).map(({ name }) => name);

    assert.deepEqual(names, ["list_tasks", "update_task"]);
    assert.equal(state.available, 1);
  });

  it("announces the tools when the first connection succeeds in the background", async () => {
    const state = setup({ connect: async () => fakeRemote() });

    await state.remote.start();

    assert.equal(state.available, 1);
    await state.remote.list();
    assert.equal(state.available, 1);
  });

  it("shares one connection attempt between requests that arrive together", async () => {
    let attempts = 0;
    const { remote } = setup({
      connect: async () => {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return fakeRemote();
      },
    });

    await Promise.all([remote.start(), remote.list(), remote.list()]);

    assert.equal(attempts, 1);
  });

  it("drops a connection that stops answering and reconnects later", async () => {
    let connections = 0;
    let broken = null;
    const { remote } = setup({
      connect: async () => {
        connections += 1;
        const client = fakeRemote();
        if (connections === 1) {
          // Answers once, then the API restarts and forgets the session.
          broken = client;
          const first = client.listTools;
          let listed = 0;
          client.listTools = async (params) => {
            listed += 1;
            if (listed > 1) throw new Error("session not found");
            return first(params);
          };
        }
        return client;
      },
    });

    await remote.start();
    assert.deepEqual(await remote.list(), []);
    assert.equal(broken.closed, true);
    assert.deepEqual(
      (await remote.list()).map(({ name }) => name),
      ["list_tasks", "update_task"],
    );
    assert.equal(connections, 2);
  });

  it("closes the connection on stop", async () => {
    const client = fakeRemote();
    const { remote } = setup({ connect: async () => client });
    await remote.start();

    await remote.stop();

    assert.equal(client.closed, true);
  });
});
