import { BUSY_MAX_MS, BUSY_REFRESH_MS } from "../constants/onepm.mjs";
import { errorMessage } from "../lib/errorMessage.mjs";
import { isNotFound, isRateLimited } from "./onepmClient.mjs";

const systemTimers = { setInterval, clearInterval };

// Tells OnePM the agent is replying on a task from when an event is delivered
// until its reply is posted. A channel server can't see when Claude's turn
// ends, so it refreshes the busy mark while it waits, up to maxMs; a turn
// that ends without a reply clears by itself once the refreshing stops.
// start(taskId, capMs) lets work the agent says goes on (a working reply,
// set_working) refresh for longer than an unanswered event.
export const createBusyTracker = ({
  client,
  log,
  timers = systemTimers,
  now = Date.now,
  refreshMs = BUSY_REFRESH_MS,
  maxMs = BUSY_MAX_MS,
}) => {
  const refreshing = new Map();
  // When each task's mark was last extended: a new one waits its full time.
  const startedAt = new Map();
  // How long each task refreshes from startedAt.
  const capOf = new Map();
  // An older OnePM has no busy route; then nothing is sent again.
  let supported = true;

  const send = (taskId, busy) => {
    if (!supported) return;
    client.setBusy(taskId, busy).catch((error) => {
      if (isNotFound(error)) {
        supported = false;
        for (const timer of refreshing.values()) timers.clearInterval(timer);
        refreshing.clear();
        log("this OnePM can't show the agent replying; skipping that");
        return;
      }
      if (isRateLimited(error)) return;
      log(`couldn't mark task ${taskId} busy=${busy}: ${errorMessage(error)}`);
    });
  };

  const stop = (taskId) => {
    const timer = refreshing.get(taskId);
    if (timer !== undefined) timers.clearInterval(timer);
    refreshing.delete(taskId);
    startedAt.delete(taskId);
    capOf.delete(taskId);
    send(taskId, false);
  };

  const start = (taskId, capMs = maxMs) => {
    if (!supported) return;
    send(taskId, true);
    // Keep whichever mark lasts longer: a brief one for a new event must not
    // cut short work the agent already said it does.
    const at = now();
    const current = startedAt.has(taskId)
      ? (startedAt.get(taskId) ?? 0) + (capOf.get(taskId) ?? maxMs)
      : 0;
    if (at + capMs >= current) {
      startedAt.set(taskId, at);
      capOf.set(taskId, capMs);
    }
    if (refreshing.has(taskId)) return;
    const timer = timers.setInterval(() => {
      if (
        now() - (startedAt.get(taskId) ?? 0) >=
        (capOf.get(taskId) ?? maxMs)
      ) {
        stop(taskId);
        return;
      }
      send(taskId, true);
    }, refreshMs);
    timer?.unref?.();
    refreshing.set(taskId, timer);
  };

  const stopAll = () => {
    for (const taskId of [...refreshing.keys()]) stop(taskId);
  };

  return { start, stop, stopAll };
};
