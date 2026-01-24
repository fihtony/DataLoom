// =============================================================================
// Context Builder - Constructs AI prompts with database context
// =============================================================================

import { getSchema, getConnection } from "../database/connectionManager.js";
import {
  getTableExplanationsByConnection,
  getColumnExplanationsByTable,
  getSqlExamplesByConnection,
  getTableExplanation,
} from "../dataloom/databaseService.js";
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

  // Get database schema
  try {
    let schema = useSchema;
    if (!schema) {
      schema = await getSchema(connectionId);
    }
    const schemaContext = formatSchema(schema, cfg.maxSchemaTokens);
    parts.push(`\n## Database Schema\n${schemaContext}`);
  } catch (error) {
    logger.warn(`Failed to get schema: ${error}`);
  }

  // Get table explanations (annotations)
  try {
    const tableExplanations = useKB ? useKB.tableExplanations : getTableExplanationsByConnection(connectionId);
    if (tableExplanations.length > 0) {
      const annotationContext = tableExplanations
        .map((a) => {
          const parts = [`- ${a.table_name}`];
          if (a.explanation) parts.push(`  Explanation: ${a.explanation}`);
          if (a.business_purpose) parts.push(`  Purpose: ${a.business_purpose}`);
          if (a.keywords) {
            try {
              const keywords = JSON.parse(a.keywords);
              if (Array.isArray(keywords)) parts.push(`  Keywords: ${keywords.join(", ")}`);
            } catch (e) {
              // ignore JSON parse errors
            }
          }
          return parts.join("\n");
        })
        .join("\n\n");
      parts.push(`\n## Table Descriptions\n${annotationContext}`);
    }
  } catch (error) {
    logger.warn(`Failed to get table explanations: ${error}`);
  }

  // Get column explanations (annotations) - map by table
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
      const columnContext = Array.from(columnsByTable.entries())
        .map(([tableId, cols]) => {
          const tableExpl = getTableExplanation(tableId);
          const tableName = tableExpl?.table_name || `Table ${tableId}`;
          const lines = [`Table ${tableName}:`];

          for (const col of cols) {
            const parts = [`  - ${col.column_name}`];
            if (col.explanation) parts.push(`    ${col.explanation}`);
            if (col.business_meaning) parts.push(`    Meaning: ${col.business_meaning}`);
            if (col.synonyms) {
              try {
                const synonyms = JSON.parse(col.synonyms);
                if (Array.isArray(synonyms)) parts.push(`    Also known as: ${synonyms.join(", ")}`);
              } catch (e) {
                // ignore
              }
            }
            if (col.sensitivity_level === "HIGH") parts.push(`    ⚠️ SENSITIVE DATA`);
            lines.push(parts.join("\n"));
          }
          return lines.join("\n");
        })
        .join("\n\n");

      if (columnContext) {
        parts.push(`\n## Column Descriptions\n${columnContext}`);
      }
    }
  } catch (error) {
    logger.warn(`Failed to get column explanations: ${error}`);
  }

  // Get relevant SQL examples
  try {
    const examples = useKB ? useKB.sqlExamples : getSqlExamplesByConnection(connectionId);
    const limitedExamples = examples.slice(0, 5);
    if (limitedExamples.length > 0) {
      const exampleContext = limitedExamples
        .map((e, i) => {
          return `Example ${i + 1}: "${e.natural_language}"\n\`\`\`sql\n${e.sql_query}\n\`\`\``;
        })
        .join("\n\n");
      parts.push(`\n## Example Queries\n${exampleContext}`);
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
