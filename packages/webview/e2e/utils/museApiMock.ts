import type { Page } from "@playwright/test";

/**
 * Stub Muse HTTP endpoints used by ConfigDialog tabs (plugins / provider).
 * E2E pass-through disables hostBridge, so settings panels hit the real URL
 * unless we fulfill these routes.
 */
export async function mockMuseSettingsApis(page: Page): Promise<void> {
  await page.route("**/settings", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          plugins: { superpowers: true },
        }),
      });
      return;
    }
    if (route.request().method() === "PUT" || route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        plugins?: { superpowers?: boolean };
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          plugins: {
            superpowers: body?.plugins?.superpowers ?? true,
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/providers", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          {
            id: "codemaker",
            displayName: "CodeMaker",
            models: [
              { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
              { id: "glm-5.2", label: "GLM 5.2" },
            ],
          },
          {
            id: "openai-compatible",
            displayName: "OpenAI Compatible",
            models: [{ id: "gpt-4o", label: "GPT-4o" }],
          },
        ],
        active: { providerId: "codemaker", modelId: "deepseek-v4-flash" },
      }),
    });
  });

  await page.route("**/providers/codemaker/quota", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: "demo@example.com",
        total: 100,
        used: 12.5,
        remaining: 87.5,
        percentage: 12.5,
      }),
    });
  });

  await page.route("**/providers/openai-compatible", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        hasApiKey: true,
        hasStoredApiKey: true,
        models: [{ id: "gpt-4o", label: "GPT-4o" }],
      }),
    });
  });
}
