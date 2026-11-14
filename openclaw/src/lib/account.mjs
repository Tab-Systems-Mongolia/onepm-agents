import {
  CHANNEL_ID,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ONEPM_URL,
  ENV_AGENT_KEY,
  ENV_URL,
  TARGET_PREFIXES,
  TASK_TARGET_PREFIX,
} from "../constants/onepm.mjs";

const text = (value) => (typeof value === "string" ? value.trim() : "");

const sectionOf = (cfg) => {
  const section = cfg?.channels?.[CHANNEL_ID];
  return typeof section === "object" && section !== null ? section : {};
};

const stripPrefixes = (raw) => {
  let value = text(raw);
  for (const prefix of TARGET_PREFIXES) {
    if (value.toLowerCase().startsWith(prefix)) {
      value = value.slice(prefix.length).trim();
    }
  }
  return value;
};

export const normalizeAllowEntry = (entry) =>
  stripPrefixes(String(entry ?? ""));

// OnePM user ids, as written in channels.onepm.allowFrom. Anything else is
// dropped, so a malformed list allows nobody rather than everybody.
export const normalizeAllowFrom = (raw) =>
  Array.isArray(raw)
    ? raw
        .filter((id) => typeof id === "string" || typeof id === "number")
        .map(normalizeAllowEntry)
        .filter(Boolean)
    : [];

// One account per OpenClaw: the URL and key come from channels.onepm, or
// from ONEPM_URL / ONEPM_AGENT_KEY when the config leaves them out. Without
// any URL the account uses the hosted OnePM.
export const resolveOnepmAccount = (cfg, env = process.env) => {
  const section = sectionOf(cfg);
  const configUrl = text(section.url);
  const configKey = text(section.agentKey);
  const baseUrl = (
    configUrl ||
    text(env[ENV_URL]) ||
    DEFAULT_ONEPM_URL
  ).replace(/\/+$/, "");
  const apiKey = configKey || text(env[ENV_AGENT_KEY]);
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    name: text(section.name) || null,
    enabled: section.enabled !== false,
    configured: Boolean(baseUrl && apiKey),
    baseUrl,
    apiKey,
    keySource: configKey ? "config" : apiKey ? "env" : "none",
    allowFrom: normalizeAllowFrom(section.allowFrom),
    requireMention: section.requireMention !== false,
  };
};

// What diagnostics may show: never the key itself.
export const describeOnepmAccount = (account) => ({
  accountId: account.accountId,
  name: account.name ?? undefined,
  enabled: account.enabled,
  configured: account.configured,
  baseUrl: account.baseUrl || undefined,
  tokenStatus: account.apiKey ? "available" : "missing",
  tokenSource: account.keySource,
  allowFromCount: account.allowFrom.length,
  requireMention: account.requireMention,
});

// "onepm:task:<id>", "task:<id>" or "<id>" → the task id.
export const normalizeTaskTarget = (raw) => {
  const value = stripPrefixes(raw);
  return value && !/\s/.test(value) ? value : undefined;
};

export const taskTarget = (taskId) => `${TASK_TARGET_PREFIX}${taskId}`;
