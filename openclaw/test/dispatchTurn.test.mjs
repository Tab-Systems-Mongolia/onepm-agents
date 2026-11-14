import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchTurn } from "../src/services/dispatchTurn.mjs";

const label = "comment 7 on ONEPM-1";

describe("dispatchTurn", () => {
  it("logs delivered before the turn's reply, and the turn's end after it", async () => {
    const lines = [];
    await dispatchTurn({
      log: (line) => lines.push(line),
      label,
      dispatch: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        lines.push("reply posted");
      },
    });
    assert.deepEqual(lines, [
      `delivered ${label}`,
      "reply posted",
      `turn finished for ${label}`,
    ]);
  });

  it("logs a failed turn and rethrows so the event is retried", async () => {
    const lines = [];
    await assert.rejects(
      dispatchTurn({
        log: (line) => lines.push(line),
        label,
        dispatch: async () => {
          throw new Error("model unavailable");
        },
      }),
      /model unavailable/,
    );
    assert.deepEqual(lines, [
      `delivered ${label}`,
      `turn failed for ${label}: model unavailable`,
    ]);
  });
});
