// =============================================================================
// Query Helper - Convert natural language to SQL for common patterns
// =============================================================================

import type { DatabaseSchema } from "../types";

export class QueryHelper {
  static convertToSQL(naturalLanguage: string, schema?: DatabaseSchema): string | null {
    const text = naturalLanguage.toLowerCase().trim();
    const tables = schema?.tables.map((t) => t.name) || [];

    // Count records by table pattern: "count records by table"
    if (text.includes("count") && text.includes("table")) {
      if (tables.length > 0) {
        return `-- Count records by table
${tables.map((table) => `SELECT '${table}' as table_name, COUNT(*) as record_count FROM ${table}`).join("\nUNION ALL\n")}
ORDER BY record_count DESC;`;
      }
    }

    // Count records pattern: "count records", "how many records", etc.
    if ((text.includes("count") && text.includes("records")) || text.includes("how many records")) {
      if (schema?.tables.length === 1) {
        return `SELECT COUNT(*) as total_records FROM ${schema.tables[0].name};`;
      }
    }

    // Recent records pattern: "recent", "latest", "new"
    if ((text.includes("recent") || text.includes("latest") || text.includes("new")) && text.includes("records")) {
      const tables = schema?.tables || [];
      // Find table with timestamp or id column
      for (const table of tables) {
        const timeCol = table.columns.find((c) => c.name.includes("created") || c.name.includes("updated") || c.name.includes("timestamp"));
        if (timeCol) {
          return `SELECT * FROM ${table.name} ORDER BY ${timeCol.name} DESC LIMIT 10;`;
        }
      }
    }

    // Show all pattern: "show me all", "list all"
    if (text.includes("show") || text.includes("list all")) {
      if (schema?.tables.length === 1) {
        return `SELECT * FROM ${schema.tables[0].name} LIMIT 100;`;
      }
    }

    return null;
  }

  static getExampleQueries(): Array<{ label: string; query: string }> {
    return [
      { label: "Count records by table", query: "Show me count records by table" },
      { label: "Show recent users", query: "Show me recent users" },
      { label: "Total records", query: "How many records total?" },
      { label: "List all sessions", query: "List all sessions" },
    ];
  }
}
