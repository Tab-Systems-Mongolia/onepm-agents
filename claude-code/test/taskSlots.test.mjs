import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTaskSlots } from "../src/services/taskSlots.mjs";

const clock = (start = 0) => {
  let time = start;
  return { now: () => time, advance: (ms) => (time += ms) };
};

describe("createTaskSlots", () => {
  it("admits up to the limit of tasks at once", () => {
    const slots = createTaskSlots({ max: 2, holdMs: 1000, now: () => 0 });
    slots.start("t1");
    assert.equal(slots.admits("t2"), true);
    slots.start("t2");
    assert.equal(slots.admits("t3"), false);
    assert.equal(slots.size(), 2);
  });

  it("lets trigger notices through without taking a slot", () => {
    const slots = createTaskSlots({ max: 1, holdMs: 1000, now: () => 0 });
    slots.start("t1");
    assert.equal(slots.admits("t2", "status"), true);
    slots.start("t2", "status");
    slots.start("t3", "pull_request");
    assert.equal(slots.size(), 1);
    assert.equal(slots.admits("t4", "assignment"), false);
  });

  it("always admits more messages for a task already being worked on", () => {
    const slots = createTaskSlots({ max: 1, holdMs: 1000, now: () => 0 });
    slots.start("t1");
    assert.equal(slots.admits("t1"), true);
  });

  it("frees a task's slot when the agent replies", () => {
    const slots = createTaskSlots({ max: 1, holdMs: 1000, now: () => 0 });
    slots.start("t1");
    slots.finish("t1");
    assert.equal(slots.admits("t2"), true);
  });

  it("frees a slot after holdMs without a reply, counted from the task's latest message", () => {
    const time = clock();
    const slots = createTaskSlots({ max: 1, holdMs: 1000, now: time.now });
    slots.start("t1");
    time.advance(600);
    slots.start("t1");
    time.advance(600);
    assert.equal(slots.admits("t2"), false);
    time.advance(400);
    assert.equal(slots.admits("t2"), true);
    assert.equal(slots.size(), 0);
  });
});
