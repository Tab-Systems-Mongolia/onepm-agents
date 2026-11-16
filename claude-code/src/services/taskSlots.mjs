import { TRIGGER_KINDS } from "../constants/onepm.mjs";

// How many tasks the session works on at once. A task holds a slot from its
// latest delivered message until the agent replies there, or until holdMs
// passes without a reply (a turn can end without one). A trigger notice (a
// status change or a pull request) asks for nothing, so it neither waits for
// a slot nor takes one: closing ten tasks mustn't hold real work for holdMs.
const isNotice = (kind) => TRIGGER_KINDS.includes(kind);

export const createTaskSlots = ({ max, holdMs, now = Date.now }) => {
  const heldUntil = new Map();

  const expire = () => {
    const time = now();
    for (const [taskId, until] of heldUntil) {
      if (until <= time) heldUntil.delete(taskId);
    }
  };

  return {
    // More messages for a task already in hand always go through.
    admits: (taskId, kind) => {
      if (isNotice(kind)) return true;
      expire();
      return heldUntil.has(taskId) || heldUntil.size < max;
    },
    start: (taskId, kind) => {
      if (isNotice(kind)) return;
      heldUntil.set(taskId, now() + holdMs);
    },
    finish: (taskId) => {
      heldUntil.delete(taskId);
    },
    size: () => {
      expire();
      return heldUntil.size;
    },
  };
};
