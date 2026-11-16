import { readdirSync } from "node:fs";
import { join } from "node:path";
import { START_COMMAND } from "../constants/channel.mjs";
import { STATE_DIR_PARTS } from "../constants/onepm.mjs";

// The agent profiles set up on this machine: one folder each.
export const listProfiles = (home, read = readdirSync) => {
  try {
    return read(join(home, ...STATE_DIR_PARTS), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

// What the session is told once when the channel can't connect. Claude Code
// drops channel notifications in sessions started without the channel flag,
// so only a session meant to be an agent sees it.
export const idleNotice = (reason, profiles) =>
  [
    `The OnePM channel is not connected, so this session receives no OnePM events. ${reason}`,
    `Start it with: ${START_COMMAND}`,
    profiles.length > 0
      ? `Agent profiles on this machine: ${profiles.join(", ")}.`
      : "No agent profile is set up on this machine yet: run /onepm:configure <agent key> <name>.",
  ].join("\n");
