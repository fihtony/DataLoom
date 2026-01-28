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
// Helper: Build table key for matching (handles schema and non-schema databases)
// =============================================================================

/**
 * Build a unique key for table matching
 * For databases with schema: "schema.table"
 * For databases without schema: "table"
 */
function buildTableKey(schemaName: string | undefined | null, tableName: string): string {
  // If schema_name is null, undefined, or empty string, treat as no schema
  if (!schemaName || schemaName.trim() === "") {
    return tableName;
  }
  return `${schemaName}.${tableName}`;
}

// =============================================================================
// Helper: Process table explanations (shared logic for import and save)
// =============================================================================

interface ProcessTableOptions {
  connectionId: number;
  tableData: {
    schema_name?: string;
    table_name: string;
    explanation?: string;
    business_purpose?: string;
    keywords?: string | string[];
    columns?: Array<{
      column_name: string;
      explanation?: string;
      business_meaning?: string;
      data_type?: string;
      sensitivity_level?: string;
      synonyms?: string | string[];
      sample_values?: string | string[];
      source?: string;
    }>;
    source?: string;
    _skipTableUpdate?: boolean; // Special flag for saveAnalysisResult
  };
  existingTableMap: Map<string, TableExplanation>;
  stats: { saved: { tables: number; columns: number; examples: number }; updated: { tables: number; columns: number; examples: number } };
  defaultSource?: string; // "agent" for analysis, "user" for import
}

