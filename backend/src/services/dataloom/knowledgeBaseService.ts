// =============================================================================
// Knowledge Base Service - AI-powered schema analysis and knowledge management
// =============================================================================

import { logger } from "../../utils/logger.js";
import { getSchema } from "../database/connectionManager.js";
import {
  getTableExplanationsByConnection,
  getColumnExplanationsByTable,
  getSqlExamplesByConnection,
  createTableExplanation,
  createColumnExplanation,
  createSqlExample,
  updateTableExplanation,
  updateColumnExplanation,
  updateSqlExample,
  deleteTableExplanation,
  deleteColumnExplanation,
  deleteSqlExample,
  getDatabaseConnection,
  type TableExplanation,
  type ColumnExplanation,
  type SqlExample,
} from "./databaseService.js";
import {
  DATABASE_PHASE1_WITH_SCHEMA_PROMPT,
  DATABASE_PHASE1_NO_SCHEMA_PROMPT,
  DATABASE_PHASE2_WITH_SCHEMA_PROMPT,
  DATABASE_PHASE2_NO_SCHEMA_PROMPT,
  DATABASE_PHASE3_WITH_SCHEMA_PROMPT,
  DATABASE_PHASE3_NO_SCHEMA_PROMPT,
} from "../../prompts/index.js";
import fs from "fs";
import path from "path";

// =============================================================================
// Types
// =============================================================================

export interface KnowledgeBaseData {
  tableExplanations: TableExplanationWithColumns[];
  columnExplanations: (ColumnExplanation & { table_name?: string; schema_name?: string })[];
  sqlExamples: SqlExample[];
}

export interface TableExplanationWithColumns extends TableExplanation {
  columns: ColumnExplanation[];
}

export interface AnalyzeRequest {
  connectionId: number;
  userInput?: string;
  files?: Array<{
    name: string;
    content: string;
  }>;
  existingKnowledge?: KnowledgeBaseData;
}

export interface AnalysisResult {
  tableExplanations: Array<{
    schema_name?: string;
    table_name: string;
    explanation: string;
    business_purpose: string;
    keywords: string[];
    columns: Array<{
      column_name: string;
      explanation: string;
      business_meaning: string;
      data_type?: string;
      sensitivity_level?: string;
      synonyms?: string[];
      sample_values?: string[];
    }>;
  }>;
  sqlExamples: Array<{
    natural_language: string;
    sql_query: string;
    explanation: string;
    tables_involved: string[];
    tags?: string[];
  }>;
}

// =============================================================================
// Get Full Knowledge Base
// =============================================================================

export function getFullKnowledgeBase(connectionId: number): KnowledgeBaseData {
  const tableExplanations = getTableExplanationsByConnection(connectionId);

  const tableExplanationsWithColumns: TableExplanationWithColumns[] = tableExplanations.map((table) => {
    const columns = table.id ? getColumnExplanationsByTable(table.id) : [];
    return {
      ...table,
      columns,
    };
  });

  // Collect all column explanations with table names and schema names
  const columnExplanations: (ColumnExplanation & { table_name?: string; schema_name?: string })[] = [];
  tableExplanations.forEach((table) => {
    if (table.id) {
      const columns = getColumnExplanationsByTable(table.id);
      columns.forEach((col) => {
        columnExplanations.push({
          ...col,
          table_name: table.table_name, // Add table_name for grouping in UI
          schema_name: table.schema_name, // Add schema_name for displaying in UI
        });
      });
    }
  });

  const sqlExamples = getSqlExamplesByConnection(connectionId);

  return {
    tableExplanations: tableExplanationsWithColumns,
    columnExplanations,
    sqlExamples,
  };
}

// =============================================================================
// Build AI Analysis Prompt
// =============================================================================

/**
 * Extract selected schemas from connection config
 * Returns undefined if:
 * - Database type doesn't support schemas (e.g., SQLite)
 * - No schema selection is stored
 * - All schemas are selected (same as no filter)
 */
