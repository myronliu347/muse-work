import { useCallback, useEffect, useState } from "react";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import type { Message as SdkMessage } from "@muse-work/agent";
import type { VsCodeApi } from "../../types";
import type {
  MuseApiClient,
  PopoChatDetailResponse,
} from "../../muse/apiClient";
import { MessageList } from "../chat/MessageList";
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

  return (
    <Flex
      direction="column"
      className="popo-chat-detail-view"
      data-testid="popo-chat-detail"
    >
      {detail ? (
        <Flex
          align="center"
          justify="between"
          gap="2"
          className="popo-detail-header"
          data-testid="popo-detail-header"
        >
          <Text size="2" weight="bold" className="popo-detail-title">
            {detail.chat.title}
          </Text>
          {processing && <ProcessingIndicator />}
        </Flex>
      ) : null}
      {error && (
        <Text size="1" color="red" className="popo-detail-error">
          {error}
        </Text>
      )}
      {detail === null && !error ? (
        <Text size="1" color="gray" className="popo-detail-loading">
          加载中…
        </Text>
      ) : detail ? (
        <MessageList
          messages={detail.messages as SdkMessage[]}
          isStreaming={processing}
          vscode={vscode}
        />
      ) : null}
    </Flex>
  );
};
