// =============================================================================
// Context Builder - Constructs AI prompts with database context
// =============================================================================

import { getSchema, getConnection } from "../database/connectionManager.js";
import {
  getTableExplanationsByConnection,
  getColumnExplanationsByTable,
  getSqlExamplesByConnection,
  getTableExplanation,
  getDatabaseConnection,
} from "../dataloom/databaseService.js";
import { getSelectedSchemasFromConnection } from "../dataloom/knowledgeBaseService.js";
import type { DatabaseSchema, TableAnnotation, ColumnAnnotation, SQLExample } from "../../types/index.js";
import { logger } from "../../utils/logger.js";
import { SQL_QUERY_GENERATION_PROMPT } from "../../prompts/index.js";

interface ContextBuilderConfig {
  maxTokens: number;
  maxSchemaTokens: number;
  maxAnnotationTokens: number;
  maxExampleTokens: number;
}

const DEFAULT_CONFIG: ContextBuilderConfig = {
  maxTokens: 8000,
  maxSchemaTokens: 3000,
  maxAnnotationTokens: 2000,
  maxExampleTokens: 2000,
};

export async function buildAIPrompt(
  connectionId: number,
  naturalLanguageQuery: string,
  config: Partial<ContextBuilderConfig> = {},
  options?: {
    cachedSchema?: DatabaseSchema | null;
    cachedKB?: { tableExplanations: any[]; columnExplanations: Map<number, any[]>; sqlExamples: any[] } | null;
  },
): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const parts: string[] = [];

  // Use cached data if provided, otherwise fetch fresh
  const useSchema = options?.cachedSchema !== undefined ? options.cachedSchema : null;
  const useKB = options?.cachedKB !== undefined ? options.cachedKB : null;

  // Log KB usage statistics before building prompt
  try {
    const tableExplanations = useKB ? useKB.tableExplanations : getTableExplanationsByConnection(connectionId);
    const sqlExamples = useKB ? useKB.sqlExamples : getSqlExamplesByConnection(connectionId);

    // Count column explanations
    let columnExplanationsCount = 0;
    if (useKB) {
      for (const [, cols] of useKB.columnExplanations) {
        columnExplanationsCount += cols.length;
      }
    } else {
      for (const tableExpl of tableExplanations) {
        if (tableExpl.id) {
          const columns = getColumnExplanationsByTable(tableExpl.id);
          columnExplanationsCount += columns.length;
        }
      }
    }

    logger.debug(`[KB Usage] Building prompt with knowledge base:
    - table_explanations: ${tableExplanations.length}
    - column_explanations: ${columnExplanationsCount}
    - sql_examples: ${sqlExamples.length}
    - Using cached data: ${options?.cachedSchema !== undefined || options?.cachedKB !== undefined}`);
  } catch (error) {
    logger.warn(`Failed to log KB usage statistics: ${error}`);
  }

  // System instruction - REQUEST STRUCTURED RESPONSE
  parts.push(SQL_QUERY_GENERATION_PROMPT);

  // Get database schema - respect user's schema selection
  try {
    let schema = useSchema;
    if (!schema) {
      // Get selected schemas from connection config (user's schema selection)
      const selectedSchemas = getSelectedSchemasFromConnection(connectionId);
      schema = await getSchema(connectionId, selectedSchemas);
    }
    const schemaContext = formatSchema(schema, cfg.maxSchemaTokens);
    parts.push(`\n## Database Schema\n${schemaContext}`);
  } catch (error) {
    logger.warn(`Failed to get schema: ${error}`);
  }

  // Get table explanations (annotations) - all records included, user-created emphasized
  try {
    const tableExplanations = useKB ? useKB.tableExplanations : getTableExplanationsByConnection(connectionId);
    if (tableExplanations.length > 0) {
      const annotationContext = tableExplanations
        .map((a: any) => {
          const isUserDefined = a.source === "user";
          const prefix = isUserDefined ? "⚠️ [MANDATORY] " : "";
          const lineParts = [`- ${prefix}${a.table_name}`];
          if (a.explanation) lineParts.push(`  Explanation: ${a.explanation}`);
          if (a.business_purpose) lineParts.push(`  Purpose: ${a.business_purpose}`);
          if (a.keywords) {
            try {
              const keywords = JSON.parse(a.keywords);
              if (Array.isArray(keywords)) lineParts.push(`  Keywords: ${keywords.join(", ")}`);
            } catch (e) {
              // ignore JSON parse errors
            }
          }
          if (isUserDefined) {
            lineParts.push(`  ⚠️ THIS IS A USER-DEFINED RULE - MUST BE STRICTLY FOLLOWED`);
          }
          return lineParts.join("\n");
        })
        .join("\n\n");
      parts.push(`\n## Table Descriptions\nNote: Items marked with ⚠️ [MANDATORY] are user-defined rules that MUST be strictly followed.\n${annotationContext}`);
    }
  } catch (error) {
    logger.warn(`Failed to get table explanations: ${error}`);
  }

  // Get column explanations (annotations) - all records included, user-created emphasized
  try {
    let tableExplanations = useKB ? useKB.tableExplanations : getTableExplanationsByConnection(connectionId);
    const columnsByTable = new Map<number, any[]>();

    if (useKB) {
      // Use cached column explanations directly
      for (const [tableId, cols] of useKB.columnExplanations) {
        if (cols.length > 0) {
          columnsByTable.set(tableId, cols);
        }
      }
    } else {
      // Fetch column explanations
      for (const tableExpl of tableExplanations) {
        if (!tableExpl.id) continue;
        const columns = getColumnExplanationsByTable(tableExpl.id);
        if (columns.length > 0) {
          columnsByTable.set(tableExpl.id, columns);
        }
      }
    }

    if (columnsByTable.size > 0) {
      const columnContextLines: string[] = [];

      for (const [tableId, cols] of columnsByTable.entries()) {
        const tableExpl = getTableExplanation(tableId);
        const tableName = tableExpl?.table_name || `Table ${tableId}`;
        const lines = [`Table ${tableName}:`];

        for (const col of cols) {
          const isUserDefined = col.source === "user";
          const prefix = isUserDefined ? "⚠️ [MANDATORY] " : "";
          const colParts = [`  - ${prefix}${col.column_name}`];
          if (col.explanation) colParts.push(`    ${col.explanation}`);
          if (col.business_meaning) colParts.push(`    Meaning: ${col.business_meaning}`);
          if (col.synonyms) {
            try {
              const synonyms = JSON.parse(col.synonyms);
              if (Array.isArray(synonyms)) colParts.push(`    Also known as: ${synonyms.join(", ")}`);
            } catch (e) {
              // ignore
            }
          }
          if (col.sensitivity_level === "HIGH") colParts.push(`    ⚠️ SENSITIVE DATA`);
          if (isUserDefined) {
            colParts.push(`    ⚠️ THIS IS A USER-DEFINED RULE - MUST BE STRICTLY FOLLOWED`);
          }
          lines.push(colParts.join("\n"));
        }
        columnContextLines.push(lines.join("\n"));
      }

      if (columnContextLines.length > 0) {
        parts.push(`\n## Column Descriptions\nNote: Items marked with ⚠️ [MANDATORY] are user-defined rules that MUST be strictly followed.\n${columnContextLines.join("\n\n")}`);
      }
    }
  } catch (error) {
    logger.warn(`Failed to get column explanations: ${error}`);
  }

  // Get ALL SQL examples (no limit - they contain important business logic and patterns)
  try {
    const examples = useKB ? useKB.sqlExamples : getSqlExamplesByConnection(connectionId);
    if (examples.length > 0) {
      const exampleContext = examples
        .map((e: any, i: number) => {
          const isUserDefined = e.source === "user";
          const prefix = isUserDefined ? "⚠️ [MANDATORY PATTERN] " : "";
          let result = `${prefix}Example ${i + 1}: "${e.natural_language}"\n\`\`\`sql\n${e.sql_query}\n\`\`\``;
          if (isUserDefined) {
            result += `\n⚠️ THIS IS A USER-DEFINED PATTERN - MUST BE USED AS THE CORRECT APPROACH`;
          }
          return result;
        })
        .join("\n\n");
      parts.push(`\n## Example Queries\nNote: Items marked with ⚠️ [MANDATORY PATTERN] are user-defined and MUST be followed as the correct approach.\n${exampleContext}`);
    }
  } catch (error) {
    logger.warn(`Failed to get SQL examples: ${error}`);
  }

  // User query
  parts.push(`\n## User Request\n${naturalLanguageQuery}`);
  parts.push(`\n## Response\nRespond ONLY with JSON in the format specified above, no other text.`);

  return parts.join("\n");
}

