import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAccessReporter } from "../src/services/accessReporter.mjs";
import { OnepmHttpError } from "../src/services/onepmClient.mjs";

const fakeClient = () => {
  const sent = [];
  return {
    sent,
    reportAccess: async (allowFrom) => {
      sent.push(allowFrom);
      return { allowFrom };
    },
  };
};

describe("createAccessReporter", () => {
  it("sends the list once, and again only when it changes", async () => {
    const client = fakeClient();
    const reporter = createAccessReporter({ client, log: () => {} });
    await reporter.sync({ allowFrom: ["b", "a"] });
    await reporter.sync({ allowFrom: ["a", "b", "a"] });
    await reporter.sync({ allowFrom: ["a"] });
    assert.deepEqual(client.sent, [["a", "b"], ["a"]]);
  });

  it("leaves out wildcards, which OnePM refuses", async () => {
    const client = fakeClient();
    const reporter = createAccessReporter({ client, log: () => {} });
    await reporter.sync({ allowFrom: ["*", "a"] });
    assert.deepEqual(client.sent, [["a"]]);
  });

  it("retries after a failure", async () => {
    let failing = true;
    const sent = [];
    const client = {
      reportAccess: async (allowFrom) => {
        if (failing) throw new OnepmHttpError("PUT", "/x", 503);
        sent.push(allowFrom);
      },
    };
    const reporter = createAccessReporter({ client, log: () => {} });
    await reporter.sync({ allowFrom: ["a"] });
    failing = false;
    await reporter.sync({ allowFrom: ["a"] });
    assert.deepEqual(sent, [["a"]]);
  });

  it("stops on an older OnePM without the route", async () => {
    let calls = 0;
    const client = {
      reportAccess: async () => {
        calls += 1;
        throw new OnepmHttpError("PUT", "/x", 404);
      },
    };
    const reporter = createAccessReporter({ client, log: () => {} });
    await reporter.sync({ allowFrom: ["a"] });
    await reporter.sync({ allowFrom: ["b"] });
    assert.equal(calls, 1);
  });
});
