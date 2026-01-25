// =============================================================================
// Reusable Knowledge Base Display Components
// =============================================================================

import { useState, useMemo } from "react";
import { Box, Paper, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tab, Checkbox, FormControlLabel } from "@mui/material";

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

// Selection state types
export interface SelectionState {
  tables: Set<number>;  // indices of selected tables
  columns: Map<string, Set<number>>;  // table_name -> indices of selected columns
  examples: Set<number>;  // indices of selected examples
}

// =============================================================================
// Table Explanations Display
// =============================================================================

interface TableExplanationsDisplayProps {
  tableExplanations: TableExplanation[];
  isEditing?: boolean;
  // Selection props
  selectable?: boolean;
  selectedIndices?: Set<number>;
  onSelectionChange?: (indices: Set<number>) => void;
}

export function TableExplanationsDisplay({ 
  tableExplanations, 
  isEditing = false,
  selectable = false,
  selectedIndices,
  onSelectionChange,
}: TableExplanationsDisplayProps) {
  const allSelected = selectedIndices?.size === tableExplanations.length && tableExplanations.length > 0;
  const someSelected = (selectedIndices?.size || 0) > 0 && !allSelected;

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(tableExplanations.map((_, idx) => idx)));
    }
  };

  const handleSelectOne = (idx: number) => {
    if (!onSelectionChange || !selectedIndices) return;
    const newSet = new Set(selectedIndices);
    if (newSet.has(idx)) {
      newSet.delete(idx);
    } else {
      newSet.add(idx);
    }
    onSelectionChange(newSet);
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
        <Typography variant="h6">Table Explanations ({tableExplanations.length})</Typography>
        {selectable && selectedIndices && (
          <Typography variant="body2" color="text.secondary">
            ({selectedIndices.size} selected)
          </Typography>
        )}
      </Box>
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
                  {selectable && (
                    <TableCell sx={{ fontWeight: "bold", width: 50 }}>
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={handleSelectAll}
                        size="small"
                      />
                    </TableCell>
                  )}
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
                  <TableRow 
                    key={idx} 
                    sx={{ 
                      verticalAlign: "top",
                      backgroundColor: selectable && selectedIndices?.has(idx) ? "rgba(25, 118, 210, 0.08)" : "inherit",
                    }}
                  >
                    {selectable && (
                      <TableCell>
                        <Checkbox
                          checked={selectedIndices?.has(idx) || false}
                          onChange={() => handleSelectOne(idx)}
                          size="small"
                        />
                      </TableCell>
                    )}
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
  // Selection props
  selectable?: boolean;
  selectedColumns?: Map<string, Set<number>>;  // table_name -> column indices
  onSelectionChange?: (tableName: string, indices: Set<number>) => void;
  onSelectAllColumns?: (selectAll: boolean) => void;
}

