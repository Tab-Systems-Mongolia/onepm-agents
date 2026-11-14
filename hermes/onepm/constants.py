"""Fixed values shared by the OnePM adapter's modules."""

PLATFORM_NAME = "onepm"
PLATFORM_LABEL = "OnePM"

URL_ENV = "ONEPM_URL"
# The hosted OnePM. ONEPM_URL is only needed for a self-hosted instance.
DEFAULT_URL = "https://onepm.tabsystems.tech"
KEY_ENV = "ONEPM_AGENT_KEY"
ALLOWED_USERS_ENV = "ONEPM_ALLOWED_USERS"
ALLOW_ALL_ENV = "ONEPM_ALLOW_ALL_USERS"

KEY_HEADER = "x-api-key"
SOCKET_PATH = "/api/ws/agent"

# Event kinds that ask the agent something. finished/unassigned only free
# worktrees, and the server leaves them out unless asked with include=release.
REQUEST_KINDS = frozenset({"mention", "assignment", "comment", "status", "pull_request"})
AGENT_ACTOR_SOURCE = "agent"
# status and pull_request come from triggers a project admin set on tasks
# assigned to the agent. OnePM sends them, not a person, so no allowlist
# applies: they reach Hermes as from OnePM itself, vouched for by the adapter.
TRIGGER_KINDS = frozenset({"status", "pull_request"})
TRIGGER_ACTOR_SOURCE = "trigger"
TRIGGER_SENDER_ID = "onepm"
TRIGGER_SENDER_NAME = "OnePM"
PULL_REQUEST_ACTION_TEXT = {
    "opened": "was opened",
    "merged": "was merged",
    "closed": "was closed without merging",
}

# Socket messages from the server.
AGENT_EVENT_MESSAGE = "AGENT_EVENT"
CONNECTION_REPLACED_MESSAGE = "AGENT_CONNECTION_REPLACED"
REPLACED_CLOSE_CODE = 4409
SOCKET_KEEPALIVE_MESSAGE = '{"type":"ping"}'
SOCKET_PING_SECONDS = 30.0
# Read the events now and then even without a wake, in case one was missed.
SOCKET_WAKE_SECONDS = 180.0

RECONNECT_MIN_SECONDS = 1.0
RECONNECT_MAX_SECONDS = 60.0
RECONNECT_JITTER = 0.25
# A socket that stayed open this long resets the backoff.
RECONNECT_STABLE_SECONDS = 30.0

DRAIN_RETRY_SECONDS = 15.0
HTTP_TIMEOUT_SECONDS = 30.0
RATE_LIMITED_STATUS = 429
UNAUTHORIZED_STATUSES = frozenset({401, 403})

# createCommentBody caps content at 10,000 characters.
MAX_COMMENT_LENGTH = 10_000

CURSOR_DIR = "onepm"
CURSOR_FILE = "cursor.json"
DEDUP_SIZE = 2000
DEDUP_TTL_SECONDS = 3600.0

REDACTED = "[redacted]"
MIN_MASKED_VALUE_LENGTH = 6

# Comments come from the editor as HTML with mention tags; these turn it into
# the plain text the agent reads.
MENTION_TAG_PATTERN = r"<kaneo-mention\b([^>]*)>([\s\S]*?)</kaneo-mention>"
LABEL_ATTRIBUTE_PATTERN = r'\blabel="([^"]*)"'
LINE_BREAK_TAG_PATTERN = r"<br\s*/?>|</(?:p|div|li|h[1-6]|blockquote|pre)>"
ANY_TAG_PATTERN = r"<[^>]+>"
ENTITY_PATTERN = r"&(?:amp|lt|gt|quot|#39|nbsp);"
ENTITIES = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " "}
EXTRA_BLANK_LINES_PATTERN = r"\n{3,}"
UNNAMED_MENTION = "@someone"

# Hermes prompts the first chat to become the "home channel" (where cron
# results go) unless one is set. On OnePM that chat is a public task, so the
# plugin sets this placeholder, and send() never posts to it.
HOME_CHANNEL_ENV = "ONEPM_HOME_CHANNEL"
NO_HOME_CHANNEL = "off"
