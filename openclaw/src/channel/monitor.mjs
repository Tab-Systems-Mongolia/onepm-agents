import { join } from "node:path";
import { POLL_MS, SELF_RETRY_MS, STATE_SUBDIR } from "../constants/onepm.mjs";
import { connectAgentSocket } from "../services/agentSocket.mjs";
import { createBusyMarker } from "../services/busyTyping.mjs";
import { createCursorFile } from "../services/cursorFile.mjs";
import { createEventFeed } from "../services/eventFeed.mjs";
import { createOnepmClient } from "../services/onepmClient.mjs";
import { postReply } from "../services/postReply.mjs";
import { admitsSender, handleOnepmInbound } from "./ingress.mjs";
import { getOnepmRuntime } from "./runtime.mjs";

const errorText = (error) =>
  error instanceof Error ? error.message : String(error);

// Keeps the agent online in OnePM (the agent socket) and turns its events
// into OpenClaw turns until the account stops.
export const startOnepmMonitor = ({
  account,
  cfg,
  abortSignal,
  statusSink,
  log,
}) => {
  const core = getOnepmRuntime();
  const client = createOnepmClient(account.baseUrl, account.apiKey);
  const stateDir = join(core.state.resolveStateDir(process.env), STATE_SUBDIR);
  let stopped = false;
  let socket = null;
  let pollTimer = null;
  let retryTimer = null;

  const reply = (taskId, text) =>
    postReply({ client, taskId, text, apiKey: account.apiKey });
  const busy = createBusyMarker({ client, log });

  const start = async () => {
    if (stopped) return;
    let self;
    try {
      self = await client.self();
    } catch (error) {
      log(`couldn't reach ${account.baseUrl}: ${errorText(error)}`);
      retryTimer = setTimeout(start, SELF_RETRY_MS);
      return;
    }
    if (stopped) return;
    log(`signed in as @${self.handle} (agent ${self.id})`);
    const feed = createEventFeed({
      client,
      cursor: createCursorFile(stateDir, {
        url: account.baseUrl,
        agentId: self.id,
      }),
      self,
      admits: (event) => admitsSender({ cfg, account, event }),
      handle: (event, details) =>
        handleOnepmInbound({
          cfg,
          account,
          self,
          event,
          details,
          postReply: reply,
          typing: busy.typingFor(event.taskId),
          log,
          statusSink,
        }),
      log,
    });
    try {
      await feed.skipHistory();
    } catch (error) {
      log(`couldn't read events: ${errorText(error)}`);
      retryTimer = setTimeout(start, SELF_RETRY_MS);
      return;
    }
    if (stopped) return;
    const wake = () => void feed.drain();
    socket = connectAgentSocket({
      baseUrl: account.baseUrl,
      apiKey: account.apiKey,
      onWake: wake,
      onReplaced: () => {
        // Another connection took this key; it reads the events now.
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        statusSink?.({
          connected: false,
          lastError: "replaced by another connection",
        });
      },
      log,
    });
    pollTimer = setInterval(wake, POLL_MS);
    statusSink?.({ connected: true });
    wake();
  };

  const stop = () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (pollTimer) clearInterval(pollTimer);
    socket?.stop();
    socket = null;
  };

  abortSignal?.addEventListener("abort", stop, { once: true });
  void start();
  return { stop };
};
