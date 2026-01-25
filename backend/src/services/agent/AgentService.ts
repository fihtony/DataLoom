// =============================================================================
// Agent Service - Central Service for AI Agent Management
// =============================================================================
// This service manages:
// - Provider selection based on agent configuration
// - Chat flow orchestration
// - Analysis flow orchestration

import type { AgentProvider } from "./AgentProvider.js";
import type { AIAgentConfig, AIModel, ChatRequest, ChatResponse, ProviderStatus, ProviderType } from "./types.js";
import { CopilotProvider } from "./providers/CopilotProvider.js";
import { OpenAICompatibleProvider } from "./providers/OpenAICompatibleProvider.js";
import { logger } from "../../utils/logger.js";

/**
 * Central service for managing AI agents and their providers
 */
export class AgentService {
  private providers: Map<string, AgentProvider>;

  constructor() {
    this.providers = new Map();
    this.initializeProviders();
  }

  /**
   * Initialize all available providers
   */
  private initializeProviders(): void {
    // Register CopilotProvider
    this.providers.set("copilot", new CopilotProvider());

    // Register OpenAI-compatible providers
    this.providers.set("openai", new OpenAICompatibleProvider("openai"));
    this.providers.set("anthropic", new OpenAICompatibleProvider("anthropic"));
    this.providers.set("zhipu", new OpenAICompatibleProvider("zhipu"));
    this.providers.set("azure", new OpenAICompatibleProvider("azure"));
    this.providers.set("ollama", new OpenAICompatibleProvider("ollama"));
    this.providers.set("custom", new OpenAICompatibleProvider("custom"));

    logger.info(`[AgentService] Initialized ${this.providers.size} providers`);
  }

  /**
   * Get the appropriate provider for an agent
   */
  getProvider(agent: AIAgentConfig): AgentProvider {
    const providerType = agent.provider as ProviderType;
    const provider = this.providers.get(providerType);

    if (!provider) {
      logger.warn(`[AgentService] Unknown provider: ${providerType}, falling back to custom`);
      return this.providers.get("custom")!;
    }

    return provider;
  }

  /**
   * Check if the agent's provider is available
   */
  async checkAvailability(agent: AIAgentConfig): Promise<ProviderStatus> {
    const provider = this.getProvider(agent);
    return provider.checkAvailability(agent);
  }

  /**
   * Get available models for an agent
   */
  async getModels(agent: AIAgentConfig): Promise<AIModel[]> {
    const provider = this.getProvider(agent);
    return provider.getModels(agent);
  }

  /**
   * Send a chat request using the agent's provider
   */
  async chat(agent: AIAgentConfig, request: ChatRequest): Promise<ChatResponse> {
    const provider = this.getProvider(agent);
    
    logger.info(`[AgentService] Chat request using provider: ${agent.provider}, model: ${request.model || agent.model}`);
    
    // Use agent's model if not specified in request
    const chatRequest: ChatRequest = {
      ...request,
      model: request.model || agent.model,
    };

    return provider.chat(agent, chatRequest);
  }

  /**
   * Get supported parameters for an agent's provider
   */
  getSupportedParams(agent: AIAgentConfig) {
    const provider = this.getProvider(agent);
    return provider.getSupportedParams();
  }

  /**
   * Get list of all registered provider types
   */
  getProviderTypes(): string[] {
    return Array.from(this.providers.keys());
  }
}

// Export singleton instance
export const agentService = new AgentService();
