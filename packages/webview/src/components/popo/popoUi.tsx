import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MuseApiClient, PopoChatSummary } from "../../muse/apiClient";

const POLL_INTERVAL_MS = 2000;

export interface PopoUiValue {
  enabled: boolean;
  chats: PopoChatSummary[];
  selectedChatKey: string | null;
  selectChat: (chatKey: string | null) => void;
  deleteChat: (chatKey: string) => Promise<void>;
}

const PopoUiContext = createContext<PopoUiValue | null>(null);

export function PopoUiProvider({
  api,
  children,
}: {
  api: MuseApiClient;
  children: ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);
  const [chats, setChats] = useState<PopoChatSummary[]>([]);
  const [selectedChatKey, setSelectedChatKey] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPopoConfig()
      .then((cfg) => setEnabled(Boolean(cfg.configured)))
      .catch(() => setEnabled(false));
  }, [api]);

  const refreshChats = useCallback(async () => {
    const list = await api.listPopoChats();
    setChats(list.chats);
  }, [api]);

  useEffect(() => {
    if (!enabled) return;
    void refreshChats().catch(() => undefined);
  }, [enabled, refreshChats]);

  const anyProcessing = chats.some((c) => c.processing);
  useEffect(() => {
    if (!enabled || !anyProcessing) return;
    const timer = setInterval(() => {
      void refreshChats().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, anyProcessing, refreshChats]);

  const deleteChat = useCallback(
    async (chatKey: string) => {
      await api.deletePopoChat(chatKey);
      setSelectedChatKey((current) => (current === chatKey ? null : current));
      await refreshChats();
    },
    [api, refreshChats],
  );

  const value = useMemo<PopoUiValue>(
    () => ({
      enabled,
      chats,
      selectedChatKey,
      selectChat: setSelectedChatKey,
      deleteChat,
    }),
    [enabled, chats, selectedChatKey, deleteChat],
  );

  return (
    <PopoUiContext.Provider value={value}>{children}</PopoUiContext.Provider>
  );
}

const EMPTY: PopoUiValue = {
  enabled: false,
  chats: [],
  selectedChatKey: null,
  selectChat: () => undefined,
  deleteChat: async () => undefined,
};

export function usePopoUi(): PopoUiValue {
  return useContext(PopoUiContext) ?? EMPTY;
}
