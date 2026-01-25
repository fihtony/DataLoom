#!/usr/bin/env node
// =============================================================================
// Database Initialization Command
// =============================================================================
// This script initializes the DataLoom database with:
// - Tables and schemas
// - Indexes
// - Default data (system user, default workspace, AI agents)
//
// Usage: npm run db:init
//

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "dataloom.db");

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log(" Initializing DataLoom database...");

// Create all tables
console.log(" Creating tables...");
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
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
    schema_name TEXT,
    table_name TEXT NOT NULL,
    explanation TEXT,
    business_purpose TEXT,
    keywords TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(database_connection_id) REFERENCES database_connections(id) ON DELETE CASCADE,
    UNIQUE(database_connection_id, schema_name, table_name)
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
    temperature REAL DEFAULT 0.1,
    max_tokens INT DEFAULT 6000,
    top_p REAL DEFAULT 0.9,
    frequency_penalty REAL DEFAULT 0.0,
    presence_penalty REAL DEFAULT 0.0,
    is_default BOOLEAN DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    last_used_at DATETIME,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
console.log(" Tables created");

// Create indexes
console.log(" Creating indexes...");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
  CREATE INDEX IF NOT EXISTS idx_database_connections_workspace_id ON database_connections(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_table_explanations_connection_id ON table_explanations(database_connection_id);
  CREATE INDEX IF NOT EXISTS idx_column_explanations_table_explanation_id ON column_explanations(table_explanation_id);
  CREATE INDEX IF NOT EXISTS idx_sql_examples_connection_id ON sql_examples(database_connection_id);
`);
console.log(" Indexes created");

// Insert default data
console.log(" Seeding default data...");

// Check if default user exists
const existingUser = db.prepare("SELECT * FROM users WHERE id = ?").get(1) as any;

if (!existingUser) {
  // Insert default user
  db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(1, "System", "system@example.com");
  console.log("  Created default user: System (system@example.com)");

  // Insert default workspace
  db.prepare("INSERT INTO workspaces (id, user_id, name) VALUES (?, ?, ?)").run(1, 1, "default");
  console.log("  Created default workspace: default");

  // Insert default Copilot agent
  db.prepare(
    `
    INSERT INTO ai_agents (id, name, provider, model, api_base_url, is_default, temperature, max_tokens, top_p)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(1, "Copilot", "copilot", "gpt-5-mini", "http://localhost:1287", 1, 0.1, 6000, 0.9);
  console.log("  Created default AI agent: Copilot");
} else {
  console.log("  Default user already exists, skipping seed data");
}

db.close();

console.log("\n Database initialization completed successfully!");
console.log(` Database path: ${dbPath}`);
