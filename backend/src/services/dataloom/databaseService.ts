// =============================================================================
// DataLoom Database Service - SQLite database initialization and management
// =============================================================================

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logger } from "../../utils/logger.js";

let db: Database.Database | null = null;

/**
 * Initialize DataLoom database
 * NOTE: Tables must be created separately using 'npm run db:init'
 * This function only opens the connection and verifies tables exist
 */
export function initializeDataLoomDb(dbPath?: string): Database.Database {
  if (db) {
    return db;
  }

  const filePath = dbPath || path.join(process.cwd(), "data", "dataloom.db");

  // Check if database file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Database file not found at ${filePath}.\nPlease run 'npm run db:init' first to initialize the database.`);
  }

  db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Verify that tables exist
  verifyTablesExist();

  logger.info(`DataLoom database connected: ${filePath}`);
  return db;
}

/**
 * Verify that all required tables exist
 * This function ensures the database schema is valid but does NOT create/modify tables
 */
function verifyTablesExist(): void {
  if (!db) throw new Error("Database not initialized");

  const requiredTables = [
    "users",
    "workspaces",
    "database_connections",
    "table_explanations",
    "column_explanations",
    "sql_examples",
    "ai_agents",
  ];

  const query = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (" + requiredTables.map(() => "?").join(",") + ")",
  );
  const result = query.all(...requiredTables) as { name: string }[];

  const foundTables = new Set(result.map((r) => r.name));

  for (const table of requiredTables) {
    if (!foundTables.has(table)) {
      throw new Error(`Required table '${table}' not found in database.\nPlease run 'npm run db:init' to initialize the database schema.`);
    }
  }

  logger.debug("All required database tables verified");
}

/**
 * Create all necessary tables
 */
