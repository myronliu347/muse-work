import type { Page } from "@playwright/test";

/**
 * Stub Muse HTTP endpoints used by ConfigDialog tabs (provider).
 * E2E pass-through disables hostBridge, so settings panels hit the real URL
 * unless we fulfill these routes.
 */
export async function mockMuseSettingsApis(page: Page): Promise<void> {
  await page.route("**/settings", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 1 }),
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
            id: "deepseek",
            displayName: "DeepSeek",
            models: [{ id: "deepseek-flash", label: "DeepSeek Flash" }],
          },
          {
            id: "openai-compatible",
            displayName: "OpenAI Compatible",
            models: [{ id: "gpt-4o", label: "GPT-4o" }],
          },
        ],
        active: { providerId: "deepseek", modelId: "deepseek-flash" },
      }),
    });
  });

  await page.route("**/providers/deepseek/quota", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        is_available: true,
        balance_infos: [
          {
            currency: "CNY",
            total_balance: "100.00",
            granted_balance: "100.00",
            topped_up_balance: "0.00",
          },
        ],
      }),
    });
  });

  await page.route("**/settings/tavily", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: false, source: "none" }),
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
