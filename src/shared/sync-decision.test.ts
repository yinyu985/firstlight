import { describe, expect, it } from "vitest";
import { canAutoUpload, decideSync, decideSyncWithRevision } from "./sync-decision";

describe("decideSync", () => {
  it.each([
    ["base", "base", "idle"],
    ["local", "base", "upload"],
    ["base", "remote", "restore"],
    ["same", "same", "adopt"],
    ["local", "remote", "conflict"]
  ])("local=%s remote=%s => %s", (local, remote, expected) => {
    expect(decideSync(local, remote, "base")).toBe(expected);
  });
});

describe("decideSyncWithRevision", () => {
  it("treats an unchanged remote revision as a local-only change even when an old baseline hash is stale", () => {
    expect(decideSyncWithRevision("local-with-note", "remote-empty-notes", "old-schema-hash", "server-time", "server-time"))
      .toBe("upload");
  });

  it("keeps conflict detection when the remote revision really changed", () => {
    expect(decideSyncWithRevision("local", "remote", "base", "old-time", "new-time"))
      .toBe("conflict");
  });
});

describe("canAutoUpload", () => {
  it("requires both a token and a bound Gist", () => {
    expect(canAutoUpload(false, undefined, undefined, false)).toBe(false);
    expect(canAutoUpload(false, "token", "gist", false)).toBe(false);
    expect(canAutoUpload(true, "token", undefined, false)).toBe(false);
    expect(canAutoUpload(true, undefined, "gist", false)).toBe(false);
    expect(canAutoUpload(true, "token", "gist", true)).toBe(false);
    expect(canAutoUpload(true, "token", "gist", false)).toBe(true);
  });
});
