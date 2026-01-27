// =============================================================================
// Knowledge Base Editor Component
// =============================================================================

import { useState, useEffect, useRef } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Divider,
  Tooltip,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Stack,
  TablePagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
} from "@mui/material";
import {
  Save as SaveIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  CloudUpload as CloudUploadIcon,
  Add as AddIcon,
  FileDownload as ExportIcon,
  FileUpload as ImportIcon,
} from "@mui/icons-material";
import { api } from "../services/api";
import { TableExplanationsDisplay, ColumnExplanationsDisplay, SqlExamplesDisplay } from "./KnowledgeBaseDisplays";

interface KnowledgeBaseEditorProps {
  connectionId: number | null;
  preloadedAnalysis?: any;
  onUserInputChange?: (input: string) => void;
  onFilesChange?: (files: Array<{ name: string; content: string }>) => void;
}

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
  created_at?: string;
  updated_at?: string;
}

interface AnalysisResult {
  tableExplanations: TableExplanation[];
  sqlExamples: SqlExample[];
}

export function KnowledgeBaseEditor(props: KnowledgeBaseEditorProps) {
  const { connectionId, preloadedAnalysis, onUserInputChange, onFilesChange } = props;

  // State for knowledge base data
  const [tableExplanations, setTableExplanations] = useState<TableExplanation[]>([]);
  const [columnExplanations, setColumnExplanations] = useState<ColumnExplanation[]>([]);
  const [sqlExamples, setSqlExamples] = useState<SqlExample[]>([]);
  const [userInput, setUserInput] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; content: string }>>([]);

  // State for analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(preloadedAnalysis || null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Selection state for analysis results
  const [selectedTables, setSelectedTables] = useState<Set<number>>(new Set());
  const [selectedColumns, setSelectedColumns] = useState<Map<string, Set<number>>>(new Map());
  const [selectedExamples, setSelectedExamples] = useState<Set<number>>(new Set());

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "table" | "example" | "column"; data: any; index?: number } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ type: "table" | "example" | "column"; data: any; index?: number } | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [selectedTabTable, setSelectedTabTable] = useState<string>("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importValidation, setImportValidation] = useState<{
    table_validation: Array<{
      target: { schema: string | null; table: string } | null;
      source: { schema: string | null; table: string } | null;
    }>;
    column_validation: Array<{
      target: { schema: string | null; table: string; column: string } | null;
      source: { schema: string | null; table: string; column: string } | null;
    }>;
  } | null>(null);
  const [pendingImportData, setPendingImportData] = useState<any>(null);

  // Tab selection for analysis results display (to avoid conditional hooks)
  const [selectedAnalysisTab, setSelectedAnalysisTab] = useState<string>("");

  // Track if we've already loaded to prevent duplicate calls
  const hasLoadedRef = useRef(false);
  const currentConnectionIdRef = useRef<number | null>(null);
  const hasInitializedTabRef = useRef(false);

  // Pagination
  const [tablePage, setTablePage] = useState(0);
  const [tableRowsPerPage, setTableRowsPerPage] = useState(5);
  const [examplePage, setExamplePage] = useState(0);
  const [exampleRowsPerPage, setExampleRowsPerPage] = useState(5);

  // Load knowledge base on mount or connection change (prevent duplicates)
  useEffect(() => {
    // Clear notification message when connectionId changes (including when it becomes null)
    if (connectionId !== currentConnectionIdRef.current) {
      setTestResult(null);
    }

    if (connectionId && connectionId !== currentConnectionIdRef.current) {
      currentConnectionIdRef.current = connectionId;
      hasLoadedRef.current = false;
      hasInitializedTabRef.current = false;
      setSelectedTabTable(""); // Reset tab selection for new connection
    }

    if (connectionId && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadKnowledgeBase();
    } else if (!connectionId) {
      // Reset when connectionId becomes null
      currentConnectionIdRef.current = null;
      hasLoadedRef.current = false;
    }
  }, [connectionId]);

  // Auto-select first table when column explanations are loaded
  useEffect(() => {
    if (columnExplanations.length > 0 && !hasInitializedTabRef.current) {
      hasInitializedTabRef.current = true;
      // Get unique table names
      const tableNames = new Set<string>();
      columnExplanations.forEach((col) => {
        const tableName = (col as any).table_name || col.column_name?.split(".")[0] || "Other";
        tableNames.add(tableName);
      });
      const tables = Array.from(tableNames).sort();
      if (tables.length > 0 && selectedTabTable === "") {
        setSelectedTabTable(tables[0]);
      }
    }
  }, [columnExplanations]);

  // Handle preloaded analysis from parent
  useEffect(() => {
    if (preloadedAnalysis) {
      setAnalysisResult(preloadedAnalysis);
      // Initialize selectedAnalysisTab when analysis results are set
      if (selectedAnalysisTab === "" && preloadedAnalysis.tableExplanations.length > 0) {
        setSelectedAnalysisTab(preloadedAnalysis.tableExplanations[0].table_name);
      }
      
      // Initialize selection state - select all by default
      setSelectedTables(new Set(preloadedAnalysis.tableExplanations.map((_: any, idx: number) => idx)));
      setSelectedExamples(new Set(preloadedAnalysis.sqlExamples.map((_: any, idx: number) => idx)));
      
      // Initialize column selection - select all columns for each table
      const columnSelection = new Map<string, Set<number>>();
      preloadedAnalysis.tableExplanations.forEach((table: TableExplanation) => {
        if (table.columns && table.columns.length > 0) {
          columnSelection.set(table.table_name, new Set(table.columns.map((_, idx) => idx)));
        }
      });
      setSelectedColumns(columnSelection);
    }
  }, [preloadedAnalysis, selectedAnalysisTab]);

  const loadKnowledgeBase = async () => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const kb = await api.getKnowledgeBase(connectionId);
      setTableExplanations(kb.tableExplanations || []);
      setColumnExplanations(kb.columnExplanations || []);
      // Sort SQL examples by updated_at descending (newest first)
      const sortedExamples = (kb.sqlExamples || []).sort(
        (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
      );
      setSqlExamples(sortedExamples);
      setAnalysisResult(null);
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to load knowledge base",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (!files) return;

    const newFiles: Array<{ name: string; content: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await file.text();
      newFiles.push({
        name: file.name,
        content,
      });
    }

    const updatedFiles = [...uploadedFiles, ...newFiles];
    setUploadedFiles(updatedFiles);
    // Notify parent component of file changes
    if (onFilesChange) {
      onFilesChange(updatedFiles);
    }
  };

  const handleRemoveFile = (index: number) => {
    const updatedFiles = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(updatedFiles);
    // Notify parent component of file changes
    if (onFilesChange) {
      onFilesChange(updatedFiles);
    }
  };

  const handleExport = async () => {
    if (!connectionId) return;

    setLoading(true);
    try {
      const exportData = await api.exportKnowledgeBase(connectionId);
      
      // Use connection name from export data
      const dbName = exportData.data.connectionName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      
      // Format timestamp as YYYYMMDD_HHMMSS in local time
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const datetime = `${year}${month}${day}_${hours}${minutes}${seconds}`;
      const filename = `dataloom_${dbName}_${datetime}.json`;

      // Create blob and download
      const blob = new Blob([JSON.stringify(exportData.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setTestResult({
        success: true,
        message: `Knowledge base exported successfully as ${filename}`,
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to export knowledge base",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImportClick = () => {
    document.getElementById("import-kb-file")?.click();
  };

  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !connectionId) return;

    setLoading(true);
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      // Validate import data
      const validation = await api.validateImportData(connectionId, importData);

      // Check if there are any mismatches (target null or source null)
      const hasTableMismatches = validation.table_validation.some(
        (item) => item.target === null || item.source === null
      );
      const hasColumnMismatches = validation.column_validation.some(
        (item) => item.target === null || item.source === null
      );

      if (hasTableMismatches || hasColumnMismatches) {
        // Show mismatch dialog
        setImportValidation(validation);
        setPendingImportData(importData);
        setImportDialogOpen(true);
      } else {
        // No mismatches, proceed with import
        await handleImportConfirm(importData);
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to import knowledge base",
      });
    } finally {
      setLoading(false);
      // Reset file input
      e.target.value = "";
    }
  };

  const handleImportConfirm = async (importData?: any) => {
    if (!connectionId) return;

    const dataToImport = importData || pendingImportData;
    if (!dataToImport) return;

    setLoading(true);
    try {
      const result = await api.importKnowledgeBase(connectionId, dataToImport);
      
      setTestResult({
        success: true,
        message: `Knowledge base imported successfully. Saved: ${result.stats.saved.tables} tables, ${result.stats.saved.columns} columns, ${result.stats.saved.examples} examples. Updated: ${result.stats.updated.tables} tables, ${result.stats.updated.columns} columns, ${result.stats.updated.examples} examples.`,
      });

      // Reload knowledge base
      await loadKnowledgeBase();
      
      setImportDialogOpen(false);
      setImportValidation(null);
      setPendingImportData(null);
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to import knowledge base",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAnalysis = async () => {
    if (!connectionId || !analysisResult) {
      setTestResult({
        success: false,
        message: "No analysis result to save",
      });
      return;
    }

    // Calculate total selected columns
    const totalSelectedColumnsCount = Array.from(selectedColumns.values()).reduce((sum, set) => sum + set.size, 0);

    // Check if anything is selected
    if (selectedTables.size === 0 && selectedExamples.size === 0 && totalSelectedColumnsCount === 0) {
      setTestResult({
        success: false,
        message: "Please select at least one item to save",
      });
      return;
    }

    setAnalyzing(true);
    try {
      // Build filtered analysis result based on selection
      // Include a table if: 1) table is selected, OR 2) any columns in that table are selected
      const filteredTableExplanations = analysisResult.tableExplanations
        .filter((table, idx) => {
          const isTableSelected = selectedTables.has(idx);
          const hasSelectedColumns = (selectedColumns.get(table.table_name)?.size || 0) > 0;
          return isTableSelected || hasSelectedColumns;
        })
        .map((table) => {
          // Find the original index of this table in the analysis result
          const originalIdx = analysisResult.tableExplanations.findIndex(t => t.table_name === table.table_name);
          const isTableSelected = selectedTables.has(originalIdx);
          const selectedColumnIndices = selectedColumns.get(table.table_name);
          const hasSelectedColumns = (selectedColumnIndices?.size || 0) > 0;
          
          // Filter columns for this table
          let filteredColumns = table.columns;
          if (selectedColumnIndices && selectedColumnIndices.size > 0 && table.columns) {
            filteredColumns = table.columns.filter((_, colIdx) => selectedColumnIndices.has(colIdx));
          }
          
          return {
            ...table,
            columns: filteredColumns,
            // Add flag: only update table if explicitly selected, not just because columns are selected
            _skipTableUpdate: !isTableSelected && hasSelectedColumns,
          };
        });

      const filteredSqlExamples = analysisResult.sqlExamples.filter((_, idx) => selectedExamples.has(idx));

      const filteredResult: AnalysisResult = {
        tableExplanations: filteredTableExplanations,
        sqlExamples: filteredSqlExamples,
      };

      const result = await api.saveKnowledgeBase(connectionId, filteredResult);
      
      // Calculate total columns saved
      const totalColumnsSaved = filteredTableExplanations.reduce((sum, t) => sum + (t.columns?.length || 0), 0);
      
      setTestResult({
        success: true,
        message: `Knowledge base saved: ${result.stats?.saved?.tables || 0} new tables (${totalColumnsSaved} columns), ${result.stats?.updated?.tables || 0} updated tables, ${result.stats?.saved?.examples || 0} new examples`,
      });
      setAnalysisResult(null);
      // Reset selection state
      setSelectedTables(new Set());
      setSelectedColumns(new Map());
      setSelectedExamples(new Set());
      await loadKnowledgeBase();
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to save",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDeleteTable = async (table: TableExplanation) => {
    setDeleteTarget({ type: "table", data: table });
    setDeleteDialogOpen(true);
  };

  const handleDeleteExample = async (example: SqlExample) => {
    setDeleteTarget({ type: "example", data: example });
    setDeleteDialogOpen(true);
  };

  // Helper function to convert keywords/arrays to comma-separated string for display
  const arrayToCommaSeparated = (value: any): string => {
    if (!value) return "";
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    if (typeof value === "string") {
      // Try to parse as JSON if it looks like a JSON array
      if (value.startsWith("[")) {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            return parsed.join(", ");
          }
        } catch {
          // Not valid JSON, return as-is
        }
      }
      return value;
    }
    return String(value);
  };

  const handleEditTable = (table: TableExplanation) => {
    setEditTarget({ type: "table", data: table });
    setEditFormData({
      table_name: table.table_name,
      explanation: table.explanation,
      business_purpose: table.business_purpose,
      keywords: arrayToCommaSeparated(table.keywords),
    });
    setEditDialogOpen(true);
  };

  const handleEditExample = (example: SqlExample) => {
    setEditTarget({ type: "example", data: example });
    setEditFormData({
      natural_language: example.natural_language,
      sql_query: example.sql_query,
      explanation: example.explanation,
      tables_involved: arrayToCommaSeparated(example.tables_involved),
    });
    setEditDialogOpen(true);
  };

  // Helper function to convert comma-separated string to array (for saving)
  const commaSeparatedToArray = (value: string): string[] => {
    if (!value || value.trim() === "") return [];
    return value.split(",").map((k: string) => k.trim()).filter((k: string) => k.length > 0);
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !editFormData || !connectionId) return;

    setAnalyzing(true);
    try {
      if (editTarget.type === "table") {
        const keywords = commaSeparatedToArray(editFormData.keywords);
        await api.updateTableExplanation(editTarget.data.id, {
          explanation: editFormData.explanation,
          business_purpose: editFormData.business_purpose,
          keywords: JSON.stringify(keywords),
        });

        const updatedTable = {
          ...editTarget.data,
          explanation: editFormData.explanation,
          business_purpose: editFormData.business_purpose,
          keywords,
        };
        // Update in local state
        setTableExplanations(tableExplanations.map((t) => (t.id === editTarget.data.id ? updatedTable : t)));
        setTestResult({ success: true, message: "Table explanation updated" });
      } else if (editTarget.type === "example") {
        const tablesInvolved = commaSeparatedToArray(editFormData.tables_involved);

        if (editTarget.data.id) {
          // Update existing example
          await api.updateSqlExample(editTarget.data.id, {
            natural_language: editFormData.natural_language,
            sql_query: editFormData.sql_query,
            explanation: editFormData.explanation,
            tables_involved: JSON.stringify(tablesInvolved),
          });

          const updatedExample = {
            ...editTarget.data,
            natural_language: editFormData.natural_language,
            sql_query: editFormData.sql_query,
            explanation: editFormData.explanation,
            tables_involved: tablesInvolved,
          };
          // Update in local state
          setSqlExamples(sqlExamples.map((e) => (e.id === editTarget.data.id ? updatedExample : e)));
          setTestResult({ success: true, message: "SQL example updated" });
        } else {
          // Create new example
          const result = await api.createSqlExample(connectionId, {
            natural_language: editFormData.natural_language,
            sql_query: editFormData.sql_query,
            explanation: editFormData.explanation,
            tables_involved: JSON.stringify(tablesInvolved),
          });

          const newExample = {
            id: result.id,
            natural_language: editFormData.natural_language,
            sql_query: editFormData.sql_query,
            explanation: editFormData.explanation,
            tags: [],
            tables_involved: tablesInvolved,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          // Add to top of list and sort by updated_at descending
          const updatedList = [newExample, ...sqlExamples];
          setSqlExamples(updatedList);
          setTestResult({ success: true, message: "SQL example created successfully" });
        }
      } else if (editTarget.type === "column") {
        await api.updateColumnExplanation(editTarget.data.id, {
          explanation: editFormData.explanation,
        });

        const updatedColumn = {
          ...editTarget.data,
          explanation: editFormData.explanation,
        };
        // Update in local state
        if (editTarget.index !== undefined) {
          const updated = [...columnExplanations];
          updated[editTarget.index] = updatedColumn;
          setColumnExplanations(updated);
        }
        setTestResult({ success: true, message: "Column explanation updated" });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to save",
      });
    } finally {
      setAnalyzing(false);
      setEditDialogOpen(false);
      setEditTarget(null);
      setEditFormData(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    setAnalyzing(true);
    try {
      if (deleteTarget.type === "table") {
        await api.deleteTableExplanation(deleteTarget.data.id);
        setTableExplanations(tableExplanations.filter((t) => t.id !== deleteTarget.data.id));
        setTestResult({ success: true, message: "Table explanation deleted" });
      } else if (deleteTarget.type === "example") {
        await api.deleteSqlExample(deleteTarget.data.id);
        setSqlExamples(sqlExamples.filter((e) => e.id !== deleteTarget.data.id));
        setTestResult({ success: true, message: "SQL example deleted" });
      } else if (deleteTarget.type === "column") {
        if (deleteTarget.data.id) {
          await api.deleteColumnExplanation(deleteTarget.data.id);
        }
        setColumnExplanations((prev) => prev.filter((_, i) => i !== deleteTarget.index));
        setTestResult({ success: true, message: `Column explanation for "${deleteTarget.data.column_name}" deleted` });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete",
      });
    } finally {
      setAnalyzing(false);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Handler for selecting all columns
  const handleSelectAllColumns = (selectAll: boolean) => {
    if (!analysisResult) return;
    const newSelection = new Map<string, Set<number>>();
    if (selectAll) {
      analysisResult.tableExplanations.forEach((table) => {
        if (table.columns && table.columns.length > 0) {
          newSelection.set(table.table_name, new Set(table.columns.map((_, idx) => idx)));
        }
      });
    }
    setSelectedColumns(newSelection);
  };

  // Handler for column selection change per table
  const handleColumnSelectionChange = (tableName: string, indices: Set<number>) => {
    setSelectedColumns((prev) => {
      const newMap = new Map(prev);
      if (indices.size === 0) {
        newMap.delete(tableName);
      } else {
        newMap.set(tableName, indices);
      }
      return newMap;
    });
  };

  // Show analysis results if available
  if (analysisResult) {
    // Calculate total selected
    const totalSelectedColumns = Array.from(selectedColumns.values()).reduce((sum, set) => sum + set.size, 0);
    const totalItems = selectedTables.size + selectedExamples.size + totalSelectedColumns;

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Alert severity="info">
          AI Analysis completed. Select the items you want to save and click "Save Selected" to store them in the knowledge base.
          <br />
          <strong>Selected: {selectedTables.size} tables, {totalSelectedColumns} columns, {selectedExamples.size} SQL examples</strong>
        </Alert>

        {testResult && <Alert severity={testResult.success ? "success" : "error"}>{testResult.message}</Alert>}

        {/* Use reusable Table Explanations display component with selection */}
        <TableExplanationsDisplay 
          tableExplanations={analysisResult.tableExplanations}
          selectable={true}
          selectedIndices={selectedTables}
          onSelectionChange={setSelectedTables}
        />

        {/* Use reusable Column Explanations display component with selection */}
        <ColumnExplanationsDisplay 
          tableExplanations={analysisResult.tableExplanations}
          selectable={true}
          selectedColumns={selectedColumns}
          onSelectionChange={handleColumnSelectionChange}
          onSelectAllColumns={handleSelectAllColumns}
        />

        {/* Use reusable SQL Examples display component with selection */}
        <SqlExamplesDisplay 
          sqlExamples={analysisResult.sqlExamples}
          selectable={true}
          selectedIndices={selectedExamples}
          onSelectionChange={setSelectedExamples}
        />

        <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <Button variant="outlined" onClick={() => {
            setAnalysisResult(null);
            setSelectedTables(new Set());
            setSelectedColumns(new Map());
            setSelectedExamples(new Set());
          }}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            startIcon={<SaveIcon />} 
            onClick={handleSaveAnalysis} 
            disabled={analyzing || totalItems === 0}
          >
            Save Selected ({totalItems} items)
          </Button>
        </Box>
      </Box>
    );
  }

  // Show knowledge base editor
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Status Alert */}
      {testResult && (
        <Alert severity={testResult.success ? "success" : "error"} onClose={() => setTestResult(null)}>
          {testResult.message}
        </Alert>
      )}

      {/* File Upload Section */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            Documentation Files
            <Tooltip title="Upload documentation files to provide context for analysis" arrow>
              <IconButton size="small">
                <CloudUploadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Typography>
          {connectionId && (
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ExportIcon />}
                onClick={handleExport}
                disabled={loading}
              >
                Export
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ImportIcon />}
                onClick={handleImportClick}
                disabled={loading}
              >
                Import
              </Button>
              <input
                type="file"
                id="import-kb-file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleImportFileSelect}
              />
            </Box>
          )}
        </Box>

        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <input
            type="file"
            id="file-upload"
            multiple
            onChange={handleFileUpload}
            style={{ display: "none" }}
            accept=".txt,.sql,.md,.csv"
          />
          <label htmlFor="file-upload" style={{ width: "100%" }}>
            <Button component="span" variant="outlined" startIcon={<CloudUploadIcon />} fullWidth>
              Upload Files (TXT, SQL, MD, CSV)
            </Button>
          </label>
        </Box>

        {uploadedFiles.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {uploadedFiles.map((file, idx) => (
              <Chip key={idx} label={file.name} onDelete={() => handleRemoveFile(idx)} size="small" />
            ))}
          </Stack>
        )}
      </Box>

      {/* User Input Section */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="subtitle2">Additional Information</Typography>
        <TextField
          multiline
          rows={4}
          value={userInput}
          onChange={(e) => {
            setUserInput(e.target.value);
            // Notify parent component of user input changes
            if (onUserInputChange) {
              onUserInputChange(e.target.value);
            }
          }}
          placeholder="Add any additional descriptions, relationships, or business rules that should be considered during analysis..."
          fullWidth
          variant="outlined"
        />
      </Box>

      <Divider />

      {/* SQL Examples Section - MOVED BEFORE Table Explanations */}
      {sqlExamples.length > 0 && (
        <>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
            <Typography variant="h6">SQL Examples ({sqlExamples.length})</Typography>
            <Tooltip title="Add a new SQL example">
              <IconButton
                size="small"
                color="primary"
                onClick={() => {
                  setEditTarget({
                    type: "example",
                    data: { natural_language: "", sql_query: "", explanation: "", tables_involved: [] },
                  });
                  setEditFormData({
                    natural_language: "",
                    sql_query: "",
                    explanation: "",
                    tables_involved: "",
                  });
                  setEditDialogOpen(true);
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                  {/* Question: 1/3 width, SQL Query: 2/3 width */}
                  <TableCell sx={{ fontWeight: "bold", width: "33.33%" }}>Question</TableCell>
                  <TableCell sx={{ fontWeight: "bold", width: "66.67%" }}>SQL Query</TableCell>
                  <TableCell sx={{ fontWeight: "bold", width: "auto" }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sqlExamples.slice(examplePage * exampleRowsPerPage, (examplePage + 1) * exampleRowsPerPage).map((example) => (
                  <TableRow key={example.id}>
                    <TableCell sx={{ width: "33.33%", verticalAlign: "top" }}>{example.natural_language}</TableCell>
                    <TableCell sx={{ width: "66.67%", verticalAlign: "top" }}>
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
                    <TableCell sx={{ whiteSpace: "nowrap", width: "auto" }}>
                      <IconButton size="small" title="Edit SQL example" onClick={() => handleEditExample(example)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDeleteExample(example)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {sqlExamples.length > 0 && (
            <TablePagination
              rowsPerPageOptions={[5, 10, 25]}
              component="div"
              count={sqlExamples.length}
              rowsPerPage={exampleRowsPerPage}
              page={examplePage}
              onPageChange={(_, newPage) => setExamplePage(newPage)}
              onRowsPerPageChange={(e) => {
                setExampleRowsPerPage(parseInt(e.target.value, 10));
                setExamplePage(0); // Reset to first page when changing rows per page
              }}
            />
          )}
        </>
      )}

      {/* Table Explanations */}
      {tableExplanations.length > 0 && (
        <>
          <Typography variant="h6">Table Explanations ({tableExplanations.length})</Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                  {/* Show Schema column only if any table has schema_name */}
                  {tableExplanations.some((t) => (t as any).schema_name) && <TableCell sx={{ fontWeight: "bold" }}>Schema</TableCell>}
                  <TableCell sx={{ fontWeight: "bold" }}>Table</TableCell>
                  <TableCell sx={{ fontWeight: "bold" }}>Explanation</TableCell>
                  <TableCell sx={{ fontWeight: "bold", width: 100 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tableExplanations
                  .sort((a, b) => {
                    const schemaA = ((a as any).schema_name || "").toLowerCase();
                    const schemaB = ((b as any).schema_name || "").toLowerCase();
                    if (schemaA !== schemaB) {
                      return schemaA.localeCompare(schemaB);
                    }
                    return a.table_name.toLowerCase().localeCompare(b.table_name.toLowerCase());
                  })
                  .slice(tablePage * tableRowsPerPage, (tablePage + 1) * tableRowsPerPage)
                  .map((table) => (
                    <TableRow key={table.id}>
                      {/* Show Schema cell only if any table has schema_name */}
                      {tableExplanations.some((t) => (t as any).schema_name) && (
                        <TableCell sx={{ fontWeight: "500", fontSize: "0.85rem" }}>
                          {((table as any).schema_name || "").toLowerCase() || "—"}
                        </TableCell>
                      )}
                      <TableCell sx={{ fontWeight: "500", width: 150 }}>{table.table_name}</TableCell>
                      <TableCell>{table.explanation}</TableCell>
                      <TableCell>
                        <IconButton size="small" title="Edit table explanation" onClick={() => handleEditTable(table)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDeleteTable(table)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
          {tableExplanations.length > tableRowsPerPage && (
            <TablePagination
              rowsPerPageOptions={[5, 10, 25]}
              component="div"
              count={tableExplanations.length}
              rowsPerPage={tableRowsPerPage}
              page={tablePage}
              onPageChange={(_, newPage) => setTablePage(newPage)}
              onRowsPerPageChange={(e) => setTableRowsPerPage(parseInt(e.target.value, 10))}
            />
          )}
        </>
      )}

      {/* Column Explanations Section */}
      {columnExplanations.length > 0 && (
        <>
          <Typography variant="h6">Column Explanations ({columnExplanations.length})</Typography>
          <Paper sx={{ p: 2 }}>
            {(() => {
              const tableGroups = new Map<string, ColumnExplanation[]>();
              columnExplanations.forEach((col) => {
                // Use table_name if available, otherwise try to parse from column_name
                const tableName = (col as any).table_name || col.column_name?.split(".")[0] || "Other";
                if (!tableGroups.has(tableName)) {
                  tableGroups.set(tableName, []);
                }
                tableGroups.get(tableName)?.push(col);
              });

              const tables = Array.from(tableGroups.keys()).sort((a, b) => {
                const schemaA = (tableGroups.get(a)?.[0] as any).schema_name || "";
                const schemaB = (tableGroups.get(b)?.[0] as any).schema_name || "";
                const schemaCompare = schemaA.toLowerCase().localeCompare(schemaB.toLowerCase());
                if (schemaCompare !== 0) {
                  return schemaCompare;
                }
                return a.toLowerCase().localeCompare(b.toLowerCase());
              });

              // Ensure selectedTabTable is valid
              const validSelectedTable = tables.includes(selectedTabTable) ? selectedTabTable : tables.length > 0 ? tables[0] : "";

              return (
                <>
                  <Tabs
                    value={validSelectedTable}
                    onChange={(_, value) => setSelectedTabTable(value)}
                    variant="scrollable"
                    scrollButtons="auto"
                  >
                    {tables.map((table) => {
                      // Get schema name for this table if available
                      const tableSchema = tableGroups.get(table)?.[0] && (tableGroups.get(table)?.[0] as any).schema_name;
                      return (
                        <Tab
                          key={table}
                          value={table}
                          sx={{ textTransform: "none" }}
                          label={
                            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                              <span style={{ fontSize: "0.95rem", lineHeight: 1 }}>{table}</span>
                              {tableSchema && (
                                <Typography variant="caption" sx={{ fontSize: "0.80rem", lineHeight: 1, mt: 0.25 }}>
                                  <strong>{tableSchema}</strong>
                                </Typography>
                              )}
                            </Box>
                          }
                        />
                      );
                    })}
                  </Tabs>

                  {validSelectedTable && tableGroups.get(validSelectedTable) && (
                    <TableContainer sx={{ mt: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                            <TableCell sx={{ fontWeight: "bold" }}>Column</TableCell>
                            <TableCell sx={{ fontWeight: "bold" }}>Type</TableCell>
                            <TableCell sx={{ fontWeight: "bold" }}>Explanation</TableCell>
                            <TableCell sx={{ fontWeight: "bold", width: 120 }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {tableGroups.get(validSelectedTable)?.map((col, idx) => (
                            <TableRow key={idx}>
                              <TableCell sx={{ fontWeight: "500" }}>{col.column_name}</TableCell>
                              <TableCell>{col.data_type || "N/A"}</TableCell>
                              <TableCell>{col.explanation}</TableCell>
                              <TableCell>
                                <Box sx={{ display: "flex", gap: 1 }}>
                                  <IconButton
                                    size="small"
                                    onClick={() => {
                                      setEditTarget({
                                        type: "column",
                                        data: col,
                                        index: columnExplanations.indexOf(col),
                                      });
                                      setEditFormData({
                                        column_name: col.column_name,
                                        data_type: col.data_type,
                                        explanation: col.explanation,
                                      });
                                      setEditDialogOpen(true);
                                    }}
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => {
                                      setDeleteTarget({
                                        type: "column",
                                        data: col,
                                        index: columnExplanations.indexOf(col),
                                      });
                                      setDeleteDialogOpen(true);
                                    }}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </>
              );
            })()}
          </Paper>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {deleteTarget?.type === "table"
            ? "Delete Table Explanation"
            : deleteTarget?.type === "example"
              ? "Delete SQL Example"
              : "Delete Column Explanation"}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {deleteTarget?.type === "table" && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Table: <strong>{deleteTarget.data.table_name}</strong>
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Explanation: {deleteTarget.data.explanation}
              </Typography>
              <Typography color="warning.main" variant="body2">
                This action cannot be undone.
              </Typography>
            </>
          )}
          {deleteTarget?.type === "example" && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Question: <strong>{deleteTarget.data.natural_language}</strong>
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                SQL: <code>{deleteTarget.data.sql_query.substring(0, 200)}</code>
              </Typography>
              <Typography color="warning.main" variant="body2">
                This action cannot be undone.
              </Typography>
            </>
          )}
          {deleteTarget?.type === "column" && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Column: <strong>{deleteTarget.data.column_name}</strong>
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Explanation: {deleteTarget.data.explanation}
              </Typography>
              <Typography color="warning.main" variant="body2">
                This action cannot be undone.
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Confirmation Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        PaperProps={{
          sx: {
            display: "flex",
            flexDirection: "column",
            maxHeight: "95vh",
            margin: 0,
            padding: 0,
          },
        }}
      >
        <DialogTitle sx={{ flexShrink: 0, margin: 0, padding: "16px 24px", borderBottom: "1px solid #e0e0e0" }}>
          {editTarget?.type === "table"
            ? "Edit Table Explanation"
            : editTarget?.type === "example"
              ? "Edit SQL Example"
              : "Edit Column Explanation"}
        </DialogTitle>
        <DialogContent
          sx={{ pt: "16px !important", px: 3, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", flex: 1, margin: 0 }}
        >
          {editTarget?.type === "table" && editFormData && (
            <>
              <TextField fullWidth label="Table Name" value={editFormData.table_name} disabled size="small" />
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Explanation"
                value={editFormData.explanation}
                onChange={(e) => setEditFormData({ ...editFormData, explanation: e.target.value })}
                size="small"
              />
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Business Purpose"
                value={editFormData.business_purpose}
                onChange={(e) => setEditFormData({ ...editFormData, business_purpose: e.target.value })}
                size="small"
              />
              <TextField
                fullWidth
                label="Keywords (comma separated)"
                value={editFormData.keywords}
                onChange={(e) => setEditFormData({ ...editFormData, keywords: e.target.value })}
                size="small"
              />
            </>
          )}
          {editTarget?.type === "example" && editFormData && (
            <>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Question (Natural Language)"
                value={editFormData.natural_language}
                onChange={(e) => setEditFormData({ ...editFormData, natural_language: e.target.value })}
                size="small"
              />
              <TextField
                fullWidth
                multiline
                rows={3}
                label="SQL Query"
                value={editFormData.sql_query}
                onChange={(e) => setEditFormData({ ...editFormData, sql_query: e.target.value })}
                size="small"
              />
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Explanation"
                value={editFormData.explanation}
                onChange={(e) => setEditFormData({ ...editFormData, explanation: e.target.value })}
                size="small"
              />
              <TextField
                fullWidth
                label="Tables Involved (comma separated)"
                value={editFormData.tables_involved}
                onChange={(e) => setEditFormData({ ...editFormData, tables_involved: e.target.value })}
                size="small"
              />
            </>
          )}
          {editTarget?.type === "column" && editFormData && (
            <>
              <TextField fullWidth label="Column Name" value={editFormData.column_name} disabled size="small" />
              <TextField fullWidth label="Data Type" value={editFormData.data_type} disabled size="small" />
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Explanation"
                value={editFormData.explanation}
                onChange={(e) => setEditFormData({ ...editFormData, explanation: e.target.value })}
                size="small"
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Import Mismatch Dialog */}
      <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Import Validation</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Comparing import file with target database. Items marked in red indicate mismatches.
          </Alert>
          
          {importValidation && (
            <>
              {/* Table Validation Section */}
              <Typography variant="h6" sx={{ mt: 2, mb: 1, fontWeight: "bold" }}>
                Table Validation
              </Typography>
              <TableContainer sx={{ maxHeight: 300, mb: 3, border: "1px solid #e0e0e0", borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Target Database</TableCell>
                      <TableCell sx={{ fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Import File</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importValidation.table_validation.map((item, idx) => {
                      const isMatch = item.target !== null && item.source !== null;
                      const targetOnly = item.target !== null && item.source === null;
                      const sourceOnly = item.target === null && item.source !== null;
                      
                      return (
                        <TableRow 
                          key={idx}
                          sx={{
                            backgroundColor: isMatch ? "#f1f8e9" : targetOnly ? "#fff3e0" : sourceOnly ? "#ffebee" : "inherit",
                          }}
                        >
                          <TableCell>
                            {isMatch ? (
                              <Chip label="Match" color="success" size="small" />
                            ) : targetOnly ? (
                              <Chip label="Target Only" color="warning" size="small" />
                            ) : sourceOnly ? (
                              <Chip label="Import Only" color="error" size="small" />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {item.target ? (
                              <Box>
                                {item.target.schema && (
                                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                                    Schema: <strong>{item.target.schema}</strong>
                                  </Typography>
                                )}
                                <Typography variant="body2">
                                  Table: <strong>{item.target.table}</strong>
                                </Typography>
                              </Box>
                            ) : (
                              <Typography variant="body2" sx={{ color: "error.main", fontStyle: "italic" }}>
                                Not found
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {item.source ? (
                              <Box>
                                {item.source.schema && (
                                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                                    Schema: <strong>{item.source.schema}</strong>
                                  </Typography>
                                )}
                                <Typography variant="body2">
                                  Table: <strong>{item.source.table}</strong>
                                </Typography>
                              </Box>
                            ) : (
                              <Typography variant="body2" sx={{ color: "error.main", fontStyle: "italic" }}>
                                Not found
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Column Validation Section */}
              <Typography variant="h6" sx={{ mt: 2, mb: 1, fontWeight: "bold" }}>
                Column Validation
              </Typography>
              <TableContainer sx={{ maxHeight: 300, mb: 2, border: "1px solid #e0e0e0", borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Target Database</TableCell>
                      <TableCell sx={{ fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Import File</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importValidation.column_validation.map((item, idx) => {
                      const isMatch = item.target !== null && item.source !== null;
                      const targetOnly = item.target !== null && item.source === null;
                      const sourceOnly = item.target === null && item.source !== null;
                      
                      return (
                        <TableRow 
                          key={idx}
                          sx={{
                            backgroundColor: isMatch ? "#f1f8e9" : targetOnly ? "#fff3e0" : sourceOnly ? "#ffebee" : "inherit",
                          }}
                        >
                          <TableCell>
                            {isMatch ? (
                              <Chip label="Match" color="success" size="small" />
                            ) : targetOnly ? (
                              <Chip label="Target Only" color="warning" size="small" />
                            ) : sourceOnly ? (
                              <Chip label="Import Only" color="error" size="small" />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {item.target ? (
                              <Box>
                                {item.target.schema && (
                                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                                    Schema: <strong>{item.target.schema}</strong>
                                  </Typography>
                                )}
                                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                                  Table: <strong>{item.target.table}</strong>
                                </Typography>
                                <Typography variant="body2">
                                  Column: <strong>{item.target.column}</strong>
                                </Typography>
                              </Box>
                            ) : (
                              <Typography variant="body2" sx={{ color: "error.main", fontStyle: "italic" }}>
                                Not found
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {item.source ? (
                              <Box>
                                {item.source.schema && (
                                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                                    Schema: <strong>{item.source.schema}</strong>
                                  </Typography>
                                )}
                                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                                  Table: <strong>{item.source.table}</strong>
                                </Typography>
                                <Typography variant="body2">
                                  Column: <strong>{item.source.column}</strong>
                                </Typography>
                              </Box>
                            ) : (
                              <Typography variant="body2" sx={{ color: "error.main", fontStyle: "italic" }}>
                                Not found
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
          
          <Typography variant="body2" sx={{ mt: 2, color: "text.secondary" }}>
            Do you want to proceed with the import? Records with mismatched names will be skipped.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => handleImportConfirm()} variant="contained" color="primary">
            Proceed with Import
          </Button>
        </DialogActions>
      </Dialog>

      {tableExplanations.length === 0 && sqlExamples.length === 0 && columnExplanations.length === 0 && (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <Typography>No knowledge base yet. Add files or descriptions and click "Analyze" to get started.</Typography>
        </Box>
      )}
    </Box>
  );
}
