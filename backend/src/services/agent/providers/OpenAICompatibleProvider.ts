// =============================================================================
// OpenAI Compatible Provider - For OpenAI, Zhipu, Azure, Ollama, Custom
// =============================================================================

import type { AgentProvider } from "../AgentProvider.js";
import type { AIAgentConfig, AIModel, ChatRequest, ChatResponse, ProviderStatus } from "../types.js";
import { logger } from "../../../utils/logger.js";

const DEFAULT_TIMEOUT = 300000; // 5 minutes for analysis (some providers like Zhipu may be slow)

/**
 * Provider parameter configuration
 */
interface ProviderParams {
  temperature: boolean;
  maxTokens: boolean;
  topP: boolean;
  frequencyPenalty: boolean;
  presencePenalty: boolean;
}

/**
 * Provider-specific configuration
 */
const PROVIDER_CONFIG: Record<string, ProviderParams> = {
  openai: {
    temperature: true,
    maxTokens: true,
    topP: true,
    frequencyPenalty: true,
    presencePenalty: true,
  },
  zhipu: {
    temperature: true,
    maxTokens: true,
    topP: true,
    frequencyPenalty: false,
    presencePenalty: false,
  },
  azure: {
    temperature: true,
    maxTokens: true,
    topP: true,
    frequencyPenalty: true,
    presencePenalty: true,
  },
  ollama: {
    temperature: true,
    maxTokens: true,
    topP: true,
    frequencyPenalty: false,
    presencePenalty: false,
  },
  anthropic: {
    temperature: true,
    maxTokens: true,
    topP: true,
    frequencyPenalty: false,
    presencePenalty: false,
  },
  gemini: {
    temperature: true,
    maxTokens: true,
    topP: true,
    frequencyPenalty: false,
    presencePenalty: false,
  },
  custom: {
    temperature: true,
    maxTokens: true,
    topP: true,
    frequencyPenalty: true,
    presencePenalty: true,
  },
};

/**
 * OpenAI Compatible Provider implementation
 * Supports: OpenAI, Zhipu, Azure OpenAI, Ollama, Anthropic, Custom
 */
export class OpenAICompatibleProvider implements AgentProvider {
  readonly providerId: string;

  constructor(providerId: string) {
    this.providerId = providerId;
  }

