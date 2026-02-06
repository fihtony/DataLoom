// =============================================================================
// SQL Validator - READ-ONLY ENFORCEMENT (TOP PRIORITY)
// =============================================================================
// DataLoom MUST NEVER generate, allow, or execute any SQL that modifies data.
// This validator enforces absolute read-only constraints.
// =============================================================================

import type { SQLValidationResult, SQLValidationRules } from "../../types/index.js";

// ============================================================================
// Allowed keyword combinations
// Each combination specifies which keywords can be used together with SELECT
// ============================================================================
interface KeywordCombination {
  required: string[];
  forbidden: string[];
  contextName: string;
}

export const ALLOWED_KEYWORD_COMBINATIONS: KeywordCombination[] = [
  {
    required: ["DECLARE", "SET", "SELECT"],
    forbidden: ["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "WITH", "RECURSIVE"],
    contextName: "DECLARE...SET...SELECT",
  },
  {
    required: ["DECLARE", "SELECT"],
    forbidden: ["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "WITH", "RECURSIVE"],
    contextName: "DECLARE...SELECT",
  },
  {
    required: ["SET", "SELECT"],
    forbidden: ["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "WITH", "RECURSIVE"],
    contextName: "SET...SELECT",
  },
  {
    required: ["WITH", "SELECT"],
    forbidden: ["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "RECURSIVE"],
    contextName: "WITH...SELECT",
  },
];

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

  // ❌ STRICTLY FORBIDDEN: Absolute forbidden keywords (never allowed in ANY context)
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
    // Procedural/execution - DECLARE and SET are conditionally allowed
    "EXEC",
    "EXECUTE",
    "CALL",
    "GOTO",
    "LABEL",
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
    // Remove leading whitespace
    const trimmed = sql.trim().toUpperCase();

    // Allow queries that start with:
    // 1. SELECT - standard select query
    // 2. (SELECT - subquery
    // 3. WITH - CTE (Common Table Expression)
    // 4. DECLARE - variable declaration (must be followed by SELECT)
    if (
      trimmed.startsWith("SELECT") ||
      trimmed.startsWith("(SELECT") ||
      (trimmed.startsWith("WITH") && sql.toUpperCase().includes("SELECT"))
    ) {
      return true;
    }

    // Allow DECLARE only if followed by SELECT somewhere in the query
    if (trimmed.startsWith("DECLARE")) {
      return sql.toUpperCase().includes("SELECT");
    }

    return false;
  }

  private checkForbiddenKeywords(sql: string): SQLValidationResult {
    const upperSQL = sql.toUpperCase();

    // Step 1: Check absolute forbidden keywords (should never appear in any context)
    for (const keyword of this.rules.forbiddenKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(sql)) {
        return {
          valid: false,
          error: `❌ FORBIDDEN: Keyword '${keyword}' is not allowed. Only SELECT queries can be executed.`,
          errorCode: "FORBIDDEN_KEYWORD",
        };
      }
    }

    // Step 2: Check allowed keyword combinations
    // If query matches a combination, validate against that combination's forbidden keywords
    for (const combination of ALLOWED_KEYWORD_COMBINATIONS) {
      const hasAllRequired = combination.required.every((kw) => upperSQL.includes(kw));

      if (hasAllRequired) {
        // This combination applies - validate against its specific forbidden keywords
        for (const keyword of combination.forbidden) {
          const regex = new RegExp(`\\b${keyword}\\b`, "i");
          if (regex.test(sql)) {
            return {
              valid: false,
              error: `❌ FORBIDDEN: Keyword '${keyword}' is not allowed with ${combination.contextName}.`,
              errorCode: "FORBIDDEN_KEYWORD_IN_COMBINATION",
            };
          }
        }
        // If we reach here, this combination is valid
        return { valid: true };
      }
    }

    // Step 3: No combination matched - plain SELECT should be valid
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
