import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAllowedSender,
  isDeliverableKind,
  mentionsAgent,
  normalizeAccess,
  passesMentionRule,
} from "../src/lib/access.mjs";

const self = { id: "agent-1", handle: "claudeagent" };
const event = (overrides = {}) => ({
  id: "e1",
  sequence: 1,
  kind: "mention",
  taskId: "t1",
  commentId: "c1",
  actorId: "owner-1",
  actorSource: "browser",
  ...overrides,
});

describe("normalizeAccess", () => {
  it("defaults to nobody allowed and mentions required", () => {
    assert.deepEqual(normalizeAccess(null), {
      allowFrom: [],
      requireMention: true,
    });
    assert.deepEqual(normalizeAccess([]), {
      allowFrom: [],
      requireMention: true,
    });
    assert.deepEqual(normalizeAccess({}), {
      allowFrom: [],
      requireMention: true,
    });
  });

  it("keeps string ids only and turns mentions off only when false", () => {
    assert.deepEqual(
      normalizeAccess({ allowFrom: [" a ", 3, "", "b"], requireMention: "no" }),
      { allowFrom: ["a", "b"], requireMention: true },
    );
    assert.equal(
      normalizeAccess({ requireMention: false }).requireMention,
      false,
    );
  });
});

describe("isAllowedSender", () => {
  const access = { allowFrom: ["owner-1"], requireMention: true };

  it("lets only listed senders through", () => {
    assert.equal(isAllowedSender(event(), access, self.id), true);
    assert.equal(
      isAllowedSender(event({ actorId: "other" }), access, self.id),
      false,
    );
  });

  it("drops everything when the list is empty", () => {
    assert.equal(isAllowedSender(event(), normalizeAccess({}), self.id), false);
  });

  it("drops events without an actor and the agent's own", () => {
    assert.equal(
      isAllowedSender(event({ actorId: null }), access, self.id),
      false,
    );
    const listedSelf = { allowFrom: ["agent-1"], requireMention: true };
    assert.equal(
      isAllowedSender(event({ actorId: "agent-1" }), listedSelf, self.id),
      false,
    );
  });
});

describe("isDeliverableKind", () => {
  it("ignores finished and unassigned", () => {
    for (const kind of ["mention", "assignment", "comment"])
      assert.equal(isDeliverableKind(kind), true);
    for (const kind of ["finished", "unassigned", "other"])
      assert.equal(isDeliverableKind(kind), false);
  });
});

describe("passesMentionRule", () => {
  const strict = { allowFrom: ["owner-1"], requireMention: true };
  const open = { allowFrom: ["owner-1"], requireMention: false };

  it("with requireMention, delivers mentions and assignments", () => {
    assert.equal(
      passesMentionRule(event({ kind: "mention" }), strict, null, self),
      true,
    );
    assert.equal(
      passesMentionRule(event({ kind: "assignment" }), strict, null, self),
      true,
    );
  });

  it("with requireMention, delivers a comment only when it mentions the agent", () => {
    const comment = event({ kind: "comment" });
    assert.equal(passesMentionRule(comment, strict, "looks good", self), false);
    assert.equal(
      passesMentionRule(
        comment,
        strict,
        '<kaneo-mention id="agent-1" label="claudeagent"></kaneo-mention> look',
        self,
      ),
      true,
    );
    assert.equal(
      passesMentionRule(comment, strict, "hey @ClaudeAgent please", self),
      true,
    );
  });

  it("without requireMention, delivers every comment", () => {
    assert.equal(
      passesMentionRule(event({ kind: "comment" }), open, "looks good", self),
      true,
    );
  });
});

describe("mentionsAgent", () => {
  it("doesn't match a longer handle or an email", () => {
    assert.equal(mentionsAgent("@claudeagent2 hi", self), false);
    assert.equal(mentionsAgent("mail me@claudeagent", self), false);
    assert.equal(mentionsAgent(null, self), false);
  });
});
