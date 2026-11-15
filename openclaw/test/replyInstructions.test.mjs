import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REPLY_INSTRUCTIONS } from "../src/constants/onepm.mjs";

describe("REPLY_INSTRUCTIONS", () => {
  it("says how to mention someone in a reply", () => {
    assert.equal(
      REPLY_INSTRUCTIONS,
      'To mention someone in a reply, write <kaneo-mention id="<user id>" label="<name>">@<name></kaneo-mention>; the sender\'s id is the message\'s user_id, others come from list_workspace_members.',
    );
  });
});
