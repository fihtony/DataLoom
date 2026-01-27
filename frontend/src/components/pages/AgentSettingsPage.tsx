// =============================================================================
// Agent Settings Page - Manage AI Agents
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
  Slider,
  Divider,
  Tooltip,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  SmartToy as AgentIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  HelpOutline as HelpIcon,
  WarningAmber as WarningIcon,
} from "@mui/icons-material";
import { useStore } from "../../store";
import type { AIAgent, AIModel } from "../../types";
import { api } from "../../services/api";

// Provider parameter support configuration
interface ProviderConfig {
  id: string;
  name: string;
  defaultUrl: string;
  needsApiKey: boolean;
  recommendedMaxTokens: number;
  maxOutputTokens: number;
  supportedParams: {
    temperature: boolean;
    max_tokens: boolean;
    top_p: boolean;
    frequency_penalty: boolean;
    presence_penalty: boolean;
  };
}

// Provider configuration with supported parameters and recommended max tokens
const PROVIDERS: ProviderConfig[] = [
  {
    id: "copilot",
    name: "GitHub Copilot",
    defaultUrl: "http://localhost:1287",
    needsApiKey: false,
    recommendedMaxTokens: 6000,
    maxOutputTokens: 16384,
    supportedParams: {
      temperature: false,
      max_tokens: true,
      top_p: false,
      frequency_penalty: false,
      presence_penalty: false,
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultUrl: "https://api.openai.com/v1",
    needsApiKey: true,
    recommendedMaxTokens: 8000,
    maxOutputTokens: 16384,
    supportedParams: {
      temperature: true,
      max_tokens: true,
      top_p: true,
      frequency_penalty: true,
      presence_penalty: true,
    },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultUrl: "https://api.anthropic.com",
    needsApiKey: true,
    recommendedMaxTokens: 6000,
    maxOutputTokens: 8192,
    supportedParams: {
      temperature: true,
      max_tokens: true,
      top_p: true,
      frequency_penalty: false,
      presence_penalty: false,
    },
  },
  {
    id: "zhipu",
    name: "Zhipu AI (智谱)",
    defaultUrl: "https://open.bigmodel.cn/api/paas/v4",
    needsApiKey: true,
    recommendedMaxTokens: 12000,
    maxOutputTokens: 32768,
    supportedParams: {
      temperature: true,
      max_tokens: true,
      top_p: true,
      frequency_penalty: false,
      presence_penalty: false,
    },
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    defaultUrl: "",
    needsApiKey: true,
    recommendedMaxTokens: 8000,
    maxOutputTokens: 16384,
    supportedParams: {
      temperature: true,
      max_tokens: true,
      top_p: true,
      frequency_penalty: true,
      presence_penalty: true,
    },
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    defaultUrl: "http://localhost:11434/v1",
    needsApiKey: false,
    recommendedMaxTokens: 8000,
    maxOutputTokens: 4096,
    supportedParams: {
      temperature: true,
      max_tokens: true,
      top_p: true,
      frequency_penalty: false,
      presence_penalty: false,
    },
  },
  {
    id: "gemini",
    name: "Google Gemini",
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsApiKey: true,
    recommendedMaxTokens: 8000,
    maxOutputTokens: 32768,
    supportedParams: {
      temperature: true,
      max_tokens: true,
      top_p: true,
      frequency_penalty: false,
      presence_penalty: false,
    },
  },
  {
    id: "custom",
    name: "Custom",
    defaultUrl: "",
    needsApiKey: true,
    recommendedMaxTokens: 8000,
    maxOutputTokens: 16000,
    supportedParams: {
      temperature: true,
      max_tokens: true,
      top_p: true,
      frequency_penalty: true,
      presence_penalty: true,
    },
  },
];

interface AgentFormData {
  name: string;
  provider: string;
  api_base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  is_default: number;
  description: string;
}

const defaultFormData: AgentFormData = {
  name: "",
  provider: "copilot",
  api_base_url: "http://localhost:1287",
  api_key: "",
  model: "",
  temperature: 0.1,
  max_tokens: 6000,
  top_p: 0.9,
  frequency_penalty: 0,
  presence_penalty: 0,
  is_default: 0,
  description: "",
};

export function AgentSettingsPage() {
  const { agents, loadAgents, createAgent, updateAgent, deleteAgent } = useStore();

  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [formData, setFormData] = useState<AgentFormData>(defaultFormData);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetAgent, setDeleteTargetAgent] = useState<{ id: number; name: string } | null>(null);

  // Load agents on component mount if not already loaded
  useEffect(() => {
    if (agents.length === 0) {
      loadAgents();
    }
  }, []);

  // Auto-select default agent on mount or when agents change
  useEffect(() => {
    if (!selectedAgentId && !isNew && agents.length > 0) {
      const defaultAgent = agents.find((a) => a.is_default === 1);
      if (defaultAgent) {
        handleSelectAgent(defaultAgent.id);
      }
    }
  }, [agents, selectedAgentId, isNew]);

  // Load agent data when selected
  useEffect(() => {
    if (selectedAgentId && !isNew) {
      const agent = agents.find((a) => a.id === selectedAgentId);
      if (agent) {
        setFormData({
          name: agent.name,
          provider: agent.provider,
          api_base_url: agent.api_base_url,
          api_key: agent.api_key || "",
          model: agent.model || "",
          temperature: agent.temperature,
          max_tokens: agent.max_tokens,
          top_p: agent.top_p,
          frequency_penalty: agent.frequency_penalty,
          presence_penalty: agent.presence_penalty,
          is_default: agent.is_default,
          description: agent.description || "",
        });
        setHasChanges(false);
        // Load models for this agent
        loadModels(agent);
      }
    }
  }, [selectedAgentId, agents, isNew]);

  const loadModels = async (agent: Partial<AIAgent>) => {
    if (!agent.api_base_url) {
      setAvailableModels([]);
      return;
    }

    setTesting(true);
    try {
      const tempAgent = { ...agent } as AIAgent;
      const models = await api.getModelsFromAgent(tempAgent);
      setAvailableModels(models);

      // If current model is not in the loaded models, clear it
      if (models.length > 0 && formData.model && !models.find((m) => m.id === formData.model)) {
        setFormData((prev) => ({ ...prev, model: "" }));
      }

      setTestResult({ success: true, message: `Found ${models.length} models` });
    } catch (error) {
      setAvailableModels([]);
      setFormData((prev) => ({ ...prev, model: "" }));
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to load models",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleNewAgent = () => {
    setSelectedAgentId(null);
    setIsNew(true);
    setFormData(defaultFormData);
    setAvailableModels([]);
    setTestResult(null);
    setHasChanges(true);
  };

  const handleSelectAgent = (id: number) => {
    setSelectedAgentId(id);
    setIsNew(false);
    setTestResult(null);
  };

  const handleProviderChange = (provider: string) => {
    const providerConfig = PROVIDERS.find((p) => p.id === provider);
    setFormData((prev) => ({
      ...prev,
      provider,
      api_base_url: providerConfig?.defaultUrl || prev.api_base_url,
      api_key: providerConfig?.needsApiKey ? prev.api_key : "",
      max_tokens: providerConfig?.recommendedMaxTokens || prev.max_tokens,
    }));
    setAvailableModels([]);
    setHasChanges(true);
  };

  const handleFieldChange = (field: keyof AgentFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const tempAgent: AIAgent = {
        id: 0,
        name: formData.name,
        provider: formData.provider,
        api_base_url: formData.api_base_url,
        api_key: formData.api_key,
        temperature: formData.temperature,
        max_tokens: formData.max_tokens,
        top_p: formData.top_p,
        frequency_penalty: formData.frequency_penalty,
        presence_penalty: formData.presence_penalty,
        is_default: formData.is_default,
        is_active: 1,
      };

      const result = await api.testAgentConnection(tempAgent);

      if (result.success && result.models) {
        setAvailableModels(result.models);
        setTestResult({ success: true, message: `Connected! Found ${result.models.length} models` });
      } else {
        setTestResult({ success: false, message: result.error || "Connection failed" });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.api_base_url) {
      setTestResult({ success: false, message: "Name and Base URL are required" });
      return;
    }

    setSaving(true);
    try {
      const agentData: Partial<AIAgent> = {
        name: formData.name,
        provider: formData.provider,
        api_base_url: formData.api_base_url,
        api_key: formData.api_key || undefined,
        model: formData.model || undefined,
        temperature: formData.temperature,
        max_tokens: formData.max_tokens,
        top_p: formData.top_p,
        frequency_penalty: formData.frequency_penalty,
        presence_penalty: formData.presence_penalty,
        is_default: formData.is_default,
        description: formData.description || undefined,
      };

      if (isNew) {
        const newAgent = await createAgent(agentData);
        setSelectedAgentId(newAgent.id);
        setIsNew(false);
      } else if (selectedAgentId) {
        await updateAgent(selectedAgentId, agentData);
      }

      setHasChanges(false);
      setTestResult({ success: true, message: "Agent saved successfully" });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to save agent",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedAgentId) return;

    // Show confirmation dialog instead of system alert
    const agent = agents.find((a) => a.id === selectedAgentId);
    if (agent) {
      setDeleteTargetAgent({ id: selectedAgentId, name: agent.name });
      setDeleteDialogOpen(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetAgent) return;

    try {
      await deleteAgent(deleteTargetAgent.id);
      setSelectedAgentId(null);
      setIsNew(false);
      setFormData(defaultFormData);
      setTestResult({ success: true, message: "Agent deleted successfully" });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete agent",
      });
    } finally {
      setDeleteDialogOpen(false);
      setDeleteTargetAgent(null);
    }
  };

  const providerConfig = PROVIDERS.find((p) => p.id === formData.provider);

  return (
    <Box sx={{ display: "flex", height: "100%", p: 2, gap: 2 }}>
      {/* Left Panel - Agent List */}
      <Paper sx={{ width: 280, display: "flex", flexDirection: "column" }}>
        <Box sx={{ p: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="h6">AI Agents</Typography>
          <Tooltip title="Add new agent" arrow>
            <IconButton color="primary" onClick={handleNewAgent}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <List sx={{ flexGrow: 1, overflow: "auto" }}>
          {agents.map((agent) => (
            <ListItemButton key={agent.id} selected={selectedAgentId === agent.id && !isNew} onClick={() => handleSelectAgent(agent.id)}>
              <ListItemIcon>
                <AgentIcon color={agent.is_default ? "primary" : "inherit"} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "space-between" }}>
                    <span>{agent.name}</span>
                    {agent.is_default === 1 && (
                      <Chip label="Default" size="small" color="success" variant="outlined" sx={{ fontSize: "0.75rem", height: 20 }} />
                    )}
                  </Box>
                }
                secondary={agent.model}
              />
            </ListItemButton>
          ))}
          {agents.length === 0 && (
            <Box sx={{ p: 2, textAlign: "center", color: "text.secondary" }}>
              <Typography variant="body2">No agents configured</Typography>
              <Typography variant="caption">Click + to add one</Typography>
            </Box>
          )}
        </List>
      </Paper>

      {/* Right Panel - Agent Configuration */}
      <Paper sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selectedAgentId && !isNew ? (
          <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box sx={{ textAlign: "center", color: "text.secondary" }}>
              <AgentIcon sx={{ fontSize: 64, opacity: 0.5, mb: 2 }} />
              <Typography variant="h6">Select an Agent</Typography>
              <Typography variant="body2">Choose an agent from the list or create a new one</Typography>
            </Box>
          </Box>
        ) : (
          <>
            <Box
              sx={{ p: 2, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <Typography variant="h6">{isNew ? "New Agent" : `${formData.name}`}</Typography>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                {!isNew && (
                  <>
                    <Tooltip title={formData.is_default ? "Unset as default" : "Set as default"} arrow>
                      <IconButton
                        onClick={async () => {
                          const newValue = formData.is_default ? 0 : 1;
                          setFormData((prev) => ({ ...prev, is_default: newValue }));
                          setSaving(true);
                          try {
                            if (selectedAgentId) {
                              await updateAgent(selectedAgentId, { is_default: newValue });
                              setHasChanges(false);
                              setTestResult({ success: true, message: "Default agent updated" });
                            }
                          } catch (error) {
                            setTestResult({
                              success: false,
                              message: error instanceof Error ? error.message : "Failed to update default agent",
                            });
                            setFormData((prev) => ({ ...prev, is_default: formData.is_default }));
                          } finally {
                            setSaving(false);
                          }
                        }}
                        color={formData.is_default ? "primary" : "default"}
                      >
                        {formData.is_default ? <StarIcon /> : <StarBorderIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete agent" arrow>
                      <IconButton color="error" onClick={handleDelete}>
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
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
              <Alert severity={testResult.success ? "success" : "error"} sx={{ mx: 2, mt: 2 }}>
                {testResult.message}
              </Alert>
            )}

            <Box sx={{ flexGrow: 1, overflow: "auto", p: 2 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {/* Basic Info */}
                <Tooltip title="A unique name to identify this agent" arrow placement="top">
                  <TextField
                    label="Agent Name"
                    value={formData.name}
                    onChange={(e) => handleFieldChange("name", e.target.value)}
                    fullWidth
                    required
                  />
                </Tooltip>

                <FormControl fullWidth>
                  <Tooltip title="The AI provider for this agent" arrow placement="top">
                    <InputLabel>Provider</InputLabel>
                  </Tooltip>
                  <Select value={formData.provider} label="Provider" onChange={(e) => handleProviderChange(e.target.value)}>
                    {PROVIDERS.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Tooltip title="The base URL for the AI API endpoint" arrow placement="top">
                  <TextField
                    label="API Base URL"
                    value={formData.api_base_url}
                    onChange={(e) => handleFieldChange("api_base_url", e.target.value)}
                    fullWidth
                    required
                    placeholder={providerConfig?.defaultUrl}
                  />
                </Tooltip>

                <Tooltip
                  title={providerConfig?.needsApiKey ? "Your API key for authentication" : "Not required for this provider"}
                  arrow
                  placement="top"
                >
                  <TextField
                    label="API Key"
                    value={formData.api_key}
                    onChange={(e) => handleFieldChange("api_key", e.target.value)}
                    fullWidth
                    type={showApiKey ? "text" : "password"}
                    disabled={!providerConfig?.needsApiKey}
                    placeholder={providerConfig?.needsApiKey ? "Enter API key" : "Not required"}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end">
                            {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Tooltip>

                {/* Model Selection with Test */}
                <Box sx={{ gridColumn: "1 / -1", display: "flex", gap: 1, alignItems: "flex-start" }}>
                  <FormControl sx={{ flex: 1 }}>
                    <Tooltip title="The default model to use. Click 'Get Models' to fetch available models" arrow placement="top">
                      <InputLabel>Default Model</InputLabel>
                    </Tooltip>
                    <Select
                      value={formData.model || ""}
                      label="Default Model"
                      onChange={(e) => handleFieldChange("model", e.target.value)}
                      disabled={availableModels.length === 0 && !formData.model}
                    >
                      {availableModels.length === 0 && formData.model && (
                        <MenuItem value={formData.model}>{formData.model} (previously selected)</MenuItem>
                      )}
                      {availableModels.map((model) => (
                        <MenuItem key={model.id} value={model.id}>
                          {model.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Tooltip title="Test connection and fetch available models" arrow>
                    <Button
                      variant="outlined"
                      onClick={handleTestConnection}
                      disabled={testing || !formData.api_base_url}
                      startIcon={testing ? <CircularProgress size={16} /> : <RefreshIcon />}
                      sx={{ minWidth: 140, height: 56 }}
                    >
                      Get Models
                    </Button>
                  </Tooltip>
                </Box>

                {/* Advanced Parameters */}
                {providerConfig && (
                  <>
                    <Box sx={{ gridColumn: "1 / -1" }}>
                      <Divider sx={{ my: 2 }}>
                        <Chip label="Advanced Parameters" size="small" />
                      </Divider>
                    </Box>

                    <Box sx={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                      {/* Temperature - Conditional display based on provider support */}
                      {providerConfig.supportedParams.temperature && (
                        <Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, justifyContent: "space-between" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Typography variant="body2">Temperature</Typography>
                              <Tooltip
                                title="Controls randomness in responses. Lower values = more accurate SQL, Higher values = more creative. Recommended: 0.0-0.3 for database queries"
                                arrow
                                placement="top"
                              >
                                <HelpIcon sx={{ fontSize: 18, cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                              {formData.temperature}
                            </Typography>
                          </Box>

                          <Slider
                            value={formData.temperature}
                            onChange={(_, value) => handleFieldChange("temperature", value)}
                            min={0}
                            max={1}
                            step={0.05}
                            marks={[
                              { value: 0, label: "0" },
                              { value: 0.3, label: "0.3" },
                              { value: 0.6, label: "0.6" },
                              { value: 1, label: "1" },
                            ]}
                          />
                        </Box>
                      )}

                      {/* Max Tokens - Conditional display based on provider support */}
                      {providerConfig.supportedParams.max_tokens && (
                        <Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, justifyContent: "space-between" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Typography variant="body2">Max Tokens</Typography>
                              <Tooltip title={`Maximum number of tokens for SQL query and explanation. Recommended: ${providerConfig.recommendedMaxTokens} tokens for ${providerConfig.name} (Max: ${providerConfig.maxOutputTokens})`} arrow placement="top">
                                <HelpIcon sx={{ fontSize: 18, cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: "bold", color: formData.max_tokens > providerConfig.maxOutputTokens ? "error.main" : "inherit" }}>
                              {formData.max_tokens}
                            </Typography>
                          </Box>
                          <TextField
                            type="number"
                            value={formData.max_tokens}
                            onChange={(e) => handleFieldChange("max_tokens", parseInt(e.target.value) || providerConfig.recommendedMaxTokens)}
                            fullWidth
                            size="small"
                            inputProps={{ 
                              min: 100, 
                              max: providerConfig.maxOutputTokens 
                            }}
                            error={formData.max_tokens > providerConfig.maxOutputTokens}
                            helperText={formData.max_tokens > providerConfig.maxOutputTokens ? `Exceeds ${providerConfig.name} maximum of ${providerConfig.maxOutputTokens}` : ""}
                          />
                        </Box>
                      )}

                      {/* Top P - Conditional display based on provider support */}
                      {providerConfig.supportedParams.top_p && (
                        <Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, justifyContent: "space-between" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Typography variant="body2">Top P</Typography>
                              <Tooltip title="Nucleus sampling - cumulative probability threshold. Lower values = more deterministic SQL, Higher = more varied. Recommended: 0.9-0.95 for database queries" arrow placement="top">
                                <HelpIcon sx={{ fontSize: 18, cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                              {formData.top_p}
                            </Typography>
                          </Box>
                          <Slider
                            value={formData.top_p}
                            onChange={(_, value) => handleFieldChange("top_p", value)}
                            min={0.5}
                            max={1}
                            step={0.05}
                            marks={[
                              { value: 0.5, label: "0.5" },
                              { value: 0.75, label: "0.75" },
                              { value: 0.9, label: "0.9" },
                              { value: 1, label: "1" },
                            ]}
                          />
                        </Box>
                      )}

                      {/* Frequency Penalty - Conditional display based on provider support */}
                      {providerConfig.supportedParams.frequency_penalty && (
                        <Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, justifyContent: "space-between" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Typography variant="body2">Frequency Penalty</Typography>
                              <Tooltip title="Reduces repetition by penalizing tokens based on frequency. Recommended: 0 for SQL queries" arrow placement="top">
                                <HelpIcon sx={{ fontSize: 18, cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                              {formData.frequency_penalty}
                            </Typography>
                          </Box>
                          <Slider
                            value={formData.frequency_penalty}
                            onChange={(_, value) => handleFieldChange("frequency_penalty", value)}
                            min={0}
                            max={2}
                            step={0.1}
                          />
                        </Box>
                      )}

                      {/* Presence Penalty - Conditional display based on provider support */}
                      {providerConfig.supportedParams.presence_penalty && (
                        <Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, justifyContent: "space-between" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Typography variant="body2">Presence Penalty</Typography>
                              <Tooltip title="Encourages new topics by penalizing tokens that have appeared. Recommended: 0 for SQL queries" arrow placement="top">
                                <HelpIcon sx={{ fontSize: 18, cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                              {formData.presence_penalty}
                            </Typography>
                          </Box>
                          <Slider
                            value={formData.presence_penalty}
                            onChange={(_, value) => handleFieldChange("presence_penalty", value)}
                            min={0}
                            max={2}
                            step={0.1}
                          />
                        </Box>
                      )}

                      {/* Show unsupported parameters message if no advanced params are supported */}
                      {!providerConfig.supportedParams.temperature &&
                       !providerConfig.supportedParams.max_tokens &&
                       !providerConfig.supportedParams.top_p &&
                       !providerConfig.supportedParams.frequency_penalty &&
                       !providerConfig.supportedParams.presence_penalty && (
                        <Box sx={{ gridColumn: "1 / -1", p: 2, textAlign: "center", color: "text.secondary" }}>
                          <Typography variant="body2">
                            This provider does not support advanced parameters
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </>
                )}
              </Box>
            </Box>
          </>
        )}
      </Paper>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <WarningIcon sx={{ color: "warning.main" }} />
          Delete AI Agent
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Agent Name:
              </Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 500 }}>{deleteTargetAgent?.name}</Typography>
            </Box>
          </Box>
          <Typography color="error.main" variant="body2" sx={{ mb: 2 }}>
            ⚠️ This action cannot be undone. This agent configuration will be permanently deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete Agent
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
