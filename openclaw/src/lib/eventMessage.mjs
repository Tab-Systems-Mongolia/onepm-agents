import { EVENT_KINDS } from "../constants/onepm.mjs";

const MENTION_TAG = /<kaneo-mention\b([^>]*)>([\s\S]*?)<\/kaneo-mention>/gi;
const LABEL_ATTRIBUTE = /\blabel="([^"]*)"/i;

const LINE_BREAK_TAGS = /<br\s*\/?>|<\/(p|div|li|h[1-6]|blockquote|pre)>/gi;
const ANY_TAG = /<[^>]+>/g;
const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};
const ENTITY = /&(amp|lt|gt|quot|#39|nbsp);/g;

// Comments come from the editor as HTML (or Markdown) with mention tags:
// show mentions as @name, block ends as line breaks, and drop other tags.
export const readableText = (content) =>
  (content ?? "")
    .replace(MENTION_TAG, (_tag, attributes, inner) => {
      const label = LABEL_ATTRIBUTE.exec(attributes)?.[1] ?? inner.trim();
      if (!label) return "@someone";
      return label.startsWith("@") ? label : `@${label}`;
    })
    .replace(LINE_BREAK_TAGS, "\n")
    .replace(ANY_TAG, "")
    .replace(ENTITY, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const taskKeyOf = (projectSlug, number) =>
  projectSlug && Number.isInteger(number)
    ? `${projectSlug.toUpperCase()}-${number}`
    : null;

// Whether the event asks the agent something. finished/unassigned and other
// kinds don't, and neither does anything the agent did itself.
export const isRequest = (event, selfId) =>
  Object.values(EVENT_KINDS).includes(event?.kind) &&
  Boolean(event.actorId) &&
  event.actorId !== selfId &&
  Boolean(event.taskId);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const mentionsAgent = (text, self) => {
  if (!text || !self) return false;
  if (self.id && text.includes(`<kaneo-mention id="${self.id}"`)) return true;
  return (
    Boolean(self.handle) &&
    new RegExp(`(^|[^\\w@])@${escapeRegExp(self.handle)}\\b`, "i").test(text)
  );
};

// A mention or an assignment always addresses the agent; a comment only
// when it mentions it. OpenClaw's requireMention gate reads this.
export const addressesAgent = (event, text, self) =>
  event.kind === EVENT_KINDS.mention ||
  event.kind === EVENT_KINDS.assignment ||
  mentionsAgent(text, self);

const ACTION_BY_KIND = {
  [EVENT_KINDS.mention]: "mentioned you",
  [EVENT_KINDS.assignment]: "assigned this task to you",
  [EVENT_KINDS.comment]: "commented",
};

export const taskLabel = (event, details) =>
  [details.taskKey && `[${details.taskKey}]`, details.taskTitle]
    .filter(Boolean)
    .join(" ") || `Task ${event.taskId}`;

// details: { taskKey, taskTitle, actorName, text } as far as they're known.
// Returns the message body OpenClaw gives the agent, plus the facts its
// context needs.
export const formatEvent = (event, details) => {
  const who = details.actorName || event.actorId || "Someone";
  const label = taskLabel(event, details);
  const text = readableText(details.text);
  const body = [
    label,
    `${who} ${ACTION_BY_KIND[event.kind] ?? event.kind}${text ? ":" : "."}`,
    ...(text ? ["", text] : []),
  ].join("\n");
  const createdAt = Date.parse(event.createdAt ?? "");
  return {
    body,
    chatId: event.taskId,
    chatLabel: label,
    senderId: event.actorId,
    senderName: details.actorName || null,
    messageId: String(event.id),
    timestamp: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
};

// One comment holds at most `limit` characters; split longer replies at a
// paragraph or line break where one is close enough.
export const splitReply = (text, limit) => {
  const parts = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
    );
    const cut = breakAt > limit / 2 ? breakAt : limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
};