export function getSelectedSchemasFromConnection(connectionId: number): string[] | undefined {
  const connection = getDatabaseConnection(connectionId);
  if (!connection || !connection.config) return undefined;

  // SQLite doesn't have schemas - always return undefined
  if (connection.type === "sqlite") {
    return undefined;
  }

  // Only PostgreSQL and SQL Server support schema selection
  if (connection.type !== "postgresql" && connection.type !== "sqlserver") {
    return undefined;
  }

  try {
    const configData = typeof connection.config === "string" ? JSON.parse(connection.config) : connection.config;
    if (configData.schema && typeof configData.schema === "string") {
      // config.schema is stored as JSON string array like: [{"name":"public","isSelected":true}]
      const schemaArray = JSON.parse(configData.schema);
      if (Array.isArray(schemaArray)) {
        const selected = schemaArray.filter((s: any) => s.isSelected).map((s: any) => s.name);
        return selected.length > 0 ? selected : undefined;
      }
    }
  } catch (e) {
    // Ignore parse errors, return undefined to use all schemas
  }
  return undefined;
}

// =============================================================================
// Build Phase 1 Prompt - Table Structure Analysis
// =============================================================================

interface PromptOptions {
  userInput?: string;
  files?: Array<{ name: string; content: string }>;
  selectedSchemas?: string[]; // Optional: filter to specific schemas
}

export async function buildPhase1Prompt(connectionId: number, options?: PromptOptions): Promise<string> {
  const connection = getDatabaseConnection(connectionId);
  const dbType = connection?.type || "unknown";
  const isSqlite = dbType === "sqlite";

  const systemPrompt = isSqlite ? DATABASE_PHASE1_NO_SCHEMA_PROMPT : DATABASE_PHASE1_WITH_SCHEMA_PROMPT;

  // Get existing knowledge base - all records included, user-defined emphasized
  const existingKB = getFullKnowledgeBase(connectionId);
  let existingKBText = "(No existing knowledge base)";
  if (existingKB.tableExplanations.length > 0 || existingKB.sqlExamples.length > 0) {
    const kbSummary: any = {
      note: "Items marked with 'MANDATORY: true' are USER-DEFINED and MUST be strictly followed",
      tableExplanations: existingKB.tableExplanations.map((t: any) => ({
        table_name: t.table_name,
        schema_name: t.schema_name,
        explanation: t.explanation,
        business_purpose: t.business_purpose,
        MANDATORY: t.source === "user", // User-defined rules are mandatory
        columns: t.columns?.map((c: any) => ({
          column_name: c.column_name,
          explanation: c.explanation,
          business_meaning: c.business_meaning,
          MANDATORY: c.source === "user", // User-defined column rules are mandatory
        })),
      })),
    };
    existingKBText = JSON.stringify(kbSummary, null, 2);
  }

  // Build user input text
  const userInputText = options?.userInput?.trim() || "(No user input provided)";

  // Build uploaded files text
  let filesText = "(No files uploaded)";
  if (options?.files && options.files.length > 0) {
    filesText = options.files.map(f => `--- ${f.name} ---\n${f.content}`).join("\n\n");
  }

  let schemaText = "\n## Database Schema:\n";
  try {
    // Use selectedSchemas from options, or extract from connection config
    const schemasToUse = options?.selectedSchemas || getSelectedSchemasFromConnection(connectionId);
    const schema = await getSchema(connectionId, schemasToUse);
    schema.tables.forEach((table: any) => {
      const schemaPrefix = table.schema ? `${table.schema}.` : "";
      schemaText += `\nTable: ${schemaPrefix}${table.name}`;
      if (table.schema && !isSqlite) schemaText += ` (schema: ${table.schema})`;
      schemaText += "\nColumns:\n";
      table.columns.forEach((col: any) => {
        let colInfo = `  - ${col.name} (${col.type})`;
        if (col.primaryKey) colInfo += " [PRIMARY KEY]";
        if (!col.nullable) colInfo += " [NOT NULL]";
        if (col.foreignKey) colInfo += ` [FK -> ${col.foreignKey.table}.${col.foreignKey.column}]`;
        schemaText += colInfo + "\n";
      });
    });
  } catch (error) {
    logger.warn(`Failed to get schema for phase 1: ${error}`);
    schemaText = "\n## Database Schema: (Failed to fetch)\n";
  }

  let prompt = systemPrompt
    .replace("[EXISTING_KB_PLACEHOLDER]", existingKBText)
    .replace("[USER_INPUT_PLACEHOLDER]", userInputText)
    .replace("[UPLOADED_FILES_PLACEHOLDER]", filesText);

  return prompt + schemaText;
}

