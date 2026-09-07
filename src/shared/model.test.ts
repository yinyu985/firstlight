import { describe, expect, it } from "vitest";
import { createDiffId } from "./model";

describe("createDiffId", () => {
  it("is stable for the same semantic hashes and remote revision", () => {
    expect(createDiffId("remote", "left", "right", "revision")).toBe(createDiffId("remote", "left", "right", "revision"));
  });

  it("changes when either side or the remote revision changes", () => {
    const id = createDiffId("remote", "left", "right", "revision");
    expect(createDiffId("remote", "new-left", "right", "revision")).not.toBe(id);
    expect(createDiffId("remote", "left", "new-right", "revision")).not.toBe(id);
    expect(createDiffId("remote", "left", "right", "new-revision")).not.toBe(id);
  });
});
