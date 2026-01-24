// =============================================================================
// CopilotBridge Client - HTTP client for localhost:1287
// =============================================================================

import type { CopilotRequest, CopilotResponse, AIModelConfig } from "../../types/index.js";
import { logger } from "../../utils/logger.js";
import { randomUUID } from "crypto";

const COPILOT_BRIDGE_URL = process.env.COPILOT_BRIDGE_URL || "http://localhost:1287";
const DEFAULT_TIMEOUT = 60000; // 60 seconds

// Default model
const DEFAULT_MODEL: AIModelConfig = {
  id: "gpt-4o",
  name: "GPT-4o",
  vendor: "OpenAI",
};

/**
 * Generate a new session ID for each CopilotBridge request
 * This ensures CopilotBridge creates a fresh conversation context each time
 */
function generateSessionId(): string {
  return `session_${randomUUID()}`;
}

/**
 * Check if CopilotBridge is available
 */
export async function checkCopilotBridge(): Promise<boolean> {
  try {
    const response = await fetch(`${COPILOT_BRIDGE_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const available = response.ok;
    if (!available) {
      logger.warn(
        `CopilotBridge is not available (${response.status}). ` +
          `Expected endpoint at: ${COPILOT_BRIDGE_URL}. ` +
          `Start CopilotBridge in VS Code: Command Palette > "Start Copilot Bridge Server"`,
      );
    }
    return available;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(
      `CopilotBridge connection failed: ${errorMsg}. ` +
        `Make sure CopilotBridge is running at ${COPILOT_BRIDGE_URL} ` +
        `(Start in VS Code: Command Palette > "Start Copilot Bridge Server")`,
    );
    return false;
  }
}

/**
 * Get available models from CopilotBridge
 */
export async function getAvailableModels(): Promise<AIModelConfig[]> {
  try {
    const response = await fetch(`${COPILOT_BRIDGE_URL}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const statusCode = response.status;
      logger.warn(
        `CopilotBridge /models endpoint returned ${statusCode}. ` +
          `Is CopilotBridge running? Start with: Command Palette > "Start Copilot Bridge Server"`,
      );
      // Return default model as fallback
      return [DEFAULT_MODEL];
    }

    const data = (await response.json()) as { success?: boolean; models?: any[] };

    if (data.success && Array.isArray(data.models)) {
      logger.info(`Successfully retrieved ${data.models.length} models from CopilotBridge`);
      // Remove duplicate models by name (keep first occurrence)
      const seenNames = new Set<string>();
      const uniqueModels: any[] = [];

      for (const m of data.models) {
        const name = m.name || m.id || m.model;
        if (!seenNames.has(name)) {
          seenNames.add(name);
          uniqueModels.push({
            id: m.id || m.model,
            name: name,
            vendor: m.vendor || "Unknown",
          });
        }
      }

      logger.info(`After deduplication: ${uniqueModels.length} unique models`);
      return uniqueModels;
    }

    // Return default if no models found
    logger.warn("CopilotBridge returned no models, using default fallback");
    return [DEFAULT_MODEL];
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to get models from CopilotBridge: ${errorMsg}. ` +
        `Ensure CopilotBridge is running at ${COPILOT_BRIDGE_URL}. ` +
        `(Start in VS Code: Command Palette > "Start Copilot Bridge Server"). ` +
        `Using default model as fallback.`,
    );
    return [DEFAULT_MODEL];
  }
}

/**
 * Send chat request to CopilotBridge
 * If sessionId is provided, uses that session (session-based chat)
 * If sessionId is not provided, creates a new session for each request
 */
export async function chat(request: CopilotRequest): Promise<CopilotResponse> {
  const { prompt, context, model, timeout, maxToken, sessionId } = request;
  // Only generate new session if not using an existing session
  const useSessionId = sessionId || generateSessionId();

  try {
    const requestBody: any = {
      sessionId: useSessionId, // Use provided or newly generated session ID
      prompt: context ? `${context}\n\n${prompt}` : prompt,
      model: model || DEFAULT_MODEL,
      timeout: timeout || DEFAULT_TIMEOUT,
    };
    
    // Include maxToken if provided from AI agent settings
    if (maxToken && maxToken > 0) {
      requestBody.maxToken = maxToken;
      logger.debug(`[CHAT] Including maxToken from agent settings: ${maxToken}`);
    }
    
    const response = await fetch(`${COPILOT_BRIDGE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeout || DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`CopilotBridge error: ${response.status} - ${errorText}`);

      return {
        success: false,
        error: `CopilotBridge error: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
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
    } else {
      return {
        success: false,
        error: data.error || "Unknown error from CopilotBridge",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a connection error
    if (
      errorMessage.includes("fetch failed") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("TimeoutError")
    ) {
      const msg =
        `CopilotBridge is not available at ${COPILOT_BRIDGE_URL}. ` +
        `Error: ${errorMessage}. ` +
        `Start CopilotBridge in VS Code: Command Palette > "Start Copilot Bridge Server"`;
      logger.error(`CopilotBridge request failed: ${msg}`);
      return {
        success: false,
        error: msg,
      };
    }

    logger.error(`CopilotBridge request failed: ${errorMessage}`);
    return {
      success: false,
      error: `CopilotBridge request failed: ${errorMessage}`,
    };
  }
}

/**
 * Chat with streaming response
 * IMPORTANT: A new session ID is created for each request to ensure a fresh context
 */
export async function* chatStream(request: CopilotRequest): AsyncGenerator<string, void, unknown> {
  const { prompt, context, model, timeout } = request;
  const sessionId = generateSessionId(); // Create new session for each request

  try {
    const response = await fetch(`${COPILOT_BRIDGE_URL}/chat?stream=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId, // Include session ID to ensure fresh context
        prompt: context ? `${context}\n\n${prompt}` : prompt,
        model: model || DEFAULT_MODEL,
        timeout: timeout || DEFAULT_TIMEOUT,
      }),
      signal: AbortSignal.timeout(timeout || DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`CopilotBridge error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.chunk) {
              yield data.chunk;
            }
            if (data.done) {
              return;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`CopilotBridge stream failed: ${errorMessage}`);
    throw error;
  }
}
