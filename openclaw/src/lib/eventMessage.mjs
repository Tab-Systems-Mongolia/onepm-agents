import {
  ALLOW_EVERYONE,
  EVENT_KINDS,
  PULL_REQUEST_ACTION_TEXT,
  TRIGGER_KINDS,
  TRIGGER_SENDER_ID,
  TRIGGER_SENDER_NAME,
  TRIGGER_SOURCE,
} from "../constants/onepm.mjs";

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

// A status or pull request event OnePM sent for a trigger an admin set on a
// task assigned to the agent.
export const isTriggerEvent = (event) =>
  event?.actorSource === TRIGGER_SOURCE && TRIGGER_KINDS.includes(event.kind);

// Whether the event asks the agent something. finished/unassigned and other
// kinds don't, and neither does anything the agent did itself. A trigger may
// have no actor: an integration or a merge caused it.
export const isRequest = (event, selfId) =>
  Object.values(EVENT_KINDS).includes(event?.kind) &&
  (isTriggerEvent(event) || Boolean(event.actorId)) &&
  event.actorId !== selfId &&
  Boolean(event.taskId);

// Who OpenClaw's ingress sees as the sender, and the gates it applies. A
// trigger is from OnePM, so no allowlist or mention gate stands in its way.
export const ingressPolicy = (account, event) =>
  isTriggerEvent(event)
    ? {
        senderId: TRIGGER_SENDER_ID,
        allowFrom: [ALLOW_EVERYONE],
        requireMention: false,
      }
    : {
        senderId: event.actorId,
        allowFrom: account.allowFrom,
        requireMention: account.requireMention,
      };

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
  isTriggerEvent(event) ||
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

const statusLines = (event, actorName) => {
  const { from, to } = event.status ?? {};
  const target = to ?? "another status";
  const route = from ? `from ${from} to ${target}` : `to ${target}`;
  return [actorName ? `${actorName} moved it ${route}.` : `It moved ${route}.`];
};

const pullRequestLines = ({ pullRequest }) => {
  if (!pullRequest) return ["A linked pull request changed."];
  const where = pullRequest.repository ? ` (${pullRequest.repository})` : "";
  const what =
    PULL_REQUEST_ACTION_TEXT[pullRequest.action] ?? pullRequest.action;
  return [
    `Pull request #${pullRequest.number}${where} ${what}${pullRequest.title ? `: ${pullRequest.title}` : "."}`,
    pullRequest.url,
    ...(pullRequest.branch ? [`Branch: ${pullRequest.branch}`] : []),
  ].filter(Boolean);
};

const linesOf = (event, details) => {
  if (event.kind === EVENT_KINDS.status) {
    return statusLines(event, details.actorName);
  }
  if (event.kind === EVENT_KINDS.pullRequest) return pullRequestLines(event);
  const who = details.actorName || event.actorId || "Someone";
  const text = readableText(details.text);
  return [
    `${who} ${ACTION_BY_KIND[event.kind] ?? event.kind}${text ? ":" : "."}`,
    ...(text ? ["", text] : []),
  ];
};

// details: { taskKey, taskTitle, actorName, text } as far as they're known.
// Status and pull request events also carry `status` or `pullRequest`.
// Returns the message body OpenClaw gives the agent, plus the facts its
// context needs.
export const formatEvent = (event, details) => {
  const label = taskLabel(event, details);
  const body = [label, ...linesOf(event, details)].join("\n");
  const createdAt = Date.parse(event.createdAt ?? "");
  const trigger = isTriggerEvent(event);
  return {
    body,
    chatId: event.taskId,
    chatLabel: label,
    senderId: trigger ? TRIGGER_SENDER_ID : event.actorId,
    senderName: trigger ? TRIGGER_SENDER_NAME : details.actorName || null,
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
