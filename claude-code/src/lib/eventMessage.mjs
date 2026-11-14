import {
  EVENT_KINDS,
  PULL_REQUEST_ACTION_TEXT,
  TRIGGER_SENDER,
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

const ACTION_BY_KIND = {
  [EVENT_KINDS.mention]: "mentioned you",
  [EVENT_KINDS.assignment]: "assigned this task to you",
  [EVENT_KINDS.comment]: "commented",
};

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

const linesOf = (event, details, who) => {
  if (event.kind === EVENT_KINDS.status) {
    return statusLines(event, details.actorName);
  }
  if (event.kind === EVENT_KINDS.pullRequest) return pullRequestLines(event);
  const text = readableText(details.text);
  return [
    `${who} ${ACTION_BY_KIND[event.kind] ?? event.kind}${text ? ":" : "."}`,
    ...(text ? ["", text] : []),
  ];
};

const senderOf = (event, details) =>
  details.actorName ||
  event.actorId ||
  (event.kind === EVENT_KINDS.status || event.kind === EVENT_KINDS.pullRequest
    ? TRIGGER_SENDER
    : "Someone");

// details: { taskKey, taskTitle, actorName, text } as far as they're known.
// Status and pull request events also carry `status` or `pullRequest`.
export const formatEvent = (event, details) => {
  const who = senderOf(event, details);
  const task =
    [details.taskKey && `[${details.taskKey}]`, details.taskTitle]
      .filter(Boolean)
      .join(" ") || `Task ${event.taskId}`;
  const content = [task, ...linesOf(event, details, who)].join("\n");
  const meta = {
    chat_id: event.taskId,
    user: who,
    user_id: event.actorId ?? "",
    kind: event.kind,
    task_key: details.taskKey ?? "",
    event_id: event.id,
    ...(event.createdAt ? { ts: String(event.createdAt) } : {}),
  };
  return {
    content,
    meta: Object.fromEntries(
      Object.entries(meta).filter(([, value]) => value !== ""),
    ),
  };
};

const commentLine = (comment) => {
  const author = comment.user?.name ?? comment.userId ?? "Someone";
  const when = comment.createdAt ? ` (${comment.createdAt})` : "";
  return `- ${author}${when}:\n${readableText(comment.content)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}`;
};

export const formatTask = ({ task, taskKey, comments }) =>
  [
    `${taskKey ? `[${taskKey}] ` : ""}${task.title}`,
    `Status: ${task.status ?? "unknown"}${task.priority ? `, priority: ${task.priority}` : ""}`,
    "",
    "Description:",
    readableText(task.description) || "(none)",
    "",
    comments.length > 0 ? "Recent comments, oldest first:" : "No comments.",
    ...comments.map(commentLine),
  ].join("\n");

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
