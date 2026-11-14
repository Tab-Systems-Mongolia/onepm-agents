import { join } from "node:path";
import { INACTIVE_MESSAGE } from "../constants/channel.mjs";
import {
  ENV_AGENT_PROFILE,
  ENV_STATE_DIR,
  PROFILE_NAME_PATTERN,
  STATE_DIR_PARTS,
} from "../constants/onepm.mjs";

// Which agent this session runs as, and where its state lives. Claude Code
// starts the plugin in every session, so only a session started with
// ONEPM_AGENT (or the older ONEPM_STATE_DIR) connects to OnePM.
export const resolveProfile = (env, home) => {
  const rawName = env[ENV_AGENT_PROFILE]?.trim() || "";
  const stateDir = env[ENV_STATE_DIR]?.trim() || "";
  if (rawName && !PROFILE_NAME_PATTERN.test(rawName)) {
    return {
      active: false,
      message: `${ENV_AGENT_PROFILE} must be 1-40 lowercase letters, digits, "-" or "_" (got "${rawName}"); the OnePM channel isn't active in this session.`,
    };
  }
  const name = rawName || null;
  if (stateDir) return { active: true, name, dir: stateDir };
  if (name)
    return { active: true, name, dir: join(home, ...STATE_DIR_PARTS, name) };
  return { active: false, message: INACTIVE_MESSAGE };
};

// Why a started profile can't connect, and the command that fixes it.
export const unconfiguredMessage = ({ name, envPath, error }) =>
  `OnePM agent ${name ? `"${name}" ` : ""}isn't configured (${error} in ${envPath}). ` +
  `Run /onepm:configure <agent key>${name ? ` ${name}` : ""}, then restart Claude Code.`;
