// =============================================================================
// Query API Routes
// =============================================================================

import { Router, Request, Response } from "express";
import { z } from "zod";
import { executeSafeQuery } from "../services/database/queryExecutor.js";
import { SQLValidator } from "../services/database/sqlValidator.js";
import { buildAIPrompt } from "../services/copilot/contextBuilder.js";
import { chat, checkCopilotBridge, getAvailableModels } from "../services/copilot/copilotClient.js";
import * as connectionManager from "../services/database/connectionManager.js";
import {
  getTableExplanationsByConnection,
  getColumnExplanationsByTable,
  getSqlExamplesByConnection,
} from "../services/dataloom/databaseService.js";
import { logger } from "../utils/logger.js";
import type { LegendItem } from "../types/index.js";

const router = Router();
const sqlValidator = new SQLValidator();

/**
 * Enhance visualization with legend containing key field
 * This ensures all visualizations include proper data mapping
 */
function enhanceVisualizationWithLegend(viz: any, columns: Array<{ name: string; key: string; type: string }>): any {
  if (!viz) {
    return viz;
  }

  // Get Y-axis keys to build legend for
  let yAxisList: string[] = [];

  if (Array.isArray(viz.yAxis)) {
    yAxisList = viz.yAxis;
  } else if (typeof viz.yAxis === "string") {
    yAxisList = [viz.yAxis];
  } else if (Array.isArray(viz.config?.yAxis)) {
    yAxisList = viz.config.yAxis;
  }

  // If no yAxis keys found, return viz as-is
  if (yAxisList.length === 0) {
    return viz;
  }

  // Always rebuild legend from columns for consistency
  // This ensures the legend uses column.name for display and column.key for data access
  const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
  const newLegend: LegendItem[] = [];

  for (let i = 0; i < yAxisList.length; i++) {
    const columnKey = yAxisList[i];
    const column = columns.find((c) => c.key === columnKey);

    if (column) {
      // Use the friendly name from columns for display
      newLegend.push({
        name: column.name,
        key: columnKey,
        color: colors[i % colors.length],
        description: `${column.type} column: ${columnKey}`,
      });
    } else {
      // Fallback if column not found
      newLegend.push({
        name: columnKey,
        key: columnKey,
        color: colors[i % colors.length],
        description: `Data column: ${columnKey}`,
      });
    }
  }

  // If we have a new legend, use it; otherwise keep the original if it exists
  if (newLegend.length > 0) {
    return { ...viz, legend: newLegend };
  }

  return viz;
}

// Simple pattern-based SQL generator for common queries
async function generateSimpleSQL(naturalLanguage: string, connectionId: number): Promise<string | null> {
  const text = naturalLanguage.toLowerCase().trim();

  try {
    // Get the schema for context
    const schema = await connectionManager.getSchema(connectionId);
    const tables = schema && "tables" in schema ? (schema as any).tables : [];

    // Count records by table
    if (text.includes("count") && text.includes("table")) {
      if (tables.length > 0) {
        const queries = tables
          .map((table: any) => `SELECT '${table.name}' as table_name, COUNT(*) as record_count FROM ${table.name}`)
          .join("\nUNION ALL\n");
        return queries + "\nORDER BY record_count DESC;";
      }
    }

    // Show all / list all pattern - extract table name if mentioned
    if ((text.includes("show") || text.includes("list")) && (text.includes("all") || text.includes("users") || text.includes("records"))) {
      // Try to extract table name from query
      let tableName: string | null = null;
      for (const table of tables) {
        if (text.includes(table.name.toLowerCase())) {
          tableName = table.name;
          break;
        }
      }
      // Fall back to users table or first table
      if (!tableName) {
        tableName = tables.find((t: any) => t.name.toLowerCase() === "users")?.name || tables[0]?.name;
      }
      if (tableName) {
        return `SELECT * FROM ${tableName} LIMIT 100;`;
      }
    }

    // Count records / how many pattern
    if (text.includes("count") && !text.includes("table")) {
      // Extract table name if mentioned
      let tableName: string | null = null;
      for (const table of tables) {
        if (text.includes(table.name.toLowerCase())) {
          tableName = table.name;
          break;
        }
      }
      if (tableName) {
        return `SELECT COUNT(*) as total_records FROM ${tableName};`;
      } else if (tables.length === 1) {
        return `SELECT COUNT(*) as total_records FROM ${tables[0].name};`;
      }
    }

    // Recent/latest records pattern
    if ((text.includes("recent") || text.includes("latest") || text.includes("new")) && text.includes("records")) {
      let tableName: string | null = null;
      for (const table of tables) {
        if (text.includes(table.name.toLowerCase())) {
          tableName = table.name;
          break;
        }
      }
      if (!tableName) {
        tableName = tables[0]?.name;
      }
      if (tableName) {
        // Look for timestamp column
        const table = tables.find((t: any) => t.name === tableName);
        const timeCol = table?.columns?.find(
          (c: any) =>
            c.name.toLowerCase().includes("created") ||
            c.name.toLowerCase().includes("updated") ||
            c.name.toLowerCase().includes("timestamp"),
        );
        if (timeCol) {
          return `SELECT * FROM ${tableName} ORDER BY ${timeCol.name} DESC LIMIT 10;`;
        } else {
          return `SELECT * FROM ${tableName} LIMIT 10;`;
        }
      }
    }

    return null;
  } catch (error) {
    logger.error(`Error in generateSimpleSQL: ${error}`);
    return null;
  }
}

