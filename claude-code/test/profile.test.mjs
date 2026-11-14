import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveProfile, unconfiguredMessage } from "../src/lib/profile.mjs";

const home = "/home/owner";
const profilesDir = join(home, ".claude", "channels", "onepm");

describe("resolveProfile", () => {
  it("uses the profile named by ONEPM_AGENT", () => {
    assert.deepEqual(resolveProfile({ ONEPM_AGENT: "claudeagent" }, home), {
      active: true,
      name: "claudeagent",
      dir: join(profilesDir, "claudeagent"),
    });
  });

  it("trims the name", () => {
    assert.equal(
      resolveProfile({ ONEPM_AGENT: "  review-bot_2 \n" }, home).dir,
      join(profilesDir, "review-bot_2"),
    );
  });

  it("keeps ONEPM_STATE_DIR working, ahead of the profile directory", () => {
    assert.deepEqual(resolveProfile({ ONEPM_STATE_DIR: "/srv/onepm" }, home), {
      active: true,
      name: null,
      dir: "/srv/onepm",
    });
    assert.deepEqual(
      resolveProfile(
        { ONEPM_STATE_DIR: "/srv/onepm", ONEPM_AGENT: "claudeagent" },
        home,
      ),
      { active: true, name: "claudeagent", dir: "/srv/onepm" },
    );
  });

  it("stays idle in a session started without a profile", () => {
    for (const env of [{}, { ONEPM_AGENT: "" }, { ONEPM_AGENT: "  " }]) {
      const profile = resolveProfile(env, home);
      assert.equal(profile.active, false);
      assert.match(
        profile.message,
        /OnePM channel isn't active in this session: start Claude Code with ONEPM_AGENT=<name> claude --dangerously-load-development-channels plugin:onepm@onepm/,
      );
    }
  });

  it("refuses a name that isn't a plain directory name", () => {
    for (const name of [
      "../escape",
      "a/b",
      "ClaudeAgent",
      "has space",
      ".",
      "a".repeat(41),
    ]) {
      const profile = resolveProfile({ ONEPM_AGENT: name }, home);
      assert.equal(profile.active, false, name);
      assert.match(profile.message, /ONEPM_AGENT must be/, name);
    }
    assert.equal(
      resolveProfile({ ONEPM_AGENT: "a".repeat(40) }, home).active,
      true,
    );
  });
});

describe("unconfiguredMessage", () => {
  it("names the configure command for the profile", () => {
    const message = unconfiguredMessage({
      name: "claudeagent",
      envPath: "/x/.env",
      error: "missing ONEPM_AGENT_KEY",
    });
    assert.match(message, /missing ONEPM_AGENT_KEY/);
    assert.match(message, /\/x\/\.env/);
    assert.match(message, /\/onepm:configure <agent key> claudeagent/);
  });

  it("leaves the name out for a state directory without a profile", () => {
    assert.match(
      unconfiguredMessage({ name: null, envPath: "/x/.env", error: "e" }),
      /\/onepm:configure <agent key>[^ ]/,
    );
  });
});
