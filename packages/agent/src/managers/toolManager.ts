import type { ToolContext, ToolPlugin, ToolResult } from "../tools/types.js";
import { bashTool } from "../tools/bashTool.js";
import { taskStopTool } from "../tools/taskStopTool.js";
import { editTool } from "../tools/editTool.js";
import { writeTool } from "../tools/writeTool.js";
import { askUserQuestionTool } from "../tools/askUserQuestion.js";
import { webFetchTool } from "../tools/webFetchTool.js";
import { workflowTool } from "../tools/workflowTool.js";
// New tools
import { globTool } from "../tools/globTool.js";
import { grepTool } from "../tools/grepTool.js";
import { readTool } from "../tools/readTool.js";
import { lspTool } from "../tools/lspTool.js";
import { agentTool } from "../tools/agentTool.js";
import { skillTool } from "../tools/skillTool.js";
import {
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
} from "../tools/taskManagementTools.js";
import { McpManager } from "./mcpManager.js";
import { PermissionManager } from "./permissionManager.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import type {
  PermissionMode,
  PermissionCallback,
  ILspManager,
} from "../types/index.js";
import type { SubagentManager } from "./subagentManager.js";
import type { SkillManager } from "./skillManager.js";

import { ReversionManager } from "./reversionManager.js";
import * as aiService from "../services/aiService.js";

import { Container } from "../utils/container.js";
import { appendMemoryCapNotice } from "../utils/memoryCapNotices.js";
import { validateToolInput } from "../tools/inputValidation.js";
import { isLeanPromptEnabled } from "../services/leanPrompt.js";

import { logger } from "../utils/globalLogger.js";

import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { SkillMetadata } from "../types/skills.js";

export interface ToolManagerOptions {
  container: Container;
  /** Optional list of tool names to enable */
  tools?: string[];
  /** Custom tools to register alongside built-in tools */
  customTools?: ToolPlugin[];
}

/**
 * Tool Manager
 *
 * Manages tool registration and execution with optional permission system integration.
 * Supports both built-in tools and MCP (Model Context Protocol) tools.
 */
class ToolManager {
  private toolsRegistry = new Map<string, ToolPlugin>();
  /**
   * Built-in tools, by object identity rather than by name: a custom tool that
   * shadows a built-in name must not inherit its schema check.
   */
  private builtInTools = new WeakSet<ToolPlugin>();
  private tools?: string[];
  private customTools?: ToolPlugin[];
  private container: Container;

  constructor(options: ToolManagerOptions) {
    this.container = options.container;
    this.tools = options.tools;
    this.customTools = options.customTools;
  }

  private get mcpManager(): McpManager {
    return this.container.get<McpManager>("McpManager")!;
  }

  /**
   * Register a new tool.
   *
   * `options.builtIn` marks a tool whose parameter schema is this runtime's
   * own contract, and whose calls are therefore checked against it. Custom
   * tools are not checked: their schema is theirs to enforce.
   */
  public register(tool: ToolPlugin, options?: { builtIn?: boolean }): void {
    this.toolsRegistry.set(tool.name, tool);
    if (options?.builtIn === true) {
      this.builtInTools.add(tool);
    }
  }

  /**
   * Initialize built-in tools. Can be called with dependencies for tools that require them.
   *
   * This method can be called multiple times safely. When called without dependencies,
   * it registers basic tools (Bash, Read, Write, TaskCreate, etc.). When called with
   * dependencies, it also registers tools that require managers (Agent, Skill).
   *
   * @param deps Optional dependencies for advanced tools
   * @param deps.subagentManager SubagentManager instance for Agent tool
   * @param deps.skillManager SkillManager instance for Skill tool
   *
   * @example
   * ```typescript
   * // Initialize basic tools only
   * toolManager.initializeBuiltInTools();
   *
   * // Initialize all tools including those requiring dependencies
   * toolManager.initializeBuiltInTools({
   *   subagentManager: mySubagentManager,
   *   skillManager: mySkillManager
   * });
   * ```
   */
  public initializeBuiltInTools(): void {
    const builtInTools = [
      bashTool,
      taskStopTool,
      editTool,
      writeTool,
      askUserQuestionTool,
      globTool,
      grepTool,
      readTool,
      lspTool,
      agentTool,
      skillTool,
      taskCreateTool,
      taskGetTool,
      taskUpdateTool,
      taskListTool,
      webFetchTool,
      workflowTool,
    ];

    for (const tool of builtInTools) {
      if (this.shouldEnableTool(tool.name)) {
        this.register(tool, { builtIn: true });
      }
    }

    // Register custom tools
    for (const tool of this.customTools || []) {
      if (this.shouldEnableTool(tool.name)) {
        this.toolsRegistry.set(tool.name, tool);
      }
    }
  }

