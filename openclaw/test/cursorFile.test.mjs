import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createCursorFile } from "../src/services/cursorFile.mjs";

const dir = mkdtempSync(join(tmpdir(), "onepm-cursor-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("createCursorFile", () => {
  const owner = { url: "https://pm.example.test", agentId: "agent-1" };

  it("reads null before anything is written", () => {
    assert.equal(createCursorFile(join(dir, "empty"), owner).read(), null);
  });

  it("writes an owner-only file and reads it back", () => {
    const cursor = createCursorFile(join(dir, "state"), owner);
    cursor.write(42);
    assert.equal(cursor.read(), 42);
    assert.equal(statSync(cursor.path).mode & 0o777, 0o600);
  });

  it("ignores a cursor written for another agent or server", () => {
    const stateDir = join(dir, "shared");
    createCursorFile(stateDir, owner).write(7);
    assert.equal(
      createCursorFile(stateDir, { ...owner, agentId: "agent-2" }).read(),
      null,
    );
    assert.equal(
      createCursorFile(stateDir, {
        ...owner,
        url: "https://other.test",
      }).read(),
      null,
    );
  });
});
