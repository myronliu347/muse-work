import { describe, expect, it, vi } from "vitest";
import { createProvidersCatalog } from "../src/services/providersCatalog.js";

function fakeContext(modelsById: Record<string, string[][]>) {
  const calls: string[] = [];
  const list = Object.keys(modelsById).map((id) => ({
    id,
    displayName: id,
    async listModels() {
      calls.push(id);
      const next = modelsById[id]!.shift() ?? modelsById[id]![0] ?? [];
      return next.map((modelId) => ({ id: modelId, label: modelId }));
    },
  }));
  const broadcastAll = vi.fn();
  const ctx = {
    registry: {
      list: () => list,
      get: (id: string) => list.find((provider) => provider.id === id),
      getActive: () => ({ providerId: list[0]!.id, modelId: "m1" }),
    },
    hub: { broadcastAll },
  };
  return { ctx, calls, broadcastAll };
}

describe("createProvidersCatalog", () => {
  it("refreshes only the active provider", async () => {
    const { ctx, calls } = fakeContext({
      deepseek: [["a"], ["a"]],
      codex: [["c"], ["c"]],
    });
    const catalog = createProvidersCatalog(ctx as never);
    await catalog.refreshActive();
    expect(calls).toEqual(["deepseek"]);
    expect(catalog.snapshot().providers.map((p) => p.models.length)).toEqual([1, 0]);
  });

  it("broadcasts only when the active provider's models change", async () => {
    const { ctx, broadcastAll } = fakeContext({
      deepseek: [["a"], ["a"], ["b"]],
    });
    const catalog = createProvidersCatalog(ctx as never);
    await catalog.refreshActive();
    expect(broadcastAll).toHaveBeenCalledTimes(1);
    await catalog.refreshActive();
    expect(broadcastAll).toHaveBeenCalledTimes(1);
    await catalog.refreshActive();
    expect(broadcastAll).toHaveBeenCalledTimes(2);
    expect(broadcastAll).toHaveBeenLastCalledWith({ type: "providers:changed" });
  });

  it("treats an invalidated cache as stale", async () => {
    const { ctx } = fakeContext({ deepseek: [["a"]] });
    const catalog = createProvidersCatalog(ctx as never);
    await catalog.refreshActive();
    expect(catalog.stale("deepseek")).toBe(false);
    catalog.invalidate();
    expect(catalog.stale("deepseek")).toBe(true);
  });
});
