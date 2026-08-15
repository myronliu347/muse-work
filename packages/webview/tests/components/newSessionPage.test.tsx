/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewSessionPage } from "../../src/components/chat/NewSessionPage";

describe("NewSessionPage", () => {
  it("renders welcome above composer inside a dedicated page shell", () => {
    render(
      <NewSessionPage
        welcome={<div data-testid="welcome-slot">欢迎</div>}
        composer={<div data-testid="composer-slot">输入框</div>}
      />,
    );
    const page = screen.getByTestId("new-session-page");
    expect(page).toBeInTheDocument();
    expect(screen.getByTestId("welcome-slot")).toBeInTheDocument();
    expect(screen.getByTestId("composer-slot")).toBeInTheDocument();
    const html = page.innerHTML;
    expect(html.indexOf("welcome-slot")).toBeLessThan(
      html.indexOf("composer-slot"),
    );
  });
});
