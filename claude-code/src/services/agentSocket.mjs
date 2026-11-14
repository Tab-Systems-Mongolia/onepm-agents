import {
  AGENT_EVENT_MESSAGE,
  AGENT_REPLACED_CLOSE_CODE,
  AGENT_SOCKET_PATH,
  API_KEY_HEADER,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  SOCKET_KEEPALIVE_MESSAGE,
  SOCKET_KEEPALIVE_MS,
} from "../constants/onepm.mjs";

const messageType = (data) => {
  try {
    return JSON.parse(String(data))?.type ?? null;
  } catch {
    return null;
  }
};

// Node's WebSocket (undici) takes headers in its init object; native clients
// send no Origin, so the server accepts the x-api-key header instead.
const openSocket = (url, apiKey) =>
  new WebSocket(url, { headers: { [API_KEY_HEADER]: apiKey } });

// Keeps one live connection to <url>/api/ws/agent. Each AGENT_EVENT ping
// calls onWake; the server's own presence for the agent comes from this
// connection. A newer connection with the same key replaces this one, and
// then it stays offline.
export const connectAgentSocket = ({
  baseUrl,
  apiKey,
  onWake,
  onReplaced,
  log,
  createSocket = openSocket,
}) => {
  const url = `${baseUrl.replace(/^http/, "ws")}${AGENT_SOCKET_PATH}`;
  let current = null;
  let keepalive = null;
  let reconnectTimer = null;
  let delay = RECONNECT_MIN_MS;
  let stopped = false;

  const clearKeepalive = () => {
    if (keepalive) clearInterval(keepalive);
    keepalive = null;
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    log(`reconnecting in ${Math.round(delay / 1000)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  };

  const abandon = (socket) => {
    if (current !== socket) return;
    current = null;
    clearKeepalive();
    try {
      socket.close();
    } catch {
      /* Already closed. */
    }
  };

  const replaced = (socket) => {
    abandon(socket);
    stopped = true;
    log("another connection took over this agent key; staying offline");
    onReplaced?.();
  };

  const connect = () => {
    if (stopped) return;
    const socket = createSocket(url, apiKey);
    current = socket;

    socket.addEventListener("open", () => {
      if (current !== socket) return;
      log("connected");
      delay = RECONNECT_MIN_MS;
      clearKeepalive();
      keepalive = setInterval(() => {
        // Data still queued from the previous keepalive means the link is
        // gone without a close; start a new one.
        if (socket.bufferedAmount > 0) {
          log("no answer from the server");
          abandon(socket);
          scheduleReconnect();
          return;
        }
        try {
          socket.send(SOCKET_KEEPALIVE_MESSAGE);
        } catch (error) {
          log(
            `keepalive failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }, SOCKET_KEEPALIVE_MS);
      onWake();
    });
    socket.addEventListener("message", (message) => {
      if (current !== socket) return;
      // AGENT_CONNECTION_REPLACED is sent to every connection of the key,
      // the new one included, so only the close code below means "replaced".
      if (messageType(message.data) === AGENT_EVENT_MESSAGE) onWake();
    });
    socket.addEventListener("error", (error) => {
      if (current === socket)
        log(`socket error: ${error?.message ?? "connection failed"}`);
    });
    socket.addEventListener("close", (closed) => {
      if (current !== socket) return;
      if (closed.code === AGENT_REPLACED_CLOSE_CODE) {
        replaced(socket);
        return;
      }
      current = null;
      clearKeepalive();
      log(`socket closed (${closed.code})`);
      scheduleReconnect();
    });
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (current) abandon(current);
    },
  };
};
