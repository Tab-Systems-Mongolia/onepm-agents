import { STATUS_TOOL_NAMES } from "../constants/channel.mjs";
import { BUSY_WORKING_MAX_MS } from "../constants/onepm.mjs";

// The busy mark follows what the agent does, so it needn't remember
// set_working: moving a task into a status that isn't final means it works on
// it; moving it into a final one means it's done there. Without the project's
// statuses it can't tell which is which, and leaves the mark alone.
export const createStatusBusy = ({ busy, finalStatuses }) => ({
  observe: (name, args, result) => {
    if (!result || result.isError) return;
    if (!STATUS_TOOL_NAMES.includes(name)) return;
    const { taskId, status } = args ?? {};
    if (typeof taskId !== "string" || typeof status !== "string") return;
    const finals = finalStatuses();
    if (!finals) return;
    if (finals.includes(status)) busy.stop(taskId);
    else busy.start(taskId, BUSY_WORKING_MAX_MS);
  },
});
