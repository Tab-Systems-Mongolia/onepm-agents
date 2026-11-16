import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SERVER_VERSION } from "../src/constants/channel.mjs";
import { idleNotice, listProfiles } from "../src/lib/idleNotice.mjs";

const dirent = (name, dir = true) => ({ name, isDirectory: () => dir });

describe("idleNotice", () => {
  it("names the fix and the profiles on this machine", () => {
    const text = idleNotice("OnePM channel isn't active.", [
      "alfred-pm",
      "bruce-wayne",
    ]);
    assert.match(text, /not connected/);
    assert.match(
      text,
      /ONEPM_AGENT=<name> claude --dangerously-load-development-channels/,
    );
    assert.match(text, /alfred-pm, bruce-wayne/);
  });

  it("points to /onepm:configure when no profile exists", () => {
    assert.match(idleNotice("x", []), /\/onepm:configure/);
  });
});

describe("listProfiles", () => {
  it("lists profile folders only, sorted", () => {
    const read = () => [
      dirent("bruce-wayne"),
      dirent(".env", false),
      dirent("alfred-pm"),
    ];
    assert.deepEqual(listProfiles("/home/x", read), [
      "alfred-pm",
      "bruce-wayne",
    ]);
  });

  it("is empty when the folder doesn't exist", () => {
    const read = () => {
      throw new Error("ENOENT");
    };
    assert.deepEqual(listProfiles("/home/x", read), []);
  });
});

describe("SERVER_VERSION", () => {
  it("matches the plugin's package version", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.equal(SERVER_VERSION, pkg.version);
  });
});