// =============================================================================
// Build Phase 2 Prompt - Column Explanations
// =============================================================================

export async function buildPhase2Prompt(connectionId: number, phase1Result: AnalysisResult, options?: PromptOptions): Promise<string> {
  const connection = getDatabaseConnection(connectionId);
  const dbType = connection?.type || "unknown";
  const isSqlite = dbType === "sqlite";

  const systemPrompt = isSqlite ? DATABASE_PHASE2_NO_SCHEMA_PROMPT : DATABASE_PHASE2_WITH_SCHEMA_PROMPT;

  let schemaText = "\n## Database Schema:\n";
  try {
    // Use selectedSchemas from options, or extract from connection config
    const schemasToUse = options?.selectedSchemas || getSelectedSchemasFromConnection(connectionId);
    const schema = await getSchema(connectionId, schemasToUse);
    schema.tables.forEach((table: any) => {
      const schemaPrefix = table.schema ? `${table.schema}.` : "";
      schemaText += `\nTable: ${schemaPrefix}${table.name}`;
      if (table.schema && !isSqlite) schemaText += ` (schema: ${table.schema})`;
      schemaText += "\nColumns:\n";
      table.columns.forEach((col: any) => {
        let colInfo = `  - ${col.name} (${col.type})`;
        if (col.primaryKey) colInfo += " [PRIMARY KEY]";
        if (!col.nullable) colInfo += " [NOT NULL]";
        if (col.foreignKey) colInfo += ` [FK -> ${col.foreignKey.table}.${col.foreignKey.column}]`;
        schemaText += colInfo + "\n";
      });
    });
  } catch (error) {
    logger.warn(`Failed to get schema for phase 2: ${error}`);
    schemaText = "\n## Database Schema: (Failed to fetch)\n";
  }

  let prompt = systemPrompt
    .replace("[PHASE1_KB_PLACEHOLDER]", JSON.stringify(phase1Result, null, 2))
    .replace("[SCHEMA_PLACEHOLDER]", schemaText);

  return prompt;
}

// =============================================================================
// Build Phase 3 Prompt - SQL Examples and Final Merge
// =============================================================================

