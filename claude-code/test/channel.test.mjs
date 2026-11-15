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
});
