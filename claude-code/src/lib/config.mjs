import {
  DEFAULT_ONEPM_URL,
  ENV_AGENT_KEY,
  ENV_URL,
} from "../constants/onepm.mjs";

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/;
const QUOTED = /^(["'])(.*)\1$/;

// KEY=value lines; comments, blanks and anything else are skipped.
export const parseEnvFile = (text) => {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = ENV_LINE.exec(line);
    if (match) values[match[1]] = match[2].replace(QUOTED, "$2");
  }
  return values;
};

// "https://pm.example.com/", ".../api" and ".../api/" all mean the same server.
export const normalizeBaseUrl = (raw) => {
  const url = new URL(raw.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${ENV_URL} must be an http(s) URL`);
  }
  return `${url.origin}${url.pathname}`
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
};

// The shell's environment wins over the .env file, as in Claude's own
// channel plugins.
export const resolveConfig = (shellEnv, fileValues) => {
  // An empty shell variable doesn't hide the file's value.
  const pick = (name) =>
    shellEnv[name]?.trim() || fileValues[name]?.trim() || "";
  const rawUrl = pick(ENV_URL) || DEFAULT_ONEPM_URL;
  const apiKey = pick(ENV_AGENT_KEY);
  if (!apiKey) return { ok: false, error: `missing ${ENV_AGENT_KEY}` };
  try {
    return { ok: true, baseUrl: normalizeBaseUrl(rawUrl), apiKey };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