export async function buildPhase3Prompt(connectionId: number, phase2Result: AnalysisResult, options?: PromptOptions): Promise<string> {
  const connection = getDatabaseConnection(connectionId);
  const dbType = connection?.type || "unknown";
  const isSqlite = dbType === "sqlite";

  const systemPrompt = isSqlite ? DATABASE_PHASE3_NO_SCHEMA_PROMPT : DATABASE_PHASE3_WITH_SCHEMA_PROMPT;

  // Get existing knowledge base - all records included, user-defined emphasized
  const existingKB = getFullKnowledgeBase(connectionId);
  
  // Build existing KB text with table explanations - all included, user-defined marked as MANDATORY
  let existingKBText = "(No existing knowledge base)";
  if (existingKB.tableExplanations.length > 0) {
    const kbSummary = {
      note: "Items with 'MANDATORY: true' are USER-DEFINED and MUST be strictly followed when generating SQL",
      tables: existingKB.tableExplanations.map((t: any) => ({
        table_name: t.table_name,
        schema_name: t.schema_name,
        explanation: t.explanation,
        business_purpose: t.business_purpose,
        MANDATORY: t.source === "user",
        columns: t.columns?.map((c: any) => ({
          column_name: c.column_name,
          explanation: c.explanation,
          business_meaning: c.business_meaning,
          MANDATORY: c.source === "user",
        })),
      })),
    };
    existingKBText = JSON.stringify(kbSummary, null, 2);
  }

  // Build existing SQL examples text - all included, user-defined marked as MANDATORY
  let existingSqlExamplesText = "(No existing SQL examples)";
  if (existingKB.sqlExamples.length > 0) {
    const sqlSummary = {
      note: "Items with 'MANDATORY: true' are USER-DEFINED patterns that MUST be used as the correct approach",
      examples: existingKB.sqlExamples.map((s: any) => ({
        natural_language: s.natural_language,
        sql_query: s.sql_query,
        tables_involved: s.tables_involved,
        MANDATORY: s.source === "user",
      })),
    };
    existingSqlExamplesText = JSON.stringify(sqlSummary, null, 2);
  }

  // Build user input text
  const userInputText = options?.userInput?.trim() || "(No user input provided)";

  // Build uploaded files text
  let filesText = "(No files uploaded)";
  if (options?.files && options.files.length > 0) {
    filesText = options.files.map(f => `--- ${f.name} ---\n${f.content}`).join("\n\n");
  }

  let schemaText = "\n## Database Schema:\n";
  try {
    // Use selectedSchemas from options, or extract from connection config
    const schemasToUse = options?.selectedSchemas || getSelectedSchemasFromConnection(connectionId);
    const schema = await getSchema(connectionId, schemasToUse);
    schema.tables.forEach((table: any) => {
      const schemaPrefix = table.schema ? `${table.schema}.` : "";
      schemaText += `\nTable: ${schemaPrefix}${table.name}`;
      if (table.schema && !isSqlite) schemaText += ` (schema: ${table.schema})`;
      schemaText += "\nColumns:\n";
      table.columns.forEach((col: any) => {
        let colInfo = `  - ${col.name} (${col.type})`;
        if (col.primaryKey) colInfo += " [PRIMARY KEY]";
        if (!col.nullable) colInfo += " [NOT NULL]";
        if (col.foreignKey) colInfo += ` [FK -> ${col.foreignKey.table}.${col.foreignKey.column}]`;
        schemaText += colInfo + "\n";
      });
    });
  } catch (error) {
    logger.warn(`Failed to get schema for phase 3: ${error}`);
    schemaText = "\n## Database Schema: (Failed to fetch)\n";
  }

  let prompt = systemPrompt
    .replace("[EXISTING_KB_PLACEHOLDER]", existingKBText)
    .replace("[EXISTING_SQL_EXAMPLES_PLACEHOLDER]", existingSqlExamplesText)
    .replace("[UPLOADED_FILES_PLACEHOLDER]", filesText)
    .replace("[PHASE1_PHASE2_KB_PLACEHOLDER]", JSON.stringify(phase2Result, null, 2))
    .replace("[SCHEMA_PLACEHOLDER]", schemaText)
    .replace("[USER_INPUT_PLACEHOLDER]", userInputText);

  return prompt;
}

// =============================================================================
// Build Quick Schema Analysis Prompt (Legacy - kept for backward compatibility)
// =============================================================================

export async function buildQuickAnalysisPrompt(connectionId: number): Promise<string> {
  return buildPhase1Prompt(connectionId);
}

// =============================================================================
// Save Analysis Result to Database
// =============================================================================

