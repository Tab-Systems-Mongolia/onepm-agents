import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUSY_WORKING_MAX_MS } from "../src/constants/onepm.mjs";
import { createStatusBusy } from "../src/services/statusBusy.mjs";

const setup = (finalStatuses = ["done"]) => {
  const calls = [];
  const busy = {
    start: (taskId, capMs) => calls.push(["start", taskId, capMs]),
    stop: (taskId) => calls.push(["stop", taskId]),
  };
  const statusBusy = createStatusBusy({
    busy,
    finalStatuses: () => finalStatuses,
  });
  return { calls, statusBusy };
};

const ok = { content: [{ type: "text", text: "{}" }] };

describe("createStatusBusy", () => {
  it("marks a task busy when the agent moves it to a status that isn't final", () => {
    const { calls, statusBusy } = setup();

    statusBusy.observe(
      "update_task_status",
      { taskId: "t1", status: "in-progress" },
      ok,
    );

    assert.deepEqual(calls, [["start", "t1", BUSY_WORKING_MAX_MS]]);
  });

  it("clears the mark when the agent moves it to a final status", () => {
    const { calls, statusBusy } = setup();

    statusBusy.observe("update_task", { taskId: "t1", status: "done" }, ok);

    assert.deepEqual(calls, [["stop", "t1"]]);
  });

  it("leaves the mark alone for other tools, other fields and failed calls", () => {
    const { calls, statusBusy } = setup();

    statusBusy.observe("create_task_comment", { taskId: "t1" }, ok);
    statusBusy.observe("update_task", { taskId: "t1", title: "New" }, ok);
    statusBusy.observe(
      "update_task_status",
      { taskId: "t1", status: "in-progress" },
      { ...ok, isError: true },
    );
    statusBusy.observe(
      "update_task_status",
      { taskId: "t1", status: "done" },
      null,
    );

    assert.deepEqual(calls, []);
  });

  it("does nothing when the project's statuses couldn't be read", () => {
    const { calls, statusBusy } = setup(null);

    statusBusy.observe(
      "update_task_status",
      { taskId: "t1", status: "done" },
      ok,
    );

    assert.deepEqual(calls, []);
  });
});
