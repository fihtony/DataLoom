// =============================================================================
// Copilot Provider - GitHub Copilot Bridge Integration
// =============================================================================

import type { AgentProvider } from "../AgentProvider.js";
import type { AIAgentConfig, AIModel, ChatRequest, ChatResponse, ProviderStatus } from "../types.js";
import { logger } from "../../../utils/logger.js";
import { randomUUID } from "crypto";

const DEFAULT_TIMEOUT = 60000; // 60 seconds

/**
 * Copilot Provider implementation using CopilotBridge
 */
export class CopilotProvider implements AgentProvider {
  readonly providerId = "copilot";

  /**
   * Generate a unique session ID for CopilotBridge requests
   */
  private generateSessionId(): string {
    return `session_${randomUUID()}`;
  }

  /**
   * Check if CopilotBridge is available
   */
  async checkAvailability(agent: AIAgentConfig): Promise<ProviderStatus> {
    const baseUrl = agent.api_base_url || "http://localhost:1287";
    
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return { available: true };
      }

      return {
        available: false,
        error: `CopilotBridge returned status ${response.status}. Start in VS Code: Command Palette > "Start Copilot Bridge Server"`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        error: `CopilotBridge is not available at ${baseUrl}. Error: ${errorMsg}. Start in VS Code: Command Palette > "Start Copilot Bridge Server"`,
      };
    }
  }

  /**
   * Get available models from CopilotBridge
   */
  async getModels(agent: AIAgentConfig): Promise<AIModel[]> {
    const baseUrl = agent.api_base_url || "http://localhost:1287";
    
    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn(`CopilotBridge /models returned ${response.status}`);
        return this.getDefaultModels();
      }

      const data = await response.json() as { success?: boolean; models?: any[] };

      if (data.success && Array.isArray(data.models)) {
        // Remove duplicate models by name
        const seenNames = new Set<string>();
        const uniqueModels: AIModel[] = [];

        for (const m of data.models) {
          const name = m.name || m.id || m.model;
          if (!seenNames.has(name)) {
            seenNames.add(name);
            uniqueModels.push({
              id: m.id || m.model,
              name: name,
              vendor: m.vendor || "GitHub Copilot",
            });
          }
        }

        logger.info(`[CopilotProvider] Retrieved ${uniqueModels.length} models`);
        return uniqueModels;
      }

      return this.getDefaultModels();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[CopilotProvider] Failed to get models: ${errorMsg}`);
      return this.getDefaultModels();
    }
  }

  /**
   * Send chat request to CopilotBridge
   */
  async chat(agent: AIAgentConfig, request: ChatRequest): Promise<ChatResponse> {
    const baseUrl = agent.api_base_url || "http://localhost:1287";
    const sessionId = request.sessionId || this.generateSessionId();
    const timeout = request.timeout || DEFAULT_TIMEOUT;

    try {
      // Build prompt with conversation history
      let fullPrompt = "";
      
      // Add context first
      if (request.context) {
        fullPrompt += request.context + "\n\n";
      }
      
      // Add conversation history (if any)
      if (request.history && request.history.length > 0) {
        fullPrompt += "=== CONVERSATION HISTORY ===\n";
        for (const msg of request.history) {
          const roleLabel = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
          fullPrompt += `${roleLabel}: ${msg.content}\n\n`;
        }
        fullPrompt += "=== CURRENT QUESTION ===\n";
        logger.debug(`[CopilotProvider] Including ${request.history.length} messages from conversation history`);
      }
      
      // Add current prompt
      fullPrompt += request.prompt;
      
      const requestBody: any = {
        sessionId,
        prompt: fullPrompt,
        model: request.model || agent.model || "gpt-4o",
        timeout,
      };

      // Include maxToken if provided
      if (request.maxTokens && request.maxTokens > 0) {
        requestBody.maxToken = request.maxTokens;
      } else if (agent.max_tokens && agent.max_tokens > 0) {
        requestBody.maxToken = agent.max_tokens;
      }

      logger.debug(`[CopilotProvider] Sending request to ${baseUrl}/chat`);

      const response = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `CopilotBridge error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json() as {
        success?: boolean;
        response?: string;
        content?: string;
        message?: string;
        usage?: any;
        error?: string;
      };

      if (data.success) {
        return {
          success: true,
          response: data.response || data.content || data.message,
          usage: data.usage,
        };
      }

      return {
        success: false,
        error: data.error || "Unknown error from CopilotBridge",
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
          error: `CopilotBridge is not available at ${baseUrl}. Error: ${errorMessage}. Start in VS Code: Command Palette > "Start Copilot Bridge Server"`,
        };
      }

      return {
        success: false,
        error: `CopilotBridge request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get supported parameters for Copilot
   */
  getSupportedParams() {
    return {
      temperature: false,
      maxTokens: true,
      topP: false,
      frequencyPenalty: false,
      presencePenalty: false,
    };
  }

  /**
   * Get default models when CopilotBridge is not available
   */
  private getDefaultModels(): AIModel[] {
    return [
      { id: "gpt-4o", name: "GPT-4o", vendor: "OpenAI" },
    ];
  }
}
