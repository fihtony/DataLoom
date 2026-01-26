// =============================================================================
// Table Chart Component
// =============================================================================

import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Box } from "@mui/material";
import { getCaseInsensitiveValue } from "./chartUtils";

interface TableChartProps {
  data: Record<string, any>[];
  columns: Array<{ name: string; key: string; type: string }>;
  title: string;
}

export function TableChart({ data, columns, title }: TableChartProps) {
  const formatValue = (value: any, type: string): string => {
    if (value === null || value === undefined) return "-";
    if (type === "REAL" && typeof value === "number") {
      return value.toFixed(2);
    }
    return String(value);
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
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  sx={{
                    fontWeight: "bold",
                    backgroundColor: "#1f77b4",
                    color: "white",
                    minWidth: 120,
                  }}
                >
                  {col.name}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row, idx) => (
              <TableRow key={idx} sx={{ "&:nth-of-type(odd)": { backgroundColor: "#f9f9f9" }, "&:hover": { backgroundColor: "#f0f0f0" } }}>
                {columns.map((col) => {
                  // Use key if available (new structure), fall back to name (old structure)
                  const dataKey = col.key || col.name;
                  return (
                    <TableCell key={`${row}-${dataKey}`} sx={{ padding: "12px 16px" }}>
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
