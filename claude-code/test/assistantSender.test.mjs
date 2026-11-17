import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asSenderView,
  isAllowedSender,
  normalizeAccess,
} from "../src/lib/access.mjs";
import { formatEvent } from "../src/lib/eventMessage.mjs";

const assistantEvent = (overrides = {}) => ({
  id: "e1",
  kind: "mention",
  taskId: "t1",
  commentId: "c1",
  actorId: "assistant-1",
  actorKind: "assistant",
  actorName: "OnePM Assistant",
  actorSource: "browser",
  onBehalfOf: { id: "owner-1", name: "Sura" },
  ...overrides,
});

describe("asSenderView", () => {
  it("names the person OnePM Assistant acted for, marked via assistant", () => {
    const view = asSenderView(assistantEvent());
    assert.equal(view.actorId, "owner-1");
    assert.equal(view.actorName, "Sura");
    assert.equal(view.actorKind, "person");
    assert.equal(view.via, "assistant");
  });

  it("leaves an Assistant event without onBehalfOf as the Assistant", () => {
    const event = assistantEvent({ onBehalfOf: null });
    assert.equal(asSenderView(event), event);
  });

  it("ignores onBehalfOf on anything but an Assistant actor", () => {
    const event = assistantEvent({ actorKind: "agent", actorId: "agent-2" });
    assert.equal(asSenderView(event), event);
  });
});

describe("Assistant events and the allowlist", () => {
  const access = normalizeAccess({ allowFrom: ["owner-1"] });

  it("let the person through when they're allowed", () => {
    const view = asSenderView(assistantEvent());
    assert.equal(isAllowedSender(view, access, "self-1", "owner-1"), true);
  });

  it("drop it when the person isn't allowed", () => {
    const view = asSenderView(
      assistantEvent({ onBehalfOf: { id: "stranger", name: "X" } }),
    );
    assert.equal(isAllowedSender(view, access, "self-1", "owner-1"), false);
  });

  it("drop an Assistant event without onBehalfOf", () => {
    const view = asSenderView(assistantEvent({ onBehalfOf: null }));
    assert.equal(isAllowedSender(view, access, "self-1", "owner-1"), false);
  });
});

describe("formatEvent via assistant", () => {
  it("marks the meta and says the Assistant wrote it", () => {
    const view = asSenderView(assistantEvent());
    const { content, meta } = formatEvent(view, {
      taskKey: "ONEPM-1",
      taskTitle: "Title",
      actorName: view.actorName,
      text: "please check",
    });
    assert.equal(meta.via, "assistant");
    assert.equal(meta.user_id, "owner-1");
    assert.equal(meta.user, "Sura");
    assert.match(content, /Written by OnePM Assistant for Sura/);
  });

  it("adds no via to a person's own message", () => {
    const { meta, content } = formatEvent(
      { id: "e2", kind: "mention", taskId: "t1", actorId: "owner-1" },
      { taskKey: "ONEPM-1", taskTitle: "Title", actorName: "Sura", text: "hi" },
    );
    assert.equal(meta.via, undefined);
    assert.doesNotMatch(content, /OnePM Assistant/);
  });
});