/**
 * Format database schema for context
 */
function formatSchema(schema: DatabaseSchema, maxTokens: number): string {
  const lines: string[] = [];
  let estimatedTokens = 0;
  const tokensPerChar = 0.25; // Rough estimate

  for (const table of schema.tables) {
    const tableLines: string[] = [];
    tableLines.push(`\nTable: ${table.name}`);
    if (table.rowCount !== undefined) {
      tableLines.push(`  Row count: ~${table.rowCount}`);
    }
    tableLines.push("  Columns:");

    for (const column of table.columns) {
      let colLine = `    - ${column.name} (${column.type})`;
      if (column.isPrimaryKey) colLine += " PRIMARY KEY";
      if (column.isForeignKey && column.references) {
        colLine += ` -> ${column.references.table}.${column.references.column}`;
      }
      if (!column.nullable) colLine += " NOT NULL";
      tableLines.push(colLine);
    }

    const tableText = tableLines.join("\n");
    const tableTokens = tableText.length * tokensPerChar;

    if (estimatedTokens + tableTokens > maxTokens) {
      lines.push(`\n... (${schema.tables.length - lines.length} more tables omitted due to context limit)`);
      break;
    }

    lines.push(tableText);
    estimatedTokens += tableTokens;
  }

  return lines.join("\n");
}

/**
 * Format table annotations
 */
function formatTableAnnotations(annotations: TableAnnotation[]): string {
  return annotations
    .map((a) => {
      const parts = [`- ${a.tableName}`];
      if (a.description) parts.push(`  Description: ${a.description}`);
      if (a.businessPurpose) parts.push(`  Purpose: ${a.businessPurpose}`);
      if (a.keywords?.length) parts.push(`  Keywords: ${a.keywords.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * Format column annotations
 */
function formatColumnAnnotations(annotations: ColumnAnnotation[]): string {
  // Group by table
  const byTable = new Map<string, ColumnAnnotation[]>();
  for (const a of annotations) {
    const list = byTable.get(a.tableName) || [];
    list.push(a);
    byTable.set(a.tableName, list);
  }

  const lines: string[] = [];
  for (const [tableName, cols] of byTable) {
    lines.push(`Table ${tableName}:`);
    for (const col of cols) {
      const parts = [`  - ${col.columnName}`];
      if (col.description) parts.push(`    ${col.description}`);
      if (col.businessMeaning) parts.push(`    Meaning: ${col.businessMeaning}`);
      if (col.synonyms?.length) parts.push(`    Also known as: ${col.synonyms.join(", ")}`);
      if (col.sensitivityLevel === "HIGH") parts.push(`    ⚠️ SENSITIVE DATA - do not include in queries`);
      lines.push(parts.join("\n"));
    }
  }

  return lines.join("\n");
}
