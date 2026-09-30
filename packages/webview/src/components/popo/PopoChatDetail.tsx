import { useCallback, useEffect, useRef, useState } from "react";
import { Flex, ScrollArea, Spinner, Text } from "@radix-ui/themes";
import type { Message as SdkMessage } from "@muse-work/agent";
import type { VsCodeApi } from "../../types";
import type {
  MuseApiClient,
  PopoChatDetailResponse,
} from "../../muse/apiClient";
import { Message } from "../message/Message";
import "../../styles/PopoRobotView.css";

const POLL_INTERVAL_MS = 2000;

const ProcessingIndicator: React.FC<{ compact?: boolean }> = () => (
  <Flex align="center" gap="1" className="popo-processing" data-testid="popo-processing">
    <Spinner size="1" />
    <Text size="1" color="gray">
      处理中…
    </Text>
  </Flex>
);

export const PopoChatDetail: React.FC<{
  api: MuseApiClient;
  vscode: VsCodeApi;
  chatKey: string;
}> = ({ api, vscode, chatKey }) => {
  const [detail, setDetail] = useState<PopoChatDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getPopoChat(chatKey);
      setDetail(res);
      setError(null);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api, chatKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.command !== "popo:changed") return;
      void load();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  const processing = detail?.chat.processing ?? false;

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [processing, load]);

  useEffect(() => {
    const el = detailScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail, processing]);

  return (
    <Flex
      direction="column"
      gap="2"
      className="popo-chat-detail-view"
      data-testid="popo-chat-detail"
    >
      {error && (
        <Text size="1" color="red">
          {error}
        </Text>
      )}
      {detail === null && !error ? (
        <Text size="1" color="gray">
          加载中…
        </Text>
      ) : detail ? (
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
      ) : null}
    </Flex>
  );
};
