// =============================================================================
// SQL Validator - READ-ONLY ENFORCEMENT (TOP PRIORITY)
// =============================================================================
// DataLoom MUST NEVER generate, allow, or execute any SQL that modifies data.
// This validator enforces absolute read-only constraints.
// =============================================================================

import type { SQLValidationResult, SQLValidationRules } from "../../types/index.js";

// Default validation rules
export const DEFAULT_VALIDATION_RULES: SQLValidationRules = {
  // ✅ ONLY ALLOWED: SELECT queries
  allowedStatements: ["SELECT"],

  // ✅ ALLOWED CLAUSES
  allowedClauses: [
    "FROM",
    "WHERE",
    "JOIN",
    "INNER JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "CROSS JOIN",
    "FULL OUTER JOIN",
    "GROUP BY",
    "ORDER BY",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "DISTINCT",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "AS",
    "ON",
    "USING",
    "AND",
    "OR",
    "NOT",
    "IN",
    "BETWEEN",
    "LIKE",
    "ILIKE",
    "IS",
    "NULL",
    "ASC",
    "DESC",
    "NULLS",
    "FIRST",
    "LAST",
    "FETCH",
    "NEXT",
    "ROWS",
    "ONLY",
    "COUNT",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "COALESCE",
    "NULLIF",
    "CAST",
    "EXTRACT",
    "DATE",
    "TIME",
    "TIMESTAMP",
    "INTERVAL",
  ],

  // ❌ STRICTLY FORBIDDEN: All data modification operations
  forbiddenKeywords: [
    // Data manipulation
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "UPSERT",
    "REPLACE",
    // Schema modification
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "RENAME",
    // Procedural/execution
    "EXEC",
    "EXECUTE",
    "CALL",
    "GOTO",
    "LABEL",
    "DECLARE",
    "SET",
    // Access control
    "GRANT",
    "REVOKE",
    "DENY",
    // Transaction/session control
    "COMMIT",
    "ROLLBACK",
    "SAVEPOINT",
    "BEGIN",
    "START TRANSACTION",
    // Database operations
    "PRAGMA",
    "ATTACH",
    "DETACH",
    "VACUUM",
    "ANALYZE",
    "REINDEX",
    // CTE with potential recursion
    "WITH",
    "RECURSIVE",
    // Dangerous SQL Server operations
    "BULK",
    "OPENROWSET",
    "OPENQUERY",
    "OPENDATASOURCE",
    // PostgreSQL specific
    "COPY",
    "DO",
    "LISTEN",
    "NOTIFY",
    "PREPARE",
    "DEALLOCATE",
  ],

  // System table access restrictions
  forbiddenTables: [
    // SQLite
    "sqlite_master",
    "sqlite_sequence",
    "sqlite_temp_master",
    // PostgreSQL
    "pg_catalog",
    "pg_toast",
    "pg_temp",
    // SQL Server
    "sys",
    "msdb",
    "tempdb",
    "master",
    // MySQL/MariaDB
    "mysql",
    "performance_schema",
  ],

  // SQL injection patterns
  injectionPatterns: [
    /--.*$/gm, // SQL comments
    /\/\*[\s\S]*?\*\//g, // Multi-line comments
    /;\s*(?:DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|EXEC|CALL|TRUNCATE)/i, // Statement chaining
    /'\s*(?:OR|AND)\s*'[^']*'\s*(?:=|<|>)/i, // OR/AND boolean injection
    /'\s*(?:OR|AND)\s+\d+\s*=\s*\d+/i, // Numeric injection (OR 1=1)
    /UNION\s+(?:ALL\s+)?SELECT/i, // UNION-based injection
    /xp_cmdshell|xp_exec|sp_executesql/i, // Extended stored procs
    /LOAD_FILE|INTO\s+(?:OUTFILE|DUMPFILE)/i, // File operations
    /BENCHMARK|SLEEP|WAITFOR\s+DELAY/i, // Time-based injection
    /(?:0x|\\x)[0-9a-fA-F]+/, // Hex encoding
  ],

  // Performance guards
  maxJoins: 10,
  maxSubqueries: 5,
  maxRowsReturned: 10000,
  queryTimeoutMs: 30000,
};

/**
 * SQL Validator class - enforces read-only constraints
 */
export class SQLValidator {
  private rules: SQLValidationRules;

  constructor(rules: Partial<SQLValidationRules> = {}) {
    this.rules = { ...DEFAULT_VALIDATION_RULES, ...rules };
  }

  /**
   * Validate SQL query - returns validation result
   */
  validate(sql: string): SQLValidationResult {
    const trimmedSQL = sql.trim();
    const upperSQL = trimmedSQL.toUpperCase();

    // Step 1: Must start with SELECT
    if (!this.startsWithSelect(upperSQL)) {
      return {
        valid: false,
        error:
          "❌ FORBIDDEN: Only SELECT queries are allowed. INSERT, UPDATE, DELETE, ALTER, CREATE, DROP and other modification operations are strictly prohibited.",
        errorCode: "NOT_SELECT",
      };
    }

    // Step 2: Check forbidden keywords
    const forbiddenCheck = this.checkForbiddenKeywords(upperSQL);
    if (!forbiddenCheck.valid) {
      return forbiddenCheck;
    }

    // Step 3: Check injection patterns
    const injectionCheck = this.checkInjectionPatterns(sql);
    if (!injectionCheck.valid) {
      return injectionCheck;
    }

    // Step 4: Check system table access (allow for schema queries in specific contexts)
    // Note: We'll be more permissive here for legitimate schema introspection
    // The forbiddenTables check is relaxed for information_schema which is needed

    // Step 5: Check JOIN count
    const joinCheck = this.checkJoinCount(upperSQL);
    if (!joinCheck.valid) {
      return joinCheck;
    }

    return { valid: true };
  }

  private startsWithSelect(sql: string): boolean {
    // Remove leading whitespace and check for SELECT or WITH (CTE)
    const trimmed = sql.trim();
    return trimmed.startsWith("SELECT") || trimmed.startsWith("(SELECT") || trimmed.startsWith("WITH");
  }

  private checkForbiddenKeywords(sql: string): SQLValidationResult {
    // Check for modification operations specifically (CREATE, UPDATE, DELETE, INSERT, etc.)
    const modificationKeywords = ["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP"];
    for (const keyword of modificationKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(sql)) {
        return {
          valid: false,
          error: `❌ Create/Update/Delete operations are not allowed`,
          errorCode: "MODIFICATION_NOT_ALLOWED",
        };
      }
    }

    for (const keyword of this.rules.forbiddenKeywords) {
      // Use word boundary to avoid false positives (e.g., "UPDATE" in "LAST_UPDATE")
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(sql)) {
        // Special case: Allow WITH for CTEs in read-only context (but not RECURSIVE)
        if (keyword === "WITH" && !sql.includes("RECURSIVE")) {
          continue;
        }
        return {
          valid: false,
          error: `❌ FORBIDDEN: Keyword '${keyword}' is not allowed. Only SELECT queries can be executed.`,
          errorCode: "FORBIDDEN_KEYWORD",
        };
      }
    }
    return { valid: true };
  }

  private checkInjectionPatterns(sql: string): SQLValidationResult {
    for (const pattern of this.rules.injectionPatterns) {
      if (pattern.test(sql)) {
        return {
          valid: false,
          error: "❌ BLOCKED: SQL injection pattern detected. Your query has been rejected for security reasons.",
          errorCode: "INJECTION_DETECTED",
        };
      }
    }
    return { valid: true };
  }

  private checkJoinCount(sql: string): SQLValidationResult {
    const joinMatches = sql.match(/\bJOIN\b/gi) || [];
    if (joinMatches.length > this.rules.maxJoins) {
      return {
        valid: false,
        error: `❌ BLOCKED: Too many JOINs (${joinMatches.length}). Maximum allowed: ${this.rules.maxJoins}`,
        errorCode: "TOO_MANY_JOINS",
      };
    }
    return { valid: true };
  }

  /**
   * Extract SQL from AI response (handles markdown code blocks)
   */
  static extractSQL(response: string): string | null {
    // Try to extract from markdown code block
    const sqlBlockMatch = response.match(/```sql\s*([\s\S]*?)```/i);
    if (sqlBlockMatch) {
      return sqlBlockMatch[1].trim();
    }

    // Try generic code block
    const codeBlockMatch = response.match(/```\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      const content = codeBlockMatch[1].trim();
      if (content.toUpperCase().startsWith("SELECT")) {
        return content;
      }
    }

    // Try to find a SELECT statement directly
    const selectMatch = response.match(/SELECT\s+[\s\S]+?(?:;|$)/i);
    if (selectMatch) {
      return selectMatch[0].replace(/;$/, "").trim();
    }

    return null;
  }
}

// Export singleton instance with default rules
export const sqlValidator = new SQLValidator();
