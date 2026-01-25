// =============================================================================
// Agent Provider Interface
// =============================================================================
// All AI providers must implement this interface to be used by the AgentService.

import type { AIAgentConfig, AIModel, ChatRequest, ChatResponse, ProviderStatus } from "./types.js";

/**
 * Abstract interface for AI agent providers.
 * Each provider (Copilot, OpenAI, Anthropic, Zhipu, etc.) implements this interface.
 */
export interface AgentProvider {
  /**
   * Provider identifier (e.g., "copilot", "openai", "zhipu")
   */
  readonly providerId: string;

  /**
   * Check if the provider is available and configured correctly
   */
  checkAvailability(agent: AIAgentConfig): Promise<ProviderStatus>;

  /**
   * Get list of available models from the provider
   */
  getModels(agent: AIAgentConfig): Promise<AIModel[]>;

  /**
   * Send a chat request to the provider
   */
  chat(agent: AIAgentConfig, request: ChatRequest): Promise<ChatResponse>;

  /**
   * Get provider-specific parameters that should be included in requests
   */
  getSupportedParams(): {
    temperature: boolean;
    maxTokens: boolean;
    topP: boolean;
    frequencyPenalty: boolean;
    presencePenalty: boolean;
  };
}
