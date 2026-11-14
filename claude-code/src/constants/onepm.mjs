// What the OnePM server expects from an agent connection.

export const ENV_URL = "ONEPM_URL";
// The hosted OnePM. ONEPM_URL is only needed for a self-hosted instance.
export const DEFAULT_ONEPM_URL = "https://onepm.tabsystems.tech";
export const ENV_AGENT_KEY = "ONEPM_AGENT_KEY";
export const ENV_STATE_DIR = "ONEPM_STATE_DIR";
// The agent profile a session runs as. Without it (or ONEPM_STATE_DIR) the
// plugin stays idle, so ordinary sessions don't take over the agent.
export const ENV_AGENT_PROFILE = "ONEPM_AGENT";
// A profile name is a directory name: an agent's OnePM handle fits.
export const PROFILE_NAME_PATTERN = /^[a-z0-9_-]{1,40}$/;

// Each profile keeps its state in a directory of its own under this one.
export const STATE_DIR_PARTS = [".claude", "channels", "onepm"];
export const ENV_FILE_NAME = ".env";
export const ACCESS_FILE_NAME = "access.json";
export const CURSOR_FILE_NAME = "cursor.json";
export const DROPPED_FILE_NAME = "dropped.json";
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
export const COMMENT_MAX_LENGTH = 10_000;
export const RECENT_COMMENTS = 20;
export const DROPPED_KEEP = 20;

export const EVENT_KINDS = {
  mention: "mention",
  assignment: "assignment",
  comment: "comment",
};
