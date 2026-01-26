// =============================================================================
// DataLoom Database Connections REST API
// =============================================================================

import express, { Router, Request, Response } from "express";
import { logger } from "../utils/logger.js";
import {
  getSchema,
  testConnection,
  checkReadOnlyStatus,
  createReadOnlyConnection,
  initializeConnection,
  validateConnectionSession,
  createChatSession,
  validateChatSession,
  markChatSessionAsFollowUp,
  disconnectSession,
  resetChatSession,
} from "../services/database/connectionManager.js";
import * as connectionManager from "../services/database/connectionManager.js";
import {
  createDatabaseConnection,
  getDatabaseConnection,
  updateDatabaseConnection,
  deleteDatabaseConnection,
  getDatabaseConnectionsByWorkspace,
  createTableExplanation,
  getTableExplanation,
  updateTableExplanation,
  deleteTableExplanation,
  getTableExplanationsByConnection,
  createColumnExplanation,
  getColumnExplanation,
  updateColumnExplanation,
  deleteColumnExplanation,
  getColumnExplanationsByTable,
  createSqlExample,
  getSqlExample,
  updateSqlExample,
  deleteSqlExample,
  getSqlExamplesByConnection,
  createAiAgent,
  getAiAgent,
  getAiAgentByName,
  updateAiAgent,
  deleteAiAgent,
  getAllAiAgents,
  getDefaultAiAgent,
  getDefaultWorkspace,
} from "../services/dataloom/databaseService.js";
import {
  getFullKnowledgeBase,
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
  saveAnalysisResult,
  clearKnowledgeBase,
  type AnalysisResult,
} from "../services/dataloom/knowledgeBaseService.js";
import { agentService, type AIAgentConfig } from "../services/agent/index.js";

const router = Router();

// ============================================================================
// Session Management for Analysis Cancellation
// ============================================================================
// Map to track active analysis sessions and their abort signals
const activeAnalysisSessions = new Map<string, { signal: AbortSignal; abortController: AbortController }>();

// ============================================================================
// Analysis Progress Tracking
// ============================================================================
interface AnalysisProgress {
  sessionId: string;
  connectionId: number;
  currentPhase: 0 | 1 | 2 | 3 | 4; // 0=starting, 1=phase1, 2=phase2, 3=phase3, 4=completed
  phases: {
    phase1: string;
    phase2: string;
    phase3: string;
  };
  startTime: number;
  lastUpdateTime: number;
  cancelled: boolean;
}

// Map to track analysis progress by sessionKey
const analysisProgressMap = new Map<string, AnalysisProgress>();

// ============================================================================
// Database Connections
// ============================================================================

