// =============================================================================
// Query Executor - Validates and executes SQL queries
// =============================================================================

import { SQLValidator, DEFAULT_VALIDATION_RULES } from "./sqlValidator.js";
import { executeQuery, getConnection } from "./connectionManager.js";
import type { QueryResult, VisualizationConfig, ChartType, LegendItem } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

const sqlValidator = new SQLValidator();

// Lenient validator for system-generated queries (allows UNION)
const lenientValidator = new SQLValidator({
  injectionPatterns: DEFAULT_VALIDATION_RULES.injectionPatterns.filter((pattern) => !pattern.toString().includes("UNION")),
});

/**
 * Execute a SQL query with validation
 */
export async function executeSafeQuery(connectionId: number, sql: string, isTrusted: boolean = false): Promise<QueryResult> {
  const startTime = Date.now();

  // Step 1: Validate SQL (READ-ONLY ENFORCEMENT)
  let validation = sqlValidator.validate(sql);

  // For trusted queries (system-generated), try lenient validation if strict fails
  if (!validation.valid && isTrusted) {
    validation = lenientValidator.validate(sql);
  }

  if (!validation.valid) {
    logger.warn(`[SECURITY] Query blocked: ${validation.error}`, {
      sql: sql.substring(0, 100),
      errorCode: validation.errorCode,
    });
    return {
      success: false,
      error: validation.error,
      errorCode: validation.errorCode,
    };
  }

  // Step 2: Check connection exists
  const connection = getConnection(connectionId);
  if (!connection) {
    return {
      success: false,
      error: `Connection not found: ${connectionId}`,
      errorCode: "CONNECTION_NOT_FOUND",
    };
  }

  // Step 3: Execute query
  try {
    const { rows, columns } = await executeQuery(connectionId, sql);
    const executionTimeMs = Date.now() - startTime;

    // Step 4: Generate visualization recommendation
    const visualization = recommendVisualization(rows, columns);

    return {
      success: true,
      sql,
      data: rows,
      columns,
      rowCount: rows.length,
      executionTimeMs,
      visualization,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Query execution failed: ${errorMessage}`, { sql: sql.substring(0, 200) });

    // Check for common SQLite errors
    if (errorMessage.includes("named parameters")) {
      return {
        success: false,
        sql,
        error: `Query execution failed: The generated SQL contains unnamed parameters. Please try a different query.`,
        errorCode: "INVALID_SQL_PARAMETERS",
      };
    }

    return {
      success: false,
      sql,
      error: `Query execution failed: ${errorMessage}`,
      errorCode: "EXECUTION_ERROR",
    };
  }
}

/**
 * Recommend visualization based on query results
 */
function recommendVisualization(
  rows: Record<string, unknown>[],
  columns: Array<{ name: string; key: string; type: string }>,
): VisualizationConfig {
  const rowCount = rows.length;
  const columnCount = columns.length;

  // Default to table
  let type: ChartType = "table";
  const alternatives: ChartType[] = [];
  let xAxis: string | undefined;
  let yAxis: string | string[] | undefined;
  let groupBy: string | undefined;
  let title: string | undefined;

  if (rowCount === 0) {
    return {
      type: "table",
      alternatives: [],
      title: "No data",
    };
  }

  // Single value (KPI)
  if (rowCount === 1 && columnCount === 1) {
    type = "kpi";
    alternatives.push("table");
    title = columns[0]?.name || "KPI";
  }
  // Single row with multiple columns (KPI cards)
  else if (rowCount === 1 && columnCount <= 5) {
    type = "kpi";
    alternatives.push("table", "bar");
    title = "Key Performance Indicators";
  }
  // Multiple rows
  else if (rowCount > 1) {
    const firstRow = rows[0];
    const colNames = Object.keys(firstRow);

    // Detect column types
    const numericColumns: string[] = [];
    const categoryColumns: string[] = [];
    const dateColumns: string[] = [];

    for (const colName of colNames) {
      const sampleValue = firstRow[colName];

      if (typeof sampleValue === "number") {
        numericColumns.push(colName);
      } else if (sampleValue instanceof Date || isDateString(sampleValue)) {
        dateColumns.push(colName);
      } else {
        categoryColumns.push(colName);
      }
    }

    // Time series: date + numeric
    if (dateColumns.length >= 1 && numericColumns.length >= 1) {
      type = "line";
      alternatives.push("area", "bar", "table");
    }
    // Category + numeric: bar/pie
    else if (categoryColumns.length >= 1 && numericColumns.length >= 1) {
      if (rowCount <= 10) {
        type = "pie";
        alternatives.push("bar", "table");
      } else {
        type = "bar";
        alternatives.push("table");
      }
    }
    // Multiple numerics: scatter
    else if (numericColumns.length >= 2) {
      type = "scatter";
      alternatives.push("line", "bar", "table");
    }
    // Default
    else {
      type = "table";
      if (rowCount <= 20) {
        alternatives.push("bar");
      }
    }
  }

  // Build axis and groupBy configuration based on chart type
  const colKeys = columns.map((c) => c.key);
  const axisBasedCharts: ChartType[] = ["bar", "line", "area"];

  if (axisBasedCharts.includes(type)) {
    // First column as X axis, rest as Y
    if (colKeys.length >= 2) {
      xAxis = colKeys[0];
      yAxis = colKeys.slice(1).length === 1 ? colKeys[1] : colKeys.slice(1);
    }
  } else if (type === "pie") {
    if (colKeys.length >= 2) {
      groupBy = colKeys[0];
      yAxis = colKeys[1];
    }
  }

  // Generate legend with explicit key field for data mapping
  const legend = generateLegendWithKeys(columns, { yAxis, xAxis, groupBy });

  return {
    type,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    xAxis,
    yAxis,
    groupBy,
    title: title || "Chart",
    legend: legend.length > 0 ? legend : undefined,
  };
}

/**
 * Generate legend items with explicit key field for UI data mapping
 * @param columns Column definitions
 * @param config Chart configuration with yAxis
 * @returns Array of legend items with name, key, color, and description
 */
function generateLegendWithKeys(
  columns: Array<{ name: string; key: string; type: string }>,
  config: { yAxis?: string | string[]; xAxis?: string; groupBy?: string },
): LegendItem[] {
  const predefinedColors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

  const legend: LegendItem[] = [];

  // Get Y-axis keys from config
  const yAxisKeys = Array.isArray(config.yAxis) ? config.yAxis : config.yAxis ? [config.yAxis] : [];

  // Generate legend item for each Y-axis column
  for (let i = 0; i < yAxisKeys.length; i++) {
    const columnKey = yAxisKeys[i];
    const column = columns.find((c) => c.key === columnKey);

    if (column) {
      legend.push({
        name: column.name, // Use the friendly display name from column
        key: columnKey, // Explicit mapping to data column
        color: predefinedColors[i % predefinedColors.length],
        description: `${column.type} column: ${columnKey}`,
      });
    }
  }

  return legend;
}

/**
 * Check if value is a date string
 */
function isDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;

  // ISO date patterns
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}/, // MM/DD/YYYY
    /^\d{4}\/\d{2}\/\d{2}/, // YYYY/MM/DD
  ];

  return datePatterns.some((p) => p.test(value));
}
