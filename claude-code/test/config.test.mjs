import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  normalizeBaseUrl,
  parseEnvFile,
  resolveConfig,
} from "../src/lib/config.mjs";
import { DEFAULT_ONEPM_URL } from "../src/constants/onepm.mjs";
import { createStateFiles } from "../src/services/stateFiles.mjs";

describe("parseEnvFile", () => {
  it("reads KEY=value lines and skips the rest", () => {
    assert.deepEqual(
      parseEnvFile(
        "# comment\nONEPM_URL=https://pm.example.com\r\nexport ONEPM_AGENT_KEY='opm_abc'\n\nnot a line\nEMPTY=\n",
      ),
      {
        ONEPM_URL: "https://pm.example.com",
        ONEPM_AGENT_KEY: "opm_abc",
        EMPTY: "",
      },
    );
  });
});

describe("normalizeBaseUrl", () => {
  it("drops a trailing slash and /api", () => {
    assert.equal(
      normalizeBaseUrl("https://pm.example.com/"),
      "https://pm.example.com",
    );
    assert.equal(
      normalizeBaseUrl("https://pm.example.com/api/"),
      "https://pm.example.com",
    );
    assert.equal(
      normalizeBaseUrl("http://localhost:1337/onepm"),
      "http://localhost:1337/onepm",
    );
  });

  it("refuses non-http URLs", () => {
    assert.throws(() => normalizeBaseUrl("ftp://pm.example.com"));
    assert.throws(() => normalizeBaseUrl("not a url"));
  });
});

describe("resolveConfig", () => {
  const file = {
    ONEPM_URL: "https://file.example.com",
    ONEPM_AGENT_KEY: "file-key",
  };

  it("prefers the shell environment over .env", () => {
    assert.deepEqual(resolveConfig({ ONEPM_AGENT_KEY: "shell-key" }, file), {
      ok: true,
      baseUrl: "https://file.example.com",
      apiKey: "shell-key",
    });
  });

  it("uses the hosted OnePM when no URL is set", () => {
    assert.deepEqual(resolveConfig({}, { ONEPM_AGENT_KEY: "file-key" }), {
      ok: true,
      baseUrl: DEFAULT_ONEPM_URL,
      apiKey: "file-key",
    });
    assert.equal(DEFAULT_ONEPM_URL, "https://onepm.tabsystems.tech");
  });

  it("names what is missing", () => {
    assert.deepEqual(resolveConfig({}, {}), {
      ok: false,
      error: "missing ONEPM_AGENT_KEY",
    });
    assert.deepEqual(
      resolveConfig({}, { ONEPM_URL: "https://x.example.com" }),
      {
        ok: false,
        error: "missing ONEPM_AGENT_KEY",
      },
    );
  });

  it("reports a bad URL", () => {
    const resolved = resolveConfig(
      {},
      { ONEPM_URL: "nope", ONEPM_AGENT_KEY: "k" },
    );
    assert.equal(resolved.ok, false);
  });
});

describe("createStateFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "onepm-channel-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const state = createStateFiles(dir);
  const owner = { url: "https://pm.example.com", agentId: "agent-1" };

  it("reads .env and locks it to the owner", () => {
    writeFileSync(state.envPath, "ONEPM_URL=https://pm.example.com\n", {
      mode: 0o644,
    });
    assert.deepEqual(state.readEnvValues(), {
      ONEPM_URL: "https://pm.example.com",
    });
    if (process.platform !== "win32")
      assert.equal(statSync(state.envPath).mode & 0o777, 0o600);
  });

  it("treats a missing or broken access.json as nobody allowed", () => {
    assert.deepEqual(state.loadAccess(), {
      allowFrom: [],
      requireMention: true,
    });
    writeFileSync(state.accessPath, "{ broken");
    assert.deepEqual(state.loadAccess(), {
      allowFrom: [],
      requireMention: true,
    });
    writeFileSync(
      state.accessPath,
      JSON.stringify({ allowFrom: ["u1"], requireMention: false }),
    );
    assert.deepEqual(state.loadAccess(), {
      allowFrom: ["u1"],
      requireMention: false,
    });
  });

  it("keeps the cursor per server and agent", () => {
    assert.equal(state.readCursor(owner), null);
    state.writeCursor(owner, 42);
    assert.equal(state.readCursor(owner), 42);
    assert.equal(state.readCursor({ ...owner, agentId: "agent-2" }), null);
    assert.equal(
      JSON.parse(readFileSync(join(dir, "cursor.json"), "utf8")).sequence,
      42,
    );
  });

  it("keeps the latest dropped sender once", () => {
    state.recordDropped({ userId: "a", name: "A" });
    state.recordDropped({ userId: "b", name: "B" });
    state.recordDropped({ userId: "a", name: "A again" });
    const dropped = JSON.parse(readFileSync(join(dir, "dropped.json"), "utf8"));
    assert.deepEqual(
      dropped.map(({ userId, name }) => [userId, name]),
      [
        ["a", "A again"],
        ["b", "B"],
      ],
    );
  });
});