  /**
   * Check if the provider API is available
   */
  async checkAvailability(agent: AIAgentConfig): Promise<ProviderStatus> {
    const baseUrl = agent.api_base_url;
    
    if (!baseUrl) {
      return {
        available: false,
        error: "API base URL is not configured",
      };
    }

    try {
      // Try to fetch models as availability check
      const modelsUrl = `${baseUrl}/models`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Google Gemini OpenAI-compatible endpoint uses Authorization Bearer header
      // The base URL should be: https://generativelanguage.googleapis.com/v1beta/openai
      if (agent.api_key) {
        headers["Authorization"] = `Bearer ${agent.api_key}`;
      }

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return { available: true };
      }

      return {
        available: false,
        error: `${this.providerId} API returned status ${response.status}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        error: `${this.providerId} API is not available at ${baseUrl}. Error: ${errorMsg}`,
      };
    }
  }

  /**
   * Get available models from the provider
   */
  async getModels(agent: AIAgentConfig): Promise<AIModel[]> {
    const baseUrl = agent.api_base_url;
    
    if (!baseUrl) {
      return [];
    }

    try {
      const modelsUrl = `${baseUrl}/models`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Google Gemini OpenAI-compatible endpoint uses Authorization Bearer header
      // The base URL should be: https://generativelanguage.googleapis.com/v1beta/openai
      if (agent.api_key) {
        headers["Authorization"] = `Bearer ${agent.api_key}`;
      }

      logger.debug(`[${this.providerId}Provider] Fetching models from ${modelsUrl}`);
      const response = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`[${this.providerId}Provider] /models returned ${response.status}: ${errorText}`);
        // Log headers for debugging (without sensitive data)
        logger.debug(`[${this.providerId}Provider] Request headers: ${JSON.stringify(Object.keys(headers))}`);
        return [];
      }

      const data = await response.json() as any;

      // Handle different API response formats
      if (data.data && Array.isArray(data.data)) {
        // OpenAI format
        return data.data.map((m: any) => ({
          id: m.id,
          name: m.id,
          vendor: this.providerId,
        }));
      } else if (data.models && Array.isArray(data.models)) {
        // Alternative format (CopilotBridge style)
        return data.models.map((m: any) => ({
          id: m.id || m.model,
          name: m.name || m.id || m.model,
          vendor: m.vendor || this.providerId,
        }));
      }

      return [];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[${this.providerId}Provider] Failed to get models: ${errorMsg}`);
      return [];
    }
  }

  /**
   * Send chat request to the provider
   */
  async chat(agent: AIAgentConfig, request: ChatRequest): Promise<ChatResponse> {
    const baseUrl = agent.api_base_url;
    
    if (!baseUrl) {
      return {
        success: false,
        error: "API base URL is not configured",
      };
    }

    const timeout = request.timeout || DEFAULT_TIMEOUT;
    const chatUrl = `${baseUrl}/chat/completions`;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Google Gemini OpenAI-compatible endpoint uses Authorization Bearer header
      // The base URL should be: https://generativelanguage.googleapis.com/v1beta/openai
      if (agent.api_key) {
        headers["Authorization"] = `Bearer ${agent.api_key}`;
      }

      // Build messages array with conversation history
      const messages: Array<{ role: string; content: string }> = [];
      
      // Add system context first
      if (request.context) {
        messages.push({ role: "system", content: request.context });
      }
      
      // Add conversation history (if any)
      if (request.history && request.history.length > 0) {
        for (const msg of request.history) {
          messages.push({ role: msg.role, content: msg.content });
        }
        logger.debug(`[${this.providerId}Provider] Including ${request.history.length} messages from conversation history`);
      }
      
      // Add current user prompt
      messages.push({ role: "user", content: request.prompt });

      // Build request body with supported parameters
      const supportedParams = this.getSupportedParams();
      const body: any = {
        model: request.model || agent.model,
        messages,
      };

      // Add supported parameters
      if (supportedParams.temperature) {
        body.temperature = request.temperature ?? agent.temperature ?? 0.1;
      }
      if (supportedParams.maxTokens) {
        const maxTokens = request.maxTokens || agent.max_tokens;
        if (maxTokens && maxTokens > 0) {
          body.max_tokens = maxTokens;
        }
      }
      if (supportedParams.topP) {
        body.top_p = request.topP ?? agent.top_p ?? 0.9;
      }
      if (supportedParams.frequencyPenalty) {
        body.frequency_penalty = request.frequencyPenalty ?? agent.frequency_penalty ?? 0;
      }
      if (supportedParams.presencePenalty) {
        body.presence_penalty = request.presencePenalty ?? agent.presence_penalty ?? 0;
      }

      logger.debug(`[${this.providerId}Provider] Sending request to ${chatUrl} with model: ${body.model}`);

      const response = await fetch(chatUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[${this.providerId}Provider] API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `${this.providerId} API error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json() as any;

      // Extract response from OpenAI format
      const content = data.choices?.[0]?.message?.content || data.response;
      
      if (content) {
        return {
          success: true,
          response: content,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          } : undefined,
        };
      }

      return {
        success: false,
        error: "No response content from API",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("TimeoutError")
      ) {
        return {
          success: false,
          error: `${this.providerId} API is not available at ${baseUrl}. Error: ${errorMessage}`,
        };
      }

      return {
        success: false,
        error: `${this.providerId} API request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get supported parameters for this provider
   */
  getSupportedParams(): ProviderParams {
    return PROVIDER_CONFIG[this.providerId] || PROVIDER_CONFIG.custom;
  }
}
