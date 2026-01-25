// =============================================================================
// Zustand Store - Global State Management
// =============================================================================

import { create } from "zustand";
import type { DatabaseConnection, DatabaseSchema, ChatMessage, QueryResult, AIModel, AIAgent } from "../types";
import { api } from "../services/api";

// Menu types
export type MenuType = "chat" | "database" | "settings" | "knowledgebase" | "development";

interface AppState {
  // Menu
  activeMenu: MenuType;
  setActiveMenu: (menu: MenuType) => void;

  // Connections
  connections: DatabaseConnection[];
  activeConnectionId: number | null;
  connectionSessionId: string | null; // NEW: Session ID for current connection
  chatSessionId: string | null; // NEW: Session ID for current chat
  schema: DatabaseSchema | null;
  schemaError: string | null;
  schemaLoading: boolean;
  loadingConnections: boolean;

  // AI Agents
  agents: AIAgent[];
  selectedAgent: AIAgent | null;
  agentModels: AIModel[];
  selectedModel: AIModel | null;
  loadingAgents: boolean;

  // Chat
  messages: ChatMessage[];
  loadingChat: boolean;

  // UI
  sidebarOpen: boolean;

  // Connection Actions
  loadConnections: () => Promise<void>;
  createConnection: (data: {
    name: string;
    type: string;
    config: Record<string, unknown>;
    description?: string;
  }) => Promise<DatabaseConnection>;
  updateConnection: (id: number, data: Partial<DatabaseConnection>) => Promise<void>;
  deleteConnection: (id: number) => Promise<void>;
  setActiveConnection: (id: number | null) => Promise<void>;
  loadConnectionSchema: (id: number | null) => Promise<void>; // NEW: Load schema for a connection
  connectDatabase: (
    id: number,
  ) => Promise<{ success: boolean; latencyMs?: number; sessionId?: string; readOnlyStatus?: "readonly" | "readwrite" | "unknown" }>;
  disconnectDatabase: (sessionId: string) => Promise<{ success: boolean }>; // NEW: Use sessionId
  testConnection: (id: number) => Promise<{ success: boolean; latencyMs?: number }>;
  resetChatSession: () => void; // NEW: Reset chat session and messages

  // AI Agent Actions
  loadAgents: () => Promise<void>;
  selectAgent: (agent: AIAgent | null) => Promise<void>;
  loadAgentModels: (agent: AIAgent) => Promise<void>;
  selectModel: (model: AIModel | null) => void;
  createAgent: (data: Partial<AIAgent>) => Promise<AIAgent>;
  updateAgent: (id: number, data: Partial<AIAgent>) => Promise<void>;
  deleteAgent: (id: number) => Promise<void>;

  // Chat Actions
  sendMessage: (content: string) => Promise<void>;
  executeSQLDirectly: (sql: string) => Promise<QueryResult | null>;
  clearMessages: () => void;

  // UI Actions
  toggleSidebar: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Initial state
  activeMenu: "chat",
  connections: [],
  activeConnectionId: null,
  connectionSessionId: null,
  chatSessionId: null,
  schema: null,
  schemaError: null,
  schemaLoading: false,
  loadingConnections: false,
  agents: [],
  selectedAgent: null,
  agentModels: [],
  selectedModel: null,
  loadingAgents: false,
  messages: [],
  loadingChat: false,
  sidebarOpen: true,

  // Menu Actions
  setActiveMenu: (menu) => {
    set({ activeMenu: menu });
  },

  // Connection Actions
  loadConnections: async () => {
    const state = get();
    if (state.loadingConnections) return;
    set({ loadingConnections: true });
    try {
      const connections = await api.getConnections();
      set({ connections: connections || [] });
    } catch (error) {
      console.error("Failed to load connections:", error);
      set({ connections: [] });
    } finally {
      set({ loadingConnections: false });
    }
  },

  createConnection: async (data) => {
    try {
      const result = await api.createConnection(data);
      // After creating, fetch the full connection object from the database
      const newConnection = await api.getConnection(result.id);
      set((state) => ({
        connections: [...state.connections, newConnection],
      }));
      return newConnection;
    } catch (error) {
      console.error("Failed to create connection:", error);
      throw error;
    }
  },

