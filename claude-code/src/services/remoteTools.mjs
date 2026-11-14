import { errorMessage } from "../lib/errorMessage.mjs";

const errorResult = (text) => ({
  content: [{ type: "text", text }],
  isError: true,
});

// OnePM's own MCP tools, reached with the agent key, so they act as the agent
// inside its project and scopes. The channel works without them: when OnePM
// can't be reached, list() is empty and call() returns null, and the next
// list or call (no sooner than retryMs later) connects again. A remote tool
// named like one of the channel's own is skipped, so the channel's reply and
// get_task keep the meaning its instructions give them.
export const createRemoteTools = ({
  connect,
  reservedNames,
  log,
  mask,
  onAvailable,
  retryMs,
  // Listing is on Claude's tool-list path, so it waits less than a call.
  listTimeoutMs,
  now = Date.now,
}) => {
  const reserved = new Set(reservedNames);
  let session = null;
  let pending = null;
  let lastAttempt = null;

  const listAll = async (client) => {
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, {
        timeout: listTimeoutMs,
      });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  };

  const reported = new Set();
  const usable = (tools) => {
    const skipped = tools
      .map(({ name }) => name)
      .filter((name) => reserved.has(name) && !reported.has(name));
    if (skipped.length) {
      for (const name of skipped) reported.add(name);
      log(
        `kept the channel's own ${skipped.join(", ")}; OnePM's tool of the same name isn't listed`,
      );
    }
    return tools.filter(({ name }) => !reserved.has(name));
  };

  const drop = (current) => {
    if (session === current) session = null;
    void current.client.close().catch(() => {});
  };

  const attempt = async () => {
    let client = null;
    try {
      client = await connect();
      const tools = usable(await listAll(client));
      session = { client, tools };
      log(`OnePM tools available (${tools.length})`);
      onAvailable();
      return session;
    } catch (error) {
      if (client) void client.close().catch(() => {});
      log(`OnePM tools unavailable: ${mask(errorMessage(error))}`);
      return null;
    } finally {
      pending = null;
    }
  };

  const ensure = () => {
    if (session) return Promise.resolve(session);
    if (pending) return pending;
    if (lastAttempt !== null && now() - lastAttempt < retryMs) {
      return Promise.resolve(null);
    }
    lastAttempt = now();
    pending = attempt();
    return pending;
  };

  return {
    // The first connection, made in the background at startup.
    start: () => ensure(),

    list: async () => {
      const current = await ensure();
      if (!current) return [];
      try {
        current.tools = usable(await listAll(current.client));
        return current.tools;
      } catch (error) {
        log(`OnePM tools stopped answering: ${mask(errorMessage(error))}`);
        drop(current);
        // Reconnect on the next request rather than waiting out the retry.
        lastAttempt = null;
        return [];
      }
    },

    // The remote tool's result as it is, or null when OnePM has no tool by
    // this name. While OnePM can't be reached, an error that says so.
    call: async (name, args) => {
      const current = await ensure();
      if (!current) {
        return errorResult(
          `${name}: OnePM's tools aren't available right now (OnePM couldn't be reached). Try again in a minute.`,
        );
      }
      if (!current.tools.some((tool) => tool.name === name)) return null;
      try {
        return await current.client.callTool({ name, arguments: args });
      } catch (error) {
        const message = mask(errorMessage(error));
        log(`${name} failed: ${message}`);
        drop(current);
        lastAttempt = null;
        return errorResult(`${name} failed: ${message}`);
      }
    },

    stop: async () => {
      const current = session;
      session = null;
      await current?.client.close().catch(() => {});
    },
  };
};
