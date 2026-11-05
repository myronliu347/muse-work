import { useState } from "react";
import { Badge, Flex, Text } from "@radix-ui/themes";
import type { HostPluginSettingsPanel } from "../../muse/apiClient";
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

export const HostPluginPanel: React.FC<{ panel: HostPluginSettingsPanel }> = ({
  panel,
}) => {
  const fields = panel.fields ?? [];
  if (fields.length === 0) {
    return (
      <Flex direction="column" gap="2" data-testid={`plugin-panel-${panel.id}`}>
        <Text size="2" color="gray">
          {panel.empty ?? ""}
        </Text>
      </Flex>
    );
  }
  const ready = panel.ready === true;
  return (
    <Flex direction="column" gap="2" data-testid={`plugin-panel-${panel.id}`}>
      <Flex align="center" justify="between">
        <Text size="2" weight="bold">
          {panel.heading ?? panel.title}
        </Text>
        {typeof panel.ready === "boolean" ? (
          ready ? (
            <Badge color="green">{panel.readyLabel ?? "已就绪"}</Badge>
          ) : (
            <Badge color="red">{panel.pendingLabel ?? "未就绪"}</Badge>
          )
        ) : null}
      </Flex>
      {fields.map((field) => (
        <ConfigRow
          key={field.label}
          label={field.label}
          value={field.value}
          copyable={field.copyable !== false}
        />
      ))}
      {panel.error ? (
        <Text size="1" color="red">
          {panel.error}
        </Text>
      ) : null}
    </Flex>
  );
};
