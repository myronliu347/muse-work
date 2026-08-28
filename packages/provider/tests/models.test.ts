import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEMAKER_MODELS_API_URL,
  CODEMAKER_MODELS_CACHE_TTL_MS,
  createCodeMakerModelsLoader,
  getCodeMakerModelsCachePath,
  mergeModels,
  parseRemoteModels,
  sortModels,
} from "../src/codemaker/models.js";
import type { ModelInfo } from "../src/types.js";

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-cm-models-"));
}

const remotePayload = {
  "netease-codemaker": {
    models: {
      "deepseek-v4-flash-vision-exp": {
        id: "deepseek-v4-flash-vision-exp",
        name: "Deepseek V4 Flash Vision Exp",
        attachment: false,
        reasoning: true,
        modalities: { input: ["image", "text"], output: ["text"] },
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        attachment: false,
        reasoning: true,
        modalities: { input: ["text"], output: ["text"] },
      },
      "glm-5.3": {
        id: "glm-5.3",
        name: "GLM 5.3",
        attachment: false,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
};

describe("parseRemoteModels", () => {
  it("maps id/name and vision/thinking capabilities", () => {
    const models = parseRemoteModels(remotePayload);
    expect(models).toEqual([
      {
        id: "deepseek-v4-flash-vision-exp",
        label: "Deepseek V4 Flash Vision Exp",
        capabilities: { vision: true, thinking: true },
      },
      {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        capabilities: { thinking: true },
      },
      { id: "glm-5.3", label: "GLM 5.3" },
    ]);
  });

  it("treats attachment=true as vision even without image modality", () => {
    const models = parseRemoteModels({
      "netease-codemaker": {
        models: {
          "grok-4.5-zen": {
            id: "grok-4.5-zen",
            name: "Grok 4.5 Zen",
            attachment: true,
            reasoning: true,
          },
        },
      },
    });
    expect(models[0].capabilities).toEqual({ vision: true, thinking: true });
  });

  it("skips entries without a valid id and tolerates malformed payloads", () => {
    expect(parseRemoteModels(null)).toEqual([]);
    expect(parseRemoteModels({})).toEqual([]);
    expect(parseRemoteModels({ "netease-codemaker": {} })).toEqual([]);
    expect(
      parseRemoteModels({
        "netease-codemaker": {
          models: {
            "": { id: "", name: "Empty" },
            "ok-model": { id: "ok-model", name: "OK" },
          },
        },
      }),
    ).toEqual([{ id: "ok-model", label: "OK" }]);
  });

  it("falls back to id as label when name is missing", () => {
    const models = parseRemoteModels({
      "netease-codemaker": {
        models: { "no-name": { id: "no-name" } },
      },
    });
    expect(models).toEqual([{ id: "no-name", label: "no-name" }]);
  });
});

describe("mergeModels", () => {
  const remote: ModelInfo[] = [
    {
      id: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash (remote)",
      capabilities: { vision: true },
    },
  ];
  const local: ModelInfo[] = [
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "my-custom-model", label: "My Custom Model" },
  ];

  it("remote wins for shared ids and local-only models are preserved", () => {
    const merged = mergeModels(remote, local);
    expect(merged).toEqual([
      {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash (remote)",
        capabilities: { vision: true },
      },
      { id: "my-custom-model", label: "My Custom Model" },
    ]);
  });

  it("returns remote list unchanged when local is empty", () => {
    expect(mergeModels(remote, [])).toEqual(remote);
  });
});

describe("sortModels", () => {
  it("pins deepseek models to the top and sorts the rest by label", () => {
    const sorted = sortModels([
      { id: "glm-5.3", label: "GLM 5.3" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "deepseek-v4-flash-vision-exp", label: "Deepseek V4 Flash Vision Exp" },
      { id: "gpt-5.4", label: "GPT-5.4" },
    ]);
    expect(sorted.map((m) => m.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "claude-sonnet-4-6",
      "glm-5.3",
      "gpt-5.4",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [{ id: "b", label: "B" }, { id: "a", label: "A" }];
    sortModels(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("createCodeMakerModelsLoader", () => {
  it("fetches remote models and caches to disk", async () => {
    const home = makeTempHome();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(remotePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const loader = createCodeMakerModelsLoader({
      home,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const models = await loader.list();
    expect(models).not.toBeNull();
    expect(models!.map((m) => m.id)).toContain("deepseek-v4-flash-vision-exp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      CODEMAKER_MODELS_API_URL,
      expect.objectContaining({ headers: expect.any(Object) }),
    );

    // Disk cache written.
    const cachePath = getCodeMakerModelsCachePath(home);
    expect(fs.existsSync(cachePath)).toBe(true);
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    expect(cached.models).toHaveLength(3);
    expect(typeof cached.fetchedAt).toBe("number");

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("serves from memory cache without refetching within TTL", async () => {
    const home = makeTempHome();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(remotePayload), { status: 200 }),
    );
    const loader = createCodeMakerModelsLoader({
      home,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 1_000,
    });

    await loader.list();
    await loader.list();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("serves from disk cache without refetching within TTL", async () => {
    const home = makeTempHome();
    const cachePath = getCodeMakerModelsCachePath(home);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: 1_000, models: [{ id: "cached", label: "C" }] }),
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("should not fetch when disk cache is fresh");
    });
    const loader = createCodeMakerModelsLoader({
      home,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 2_000, // within 5min TTL of fetchedAt=1000
    });

    const models = await loader.list();
    expect(models).toEqual([{ id: "cached", label: "C" }]);
    expect(fetchMock).not.toHaveBeenCalled();

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("refetches after TTL expires and falls back to null on failure", async () => {
    const home = makeTempHome();
    const cachePath = getCodeMakerModelsCachePath(home);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: 1_000,
        models: [{ id: "stale", label: "Stale" }],
      }),
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const loader = createCodeMakerModelsLoader({
      home,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 1_000 + CODEMAKER_MODELS_CACHE_TTL_MS + 1,
    });

    // Stale disk cache → refetch → fetch fails → null.
    expect(await loader.list()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("returns null for non-ok responses and empty catalogs", async () => {
    const home = makeTempHome();
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    const loader = createCodeMakerModelsLoader({
      home,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await loader.list()).toBeNull();

    const empty = createCodeMakerModelsLoader({
      home,
      fetch: (async () =>
        new Response(JSON.stringify({ "netease-codemaker": { models: {} } }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    expect(await empty.list()).toBeNull();

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("deduplicates concurrent list() calls into a single fetch", async () => {
    const home = makeTempHome();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify(remotePayload), { status: 200 });
    });
    const loader = createCodeMakerModelsLoader({
      home,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const [a, b] = await Promise.all([loader.list(), loader.list()]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(calls).toBe(1);

    fs.rmSync(home, { recursive: true, force: true });
  });
});