// Validation schemas
const QuerySchema = z.object({
  connectionSessionId: z.string().uuid().optional(), // Optional for backward compatibility
  connectionId: z.number().optional(), // Legacy: fallback if no connectionSessionId
  chatSessionId: z.string().uuid().optional(), // Optional, backend creates one if missing
  naturalLanguage: z.string().min(1).max(2000),
  model: z
    .object({
      id: z.string(),
      name: z.string(),
      vendor: z.string(),
    })
    .optional(),
});

const ExecuteSQLSchema = z.object({
  connectionSessionId: z.string().uuid().optional(),
  connectionId: z.number().optional(),
  sql: z.string().min(1).max(10000),
});

// POST /api/query - Natural language query with session management
router.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = QuerySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request body",
        details: parsed.error.issues,
        timestamp: new Date().toISOString(),
      });
    }

    let { connectionSessionId, connectionId, chatSessionId, naturalLanguage, model } = parsed.data;

    // Resolve connectionId from session or legacy connectionId
    if (connectionSessionId) {
      const resolvedId = await connectionManager.validateConnectionSession(connectionSessionId);
      if (resolvedId === null) {
        return res.status(400).json({
          success: false,
          error: "Invalid or disconnected connection session",
          errorCode: "INVALID_SESSION",
          timestamp: new Date().toISOString(),
        });
      }
      connectionId = resolvedId;
    } else if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: "Either connectionSessionId or connectionId is required",
        errorCode: "MISSING_CONNECTION",
        timestamp: new Date().toISOString(),
      });
    }

    // Handle chat session
    let isFollowUp = false;
    if (chatSessionId) {
      // Validate existing chat session
      const validation = connectionManager.validateChatSession(chatSessionId, connectionSessionId);
      if (!validation.isValid) {
        // Invalid session - create a new one
        logger.info(`[Query] Invalid chat session ${chatSessionId}, creating new one`);
        chatSessionId = connectionManager.createChatSession(connectionSessionId || "legacy");
        isFollowUp = false;
      } else {
        isFollowUp = validation.isFollowUp;
      }
    } else {
      // No chat session - create a new one
      chatSessionId = connectionManager.createChatSession(connectionSessionId || "legacy");
      isFollowUp = false;
    }

    // Check CopilotBridge availability
    const copilotAvailable = await checkCopilotBridge();

    let extractedSQL: string | null = null;
    let explanation: string | null = null;
    let visualization: any = null;

    if (copilotAvailable) {
      // Build AI prompt based on whether this is a follow-up question
      let prompt: string;

      if (isFollowUp && connectionSessionId) {
        // Follow-up question: use cached schema and KB from session
        logger.info(`[Chat] Follow-up question detected - using cached schema and KB from session`);

        const cachedSchema = connectionManager.getCacheSchema(connectionSessionId);
        const cachedKB = connectionManager.getCacheKnowledgeBase(connectionSessionId);

        if (cachedSchema && cachedKB) {
          // Both caches available - use full prompt with cached data
          prompt = await buildAIPrompt(
            connectionId,
            naturalLanguage,
            {},
            {
              cachedSchema,
              cachedKB,
            },
          );
          logger.info(`[Chat] Follow-up using cached schema and KB`);
        } else {
          // Caches missing - fetch fresh data and use full prompt
          if (!cachedSchema) {
            logger.warn(`[Chat] Schema cache not found for connection session ${connectionSessionId}, fetching fresh`);
          }
          if (!cachedKB) {
            logger.warn(`[Chat] KB cache not found for connection session ${connectionSessionId}, fetching fresh`);
          }

          // Always fetch fresh data if caches are missing
          try {
            const freshSchema = await connectionManager.getSchema(connectionId);
            const tableExplanations = getTableExplanationsByConnection(connectionId);
            const sqlExamples = getSqlExamplesByConnection(connectionId);
            const columnExplanations = new Map();

            prompt = await buildAIPrompt(
              connectionId,
              naturalLanguage,
              {},
              {
                cachedSchema: freshSchema,
                cachedKB: {
                  tableExplanations,
                  columnExplanations,
                  sqlExamples,
                },
              },
            );
            logger.info(`[Chat] Follow-up using full prompt with fresh schema and KB`);
          } catch (error) {
            logger.warn(`[Chat] Failed to fetch fresh data for follow-up: ${error}`);
            // Still use buildAIPrompt even without cache - it will try to build with what it can
            try {
              prompt = await buildAIPrompt(connectionId, naturalLanguage);
              logger.info(`[Chat] Follow-up using full prompt without cached data`);
            } catch (buildError) {
              logger.error(`[Chat] Failed to build prompt for follow-up: ${buildError}`);
              throw buildError;
            }
          }
        }
      } else {
        // First question prompt: fetch and cache schema and KB
        logger.info(`[Chat] First question - fetching and caching schema and KB`);

        try {
          // Fetch fresh schema
          const schema = await connectionManager.getSchema(connectionId);

          // Fetch KB data (table explanations, column explanations, SQL examples)
          const tableExplanations = getTableExplanationsByConnection(connectionId);
          const sqlExamples = getSqlExamplesByConnection(connectionId);

          // Build columnExplanations map
          const columnExplanations = new Map<number, any[]>();
          for (const tableExpl of tableExplanations) {
            if (tableExpl.id) {
              const cols = getColumnExplanationsByTable(tableExpl.id);
              if (cols.length > 0) {
                columnExplanations.set(tableExpl.id, cols);
              }
            }
          }

          const kbData = {
            tableExplanations,
            columnExplanations,
            sqlExamples,
          };

          // Cache schema and KB in connection session (if sessionId is available)
          if (connectionSessionId) {
            connectionManager.setCacheSchema(connectionSessionId, schema);
            connectionManager.setCacheKnowledgeBase(connectionSessionId, kbData);
            logger.info(`[Chat] Cached schema and KB for connection session ${connectionSessionId}`);
          }

          // Build prompt with fetched data
          prompt = await buildAIPrompt(
            connectionId,
            naturalLanguage,
            {},
            {
              cachedSchema: schema,
              cachedKB: kbData,
            },
          );
          logger.info(`[Chat] First question - using full prompt with schema and knowledge base`);
        } catch (error) {
          logger.error(`[Chat] Failed to fetch schema/KB for first question: ${error}`);
          // Fall back to simple prompt if data fetch fails
          prompt = await buildAIPrompt(connectionId, naturalLanguage);
        }
      }

      // Log prompt details (first 100 lines for debugging)
      const promptLines = prompt.split("\n");
      const promptPreview = promptLines.slice(0, 100).join("\n");
      logger.debug(`[Prompt] First 100 lines of AI prompt (isFollowUp=${isFollowUp}):`);
      logger.debug(promptPreview);
      logger.info(`[Prompt] Total prompt lines: ${promptLines.length}`);

      // Call CopilotBridge
      const aiResponse = await chat({
        prompt,
        model,
        timeout: 60000,
      });

      if (!aiResponse.success || !aiResponse.response) {
        return res.status(500).json({
          success: false,
          error: aiResponse.error || "Failed to get response from AI",
          errorCode: "AI_ERROR",
          sql: null,
          chatSessionId,
          timestamp: new Date().toISOString(),
        });
      }

      // Log AI response (first 100 lines for debugging)
      const responseLines = aiResponse.response.split("\n");
      const responsePreview = responseLines.slice(0, 100).join("\n");
      logger.debug(`[AI Response] First 100 lines of AI response:`);
      logger.debug(responsePreview);
      logger.info(`[AI Response] Total response lines: ${responseLines.length}`);

      // Try to parse as JSON (AI now returns structured response)
      try {
        // Extract JSON from response (in case there are markdown code blocks)
        let jsonStr = aiResponse.response.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }

        const aiData = JSON.parse(jsonStr);
        extractedSQL = aiData.sql;
        explanation = aiData.explanation;
        visualization = aiData.visualization;

        logger.info(`AI returned structured response with SQL and visualization suggestion`);
        logger.debug(`Generated SQL: ${extractedSQL}`, { visualization });
      } catch (parseError) {
        // Fallback: Try to extract SQL using old method
        logger.warn(`Failed to parse JSON response, attempting to extract SQL: ${parseError}`);
        extractedSQL = SQLValidator.extractSQL(aiResponse.response);
      }
    } else {
      // Fallback: Try simple pattern matching for common queries
      logger.warn(`CopilotBridge unavailable, using simple pattern matching for: ${naturalLanguage}`);
      extractedSQL = await generateSimpleSQL(naturalLanguage, connectionId);
    }

    if (!extractedSQL) {
      const errorMsg = copilotAvailable
        ? "AI did not generate a valid SQL query"
        : "Could not generate SQL from natural language. Try using direct SQL execution or connect CopilotBridge.";
      return res.status(400).json({
        success: false,
        error: errorMsg,
        errorCode: copilotAvailable ? "NO_SQL_GENERATED" : "COPILOT_UNAVAILABLE",
        sql: null,
        chatSessionId,
        timestamp: new Date().toISOString(),
      });
    }

    // Validate and execute SQL
    // Mark as trusted if generated by our pattern matcher (safer than user input)
    const isTrusted = !copilotAvailable;
    const result = await executeSafeQuery(connectionId, extractedSQL, isTrusted);

    if (!result.success) {
      logger.warn(`Query execution failed`, {
        naturalLanguage,
        sql: extractedSQL.substring(0, 300),
        error: result.error,
      });
      return res.status(400).json({
        success: false,
        error: result.error,
        errorCode: result.errorCode,
        sql: extractedSQL,
        chatSessionId,
        timestamp: new Date().toISOString(),
      });
    }

    logger.debug(`Query execution succeeded`, {
      naturalLanguage,
      sql: extractedSQL.substring(0, 300),
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
    });

    // Mark chat session as follow-up for next question
    connectionManager.markChatSessionAsFollowUp(chatSessionId);

    // Enhance visualization with legend containing key field
    const finalVisualization = enhanceVisualizationWithLegend(visualization || result.visualization, result.columns || []);

    res.json({
      success: true,
      chatSessionId,
      data: {
        sql: result.sql,
        data: result.data,
        columns: result.columns,
        rowCount: result.rowCount,
        executionTimeMs: result.executionTimeMs,
        visualization: finalVisualization,
      },
      explanation: explanation || "Query executed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Query failed: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: `Query failed: ${errorMessage}`,
      sql: null,
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/query/execute - Execute SQL directly (with validation)
router.post("/execute", async (req: Request, res: Response) => {
  try {
    const parsed = ExecuteSQLSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request body",
        details: parsed.error.issues,
        timestamp: new Date().toISOString(),
      });
    }

    let { connectionSessionId, connectionId, sql } = parsed.data;

    // Resolve connectionId from session or legacy connectionId
    if (connectionSessionId) {
      const resolvedId = await connectionManager.validateConnectionSession(connectionSessionId);
      if (resolvedId === null) {
        return res.status(400).json({
          success: false,
          error: "Invalid or disconnected connection session",
          errorCode: "INVALID_SESSION",
          timestamp: new Date().toISOString(),
        });
      }
      connectionId = resolvedId;
    } else if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: "Either connectionSessionId or connectionId is required",
        errorCode: "MISSING_CONNECTION",
        timestamp: new Date().toISOString(),
      });
    }

    // Execute with validation
    const result = await executeSafeQuery(connectionId, sql);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        errorCode: result.errorCode,
        sql,
        timestamp: new Date().toISOString(),
      });
    }

    // Enhance visualization with legend
    const finalVisualization = enhanceVisualizationWithLegend(result.visualization, result.columns || []);

    res.json({
      success: true,
      data: {
        sql: result.sql,
        data: result.data,
        columns: result.columns,
        rowCount: result.rowCount,
        executionTimeMs: result.executionTimeMs,
        visualization: finalVisualization,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`SQL execution failed: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: `SQL execution failed: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/query/validate - Validate SQL without executing
router.post("/validate", async (req: Request, res: Response) => {
  try {
    const { sql } = req.body;
    if (!sql || typeof sql !== "string") {
      return res.status(400).json({
        success: false,
        error: "SQL query is required",
        timestamp: new Date().toISOString(),
      });
    }

    const result = sqlValidator.validate(sql);

    res.json({
      success: true,
      data: {
        valid: result.valid,
        error: result.error,
        errorCode: result.errorCode,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: `Validation failed: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
