import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeOnepmAccount,
  normalizeAllowFrom,
  normalizeTaskTarget,
  resolveOnepmAccount,
} from "../src/lib/account.mjs";

const KEY = "opm_agent_secretvalue123";

describe("resolveOnepmAccount", () => {
  it("reads channels.onepm", () => {
    const account = resolveOnepmAccount(
      {
        channels: {
          onepm: {
            url: "https://pm.example.test/",
            agentKey: KEY,
            allowFrom: ["user-1", " onepm:user-2 ", 42, "", null],
          },
        },
      },
      {},
    );
    assert.equal(account.baseUrl, "https://pm.example.test");
    assert.equal(account.apiKey, KEY);
    assert.equal(account.keySource, "config");
    assert.equal(account.configured, true);
    assert.deepEqual(account.allowFrom, ["user-1", "user-2", "42"]);
    assert.equal(account.requireMention, true);
  });

  it("falls back to ONEPM_URL and ONEPM_AGENT_KEY", () => {
    const account = resolveOnepmAccount(
      {},
      { ONEPM_URL: "https://pm.example.test", ONEPM_AGENT_KEY: KEY },
    );
    assert.equal(account.configured, true);
    assert.equal(account.keySource, "env");
    assert.deepEqual(account.allowFrom, []);
  });

  it("uses the hosted OnePM when no URL is set", () => {
    const account = resolveOnepmAccount(
      { channels: { onepm: { agentKey: KEY } } },
      {},
    );
    assert.equal(account.baseUrl, "https://onepm.tabsystems.tech");
    assert.equal(account.configured, true);
  });

  it("is unconfigured without a key, and honours requireMention=false", () => {
    const account = resolveOnepmAccount(
      { channels: { onepm: { url: "https://x.test", requireMention: false } } },
      {},
    );
    assert.equal(account.configured, false);
    assert.equal(account.requireMention, false);
  });
});

describe("describeOnepmAccount", () => {
  it("never includes the key", () => {
    const account = resolveOnepmAccount(
      { channels: { onepm: { url: "https://x.test", agentKey: KEY } } },
      {},
    );
    const description = describeOnepmAccount(account);
    assert.equal(JSON.stringify(description).includes(KEY), false);
    assert.equal(description.tokenStatus, "available");
  });
});

describe("normalizeAllowFrom", () => {
  it("allows nobody when the list isn't a list", () => {
    assert.deepEqual(normalizeAllowFrom("user-1"), []);
    assert.deepEqual(normalizeAllowFrom(undefined), []);
  });
});

describe("normalizeTaskTarget", () => {
  it("accepts prefixed and bare task ids", () => {
    assert.equal(normalizeTaskTarget("onepm:task:abc"), "abc");
    assert.equal(normalizeTaskTarget("task:abc"), "abc");
    assert.equal(normalizeTaskTarget(" abc "), "abc");
  });

  it("refuses empty or spaced targets", () => {
    assert.equal(normalizeTaskTarget("task:"), undefined);
    assert.equal(normalizeTaskTarget("two words"), undefined);
  });
});