  updateConnection: async (id, data) => {
    try {
      await api.updateConnection(id, data);
      set((state) => ({
        connections: state.connections.map((c) => (c.id === id ? { ...c, ...data } : c)),
      }));
    } catch (error) {
      console.error("Failed to update connection:", error);
      throw error;
    }
  },

  deleteConnection: async (id) => {
    try {
      await api.deleteConnection(id);
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== id),
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        schema: state.activeConnectionId === id ? null : state.schema,
        schemaError: state.activeConnectionId === id ? null : state.schemaError,
      }));
    } catch (error) {
      console.error("Failed to delete connection:", error);
      throw error;
    }
  },

  // New function to load schema for a connection
  loadConnectionSchema: async (id: number | null) => {
    if (!id) {
      set({ schema: null, schemaError: null, schemaLoading: false });
      return;
    }

    set({ schemaLoading: true, schemaError: null });
    try {
      const schema = await api.getSchema(id);
      set({ schema, schemaError: null, schemaLoading: false });
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : "Failed to load schema";
      set({ schema: null, schemaError: errorMsg, schemaLoading: false });
    }
  },

  setActiveConnection: async (id) => {
    // Set active connection ID
    set({ activeConnectionId: id, schema: null, schemaError: null, schemaLoading: false });
  },

  connectDatabase: async (id) => {
    try {
      const result = await api.connectDatabase(id);
      if (result.success && result.sessionId) {
        set({ connectionSessionId: result.sessionId });
      }
      return result;
    } catch (error) {
      console.error("Failed to connect database:", error);
      return { success: false };
    }
  },

  disconnectDatabase: async (sessionId) => {
    try {
      const result = await api.disconnectDatabaseSession(sessionId);
      if (result.success) {
        set({ connectionSessionId: null, chatSessionId: null, messages: [] });
      }
      return result;
    } catch (error) {
      console.error("Failed to disconnect database:", error);
      return { success: false };
    }
  },

  resetChatSession: () => {
    // Reset chat-related state when entering chat page
    set({ connectionSessionId: null, chatSessionId: null, messages: [] });
  },

  testConnection: async (id) => {
    try {
      return await api.testConnection(id);
    } catch (error) {
      console.error("Failed to test connection:", error);
      return { success: false };
    }
  },

  // AI Agent Actions
  loadAgents: async () => {
    const state = get();
    if (state.loadingAgents) return;
    set({ loadingAgents: true });
    try {
      const agents = await api.getAIAgents();
      const defaultAgent = agents.find((a) => a.is_default === 1) || agents[0];
      set({ agents: agents || [] });

      // Auto-select default agent
      if (defaultAgent && !get().selectedAgent) {
        await get().selectAgent(defaultAgent);
      }
    } catch (error) {
      console.error("Failed to load agents:", error);
      set({ agents: [] });
    } finally {
      set({ loadingAgents: false });
    }
  },

  selectAgent: async (agent) => {
    set({ selectedAgent: agent, agentModels: [], selectedModel: null });
    if (agent) {
      await get().loadAgentModels(agent);
    }
  },

  loadAgentModels: async (agent) => {
    try {
      const models = await api.getModelsFromAgent(agent);
      const defaultModel = agent.model ? models.find((m) => m.id === agent.model) || models[0] : models[0];
      set({ agentModels: models, selectedModel: defaultModel || null });
    } catch (error) {
      console.error("Failed to load agent models:", error);
      set({ agentModels: [], selectedModel: null });
    }
  },

  selectModel: (model) => {
    set({ selectedModel: model });
  },

  createAgent: async (data) => {
    try {
      const result = await api.createAIAgent(data);
      const newAgent = await api.getAIAgent(result.id);
      set((state) => ({
        agents: [...state.agents, newAgent],
      }));
      return newAgent;
    } catch (error) {
      console.error("Failed to create agent:", error);
      throw error;
    }
  },

  updateAgent: async (id, data) => {
    try {
      // If setting this agent as default, unset others
      if (data.is_default === 1) {
        const state = get();
        for (const agent of state.agents) {
          if (agent.id !== id && agent.is_default === 1) {
            await api.updateAIAgent(agent.id, { is_default: 0 });
          }
        }
      }

      await api.updateAIAgent(id, data);
      const updatedAgent = await api.getAIAgent(id);
      set((state) => ({
        agents: state.agents.map((a) => {
          // If this agent is set as default, unset others
          if (data.is_default === 1 && a.id !== id && a.is_default === 1) {
            return { ...a, is_default: 0 };
          }
          return a.id === id ? updatedAgent : a;
        }),
        selectedAgent: state.selectedAgent?.id === id ? updatedAgent : state.selectedAgent,
      }));
    } catch (error) {
      console.error("Failed to update agent:", error);
      throw error;
    }
  },

  deleteAgent: async (id) => {
    try {
      await api.deleteAIAgent(id);
      set((state) => ({
        agents: state.agents.filter((a) => a.id !== id),
        selectedAgent: state.selectedAgent?.id === id ? null : state.selectedAgent,
      }));
    } catch (error) {
      console.error("Failed to delete agent:", error);
      throw error;
    }
  },

  // Chat Actions
  sendMessage: async (content) => {
    const { activeConnectionId, connectionSessionId, chatSessionId, selectedAgent } = get();

    if (!connectionSessionId) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "⚠️ Please connect to a database first.",
        timestamp: new Date().toISOString(),
      };
      set((state) => ({ messages: [...state.messages, errorMessage] }));
      return;
    }

    if (!selectedAgent) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "⚠️ Please select an AI agent first.",
        timestamp: new Date().toISOString(),
      };
      set((state) => ({ messages: [...state.messages, errorMessage] }));
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    // Add user message and show "Preparing data..." status
    const preparingMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "⏳ Analyzing your question and querying database...",
      timestamp: new Date().toISOString(),
      isLoading: true,
    };

    set((state) => ({
      messages: [...state.messages, userMessage, preparingMessage],
      loadingChat: true,
    }));

    try {
      // Call the query API with session IDs and agent info
      // Backend will:
      // 1. Validate connectionSessionId
      // 2. Validate or create chatSessionId
      // 3. Use the specified agent and provider for AI requests
      // 4. Use different AI prompt based on whether it's first question or follow-up
      // 5. Return updated chatSessionId
      const result = await api.executeNaturalLanguageQuery(activeConnectionId || 0, content, {
        connectionSessionId,
        chatSessionId: chatSessionId || undefined,
        agentId: selectedAgent.id,
        agentProvider: selectedAgent.provider,
        model: selectedAgent.model,
      });

      // Update chat session ID if we got a new one (first question)
      if (result.chatSessionId && result.chatSessionId !== chatSessionId) {
        set({ chatSessionId: result.chatSessionId });
      }

      // Remove the preparing message
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== preparingMessage.id),
      }));

      let assistantContent = "";
      if (result.success && result.data) {
        // Format successful response with SQL, data, and visualization info
        const { sql, data, columns, rowCount, visualization } = result.data as any;

        // Build formatted response - only explanation in text section
        const parts: string[] = [];

        // Add explanation only
        if (result.explanation) {
          parts.push(result.explanation);
        }

        assistantContent = parts.join("\n") || "Query executed successfully.";

        // Store query result for visualization component
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date().toISOString(),
          queryResult: {
            sql,
            data,
            columns,
            rowCount,
            visualization,
          },
        };

        set((state) => ({
          messages: [...state.messages, assistantMessage],
        }));
      } else {
        // Error response
        assistantContent = `⚠️ ${result.error || "Query failed"}`;

        // Include queryResult with SQL even on error so it can be displayed
        const errorSql = (result as any)?.sql || (result.data as any)?.sql;
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date().toISOString(),
          queryResult: errorSql
            ? {
                sql: errorSql,
                data: undefined,
                columns: undefined,
              }
            : undefined,
        };

        set((state) => ({
          messages: [...state.messages, assistantMessage],
        }));
      }
    } catch (error) {
      // Remove the preparing message
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== preparingMessage.id),
      }));

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠️ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: new Date().toISOString(),
      };
      set((state) => ({
        messages: [...state.messages, errorMessage],
      }));
    } finally {
      set({ loadingChat: false });
    }
  },

  executeSQLDirectly: async (sql) => {
    const { activeConnectionId, connectionSessionId } = get();
    if (!connectionSessionId) {
      console.error("No active connection");
      return null;
    }

    try {
      return await api.executeSQL(activeConnectionId || 0, sql, {
        connectionSessionId,
      });
    } catch (error) {
      console.error("Failed to execute SQL:", error);
      return null;
    }
  },

  clearMessages: () => {
    set({ messages: [] });
  },

  // UI Actions
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },
}));
