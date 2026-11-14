import { BUSY_MAX_MS, BUSY_REFRESH_MS } from "../constants/onepm.mjs";
import { isNotFound, isRateLimited } from "./onepmClient.mjs";

const errorText = (error) =>
  error instanceof Error ? error.message : String(error);

// OnePM's "replying" mark, driven by OpenClaw's typing callbacks: set when a
// turn starts, refreshed by the keepalive, cleared when the turn goes idle.
// One per account, so an older OnePM without the route is asked only once.
export const createBusyMarker = ({ client, log }) => {
  let supported = true;

  const mark = async (taskId, busy) => {
    if (!supported) return;
    try {
      await client.setBusy(taskId, busy);
    } catch (error) {
      if (isNotFound(error)) {
        supported = false;
        log("this OnePM can't show the agent replying; skipping that");
        return;
      }
      if (isRateLimited(error)) return;
      throw error;
    }
  };

  // The `typing` option of OpenClaw's reply pipeline for one task.
  const typingFor = (taskId) => ({
    start: () => mark(taskId, true),
    stop: () => mark(taskId, false),
    onStartError: (error) => {
      log(`couldn't mark task ${taskId} busy: ${errorText(error)}`);
    },
    keepaliveIntervalMs: BUSY_REFRESH_MS,
    maxDurationMs: BUSY_MAX_MS,
  });

  return { typingFor };
};
