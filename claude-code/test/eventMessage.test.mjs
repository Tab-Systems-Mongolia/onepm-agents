import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatEvent,
  formatTask,
  readableText,
  splitReply,
  taskKeyOf,
} from "../src/lib/eventMessage.mjs";

const event = {
  id: "event-9",
  sequence: 9,
  kind: "mention",
  taskId: "task-1",
  commentId: "comment-1",
  actorId: "user-1",
  actorSource: "browser",
  createdAt: "2026-11-14T01:00:00.000Z",
};

describe("readableText", () => {
  it("shows mention tags as @names", () => {
    assert.equal(
      readableText(
        'Hi <kaneo-mention id="a" label="claudeagent"></kaneo-mention>, and <kaneo-mention id="b">@Mira</kaneo-mention>',
      ),
      "Hi @claudeagent, and @Mira",
    );
    assert.equal(
      readableText('<kaneo-mention id="a"></kaneo-mention> hi'),
      "@someone hi",
    );
    assert.equal(readableText(null), "");
  });

  it("turns the editor's HTML into plain lines", () => {
    assert.equal(
      readableText(
        '<p><kaneo-mention id="a" label="bot">@bot</kaneo-mention> why &amp; how?</p><p>Second&nbsp;line<br>third</p>',
      ),
      "@bot why & how?\nSecond line\nthird",
    );
  });
});

describe("taskKeyOf", () => {
  it("joins the project slug and number", () => {
    assert.equal(taskKeyOf("onepm", 12), "ONEPM-12");
    assert.equal(taskKeyOf(null, 12), null);
    assert.equal(taskKeyOf("onepm", null), null);
  });
});

describe("formatEvent", () => {
  it("puts the task, sender and text in the content and ids in meta", () => {
    const { content, meta } = formatEvent(event, {
      taskKey: "ONEPM-12",
      taskTitle: "Fix login",
      actorName: "Mira",
      text: 'Can you look, <kaneo-mention id="a" label="claudeagent"></kaneo-mention>?',
    });
    assert.equal(
      content,
      "[ONEPM-12] Fix login\nMira mentioned you:\n\nCan you look, @claudeagent?",
    );
    assert.deepEqual(meta, {
      chat_id: "task-1",
      user: "Mira",
      user_id: "user-1",
      kind: "mention",
      task_key: "ONEPM-12",
      event_id: "event-9",
      ts: "2026-11-14T01:00:00.000Z",
    });
  });

  it("falls back to ids when details are missing", () => {
    const { content, meta } = formatEvent(
      { ...event, kind: "assignment", commentId: null },
      { taskKey: null, taskTitle: null, actorName: null, text: null },
    );
    assert.equal(content, "Task task-1\nuser-1 assigned this task to you.");
    assert.equal(meta.user, "user-1");
    assert.equal("task_key" in meta, false);
  });

  it("only uses string meta values", () => {
    const { meta } = formatEvent(event, {
      taskKey: "A-1",
      taskTitle: "t",
      actorName: "M",
      text: "x",
    });
    for (const value of Object.values(meta))
      assert.equal(typeof value, "string");
  });
});

describe("formatTask", () => {
  it("lists the task and its comments", () => {
    const text = formatTask({
      task: {
        title: "Fix login",
        status: "in-progress",
        priority: "high",
        description: "Steps",
      },
      taskKey: "ONEPM-12",
      comments: [
        {
          id: "c",
          content: "First\nsecond line",
          user: { name: "Mira" },
          createdAt: "2026-11-14",
        },
      ],
    });
    assert.match(
      text,
      /^\[ONEPM-12\] Fix login\nStatus: in-progress, priority: high/,
    );
    assert.match(text, /Description:\nSteps/);
    assert.match(text, /- Mira \(2026-11-14\):\n {2}First\n {2}second line/);
  });
});

describe("splitReply", () => {
  it("keeps short replies whole", () => {
    assert.deepEqual(splitReply("  hello  ", 100), ["hello"]);
  });

  it("splits long replies at a line break when one is close", () => {
    const text = `${"a".repeat(70)}\n${"b".repeat(70)}`;
    assert.deepEqual(splitReply(text, 100), ["a".repeat(70), "b".repeat(70)]);
  });

  it("cuts hard when there is no break", () => {
    const parts = splitReply("x".repeat(250), 100);
    assert.deepEqual(
      parts.map((part) => part.length),
      [100, 100, 50],
    );
  });
});

describe("formatEvent for triggers", () => {
  const trigger = {
    ...event,
    commentId: null,
    actorSource: "trigger",
    taskKey: "ONEPM-42",
  };

  it("says which status the task moved to and who moved it", () => {
    const { content, meta } = formatEvent(
      {
        ...trigger,
        kind: "status",
        status: { from: "In Progress", to: "Test" },
      },
      {
        taskKey: "ONEPM-42",
        taskTitle: "Fix login",
        actorName: "Mira",
        text: null,
      },
    );
    assert.equal(
      content,
      "[ONEPM-42] Fix login\nMira moved it from In Progress to Test.",
    );
    assert.equal(meta.kind, "status");
    assert.equal(meta.user, "Mira");
  });

  it("names OnePM when no one is behind the move", () => {
    const { content, meta } = formatEvent(
      {
        ...trigger,
        kind: "status",
        actorId: null,
        status: { from: null, to: "Test" },
      },
      { taskKey: "ONEPM-42", taskTitle: "Fix login", actorName: null },
    );
    assert.equal(content, "[ONEPM-42] Fix login\nIt moved to Test.");
    assert.equal(meta.user, "OnePM");
    assert.equal("user_id" in meta, false);
  });

  it("describes a linked pull request event", () => {
    const { content, meta } = formatEvent(
      {
        ...trigger,
        kind: "pull_request",
        actorId: null,
        pullRequest: {
          action: "merged",
          url: "https://github.com/acme/repo/pull/57",
          number: 57,
          title: "Fix the board",
          repository: "acme/repo",
          branch: "onepm-42",
        },
      },
      { taskKey: "ONEPM-42", taskTitle: "Fix login", actorName: null },
    );
    assert.equal(
      content,
      [
        "[ONEPM-42] Fix login",
        "Pull request #57 (acme/repo) was merged: Fix the board",
        "https://github.com/acme/repo/pull/57",
        "Branch: onepm-42",
      ].join("\n"),
    );
    assert.equal(meta.kind, "pull_request");
  });
});
