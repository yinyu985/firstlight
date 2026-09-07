import { describe, expect, it, vi } from "vitest";
import type { StoredState } from "../shared/protocol";
import { StateRepository } from "./stateRepository";

function area(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  return {
    values,
    get: vi.fn(async () => structuredClone(values)),
    set: vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(values, structuredClone(next));
    })
  };
}

describe("StateRepository", () => {
  it.each([false, true])("keeps both migration credentials recoverable with replacement remember=%s", async (rememberToken) => {
    const local = area(),
      session = area();
    const repository = new StateRepository(local, session);
    await repository.load();
    const old = { token: "old-secret", rememberToken: false, gistId: "gist" };
    await repository.save(old);
    const pending = { ...old, tokenMigration: { id: "migration", gistId: "gist", token: "new-secret", rememberToken } };
    await repository.save(pending);
    expect(JSON.stringify(local.values)).not.toContain("old-secret");
    expect(JSON.stringify(local.values).includes("new-secret")).toBe(rememberToken);
    expect(await new StateRepository(local, session).load()).toMatchObject(pending);
    local.set.mockRejectedValueOnce(new Error("disk full"));
    await expect(repository.save({ token: "new-secret", rememberToken, gistId: "gist" })).rejects.toThrow();
    expect(await new StateRepository(local, session).load()).toMatchObject(pending);
    await repository.save({ token: "new-secret", rememberToken, gistId: "gist" });
    expect((await new StateRepository(local, session).load()).tokenMigration).toBeUndefined();
    expect(session.values["firstlight.tokenMigration"]).toBeNull();
  });

  it("keeps an incomplete migration blocked after session credentials disappear", async () => {
    const local = area(),
      session = area();
    const repository = new StateRepository(local, session);
    await repository.load();
    await repository.save({ token: "old", rememberToken: false, tokenMigration: { id: "migration", gistId: "gist", token: "new", rememberToken: false } });
    const reloaded = await new StateRepository(local, area()).load();
    expect(reloaded.token).toBeUndefined();
    expect(reloaded.tokenMigration?.token).toBeUndefined();
    expect(reloaded.tokenMigration?.gistId).toBe("gist");
    expect(reloaded.syncEnabled).toBe(false);
    expect(reloaded.sync?.message).toContain("migration");
  });
  it("preserves a deferred Diff through status writes, then supports explicitly clearing it", async () => {
    const diff = { id: "saved-comparison" };
    const local = area({ firstlight: { storageVersion: 2 }, "firstlight.pendingDiff": diff });
    const repository = new StateRepository(local, area());
    const state = await repository.load({ deferPendingDiff: true, deferRecoveryPoints: true });
    expect(local.get.mock.calls[0]).toEqual([["firstlight", "firstlight.notes"]]);
    expect(state.pendingDiff).toBeUndefined();
    const statusWrite = repository.save({ ...state, setupSeen: true });
    expect(await repository.loadPendingDiff()).toEqual(diff);
    await statusWrite;
    expect(local.set.mock.calls[0][0]).not.toHaveProperty("firstlight.pendingDiff");
    await repository.save(state);
    expect(local.values["firstlight.pendingDiff"]).toBeNull();
  });
  it("rolls back a session token when its binding cannot be committed", async () => {
    const local = area();
    const session = area();
    const repository = new StateRepository(local, session);
    await repository.load();
    const old = { token: "old-token", rememberToken: false, gistId: "old-gist", syncEnabled: true };
    await repository.save(old);
    local.set.mockRejectedValueOnce(new Error("disk full"));
    await expect(repository.save({ ...old, token: "new-token", gistId: "new-gist" })).rejects.toThrow("disk full");
    expect(await new StateRepository(local, session).load()).toMatchObject(old);
  });

  it("fails closed if the session rollback also fails", async () => {
    const local = area();
    const session = area();
    const repository = new StateRepository(local, session);
    await repository.load();
    await repository.save({ token: "old-token", rememberToken: false, gistId: "old-gist", syncEnabled: true });
    const writeSession = session.set.getMockImplementation()!;
    session.set.mockImplementationOnce(writeSession).mockRejectedValueOnce(new Error("session unavailable"));
    local.set.mockRejectedValueOnce(new Error("disk full"));
    await expect(repository.save({ token: "new-token", rememberToken: false, gistId: "new-gist" })).rejects.toThrow();
    const reloaded = await new StateRepository(local, session).load();
    expect(reloaded.token).toBeUndefined();
    expect(reloaded.gistId).toBeUndefined();
    expect(reloaded.syncEnabled).toBe(false);
  });

  it("persists an invalidated old connection's Diff when a new token is saved", async () => {
    const local = area({
      firstlight: { storageVersion: 2, connectionVersion: "old", rememberToken: false, gistId: "old-gist" },
      "firstlight.pendingDiff": { id: "old-diff" }
    });
    const session = area({ "firstlight.connectionVersion": "interrupted", "firstlight.token": "new-token" });
    const repository = new StateRepository(local, session);
    const state = await repository.load();
    expect(state.pendingDiff).toBeUndefined();
    await repository.save({ ...state, token: "confirmed-token", gistId: "confirmed-gist" });
    expect(local.values["firstlight.pendingDiff"]).toBeNull();
    expect((await new StateRepository(local, session).load()).pendingDiff).toBeUndefined();
  });

  it("defers historical recovery points without deleting them on a status write", async () => {
    const points = [{ id: "preserve-raw", snapshot: "damaged evidence" }];
    const local = area({ firstlight: { storageVersion: 2 }, "firstlight.recoveryPoints": points });
    const repository = new StateRepository(local, area());
    const state = await repository.load({ deferRecoveryPoints: true });
    expect(local.get.mock.calls[0]).toEqual([["firstlight", "firstlight.notes", "firstlight.pendingDiff"]]);
    expect(state.recoveryPoints).toBeUndefined();
    await repository.save({ ...state, sync: { phase: "local-only", message: "Ready" } });
    expect(local.set.mock.calls[0][0]).not.toHaveProperty("firstlight.recoveryPoints");
    expect(await repository.loadRecoveryPoints()).toEqual(points);
  });
  it("migrates legacy state and preserves all snapshots across a restart", async () => {
    const initial: StoredState = {
      token: "legacy-token",
      notes: [{ id: "a", name: "Title", content: "important", createtime: "date", updatetime: "date" }],
      recoveryPoints: []
    };
    const local = area({ firstlight: initial });
    const session = area();
    const repository = new StateRepository(local, session);
    const state = await repository.load();
    expect(local.set).not.toHaveBeenCalled();
    await repository.save(state);
    expect(local.values.firstlight).not.toHaveProperty("notes");
    expect(local.values["firstlight.notes"]).toEqual(initial.notes);
    expect(await new StateRepository(local, session).load()).toMatchObject(initial);
  });

  it("does not serialize unchanged Notes, diff or recovery points for status-only updates", async () => {
    const local = area();
    const repository = new StateRepository(local, area());
    const state = await repository.load();
    state.notes = [{ id: "a", name: "Large note", content: "x".repeat(1_000_000), createtime: "date", updatetime: "date" }];
    await repository.save(state);
    local.set.mockClear();
    state.sync = { phase: "uploading", message: "Uploading" };
    await repository.save(state);
    expect(Object.keys(local.set.mock.calls[0][0])).toEqual(["firstlight"]);
    expect(JSON.stringify(local.set.mock.calls[0][0]).length).toBeLessThan(1000);
  });

  it("retries all changed fields after a failed write and retains the legacy data", async () => {
    const local = area({ firstlight: { notes: [] } });
    const repository = new StateRepository(local, area());
    const state = await repository.load();
    local.set.mockRejectedValueOnce(new Error("disk full"));
    await expect(repository.save(state)).rejects.toThrow("disk full");
    expect(local.values.firstlight).toEqual({ notes: [] });
    await repository.save(state);
    expect(local.set.mock.calls[1][0]).toHaveProperty("firstlight.notes");
  });

  it("keeps a session token out of persistent storage and forgets it after a browser restart", async () => {
    const local = area({ firstlight: { token: "old-token" } });
    const session = area();
    const repository = new StateRepository(local, session);
    const state = await repository.load();
    state.token = "session-token";
    state.rememberToken = false;
    await repository.save(state);
    expect(JSON.stringify(local.values)).not.toContain('token"');
    expect(await new StateRepository(local, session).load()).toMatchObject({ token: "session-token" });
    expect((await new StateRepository(local, area()).load()).token).toBeUndefined();
    state.token = undefined;
    await repository.save(state);
    expect(session.values["firstlight.token"]).toBeNull();
  });
});
