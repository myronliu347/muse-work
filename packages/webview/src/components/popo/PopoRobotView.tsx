import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Card, Flex, ScrollArea, Spinner, Text } from "@radix-ui/themes";
import type { Message as SdkMessage } from "wave-agent-sdk";
import type { VsCodeApi } from "../../types";
import type {
  MuseApiClient,
  PopoChatDetailResponse,
  PopoChatSummary,
  PopoConfigInfo,
} from "../../muse/apiClient";
import { Message } from "../message/Message";
import { formatRelativeActiveAt } from "../../utils/time";
import "../../styles/PopoRobotView.css";

const POLL_INTERVAL_MS = 2000;

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

const ProcessingIndicator: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <Flex align="center" gap="1" className="popo-processing" data-testid="popo-processing">
    <Spinner size="1" />
    <Text size="1" color="gray">
      处理中…
    </Text>
  </Flex>
);

export const PopoRobotView: React.FC<{ api: MuseApiClient; vscode: VsCodeApi }> = ({
  api,
  vscode,
}) => {
  const [config, setConfig] = useState<PopoConfigInfo | null>(null);
  const [chats, setChats] = useState<PopoChatSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PopoChatDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([api.getPopoConfig(), api.listPopoChats()]);
      setConfig(cfg);
      setChats(list.chats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const openChat = useCallback(
    async (chatKey: string) => {
      setSelectedKey(chatKey);
      try {
        const res = await api.getPopoChat(chatKey);
        setDetail(res);
        setError(null);
      } catch (err) {
        setDetail(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api],
  );

  const processing = detail?.chat.processing ?? false;
  // 任一会话在处理中都需要轮询：列表项 Spinner 与选中详情都要保持更新
  const anyProcessing = processing || chats.some((c) => c.processing);

  // 处理中时轻量轮询刷新（非流式），完成后自动停止。
  useEffect(() => {
    if (!anyProcessing) return;
    const timer = setInterval(() => {
      void (async () => {
        const list = await api.listPopoChats();
        setChats(list.chats);
        if (selectedKey) {
          const res = await api.getPopoChat(selectedKey);
          setDetail(res);
        }
      })().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [api, selectedKey, anyProcessing]);

  // 消息详情自动滚动到底部：打开会话 / 新消息 / 处理中指示器变化时。
  const detailScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = detailScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [detail, processing]);

  return (
    <Flex direction="column" gap="3" className="popo-robot-view" data-testid="popo-robot-view">
      <Flex align="center" justify="between">
        <Text size="5" weight="bold">
          POPO 机器人
        </Text>
        {config &&
          (config.ready ? (
            <Badge color="green">回调就绪</Badge>
          ) : (
            <Badge color="red">回调未就绪</Badge>
          ))}
      </Flex>

      {config && (
        <Card size="1" className="popo-config-card" data-testid="popo-config-card">
          <Flex direction="column" gap="1">
            <Text size="1" color="gray" weight="bold">
              回调配置
            </Text>
            <ConfigRow label="请求地址 URL" value={config.url} />
            <ConfigRow label="token" value={config.token} />
            <ConfigRow label="aesKey" value={config.aesKey} />
            <ConfigRow label="主人账号" value={config.masterUid} copyable={false} />
            <ConfigRow label="回调端口" value={String(config.port)} copyable={false} />
          </Flex>
          {!config.ready && config.error && (
            <Text size="1" color="red" data-testid="popo-not-ready">
              {config.error}
            </Text>
          )}
        </Card>
      )}

      {error && (
        <Text size="1" color="red">
          {error}
        </Text>
      )}

      <Flex gap="3" className="popo-chats-layout">
        <Card size="1" className="popo-chat-list" data-testid="popo-chat-list">
          {chats.length === 0 ? (
            <Text size="1" color="gray">
              暂无会话
            </Text>
          ) : (
            <ScrollArea type="auto" scrollbars="vertical" className="popo-chat-scroll">
              <Flex direction="column" gap="1">
                {chats.map((chat) => (
                  <button
                    key={chat.chatKey}
                    type="button"
                    className={
                      selectedKey === chat.chatKey ? "popo-chat-item active" : "popo-chat-item"
                    }
                    onClick={() => void openChat(chat.chatKey)}
                    data-testid={`popo-chat-${chat.chatKey}`}
                  >
                    <Flex align="center" justify="between" gap="2">
                      <Text size="2" weight="medium" className="popo-chat-title">
                        {chat.title}
                      </Text>
                      {chat.processing && (
                        <Flex align="center" gap="1" className="popo-chat-processing">
                          <Spinner size="1" className="popo-chat-spinner" />
                          <Text size="1" color="gray">
                            处理中
                          </Text>
                        </Flex>
                      )}
                    </Flex>
                    <Text size="1" color="gray" className="popo-chat-last">
                      {chat.lastMessage || "—"}
                    </Text>
                    <Text size="1" color="gray" className="popo-chat-time">
                      {formatRelativeActiveAt(chat.updatedAt)}
                    </Text>
                  </button>
                ))}
              </Flex>
            </ScrollArea>
          )}
        </Card>

        <Card size="1" className="popo-chat-detail" data-testid="popo-chat-detail">
          {detail === null ? (
            <Text size="1" color="gray">
              选择一个会话查看详情
            </Text>
          ) : (
            <Flex direction="column" gap="2" className="popo-detail-body">
              <Flex align="center" justify="between" gap="2">
                <Text size="2" weight="bold">
                  {detail.chat.title}
                </Text>
                {processing && <ProcessingIndicator />}
              </Flex>
              <ScrollArea ref={detailScrollRef} type="auto" className="popo-detail-scroll">
                <Flex direction="column" gap="2">
                  {detail.messages.map((msg, i) => (
                    <Message key={msg.id ?? i} message={msg as SdkMessage} vscode={vscode} />
                  ))}
                  {processing && <ProcessingIndicator />}
                </Flex>
              </ScrollArea>
            </Flex>
          )}
        </Card>
      </Flex>
    </Flex>
  );
};
