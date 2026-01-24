// =============================================================================
// Reusable Knowledge Base Display Components
// =============================================================================

import { useState } from "react";
import { Box, Paper, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tab } from "@mui/material";

interface TableExplanation {
  id?: number;
  schema_name?: string;
  table_name: string;
  explanation: string;
  business_purpose: string;
  keywords: string[];
  columns: ColumnExplanation[];
}

interface ColumnExplanation {
  id?: number;
  table_name?: string;
  schema_name?: string;
  column_name: string;
  explanation: string;
  business_meaning: string;
  data_type?: string;
  sensitivity_level?: string;
  synonyms?: string[];
  sample_values?: string[];
}

interface SqlExample {
  id?: number;
  natural_language: string;
  sql_query: string;
  explanation: string;
  tables_involved: string[];
  tags?: string[];
}

// =============================================================================
// Table Explanations Display
// =============================================================================

interface TableExplanationsDisplayProps {
  tableExplanations: TableExplanation[];
  isEditing?: boolean;
}

export function TableExplanationsDisplay({ tableExplanations, isEditing = false }: TableExplanationsDisplayProps) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6">Table Explanations ({tableExplanations.length})</Typography>
      <Paper sx={{ p: 2 }}>
        {tableExplanations.length === 0 ? (
          <Typography variant="body2" sx={{ color: "#999" }}>
            No table explanations yet.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                  {/* Only show Schema column if any table has schema_name */}
                  {tableExplanations.some((t) => t.schema_name) && <TableCell sx={{ fontWeight: "bold" }}>Schema</TableCell>}
                  <TableCell sx={{ fontWeight: "bold" }}>Table Name</TableCell>
                  <TableCell sx={{ fontWeight: "bold" }}>Explanation</TableCell>
                  <TableCell sx={{ fontWeight: "bold" }}>Business Purpose</TableCell>
                  {isEditing && <TableCell sx={{ fontWeight: "bold" }}>Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {tableExplanations.map((table, idx) => (
                  <TableRow key={idx} sx={{ verticalAlign: "top" }}>
                    {/* Only show Schema cell if any table has schema_name */}
                    {tableExplanations.some((t) => t.schema_name) && (
                      <TableCell sx={{ fontWeight: "500", fontSize: "0.9em" }}>{table.schema_name || "—"}</TableCell>
                    )}
                    <TableCell sx={{ fontWeight: "500" }}>{table.table_name}</TableCell>
                    <TableCell>{table.explanation || "—"}</TableCell>
                    <TableCell>{table.business_purpose || "—"}</TableCell>
                    {isEditing && (
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{/* Edit/Delete buttons will be added by parent if needed */}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}

// =============================================================================
// Column Explanations Display with Tab Grouping
// =============================================================================

interface ColumnExplanationsDisplayProps {
  tableExplanations: TableExplanation[];
  isEditing?: boolean;
}

export function ColumnExplanationsDisplay({ tableExplanations, isEditing = false }: ColumnExplanationsDisplayProps) {
  // Group tables
  const tableGroups = new Map<string, TableExplanation[]>();
  tableExplanations.forEach((table) => {
    if (!tableGroups.has(table.table_name)) {
      tableGroups.set(table.table_name, []);
    }
    tableGroups.get(table.table_name)?.push(table);
  });

  const tables = Array.from(tableGroups.keys()).sort((a, b) => {
    const schemaA = tableGroups.get(a)?.[0]?.schema_name || "";
    const schemaB = tableGroups.get(b)?.[0]?.schema_name || "";
    const schemaCompare = schemaA.toLowerCase().localeCompare(schemaB.toLowerCase());
    if (schemaCompare !== 0) {
      return schemaCompare;
    }
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  const [selectedTab, setSelectedTab] = useState<string>(tables.length > 0 ? tables[0] : "");

  const totalColumns = tableExplanations.reduce((sum, table) => sum + (table.columns?.length || 0), 0);

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6">Column Explanations ({totalColumns})</Typography>
      <Paper sx={{ p: 2 }}>
        {tables.length === 0 ? (
          <Typography variant="body2" sx={{ color: "#999" }}>
            No column explanations yet.
          </Typography>
        ) : (
          <>
            <Tabs value={selectedTab || ""} onChange={(_, value) => setSelectedTab(value)} variant="scrollable" scrollButtons="auto">
              {tables.map((table) => {
                const tableSchema = tableGroups.get(table)?.[0]?.schema_name;
                return (
                  <Tab
                    key={table}
                    value={table}
                    label={
                      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span>{table}</span>
                        {tableSchema && (
                          <Typography variant="caption" sx={{ fontSize: "0.60rem", lineHeight: 1, mt: 0.25 }}>
                            <strong>{tableSchema.toLowerCase()}</strong>
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                );
              })}
            </Tabs>

            {selectedTab && tableGroups.get(selectedTab)?.[0]?.columns && (
              <TableContainer sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                      <TableCell sx={{ fontWeight: "bold" }}>Column</TableCell>
                      <TableCell sx={{ fontWeight: "bold" }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: "bold" }}>Explanation</TableCell>
                      {isEditing && <TableCell sx={{ fontWeight: "bold" }}>Actions</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableGroups.get(selectedTab)?.[0]?.columns?.map((col: ColumnExplanation, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell sx={{ fontWeight: "500" }}>{col.column_name}</TableCell>
                        <TableCell>{col.data_type || "—"}</TableCell>
                        <TableCell>{col.explanation || "—"}</TableCell>
                        {isEditing && (
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{/* Edit/Delete buttons will be added by parent if needed */}</TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </Paper>
    </Box>
  );
}

// =============================================================================
// SQL Examples Display
// =============================================================================

interface SqlExamplesDisplayProps {
  sqlExamples: SqlExample[];
  isEditing?: boolean;
}

export function SqlExamplesDisplay({ sqlExamples, isEditing = false }: SqlExamplesDisplayProps) {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6">SQL Examples ({sqlExamples.length})</Typography>
      <Paper sx={{ p: 2 }}>
        {sqlExamples.length === 0 ? (
          <Typography variant="body2" sx={{ color: "#999" }}>
            No SQL examples yet.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                  {/* Question: 1/3, SQL Query: 2/3 */}
                  <TableCell sx={{ fontWeight: "bold", width: "33.33%" }}>Question</TableCell>
                  <TableCell sx={{ fontWeight: "bold", width: "66.67%" }}>SQL Query</TableCell>
                  {isEditing && <TableCell sx={{ fontWeight: "bold", width: "auto", whiteSpace: "nowrap" }}>Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {sqlExamples.map((example, idx) => (
                  <TableRow key={idx} sx={{ verticalAlign: "top" }}>
                    <TableCell sx={{ verticalAlign: "top", width: "33.33%" }}>{example.natural_language}</TableCell>
                    <TableCell sx={{ verticalAlign: "top", width: "66.67%" }}>
                      <Box
                        component="pre"
                        sx={{
                          fontSize: "0.85em",
                          margin: 0,
                          padding: "8px",
                          backgroundColor: "#f9f9f9",
                          borderRadius: "4px",
                          border: "1px solid #e0e0e0",
                          overflowX: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          maxWidth: "100%",
                        }}
                      >
                        {example.sql_query}
                      </Box>
                    </TableCell>
                    {isEditing && (
                      <TableCell sx={{ whiteSpace: "nowrap", width: "auto" }}>
                        {/* Edit/Delete buttons will be added by parent if needed */}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
