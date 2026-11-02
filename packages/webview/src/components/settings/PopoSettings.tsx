import { useEffect, useMemo, useState } from "react";
import { Badge, Flex, Text } from "@radix-ui/themes";
import type { MuseApiClient, PopoConfigInfo } from "../../muse/apiClient";
import { MuseApiClient as Client } from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import "../../styles/PopoRobotView.css";

const ConfigRow: React.FC<{ label: string; value: string; copyable?: boolean }> = ({
  label,
  value,
  copyable = true,
}) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <Flex align="center" justify="between" gap="2" className="popo-config-row">
      <Text size="1" color="gray">
        {label}
      </Text>
      <Flex align="center" gap="1" className="popo-config-value-wrap">
        <Text size="1" className="popo-config-value" title={value}>
          {value}
        </Text>
        {copyable && (
          <button
            type="button"
            className="popo-config-copy"
            onClick={copy}
            aria-label={`复制 ${label}`}
          >
            <i className={`codicon ${copied ? "codicon-check" : "codicon-copy"}`} />
          </button>
        )}
      </Flex>
    </Flex>
  );
};

export const PopoSettings: React.FC<{ api?: MuseApiClient }> = ({ api }) => {
  const client = useMemo(
    () => api ?? new Client({ baseUrl: resolveMuseServerUrl() }),
    [api],
  );
  const [config, setConfig] = useState<PopoConfigInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .getPopoConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setConfig(null);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (error) {
    return (
      <Text size="2" color="red">
        {error}
      </Text>
    );
  }
  if (!config) {
    return (
      <Text size="2" color="gray">
        加载中…
      </Text>
    );
  }

  if (!config.configured) {
    return (
      <Flex direction="column" gap="2" data-testid="popo-settings">
        <Text size="2" color="gray">
          未找到 ~/.popo-config.json。配好之后，主人的私聊和群里 @ 机器人都会进灵光。
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2" data-testid="popo-settings">
      <Flex align="center" justify="between">
        <Text size="2" weight="bold">
          回调配置
        </Text>
        {config.ready ? (
          <Badge color="green">回调就绪</Badge>
        ) : (
          <Badge color="red">回调未就绪</Badge>
        )}
      </Flex>
      <ConfigRow label="请求地址 URL" value={config.url} />
      <ConfigRow label="token" value={config.token} />
      <ConfigRow label="aesKey" value={config.aesKey} />
      <ConfigRow label="主人账号" value={config.masterUid} copyable={false} />
      <ConfigRow label="回调端口" value={String(config.port)} copyable={false} />
      {!config.ready && config.error && (
        <Text size="1" color="red" data-testid="popo-not-ready">
          {config.error}
        </Text>
      )}
    </Flex>
  );
};
