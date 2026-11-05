import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginDialog } from "../../src/components/dialogs/LoginDialog";

describe("LoginDialog", () => {
  it("renders the re-login copy and both buttons", () => {
    render(
      <LoginDialog
        isAuthenticated={false}
        onLogin={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/账号/)).toBeInTheDocument();
    expect(screen.getByTestId("login-dialog-login")).toHaveTextContent(
      "去登录",
    );
    expect(screen.getByTestId("login-dialog-cancel")).toHaveTextContent("取消");
  });

  it("calls onLogin and shows the waiting hint when 去登录 is clicked", () => {
    const onLogin = vi.fn();
    render(
      <LoginDialog
        isAuthenticated={false}
        onLogin={onLogin}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("login-dialog-login"));

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/请在浏览器中完成登录/)).toBeInTheDocument();
    expect(screen.getByTestId("login-dialog-login")).toBeDisabled();
  });

  it("calls onCancel when 取消 is clicked", () => {
    const onCancel = vi.fn();
    render(
      <LoginDialog
        isAuthenticated={false}
        onLogin={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId("login-dialog-cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not auto-close when opened while still locally authenticated", () => {
    const onCancel = vi.fn();
    render(
      <LoginDialog isAuthenticated onLogin={vi.fn()} onCancel={onCancel} />,
    );

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("login-dialog-overlay")).toBeInTheDocument();
  });

  it("auto-closes once authenticated after 去登录", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <LoginDialog
        isAuthenticated={false}
        onLogin={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId("login-dialog-login"));
    rerender(
      <LoginDialog isAuthenticated onLogin={vi.fn()} onCancel={onCancel} />,
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the failure message and re-enables retry when login fails", () => {
    const onLogin = vi.fn();
    const { rerender } = render(
      <LoginDialog
        isAuthenticated={false}
        onLogin={onLogin}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("login-dialog-login"));
    rerender(
      <LoginDialog
        isAuthenticated={false}
        loginError="login timed out"
        onLogin={onLogin}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/login timed out/)).toBeInTheDocument();
    expect(screen.getByTestId("login-dialog-login")).not.toBeDisabled();
  });
});
