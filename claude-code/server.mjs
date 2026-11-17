#!/usr/bin/env node
// OnePM channel for Claude Code: delivers the agent's OnePM events (mentions,
// assignments, comments on its tasks) into the session and posts replies as
// task comments. It also serves OnePM's own MCP tools, reached with the
// agent key, and tells Claude about the agent's project in its instructions.
//
// Claude Code starts this server in every session, so it connects only when
// the session was started as an agent profile (ONEPM_AGENT=<name>); otherwise
// it stays idle. A profile's state lives in ~/.claude/channels/onepm/<name>/
// (or $ONEPM_STATE_DIR):
//   .env         ONEPM_URL and ONEPM_AGENT_KEY, written by /onepm:configure
//   access.json  { allowFrom, requireMention }, managed by /onepm:access;
//                created on first start with the agent's owner allowed
//   cursor.json  the last event handled
//   dropped.json the last senders who weren't on the allowlist
import { homedir } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CHANNEL_CAPABILITY,
  CHANNEL_METHOD,
  IDLE_INSTRUCTIONS,
  LOG_PREFIX,
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
} from "./src/constants/channel.mjs";
import {
  BUSY_DELIVERY_MAX_MS,
  BUSY_WORKING_MAX_MS,
  MAX_PARALLEL_TASKS,
  POLL_MS,
  PROJECT_CONTEXT_TIMEOUT_MS,
  REMOTE_CONNECT_TIMEOUT_MS,
  REMOTE_RETRY_MS,
  SELF_RETRY_MS,
  TASK_SLOT_HOLD_MS,
  TRIGGER_KINDS,
} from "./src/constants/onepm.mjs";
import { resolveConfig } from "./src/lib/config.mjs";
import { errorMessage } from "./src/lib/errorMessage.mjs";
import { idleNotice, listProfiles } from "./src/lib/idleNotice.mjs";
import { maskSecrets } from "./src/lib/maskSecrets.mjs";
import { resolveProfile, unconfiguredMessage } from "./src/lib/profile.mjs";
import { connectAgentSocket } from "./src/services/agentSocket.mjs";
import {
  TOOL_DEFINITIONS,
  createChannelTools,
  createIdleTools,
} from "./src/services/channelTools.mjs";
import { createAccessReporter } from "./src/services/accessReporter.mjs";
import { createBusyTracker } from "./src/services/busyTracker.mjs";
import { createTaskSlots } from "./src/services/taskSlots.mjs";
import { createEventFeed } from "./src/services/eventFeed.mjs";
import { createOnepmClient } from "./src/services/onepmClient.mjs";
import { allowOwnerOnFirstStart } from "./src/services/ownerAccess.mjs";
import { loadProjectContext } from "./src/services/projectContext.mjs";
import { connectRemoteMcp } from "./src/services/remoteMcpClient.mjs";
import { createRemoteTools } from "./src/services/remoteTools.mjs";
import { createStateFiles } from "./src/services/stateFiles.mjs";
import { createStatusBusy } from "./src/services/statusBusy.mjs";
import { createToolRouter } from "./src/services/toolRouter.mjs";

// Never let the key reach stderr, which Claude Code may show or log.
const knownSecrets = [];
const log = (message) => {
  process.stderr.write(`${LOG_PREFIX} ${maskSecrets(message, knownSecrets)}\n`);
};

const profile = resolveProfile(process.env, homedir());
const state = profile.active ? createStateFiles(profile.dir, log) : null;
const config = state ? resolveConfig(process.env, state.readEnvValues()) : null;
if (config?.ok) knownSecrets.push(config.apiKey);

// Why this session doesn't connect, if it doesn't. The server still starts
// and answers, so an ordinary session shows no failed MCP server.
const idleReason = !profile.active
  ? profile.message
  : config.ok
    ? null
    : unconfiguredMessage({
        name: profile.name,
        envPath: state.envPath,
        error: config.error,
      });
if (idleReason) log(idleReason);

const client = idleReason
  ? null
  : createOnepmClient(config.baseUrl, config.apiKey);
// Shows people in OnePM that the agent is writing a reply on a task.
const busy = client ? createBusyTracker({ client, log }) : null;
// OnePM refuses assignments and mentions from anyone not on access.json.
const access = client ? createAccessReporter({ client, log }) : null;
// At most MAX_PARALLEL_TASKS tasks in hand at once; a further task's events
// wait, unread, until one of them is answered or its hold runs out.
const slots = createTaskSlots({
  max: MAX_PARALLEL_TASKS,
  holdMs: TASK_SLOT_HOLD_MS,
});
let wakeFeed = () => {};
// A posted reply frees the task's slot. A final one ends the busy mark; one
// the agent keeps working after (working: true) keeps it, for longer.
const replied = busy
  ? {
      stop: (taskId) => {
        busy.stop(taskId);
        slots.finish(taskId);
        wakeFeed();
      },
      work: (taskId) => {
        busy.start(taskId, BUSY_WORKING_MAX_MS);
        slots.finish(taskId);
        wakeFeed();
      },
    }
  : null;
let self = null;
// Set once Claude Code has finished the handshake; notifications sent
// before then are lost.
let initialized = false;
let mcp = null;

