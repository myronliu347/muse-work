import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HostPluginPanel } from "../../../src/components/settings/HostPluginPanel";

describe("HostPluginPanel", () => {
  it("renders declared fields", () => {
    render(
      <HostPluginPanel
        panel={{
          id: "channel",
          title: "频道",
          fields: [
            { label: "请求地址", value: "http://10.0.0.1:3100/callback" },
            { label: "主人账号", value: "me@corp.netease.com", copyable: false },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("plugin-panel-channel")).toBeInTheDocument();
    expect(screen.getByText("http://10.0.0.1:3100/callback")).toBeInTheDocument();
    expect(screen.getByText("me@corp.netease.com")).toBeInTheDocument();
    expect(screen.getByLabelText("复制 请求地址")).toBeInTheDocument();
    expect(screen.queryByLabelText("复制 主人账号")).toBeNull();
  });

  it("shows the callback heading and ready badge", () => {
    render(
      <HostPluginPanel
        panel={{
          id: "channel",
          title: "频道",
          heading: "回调配置",
          ready: true,
          readyLabel: "回调就绪",
          pendingLabel: "回调未就绪",
          fields: [{ label: "回调端口", value: "3100", copyable: false }],
        }}
      />,
    );
    expect(screen.getByText("回调配置")).toBeInTheDocument();
    expect(screen.getByText("回调就绪")).toBeInTheDocument();
    expect(screen.queryByText("频道")).toBeNull();
  });

  it("shows the empty-state copy when the plugin declares no fields", () => {
    render(
      <HostPluginPanel
        panel={{
          id: "channel",
          title: "频道",
          empty: "未找到配置。",
          fields: [],
        }}
      />,
    );
    expect(screen.getByText("未找到配置。")).toBeInTheDocument();
  });
});
