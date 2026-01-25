// =============================================================================
// Agent Service Type Definitions
// =============================================================================

/**
 * AI Agent configuration from database
 * Compatible with AiAgent from databaseService
 */
export interface AIAgentConfig {
  id?: number;
  name: string;
  provider: string;
  model?: string;
  api_key?: string;
  api_base_url: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  is_default?: boolean | number;
  is_active?: boolean | number;
}

/**
 * Model information returned by providers
 */
export interface AIModel {
  id: string;
  name: string;
  vendor: string;
}

/**
 * Chat request parameters
 */
export interface ChatRequest {
  prompt: string;
  context?: string;
  model?: string;
  timeout?: number;
  maxTokens?: number;
  sessionId?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/**
 * Chat response from provider
 */
export interface ChatResponse {
  success: boolean;
  response?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

/**
 * Provider availability status
 */
export interface ProviderStatus {
  available: boolean;
  error?: string;
}

/**
 * Supported provider types
 */
export type ProviderType = "copilot" | "openai" | "anthropic" | "zhipu" | "azure" | "ollama" | "custom";