function processTableExplanation(options: ProcessTableOptions): number {
  const { connectionId, tableData, existingTableMap, stats, defaultSource = "agent" } = options;
  
  // Build matching key
  const tableKey = buildTableKey(tableData.schema_name, tableData.table_name);
  const existingTable = existingTableMap.get(tableKey);
  let tableId: number;

  // Check if we should skip updating the table (only for saveAnalysisResult)
  const skipTableUpdate = (tableData as any)._skipTableUpdate === true;

  if (existingTable && existingTable.id) {
    tableId = existingTable.id;
    
    // Only update table if not skipped
    if (!skipTableUpdate) {
      // Normalize keywords (handle both string and array)
      const keywordsValue = typeof tableData.keywords === "string" 
        ? tableData.keywords 
        : JSON.stringify(tableData.keywords || []);
      
      updateTableExplanation(existingTable.id, {
        schema_name: tableData.schema_name,
        explanation: tableData.explanation,
        business_purpose: tableData.business_purpose,
        keywords: keywordsValue,
        source: tableData.source || defaultSource,
      });
      stats.updated.tables++;
    }
  } else {
    // Create new table (always create if it doesn't exist, even if skipTableUpdate is true)
    // This is necessary because columns need a parent table
    const keywordsValue = typeof tableData.keywords === "string" 
      ? tableData.keywords 
      : JSON.stringify(tableData.keywords || []);
    
    tableId = createTableExplanation({
      database_connection_id: connectionId,
      schema_name: tableData.schema_name,
      table_name: tableData.table_name,
      explanation: skipTableUpdate ? "" : tableData.explanation,
      business_purpose: skipTableUpdate ? "" : tableData.business_purpose,
      keywords: skipTableUpdate ? "[]" : keywordsValue,
      source: tableData.source || defaultSource,
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
      const synonymsValue = typeof colData.synonyms === "string" 
        ? colData.synonyms 
        : JSON.stringify(colData.synonyms || []);
      const sampleValuesValue = typeof colData.sample_values === "string" 
        ? colData.sample_values 
        : JSON.stringify(colData.sample_values || []);
      
      updateColumnExplanation(existingCol.id, {
        explanation: colData.explanation,
        business_meaning: colData.business_meaning,
        data_type: colData.data_type,
        sensitivity_level: colData.sensitivity_level,
        synonyms: synonymsValue,
        sample_values: sampleValuesValue,
        source: colData.source || defaultSource,
      });
      stats.updated.columns++;
    } else {
      // Create new column
      const synonymsValue = typeof colData.synonyms === "string" 
        ? colData.synonyms 
        : JSON.stringify(colData.synonyms || []);
      const sampleValuesValue = typeof colData.sample_values === "string" 
        ? colData.sample_values 
        : JSON.stringify(colData.sample_values || []);
      
      createColumnExplanation({
        table_explanation_id: tableId,
        column_name: colData.column_name,
        explanation: colData.explanation,
        business_meaning: colData.business_meaning,
        data_type: colData.data_type,
        sensitivity_level: colData.sensitivity_level,
        synonyms: synonymsValue,
        sample_values: sampleValuesValue,
        source: colData.source || defaultSource,
      });
      stats.saved.columns++;
    }
  }

  return tableId;
}

// =============================================================================
// Helper: Process SQL examples (shared logic for import and save)
// =============================================================================

interface ProcessSqlExampleOptions {
  connectionId: number;
  exampleData: {
    natural_language: string;
    sql_query: string;
    explanation?: string;
    tags?: string | string[];
    tables_involved?: string | string[];
    is_learned?: boolean;
    source?: string;
  };
  existingSqlMap: Map<string, SqlExample>;
  stats: { saved: { tables: number; columns: number; examples: number }; updated: { tables: number; columns: number; examples: number } };
  defaultSource?: string; // "agent" for analysis, "user" for import
}

function processSqlExample(options: ProcessSqlExampleOptions): void {
  const { connectionId, exampleData, existingSqlMap, stats, defaultSource = "agent" } = options;
  
  const existingExample = existingSqlMap.get(exampleData.natural_language);

  if (existingExample && existingExample.id) {
    // Update existing example
    const tagsValue = typeof exampleData.tags === "string" 
      ? exampleData.tags 
      : JSON.stringify(exampleData.tags || []);
    const tablesInvolvedValue = typeof exampleData.tables_involved === "string" 
      ? exampleData.tables_involved 
      : JSON.stringify(exampleData.tables_involved || []);
    
    updateSqlExample(existingExample.id, {
      sql_query: exampleData.sql_query,
      explanation: exampleData.explanation,
      tags: tagsValue,
      tables_involved: tablesInvolvedValue,
      is_learned: exampleData.is_learned,
      source: exampleData.source || defaultSource,
    });
    stats.updated.examples++;
  } else {
    // Create new example
    const tagsValue = typeof exampleData.tags === "string" 
      ? exampleData.tags 
      : JSON.stringify(exampleData.tags || ["ai-generated"]);
    const tablesInvolvedValue = typeof exampleData.tables_involved === "string" 
      ? exampleData.tables_involved 
      : JSON.stringify(exampleData.tables_involved || []);
    
    createSqlExample({
      database_connection_id: connectionId,
      natural_language: exampleData.natural_language,
      sql_query: exampleData.sql_query,
      explanation: exampleData.explanation,
      tags: tagsValue,
      tables_involved: tablesInvolvedValue,
      is_learned: exampleData.is_learned !== undefined ? exampleData.is_learned : true,
      source: exampleData.source || defaultSource,
    });
    stats.saved.examples++;
  }
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

/**
 * Get selected schemas from connection configuration
 * Returns undefined for SQLite (no schemas) or if no schemas are selected
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
      const selectedSchemas = schemaArray.filter((s: any) => s.isSelected === true).map((s: any) => s.name);
      return selectedSchemas.length > 0 ? selectedSchemas : undefined;
    }
  } catch (error) {
    logger.warn(`Failed to parse schema selection for connection ${connectionId}: ${error}`);
  }

  return undefined;
}

// =============================================================================
// Build Phase 1 Prompt - Table Structure Analysis
// =============================================================================

export async function buildPhase1Prompt(connectionId: number, options?: PromptOptions): Promise<string> {
  const connection = getDatabaseConnection(connectionId);
  const dbType = connection?.type || "unknown";
  const isSqlite = dbType === "sqlite";

  const systemPrompt = isSqlite ? DATABASE_PHASE1_NO_SCHEMA_PROMPT : DATABASE_PHASE1_WITH_SCHEMA_PROMPT;

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

  // Build user input text
  const userInputText = options?.userInput?.trim() || "(No user input provided)";

  // Build uploaded files text
  let filesText = "(No files uploaded)";
  if (options?.files && options.files.length > 0) {
    filesText = options.files.map((f) => `--- ${f.name} ---\n${f.content}`).join("\n\n");
  }

  let prompt = systemPrompt
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
    filesText = options.files.map((f) => `--- ${f.name} ---\n${f.content}`).join("\n\n");
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
    .replace("[PHASE2_KB_PLACEHOLDER]", JSON.stringify(phase2Result, null, 2))
    .replace("[EXISTING_KB_PLACEHOLDER]", existingKBText)
    .replace("[EXISTING_SQL_EXAMPLES_PLACEHOLDER]", existingSqlExamplesText)
    .replace("[USER_INPUT_PLACEHOLDER]", userInputText)
    .replace("[UPLOADED_FILES_PLACEHOLDER]", filesText);

  return prompt + schemaText;
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
  // Build map with schema.table as key (or just table_name for databases without schema)
  const existingTableMap = new Map<string, TableExplanation>();
  existingTables.forEach((t) => {
    const key = buildTableKey(t.schema_name, t.table_name);
    existingTableMap.set(key, t);
  });

  const existingSqlExamples = getSqlExamplesByConnection(connectionId);
  const existingSqlMap = new Map(existingSqlExamples.map((s) => [s.natural_language, s]));

  // Process table explanations using shared helper
  for (const tableData of analysis.tableExplanations) {
    processTableExplanation({
      connectionId,
      tableData: {
        ...tableData,
        keywords: tableData.keywords || [],
      },
      existingTableMap,
      stats,
      defaultSource: "agent",
    });
  }

  // Process SQL examples using shared helper
  for (const exampleData of analysis.sqlExamples) {
    processSqlExample({
      connectionId,
      exampleData: {
        ...exampleData,
        tags: exampleData.tags || ["ai-generated"],
        tables_involved: exampleData.tables_involved || [],
        is_learned: true,
      },
      existingSqlMap,
      stats,
      defaultSource: "agent",
    });
  }

  return stats;
}

// =============================================================================
// Export Knowledge Base
// =============================================================================

export interface ExportKnowledgeBaseData {
  connectionId: number;
  connectionName: string;
  databaseType: string;
  exportedAt: string;
  tableExplanations: Array<Omit<TableExplanation, "id" | "database_connection_id"> & { columns?: Array<Omit<ColumnExplanation, "id" | "table_explanation_id">> }>;
  sqlExamples: Array<Omit<SqlExample, "id" | "database_connection_id">>;
}

export function exportKnowledgeBase(connectionId: number): ExportKnowledgeBaseData {
  const connection = getDatabaseConnection(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  // Get selected schemas if database has schemas
  const selectedSchemas = getSelectedSchemasFromConnection(connectionId);
  
  // Get all knowledge base data
  const allTableExplanations = getTableExplanationsByConnection(connectionId);
  const allSqlExamples = getSqlExamplesByConnection(connectionId);

  // Filter by selected schemas if applicable
  let tableExplanations = allTableExplanations;
  if (selectedSchemas && selectedSchemas.length > 0) {
    tableExplanations = allTableExplanations.filter((t) => {
      // If table has schema, check if it's in selected schemas
      if (t.schema_name) {
        return selectedSchemas.includes(t.schema_name);
      }
      // If no schema, include it (for databases without schemas or default schema)
      return true;
    });
  }

  // Get column explanations for filtered tables and attach to tables
  const tableExplanationsWithColumns = tableExplanations.map((table) => {
    const { id, database_connection_id, ...tableData } = table;
    let columns: Array<Omit<ColumnExplanation, "id" | "table_explanation_id">> = [];
    
    if (table.id) {
      const tableColumns = getColumnExplanationsByTable(table.id);
      columns = tableColumns.map((col) => {
        const { id: colId, table_explanation_id, ...colData } = col;
        return colData;
      });
    }
    
    return {
      ...tableData,
      columns,
    };
  });

  // Remove id and database_connection_id from SQL examples
  const sqlExamplesForExport = allSqlExamples.map((example) => {
    const { id, database_connection_id, ...exampleData } = example;
    return exampleData;
  });

  return {
    connectionId,
    connectionName: connection.name,
    databaseType: connection.type,
    exportedAt: new Date().toISOString(),
    tableExplanations: tableExplanationsWithColumns,
    sqlExamples: sqlExamplesForExport,
  };
}

// =============================================================================
// Import Knowledge Base
// =============================================================================

export interface ImportValidationResult {
  success: boolean;
  table_validation: Array<{
    target: {
      schema: string | null;
      table: string;
    } | null;
    source: {
      schema: string | null;
      table: string;
    } | null;
  }>;
  column_validation: Array<{
    target: {
      schema: string | null;
      table: string;
      column: string;
    } | null;
    source: {
      schema: string | null;
      table: string;
      column: string;
    } | null;
  }>;
}

export async function validateImportData(
  connectionId: number,
  importData: ExportKnowledgeBaseData,
): Promise<ImportValidationResult> {
  const tableValidation: ImportValidationResult["table_validation"] = [];
  const columnValidation: ImportValidationResult["column_validation"] = [];
  
  try {
    // Get actual database schema
    const selectedSchemas = getSelectedSchemasFromConnection(connectionId);
    const schema = await getSchema(connectionId, selectedSchemas);
    
    // Build target database maps
    // Map: "schema.table" or "table" -> { schema, table, columns }
    const targetTableMap = new Map<string, { schema: string | null; table: string; columns: Set<string> }>();
    
    schema.tables.forEach((table: any) => {
      const tableKey = buildTableKey(table.schema, table.name);
      const columns = new Set<string>(table.columns.map((c: any) => c.name as string));
      targetTableMap.set(tableKey, {
        schema: table.schema || null,
        table: table.name,
        columns,
      });
    });

    // Build source (import file) maps
    // Map: "schema.table" or "table" -> { schema, table, columns }
    const sourceTableMap = new Map<string, { schema: string | null; table: string; columns: Set<string> }>();
    
    importData.tableExplanations.forEach((tableExp) => {
      const tableKey = buildTableKey(tableExp.schema_name || null, tableExp.table_name);
      const columns = new Set<string>();
      
      if (tableExp.columns) {
        tableExp.columns.forEach((col) => {
          columns.add(col.column_name);
        });
      }
      
      sourceTableMap.set(tableKey, {
        schema: tableExp.schema_name || null,
        table: tableExp.table_name,
        columns,
      });
    });

    // Compare tables: generate table_validation array
    // Case 1: Exact match (both target and source exist)
    // Case 2: Target exists, source doesn't (target: {...}, source: null)
    // Case 3: Source exists, target doesn't (target: null, source: {...})
    
    const allTableKeys = new Set<string>();
    targetTableMap.forEach((_, key) => allTableKeys.add(key));
    sourceTableMap.forEach((_, key) => allTableKeys.add(key));

    allTableKeys.forEach((tableKey) => {
      const targetTable = targetTableMap.get(tableKey);
      const sourceTable = sourceTableMap.get(tableKey);

      if (targetTable && sourceTable) {
        // Case 1: Exact match
        tableValidation.push({
          target: {
            schema: targetTable.schema,
            table: targetTable.table,
          },
          source: {
            schema: sourceTable.schema,
            table: sourceTable.table,
          },
        });
      } else if (targetTable && !sourceTable) {
        // Case 2: Target exists, source doesn't
        tableValidation.push({
          target: {
            schema: targetTable.schema,
            table: targetTable.table,
          },
          source: null,
        });
      } else if (!targetTable && sourceTable) {
        // Case 3: Source exists, target doesn't
        tableValidation.push({
          target: null,
          source: {
            schema: sourceTable.schema,
            table: sourceTable.table,
          },
        });
      }
    });

    // Compare columns: generate column_validation array
    // For each table that exists in either target or source, compare columns
    
    const allTablesForColumnCheck = new Set<string>();
    targetTableMap.forEach((_, key) => allTablesForColumnCheck.add(key));
    sourceTableMap.forEach((_, key) => allTablesForColumnCheck.add(key));

    allTablesForColumnCheck.forEach((tableKey) => {
      const targetTable = targetTableMap.get(tableKey);
      const sourceTable = sourceTableMap.get(tableKey);

      // Get all columns from both target and source
      const targetColumns = targetTable ? Array.from(targetTable.columns) : [];
      const sourceColumns = sourceTable ? Array.from(sourceTable.columns) : [];
      
      const allColumnNames = new Set<string>();
      targetColumns.forEach((col) => allColumnNames.add(col));
      sourceColumns.forEach((col) => allColumnNames.add(col));

      allColumnNames.forEach((columnName) => {
        const targetHasColumn = targetTable?.columns.has(columnName) || false;
        const sourceHasColumn = sourceTable?.columns.has(columnName) || false;

        if (targetHasColumn && sourceHasColumn) {
          // Case 1: Exact match
          columnValidation.push({
            target: {
              schema: targetTable!.schema,
              table: targetTable!.table,
              column: columnName,
            },
            source: {
              schema: sourceTable!.schema,
              table: sourceTable!.table,
              column: columnName,
            },
          });
        } else if (targetHasColumn && !sourceHasColumn) {
          // Case 2: Target exists, source doesn't
          columnValidation.push({
            target: {
              schema: targetTable!.schema,
              table: targetTable!.table,
              column: columnName,
            },
            source: null,
          });
        } else if (!targetHasColumn && sourceHasColumn) {
          // Case 3: Source exists, target doesn't
          columnValidation.push({
            target: null,
            source: {
              schema: sourceTable!.schema,
              table: sourceTable!.table,
              column: columnName,
            },
          });
        }
      });
    });
  } catch (error) {
    logger.error(`Error validating import data: ${error}`);
    throw error;
  }

  return {
    success: true,
    table_validation: tableValidation,
    column_validation: columnValidation,
  };
}

export function importKnowledgeBase(
  connectionId: number,
  importData: ExportKnowledgeBaseData,
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
  // Build map with schema.table as key (or just table_name for databases without schema)
  const existingTableMap = new Map<string, TableExplanation>();
  existingTables.forEach((t) => {
    const key = buildTableKey(t.schema_name, t.table_name);
    existingTableMap.set(key, t);
  });

  const existingSqlExamples = getSqlExamplesByConnection(connectionId);
  const existingSqlMap = new Map(existingSqlExamples.map((s) => [s.natural_language, s]));

  // Process table explanations using shared helper
  for (const tableData of importData.tableExplanations) {
    processTableExplanation({
      connectionId,
      tableData,
      existingTableMap,
      stats,
      defaultSource: "user",
    });
  }

  // Process SQL examples using shared helper
  for (const exampleData of importData.sqlExamples) {
    processSqlExample({
      connectionId,
      exampleData,
      existingSqlMap,
      stats,
      defaultSource: "user",
    });
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

// =============================================================================
// Prompt Options Type
// =============================================================================

export interface PromptOptions {
  userInput?: string;
  files?: Array<{ name: string; content: string }>;
  selectedSchemas?: string[];
}
