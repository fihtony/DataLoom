// =============================================================================
// DataLoom Type Definitions
// =============================================================================

// Database connection types
export type DatabaseType = "sqlite" | "postgresql" | "sqlserver" | "mssql";

export interface DatabaseConnection {
  id: number;
  name: string;
  type: DatabaseType;
  config: DatabaseConfig;
  createdAt: string;
  updatedAt: string;
  status?: "connected" | "disconnected" | "error";
  readOnlyStatus?: "readonly" | "readwrite" | "unknown"; // Connection read-only status
}

export interface DatabaseConfig {
  // SQLite
  path?: string;

  // PostgreSQL / SQL Server
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;

  // Common
  readonly?: boolean;
  connectionTimeout?: number;
}

// Schema types
export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey?: string[];
  foreignKeys?: ForeignKey[];
  indexes?: string[];
  rowCount?: number;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  references?: { table: string; column: string };
}

export interface ForeignKey {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

export interface DatabaseSchema {
  connectionId: number;
  tables: TableSchema[];
  fetchedAt: string;
}

// Annotation types
export interface TableAnnotation {
  id: number;
  connectionId: number;
  tableName: string;
  description?: string;
  businessPurpose?: string;
  keywords?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ColumnAnnotation {
  id: number;
  connectionId: number;
  tableName: string;
  columnName: string;
  description?: string;
  businessMeaning?: string;
  synonyms?: string[];
  sensitivityLevel?: "LOW" | "MEDIUM" | "HIGH";
  sampleValues?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SQLExample {
  id: number;
  connectionId: number;
  naturalLanguage: string;
  sqlQuery: string;
  description?: string;
  tags?: string[];
  tables?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipAnnotation {
  id: number;
  connectionId: number;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: "one-to-one" | "one-to-many" | "many-to-many";
  description?: string;
  createdAt: string;
}

// Query types
export interface QueryRequest {
  connectionId: number;
  naturalLanguage: string;
  model?: AIModelConfig;
}

export interface ColumnInfo {
  name: string; // Friendly/display name for UI
  key: string; // Actual column key from data
  type: string; // Data type (INTEGER, TEXT, etc.)
}

export interface QueryResult {
  success: boolean;
  sql?: string;
  data?: Record<string, unknown>[];
  columns?: ColumnInfo[];
  rowCount?: number;
  executionTimeMs?: number;
  visualization?: VisualizationConfig;
  error?: string;
  errorCode?: string;
}

export interface LegendItem {
  name: string; // Display name for UI
  key: string; // Data column key for mapping
  color: string; // Color for visualization
  description: string; // Description/tooltip
}

export interface VisualizationConfig {
  type: ChartType; // Primary chart type recommendation
  alternatives?: ChartType[]; // Alternative chart types
  xAxis?: string; // X-axis column name (for axis-based charts)
  yAxis?: string | string[]; // Y-axis column(s) (for axis-based charts)
  groupBy?: string; // Group-by column (for pie/grouped charts)
  title?: string; // Chart title
  xAxisLabel?: string; // X-axis label
  yAxisLabel?: string; // Y-axis label
  legend?: LegendItem[]; // Legend with key field for data mapping
}

export type ChartType = "kpi" | "bar" | "line" | "pie" | "area" | "scatter" | "table";

// AI/CopilotBridge types
export interface AIModelConfig {
  id: string;
  name: string;
  vendor: string;
}

export interface CopilotRequest {
  prompt: string;
  context?: string;
  model?: AIModelConfig;
  timeout?: number;
  maxToken?: number; // Max tokens from AI agent settings
  sessionId?: string; // Optional session ID for session-based chat
}

export interface CopilotResponse {
  success: boolean;
  response?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

// SQL Validation types
export interface SQLValidationResult {
  valid: boolean;
  error?: string;
  errorCode?:
    | "NOT_SELECT"
    | "FORBIDDEN_KEYWORD"
    | "FORBIDDEN_KEYWORD_IN_COMBINATION"
    | "INJECTION_DETECTED"
    | "SYSTEM_TABLE"
    | "TOO_MANY_JOINS"
    | "MODIFICATION_NOT_ALLOWED";
}

export interface SQLValidationRules {
  allowedStatements: string[];
  allowedClauses: string[];
  forbiddenKeywords: string[];
  forbiddenTables: string[];
  injectionPatterns: RegExp[];
  maxJoins: number;
  maxSubqueries: number;
  maxRowsReturned: number;
  queryTimeoutMs: number;
}

// API Response types
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  timestamp: string;
}

// Session types
export interface ChatSession {
  id: string;
  connectionId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql?: string;
  data?: Record<string, unknown>[];
  visualization?: VisualizationConfig;
  timestamp: string;
}
