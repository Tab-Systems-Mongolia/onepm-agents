import {
  isAllowedSender,
  isDeliverableKind,
  passesMentionRule,
} from "../lib/access.mjs";
import { formatEvent, taskKeyOf } from "../lib/eventMessage.mjs";

const errorText = (error) =>
  error instanceof Error ? error.message : String(error);

// Newer servers send the actor's name, the task's title and key, and the
// comment's text with each event; older ones only the ids, so read the task
// and its comments for what is missing.
export const resolveDetails = async (client, event, self) => {
  const details = {
    taskKey: event.taskKey ?? null,
    taskTitle: event.taskTitle ?? null,
    actorName: event.actorName ?? null,
    text: event.text ?? null,
  };
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

// Set by `handle` for an event `admits` refused: it stays unread for now.
const HELD = Symbol("held");

// Reads the agent's events from the stored cursor, one at a time, and hands
// each allowed one to `deliver`. The cursor moves past an event once it is
// delivered or dropped, so nothing is delivered twice. An event `admits`
// refuses stops the reading there, cursor unmoved, until a later drain.
export const createEventFeed = ({
  client,
  state,
  owner,
  self,
  deliver,
  admits = () => true,
  log,
}) => {
  let draining = false;
  let rerun = false;

  const advance = (sequence) => state.writeCursor(owner, sequence);

  const dropped = (event, reason) => {
    log(
      `dropped ${event.kind} ${event.id} from ${event.actorId ?? "unknown"}: ${reason}`,
    );
  };

  const handle = async (event) => {
    if (!isDeliverableKind(event.kind)) return;
    // Read for every event, so access changes apply at once.
    const access = state.loadAccess();
    if (!isAllowedSender(event, access, self.id)) {
      if (event.actorId && event.actorId !== self.id) {
        state.recordDropped({
          userId: event.actorId,
          name: event.actorName ?? null,
          taskKey: event.taskKey ?? null,
          kind: event.kind,
          at: event.createdAt ?? new Date().toISOString(),
        });
      }
      dropped(event, "sender not on the allowlist");
      return;
    }
    if (!admits(event)) return HELD;
    let details;
    try {
      details = await resolveDetails(client, event, self);
    } catch (error) {
      // A task that was deleted or moved away can't be read; deliver what
      // the event carries rather than holding up every later event.
      log(`couldn't read task ${event.taskId}: ${errorText(error)}`);
      details = {
        taskKey: event.taskKey ?? null,
        taskTitle: event.taskTitle ?? null,
        actorName: event.actorName ?? null,
        text: event.text ?? null,
      };
    }
    if (!passesMentionRule(event, access, details.text, self)) {
      dropped(
        event,
        "requireMention is on and the comment doesn't mention the agent",
      );
      return;
    }
    const { content, meta } = formatEvent(event, details);
    await deliver({ content, meta });
    log(
      `delivered ${event.kind} ${event.id} on ${meta.task_key ?? event.taskId}`,
    );
  };

  const drainOnce = async () => {
    for (;;) {
      const after = state.readCursor(owner);
      const page = await client.events(after);
      const fresh = Array.isArray(page)
        ? page.filter((event) => after === null || event.sequence > after)
        : [];
      if (fresh.length === 0) return;
      for (const event of fresh) {
        // A failed delivery leaves the cursor where it is and stops; the
        // next wake tries the same event again.
        if ((await handle(event)) === HELD) return;
        advance(event.sequence);
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
    if (state.readCursor(owner) !== null) return;
    let last = 0;
    for (
      let page = await client.events(null);
      page.length > 0;
      page = await client.events(last)
    ) {
      const next = page.at(-1)?.sequence ?? last;
      if (next <= last) break;
      last = next;
    }
    advance(last);
    log(`starting after event ${last}; earlier events are skipped`);
  };

  return { drain, skipHistory };
};
