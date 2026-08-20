import { describe, expect, it } from "vitest";
import { parseExtensionRequest } from "./requestValidation";

describe("parseExtensionRequest", () => {
  it("accepts known requests with the required payload shape", () => {
    expect(parseExtensionRequest({ type: "GET_STATE" })).toEqual({ type: "GET_STATE" });
    expect(parseExtensionRequest({ type: "SAVE_TOKEN", token: "github_pat_test" })).toEqual({
      type: "SAVE_TOKEN",
      token: "github_pat_test"
    });
    expect(parseExtensionRequest({ type: "USE_REMOTE", diffId: "diff-1" })).toEqual({
      type: "USE_REMOTE",
      diffId: "diff-1"
    });
  });

  it.each([
    undefined,
    {},
    { type: "UNKNOWN" },
    { type: "SAVE_TOKEN" },
    { type: "SAVE_SETTINGS", settings: [] },
    { type: "SAVE_NOTES", notes: {} },
    { type: "USE_LOCAL", diffId: "" }
  ])("rejects malformed input %#", (request) => {
    expect(() => parseExtensionRequest(request)).toThrow();
  });
});
