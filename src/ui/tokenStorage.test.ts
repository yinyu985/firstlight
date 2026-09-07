// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readOnlineToken, saveOnlineToken } from "./tokenStorage";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
describe("online credentials", () => {
  it("defaults to session storage and migrates an existing remembered credential on request", () => {
    localStorage.setItem("firstlight.online.token", "old");
    expect(readOnlineToken()).toEqual({ token: "old", remember: true });
    expect(saveOnlineToken("new", false)).toBe(true);
    expect(localStorage.getItem("firstlight.online.token")).toBeNull();
    expect(readOnlineToken()).toEqual({ token: "new", remember: false });
    sessionStorage.clear();
    expect(readOnlineToken().token).toBeUndefined();
  });
  it("remembers only when requested and clears both stores on disconnect", () => {
    saveOnlineToken("remember", true);
    expect(readOnlineToken()).toEqual({ token: "remember", remember: true });
    saveOnlineToken("", false);
    expect(readOnlineToken().token).toBeUndefined();
  });
  it("reports storage failures without claiming a credential was saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(saveOnlineToken("test", true)).toBe(false);
  });
});
