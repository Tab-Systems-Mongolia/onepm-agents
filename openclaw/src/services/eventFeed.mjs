import { RATE_LIMITED_STATUS } from "../constants/onepm.mjs";
import { borrowsOwner, isRequest, taskKeyOf } from "../lib/eventMessage.mjs";
import { OnepmHttpError } from "./onepmClient.mjs";

const errorText = (error) =>
  error instanceof Error ? error.message : String(error);

const detailsOnEvent = (event) => ({
  taskKey: event.taskKey ?? null,
  taskTitle: event.taskTitle ?? null,
  actorName: event.actorName ?? null,
  text: event.text ?? null,
});

// Newer servers send the actor's name, the task's title and key, and the
// comment's text with each event; older ones only the ids, so read the task
// and its comments for what is missing.
export const resolveDetails = async (client, event, self) => {
  const details = detailsOnEvent(event);
  const needsTask = !details.taskTitle || !details.taskKey;
  const needsComment =
    Boolean(event.commentId) && (details.text === null || !details.actorName);
  const [task, comments] = await Promise.all([
    needsTask ? client.task(event.taskId) : null,
    needsComment ? client.comments(event.taskId) : null,
  ]);
  if (task) {
    details.taskTitle ??= task.title ?? null;
    details.taskKey ??= taskKeyOf(self.projectSlug, task.number);
  }
  const comment = comments?.find?.(({ id }) => id === event.commentId);
  if (comment) {
    details.text ??= comment.content ?? null;
    details.actorName ??= comment.user?.name ?? null;
  }
  return details;
};

// A task or comment the key can no longer read is skipped; a server error,
// a rate limit or a network failure stops the drain to retry later.
const isSkippable = (error) =>
  error instanceof OnepmHttpError &&
  error.status < 500 &&
  error.status !== RATE_LIMITED_STATUS;

// Reads the agent's events from the stored cursor and hands each request to
// `handle(event, details)`. `admits(event)` is asked first, before anything
// is fetched for the event, so a sender OpenClaw would refuse costs no reads.
// The cursor moves past an event once it is handled or dropped, so nothing
// is handled twice.
export const createEventFeed = ({
  client,
  cursor,
  self,
  admits = () => true,
  handle,
  log,
}) => {
  let draining = false;
  let rerun = false;

  const handleOne = async (event) => {
    if (!isRequest(event, self.id)) return;
    if (borrowsOwner(event, self.ownerId)) {
      log(
        `dropped ${event.kind} ${event.id}: another agent named as the owner`,
      );
      return;
    }
    if (!(await admits(event))) {
      // The id is logged so the owner can add a person they mean to allow.
      log(
        `dropped ${event.kind} ${event.id} from ${event.actorId}: sender not allowed`,
      );
      return;
    }
    let details;
    try {
      details = await resolveDetails(client, event, self);
    } catch (error) {
      if (!isSkippable(error)) throw error;
      // Deliver what the event carries rather than holding up later events.
      log(`couldn't read task ${event.taskId}: ${errorText(error)}`);
      details = detailsOnEvent(event);
    }
    await handle(event, details);
  };

  const drainOnce = async () => {
    for (;;) {
      const after = cursor.read();
      const page = await client.events(after);
      const fresh = Array.isArray(page)
        ? page.filter((event) => after === null || event.sequence > after)
        : [];
      if (fresh.length === 0) return;
      for (const event of fresh) {
        // A failure leaves the cursor where it is and stops; the next wake
        // tries the same event again.
        await handleOne(event);
        cursor.write(event.sequence);
      }
    }
  };

  const drain = async () => {
    if (draining) {
      rerun = true;
      return;
    }
    draining = true;
    try {
      do {
        rerun = false;
        await drainOnce();
      } while (rerun);
    } catch (error) {
      log(`couldn't read events: ${errorText(error)}`);
    } finally {
      draining = false;
    }
  };

  // The first start begins from now, not from the agent's whole history.
  const skipHistory = async () => {
    if (cursor.read() !== null) return;
    let last = 0;
    for (
      let page = await client.events(null);
      Array.isArray(page) && page.length > 0;
      page = await client.events(last)
    ) {
      const next = page.at(-1)?.sequence ?? last;
      if (next <= last) break;
      last = next;
    }
    cursor.write(last);
    log(`starting after event ${last}; earlier events are skipped`);
  };

  return { drain, skipHistory };
};