  /**
   * Re-evaluate gated built-in tools after a live configuration reload.
   */
  public reloadFeatureGatedTools(): void {
    this.initializeBuiltInTools();
  }

  /**
   * Check if a tool should be enabled based on tools configuration and permission rules
   */
  private shouldEnableTool(name: string): boolean {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");

    // If tool is explicitly denied by name in permission rules, filter it out
    if (permissionManager?.isToolDenied(name)) {
      return false;
    }

    if (!this.tools) {
      return true;
    }
    return this.tools.some(
      (toolName) => toolName.toLowerCase() === name.toLowerCase(),
    );
  }

  /**
   * The auto-memory directory for this session, or undefined when the feature
   * is off. Consumers (Read) treat "unset" as "not a memory file".
   */
  private resolveAutoMemoryDir(workdir: string): string | undefined {
    if (!this.container.has("MemoryService")) return undefined;
    const configuration = this.container.has("ConfigurationService")
      ? this.container.get<
          import("../services/configurationService.js").ConfigurationService
        >("ConfigurationService")
      : undefined;
    if (!configuration?.resolveAutoMemoryEnabled?.()) return undefined;
    return this.container
      .get<import("../services/memory.js").MemoryService>("MemoryService")
      ?.getAutoMemoryDirectory?.(workdir);
  }

  /**
   * Execute a tool by name with the provided arguments and context
   *
   * Enhances the context with permission-related fields before execution:
   * - permissionMode: The current permission mode (default or bypassPermissions)
   * - canUseToolCallback: Custom permission callback if provided
   * - permissionManager: The PermissionManager instance for permission checks
   *
   * @param name - Name of the tool to execute
   * @param args - Arguments to pass to the tool
   * @param context - Execution context for the tool
   * @returns Promise resolving to the tool execution result
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    // Resolve effective permission mode (CLI override > configuration > default)
    const effectivePermissionMode = permissionManager
      ? permissionManager.getCurrentEffectiveMode(permissionMode)
      : permissionMode || "default";

    // Enhance context with permission-related fields
    const canUseToolCallback = this.container.has("CanUseToolCallback")
      ? this.container.get<PermissionCallback>("CanUseToolCallback")
      : undefined;

    const enhancedContext: ToolContext = {
      ...context,
      permissionMode: effectivePermissionMode,
      canUseToolCallback,
      permissionManager,
      toolManager: this,
      taskManager:
        this.container.get<import("../services/taskManager.js").TaskManager>(
          "TaskManager",
        )!,
      reversionManager:
        this.container.get<ReversionManager>("ReversionManager")!,
      backgroundTaskManager: this.container.get<
        import("./backgroundTaskManager.js").BackgroundTaskManager
      >("BackgroundTaskManager")!,
      foregroundTaskManager: this.container.get<
        import("../types/processes.js").IForegroundTaskManager
      >("ForegroundTaskManager")!,
      mcpManager: this.mcpManager,
      lspManager: this.container.get<ILspManager>("LspManager")!,
      subagentManager: this.container.has("SubagentManager")
        ? this.container.get<SubagentManager>("SubagentManager")
        : undefined,
      skillManager: this.container.has("SkillManager")
        ? this.container.get<SkillManager>("SkillManager")
        : undefined,
      aiManager: this.container.has("AIManager")
        ? this.container.get<import("./aiManager.js").AIManager>("AIManager")
        : undefined,
      aiService: aiService,
      messageManager:
        this.container.get<import("./messageManager.js").MessageManager>(
          "MessageManager",
        )!,
      hookManager: this.container.has("HookManager")
        ? this.container.get<import("./hookManager.js").HookManager>(
            "HookManager",
          )
        : undefined,
      workflowManager: this.container.has("WorkflowManager")
        ? this.container.get<import("./workflowManager.js").WorkflowManager>(
            "WorkflowManager",
          )
        : undefined,
      sessionEnv: this.container.has("ConfigurationService")
        ? this.container
            .get<
              import("../services/configurationService.js").ConfigurationService
            >("ConfigurationService")
            ?.getMergedEnv?.()
        : undefined,
      autoMemoryDir: this.resolveAutoMemoryDir(context.workdir),
      sessionId: context.sessionId,
      toolCallId: context.toolCallId,
    };

    const toolStartTime = Date.now();

    logger?.debug("Executing tool with enhanced context", {
      toolName: name,
      permissionMode,
      effectivePermissionMode,
      hasPermissionManager: !!permissionManager,
    });

    // Check if it's an MCP tool first
    if (this.mcpManager.isMcpTool(name)) {
      try {
        const result = await this.mcpManager.executeMcpToolByRegistry(
          name,
          args,
          enhancedContext,
        );
        return result;
      } catch (error) {
        return {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // Check built-in tools
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      if (this.builtInTools.has(plugin)) {
        const invalid = validateToolInput(
          name,
          plugin.config?.function?.parameters,
          args,
        );
        if (invalid !== null) {
          logger?.debug(
            "Tool call rejected: arguments do not match the schema",
            { toolName: name },
          );
          return { success: false, content: invalid, error: invalid };
        }
      }

      let result: ToolResult;
      try {
        result = await plugin.execute(args, enhancedContext);
      } catch (error) {
        logger?.error("Tool execution failed", {
          toolName: name,
          error: error instanceof Error ? error.message : String(error),
        });
        result = {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // A memory write that left the file over its cap is worth saying out loud
      // in the result: unlike the load-time warning, this reaches the model
      // while it still has the file in hand.
      await appendMemoryCapNotice(
        name,
        args,
        result,
        enhancedContext.workdir,
        enhancedContext.autoMemoryDir,
      );
      return result;
    }

    logger?.warn("Tool not found", { toolName: name });
    return {
      success: false,
      content: "",
      error: `Tool '${name}' not found`,
    };
  }

  list(): ToolPlugin[] {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const builtInTools = Array.from(this.toolsRegistry.values()).filter(
      (tool) => !permissionManager?.isToolDenied(tool.name),
    );
    const mcpTools = this.mcpManager
      .getMcpToolPlugins()
      .filter((tool) => !permissionManager?.isToolDenied(tool.name));
    return [...builtInTools, ...mcpTools];
  }

  getToolsConfig(options?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
    isSubagent?: boolean;
  }): ChatCompletionFunctionTool[] {
    const permissionManager = this.getPermissionManager();
    const leanPromptEnabled = isLeanPromptEnabled(options?.workdir);

    const builtInToolsConfig = Array.from(this.toolsRegistry.values())
      .filter((tool) => {
        if (permissionManager?.isToolDenied(tool.name)) {
          return false;
        }
        return true;
      })
      .map((tool) => {
        // Create a copy of the tool config to avoid modifying the original
        const config = {
          ...tool.config,
          function: {
            ...tool.config.function,
          },
        };
        // Lean mode sends the tool's condensed variant when it declares one; a
        // tool without one keeps its full description, so lean never yields an
        // empty description. Only text changes — schemas, the tool set and
        // permission decisions are untouched.
        const lean = leanPromptEnabled ? tool.leanPrompt : undefined;
        if (lean !== undefined) {
          config.function.description =
            typeof lean === "function" ? lean({ ...options }) : lean;
        } else if (tool.prompt) {
          config.function.description = tool.prompt({ ...options });
        }
        return config;
      });
    const mcpToolsConfig = this.mcpManager.getMcpToolsConfig().filter((tool) => {
          if (permissionManager?.isToolDenied(tool.function.name)) {
            return false;
          }
          return true;
        });
    return [...builtInToolsConfig, ...mcpToolsConfig];
  }

  /**
   * Get the list of registered tool plugins
   */
  public getTools(): ToolPlugin[] {
    return Array.from(this.toolsRegistry.values());
  }

