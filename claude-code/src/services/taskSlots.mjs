// How many tasks the session works on at once. A task holds a slot from its
// latest delivered message until the agent replies there, or until holdMs
// passes without a reply (a turn can end without one).
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
    admits: (taskId) => {
      expire();
      return heldUntil.has(taskId) || heldUntil.size < max;
    },
    start: (taskId) => {
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
