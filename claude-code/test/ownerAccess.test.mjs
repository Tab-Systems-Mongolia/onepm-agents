import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ownerAccess } from "../src/lib/access.mjs";
import { allowOwnerOnFirstStart } from "../src/services/ownerAccess.mjs";
import { createStateFiles } from "../src/services/stateFiles.mjs";

const self = { id: "agent-1", ownerId: "owner-1", handle: "claudeagent" };

describe("ownerAccess", () => {
  it("allows only the owner, with mentions required", () => {
    assert.deepEqual(ownerAccess(self), {
      allowFrom: ["owner-1"],
      requireMention: true,
    });
  });

  it("is null when the server didn't name an owner", () => {
    assert.equal(ownerAccess({ id: "agent-1" }), null);
    assert.equal(ownerAccess({ id: "agent-1", ownerId: "  " }), null);
    assert.equal(ownerAccess({ id: "agent-1", ownerId: 42 }), null);
    assert.equal(ownerAccess(null), null);
  });

  it("never allows the agent itself", () => {
    assert.equal(ownerAccess({ id: "agent-1", ownerId: "agent-1" }), null);
  });
});

describe("allowOwnerOnFirstStart", () => {
  let root;
  let dir;
  let logs;
  const log = (message) => logs.push(message);
  const readAccess = () =>
    JSON.parse(readFileSync(join(dir, "access.json"), "utf8"));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "onepm-owner-"));
    dir = join(root, "profile");
    logs = [];
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates access.json with the owner when it doesn't exist", () => {
    const state = createStateFiles(dir, log);

    assert.equal(allowOwnerOnFirstStart({ state, self, log }), true);
    assert.deepEqual(readAccess(), {
      allowFrom: ["owner-1"],
      requireMention: true,
    });
    assert.deepEqual(state.loadAccess().allowFrom, ["owner-1"]);
    assert.match(logs.join("\n"), /allowed the agent's owner \(owner-1\)/);
  });

  it("never touches an existing access.json, even an emptied one", () => {
    const state = createStateFiles(dir, log);
    state.createAccessIfMissing({ allowFrom: [], requireMention: false });

    assert.equal(allowOwnerOnFirstStart({ state, self, log }), false);
    assert.deepEqual(readAccess(), { allowFrom: [], requireMention: false });
    assert.deepEqual(logs, []);
  });

  it("keeps an existing list as it is", () => {
    const state = createStateFiles(dir, log);
    state.createAccessIfMissing({
      allowFrom: ["user-2"],
      requireMention: true,
    });

    allowOwnerOnFirstStart({ state, self, log });

    assert.deepEqual(readAccess().allowFrom, ["user-2"]);
  });

  it("leaves an invalid access.json alone", () => {
    const state = createStateFiles(dir, log);
    state.createAccessIfMissing({});
    writeFileSync(join(dir, "access.json"), "{not json");

    assert.equal(allowOwnerOnFirstStart({ state, self, log }), false);
    assert.equal(readFileSync(join(dir, "access.json"), "utf8"), "{not json");
  });

  it("writes nothing and says so when an older server sends no owner", () => {
    const state = createStateFiles(dir, log);

    assert.equal(
      allowOwnerOnFirstStart({
        state,
        self: { id: "agent-1", handle: "claudeagent" },
        log,
      }),
      false,
    );
    assert.equal(state.hasAccessFile(), false);
    assert.match(logs.join("\n"), /didn't say who owns this agent/);
  });

  it("logs and carries on when the file can't be written", () => {
    const state = {
      accessPath: "/x/access.json",
      hasAccessFile: () => false,
      createAccessIfMissing: () => {
        throw new Error("EACCES");
      },
    };

    assert.equal(allowOwnerOnFirstStart({ state, self, log }), false);
    assert.match(logs.join("\n"), /couldn't write \/x\/access\.json: EACCES/);
  });
});
