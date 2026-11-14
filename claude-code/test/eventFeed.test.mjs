import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEventFeed } from "../src/services/eventFeed.mjs";

const self = { id: "agent-1", handle: "claudeagent", projectSlug: "onepm" };
const owner = { url: "https://pm.example.com", agentId: "agent-1" };

const memoryState = (access, cursor = null) => {
  const state = {
    cursor,
    dropped: [],
    loadAccess: () => access,
    readCursor: () => state.cursor,
    writeCursor: (_owner, sequence) => {
      state.cursor = sequence;
    },
    recordDropped: (entry) => state.dropped.push(entry),
  };
  return state;
};

const fakeClient = (events, { task, comments } = {}) => {
  const calls = [];
  return {
    calls,
    events: async (after) => {
      calls.push(["events", after]);
      return events
        .filter((event) => after === null || event.sequence > after)
        .slice(0, 2);
    },
    task: async (taskId) => {
      calls.push(["task", taskId]);
      if (!task) throw new Error("GET /task: HTTP 404");
      return task;
    },
    comments: async (taskId) => {
      calls.push(["comments", taskId]);
      return comments ?? [];
    },
  };
};

const event = (sequence, overrides = {}) => ({
  sequence,
  id: `e${sequence}`,
  kind: "mention",
  taskId: "t1",
  commentId: `c${sequence}`,
  actorId: "owner-1",
  actorSource: "browser",
  ...overrides,
});

const run = async ({ events, access, cursor = 0, task, comments, admits }) => {
  const state = memoryState(access, cursor);
  const client = fakeClient(events, { task, comments });
  const delivered = [];
  const feed = createEventFeed({
    client,
    state,
    owner,
    self,
    deliver: async (message) => delivered.push(message),
    admits,
    log: () => {},
  });
  await feed.drain();
  return { state, client, delivered, feed };
};

describe("createEventFeed", () => {
  const allowed = { allowFrom: ["owner-1"], requireMention: true };

  it("holds a task's event while admits refuses it, without moving the cursor past it", async () => {
    const busyTasks = new Set(["t1"]);
    const { delivered, state, client } = await run({
      access: allowed,
      events: [
        event(1, { taskId: "t1" }),
        event(2, { taskId: "t2" }),
        event(3, { taskId: "t1" }),
      ],
      admits: (held) => busyTasks.has(held.taskId),
    });
    assert.deepEqual(
      delivered.map(({ meta }) => meta.chat_id),
      ["t1"],
    );
    assert.equal(state.cursor, 1);
    // Nothing about the held event is read until it can be delivered.
    assert.ok(!client.calls.some(([, id]) => id === "t2"));
  });

  it("delivers allowed events with the server's details and moves the cursor", async () => {
    const { delivered, state, client } = await run({
      access: allowed,
      events: [
        event(1, {
          actorName: "Owner",
          taskTitle: "Fix login",
          taskKey: "ONEPM-3",
          text: "please look",
        }),
        event(2, { kind: "finished", commentId: null }),
        event(3, {
          kind: "assignment",
          commentId: null,
          actorName: "Owner",
          taskTitle: "T",
          taskKey: "ONEPM-4",
          text: null,
        }),
      ],
    });
    assert.deepEqual(
      delivered.map(({ meta }) => [meta.event_id, meta.task_key, meta.user]),
      [
        ["e1", "ONEPM-3", "Owner"],
        ["e3", "ONEPM-4", "Owner"],
      ],
    );
    assert.equal(state.cursor, 3);
    assert.equal(
      client.calls.some(([name]) => name !== "events"),
      false,
    );
  });

  it("drops senders not on the list and remembers them", async () => {
    const { delivered, state } = await run({
      access: allowed,
      events: [event(1, { actorId: "stranger", actorName: "Stranger" })],
    });
    assert.equal(delivered.length, 0);
    assert.equal(state.cursor, 1);
    assert.equal(state.dropped[0].userId, "stranger");
  });

  it("drops everything with an empty allowlist", async () => {
    const { delivered } = await run({
      access: { allowFrom: [], requireMention: true },
      events: [event(1), event(2)],
    });
    assert.equal(delivered.length, 0);
  });

  it("delivers trigger events with an empty allowlist and skips unknown kinds", async () => {
    const { delivered, state } = await run({
      access: { allowFrom: [], requireMention: true },
      events: [
        event(1, {
          kind: "pull_request",
          commentId: null,
          actorId: null,
          actorSource: "trigger",
          taskKey: "ONEPM-7",
          taskTitle: "Fix login",
          pullRequest: {
            action: "merged",
            url: "https://github.com/acme/repo/pull/5",
            number: 5,
            title: null,
            repository: "acme/repo",
            branch: null,
          },
        }),
        event(2, { kind: "review_requested", actorSource: "trigger" }),
      ],
    });
    assert.deepEqual(
      delivered.map(({ content }) => content),
      [
        "[ONEPM-7] Fix login\nPull request #5 (acme/repo) was merged.\nhttps://github.com/acme/repo/pull/5",
      ],
    );
    assert.equal(delivered[0].meta.user, "OnePM");
    assert.equal(state.cursor, 2);
  });

  it("reads the task and comment when an older server leaves them out", async () => {
    const { delivered } = await run({
      access: allowed,
      events: [event(1)],
      task: { title: "Fix login", number: 7 },
      comments: [{ id: "c1", content: "hi there", user: { name: "Owner" } }],
    });
    assert.equal(
      delivered[0].content,
      "[ONEPM-7] Fix login\nOwner mentioned you:\n\nhi there",
    );
  });

  it("applies requireMention to plain comments", async () => {
    const comment = (sequence, text) =>
      event(sequence, {
        kind: "comment",
        actorName: "Owner",
        taskTitle: "T",
        taskKey: "ONEPM-1",
        text,
      });
    const events = [
      comment(1, "no mention"),
      comment(2, "@claudeagent can you"),
    ];
    const strict = await run({ access: allowed, events });
    assert.deepEqual(
      strict.delivered.map(({ meta }) => meta.event_id),
      ["e2"],
    );
    const open = await run({
      access: { ...allowed, requireMention: false },
      events,
    });
    assert.deepEqual(
      open.delivered.map(({ meta }) => meta.event_id),
      ["e1", "e2"],
    );
  });

  it("keeps the cursor on a failed delivery", async () => {
    const state = memoryState(allowed, 0);
    const feed = createEventFeed({
      client: fakeClient([
        event(1, { taskTitle: "T", taskKey: "K-1", actorName: "O", text: "x" }),
      ]),
      state,
      owner,
      self,
      deliver: async () => {
        throw new Error("transport closed");
      },
      log: () => {},
    });
    await feed.drain();
    assert.equal(state.cursor, 0);
  });

  it("skips history on the first start", async () => {
    const state = memoryState(allowed, null);
    const feed = createEventFeed({
      client: fakeClient([event(1), event(2), event(3)]),
      state,
      owner,
      self,
      deliver: async () => assert.fail("nothing is delivered"),
      log: () => {},
    });
    await feed.skipHistory();
    assert.equal(state.cursor, 3);
    await feed.drain();
  });
});
