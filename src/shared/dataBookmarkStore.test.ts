import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { consumeDataBookmark, dataBookmarkViewerUrl, stageDataBookmark } from "./dataBookmarkStore";
import { canOpenBookmark, isDataBookmarkUrl } from "./url";

describe("data bookmark routing", () => {
  it("recognizes data URLs without treating lookalikes as data bookmarks", () => {
    expect(isDataBookmarkUrl("data:text/html,<title>Editor</title>")).toBe(true);
    expect(isDataBookmarkUrl("DATA:text/plain,hello")).toBe(true);
    expect(isDataBookmarkUrl("https://example.com/?next=data:text/html,test")).toBe(false);
  });

  it("keeps data URLs openable through the dedicated viewer", () => {
    expect(canOpenBookmark("data:text/html,hello")).toBe(true);
    expect(dataBookmarkViewerUrl("entry / 1", "chrome-extension://firstlight/newtab.html"))
      .toBe("chrome-extension://firstlight/data-viewer.html#entry%20%2F%201");
  });

  it("stages each data URL for one successful consume", async () => {
    const id = crypto.randomUUID();
    const url = "data:text/html,<title>Editor</title>";
    await stageDataBookmark(id, url);

    await expect(consumeDataBookmark(id)).resolves.toBe(url);
    await expect(consumeDataBookmark(id)).resolves.toBeNull();
  });

  it("deletes expired staged entries when a new entry is written", async () => {
    const now = vi.spyOn(Date, "now");
    const oldId = crypto.randomUUID();
    const currentId = crypto.randomUUID();
    now.mockReturnValue(0);
    await stageDataBookmark(oldId, "data:text/plain,old");
    now.mockReturnValue(60 * 60 * 1000 + 1);
    await stageDataBookmark(currentId, "data:text/plain,current");

    await expect(consumeDataBookmark(oldId)).resolves.toBeNull();
    await expect(consumeDataBookmark(currentId)).resolves.toBe("data:text/plain,current");
    now.mockRestore();
  });
});
