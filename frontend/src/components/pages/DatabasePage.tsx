// =============================================================================
// Database Page - Manage Database Connections
// =============================================================================

import { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  IconButton,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Tooltip,
  Alert,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  Storage as DatabaseIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  TableChart as TableIcon,
  Schema as SchemaIcon,
  WarningAmber as WarningIcon,
} from "@mui/icons-material";
import { useStore } from "../../store";
import { api } from "../../services/api";

const DATABASE_TYPES = [
  { id: "sqlite", name: "SQLite", fields: ["path"] },
  {
    id: "postgresql",
    name: "PostgreSQL",
    fields: ["host", "port", "database", "username", "password"],
    optionalFields: ["ssl"],
  },
  {
    id: "mssql",
    name: "SQL Server",
    fields: ["host", "port", "database", "username", "password"],
    optionalFields: ["ssl"],
  },
];

interface ConnectionFormData {
  name: string;
  type: string;
  description: string;
  config: Record<string, string>;
}

const defaultFormData: ConnectionFormData = {
  name: "",
  type: "sqlite",
  description: "",
  config: { path: "" },
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

// Helper function to generate consistent colors for schema names using better hashing
const getSchemaColor = (schemaName: string): "default" | "primary" | "secondary" | "error" | "warning" | "info" | "success" => {
  // Use improved DJB2 hashing algorithm for better distribution across strings
  let hash = 5381;
  for (let i = 0; i < schemaName.length; i++) {
    hash = ((hash << 5) + hash) ^ schemaName.charCodeAt(i);
  }
  // Use colors in order: blue (primary) -> green (success) -> red (error) -> yellow (warning) -> teal (info) -> purple (secondary)
  const colors: Array<"primary" | "success" | "error" | "warning" | "info" | "secondary"> = [
    "primary", // blue
    "success", // green
    "error", // red
    "warning", // yellow/orange
    "info", // teal/light blue
    "secondary", // purple/gray
  ];
  return colors[Math.abs(hash) % colors.length];
};

export function DatabasePage() {
  const {
    connections,
    createConnection,
    updateConnection,
    deleteConnection,
    schema,
    schemaError,
    schemaLoading,
    setActiveConnection,
    loadConnectionSchema,
  } = useStore();

  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ConnectionFormData>(defaultFormData);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency?: number } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [availableSchemas, setAvailableSchemas] = useState<Array<{ name: string; isSelected: boolean }>>([]);
  const [schemasLoaded, setSchemasLoaded] = useState(false);
  const [deleteTargetConnection, setDeleteTargetConnection] = useState<{ id: number; name: string } | null>(null);

  // Load connections once when this page mounts to ensure fresh list
  useEffect(() => {
    const { loadConnections } = useStore.getState();
    loadConnections();
  }, []);

  // Load connection data when selected or when connections array updates
  useEffect(() => {
    if (selectedConnectionId && !isNew) {
      const conn = connections.find((c) => c.id === selectedConnectionId);
      if (conn) {
        let config: Record<string, string> = {};
        if (typeof conn.config === "string") {
          try {
            config = JSON.parse(conn.config);
          } catch {
            config = { path: conn.config };
          }
        } else if (typeof conn.config === "object") {
          config = conn.config as Record<string, string>;
        }

        setFormData({
          name: conn.name,
          type: conn.type,
          description: conn.description || "",
          config,
        });
        setHasChanges(false);

        // Load saved schemas if available
        if (conn.config && conn.type === "postgresql") {
          try {
            const configData = typeof conn.config === "string" ? JSON.parse(conn.config) : conn.config;
            if (configData.schema && typeof configData.schema === "string") {
              const schemas = JSON.parse(configData.schema);
              if (Array.isArray(schemas)) {
                setAvailableSchemas(schemas);
                setSchemasLoaded(true);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }

        // Load schema for this connection
        setActiveConnection(conn.id);
      }
    }
  }, [selectedConnectionId, isNew, connections]);

  // Load schema when schema tab is selected and a connection is active
  useEffect(() => {
    if (tabValue === 1 && selectedConnectionId && !isNew) {
      loadConnectionSchema(selectedConnectionId);
    }
  }, [tabValue, selectedConnectionId, isNew, loadConnectionSchema]);

  const handleNewConnection = () => {
    setSelectedConnectionId(null);
    setIsNew(true);
    setFormData(defaultFormData);
    setTestResult(null);
    setAvailableSchemas([]);
    setSchemasLoaded(false);
    setHasChanges(true);
  };

  const handleSelectConnection = (id: number) => {
    setSelectedConnectionId(id);
    setIsNew(false);
    setTestResult(null);
  };

  const handleTypeChange = (type: string) => {
    const typeConfig = DATABASE_TYPES.find((t) => t.id === type);
    const newConfig: Record<string, string> = {};
    typeConfig?.fields.forEach((field) => {
      newConfig[field] = formData.config[field] || "";
    });

    // Set default port
    if (type === "postgresql" && !newConfig.port) newConfig.port = "5432";
    if (type === "mssql" && !newConfig.port) newConfig.port = "1433";

    // Enable SSL by default for PostgreSQL and SQL Server
    if (type === "postgresql" || type === "mssql") {
      newConfig.ssl = "true";
    }

    setFormData((prev) => ({
      ...prev,
      type,
      config: newConfig,
    }));
    setHasChanges(true);
  };

  const handleFieldChange = (field: keyof ConnectionFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleConfigChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [field]: value },
    }));
    setHasChanges(true);
  };

  const handleTestConnection = async () => {
    // Validate required fields for test
    const requiredFields = DATABASE_TYPES.find((t) => t.id === formData.type)?.fields || [];
    const hasAllRequired = requiredFields.every((field) => formData.config[field]?.trim());

    if (!hasAllRequired) {
      setTestResult({
        success: false,
        message: "Please fill in all required connection fields before testing",
      });
      return;
    }

    setTesting(true);

    try {
      // Always test using current form data, not saved connection
      const testPayload: any = {
        type: formData.type,
        ...formData.config,
      };

      const result = await api.testConnectionConfig(testPayload);

      // Ensure we correctly interpret the response
      const success = result.success === true;
      setTestResult({
        success,
        message: success ? "Connection successful!" : result.error || "Connection failed",
        latency: result.latencyMs || 1,
      });

      // For PostgreSQL, fetch available schemas after successful connection
      if (success && formData.type === "postgresql") {
        try {
          const schemas = await api.getPostgreSQLSchemas(testPayload);
          // Transform schema names to schema objects with isSelected = true by default
          const schemaObjects = (schemas || []).map((name: string) => ({ name, isSelected: true }));
          setAvailableSchemas(schemaObjects);
          setSchemasLoaded(true);
        } catch (schemaError) {
          console.error("Failed to fetch schemas:", schemaError);
          setAvailableSchemas([]);
          setSchemasLoaded(true);
        }
      }

      // If this is a saved connection and test succeeded, reload schema to clear previous errors
      if (success && selectedConnectionId && !isNew) {
        await setActiveConnection(selectedConnectionId);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Connection failed";
      setTestResult({
        success: false,
        message: errorMsg,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.type) {
      setTestResult({ success: false, message: "Name and Type are required" });
      return;
    }

    // Check for duplicate connection names when creating new connections
    if (isNew) {
      const duplicateConnection = connections.find((c) => c.name.toLowerCase() === formData.name.toLowerCase());
      if (duplicateConnection) {
        setTestResult({
          success: false,
          message: `A connection named "${formData.name}" already exists. Please use a different name.`,
        });
        return;
      }
    }

    // Validate all required fields are filled
    const requiredFields = DATABASE_TYPES.find((t) => t.id === formData.type)?.fields || [];
    const missingFields = requiredFields.filter((field) => !formData.config[field]?.trim());
    if (missingFields.length > 0) {
      setTestResult({
        success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        // Prepare config with schema data if available
        const configToSave = { ...formData.config };
        if (formData.type === "postgresql" && availableSchemas.length > 0) {
          configToSave.schema = JSON.stringify(availableSchemas);
        }

        // Create connection (single POST call, not duplicate)
        const newConn = await createConnection({
          name: formData.name,
          type: formData.type,
          config: configToSave,
          description: formData.description,
        });
        setSelectedConnectionId(newConn.id);
        setIsNew(false);
        setHasChanges(false);
      } else if (selectedConnectionId) {
        // Update via store action to keep local cache consistent
        const configToUpdate = { ...formData.config };
        // Also save schema selection for PostgreSQL connections
        if (formData.type === "postgresql" && availableSchemas.length > 0) {
          configToUpdate.schema = JSON.stringify(availableSchemas);
        }

        await updateConnection(selectedConnectionId, {
          name: formData.name,
          description: formData.description,
          config: configToUpdate,
        });

        // Use PUT endpoint to update the connection in DataLoom database
        await api.updateConnection(selectedConnectionId, {
          name: formData.name,
          description: formData.description,
          config: configToUpdate as any,
          type: formData.type as any,
        } as any);
        // Just save, don't reload schema - user can click refresh or reselect to reload
        setHasChanges(false);
      }

      setTestResult({ success: true, message: "Connection saved successfully" });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to save connection",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedConnectionId) return;

    // Show confirmation dialog instead of system alert
    const conn = connections.find((c) => c.id === selectedConnectionId);
    if (conn) {
      setDeleteTargetConnection({ id: selectedConnectionId, name: conn.name });
      setDeleteDialogOpen(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetConnection) return;

    try {
      // Delete from memory and database (deleteConnection already makes the API call)
      await deleteConnection(deleteTargetConnection.id);

      setSelectedConnectionId(null);
      setIsNew(false);
      setFormData(defaultFormData);
      setTestResult({ success: true, message: "Connection deleted successfully" });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete connection",
      });
    } finally {
      setDeleteDialogOpen(false);
      setDeleteTargetConnection(null);
    }
  };

  const typeConfig = DATABASE_TYPES.find((t) => t.id === formData.type);

  return (
    <Box sx={{ display: "flex", height: "100%", p: 2, gap: 2 }}>
      {/* Left Panel - Connection List */}
      <Paper sx={{ width: 280, display: "flex", flexDirection: "column" }}>
        <Box sx={{ p: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="h6">Databases</Typography>
          <Tooltip title="Add new connection" arrow>
            <IconButton color="primary" onClick={handleNewConnection}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <List sx={{ flexGrow: 1, overflow: "auto" }}>
          {connections.map((conn) => (
            <ListItemButton
              key={conn.id}
              selected={selectedConnectionId === conn.id && !isNew}
              onClick={() => handleSelectConnection(conn.id)}
            >
              <ListItemIcon>
                <DatabaseIcon color={conn.status === "active" ? "success" : "inherit"} />
              </ListItemIcon>
              <ListItemText primary={conn.name} secondary={conn.type} />
            </ListItemButton>
          ))}
          {connections.length === 0 && (
            <Box sx={{ p: 2, textAlign: "center", color: "text.secondary" }}>
              <Typography variant="body2">No connections</Typography>
              <Typography variant="caption">Click + to add one</Typography>
            </Box>
          )}
        </List>
      </Paper>

      {/* Right Panel - Connection Configuration */}
      <Paper sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selectedConnectionId && !isNew ? (
          <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box sx={{ textAlign: "center", color: "text.secondary" }}>
              <DatabaseIcon sx={{ fontSize: 64, opacity: 0.5, mb: 2 }} />
              <Typography variant="h6">Select a Database</Typography>
              <Typography variant="body2">Choose a connection or create a new one</Typography>
            </Box>
          </Box>
        ) : (
          <>
            <Box
              sx={{ p: 2, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <Typography variant="h6">{isNew ? "New Connection" : formData.name}</Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                {!isNew && (
                  <Tooltip title="Delete connection" arrow>
                    <IconButton color="error" onClick={handleDelete}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Test connection" arrow>
                  <Button
                    variant="outlined"
                    onClick={handleTestConnection}
                    disabled={testing}
                    startIcon={testing ? <CircularProgress size={16} /> : <RefreshIcon />}
                  >
                    Test
                  </Button>
                </Tooltip>

                <Button
                  variant="contained"
                  startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                >
                  Save
                </Button>
              </Box>
            </Box>

            {testResult && (
              <Alert
                severity={testResult.success ? "success" : "error"}
                sx={{ mx: 2, mt: 2 }}
                icon={testResult.success ? <CheckIcon /> : <CloseIcon />}
              >
                {testResult.message}
                {testResult.latency && ` (${testResult.latency}ms)`}
              </Alert>
            )}

            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                <Tab icon={<DatabaseIcon />} iconPosition="start" label="Connection" />
                <Tab icon={<SchemaIcon />} iconPosition="start" label="Schema" disabled={isNew} />
              </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflow: "auto" }}>
              {/* Connection Tab */}
              <TabPanel value={tabValue} index={0}>
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  <Tooltip title="A unique name to identify this connection" arrow placement="top">
                    <TextField
                      label="Connection Name"
                      value={formData.name}
                      onChange={(e) => handleFieldChange("name", e.target.value)}
                      fullWidth
                      required
                    />
                  </Tooltip>

                  <FormControl fullWidth>
                    <Tooltip title="The type of database" arrow placement="top">
                      <InputLabel>Database Type</InputLabel>
                    </Tooltip>
                    <Select value={formData.type} label="Database Type" onChange={(e) => handleTypeChange(e.target.value)}>
                      {DATABASE_TYPES.map((t) => (
                        <MenuItem key={t.id} value={t.id}>
                          {t.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Dynamic Config Fields */}
                  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, gridColumn: "1 / -1" }}>
                    {typeConfig?.fields.map((field) => {
                      const isHostField = field === "host";

                      return (
                        <Box key={field} sx={{ gridColumn: isHostField || formData.type === "sqlite" ? "1 / -1" : "auto" }}>
                          <Tooltip title={getFieldTooltip(field)} arrow placement="top">
                            <TextField
                              label={getFieldLabel(field)}
                              value={formData.config[field] || ""}
                              onChange={(e) => handleConfigChange(field, e.target.value)}
                              fullWidth
                              type={field === "password" ? (showPassword ? "text" : "password") : "text"}
                              InputProps={
                                field === "password"
                                  ? {
                                      endAdornment: (
                                        <InputAdornment position="end">
                                          <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                                            {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                          </IconButton>
                                        </InputAdornment>
                                      ),
                                    }
                                  : undefined
                              }
                            />
                          </Tooltip>
                        </Box>
                      );
                    })}
                  </Box>

                  <Tooltip title="Optional description for this connection" arrow placement="top">
                    <TextField
                      label="Description"
                      value={formData.description}
                      onChange={(e) => handleFieldChange("description", e.target.value)}
                      fullWidth
                      multiline
                      rows={2}
                      sx={{ gridColumn: "1 / -1" }}
                    />
                  </Tooltip>

                  {/* SSL Checkbox for PostgreSQL and SQL Server */}
                  {(formData.type === "postgresql" || formData.type === "mssql") && (
                    <Box
                      sx={{
                        gridColumn: "1 / -1",
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        p: 1,
                        bgcolor: "#f5f5f5",
                        borderRadius: 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formData.config.ssl === "true"}
                        onChange={(e) => handleConfigChange("ssl", e.target.checked ? "true" : "false")}
                        style={{ cursor: "pointer" }}
                      />
                      <Tooltip
                        title={
                          formData.type === "postgresql"
                            ? "Enable SSL/TLS encryption for the connection. Required if your PostgreSQL server requires encrypted connections (check pg_hba.conf settings)."
                            : "Enable SSL/TLS encryption for the connection. Recommended for SQL Server connections to encrypt data in transit."
                        }
                        arrow
                        placement="top"
                      >
                        <Typography variant="body2">Enable SSL/TLS Encryption</Typography>
                      </Tooltip>
                    </Box>
                  )}

                  {/* Schema Selection for PostgreSQL - Show for existing connections or after test */}
                  {formData.type === "postgresql" && schemasLoaded && availableSchemas.length > 0 && (
                    <Box sx={{ gridColumn: "1 / -1" }}>
                      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                        Schemas
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        {availableSchemas.map((schemaObj) => (
                          <Box
                            key={schemaObj.name}
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.75,
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={schemaObj.isSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                setAvailableSchemas((prev) =>
                                  prev.map((s) => (s.name === schemaObj.name ? { ...s, isSelected: !s.isSelected } : s)),
                                );
                                setHasChanges(true);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{ cursor: "pointer" }}
                            />
                            <Typography
                              variant="body2"
                              onClick={() => {
                                setAvailableSchemas((prev) =>
                                  prev.map((s) => (s.name === schemaObj.name ? { ...s, isSelected: !s.isSelected } : s)),
                                );
                                setHasChanges(true);
                              }}
                            >
                              {schemaObj.name}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                      {!isNew && (
                        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1 }}>
                          Check or uncheck schemas to filter tables in the Schema tab
                        </Typography>
                      )}
                    </Box>
                  )}

                  {/* For new connections, show message if test hasn't run yet */}
                  {isNew && formData.type === "postgresql" && !schemasLoaded && (
                    <Box sx={{ gridColumn: "1 / -1" }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Click "Test Connection" to load available schemas
                      </Typography>
                    </Box>
                  )}
                </Box>
              </TabPanel>

              {/* Schema Tab */}
              <TabPanel value={tabValue} index={1}>
                {schemaLoading ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 4, justifyContent: "center" }}>
                    <CircularProgress size={24} />
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      Loading schema information from database... This may take a few moments.
                    </Typography>
                  </Box>
                ) : schemaError ? (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Failed to load schema
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      {schemaError}
                    </Typography>
                    <Typography variant="body2">Please check the database connection settings and test the connection again.</Typography>
                  </Alert>
                ) : schema ? (
                  <Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                      <Typography variant="h6">
                        Tables (
                        {formData.type === "postgresql" && availableSchemas.length > 0
                          ? schema.tables.filter((t) =>
                              availableSchemas
                                .filter((s) => s.isSelected)
                                .map((s) => s.name)
                                .includes(t.schema || ""),
                            ).length
                          : schema.tables.length}
                        )
                      </Typography>
                      <Button
                        size="small"
                        startIcon={<RefreshIcon />}
                        onClick={() => selectedConnectionId && setActiveConnection(selectedConnectionId)}
                      >
                        Refresh
                      </Button>
                    </Box>
                    {(formData.type === "postgresql" && availableSchemas.length > 0
                      ? schema.tables.filter((t) =>
                          availableSchemas
                            .filter((s) => s.isSelected)
                            .map((s) => s.name)
                            .includes(t.schema || ""),
                        )
                      : schema.tables
                    ).map((table) => (
                      <Accordion key={table.name}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <TableIcon fontSize="small" />
                            <Typography>{table.name}</Typography>
                            <Chip label={`${table.columns.length} columns`} size="small" />
                            {formData.type === "postgresql" && table.schema && (
                              <Chip label={table.schema} size="small" color={getSchemaColor(table.schema)} variant="outlined" />
                            )}
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Column</TableCell>
                                  <TableCell>Type</TableCell>
                                  <TableCell>Nullable</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {table.columns.map((col) => (
                                  <TableRow key={col.name}>
                                    <TableCell>
                                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                        <Typography variant="body2">{col.name}</Typography>
                                        {col.primaryKey && (
                                          <Chip label="PK" size="small" color="error" variant="filled" sx={{ height: 20 }} />
                                        )}
                                        {col.foreignKey && (
                                          <Chip label="FK" size="small" color="success" variant="filled" sx={{ height: 20 }} />
                                        )}
                                      </Box>
                                    </TableCell>
                                    <TableCell>{col.type}</TableCell>
                                    <TableCell>{col.nullable ? "Yes" : "No"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </AccordionDetails>
                      </Accordion>
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
                    <SchemaIcon sx={{ fontSize: 48, opacity: 0.5, mb: 2 }} />
                    <Typography>No schema loaded</Typography>
                    <Typography variant="body2">Test the connection to load schema</Typography>
                  </Box>
                )}
              </TabPanel>
            </Box>
          </>
        )}
      </Paper>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <WarningIcon sx={{ color: "warning.main" }} />
          Delete Database Connection
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Connection Name:
              </Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 500 }}>{deleteTargetConnection?.name}</Typography>
            </Box>
          </Box>
          <Typography color="error.main" variant="body2" sx={{ mb: 2 }}>
            ⚠️ This action cannot be undone. All related knowledge base entries will also be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete Connection
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    path: "Database Path",
    host: "Host",
    port: "Port",
    database: "Database Name",
    username: "Username",
    password: "Password",
  };
  return labels[field] || field;
}

function getFieldTooltip(field: string): string {
  const tooltips: Record<string, string> = {
    path: "The file path to the SQLite database file (e.g., ./data/mydb.db)",
    host: "The hostname or IP address of the database server",
    port: "The port number the database is listening on",
    database: "The name of the database to connect to",
    username: "The username for authentication",
    password: "The password for authentication",
  };
  return tooltips[field] || "";
}
