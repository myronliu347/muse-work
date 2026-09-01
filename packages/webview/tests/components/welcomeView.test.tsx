/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WelcomeView from "../../src/components/chat/WelcomeView";
import { MuseTheme } from "../../src/ui/theme";
import { WELCOME_PROMPTS } from "../../src/components/chat/welcomePrompts";

function renderWelcome(
  props: Partial<React.ComponentProps<typeof WelcomeView>> = {},
) {
  return render(
    <MuseTheme>
      <WelcomeView
        isAuthenticated
        hasDirectConnectConfig={false}
        onLogin={vi.fn()}
        {...props}
      />
    </MuseTheme>,
  );
}

describe("WelcomeView", () => {
  it("renders the headline and four prompt cards", () => {
    renderWelcome({ embedded: true });
    expect(screen.getByTestId("welcome-headline")).toHaveTextContent(
      "今天想在 Muse 里做什么？",
    );
    for (const card of WELCOME_PROMPTS) {
      expect(screen.getByTestId(`welcome-card-${card.id}`)).toHaveTextContent(
        card.title,
      );
    }
  });

  it("fills the composer via onSelectPrompt when a card is clicked", () => {
    const onSelectPrompt = vi.fn();
    renderWelcome({ embedded: true, onSelectPrompt });
    fireEvent.click(screen.getByTestId("welcome-card-explore"));
    expect(onSelectPrompt).toHaveBeenCalledWith(WELCOME_PROMPTS[0]!.prompt);
  });

  it("shows the login CTA when unauthenticated without direct-connect", () => {
    renderWelcome({ isAuthenticated: false, embedded: true });
    expect(screen.getByText("登 录")).toBeInTheDocument();
    expect(screen.getByText("登录后即可开始使用~")).toBeInTheDocument();
  });

  it("does not paint a wallpaper outside the new-session page", () => {
    renderWelcome({ embedded: false });
    expect(screen.getByTestId("welcome-view")).toBeInTheDocument();
    expect(
      screen.getByTestId("welcome-view").querySelector(".welcome-view-wallpaper"),
    ).toBeNull();
  });
});
