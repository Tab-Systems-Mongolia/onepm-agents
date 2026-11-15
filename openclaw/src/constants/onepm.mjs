// What the OnePM server expects from an agent connection, and what this
// channel calls itself inside OpenClaw.

export const CHANNEL_ID = "onepm";
export const CHANNEL_LABEL = "OnePM";
export const DEFAULT_ACCOUNT_ID = "default";

export const ENV_URL = "ONEPM_URL";
// The hosted OnePM. A URL is only needed for a self-hosted instance.
export const DEFAULT_ONEPM_URL = "https://onepm.tabsystems.tech";
export const ENV_AGENT_KEY = "ONEPM_AGENT_KEY";

// Targets the message tool and cron may name: "onepm:task:<id>",
// "task:<id>" or the bare task id.
export const TARGET_PREFIXES = ["onepm:", "task:"];
export const TASK_TARGET_PREFIX = "task:";

export const STATE_SUBDIR = "onepm";
export const CURSOR_FILE_NAME = "cursor.json";
export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;

export const API_KEY_HEADER = "x-api-key";
export const AGENT_SOCKET_PATH = "/api/ws/agent";
export const AGENT_EVENT_MESSAGE = "AGENT_EVENT";
// The server closes an older connection with this code when a newer one
// takes over the same agent key (it also broadcasts AGENT_CONNECTION_REPLACED,
// which the new connection gets too, so the code is what counts).
export const AGENT_REPLACED_CLOSE_CODE = 4409;
export const SOCKET_KEEPALIVE_MESSAGE = '{"type":"ping"}';
export const SOCKET_KEEPALIVE_MS = 30_000;
export const RECONNECT_MIN_MS = 5000;
export const RECONNECT_MAX_MS = 60_000;
// Events are read again on this interval in case a wake ping was missed.
export const POLL_MS = 120_000;
export const SELF_RETRY_MS = 15_000;

export const RATE_LIMITED_STATUS = 429;
export const NOT_FOUND_STATUS = 404;
// While OpenClaw works on a turn, OnePM shows the agent replying on the task.
// The server forgets it 30 seconds after the last call, so OpenClaw's typing
// keepalive refreshes it more often, for at most BUSY_MAX_MS.
export const BUSY_REFRESH_MS = 15_000;
export const BUSY_MAX_MS = 600_000;
// The API caps a comment at this many characters.
export const COMMENT_MAX_LENGTH = 10_000;

// Event kinds that ask the agent something. finished/unassigned only free
// worktrees, and the server leaves them out unless asked with include=release.
export const EVENT_KINDS = {
  mention: "mention",
  assignment: "assignment",
  comment: "comment",
  status: "status",
  pullRequest: "pull_request",
};
// Kinds OnePM sends when a trigger an admin set fires on a task assigned to
// the agent. They come from OnePM, not a person: OpenClaw sees them as from
// OnePM itself, past the allowlist and the mention gate.
export const TRIGGER_KINDS = [EVENT_KINDS.status, EVENT_KINDS.pullRequest];
export const TRIGGER_SOURCE = "trigger";
// Given to the agent with every OnePM message, as the group's prompt.
export const REPLY_INSTRUCTIONS =
  'To mention someone in a reply, write <kaneo-mention id="<user id>" label="<name>">@<name></kaneo-mention>; the sender\'s id is the message\'s user_id, others come from list_workspace_members.';
// An event an agent caused with its own key. OnePM names the agent as the
// actor and sets actorKind; older servers named its owner instead.
export const AGENT_ACTOR_SOURCE = "agent";
export const PERSON_ACTOR_KIND = "person";
export const TRIGGER_SENDER_ID = "onepm";
export const TRIGGER_SENDER_NAME = "OnePM";
export const ALLOW_EVERYONE = "*";
export const PULL_REQUEST_ACTION_TEXT = {
  opened: "was opened",
  merged: "was merged",
  closed: "was closed without merging",
};
