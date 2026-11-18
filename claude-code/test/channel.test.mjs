import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SERVER_INSTRUCTIONS } from "../src/constants/channel.mjs";

describe("SERVER_INSTRUCTIONS", () => {
  it("says how to mention someone in a reply", () => {
    assert.ok(
      SERVER_INSTRUCTIONS.includes(
        'To mention someone in a reply, write <kaneo-mention id="<user id>" label="<name>">@<name></kaneo-mention>; the sender\'s id is the message\'s user_id, others come from list_workspace_members.',
      ),
    );
  });

  it("asks for new tasks to go into the active sprint with story points", () => {
    assert.ok(
      SERVER_INSTRUCTIONS.includes(
        "When you create a task in a project with an active sprint, put it in that sprint and give it story points unless you're told otherwise",
      ),
    );
  });

  it("asks the agent to assign itself the tasks it will work on", () => {
    assert.ok(
      SERVER_INSTRUCTIONS.includes(
        "When you create a task you're going to work on yourself, assign it to yourself",
      ),
    );
  });
});
