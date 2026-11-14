import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CURSOR_FILE_NAME,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
} from "../constants/onepm.mjs";

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

// The last event handled, kept in `dir`. It belongs to one agent on one
// server: a cursor written for another key or URL is ignored, so a new key
// starts from now instead of skipping or replaying events.
export const createCursorFile = (dir, owner) => {
  const path = join(dir, CURSOR_FILE_NAME);
  return {
    path,
    read: () => {
      const value = readJson(path);
      if (!value || value.url !== owner.url || value.agentId !== owner.agentId)
        return null;
      return Number.isInteger(value.sequence) ? value.sequence : null;
    },
    write: (sequence) => {
      mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ ...owner, sequence }), {
        mode: PRIVATE_FILE_MODE,
      });
      chmodSync(temporary, PRIVATE_FILE_MODE);
      renameSync(temporary, path);
    },
  };
};
