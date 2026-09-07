import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, snapshotFrom, type DiffPayload } from "../shared/model";
import { prepareDiffDocuments } from "./diffDocuments";

const snapshot = () => snapshotFrom([], DEFAULT_SETTINGS);
function diff(): DiffPayload {
  return {
    id: "test",
    source: "remote",
    gistId: "gist",
    remoteUpdatedAt: "time",
    leftHash: "left-hash",
    rightHash: "right-hash",
    left: snapshot(),
    right: snapshot()
  };
}

describe("diff rendering budget", () => {
  it("retains detailed JSON for ordinary snapshots", async () => {
    const value = diff();
    value.left.bookmarks.push({ title: "Local", url: "https://local.test" });
    const result = await prepareDiffDocuments(value);
    expect(result.summarized).toBe(false);
    expect(result.left).toContain("https://local.test");
  });
  it("summarizes large Notes without changing either original snapshot", async () => {
    const value = diff();
    value.left.notes.push({ id: "a", name: "Large note", content: "x".repeat(5_000_000), createtime: "date", updatetime: "date" });
    const result = await prepareDiffDocuments(value);
    expect(result.summarized).toBe(true);
    expect(result.left.length).toBeLessThan(10_000);
    expect(result.left).toContain("left-hash");
    expect(value.left.notes[0].content).toHaveLength(5_000_000);
  });
  it("summarizes large trees even when their text is short", async () => {
    const value = diff();
    value.right.bookmarks = Array.from({ length: 10_000 }, () => ({ title: "", children: [] }));
    expect((await prepareDiffDocuments(value)).summarized).toBe(true);
  });
});