// Create connection
router.post("/connections", (req: Request, res: Response) => {
  try {
    const { workspace_id, name, type, config, description, selected_schemas } = req.body;

    if (!workspace_id || !name || !type || !config) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Store selected_schemas in schema_json for now (will be expanded later)
    const schema_json = selected_schemas ? JSON.stringify({ selected_schemas }) : undefined;

    const id = createDatabaseConnection({
      workspace_id,
      name,
      type,
      config: JSON.stringify(config),
      schema_json,
      description,
    });

    res.json({ id, message: "Connection created" });
  } catch (error: any) {
    logger.error(`Error creating connection: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Test connection configuration
router.post("/connections/test-config", async (req: Request, res: Response) => {
  try {
    let type: string;
    let config: any = {};

    // Handle both nested config format and flat format
    if (req.body.config && typeof req.body.config === "object") {
      // Format 1: { type: "sqlite", config: { path: "..." } }
      type = req.body.type;
      config = req.body.config;
    } else {
      // Format 2: { type: "sqlite", path: "...", host: "..." }
      const { type: requestType, ...configFields } = req.body;
      type = requestType;

      // Build config object from flat structure
      if (configFields.path) config.path = configFields.path;
      if (configFields.host) config.host = configFields.host;
      if (configFields.port) config.port = configFields.port;
      if (configFields.database) config.database = configFields.database;
      if (configFields.username) config.username = configFields.username;
      if (configFields.password) config.password = configFields.password;
      if (configFields.ssl !== undefined) config.ssl = configFields.ssl;
      if (configFields.connectionTimeout) config.connectionTimeout = configFields.connectionTimeout;
    }

    if (!type) {
      return res.status(400).json({ error: "Missing required field: type" });
    }

    if (Object.keys(config).length === 0) {
      return res.status(400).json({ error: "No connection config fields provided" });
    }

    // Use unified read-only connection creation
    const startTime = Date.now();
    try {
      const { pool, readOnlyStatus } = await createReadOnlyConnection({
        id: 0, // temp connection for testing
        type,
        config,
      } as any);
      const latencyMs = Date.now() - startTime;

      // Close the test connection
      if (type === "sqlite") {
        (pool as any).close();
      } else if (type === "mssql" || type === "sqlserver") {
        await (pool as any).close();
      } else if (type === "postgresql") {
        await (pool as any).end();
      }

      res.json({ success: true, latencyMs, readOnlyStatus });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error(`[Database Connection] Failed to create read-only connection: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message || "Connection test failed",
        latencyMs,
      });
    }
  } catch (error: any) {
    logger.error(`Error testing connection: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch available schemas from PostgreSQL
router.post("/connections/schemas/fetch", async (req: Request, res: Response) => {
  try {
    const { type, host, port, database, username, password, ssl } = req.body;

    if (type !== "postgresql") {
      return res.status(400).json({ error: "Schema fetching is only supported for PostgreSQL" });
    }

    // Import pg dynamically to avoid loading it if not needed
    const pg = await import("pg");

    const client = new pg.Client({
      host,
      port: port || 5432,
      database,
      user: username,
      password,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
    });

    try {
      await client.connect();

      // Fetch all schemas except system schemas
      const result = await client.query(
        `
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1')
        AND schema_name NOT LIKE 'pg_temp_%'
        AND schema_name NOT LIKE 'pg_toast_temp_%'
        ORDER BY schema_name
        `,
      );

      const schemas = result.rows.map((row: any) => row.schema_name);
      res.json(schemas);
    } finally {
      await client.end();
    }
  } catch (error: any) {
    logger.error(`Error fetching PostgreSQL schemas: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Connect to an existing database by ID
router.post("/connections/:id/connect", async (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const connection = getDatabaseConnection(connectionId);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Parse the stored config JSON
    let config: any;
    try {
      config = typeof connection.config === "string" ? JSON.parse(connection.config) : connection.config;
    } catch (e) {
      return res.status(400).json({ error: "Invalid connection config" });
    }

    // Initialize connection - creates, validates, and caches it for reuse
    const startTime = Date.now();
    try {
      const { sessionId, readOnlyStatus } = await initializeConnection({
        ...connection,
        config,
      } as any);
      const latencyMs = Date.now() - startTime;

      logger.info(`[Database Connection] Connection ${connectionId} initialized with session ${sessionId}`);

      res.json({
        success: true,
        latencyMs,
        sessionId,
        readOnlyStatus,
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error(`[Database Connection] Failed to initialize connection: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message || "Connection initialization failed",
        latencyMs,
      });
    }
  } catch (error: any) {
    logger.error(`Error connecting to database: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Disconnect from a database connection session
router.post("/connections/session/:sessionId/disconnect", async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    await disconnectSession(sessionId);
    res.json({ success: true, message: "Connection session disconnected" });
  } catch (error: any) {
    logger.error(`Error disconnecting session ${req.params.sessionId}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Disconnect from a database (legacy endpoint)
router.post("/connections/:id/disconnect", async (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const connection = getDatabaseConnection(connectionId);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Perform cleanup if needed
    // Currently just returns success
    res.json({ success: true, message: "Disconnected from database" });
  } catch (error: any) {
    logger.error(`Error disconnecting from database: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset chat session - clears chat history and creates new session
router.post("/connections/session/:sessionId/reset-chat", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { chatSessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: "Session ID is required" });
    }

    // Reset chat session and get new chat session ID
    const newChatSessionId = connectionManager.resetChatSession(sessionId, chatSessionId);

    logger.info(`[Chat Session] Reset chat session for connection session ${sessionId}, new chat session: ${newChatSessionId}`);

    res.json({
      success: true,
      message: "Chat session reset successfully",
      chatSessionId: newChatSessionId,
    });
  } catch (error: any) {
    logger.error(`Error resetting chat session: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// Knowledge Base API
// ============================================================================

// Get full knowledge base for a connection (table explanations, column explanations, sql examples)
router.get("/connections/:id/knowledge-base", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const connection = getDatabaseConnection(connectionId);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const knowledgeBase = getFullKnowledgeBase(connectionId);
    res.json(knowledgeBase);
  } catch (error: any) {
    logger.error(`Error getting knowledge base: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Analyze schema with AI using 3-phase approach
// Phase 1: Table structure analysis (table names, columns, data types)
// Phase 2: Column explanations (column details, business meaning, sensitivity, synonyms)
// Phase 3: SQL examples generation (generate SQL examples and final result)
router.post("/connections/:id/analyze", async (req: Request, res: Response) => {
  let sessionKey: string | null = null;
  try {
    const connectionId = parseInt(req.params.id);
    const { userInput, files, model, sessionId, agentId, agentProvider } = req.body;

    logger.debug(`[ANALYZE] Starting 3-phase analysis for connection ${connectionId}`);

    const connection = getDatabaseConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Get the AI agent - use provided agent or default
    let selectedAgent: AIAgentConfig | null = null;
    let chatModel = model;

    if (agentId && agentProvider) {
      const agent = getAiAgent(parseInt(agentId));
      if (agent) {
        selectedAgent = agent;
      } else {
        logger.warn(`AI Agent not found: ${agentId}, falling back to default`);
        selectedAgent = getDefaultAiAgent() || null;
      }
    } else {
      selectedAgent = getDefaultAiAgent() || null;
    }

    // Validate agent is available
    if (!selectedAgent) {
      return res.status(400).json({ error: "No AI agent configured. Please configure an agent in Agent Settings." });
    }

    // Priority: use model parameter if provided, then agent's model, then fallback
    if (!chatModel && selectedAgent.model) {
      chatModel = selectedAgent.model;
    }
    if (!chatModel) {
      chatModel = "gpt-4o"; // Ultimate fallback
    }

    logger.info(`[ANALYZE] Using AI Agent: ${selectedAgent.name}, Provider: ${selectedAgent.provider}, Model: ${chatModel}`);

    // Get existing knowledge base
    const existingKnowledge = getFullKnowledgeBase(connectionId);
    logger.info(
      `[ANALYZE-KB] Existing Knowledge Base Summary: ` +
        `Table Explanations: ${existingKnowledge.tableExplanations.length}, ` +
        `Column Explanations: ${existingKnowledge.columnExplanations.length}, ` +
        `SQL Examples: ${existingKnowledge.sqlExamples.length}`,
    );

    let finalAnalysisResult: AnalysisResult;

    // Generate a single session ID for all three phases to maintain chat context
    const analysisSessionId = sessionId || `analysis_${Date.now()}`;
    logger.info(`[ANALYZE] Using session ID for all phases: ${analysisSessionId}`);

    // Register this analysis session for cancellation tracking
    sessionKey = `${connectionId}:${analysisSessionId}`;
    const abortController = new AbortController();
    activeAnalysisSessions.set(sessionKey, { signal: abortController.signal, abortController });
    logger.debug(`[ANALYZE] Registered analysis session for tracking: ${sessionKey}`);

    // Initialize progress tracking
    const analysisProgress: AnalysisProgress = {
      sessionId: analysisSessionId,
      connectionId,
      currentPhase: 0,
      phases: {
        phase1: "Starting...",
        phase2: "Pending",
        phase3: "Pending",
      },
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      cancelled: false,
    };
    analysisProgressMap.set(sessionKey, analysisProgress);
    logger.debug(`[ANALYZE] Initialized progress tracking for session: ${sessionKey}`);

    // === PHASE 1: Table Structure Analysis ===
    logger.info(`[ANALYZE-PHASE1] Starting Phase 1: Table structure analysis`);
    analysisProgress.currentPhase = 1;
    analysisProgress.phases.phase1 = "In progress...";
    analysisProgress.lastUpdateTime = Date.now();

    const promptOptions = { userInput, files };
    const phase1Prompt = await buildPhase1Prompt(connectionId, promptOptions);
    const phase1PromptSize = Buffer.byteLength(phase1Prompt, "utf-8");
    logger.info(`[ANALYZE-PHASE1] Phase 1 prompt size: ${phase1PromptSize} bytes`);
    logger.debug(`[ANALYZE-PHASE1] First 100 lines of phase 1 prompt:\n${phase1Prompt.split("\n").slice(0, 100).join("\n")}`);

    logger.info(`[ANALYZE-PHASE1] Sending Phase 1 prompt to AI (${chatModel})...`);
    logger.info(`[ANALYZE-PHASE1] Agent max_tokens: ${selectedAgent.max_tokens || "not set"}`);

    const phase1Response = await agentService.chat(selectedAgent, {
      prompt: phase1Prompt,
      model: chatModel,
      timeout: 300000, // 5 minutes for Phase 1 (some providers like Zhipu may be slow)
      maxTokens: selectedAgent.max_tokens || undefined,
      sessionId: analysisSessionId, // Use same session for all phases
    });

    if (!phase1Response.success) {
      logger.error(`[ANALYZE-PHASE1] Phase 1 analysis failed: ${phase1Response.error}`);
      logger.info(`[ANALYZE] Attempting fallback: Simplified single-request analysis...`);

      // Fallback: Try simplified analysis with Phase 1 only
      try {
        const simplifiedPrompt = await buildPhase1Prompt(connectionId, promptOptions);
        const retryResponse = await agentService.chat(selectedAgent, {
          prompt: simplifiedPrompt,
          model: chatModel,
          timeout: 180000, // 3 minutes for retry
          maxTokens: selectedAgent.max_tokens || undefined,
          sessionId: `${analysisSessionId}_retry`,
        });

        if (retryResponse.success && retryResponse.response) {
          let jsonString = retryResponse.response;
          const jsonMatch = retryResponse.response.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonString = jsonMatch[1].trim();
          }
          const retryResult = JSON.parse(jsonString);
          logger.info(`[ANALYZE-FALLBACK] Simplified analysis succeeded with ${retryResult.tableExplanations.length} tables`);

          return res.json({
            success: true,
            analysis: retryResult,
            message: "Analysis completed using simplified approach. Review the results and click Save to store them.",
            phases: {
              phase1: "✓ Simplified table structure analysis completed",
              phase2: "⊘ Skipped (using fallback)",
              phase3: "⊘ Skipped (using fallback)",
            },
          });
        }
      } catch (fallbackError) {
        logger.error(`[ANALYZE-FALLBACK] Fallback analysis also failed: ${fallbackError}`);
      }

      throw new Error(`Phase 1 analysis failed: ${phase1Response.error} (fallback also failed)`);
    }

    if (!phase1Response.response) {
      throw new Error("Phase 1 analysis returned empty response");
    }

    // Parse Phase 1 response
    let phase1Result: AnalysisResult;
    try {
      let jsonString = phase1Response.response;
      const jsonMatch = phase1Response.response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1].trim();
      }
      phase1Result = JSON.parse(jsonString);
      logger.info(
        `[ANALYZE-PHASE1] Phase 1 succeeded - Tables: ${phase1Result.tableExplanations.length}, ` +
          `Columns: ${phase1Result.tableExplanations.reduce((sum, t) => sum + (t.columns?.length || 0), 0)}`,
      );
      // Update progress
      analysisProgress.currentPhase = 2;
      analysisProgress.phases.phase1 = "✓ Completed";
      analysisProgress.phases.phase2 = "In progress...";
      analysisProgress.lastUpdateTime = Date.now();
    } catch (parseError) {
      logger.error(`[ANALYZE-PHASE1] Failed to parse Phase 1 response: ${parseError}`);
      return res.status(500).json({
        error: "Failed to parse Phase 1 analysis result",
        rawResponse: phase1Response.response,
      });
    }

    // === PHASE 2: Column Explanations Analysis ===
    logger.info(`[ANALYZE-PHASE2] Starting Phase 2: Column explanations based on Phase 1 results`);

    const phase2Prompt = await buildPhase2Prompt(connectionId, phase1Result, promptOptions);
    const phase2PromptSize = Buffer.byteLength(phase2Prompt, "utf-8");
    logger.info(`[ANALYZE-PHASE2] Phase 2 prompt size: ${phase2PromptSize} bytes`);
    logger.debug(`[ANALYZE-PHASE2] First 100 lines of phase 2 prompt:\n${phase2Prompt.split("\n").slice(0, 100).join("\n")}`);

    logger.info(`[ANALYZE-PHASE2] Sending Phase 2 prompt to AI (${chatModel})...`);
    logger.info(`[ANALYZE-PHASE2] Agent max_tokens: ${selectedAgent.max_tokens || "not set"}`);

    const phase2Response = await agentService.chat(selectedAgent, {
      prompt: phase2Prompt,
      model: chatModel,
      timeout: 300000, // 5 minutes for Phase 2 (some providers like Zhipu may be slow)
      maxTokens: selectedAgent.max_tokens || undefined,
      sessionId: analysisSessionId, // Use same session for all phases
    });

    let phase2Result: AnalysisResult = phase1Result;
    if (!phase2Response.success) {
      logger.error(`[ANALYZE-PHASE2] Phase 2 analysis failed: ${phase2Response.error}`);
      logger.info(`[ANALYZE-PHASE2] Continuing to Phase 3 with Phase 1 results as fallback`);
      // Update progress to Phase 3
      analysisProgress.currentPhase = 3;
      analysisProgress.phases.phase2 = "⊘ Skipped (using fallback)";
      analysisProgress.phases.phase3 = "In progress...";
      analysisProgress.lastUpdateTime = Date.now();
    } else {
      if (!phase2Response.response) {
        logger.warn(`[ANALYZE-PHASE2] Phase 2 returned empty response, using Phase 1 results`);
        // Update progress to Phase 3
        analysisProgress.currentPhase = 3;
        analysisProgress.phases.phase2 = "⊘ Skipped (using fallback)";
        analysisProgress.phases.phase3 = "In progress...";
        analysisProgress.lastUpdateTime = Date.now();
      } else {
        // Parse Phase 2 response
        try {
          let jsonString = phase2Response.response;
          const jsonMatch = phase2Response.response.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonString = jsonMatch[1].trim();
          }
          phase2Result = JSON.parse(jsonString);
          logger.info(
            `[ANALYZE-PHASE2] Phase 2 succeeded - Tables: ${phase2Result.tableExplanations.length}, ` +
              `Columns: ${phase2Result.tableExplanations.reduce((sum, t) => sum + (t.columns?.length || 0), 0)}`,
          );
          // Update progress
          analysisProgress.currentPhase = 3;
          analysisProgress.phases.phase2 = "✓ Completed";
          analysisProgress.phases.phase3 = "In progress...";
          analysisProgress.lastUpdateTime = Date.now();
        } catch (parseError) {
          logger.error(`[ANALYZE-PHASE2] Failed to parse Phase 2 response: ${parseError}`);
          logger.info(`[ANALYZE-PHASE2] Continuing to Phase 3 with Phase 1 results as fallback`);
          // Update progress to Phase 3
          analysisProgress.currentPhase = 3;
          analysisProgress.phases.phase2 = "⊘ Skipped (parse error)";
          analysisProgress.phases.phase3 = "In progress...";
          analysisProgress.lastUpdateTime = Date.now();
        }
      }
    }

    // === PHASE 3: SQL Examples and Final Assembly ===
    logger.info(`[ANALYZE-PHASE3] Starting Phase 3: SQL examples generation and final assembly`);

    const phase3Prompt = await buildPhase3Prompt(connectionId, phase2Result, promptOptions);
    const phase3PromptSize = Buffer.byteLength(phase3Prompt, "utf-8");
    logger.info(`[ANALYZE-PHASE3] Phase 3 prompt size: ${phase3PromptSize} bytes`);
    logger.debug(`[ANALYZE-PHASE3] First 100 lines of phase 3 prompt:\n${phase3Prompt.split("\n").slice(0, 100).join("\n")}`);

    logger.info(`[ANALYZE-PHASE3] Sending Phase 3 prompt to AI (${chatModel})...`);
    logger.info(`[ANALYZE-PHASE3] Agent max_tokens: ${selectedAgent.max_tokens || "not set"}`);

    const phase3Response = await agentService.chat(selectedAgent, {
      prompt: phase3Prompt,
      model: chatModel,
      timeout: 300000, // 5 minutes for Phase 3 (some providers like Zhipu may be slow)
      maxTokens: selectedAgent.max_tokens || undefined,
      sessionId: analysisSessionId, // Use same session for all phases
    });

    if (!phase3Response.success) {
      logger.error(`[ANALYZE-PHASE3] Phase 3 analysis failed: ${phase3Response.error}`);
      logger.info(`[ANALYZE-PHASE3] Returning Phase 2 results as fallback since Phase 3 failed`);
      finalAnalysisResult = phase2Result;
      // Update progress - mark as completed even though phase 3 failed
      analysisProgress.currentPhase = 4;
      analysisProgress.phases.phase3 = "⊘ Skipped (using fallback)";
      analysisProgress.lastUpdateTime = Date.now();
    } else {
      if (!phase3Response.response) {
        logger.warn(`[ANALYZE-PHASE3] Phase 3 returned empty response, using Phase 2 results`);
        finalAnalysisResult = phase2Result;
        // Update progress - mark as completed
        analysisProgress.currentPhase = 4;
        analysisProgress.phases.phase3 = "⊘ Skipped (using fallback)";
        analysisProgress.lastUpdateTime = Date.now();
      } else {
        // Parse Phase 3 response
        try {
          let jsonString = phase3Response.response;
          const jsonMatch = phase3Response.response.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonString = jsonMatch[1].trim();
          }
          finalAnalysisResult = JSON.parse(jsonString);
          logger.info(
            `[ANALYZE-PHASE3] Phase 3 succeeded - Tables: ${finalAnalysisResult.tableExplanations.length}, ` +
              `Columns: ${finalAnalysisResult.tableExplanations.reduce((sum, t) => sum + (t.columns?.length || 0), 0)}, ` +
              `SQL Examples: ${finalAnalysisResult.sqlExamples.length}`,
          );
          // Update progress
          analysisProgress.currentPhase = 4;
          analysisProgress.phases.phase3 = "✓ Completed";
          analysisProgress.lastUpdateTime = Date.now();
        } catch (parseError) {
          logger.error(`[ANALYZE-PHASE3] Failed to parse Phase 3 response: ${parseError}`);
          logger.info(`[ANALYZE-PHASE3] Returning Phase 2 results as fallback`);
          finalAnalysisResult = phase2Result;
          // Update progress - mark as completed
          analysisProgress.currentPhase = 4;
          analysisProgress.phases.phase3 = "⊘ Skipped (parse error)";
          analysisProgress.lastUpdateTime = Date.now();
        }
      }
    }

    logger.info(`[ANALYZE] 3-phase analysis completed successfully`);
    analysisProgress.currentPhase = 4;
    analysisProgress.lastUpdateTime = Date.now();

    // Clean up the session from tracking
    if (sessionKey) {
      activeAnalysisSessions.delete(sessionKey);
    }

    res.json({
      success: true,
      analysis: finalAnalysisResult,
      message: "Analysis completed. Review the results and click Save to store them.",
      phases: {
        phase1: "✓ Table structure analysis completed",
        phase2: phase2Response?.success ? "✓ Column explanations completed" : "✗ Column explanations failed, using Phase 1 results",
        phase3: phase3Response?.success ? "✓ SQL examples generated" : "✗ SQL examples failed, using Phase 1+2 results",
      },
    });
  } catch (error: any) {
    logger.error(`Error analyzing schema: ${error.message}`);

    // Clean up the session on error
    if (sessionKey) {
      activeAnalysisSessions.delete(sessionKey);
      analysisProgressMap.delete(sessionKey);
    }

    res.status(500).json({ error: error.message });
  }
});

// Get analysis progress status
router.get("/connections/:id/analyze/status/:sessionId", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const sessionId = req.params.sessionId;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const sessionKey = `${connectionId}:${sessionId}`;
    const progress = analysisProgressMap.get(sessionKey);

    if (!progress) {
      // Session doesn't exist or already completed
      return res.json({
        found: false,
        message: "Analysis session not found or already completed",
      });
    }

    res.json({
      found: true,
      currentPhase: progress.currentPhase,
      phases: progress.phases,
      cancelled: progress.cancelled,
      elapsedSeconds: Math.floor((Date.now() - progress.startTime) / 1000),
    });
  } catch (error: any) {
    logger.error(`Error getting analysis status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Cancel ongoing analysis
router.post("/connections/:id/analyze/cancel", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const connection = getDatabaseConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Check if this session is active
    const sessionKey = `${connectionId}:${sessionId}`;
    const activeSession = activeAnalysisSessions.get(sessionKey);

    if (!activeSession) {
      logger.warn(`[ANALYZE-CANCEL] Session not found or already completed: ${sessionKey}`);
      return res.json({
        success: true,
        message: "Analysis session not found or already completed",
      });
    }

    // Cancel the request
    logger.info(`[ANALYZE-CANCEL] Cancelling analysis for session: ${sessionKey}`);
    activeSession.abortController.abort();

    // Mark progress as cancelled
    const progress = analysisProgressMap.get(sessionKey);
    if (progress) {
      progress.cancelled = true;
    }

    // Remove the session from tracking
    activeAnalysisSessions.delete(sessionKey);

    res.json({
      success: true,
      message: "Analysis cancellation signal sent successfully",
    });
  } catch (error: any) {
    logger.error(`Error cancelling analysis: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Save analysis result to database
router.post("/connections/:id/knowledge-base/save", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const analysisResult: AnalysisResult = req.body;

    const connection = getDatabaseConnection(connectionId);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const stats = saveAnalysisResult(connectionId, analysisResult);

    res.json({
      success: true,
      message: `Knowledge base saved successfully`,
      stats,
    });
  } catch (error: any) {
    logger.error(`Error saving knowledge base: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Clear all knowledge base for a connection
router.delete("/connections/:id/knowledge-base", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const connection = getDatabaseConnection(connectionId);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    clearKnowledgeBase(connectionId);
    res.json({ success: true, message: "Knowledge base cleared" });
  } catch (error: any) {
    logger.error(`Error clearing knowledge base: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Save analyzed knowledge base (batch operation for AI-analyzed schema) - Legacy API
router.post("/connections/:id/save-knowledge-base", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const { tableRelationships, fieldMeanings, sqlExamples, businessRules } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: "Missing connection ID" });
    }

    const results: { tableExplanations: number[]; columnExplanations: number[]; sqlExamples: number[] } = {
      tableExplanations: [],
      columnExplanations: [],
      sqlExamples: [],
    };

    try {
      // Get existing explanations for this connection
      const existingTableExpls = getTableExplanationsByConnection(connectionId);
      const existingTableMap = new Map(existingTableExpls.map((t: any) => [t.table_name, t]));

      // Save table-level explanations (upsert)
      if (tableRelationships && Array.isArray(tableRelationships)) {
        tableRelationships.forEach((rel: any) => {
          if (rel.fromTable) {
            const existing = existingTableMap.get(rel.fromTable);
            if (existing && existing.id) {
              // Update existing
              updateTableExplanation(existing.id as number, {
                explanation: rel.relationship || "",
                business_purpose: rel.businessMeaning || "",
                keywords: JSON.stringify([rel.fromTable, rel.toTable]),
              });
              results.tableExplanations.push(existing.id as number);
            } else {
              // Create new
              const tableExplId = createTableExplanation({
                database_connection_id: connectionId,
                table_name: rel.fromTable,
                explanation: rel.relationship || "",
                business_purpose: rel.businessMeaning || "",
                keywords: JSON.stringify([rel.fromTable, rel.toTable]),
              });
              results.tableExplanations.push(tableExplId);
              existingTableMap.set(rel.fromTable, { id: tableExplId, table_name: rel.fromTable });
            }
          }
        });
      }

      // Save field meanings as column explanations (upsert)
      if (fieldMeanings && Array.isArray(fieldMeanings)) {
        fieldMeanings.forEach((field: any) => {
          if (field.table && field.field) {
            // Get or create table explanation
            let tableExpl = existingTableMap.get(field.table);
            let tableExplId = tableExpl?.id || 0;

            if (!tableExplId) {
              // Create table explanation if not exists
              tableExplId = createTableExplanation({
                database_connection_id: connectionId,
                table_name: field.table,
                explanation: "",
                business_purpose: "",
                keywords: "[]",
              });
              existingTableMap.set(field.table, { id: tableExplId, table_name: field.table });
            }

            if (tableExplId) {
              // Check if column explanation exists
              const existingCols = getColumnExplanationsByTable(tableExplId);
              const existingCol = existingCols.find((c: any) => c.column_name === field.field);

              if (existingCol && existingCol.id) {
                // Update existing
                updateColumnExplanation(existingCol.id as number, {
                  explanation: field.meaning || "",
                  business_meaning: field.meaning || "",
                  synonyms: JSON.stringify(field.keywords || []),
                  sensitivity_level: field.sensitivity || "public",
                  sample_values: "[]",
                });
                results.columnExplanations.push(existingCol.id as number);
              } else {
                // Create new
                const colExplId = createColumnExplanation({
                  table_explanation_id: tableExplId,
                  column_name: field.field,
                  explanation: field.meaning || "",
                  business_meaning: field.meaning || "",
                  synonyms: JSON.stringify(field.keywords || []),
                  sensitivity_level: field.sensitivity || "public",
                  sample_values: "[]",
                });
                results.columnExplanations.push(colExplId);
              }
            }
          }
        });
      }

      // Save SQL examples (upsert)
      if (sqlExamples && Array.isArray(sqlExamples)) {
        const existingSqlExamples = getSqlExamplesByConnection(connectionId);
        const existingSqlMap = new Map(existingSqlExamples.map((s: any) => [s.natural_language, s]));

        sqlExamples.forEach((example: any) => {
          if (example.sql && example.description) {
            const existing = existingSqlMap.get(example.description);
            if (existing && existing.id) {
              // Update existing
              updateSqlExample(existing.id as number, {
                sql_query: example.sql,
                explanation: example.businessPurpose || "",
                tags: JSON.stringify(["ai-analyzed"]),
                tables_involved: JSON.stringify(example.tables || []),
                is_learned: true,
              });
              results.sqlExamples.push(existing.id as number);
            } else {
              // Create new
              const exampleId = createSqlExample({
                database_connection_id: connectionId,
                natural_language: example.description,
                sql_query: example.sql,
                explanation: example.businessPurpose || "",
                tags: JSON.stringify(["ai-analyzed"]),
                tables_involved: JSON.stringify(example.tables || []),
                is_learned: true,
              });
              results.sqlExamples.push(exampleId);
            }
          }
        });
      }

      res.json({
        success: true,
        message: `Knowledge base saved: ${results.tableExplanations.length} tables, ${results.columnExplanations.length} columns, ${results.sqlExamples.length} examples`,
        results,
      });
    } catch (dbError: any) {
      logger.error(`Error saving knowledge base to database: ${dbError.message}`);
      res.status(500).json({ error: `Database error: ${dbError.message}` });
    }
  } catch (error: any) {
    logger.error(`Error saving knowledge base: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get connections by workspace (MUST be before GET /connections/:id to avoid route collision)
router.get("/connections/workspace/:id", (req: Request, res: Response) => {
  try {
    const workspaceId = parseInt(req.params.id);
    const connections = getDatabaseConnectionsByWorkspace(workspaceId);
    res.json(connections);
  } catch (error: any) {
    logger.error(`Error getting connections: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get database schema for a connection (MUST be before GET /connections/:id to avoid route collision)
router.get("/connections/:id/schema", async (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.id);
    const connection = getDatabaseConnection(connectionId);

    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    // Extract selected_schemas from connection config (where frontend stores it)
    let selectedSchemas: string[] | undefined;
    if (connection.config) {
      try {
        const configData = typeof connection.config === "string" ? JSON.parse(connection.config) : connection.config;
        if (configData.schema && typeof configData.schema === "string") {
          // config.schema is stored as JSON string array like: [{"name":"public","isSelected":true}]
          const schemaArray = JSON.parse(configData.schema);
          if (Array.isArray(schemaArray)) {
            selectedSchemas = schemaArray.filter((s: any) => s.isSelected).map((s: any) => s.name);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    const schema = await getSchema(connectionId, selectedSchemas);
    res.json(schema);
  } catch (error: any) {
    logger.error(`Error getting schema: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get connection by ID (or workspace ID if first param is 'workspace')
router.get("/connections/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const connection = getDatabaseConnection(id);

    if (!connection) {
      logger.warn(`Connection not found: ${id}`);
      return res.status(404).json({ error: "Connection not found" });
    }

    res.json(connection);
  } catch (error: any) {
    logger.error(`Error getting connection: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update connection
router.put("/connections/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name, config, description, status } = req.body;

    // Handle config as object or string
    let configToSave = config;
    if (config) {
      if (typeof config === "object") {
        configToSave = JSON.stringify(config);
      }
      // If it's already a string, use it as-is
    }

    updateDatabaseConnection(id, {
      name,
      config: configToSave,
      description,
      status,
    });

    res.json({ message: "Connection updated" });
  } catch (error: any) {
    logger.error(`Error updating connection: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete connection
router.delete("/connections/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const connection = getDatabaseConnection(id);

    if (!connection) {
      logger.warn(`Connection not found for deletion: ${id}`);
      return res.status(404).json({ error: "Connection not found" });
    }

    deleteDatabaseConnection(id);
    res.json({ message: "Connection deleted" });
  } catch (error: any) {
    logger.error(`Error deleting connection: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Keep legacy route for backward compatibility
router.get("/workspaces/:workspaceId/connections", (req: Request, res: Response) => {
  try {
    const workspaceId = parseInt(req.params.workspaceId);
    const connections = getDatabaseConnectionsByWorkspace(workspaceId);
    res.json(connections);
  } catch (error: any) {
    logger.error(`Error getting connections: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Table Explanations
// ============================================================================

// Create table explanation
router.post("/table-explanations", (req: Request, res: Response) => {
  try {
    const { database_connection_id, table_name, explanation, business_purpose, keywords } = req.body;

    const id = createTableExplanation({
      database_connection_id,
      table_name,
      explanation,
      business_purpose,
      keywords,
    });

    res.json({ id, message: "Table explanation created" });
  } catch (error: any) {
    logger.error(`Error creating table explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get table explanation
router.get("/table-explanations/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const explanation = getTableExplanation(id);

    if (!explanation) {
      return res.status(404).json({ error: "Table explanation not found" });
    }

    res.json(explanation);
  } catch (error: any) {
    logger.error(`Error getting table explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update table explanation
router.put("/table-explanations/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { explanation, business_purpose, keywords } = req.body;

    // Set source='user' when user edits from UI
    updateTableExplanation(id, { explanation, business_purpose, keywords, source: "user" });

    res.json({ message: "Table explanation updated" });
  } catch (error: any) {
    logger.error(`Error updating table explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete table explanation
router.delete("/table-explanations/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    deleteTableExplanation(id);
    res.json({ message: "Table explanation deleted" });
  } catch (error: any) {
    logger.error(`Error deleting table explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get table explanations by connection
router.get("/connections/:connectionId/table-explanations", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const explanations = getTableExplanationsByConnection(connectionId);
    res.json(explanations);
  } catch (error: any) {
    logger.error(`Error getting table explanations: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Column Explanations
// ============================================================================

// Create column explanation
router.post("/column-explanations", (req: Request, res: Response) => {
  try {
    const { table_explanation_id, column_name, explanation, data_type, business_meaning, synonyms, sensitivity_level, sample_values } =
      req.body;

    // Set source='user' when user creates from UI
    const id = createColumnExplanation({
      table_explanation_id,
      column_name,
      explanation,
      data_type,
      business_meaning,
      synonyms,
      sensitivity_level,
      sample_values,
      source: "user",
    });

    res.json({ id, message: "Column explanation created" });
  } catch (error: any) {
    logger.error(`Error creating column explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get column explanation
router.get("/column-explanations/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const explanation = getColumnExplanation(id);

    if (!explanation) {
      return res.status(404).json({ error: "Column explanation not found" });
    }

    res.json(explanation);
  } catch (error: any) {
    logger.error(`Error getting column explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update column explanation
router.put("/column-explanations/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { explanation, data_type, business_meaning, synonyms, sensitivity_level, sample_values } = req.body;

    // Set source='user' when user edits from UI
    updateColumnExplanation(id, {
      explanation,
      data_type,
      business_meaning,
      synonyms,
      sensitivity_level,
      sample_values,
      source: "user",
    });

    res.json({ message: "Column explanation updated" });
  } catch (error: any) {
    logger.error(`Error updating column explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete column explanation
router.delete("/column-explanations/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    deleteColumnExplanation(id);
    res.json({ message: "Column explanation deleted" });
  } catch (error: any) {
    logger.error(`Error deleting column explanation: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get column explanations by table
router.get("/table-explanations/:tableExplanationId/columns", (req: Request, res: Response) => {
  try {
    const tableExplanationId = parseInt(req.params.tableExplanationId);
    const explanations = getColumnExplanationsByTable(tableExplanationId);
    res.json(explanations);
  } catch (error: any) {
    logger.error(`Error getting column explanations: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SQL Examples
// ============================================================================

// Create SQL example
router.post("/sql-examples", (req: Request, res: Response) => {
  try {
    const { database_connection_id, natural_language, sql_query, explanation, tags, tables_involved, is_learned } = req.body;

    // Set source='user' when user creates from UI
    const id = createSqlExample({
      database_connection_id,
      natural_language,
      sql_query,
      explanation,
      tags,
      tables_involved,
      is_learned,
      source: "user",
    });

    res.json({ id, message: "SQL example created" });
  } catch (error: any) {
    logger.error(`Error creating SQL example: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get SQL example
router.get("/sql-examples/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const example = getSqlExample(id);

    if (!example) {
      return res.status(404).json({ error: "SQL example not found" });
    }

    res.json(example);
  } catch (error: any) {
    logger.error(`Error getting SQL example: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update SQL example
router.put("/sql-examples/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { natural_language, sql_query, explanation, tables_involved, is_learned } = req.body;

    // Set source='user' when user edits from UI
    updateSqlExample(id, { natural_language, sql_query, explanation, tables_involved, is_learned, source: "user" });

    res.json({ message: "SQL example updated" });
  } catch (error: any) {
    logger.error(`Error updating SQL example: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete SQL example
router.delete("/sql-examples/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    deleteSqlExample(id);
    res.json({ message: "SQL example deleted" });
  } catch (error: any) {
    logger.error(`Error deleting SQL example: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get SQL examples by connection
router.get("/connections/:connectionId/sql-examples", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const learnedOnly = req.query.learned === "true";
    const examples = getSqlExamplesByConnection(connectionId, learnedOnly);
    res.json(examples);
  } catch (error: any) {
    logger.error(`Error getting SQL examples: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Create SQL example for a connection
router.post("/connections/:connectionId/sql-examples", (req: Request, res: Response) => {
  try {
    const connectionId = parseInt(req.params.connectionId);
    const { natural_language, sql_query, explanation, tables_involved } = req.body;

    if (!natural_language || !sql_query) {
      return res.status(400).json({ error: "natural_language and sql_query are required" });
    }

    // Set source='user' when user creates from UI
    const id = createSqlExample({
      database_connection_id: connectionId,
      natural_language,
      sql_query,
      explanation: explanation || "",
      tables_involved: tables_involved || JSON.stringify([]),
      source: "user",
    });

    logger.info(`SQL example created with ID: ${id} for connection ${connectionId}`);
    res.json({ id, message: "SQL example created successfully" });
  } catch (error: any) {
    logger.error(`Error creating SQL example: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AI Agents
// ============================================================================

// Create AI agent
router.post("/ai-agents", (req: Request, res: Response) => {
  try {
    const {
      name,
      provider,
      model,
      api_key,
      api_base_url,
      temperature,
      max_tokens,
      top_p,
      frequency_penalty,
      presence_penalty,
      is_default,
      is_active,
    } = req.body;

    const id = createAiAgent({
      name,
      provider,
      model,
      api_key,
      api_base_url,
      temperature,
      max_tokens,
      top_p,
      frequency_penalty,
      presence_penalty,
      is_default,
      is_active,
    });

    res.json({ id, message: "AI agent created" });
  } catch (error: any) {
    logger.error(`Error creating AI agent: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get AI agent
router.get("/ai-agents/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const agent = getAiAgent(id);

    if (!agent) {
      return res.status(404).json({ error: "AI agent not found" });
    }

    res.json(agent);
  } catch (error: any) {
    logger.error(`Error getting AI agent: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get AI agent by name
router.get("/ai-agents/name/:name", (req: Request, res: Response) => {
  try {
    const agent = getAiAgentByName(req.params.name);

    if (!agent) {
      return res.status(404).json({ error: "AI agent not found" });
    }

    res.json(agent);
  } catch (error: any) {
    logger.error(`Error getting AI agent by name: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update AI agent
router.put("/ai-agents/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const updateData = req.body;

    updateAiAgent(id, updateData);

    res.json({ message: "AI agent updated" });
  } catch (error: any) {
    logger.error(`Error updating AI agent: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete AI agent
router.delete("/ai-agents/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    deleteAiAgent(id);
    res.json({ message: "AI agent deleted" });
  } catch (error: any) {
    logger.error(`Error deleting AI agent: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get all AI agents
router.get("/ai-agents", (req: Request, res: Response) => {
  try {
    const agents = getAllAiAgents();
    res.json(agents);
  } catch (error: any) {
    logger.error(`Error getting AI agents: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get default AI agent
router.get("/ai-agents/default", (req: Request, res: Response) => {
  try {
    const agent = getDefaultAiAgent();

    if (!agent) {
      return res.status(404).json({ error: "No default AI agent found" });
    }

    res.json(agent);
  } catch (error: any) {
    logger.error(`Error getting default AI agent: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
