const errorText = (error) =>
  error instanceof Error ? error.message : String(error);

// OpenClaw's dispatch resolves only once the agent's turn has ended, so
// "delivered" is logged before it: the event has been admitted and handed
// over. The turn's end gets its own line. A failure is rethrown so the
// caller keeps the event's cursor where it is and retries it.
export const dispatchTurn = async ({ dispatch, log, label }) => {
  log(`delivered ${label}`);
  try {
    await dispatch();
  } catch (error) {
    log(`turn failed for ${label}: ${errorText(error)}`);
    throw error;
  }
  log(`turn finished for ${label}`);
};