// OnePM's own MCP tools, with the agent key: the session needs no separate
// OnePM MCP server, and never acts as the owner through a personal one.
const remote = idleReason
  ? null
  : createRemoteTools({
      connect: () =>
        connectRemoteMcp({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          timeoutMs: REMOTE_CONNECT_TIMEOUT_MS,
        }),
      reservedNames: TOOL_DEFINITIONS.map(({ name }) => name),
      log,
      mask: (text) => maskSecrets(text, knownSecrets),
      onAvailable: () => {
        if (!initialized) return;
        mcp.sendToolListChanged().catch((error) => {
          log(`couldn't announce OnePM's tools: ${errorMessage(error)}`);
        });
      },
      retryMs: REMOTE_RETRY_MS,
      listTimeoutMs: REMOTE_CONNECT_TIMEOUT_MS,
    });
void remote?.start();

// The agent's project, its statuses and repositories, read before the
// handshake because the instructions are sent with it.
const context = client
  ? await loadProjectContext({
      client,
      timeoutMs: PROJECT_CONTEXT_TIMEOUT_MS,
      log,
    })
  : null;
if (context) self = context.self;

mcp = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: {
      tools: { listChanged: true },
      experimental: { [CHANNEL_CAPABILITY]: {} },
    },
    instructions: idleReason
      ? `${IDLE_INSTRUCTIONS}\n\n${idleReason}`
      : context
        ? `${SERVER_INSTRUCTIONS}\n\n${context.summary}`
        : SERVER_INSTRUCTIONS,
  },
);

// Moving a task to a status marks it busy, or clears the mark when the status
// is final, so the agent needn't remember set_working.
const statusBusy = busy
  ? createStatusBusy({
      busy,
      finalStatuses: () => context?.finalStatuses ?? null,
    })
  : null;

const tools = createToolRouter({
  definitions: TOOL_DEFINITIONS,
  local: idleReason
    ? createIdleTools(idleReason)
    : createChannelTools({
        client,
        apiKey: config.apiKey,
        getSelf: () => self,
        busy: replied,
      }),
  remote,
  onRemoteResult: (name, args, result) =>
    statusBusy?.observe(name, args, result),
});
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: await tools.list(),
}));
mcp.setRequestHandler(CallToolRequestSchema, async (request) =>
  tools.call(request.params.name, request.params.arguments),
);

let socket = null;
let pollTimer = null;
let retryTimer = null;

const loadSelf = async () => {
  try {
    return await client.self();
  } catch (error) {
    log(
      `couldn't reach ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
};

const start = async () => {
  self = self ?? (await loadSelf());
  if (!self) {
    retryTimer = setTimeout(start, SELF_RETRY_MS);
    return;
  }
  log(`signed in as @${self.handle} (agent ${self.id})`);
  allowOwnerOnFirstStart({ state, self, log });
  const feed = createEventFeed({
    client,
    state,
    owner: { url: config.baseUrl, agentId: self.id },
    self,
    deliver: async ({ content, meta }) => {
      await mcp.notification({
        method: CHANNEL_METHOD,
        params: { content, meta },
      });
      // A trigger notice asks for nothing, so it shows no busy mark either.
      if (!TRIGGER_KINDS.includes(meta.kind))
        busy.start(meta.chat_id, BUSY_DELIVERY_MAX_MS);
      slots.start(meta.chat_id, meta.kind);
    },
    admits: (event) => slots.admits(event.taskId, event.kind),
    log,
  });
  try {
    await feed.skipHistory();
  } catch (error) {
    log(
      `couldn't read events: ${error instanceof Error ? error.message : String(error)}`,
    );
    retryTimer = setTimeout(start, SELF_RETRY_MS);
    return;
  }
  // access.json is read again on every poll and event: a change made with
  // /onepm:access reaches OnePM within POLL_MS.
  const syncAccess = () => void access.sync(state.loadAccess());
  syncAccess();
  const wake = () => {
    syncAccess();
    void feed.drain();
  };
  wakeFeed = wake;
  socket = connectAgentSocket({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    onWake: wake,
    onReplaced: () => {
      // Another session took this key; it reads the events now.
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
    log,
  });
  pollTimer = setInterval(wake, POLL_MS);
};

// Notifications sent before Claude Code finishes the handshake are lost, so
// events start flowing once it has.
mcp.oninitialized = () => {
  initialized = true;
  if (!idleReason) {
    void start();
    return;
  }
  // Say once why nothing arrives (ONEPM-221): only a session started with
  // the channel flag shows it, so ordinary sessions stay quiet.
  void mcp
    .notification({
      method: CHANNEL_METHOD,
      params: {
        content: idleNotice(idleReason, listProfiles(homedir())),
        meta: { chat_id: "", user: "OnePM", kind: "setup" },
      },
    })
    .catch(() => {});
};

await mcp.connect(new StdioServerTransport());

// When Claude Code closes the connection, stdin ends; don't stay connected
// to OnePM as a zombie.
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down");
  if (retryTimer) clearTimeout(retryTimer);
  if (pollTimer) clearInterval(pollTimer);
  socket?.stop();
  busy?.stopAll();
  void remote?.stop();
  setTimeout(() => process.exit(0), 500).unref();
};
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
