// =============================================================================
// Table Chart Component
// =============================================================================

import { useState, useMemo, useCallback } from "react";
import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Box } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { getCaseInsensitiveValue } from "./chartUtils";

interface TableChartProps {
  data: Record<string, any>[];
  columns: Array<{ name: string; key: string; type: string }>;
  title: string;
}

// Sort direction: 'asc' -> 'desc' -> null (no sort) -> 'asc' ...
type SortDirection = "asc" | "desc" | null;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

export function TableChart({ data, columns, title }: TableChartProps) {
  const [sortState, setSortState] = useState<SortState>({ column: null, direction: null });

  const formatValue = (value: any, type: string): string => {
    if (value === null || value === undefined) return "-";
    if (type === "REAL" && typeof value === "number") {
      return value.toFixed(2);
    }
    return String(value);
  };

  // Handle column header click for sorting
  const handleColumnClick = useCallback((columnKey: string) => {
    setSortState((prev) => {
      if (prev.column !== columnKey) {
        // Clicking a different column: start with ascending
        return { column: columnKey, direction: "asc" };
      }
      // Same column: cycle through asc -> desc -> null
      if (prev.direction === "asc") {
        return { column: columnKey, direction: "desc" };
      }
      if (prev.direction === "desc") {
        return { column: null, direction: null };
      }
      // null -> asc
      return { column: columnKey, direction: "asc" };
    });
  }, []);

  // Helper to check if a value is numeric (number or numeric string)
  const isNumeric = (val: any): boolean => {
    if (typeof val === "number") return !isNaN(val);
    if (typeof val === "string") {
      const trimmed = val.trim();
      return trimmed !== "" && !isNaN(Number(trimmed));
    }
    return false;
  };

  // Sort data based on current sort state
  const sortedData = useMemo(() => {
    if (!sortState.column || !sortState.direction) {
      return data;
    }

    const sorted = [...data].sort((a, b) => {
      const aVal = getCaseInsensitiveValue(a, sortState.column!);
      const bVal = getCaseInsensitiveValue(b, sortState.column!);

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      // Numeric comparison - check if both values are numeric (including numeric strings)
      if (isNumeric(aVal) && isNumeric(bVal)) {
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        return sortState.direction === "asc" ? aNum - bNum : bNum - aNum;
      }

      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (sortState.direction === "asc") {
        return aStr.localeCompare(bStr);
      }
      return bStr.localeCompare(aStr);
    });

    return sorted;
  }, [data, sortState]);

  // Get sort icon for a column
  const getSortIcon = (columnKey: string) => {
    if (sortState.column !== columnKey) {
      return null;
    }
    if (sortState.direction === "asc") {
      return <ArrowUpwardIcon sx={{ fontSize: 16, ml: 0.5, verticalAlign: "middle" }} />;
    }
    if (sortState.direction === "desc") {
      return <ArrowDownwardIcon sx={{ fontSize: 16, ml: 0.5, verticalAlign: "middle" }} />;
    }
    return null;
  };

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="h6" sx={{ mb: 1, ml: 1, fontWeight: "bold" }}>
        {title || "Table"}
      </Typography>
      <TableContainer component={Paper} sx={{ maxHeight: 500 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
              {columns.map((col) => {
                const columnKey = col.key || col.name;
                return (
                  <TableCell
                    key={col.key}
                    onClick={() => handleColumnClick(columnKey)}
                    sx={{
                      fontWeight: "bold",
                      backgroundColor: "#1f77b4",
                      color: "white",
                      minWidth: 120,
                      cursor: "pointer",
                      userSelect: "none",
                      "&:hover": {
                        backgroundColor: "#1a5a8a",
                      },
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      {col.name}
                      {getSortIcon(columnKey)}
                    </Box>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedData.map((row, idx) => (
              <TableRow key={idx} sx={{ "&:nth-of-type(odd)": { backgroundColor: "#f9f9f9" }, "&:hover": { backgroundColor: "#f0f0f0" } }}>
                {columns.map((col) => {
                  // Use key if available (new structure), fall back to name (old structure)
                  const dataKey = col.key || col.name;
                  return (
                    <TableCell key={`${idx}-${dataKey}`} sx={{ padding: "12px 16px" }}>
                      {formatValue(getCaseInsensitiveValue(row, dataKey), col.type)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" sx={{ display: "block", mt: 1, color: "text.secondary", marginLeft: 1 }}>
        Total rows: {data.length}
      </Typography>
    </Box>
  );
}