export function saveAnalysisResult(
  connectionId: number,
  analysis: AnalysisResult,
): {
  saved: { tables: number; columns: number; examples: number };
  updated: { tables: number; columns: number; examples: number };
} {
  const stats = {
    saved: { tables: 0, columns: 0, examples: 0 },
    updated: { tables: 0, columns: 0, examples: 0 },
  };

  // Get existing data for upsert logic
  const existingTables = getTableExplanationsByConnection(connectionId);
  const existingTableMap = new Map(existingTables.map((t) => [t.table_name, t]));

  const existingSqlExamples = getSqlExamplesByConnection(connectionId);
  const existingSqlMap = new Map(existingSqlExamples.map((s) => [s.natural_language, s]));

  // Process table explanations
  for (const tableData of analysis.tableExplanations) {
    const existingTable = existingTableMap.get(tableData.table_name);
    let tableId: number;
    
    // Check if we should skip updating the table (only update columns)
    const skipTableUpdate = (tableData as any)._skipTableUpdate === true;

    if (existingTable && existingTable.id) {
      tableId = existingTable.id;
      
      // Only update table if not skipped
      if (!skipTableUpdate) {
        updateTableExplanation(existingTable.id, {
          schema_name: tableData.schema_name,
          explanation: tableData.explanation,
          business_purpose: tableData.business_purpose,
          keywords: JSON.stringify(tableData.keywords || []),
        });
        stats.updated.tables++;
      }
    } else {
      // Create new table (always create if it doesn't exist, even if skipTableUpdate is true)
      // This is necessary because columns need a parent table
      tableId = createTableExplanation({
        database_connection_id: connectionId,
        schema_name: tableData.schema_name,
        table_name: tableData.table_name,
        explanation: skipTableUpdate ? "" : tableData.explanation,
        business_purpose: skipTableUpdate ? "" : tableData.business_purpose,
        keywords: skipTableUpdate ? "[]" : JSON.stringify(tableData.keywords || []),
      });
      stats.saved.tables++;
    }

    // Process columns for this table
    const existingColumns = getColumnExplanationsByTable(tableId);
    const existingColumnMap = new Map(existingColumns.map((c) => [c.column_name, c]));

    for (const colData of tableData.columns || []) {
      const existingCol = existingColumnMap.get(colData.column_name);

      if (existingCol && existingCol.id) {
        // Update existing column
        updateColumnExplanation(existingCol.id, {
          explanation: colData.explanation,
          business_meaning: colData.business_meaning,
          data_type: colData.data_type,
          sensitivity_level: colData.sensitivity_level,
          synonyms: JSON.stringify(colData.synonyms || []),
          sample_values: JSON.stringify(colData.sample_values || []),
        });
        stats.updated.columns++;
      } else {
        // Create new column
        createColumnExplanation({
          table_explanation_id: tableId,
          column_name: colData.column_name,
          explanation: colData.explanation,
          business_meaning: colData.business_meaning,
          data_type: colData.data_type,
          sensitivity_level: colData.sensitivity_level,
          synonyms: JSON.stringify(colData.synonyms || []),
          sample_values: JSON.stringify(colData.sample_values || []),
        });
        stats.saved.columns++;
      }
    }
  }

  // Process SQL examples
  for (const exampleData of analysis.sqlExamples) {
    const existingExample = existingSqlMap.get(exampleData.natural_language);

    if (existingExample && existingExample.id) {
      // Update existing example
      updateSqlExample(existingExample.id, {
        sql_query: exampleData.sql_query,
        explanation: exampleData.explanation,
        is_learned: true,
      });
      stats.updated.examples++;
    } else {
      // Create new example
      createSqlExample({
        database_connection_id: connectionId,
        natural_language: exampleData.natural_language,
        sql_query: exampleData.sql_query,
        explanation: exampleData.explanation,
        tags: JSON.stringify(exampleData.tags || ["ai-generated"]),
        tables_involved: JSON.stringify(exampleData.tables_involved || []),
        is_learned: true,
      });
      stats.saved.examples++;
    }
  }

  return stats;
}

// =============================================================================
// Read File Content
// =============================================================================

export function readFileContent(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    logger.error(`Error reading file ${filePath}: ${error}`);
    throw error;
  }
}

// =============================================================================
// Delete All Knowledge Base for Connection
// =============================================================================

export function clearKnowledgeBase(connectionId: number): void {
  const tableExplanations = getTableExplanationsByConnection(connectionId);

  // Delete all column explanations first (foreign key constraint)
  for (const table of tableExplanations) {
    if (table.id) {
      const columns = getColumnExplanationsByTable(table.id);
      for (const col of columns) {
        if (col.id) {
          deleteColumnExplanation(col.id);
        }
      }
      deleteTableExplanation(table.id);
    }
  }

  // Delete all SQL examples
  const sqlExamples = getSqlExamplesByConnection(connectionId);
  for (const example of sqlExamples) {
    if (example.id) {
      deleteSqlExample(example.id);
    }
  }

  logger.info(`Cleared knowledge base for connection ${connectionId}`);
}
