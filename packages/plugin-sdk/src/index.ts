import type { AiProvider } from "@muse-work/provider";

export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface AssistantTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<{
    success: boolean;
    content: string;
    error?: string;
  }>;
}

export interface AssistantApp {
  /** Channel id claimed on SendMessage, for example `popo`. */
  id: string;
  /** One line added to the SendMessage description. */
  description: string;
  /** Appended after the core assistant prompt. */
  prompt?: string;
  send(args: Record<string, unknown>): Promise<{
    success: boolean;
    content: string;
    error?: string;
    /** Present when this outbound line should appear in the Muse chat log. */
    line?: { app: string; message: string; msgIds?: string[] };
  }>;
}

export interface SettingsField {
  label: string;
  value: string;
  copyable?: boolean;
}

export interface SettingsPanel {
  id: string;
  /** Tab label. */
  title: string;
  /** Heading inside the tab. The tab title is not repeated when this is absent. */
  heading?: string;
  ready?: boolean;
  readyLabel?: string;
  pendingLabel?: string;
  error?: string | null;
  /** Shown when the plugin is loaded but not configured. */
  empty?: string;
  fields?: SettingsField[];
}

export interface PluginContext {
  home: string;
  /** Requested main server port. `0` means the OS chooses one. */
  requestedMainPort: number;
  logger: PluginLogger;
  registerProvider(provider: AiProvider): void;
  route(handle: (request: Request) => Promise<Response>): void;
  assistant: {
    registerApp(app: AssistantApp): void;
    registerTool(tool: AssistantTool): void;
    recordInbound(event: { app: string; message: string }): void;
    enqueue(event: {
      type: "chat";
      from: string;
      message: string;
      user?: string;
      groupId?: string;
    }): void;
  };
  settings: {
    register(panel: SettingsPanel): void;
  };
}

export interface MusePlugin {
  id: string;
  register(ctx: PluginContext): void | Promise<void>;
  start?(ctx: PluginContext): void | Promise<void>;
}