  /**
   * Check whether a tool is safe to execute in parallel with other tools.
   * Built-in tools default to safe (parallel); Edit and Write opt out.
   * MCP tools are conservatively non-safe (can't inspect side effects).
   */
  public isConcurrencySafe(name: string): boolean {
    // MCP tools are conservatively non-safe
    if (this.mcpManager.isMcpTool(name)) {
      return false;
    }
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      return plugin.isConcurrencySafe ?? true;
    }
    // Unknown tools are conservatively non-safe
    return false;
  }

  /**
   * Get the current permission mode
   */
  public getPermissionMode(): PermissionMode {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    if (permissionManager) {
      return permissionManager.getCurrentEffectiveMode(permissionMode);
    }
    return permissionMode || "default";
  }

  /**
   * Set the permission mode
   * @param mode - The new permission mode
   */
  public setPermissionMode(mode: PermissionMode): void {
    this.container.register("PermissionMode", mode);
  }

  /**
   * Request a full permission mode transition (UI callback).
   */
  public requestPermissionModeChange(mode: PermissionMode): void {
    if (this.container.has("PermissionModeTransition")) {
      const transition = this.container.get<(mode: PermissionMode) => void>(
        "PermissionModeTransition",
      );
      if (transition) {
        transition(mode);
        return;
      }
    }
    this.setPermissionMode(mode);
  }

  /**
   * Get the permission manager
   */
  public getPermissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  /**
   * Get the task manager
   */
  public getTaskManager():
    | import("../services/taskManager.js").TaskManager
    | undefined {
    return this.container.get<import("../services/taskManager.js").TaskManager>(
      "TaskManager",
    );
  }
}

// Export tool registry class and types
export { ToolManager };