function createAllTables(): void {
  if (!db) throw new Error("Database not initialized");

  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Workspaces table
    CREATE TABLE IF NOT EXISTS workspaces (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    );

    -- Database connections
    CREATE TABLE IF NOT EXISTS database_connections (
      id BIGINT PRIMARY KEY,
      workspace_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      schema_json TEXT,
      schema_updated_at DATETIME,
      description TEXT,
      status TEXT DEFAULT 'active',
      last_tested_at DATETIME,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      UNIQUE(workspace_id, name)
    );

    -- Table explanations
    CREATE TABLE IF NOT EXISTS table_explanations (
      id BIGINT PRIMARY KEY,
      database_connection_id BIGINT NOT NULL,
      table_name TEXT NOT NULL,
      explanation TEXT,
      business_purpose TEXT,
      keywords TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(database_connection_id) REFERENCES database_connections(id) ON DELETE CASCADE,
      UNIQUE(database_connection_id, table_name)
    );

    -- Column explanations
    CREATE TABLE IF NOT EXISTS column_explanations (
      id BIGINT PRIMARY KEY,
      table_explanation_id BIGINT NOT NULL,
      column_name TEXT NOT NULL,
      explanation TEXT,
      data_type TEXT,
      business_meaning TEXT,
      synonyms TEXT,
      sensitivity_level TEXT,
      sample_values TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(table_explanation_id) REFERENCES table_explanations(id) ON DELETE CASCADE,
      UNIQUE(table_explanation_id, column_name)
    );

    -- SQL examples (includes learned prompts)
    CREATE TABLE IF NOT EXISTS sql_examples (
      id BIGINT PRIMARY KEY,
      database_connection_id BIGINT NOT NULL,
      natural_language TEXT,
      sql_query TEXT,
      explanation TEXT,
      tags TEXT,
      tables_involved TEXT,
      is_learned BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(database_connection_id) REFERENCES database_connections(id) ON DELETE CASCADE,
      UNIQUE(database_connection_id, natural_language)
    );

    -- AI Agents (global, not tied to workspace)
    CREATE TABLE IF NOT EXISTS ai_agents (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      model TEXT,
      api_key TEXT,
      api_base_url TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      max_tokens INT DEFAULT 2000,
      top_p REAL DEFAULT 1.0,
      frequency_penalty REAL DEFAULT 0.0,
      presence_penalty REAL DEFAULT 0.0,
      is_default BOOLEAN DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      last_used_at DATETIME,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
    CREATE INDEX IF NOT EXISTS idx_database_connections_workspace_id ON database_connections(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_table_explanations_connection_id ON table_explanations(database_connection_id);
    CREATE INDEX IF NOT EXISTS idx_column_explanations_table_explanation_id ON column_explanations(table_explanation_id);
    CREATE INDEX IF NOT EXISTS idx_sql_examples_connection_id ON sql_examples(database_connection_id);
  `);

  logger.info("All DataLoom database tables created successfully");
}

/**
 * Get database instance
 */
export function getDataLoomDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDataLoomDb() first.");
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDataLoomDb(): void {
  if (db) {
    db.close();
    db = null;
    logger.info("DataLoom database closed");
  }
}

/**
 * Generate next ID for a table
 */
function generateId(tableName: string): number {
  if (!db) throw new Error("Database not initialized");
  const currentMax = db.prepare(`SELECT MAX(id) as max_id FROM ${tableName}`).get() as { max_id: number | null };
  const maxId = currentMax?.max_id || 0;
  return maxId + 1;
}

// ============================================================================
// CRUD Operations for database_connections
// ============================================================================

export interface DatabaseConnection {
  id?: number;
  workspace_id: number;
  name: string;
  type: string;
  config: string;
  schema_json?: string;
  description?: string;
  status?: string;
}

export function createDatabaseConnection(data: DatabaseConnection): number {
  if (!db) throw new Error("Database not initialized");

  const id = generateId("database_connections");
  db.prepare(
    `
    INSERT INTO database_connections 
    (id, workspace_id, name, type, config, schema_json, description, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    data.workspace_id,
    data.name,
    data.type,
    data.config,
    data.schema_json || null,
    data.description || null,
    data.status || "active",
  );

  return id;
}

export function getDatabaseConnection(id: number): DatabaseConnection | undefined {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM database_connections WHERE id = ?").get(id) as DatabaseConnection;
}

export function updateDatabaseConnection(id: number, data: Partial<DatabaseConnection>): void {
  if (!db) throw new Error("Database not initialized");

  const updates: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) {
    updates.push("name = ?");
    values.push(data.name);
  }
  if (data.config !== undefined) {
    updates.push("config = ?");
    values.push(data.config);
  }
  if (data.schema_json !== undefined) {
    updates.push("schema_json = ?");
    values.push(data.schema_json);
  }
  if (data.description !== undefined) {
    updates.push("description = ?");
    values.push(data.description);
  }
  if (data.status !== undefined) {
    updates.push("status = ?");
    values.push(data.status);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE database_connections SET ${updates.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteDatabaseConnection(id: number): void {
  if (!db) throw new Error("Database not initialized");
  db.prepare("DELETE FROM database_connections WHERE id = ?").run(id);
}

export function getDatabaseConnectionsByWorkspace(workspaceId: number): DatabaseConnection[] {
  if (!db) throw new Error("Database not initialized");
  return db
    .prepare("SELECT * FROM database_connections WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as DatabaseConnection[];
}

// ============================================================================
// CRUD Operations for table_explanations
// ============================================================================

export interface TableExplanation {
  id?: number;
  database_connection_id: number;
  schema_name?: string;
  table_name: string;
  explanation?: string;
  business_purpose?: string;
  keywords?: string;
}

export function createTableExplanation(data: TableExplanation): number {
  if (!db) throw new Error("Database not initialized");

  const id = generateId("table_explanations");
  db.prepare(
    `
    INSERT INTO table_explanations 
    (id, database_connection_id, schema_name, table_name, explanation, business_purpose, keywords)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, data.database_connection_id, data.schema_name || null, data.table_name, data.explanation || null, data.business_purpose || null, data.keywords || null);

  return id;
}

export function getTableExplanation(id: number): TableExplanation | undefined {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM table_explanations WHERE id = ?").get(id) as TableExplanation;
}

export function updateTableExplanation(id: number, data: Partial<TableExplanation>): void {
  if (!db) throw new Error("Database not initialized");

  const updates: string[] = [];
  const values: any[] = [];

  if (data.schema_name !== undefined) {
    updates.push("schema_name = ?");
    values.push(data.schema_name);
  }
  if (data.explanation !== undefined) {
    updates.push("explanation = ?");
    values.push(data.explanation);
  }
  if (data.business_purpose !== undefined) {
    updates.push("business_purpose = ?");
    values.push(data.business_purpose);
  }
  if (data.keywords !== undefined) {
    updates.push("keywords = ?");
    values.push(data.keywords);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE table_explanations SET ${updates.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteTableExplanation(id: number): void {
  if (!db) throw new Error("Database not initialized");
  db.prepare("DELETE FROM table_explanations WHERE id = ?").run(id);
}

export function getTableExplanationsByConnection(connectionId: number): TableExplanation[] {
  if (!db) throw new Error("Database not initialized");
  return db
    .prepare("SELECT * FROM table_explanations WHERE database_connection_id = ? ORDER BY table_name")
    .all(connectionId) as TableExplanation[];
}

// ============================================================================
// CRUD Operations for column_explanations
// ============================================================================

export interface ColumnExplanation {
  id?: number;
  table_explanation_id: number;
  column_name: string;
  explanation?: string;
  data_type?: string;
  business_meaning?: string;
  synonyms?: string;
  sensitivity_level?: string;
  sample_values?: string;
}

export function createColumnExplanation(data: ColumnExplanation): number {
  if (!db) throw new Error("Database not initialized");

  const id = generateId("column_explanations");
  db.prepare(
    `
    INSERT INTO column_explanations 
    (id, table_explanation_id, column_name, explanation, data_type, business_meaning, synonyms, sensitivity_level, sample_values)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    data.table_explanation_id,
    data.column_name,
    data.explanation || null,
    data.data_type || null,
    data.business_meaning || null,
    data.synonyms || null,
    data.sensitivity_level || null,
    data.sample_values || null,
  );

  return id;
}

export function getColumnExplanation(id: number): ColumnExplanation | undefined {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM column_explanations WHERE id = ?").get(id) as ColumnExplanation;
}

export function updateColumnExplanation(id: number, data: Partial<ColumnExplanation>): void {
  if (!db) throw new Error("Database not initialized");

  const updates: string[] = [];
  const values: any[] = [];

  const fields: (keyof ColumnExplanation)[] = [
    "explanation",
    "data_type",
    "business_meaning",
    "synonyms",
    "sensitivity_level",
    "sample_values",
  ];

  for (const field of fields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(data[field]);
    }
  }

  if (updates.length === 0) return;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE column_explanations SET ${updates.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteColumnExplanation(id: number): void {
  if (!db) throw new Error("Database not initialized");
  db.prepare("DELETE FROM column_explanations WHERE id = ?").run(id);
}

export function getColumnExplanationsByTable(tableExplanationId: number): ColumnExplanation[] {
  if (!db) throw new Error("Database not initialized");
  return db
    .prepare("SELECT * FROM column_explanations WHERE table_explanation_id = ? ORDER BY column_name")
    .all(tableExplanationId) as ColumnExplanation[];
}

// ============================================================================
// CRUD Operations for sql_examples
// ============================================================================

export interface SqlExample {
  id?: number;
  database_connection_id: number;
  natural_language: string;
  sql_query: string;
  explanation?: string;
  tags?: string;
  tables_involved?: string;
  is_learned?: boolean;
}

export function createSqlExample(data: SqlExample): number {
  if (!db) throw new Error("Database not initialized");

  const id = generateId("sql_examples");
  db.prepare(
    `
    INSERT INTO sql_examples 
    (id, database_connection_id, natural_language, sql_query, explanation, tags, tables_involved, is_learned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    data.database_connection_id,
    data.natural_language,
    data.sql_query,
    data.explanation || null,
    data.tags || null,
    data.tables_involved || null,
    data.is_learned ? 1 : 0,
  );

  return id;
}

export function getSqlExample(id: number): SqlExample | undefined {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM sql_examples WHERE id = ?").get(id) as SqlExample;
}

export function updateSqlExample(id: number, data: Partial<SqlExample>): void {
  if (!db) throw new Error("Database not initialized");

  const updates: string[] = [];
  const values: any[] = [];

  if (data.natural_language !== undefined) {
    updates.push("natural_language = ?");
    values.push(data.natural_language);
  }
  if (data.sql_query !== undefined) {
    updates.push("sql_query = ?");
    values.push(data.sql_query);
  }
  if (data.explanation !== undefined) {
    updates.push("explanation = ?");
    values.push(data.explanation);
  }
  if (data.tables_involved !== undefined) {
    updates.push("tables_involved = ?");
    values.push(data.tables_involved);
  }
  if (data.is_learned !== undefined) {
    updates.push("is_learned = ?");
    values.push(data.is_learned ? 1 : 0);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE sql_examples SET ${updates.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteSqlExample(id: number): void {
  if (!db) throw new Error("Database not initialized");
  db.prepare("DELETE FROM sql_examples WHERE id = ?").run(id);
}

export function getSqlExamplesByConnection(connectionId: number, learnedOnly = false): SqlExample[] {
  if (!db) throw new Error("Database not initialized");

  const query = learnedOnly
    ? "SELECT * FROM sql_examples WHERE database_connection_id = ? AND is_learned = 1 ORDER BY created_at DESC"
    : "SELECT * FROM sql_examples WHERE database_connection_id = ? ORDER BY created_at DESC";

  return db.prepare(query).all(connectionId) as SqlExample[];
}

// ============================================================================
// CRUD Operations for ai_agents
// ============================================================================

export interface AiAgent {
  id?: number;
  name: string;
  provider: string;
  model?: string;
  api_key?: string;
  api_base_url: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  is_default?: boolean;
  is_active?: boolean;
}

export function createAiAgent(data: AiAgent): number {
  if (!db) throw new Error("Database not initialized");

  const id = generateId("ai_agents");
  db.prepare(
    `
    INSERT INTO ai_agents 
    (id, name, provider, model, api_key, api_base_url, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, is_default, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    data.name,
    data.provider,
    data.model || null,
    data.api_key || null,
    data.api_base_url,
    data.temperature || 0.7,
    data.max_tokens || 2000,
    data.top_p || 1.0,
    data.frequency_penalty || 0.0,
    data.presence_penalty || 0.0,
    data.is_default ? 1 : 0,
    data.is_active !== false ? 1 : 0,
  );

  return id;
}

export function getAiAgent(id: number): AiAgent | undefined {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM ai_agents WHERE id = ?").get(id) as AiAgent;
}

export function getAiAgentByName(name: string): AiAgent | undefined {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM ai_agents WHERE name = ?").get(name) as AiAgent;
}

export function updateAiAgent(id: number, data: Partial<AiAgent>): void {
  if (!db) throw new Error("Database not initialized");

  const updates: string[] = [];
  const values: any[] = [];

  const fields: (keyof AiAgent)[] = [
    "name",
    "provider",
    "model",
    "api_key",
    "api_base_url",
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "is_default",
    "is_active",
  ];

  for (const field of fields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(typeof data[field] === "boolean" ? (data[field] ? 1 : 0) : data[field]);
    }
  }

  if (updates.length === 0) return;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE ai_agents SET ${updates.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteAiAgent(id: number): void {
  if (!db) throw new Error("Database not initialized");
  db.prepare("DELETE FROM ai_agents WHERE id = ?").run(id);
}

export function getAllAiAgents(): AiAgent[] {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM ai_agents WHERE is_active = 1 ORDER BY is_default DESC, created_at DESC").all() as AiAgent[];
}

export function getDefaultAiAgent(): AiAgent | undefined {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM ai_agents WHERE is_default = 1 AND is_active = 1 LIMIT 1").get() as AiAgent;
}

export function updateAiAgentLastUsed(id: number): void {
  if (!db) throw new Error("Database not initialized");
  db.prepare("UPDATE ai_agents SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

// ============================================================================
// Helper functions
// ============================================================================

export function getDefaultWorkspace() {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM workspaces WHERE name = 'default' LIMIT 1").get();
}

export function getDefaultUser() {
  if (!db) throw new Error("Database not initialized");
  return db.prepare("SELECT * FROM users WHERE email = 'system@example.com' LIMIT 1").get();
}
