// =============================================================================
// API Client - HTTP client for backend communication
// =============================================================================

import type {
  DatabaseConnection,
  DatabaseSchema,
  QueryResult,
  TableAnnotation,
  ColumnAnnotation,
  SQLExample,
  AIModel,
  AIAgent,
} from "../types";

const API_BASE = "/api";

// Standard API response format from backend
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: string;
}

class ApiClient {
  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = `${API_BASE}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const json = await response.json().catch(() => ({ success: false, error: "Invalid JSON response" }));

    if (!response.ok || !json.success) {
      throw new Error(json.error || `HTTP error: ${response.status}`);
    }

    return json;
  }

  // Direct request without success wrapper (for dataloom API)
  private async directRequest<T>(method: string, endpoint: string, body?: unknown, abortController?: AbortController): Promise<T> {
    const url = `${API_BASE}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    if (abortController) {
      options.signal = abortController.signal;
    }

    const response = await fetch(url, options);
    const json = await response.json().catch(() => ({ error: "Invalid JSON response" }));

    if (!response.ok) {
      throw new Error(json.error || `HTTP error: ${response.status}`);
    }

    return json;
  }

  // =========================================================================
  // DataLoom Database Connections API (All connections go through dataloom)
  // =========================================================================
  async getConnections(workspaceId: number = 1): Promise<DatabaseConnection[]> {
    return this.directRequest<DatabaseConnection[]>("GET", `/dataloom/connections/workspace/${workspaceId}`);
  }

  async createConnection(data: {
    workspace_id?: number;
    name: string;
    type: string;
    config: Record<string, unknown>;
    description?: string;
  }): Promise<{ id: number; message: string }> {
    return this.directRequest<{ id: number; message: string }>("POST", "/dataloom/connections", {
      workspace_id: data.workspace_id || 1,
      name: data.name,
      type: data.type,
      config: data.config,
      description: data.description,
    });
  }

  async getConnection(id: number): Promise<DatabaseConnection> {
    return this.directRequest<DatabaseConnection>("GET", `/dataloom/connections/${id}`);
  }

  async updateConnection(id: number, data: Partial<DatabaseConnection>): Promise<{ message: string }> {
    return this.directRequest<{ message: string }>("PUT", `/dataloom/connections/${id}`, data);
  }

  async deleteConnection(id: number): Promise<{ message: string }> {
    return this.directRequest<{ message: string }>("DELETE", `/dataloom/connections/${id}`);
  }

  async connectDatabase(
    id: number,
  ): Promise<{ success: boolean; latencyMs?: number; sessionId?: string; readOnlyStatus?: "readonly" | "readwrite" | "unknown" }> {
    try {
      const response = await this.directRequest<{
        success: boolean;
        latencyMs?: number;
        sessionId?: string;
        readOnlyStatus?: "readonly" | "readwrite" | "unknown";
      }>("POST", `/dataloom/connections/${id}/connect`);
      return {
        success: response.success,
        latencyMs: response.latencyMs,
        sessionId: response.sessionId,
        readOnlyStatus: response.readOnlyStatus,
      };
    } catch (error) {
      return { success: false };
    }
  }

  async disconnectDatabaseSession(sessionId: string): Promise<{ success: boolean }> {
    try {
      const response = await this.directRequest<{ success: boolean }>("POST", `/dataloom/connections/session/${sessionId}/disconnect`);
      return { success: response.success };
    } catch (error) {
      return { success: false };
    }
  }

  async disconnectDatabase(id: number): Promise<{ success: boolean }> {
    try {
      const response = await this.request<{ success: boolean }>("POST", `/dataloom/connections/${id}/disconnect`);
      return { success: response.success };
    } catch (error) {
      return { success: false };
    }
  }

  async testConnection(id: number): Promise<{ success: boolean; latencyMs?: number }> {
    try {
      const response = await this.request<{ latencyMs?: number }>("POST", `/dataloom/connections/${id}/connect`);
      return { success: true, latencyMs: response.data?.latencyMs };
    } catch (error) {
      return { success: false };
    }
  }

  async testConnectionConfig(config: {
    type: string;
    host?: string;
    port?: string;
    database?: string;
    username?: string;
    password?: string;
    path?: string;
  }): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    try {
      const response = await this.request<any>("POST", "/dataloom/connections/test-config", config);
      const result = response as any;
      return {
        success: result.success ?? false,
        latencyMs: result.latencyMs,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection test failed",
      };
    }
  }

  async getSchema(connectionId: number): Promise<DatabaseSchema> {
    return this.directRequest<DatabaseSchema>("GET", `/dataloom/connections/${connectionId}/schema`);
  }

  async getPostgreSQLSchemas(config: Record<string, unknown>): Promise<string[]> {
    return this.directRequest<string[]>("POST", "/dataloom/connections/schemas/fetch", config);
  }

  // =========================================================================
  // DataLoom AI Agents API
  // =========================================================================
  async getDataLoomConnections(workspaceId: number = 1): Promise<DatabaseConnection[]> {
    return this.directRequest<DatabaseConnection[]>("GET", `/dataloom/connections/workspace/${workspaceId}`);
  }

  async createDataLoomConnection(data: {
    workspace_id: number;
    name: string;
    type: string;
    config: Record<string, unknown>;
    description?: string;
    selected_schemas?: string[];
  }): Promise<{ id: number; message: string }> {
    return this.directRequest<{ id: number; message: string }>("POST", "/dataloom/connections", data);
  }

  async getDataLoomConnection(id: number): Promise<DatabaseConnection> {
    return this.directRequest<DatabaseConnection>("GET", `/dataloom/connections/${id}`);
  }

  async updateDataLoomConnection(id: number, data: Partial<DatabaseConnection>): Promise<{ message: string }> {
    return this.directRequest<{ message: string }>("PUT", `/dataloom/connections/${id}`, data);
  }

  async deleteDataLoomConnection(id: number): Promise<{ message: string }> {
    return this.directRequest<{ message: string }>("DELETE", `/dataloom/connections/${id}`);
  }

  // =========================================================================
  // AI Agents API
  // =========================================================================
  async getAIAgents(): Promise<AIAgent[]> {
    return this.directRequest<AIAgent[]>("GET", "/dataloom/ai-agents");
  }

  async getAIAgent(id: number): Promise<AIAgent> {
    return this.directRequest<AIAgent>("GET", `/dataloom/ai-agents/${id}`);
  }

  async getDefaultAIAgent(): Promise<AIAgent> {
    return this.directRequest<AIAgent>("GET", "/dataloom/ai-agents/default");
  }

  async createAIAgent(data: Partial<AIAgent>): Promise<{ id: number; message: string }> {
    return this.directRequest<{ id: number; message: string }>("POST", "/dataloom/ai-agents", data);
  }

  async updateAIAgent(id: number, data: Partial<AIAgent>): Promise<{ message: string }> {
    return this.directRequest<{ message: string }>("PUT", `/dataloom/ai-agents/${id}`, data);
  }

  async deleteAIAgent(id: number): Promise<{ message: string }> {
    return this.directRequest<{ message: string }>("DELETE", `/dataloom/ai-agents/${id}`);
  }

  // =========================================================================
  // Get Models from AI Agent's API
  // =========================================================================
  async getModelsFromAgent(agent: AIAgent): Promise<AIModel[]> {
    try {
      // For copilot provider, use the copilot API
      if (agent.provider === "copilot") {
        const response = await this.request<AIModel[]>("GET", "/copilot/models");
        return response.data || [];
      }

      // For OpenAI-compatible APIs, fetch from the base URL
      const modelsUrl = `${agent.api_base_url}/models`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (agent.api_key) {
        headers["Authorization"] = `Bearer ${agent.api_key}`;
      }

      const response = await fetch(modelsUrl, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();

      // Handle different API response formats
      if (data.data && Array.isArray(data.data)) {
        // OpenAI format
        return data.data.map((m: any) => ({
          id: m.id,
          name: m.id,
          vendor: agent.provider,
        }));
      } else if (data.models && Array.isArray(data.models)) {
        // CopilotBridge format
        return data.models.map((m: any) => ({
          id: m.id || m.model,
          name: m.name || m.id || m.model,
          vendor: m.vendor || agent.provider,
        }));
      }

      return [];
    } catch (error) {
      console.error("Failed to fetch models from agent:", error);
      return [];
    }
  }

  // =========================================================================
  // Query
  // =========================================================================
  async executeNaturalLanguageQuery(
    connectionId: string | number | undefined,
    query: string,
    options?: { connectionSessionId?: string; chatSessionId?: string },
  ): Promise<{
    success: boolean;
    data?: any;
    chatSessionId?: string;
    explanation?: string;
    error?: string;
    errorCode?: string;
  }> {
    const response = await this.request<any>("POST", "/query", {
      connectionId: connectionId || undefined,
      connectionSessionId: options?.connectionSessionId,
      chatSessionId: options?.chatSessionId,
      naturalLanguage: query,
    });
    // Return the full response which includes success, data, explanation, etc.
    return response;
  }

  async executeSQL(
    connectionId: string | number | undefined,
    sql: string,
    options?: { connectionSessionId?: string },
  ): Promise<QueryResult> {
    const response = await this.request<QueryResult>("POST", "/query/execute", {
      connectionId: connectionId || undefined,
      connectionSessionId: options?.connectionSessionId,
      sql,
    });
    return response.data || { success: false, error: "No result returned" };
  }

  async validateSQL(sql: string): Promise<{ valid: boolean; error?: string; errorCode?: string }> {
    const response = await this.request<{ valid: boolean; error?: string; errorCode?: string }>("POST", "/query/validate", { sql });
    return response.data || { valid: false, error: "No result returned" };
  }

  // =========================================================================
  // Annotations
  // =========================================================================
  async getTableAnnotations(connectionId: string | number): Promise<TableAnnotation[]> {
    const response = await this.request<TableAnnotation[]>("GET", `/annotations/tables?connectionId=${connectionId}`);
    return response.data || [];
  }

  async saveTableAnnotation(annotation: Partial<TableAnnotation>): Promise<TableAnnotation> {
    const response = await this.request<TableAnnotation>("POST", "/annotations/tables", annotation);
    if (!response.data) throw new Error("No annotation returned");
    return response.data;
  }

  async getColumnAnnotations(connectionId: string | number, tableName?: string): Promise<ColumnAnnotation[]> {
    let url = `/annotations/columns?connectionId=${connectionId}`;
    if (tableName) {
      url += `&tableName=${encodeURIComponent(tableName)}`;
    }
    const response = await this.request<ColumnAnnotation[]>("GET", url);
    return response.data || [];
  }

  async saveColumnAnnotation(annotation: Partial<ColumnAnnotation>): Promise<ColumnAnnotation> {
    const response = await this.request<ColumnAnnotation>("POST", "/annotations/columns", annotation);
    if (!response.data) throw new Error("No annotation returned");
    return response.data;
  }

  async getSQLExamples(connectionId: string | number, searchQuery?: string): Promise<SQLExample[]> {
    let url = `/annotations/examples?connectionId=${connectionId}`;
    if (searchQuery) {
      url += `&q=${encodeURIComponent(searchQuery)}`;
    }
    const response = await this.request<SQLExample[]>("GET", url);
    return response.data || [];
  }

  async saveSQLExample(example: Partial<SQLExample>): Promise<SQLExample> {
    const response = await this.request<SQLExample>("POST", "/annotations/examples", example);
    if (!response.data) throw new Error("No example returned");
    return response.data;
  }

  // =========================================================================
  // Database Description
  // =========================================================================
  async getDatabaseDescription(connectionId: string | number): Promise<any> {
    const response = await this.request<any>("GET", `/annotations/description/${connectionId}`);
    return response.data || null;
  }

  async saveDatabaseDescription(
    connectionId: string | number,
    data: { description: string; schema_relationships?: string; examples?: string },
  ): Promise<any> {
    const response = await this.request<any>("POST", "/annotations/description", {
      connectionId,
      ...data,
    });
    return response.data;
  }

  async updateDatabaseDescription(
    connectionId: string | number,
    data: { description: string; schema_relationships?: string; examples?: string },
  ): Promise<any> {
    const response = await this.request<any>("PUT", `/annotations/description/${connectionId}`, data);
    return response.data;
  }

  // =========================================================================
  // Copilot
  // =========================================================================
  async getCopilotStatus(): Promise<{ available: boolean }> {
    const response = await this.request<{ available: boolean }>("GET", "/copilot/status");
    return response.data || { available: false };
  }

  async getAIModels(): Promise<AIModel[]> {
    const response = await this.request<AIModel[]>("GET", "/copilot/models");
    return response.data || [];
  }

  // Chat with specific agent
  async chatWithAgent(agent: AIAgent, prompt: string, context?: string): Promise<{ success: boolean; response?: string; error?: string }> {
    try {
      // For copilot provider, use the copilot API
      if (agent.provider === "copilot") {
        const response = await this.request<{ response: string }>("POST", "/copilot/chat", {
          prompt,
          context,
          model: agent.model,
        });
        return { success: true, response: response.data?.response };
      }

      // For other providers, make direct API call
      const chatUrl = `${agent.api_base_url}/chat/completions`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (agent.api_key) {
        headers["Authorization"] = `Bearer ${agent.api_key}`;
      }

      const body = {
        model: agent.model,
        messages: [...(context ? [{ role: "system", content: context }] : []), { role: "user", content: prompt }],
        temperature: agent.temperature,
        max_tokens: agent.max_tokens,
        top_p: agent.top_p,
        frequency_penalty: agent.frequency_penalty,
        presence_penalty: agent.presence_penalty,
      };

      const response = await fetch(chatUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = await response.json();
      return {
        success: true,
        response: data.choices?.[0]?.message?.content || data.response,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Test agent connection by fetching models
  async testAgentConnection(agent: AIAgent): Promise<{ success: boolean; models?: AIModel[]; error?: string }> {
    try {
      const models = await this.getModelsFromAgent(agent);
      return { success: models.length > 0, models };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // =========================================================================
  // Knowledge Base API
  // =========================================================================
  async getKnowledgeBase(connectionId: number): Promise<{
    tableExplanations: any[];
    columnExplanations: any[];
    sqlExamples: any[];
  }> {
    return this.directRequest<{
      tableExplanations: any[];
      columnExplanations: any[];
      sqlExamples: any[];
    }>("GET", `/dataloom/connections/${connectionId}/knowledge-base`);
  }

  async analyzeSchema(
    connectionId: number,
    data: {
      userInput?: string;
      files?: Array<{ name: string; content: string }>;
      model?: string;
      agentId?: string;
      agentProvider?: string;
      sessionId?: string;
    },
    onProgress?: (phase: number) => void,
    abortController?: AbortController,
  ): Promise<{
    success: boolean;
    analysis?: any;
    message?: string;
    phases?: { phase1: string; phase2: string; phase3: string };
    error?: string;
  }> {
    // Pass through callback if provided (for future streaming support)
    if (onProgress) {
      onProgress(1); // Signal Phase 1 starting
    }

    return this.directRequest<{
      success: boolean;
      analysis?: any;
      message?: string;
      phases?: { phase1: string; phase2: string; phase3: string };
      error?: string;
    }>("POST", `/dataloom/connections/${connectionId}/analyze`, data, abortController);
  }

  async saveKnowledgeBase(
    connectionId: number,
    analysisResult: any,
  ): Promise<{
    success: boolean;
    message?: string;
    stats?: any;
  }> {
    return this.directRequest<{
      success: boolean;
      message?: string;
      stats?: any;
    }>("POST", `/dataloom/connections/${connectionId}/knowledge-base/save`, analysisResult);
  }

  async cancelAnalysis(connectionId: number, sessionId: string): Promise<{ success: boolean; message?: string }> {
    return this.directRequest<{ success: boolean; message?: string }>("POST", `/dataloom/connections/${connectionId}/analyze/cancel`, {
      sessionId,
    });
  }

  async getAnalysisStatus(
    connectionId: number,
    sessionId: string,
  ): Promise<{
    found: boolean;
    currentPhase?: 0 | 1 | 2 | 3 | 4;
    phases?: { phase1: string; phase2: string; phase3: string };
    cancelled?: boolean;
    elapsedSeconds?: number;
  }> {
    return this.directRequest<{
      found: boolean;
      currentPhase?: 0 | 1 | 2 | 3 | 4;
      phases?: { phase1: string; phase2: string; phase3: string };
      cancelled?: boolean;
      elapsedSeconds?: number;
    }>("GET", `/dataloom/connections/${connectionId}/analyze/status/${sessionId}`);
  }

  async clearKnowledgeBase(connectionId: number): Promise<{ success: boolean; message?: string }> {
    return this.directRequest<{ success: boolean; message?: string }>("DELETE", `/dataloom/connections/${connectionId}/knowledge-base`);
  }

  async updateTableExplanation(
    id: number,
    data: { explanation?: string; business_purpose?: string; keywords?: string },
  ): Promise<{ message?: string }> {
    return this.directRequest<{ message?: string }>("PUT", `/dataloom/table-explanations/${id}`, data);
  }

  async updateColumnExplanation(
    id: number,
    data: {
      explanation?: string;
      data_type?: string;
      business_meaning?: string;
      synonyms?: string;
      sensitivity_level?: string;
      sample_values?: string;
    },
  ): Promise<{ message?: string }> {
    return this.directRequest<{ message?: string }>("PUT", `/dataloom/column-explanations/${id}`, data);
  }

  async updateSqlExample(
    id: number,
    data: { natural_language?: string; sql_query?: string; explanation?: string; tables_involved?: string },
  ): Promise<{ message?: string }> {
    return this.directRequest<{ message?: string }>("PUT", `/dataloom/sql-examples/${id}`, data);
  }

  async createSqlExample(
    connectionId: number,
    data: { natural_language: string; sql_query: string; explanation?: string; tables_involved?: string },
  ): Promise<{ id: number; message?: string }> {
    return this.directRequest<{ id: number; message?: string }>("POST", `/dataloom/connections/${connectionId}/sql-examples`, data);
  }

  async deleteTableExplanation(id: number): Promise<{ message?: string }> {
    return this.directRequest<{ message?: string }>("DELETE", `/dataloom/table-explanations/${id}`);
  }

  async deleteColumnExplanation(id: number): Promise<{ message?: string }> {
    return this.directRequest<{ message?: string }>("DELETE", `/dataloom/column-explanations/${id}`);
  }

  async deleteSqlExample(id: number): Promise<{ message?: string }> {
    return this.directRequest<{ message?: string }>("DELETE", `/dataloom/sql-examples/${id}`);
  }
}

export const api = new ApiClient();

// Also export the class for direct instantiation if needed
export { ApiClient };
