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
// The API caps a comment at this many characters.
export const COMMENT_MAX_LENGTH = 10_000;

// Event kinds that ask the agent something. finished/unassigned only free
// worktrees, and the server leaves them out unless asked with include=release.
export const EVENT_KINDS = {
  mention: "mention",
  assignment: "assignment",
  comment: "comment",
};
