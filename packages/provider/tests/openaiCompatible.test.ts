import { describe, it, expect } from "vitest";
import { createOpenAiCompatibleProvider } from "../src/openaiCompatible.js";

describe("openaiCompatible provider", () => {
  it("lists configured models", async () => {
    const p = createOpenAiCompatibleProvider({
      getConfig: () => ({
        enabled: true,
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        models: [
          { id: "gpt-4.1", label: "GPT-4.1" },
          { id: "gpt-4.1-mini", label: "Mini" },
        ],
      }),
      getApiKey: () => "sk-test",
    });
    const models = await p.listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
  });

  it("resolveGateway returns bearer-ready config", async () => {
    const p = createOpenAiCompatibleProvider({
      getConfig: () => ({
        enabled: true,
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
      }),
      getApiKey: () => "sk-test",
    });
    const g = await p.resolveGateway("gpt-4.1");
    expect(g.baseURL).toBe("https://api.example.com/v1");
    expect(g.apiKey).toBe("sk-test");
    expect(g.model).toBe("gpt-4.1");
  });

  it("needs_config when api key missing", async () => {
    const p = createOpenAiCompatibleProvider({
      getConfig: () => ({
        enabled: true,
        baseURL: "https://api.example.com/v1",
        models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
      }),
      getApiKey: () => undefined,
    });
    const s = await p.getAuthStatus();
    expect(s.state).toBe("needs_config");
  });
});
