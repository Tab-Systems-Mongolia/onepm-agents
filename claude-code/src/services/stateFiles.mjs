import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ACCESS_FILE_NAME,
  CURSOR_FILE_NAME,
  DROPPED_FILE_NAME,
  DROPPED_KEEP,
  ENV_FILE_NAME,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
} from "../constants/onepm.mjs";
import { normalizeAccess } from "../lib/access.mjs";
import { parseEnvFile } from "../lib/config.mjs";

const isMissing = (error) => error?.code === "ENOENT";

const readJson = (path) => {
  try {
    return { found: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    if (isMissing(error)) return { found: false, value: null };
    return { found: true, value: null, error };
  }
};

const writePrivateJson = (dir, path, value) => {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: PRIVATE_FILE_MODE,
  });
  renameSync(temporary, path);
};

// The files in one agent profile's directory (see resolveProfile).
export const createStateFiles = (dir, log = () => {}) => {
  const envPath = join(dir, ENV_FILE_NAME);
  const accessPath = join(dir, ACCESS_FILE_NAME);
  const cursorPath = join(dir, CURSOR_FILE_NAME);
  const droppedPath = join(dir, DROPPED_FILE_NAME);

  return {
    dir,
    envPath,
    accessPath,

    // The key is a credential: keep the file owner-only. No-op on Windows.
    readEnvValues: () => {
      try {
        chmodSync(envPath, PRIVATE_FILE_MODE);
        return parseEnvFile(readFileSync(envPath, "utf8"));
      } catch (error) {
        if (!isMissing(error))
          log(`couldn't read ${envPath}: ${error.message}`);
        return {};
      }
    },

    // Read for every event, so /onepm:access applies without a restart.
    loadAccess: () => {
      const { value, error } = readJson(accessPath);
      if (error)
        log(
          `${accessPath} isn't valid JSON; dropping every event until it is fixed`,
        );
      return normalizeAccess(value);
    },

    // The cursor belongs to one agent on one server; another key starts over.
    readCursor: (owner) => {
      const { value } = readJson(cursorPath);
      if (!value || value.url !== owner.url || value.agentId !== owner.agentId)
        return null;
      return Number.isInteger(value.sequence) ? value.sequence : null;
    },
    writeCursor: (owner, sequence) =>
      writePrivateJson(dir, cursorPath, { ...owner, sequence }),

    // The last senders who were dropped, so the owner can find a person's id
    // for /onepm:access without a pairing code posted on a task.
    recordDropped: (entry) => {
      const { value } = readJson(droppedPath);
      const earlier = Array.isArray(value) ? value : [];
      const kept = [
        entry,
        ...earlier.filter((item) => item?.userId !== entry.userId),
      ].slice(0, DROPPED_KEEP);
      writePrivateJson(dir, droppedPath, kept);
    },
  };
};
