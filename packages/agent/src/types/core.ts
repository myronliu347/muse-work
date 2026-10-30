/**
 * Core foundational types used across multiple domains
 * Dependencies: None (foundation layer)
 */

/**
 * Logger interface definition
 * Compatible with OpenAI package Logger interface
 */
export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Usage statistics for AI operations
 * Extends OpenAI's Usage format with normalized cache fields
 */
export interface Usage {
  prompt_tokens: number; // Tokens used in prompts
  completion_tokens: number; // Tokens generated in completions
  total_tokens: number; // Sum of prompt + completion tokens
  model?: string; // Model used for the operation (e.g., "gpt-4", "gpt-3.5-turbo")
  operation_type?: "agent" | "compact"; // Type of operation that generated usage

  // Normalized cache fields. Writes may arrive as a flat
  // cache_creation_input_tokens, Anthropic's cache_creation.ephemeral_5m, or
  // OpenAI's cache_write_tokens; all three land in cache_creation_input_tokens.
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Represents a diff change for tool parameter-based diff display
 * Contains the old content and new content for comparison
 */
export interface Change {
  /** The original content (empty string for additions) */
  oldContent: string;
  /** The new content (empty string for deletions) */
  newContent: string;
  /** Optional starting line number in the original file */
  startLineNumber?: number;
}

export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly provided?: unknown,
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// Standard error messages
export const CONFIG_ERRORS = {
  MISSING_MODEL:
    "Agent configuration requires model. Provide via constructor or MUSE_MODEL environment variable.",
  MISSING_FAST_MODEL:
    "Agent configuration requires fastModel. Provide via constructor or MUSE_FAST_MODEL environment variable.",
  INVALID_MUSE_MAX_INPUT_TOKENS: "Token limit must be a positive integer.",
  EMPTY_BASE_URL: "Base URL cannot be empty string.",
} as const;
