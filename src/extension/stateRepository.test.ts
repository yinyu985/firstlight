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
