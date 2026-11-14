import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskSecrets } from "../src/lib/maskSecrets.mjs";

const M = "[redacted]";

describe("maskSecrets", () => {
  const cases = [
    ["GitHub token", `token ghp_${"a".repeat(36)} here`, `token ${M} here`],
    ["GitHub fine-grained token", `github_pat_${"A1_".repeat(10)}`, M],
    ["OpenAI/Anthropic key", `key sk-ant-api03-${"x".repeat(30)}`, `key ${M}`],
    ["Stripe live key", `sk_live_${"Z".repeat(24)}`, M],
    ["OnePM key", `opm_${"k".repeat(32)}`, M],
    ["AWS access key", "AKIAIOSFODNN7EXAMPLE in env", `${M} in env`],
    [
      "AWS secret key",
      "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      `aws_secret_access_key = ${M}`,
    ],
    [
      "Bearer value",
      "Authorization: Bearer abcdefghijklmnop",
      `Authorization: Bearer ${M}`,
    ],
    [
      "JWT",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      `jwt ${M}`,
    ],
    [
      "URL password",
      "postgres://app:s3cretpass@db:5432/x",
      `postgres://app:${M}@db:5432/x`,
    ],
    [
      "private key",
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
      M,
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(`masks a ${name}`, () => assert.equal(maskSecrets(input), expected));
  }

  it("masks known values, longest first", () => {
    assert.equal(
      maskSecrets("key is my-agent-key-123", ["my-agent-key-123", "agent"]),
      `key is ${M}`,
    );
  });

  it("ignores short known values and leaves ordinary text alone", () => {
    const text =
      "Fixed the sk- prefix check in task ONEPM-12; see https://example.com/a";
    assert.equal(maskSecrets(text, ["abc", ""]), text);
  });
});
