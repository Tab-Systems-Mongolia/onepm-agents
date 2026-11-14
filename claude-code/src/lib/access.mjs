import { EVENT_KINDS } from "../constants/onepm.mjs";

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

// Whether the sender may reach the session at all. Checked before anything
// is fetched for the event.
export const isAllowedSender = (event, access, selfId) =>
  Boolean(event.actorId) &&
  event.actorId !== selfId &&
  access.allowFrom.includes(event.actorId);

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
  if (!access.requireMention) return true;
  if (event.kind === EVENT_KINDS.comment) return mentionsAgent(text, self);
  return (
    event.kind === EVENT_KINDS.mention || event.kind === EVENT_KINDS.assignment
  );
};
