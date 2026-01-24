// =============================================================================
// Chart Utilities
// =============================================================================

/**
 * Extended legend item type with optional key field for data mapping
 */
export interface LegendItem {
  name: string;
  key?: string; // Optional: maps to actual data column name
  color: string;
  description: string;
}

/**
 * Find legend item by key with case-insensitive matching
 * Handles both regular keys and grouped keys like "requests_success"
 * First tries to match by explicit "key" field, then falls back to case-insensitive name matching
 * For grouped keys, extracts the group value (suffix after last underscore) and matches against legend name
 * @param legend Array of legend items
 * @param key The key to search for (can be "requests" or "requests_success")
 * @returns The matching legend item or undefined
 */
export function findLegendItem(legend: LegendItem[] | undefined, key: string): LegendItem | undefined {
  if (!legend || !Array.isArray(legend)) {
    return undefined;
  }

  // First: Try exact "key" field match
  const exactKeyMatch = legend.find((l) => l.key === key);
  if (exactKeyMatch) {
    return exactKeyMatch;
  }

  // Handle grouped keys like "requests_success" -> match "success" in legend
  // Split by underscore and try last part as potential group value
  if (key.includes("_")) {
    const parts = key.split("_");
    const potentialGroupValue = parts[parts.length - 1];

    // Try to match legend name/key with the group value
    const groupMatch = legend.find(
      (l) => l.name.toLowerCase() === potentialGroupValue.toLowerCase() || l.key?.toLowerCase() === potentialGroupValue.toLowerCase(),
    );
    if (groupMatch) {
      return groupMatch;
    }
  }

  // Fallback: Case-insensitive name matching
  const lowerKey = key.toLowerCase();
  const nameMatch = legend.find((l) => l.name.toLowerCase() === lowerKey);
  if (nameMatch) {
    return nameMatch;
  }

  // Final fallback: Try case-insensitive key field matching
  return legend.find((l) => l.key?.toLowerCase() === lowerKey);
}
/**
 * Find actual data key in object with case-insensitive matching
 * Useful when data keys might have different case than expected
 * @param obj The data object
 * @param key The key to search for
 * @returns The actual key if found, otherwise the original key
 */
export function getActualDataKey(obj: Record<string, any> | undefined, key: string | undefined): string {
  if (!obj || !key) return key || "";

  const lowerKey = key.toLowerCase();
  const actualKey = Object.keys(obj).find((k) => k.toLowerCase() === lowerKey);
  return actualKey || key;
}

/**
 * Get value from object with case-insensitive key lookup
 * @param obj The data object
 * @param key The key to search for
 * @returns The value if found, otherwise undefined
 */
export function getCaseInsensitiveValue(obj: Record<string, any> | undefined, key: string | undefined): any {
  if (!obj || !key) return undefined;

  const actualKey = getActualDataKey(obj, key);
  return obj[actualKey];
}

/**
 * Detect Y-axis keys from columns and legend
 * Intelligently maps legend items to actual data column names with multiple fallback strategies
 * Strategy 1: Use explicit "key" field if provided (NEW)
 * Strategy 2: Case-insensitive match legend name to column name
 * Strategy 3: Use explicit yAxis parameter
 * Strategy 4: Auto-detect numeric columns
 * @param columns Array of column definitions
 * @param legend Array of legend items
 * @param yAxis Primary Y-axis key (fallback)
 * @returns Array of actual column names to use as Y-axes
 */
export function detectYAxisKeys(
  columns: Array<{ name: string; key?: string; type: string }> | undefined,
  legend: LegendItem[] | undefined,
  yAxis: string | undefined,
): string[] {
  if (!columns || columns.length === 0) return [];

  // Strategy 1 & 2: If legend exists, try to map legend items to column names
  if (legend && legend.length > 0) {
    const detectedKeys: string[] = [];

    for (const legendItem of legend) {
      // Strategy 1: Try explicit "key" field first (NEW)
      if (legendItem.key) {
        const matchedColumn = columns.find((col) => col.key === legendItem.key || col.name === legendItem.key);
        if (matchedColumn) {
          detectedKeys.push(matchedColumn.key || matchedColumn.name);
          continue;
        }
      }

      // Strategy 2: Fallback to case-insensitive legend name matching
      const matchedColumn = columns.find(
        (col) => col.name.toLowerCase() === legendItem.name.toLowerCase() || col.key?.toLowerCase() === legendItem.name.toLowerCase(),
      );
      if (matchedColumn) {
        detectedKeys.push(matchedColumn.key || matchedColumn.name);
        continue;
      }
    }

    if (detectedKeys.length > 0) {
      return detectedKeys;
    }
  }

  // Strategy 3: Use explicit yAxis parameter if provided
  if (yAxis) {
    const matchedColumn = columns.find((col) => col.name === yAxis || col.key === yAxis);
    if (matchedColumn) {
      return [matchedColumn.key || matchedColumn.name];
    }

    // Try case-insensitive match
    const caseInsensitiveMatch = columns.find(
      (col) => col.name.toLowerCase() === yAxis.toLowerCase() || col.key?.toLowerCase() === yAxis.toLowerCase(),
    );
    if (caseInsensitiveMatch) {
      return [caseInsensitiveMatch.key || caseInsensitiveMatch.name];
    }
  }

  // Strategy 4: Auto-detect numeric columns (fallback)
  const numericColumns = columns
    .filter((col) => col.type === "INTEGER" || col.type === "REAL" || col.type === "DECIMAL" || col.type === "FLOAT")
    .map((col) => col.key || col.name);

  return numericColumns;
}