export function ColumnExplanationsDisplay({ 
  tableExplanations, 
  isEditing = false,
  selectable = false,
  selectedColumns,
  onSelectionChange,
  onSelectAllColumns,
}: ColumnExplanationsDisplayProps) {
  // Group tables
  const tableGroups = useMemo(() => {
    const groups = new Map<string, TableExplanation[]>();
    tableExplanations.forEach((table) => {
      if (!groups.has(table.table_name)) {
        groups.set(table.table_name, []);
      }
      groups.get(table.table_name)?.push(table);
    });
    return groups;
  }, [tableExplanations]);

  const tables = useMemo(() => {
    return Array.from(tableGroups.keys()).sort((a, b) => {
      const schemaA = tableGroups.get(a)?.[0]?.schema_name || "";
      const schemaB = tableGroups.get(b)?.[0]?.schema_name || "";
      const schemaCompare = schemaA.toLowerCase().localeCompare(schemaB.toLowerCase());
      if (schemaCompare !== 0) {
        return schemaCompare;
      }
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
  }, [tableGroups]);

  const [selectedTab, setSelectedTab] = useState<string>(tables.length > 0 ? tables[0] : "");

  const totalColumns = tableExplanations.reduce((sum, table) => sum + (table.columns?.length || 0), 0);
  
  // Calculate total selected columns
  const totalSelectedColumns = useMemo(() => {
    if (!selectedColumns) return 0;
    let total = 0;
    selectedColumns.forEach((indices) => {
      total += indices.size;
    });
    return total;
  }, [selectedColumns]);

  const allColumnsSelected = totalSelectedColumns === totalColumns && totalColumns > 0;
  const someColumnsSelected = totalSelectedColumns > 0 && !allColumnsSelected;

  // Check if all columns in current table are selected
  const currentTableColumns = tableGroups.get(selectedTab)?.[0]?.columns || [];
  const currentTableSelectedCount = selectedColumns?.get(selectedTab)?.size || 0;
  const allCurrentTableSelected = currentTableSelectedCount === currentTableColumns.length && currentTableColumns.length > 0;
  const someCurrentTableSelected = currentTableSelectedCount > 0 && !allCurrentTableSelected;

  const handleSelectAllGlobal = () => {
    if (!onSelectAllColumns) return;
    onSelectAllColumns(!allColumnsSelected);
  };

  const handleSelectAllTable = () => {
    if (!onSelectionChange || !selectedTab) return;
    const columns = tableGroups.get(selectedTab)?.[0]?.columns || [];
    if (allCurrentTableSelected) {
      onSelectionChange(selectedTab, new Set());
    } else {
      onSelectionChange(selectedTab, new Set(columns.map((_, idx) => idx)));
    }
  };

  const handleSelectOne = (colIdx: number) => {
    if (!onSelectionChange || !selectedTab) return;
    const currentSelected = selectedColumns?.get(selectedTab) || new Set();
    const newSet = new Set(currentSelected);
    if (newSet.has(colIdx)) {
      newSet.delete(colIdx);
    } else {
      newSet.add(colIdx);
    }
    onSelectionChange(selectedTab, newSet);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
        <Typography variant="h6">Column Explanations ({totalColumns})</Typography>
        {selectable && totalColumns > 0 && (
          <FormControlLabel
            control={
              <Checkbox
                checked={allColumnsSelected}
                indeterminate={someColumnsSelected}
                onChange={handleSelectAllGlobal}
                size="small"
              />
            }
            label={<Typography variant="body2">Select All Tables</Typography>}
          />
        )}
        {selectable && (
          <Typography variant="body2" color="text.secondary">
            ({totalSelectedColumns} selected)
          </Typography>
        )}
      </Box>
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
                const tableSelectedCount = selectedColumns?.get(table)?.size || 0;
                const tableColumnCount = tableGroups.get(table)?.[0]?.columns?.length || 0;
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
                        {selectable && (
                          <Typography variant="caption" sx={{ fontSize: "0.60rem", color: tableSelectedCount === tableColumnCount ? "success.main" : "text.secondary" }}>
                            {tableSelectedCount}/{tableColumnCount}
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
                      {selectable && (
                        <TableCell sx={{ fontWeight: "bold", width: 50 }}>
                          <Checkbox
                            checked={allCurrentTableSelected}
                            indeterminate={someCurrentTableSelected}
                            onChange={handleSelectAllTable}
                            size="small"
                          />
                        </TableCell>
                      )}
                      <TableCell sx={{ fontWeight: "bold" }}>Column</TableCell>
                      <TableCell sx={{ fontWeight: "bold" }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: "bold" }}>Explanation</TableCell>
                      {isEditing && <TableCell sx={{ fontWeight: "bold" }}>Actions</TableCell>}
                    </TableRow>
                  </TableHead>
                    <TableBody>
                      {tableGroups.get(selectedTab)?.[0]?.columns?.map((col: ColumnExplanation, idx: number) => {
                        const isSelected = selectedColumns?.get(selectedTab)?.has(idx) || false;
                        return (
                          <TableRow 
                            key={idx}
                            sx={{
                              backgroundColor: selectable && isSelected ? "rgba(25, 118, 210, 0.08)" : "inherit",
                            }}
                          >
                            {selectable && (
                              <TableCell>
                                <Checkbox
                                  checked={isSelected}
                                  onChange={() => handleSelectOne(idx)}
                                  size="small"
                                />
                              </TableCell>
                            )}
                            <TableCell sx={{ fontWeight: "500" }}>{col.column_name}</TableCell>
                            <TableCell>{col.data_type || "—"}</TableCell>
                            <TableCell>{col.explanation || "—"}</TableCell>
                            {isEditing && (
                              <TableCell sx={{ whiteSpace: "nowrap" }}>{/* Edit/Delete buttons will be added by parent if needed */}</TableCell>
                            )}
                          </TableRow>
                        );
                      })}
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
  // Selection props
  selectable?: boolean;
  selectedIndices?: Set<number>;
  onSelectionChange?: (indices: Set<number>) => void;
}

export function SqlExamplesDisplay({ 
  sqlExamples, 
  isEditing = false,
  selectable = false,
  selectedIndices,
  onSelectionChange,
}: SqlExamplesDisplayProps) {
  const allSelected = selectedIndices?.size === sqlExamples.length && sqlExamples.length > 0;
  const someSelected = (selectedIndices?.size || 0) > 0 && !allSelected;

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(sqlExamples.map((_, idx) => idx)));
    }
  };

  const handleSelectOne = (idx: number) => {
    if (!onSelectionChange || !selectedIndices) return;
    const newSet = new Set(selectedIndices);
    if (newSet.has(idx)) {
      newSet.delete(idx);
    } else {
      newSet.add(idx);
    }
    onSelectionChange(newSet);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
        <Typography variant="h6">SQL Examples ({sqlExamples.length})</Typography>
        {selectable && selectedIndices && (
          <Typography variant="body2" color="text.secondary">
            ({selectedIndices.size} selected)
          </Typography>
        )}
      </Box>
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
                  {selectable && (
                    <TableCell sx={{ fontWeight: "bold", width: 50 }}>
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={handleSelectAll}
                        size="small"
                      />
                    </TableCell>
                  )}
                  {/* Question: 1/3, SQL Query: 2/3 */}
                  <TableCell sx={{ fontWeight: "bold", width: "33.33%" }}>Question</TableCell>
                  <TableCell sx={{ fontWeight: "bold", width: "66.67%" }}>SQL Query</TableCell>
                  {isEditing && <TableCell sx={{ fontWeight: "bold", width: "auto", whiteSpace: "nowrap" }}>Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {sqlExamples.map((example, idx) => (
                  <TableRow 
                    key={idx} 
                    sx={{ 
                      verticalAlign: "top",
                      backgroundColor: selectable && selectedIndices?.has(idx) ? "rgba(25, 118, 210, 0.08)" : "inherit",
                    }}
                  >
                    {selectable && (
                      <TableCell>
                        <Checkbox
                          checked={selectedIndices?.has(idx) || false}
                          onChange={() => handleSelectOne(idx)}
                          size="small"
                        />
                      </TableCell>
                    )}
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
