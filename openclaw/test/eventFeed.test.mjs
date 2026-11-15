import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEventFeed } from "../src/services/eventFeed.mjs";
import { OnepmHttpError } from "../src/services/onepmClient.mjs";

const self = { id: "agent-1", handle: "claw", projectSlug: "onepm" };

const memoryCursor = (initial = null) => {
  let value = initial;
  return { read: () => value, write: (next) => (value = next) };
};

// Serves `events` in pages of `pageSize` after the given sequence.
const fakeClient = (events, { pageSize = 2, task, comments } = {}) => {
  const calls = { events: [], task: 0, comments: 0 };
  return {
    calls,
    events: async (after) => {
      calls.events.push(after);
      return events
        .filter((event) => after === null || event.sequence > after)
        .slice(0, pageSize);
    },
    task: async () => {
      calls.task += 1;
      if (task instanceof Error) throw task;
      return task ?? { title: "Fetched title", number: 4 };
    },
    comments: async () => {
      calls.comments += 1;
      return comments ?? [];
    },
  };
};

const event = (sequence, extra = {}) => ({
  id: `e${sequence}`,
  sequence,
  kind: "comment",
  actorId: "user-1",
  actorName: "Sura",
  taskId: "t1",
  taskKey: "ONEPM-1",
  taskTitle: "Title",
  text: "hi",
  ...extra,
});

const feedWith = (client, cursor, overrides = {}) => {
  const handled = [];
  const logs = [];
  const feed = createEventFeed({
    client,
    cursor,
    self,
    handle: async (item, details) => handled.push({ item, details }),
    log: (line) => logs.push(line),
    ...overrides,
  });
  return { feed, handled, logs };
};

describe("skipHistory", () => {
  it("starts after the newest event on the first run", async () => {
    const client = fakeClient([event(1), event(2), event(3)]);
    const cursor = memoryCursor();
    const { feed, handled } = feedWith(client, cursor);
    await feed.skipHistory();
    assert.equal(cursor.read(), 3);
    assert.equal(handled.length, 0);
  });

  it("keeps an existing cursor", async () => {
    const client = fakeClient([event(1)]);
    const cursor = memoryCursor(0);
    const { feed } = feedWith(client, cursor);
    await feed.skipHistory();
    assert.equal(cursor.read(), 0);
    assert.deepEqual(client.calls.events, []);
  });

  it("writes 0 when there is no history", async () => {
    const cursor = memoryCursor();
    await feedWith(fakeClient([]), cursor).feed.skipHistory();
    assert.equal(cursor.read(), 0);
  });
});

describe("drain", () => {
  it("pages through new events and moves the cursor past each", async () => {
    const client = fakeClient([event(1), event(2), event(3)]);
    const cursor = memoryCursor(0);
    const { feed, handled } = feedWith(client, cursor);
    await feed.drain();
    assert.deepEqual(
      handled.map(({ item }) => item.id),
      ["e1", "e2", "e3"],
    );
    assert.equal(cursor.read(), 3);
    assert.deepEqual(client.calls.events, [0, 2, 3]);
  });

  it("skips its own events and non-request kinds without reading them", async () => {
    const client = fakeClient(
      [
        event(1, { actorId: "agent-1" }),
        event(2, { kind: "finished" }),
        event(3, { kind: "unassigned" }),
      ],
      { pageSize: 10 },
    );
    const cursor = memoryCursor(0);
    const { feed, handled } = feedWith(client, cursor);
    await feed.drain();
    assert.equal(handled.length, 0);
    assert.equal(cursor.read(), 3);
    assert.equal(client.calls.task, 0);
  });

  it("hands on a trigger without an actor and skips kinds it doesn't know", async () => {
    const client = fakeClient(
      [
        event(1, {
          kind: "pull_request",
          actorId: null,
          actorSource: "trigger",
          commentId: null,
          text: null,
        }),
        event(2, { kind: "review_requested", actorSource: "trigger" }),
      ],
      { pageSize: 10 },
    );
    const cursor = memoryCursor(0);
    const { feed, handled } = feedWith(client, cursor);
    await feed.drain();
    assert.deepEqual(
      handled.map(({ item }) => item.kind),
      ["pull_request"],
    );
    assert.equal(cursor.read(), 2);
  });

  it("drops a refused sender before reading the task", async () => {
    const client = fakeClient([event(1, { taskTitle: null })]);
    const cursor = memoryCursor(0);
    const { feed, handled, logs } = feedWith(client, cursor, {
      admits: async () => false,
    });
    await feed.drain();
    assert.equal(handled.length, 0);
    assert.equal(client.calls.task, 0);
    assert.equal(cursor.read(), 1);
    assert.match(logs.join("\n"), /dropped comment e1 from user-1/);
  });

  it("reads the task and comment an older server leaves out", async () => {
    const client = fakeClient(
      [
        event(1, {
          taskKey: undefined,
          taskTitle: undefined,
          actorName: undefined,
          text: undefined,
          commentId: "c1",
        }),
      ],
      {
        comments: [
          { id: "c1", content: "<p>from comment</p>", user: { name: "Ana" } },
        ],
      },
    );
    const { feed, handled } = feedWith(client, memoryCursor(0));
    await feed.drain();
    assert.deepEqual(handled[0].details, {
      taskKey: "ONEPM-4",
      taskTitle: "Fetched title",
      actorName: "Ana",
      text: "<p>from comment</p>",
    });
  });

  it("delivers what the event carries when the task can't be read", async () => {
    const client = fakeClient([event(1, { taskTitle: null })], {
      task: new OnepmHttpError("GET", "/task/t1", 404),
    });
    const cursor = memoryCursor(0);
    const { feed, handled } = feedWith(client, cursor);
    await feed.drain();
    assert.equal(handled.length, 1);
    assert.equal(cursor.read(), 1);
  });

  it("stops without moving the cursor on a server error", async () => {
    const client = fakeClient([event(1, { taskTitle: null }), event(2)], {
      task: new OnepmHttpError("GET", "/task/t1", 503),
    });
    const cursor = memoryCursor(0);
    const { feed, handled, logs } = feedWith(client, cursor);
    await feed.drain();
    assert.equal(handled.length, 0);
    assert.equal(cursor.read(), 0);
    assert.match(logs.join("\n"), /couldn't read events/);
  });

  it("retries an event whose handling failed", async () => {
    const client = fakeClient([event(1)]);
    const cursor = memoryCursor(0);
    let fail = true;
    const { feed } = feedWith(client, cursor, {
      handle: async () => {
        if (fail) throw new Error("dispatch failed");
      },
    });
    await feed.drain();
    assert.equal(cursor.read(), 0);
    fail = false;
    await feed.drain();
    assert.equal(cursor.read(), 1);
  });
});

// ONEPM-202: the owner's place on allowFrom is for the owner in person.
describe("an agent named as its owner", () => {
  const owned = { ...self, ownerId: "owner-1" };

  it("is dropped before anything is read, and the owner in person isn't", async () => {
    const client = fakeClient([
      event(1, { actorId: "owner-1", actorSource: "agent" }),
      event(2, {
        actorId: "owner-1",
        actorSource: "agent",
        actorKind: "agent",
      }),
      event(3, {
        actorId: "owner-1",
        actorSource: "browser",
        actorKind: "person",
      }),
    ]);
    const cursor = memoryCursor(0);
    const { feed, handled } = feedWith(client, cursor, { self: owned });
    await feed.drain();
    assert.deepEqual(
      handled.map(({ item }) => item.id),
      ["e3"],
    );
    assert.equal(cursor.read(), 3);
  });
});
