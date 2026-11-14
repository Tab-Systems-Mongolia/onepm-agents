import {
  EVENT_KINDS,
  TRIGGER_KINDS,
  TRIGGER_SOURCE,
} from "../constants/onepm.mjs";

const DEFAULT_ACCESS = { allowFrom: [], requireMention: true };

// Anything unexpected falls back to the safe default: nobody allowed,
// mentions required.
export const normalizeAccess = (raw) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_ACCESS };
  }
  const allowFrom = Array.isArray(raw.allowFrom)
    ? raw.allowFrom
        .filter((id) => typeof id === "string" && id.trim())
        .map((id) => id.trim())
    : [];
  return { allowFrom, requireMention: raw.requireMention !== false };
};

export const isDeliverableKind = (kind) =>
  Object.values(EVENT_KINDS).includes(kind);

// A status or pull request event OnePM sent for a trigger an admin set on a
// task assigned to the agent.
export const isTriggerEvent = (event) =>
  event.actorSource === TRIGGER_SOURCE && TRIGGER_KINDS.includes(event.kind);

// Whether the sender may reach the session at all. Checked before anything
// is fetched for the event. Trigger events have no sender to check.
export const isAllowedSender = (event, access, selfId) =>
  isTriggerEvent(event) ||
  (Boolean(event.actorId) &&
    event.actorId !== selfId &&
    access.allowFrom.includes(event.actorId));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const mentionsAgent = (text, self) => {
  if (!text || !self) return false;
  if (self.id && text.includes(`<kaneo-mention id="${self.id}"`)) return true;
  return (
    Boolean(self.handle) &&
    new RegExp(`(^|[^\\w@])@${escapeRegExp(self.handle)}\\b`, "i").test(text)
  );
};

// requireMention: only mentions, assignments and comments that mention the
// agent. Otherwise every comment on its tasks.
export const passesMentionRule = (event, access, text, self) => {
  if (!access.requireMention || isTriggerEvent(event)) return true;
  if (event.kind === EVENT_KINDS.comment) return mentionsAgent(text, self);
  return (
    event.kind === EVENT_KINDS.mention || event.kind === EVENT_KINDS.assignment
  );
};
