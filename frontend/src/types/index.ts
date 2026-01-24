// =============================================================================
// Type Definitions - Shared with Backend
// =============================================================================

// Database types
export type DatabaseType = "sqlite" | "postgresql" | "mssql";

export interface DatabaseConnection {
  id: number;
  workspace_id?: number;
  name: string;
  type: DatabaseType;
  config: string | Record<string, unknown>;
  schema_json?: string;
  description?: string;
  status?: "connected" | "disconnected" | "error" | "active";
  last_tested_at?: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

// AI Agent types
export interface AIAgent {
  id: number;
  name: string;
  provider: string;
  model?: string;
  api_key?: string;
  api_base_url: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  is_default: number;
  is_active: number;
  last_used_at?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  rowCount?: number;
  schema?: string; // For PostgreSQL/SQL Server schema name
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  foreignKey?: {
    table: string;
    column: string;
  };
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
}

export interface ColumnAnnotation {
  id: number;
  connectionId: number;
  tableName: string;
  columnName: string;
  description?: string;
  semanticType?: string;
  sampleValues?: string[];
  businessMeaning?: string;
}

export interface SQLExample {
  id: number;
  connectionId: number;
  naturalLanguage: string;
  sql: string;
  description?: string;
  tags?: string[];
}

export interface RelationshipAnnotation {
  id: number;
  connectionId: number;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  description?: string;
}

// Query types
export interface QueryResult {
  success: boolean;
  sql?: string;
  data?: Record<string, unknown>[];
  columns?: { name: string; type: string }[];
  rowCount?: number;
  executionTimeMs?: number;
  visualization?: VisualizationConfig;
  explanation?: string;
  error?: string;
  errorCode?: string;
}

export interface VisualizationConfig {
  recommended: ChartType;
  alternatives: ChartType[];
  config: ChartConfig;
}

export type ChartType = "kpi" | "bar" | "line" | "pie" | "area" | "scatter" | "table";

export interface ChartConfig {
  xAxis?: string;
  yAxis?: string | string[];
  groupBy?: string;
  title?: string;
  colors?: string[];
}

// Chat types
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sql?: string;
  result?: QueryResult;
  timestamp: string;
  isLoading?: boolean;
  queryResult?: {
    sql?: string;
    data?: any[];
    columns?: any[];
    rowCount?: number;
    visualization?: {
      type?: "table" | "bar" | "pie" | "line";
      xAxis?: string;
      yAxis?: string;
      title?: string;
    };
  };
}

export interface AIModel {
  id: string;
  name: string;
  vendor: string;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
