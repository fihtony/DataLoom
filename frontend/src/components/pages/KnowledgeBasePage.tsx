// =============================================================================
// Knowledge Base Page - Manage Knowledge Base Entries
// =============================================================================

import { useState, useEffect } from "react";
import {
  Box,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
  Button,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
} from "@mui/material";
import { Search as AnalyzeIcon } from "@mui/icons-material";
import { useStore } from "../../store";
import type { AIAgent } from "../../types";
import { KnowledgeBaseEditor } from "../KnowledgeBaseEditor";
import { AnalysisProgressDialog } from "../AnalysisProgressDialog";
import { api } from "../../services/api";

export function KnowledgeBasePage() {
  const { connections, agents } = useStore();

  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [agentModels, setAgentModels] = useState<Array<{ id: string; name: string }>>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [editorUserInput, setEditorUserInput] = useState<string>("");
  const [editorUploadedFiles, setEditorUploadedFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [switchDatabaseDialogOpen, setSwitchDatabaseDialogOpen] = useState(false);
  const [pendingConnectionId, setPendingConnectionId] = useState<number | null>(null);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [analysisSessionId, setAnalysisSessionId] = useState<string | null>(null);
  const [cancelledByUser, setCancelledByUser] = useState(false);

  // Load agent models when selected agent changes
  useEffect(() => {
    const loadModels = async () => {
      if (!selectedAgent) {
        setAgentModels([]);
        setSelectedModel(null);
        return;
      }

      try {
        const models = await api.getModelsFromAgent(selectedAgent);
        setAgentModels(models);
        
        // Use the agent's saved model if available, otherwise use the first model
        if (selectedAgent.model && models.find((m) => m.id === selectedAgent.model)) {
          setSelectedModel(selectedAgent.model);
        } else if (models.length > 0) {
          // Fallback to first model only if agent's model is not in the list
          setSelectedModel(models[0].id);
        } else {
          setSelectedModel(null);
        }
      } catch (error) {
        console.error("Failed to load agent models:", error);
        setAgentModels([]);
        // Still try to use agent's saved model even if fetching models failed
        if (selectedAgent.model) {
          setAgentModels([{ id: selectedAgent.model, name: selectedAgent.model }]);
          setSelectedModel(selectedAgent.model);
        } else {
          setSelectedModel(null);
        }
      }
    };

    loadModels();
  }, [selectedAgent]);

  // Handle analyze button - complete analysis process with progress tracking
  const handleAnalyze = async () => {
    if (!selectedConnectionId || !selectedAgent || !selectedModel) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setProgressDialogOpen(true);
    setCurrentPhase(0);
    setElapsedSeconds(0);

    // Create abort controller for cancellation
    const controller = new AbortController();
    setAbortController(controller);

    // Start timer
    const timerInterval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    // Initialize polling interval variable
    let pollingInterval: number | null = null;

    try {
      // Call analysis with AI, backend will fetch schema and run analysis
      console.log("Starting 3-phase AI analysis...");
      const sessionId = `session_${selectedConnectionId}_${Date.now()}`;
      setAnalysisSessionId(sessionId);
      setCancelledByUser(false);

      // Start progress polling
      console.log("[POLLING] Starting progress polling for analysis...");
      pollingInterval = setInterval(async () => {
        try {
          const status = await api.getAnalysisStatus(selectedConnectionId, sessionId);
          if (status.found) {
            console.log(`[PROGRESS UPDATE] Phase: ${status.currentPhase}/4, Phases:`, status.phases);
            setCurrentPhase((status.currentPhase || 0) as 0 | 1 | 2 | 3 | 4);
          } else {
            // Analysis completed or not found
            console.log("[POLLING] Analysis session not found or completed");
          }
        } catch (error) {
          console.warn("[POLLING] Error fetching status:", error);
        }
      }, 5000); // Poll every 5 seconds

      const result = await api.analyzeSchema(
        selectedConnectionId,
        {
          userInput: editorUserInput,
          files: editorUploadedFiles,
          model: selectedModel,
          agentId: selectedAgent.id.toString(),
          agentProvider: selectedAgent.provider,
          sessionId,
        },
        (phase: number) => {
          console.log(`[CALLBACK] Phase update: ${phase}`);
          setCurrentPhase(phase as 0 | 1 | 2 | 3 | 4);
        },
        controller,
      );

      // Stop polling
      if (pollingInterval) {
        clearInterval(pollingInterval);
        console.log("[POLLING] Stopped polling - analysis response received");
      }

      // Update phase based on response phases status
      if (result.phases) {
        console.log("[RESPONSE] Analysis phases:", result.phases);
        // Phase 1 completed
        if (result.phases.phase1.includes("✓")) {
          console.log("[PHASE UPDATE] Setting phase to 2 (Phase 2 in progress)");
          setCurrentPhase(2);
        }
        // Phase 2 completed
        if (result.phases.phase2.includes("✓")) {
          console.log("[PHASE UPDATE] Setting phase to 3 (Phase 3 in progress)");
          setCurrentPhase(3);
        }
        // Phase 3 completed
        if (result.phases.phase3.includes("✓")) {
          setCurrentPhase(4);
        }
      }

      if (result.success && result.analysis) {
        console.log("Analysis completed successfully");
        setAnalysisResult(result.analysis);
        setCurrentPhase(4);
        // Auto-close dialog after a short delay to show completion
        setTimeout(() => {
          handleProgressDialogClose();
        }, 1000);
      } else {
        throw new Error(result.error || "Analysis failed");
      }
    } catch (error) {
      // Check if error is from user cancellation
      if (error instanceof Error && error.name === "AbortError") {
        // User cancelled the analysis
        if (cancelledByUser) {
          console.log("Analysis cancelled by user");
          setAnalysisError("Analysis cancelled by user");
        } else {
          // Network error or other abort
          console.error("Analysis aborted:", error.message);
          setAnalysisError("Analysis was aborted");
        }
      } else {
        const errorMsg = error instanceof Error ? error.message : "Analysis failed";
        console.error("Analysis error:", errorMsg);
        setAnalysisError(errorMsg);
      }
      setProgressDialogOpen(false);
    } finally {
      setIsAnalyzing(false);
      clearInterval(timerInterval);
      if (pollingInterval) {
        clearInterval(pollingInterval);
        console.log("[POLLING] Cleared polling interval in finally");
      }
      setAnalysisSessionId(null);
    }
  };

  // Handle analysis cancellation
  const handleCancelAnalysis = async () => {
    setCancelledByUser(true);

    // Send cancellation signal to backend
    if (analysisSessionId && selectedConnectionId) {
      try {
        console.log(`Sending cancellation signal for session: ${analysisSessionId}`);
        await api.cancelAnalysis(selectedConnectionId, analysisSessionId);
      } catch (error) {
        console.error("Failed to send cancellation signal to backend:", error);
      }
    }

    // Abort the client-side request
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }

    setProgressDialogOpen(false);
    setCurrentPhase(0);
    setElapsedSeconds(0);
    setIsAnalyzing(false);
    setAnalysisSessionId(null);
  };

  // Handle progress dialog closing (when user clicks Close on completed dialog)
  const handleProgressDialogClose = () => {
    setProgressDialogOpen(false);
    setCurrentPhase(0);
    setElapsedSeconds(0);
    setAnalysisSessionId(null);
    setCancelledByUser(false);
  };

  // Handle switching database - confirm with user if there's unsaved data
  const handleSwitchDatabase = (reset: boolean) => {
    if (pendingConnectionId !== null || pendingConnectionId === null) {
      setSelectedConnectionId(pendingConnectionId);
      setAnalysisError(null);
      setAnalysisResult(null);
      if (reset) {
        setEditorUserInput("");
        setEditorUploadedFiles([]);
        // Trigger KnowledgeBaseEditor to reset its internal state
        setResetTrigger((prev) => prev + 1);
      }
    }
    setSwitchDatabaseDialogOpen(false);
    setPendingConnectionId(null);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 2, gap: 2 }}>
      {/* Top Selection Bar - Same layout as ChatPage */}
      <Paper sx={{ p: 1.2 }}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", flexWrap: "wrap", fontSize: "0.75rem" }}>
          {/* Database Connection Dropdown */}
          <FormControl size="small" sx={{ flex: 1, minWidth: 200 }}>
            <Tooltip title="Select a database" arrow placement="top">
              <InputLabel>Database</InputLabel>
            </Tooltip>
            <Select
              value={selectedConnectionId || ""}
              label="Database"
              onChange={(e) => {
                const id = e.target.value as number;
                // Check if there's user input or uploaded files
                if (editorUserInput.trim() || editorUploadedFiles.length > 0) {
                  // Show confirmation dialog
                  setPendingConnectionId(id || null);
                  setSwitchDatabaseDialogOpen(true);
                } else {
                  // No user data, proceed directly
                  setSelectedConnectionId(id || null);
                  setAnalysisError(null);
                  setAnalysisResult(null);
                }
              }}
            >
              <MenuItem value="">
                <em>Select database...</em>
              </MenuItem>
              {connections.map((conn) => (
                <MenuItem key={conn.id} value={conn.id}>
                  {conn.name} ({conn.type})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Agent Dropdown */}
          <FormControl size="small" sx={{ flex: 1, minWidth: 200 }}>
            <Tooltip title="Select an AI agent" arrow placement="top">
              <InputLabel>AI Agent</InputLabel>
            </Tooltip>
            <Select
              value={selectedAgent?.id || ""}
              label="AI Agent"
              onChange={(e) => {
                const agent = agents.find((a) => a.id === e.target.value);
                setSelectedAgent(agent || null);
              }}
            >
              {agents.map((agent) => (
                <MenuItem key={agent.id} value={agent.id}>
                  {agent.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Model Dropdown */}
          <FormControl size="small" sx={{ flex: 1, minWidth: 200 }} disabled={!selectedAgent || agentModels.length === 0}>
            {selectedAgent && agentModels.length === 0 ? (
              <Tooltip title="Loading models..." arrow placement="top">
                <span>
                  <InputLabel>Model</InputLabel>
                </span>
              </Tooltip>
            ) : (
              <Tooltip title="Select a model" arrow placement="top">
                <span>
                  <InputLabel>Model</InputLabel>
                </span>
              </Tooltip>
            )}
            <Select
              value={selectedModel || ""}
              label="Model"
              onChange={(e) => {
                setSelectedModel(e.target.value as string);
              }}
              disabled={!selectedAgent || agentModels.length === 0}
            >
              {agentModels.map((model) => (
                <MenuItem key={model.id} value={model.id}>
                  {model.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Analyze Button */}
          {!selectedConnectionId || !selectedAgent || !selectedModel || isAnalyzing ? (
            <Tooltip
              title={
                !selectedConnectionId
                  ? "Select a database"
                  : !selectedAgent
                    ? "Select an AI agent"
                    : !selectedModel
                      ? "Select a model"
                      : "Analyzing..."
              }
              arrow
            >
              <span>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleAnalyze}
                  disabled={!selectedConnectionId || !selectedAgent || !selectedModel || isAnalyzing}
                  startIcon={isAnalyzing ? <CircularProgress size={20} /> : <AnalyzeIcon />}
                  sx={{ minWidth: 150, fontSize: "1rem", fontWeight: "bold", height: 40 }}
                >
                  {isAnalyzing ? "Analyzing..." : "Analyze"}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title="Use AI to analyze the database schema" arrow>
              <span>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleAnalyze}
                  disabled={!selectedConnectionId || !selectedAgent || !selectedModel || isAnalyzing}
                  startIcon={isAnalyzing ? <CircularProgress size={20} /> : <AnalyzeIcon />}
                  sx={{ minWidth: 150, fontSize: "1rem", fontWeight: "bold", height: 40 }}
                >
                  {isAnalyzing ? "Analyzing..." : "Analyze"}
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Paper>

      {/* Error Alert */}
      {analysisError && (
        <Alert severity="error" onClose={() => setAnalysisError(null)}>
          {analysisError}
        </Alert>
      )}

      {/* Knowledge Base Editor - Scrollable */}
      <Paper sx={{ flexGrow: 1, overflow: "auto", display: "flex", flexDirection: "column", p: 2 }}>
        {selectedConnectionId ? (
          <KnowledgeBaseEditor
            key={`kb-editor-${resetTrigger}`}
            connectionId={selectedConnectionId}
            preloadedAnalysis={analysisResult}
            onUserInputChange={setEditorUserInput}
            onFilesChange={setEditorUploadedFiles}
          />
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "text.secondary" }}>
            Select a database to get started
          </Box>
        )}
      </Paper>

      {/* Switch Database Confirmation Dialog */}
      <Dialog open={switchDatabaseDialogOpen} onClose={() => setSwitchDatabaseDialogOpen(false)}>
        <DialogTitle>Switch Database?</DialogTitle>
        <DialogContent sx={{ minWidth: "400px" }}>
          <Box sx={{ pt: 2, pb: 1 }}>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              You have unsaved data in the editor:
            </Typography>
            {editorUserInput.trim() && (
              <Typography variant="body2" color="textSecondary" sx={{ ml: 2, mb: 0.5 }}>
                • User input text
              </Typography>
            )}
            {editorUploadedFiles.length > 0 && (
              <Typography variant="body2" color="textSecondary" sx={{ ml: 2, mb: 1.5 }}>
                • {editorUploadedFiles.length} file(s) uploaded
              </Typography>
            )}
            <Typography variant="body2" sx={{ mt: 2 }}>
              Would you like to keep or reset this data?
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSwitchDatabaseDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => handleSwitchDatabase(false)} variant="outlined">
            Keep Data
          </Button>
          <Button onClick={() => handleSwitchDatabase(true)} variant="contained" color="warning">
            Reset Data
          </Button>
        </DialogActions>
      </Dialog>

      {/* Analysis Progress Dialog */}
      <AnalysisProgressDialog
        open={progressDialogOpen}
        currentPhase={currentPhase}
        elapsedSeconds={elapsedSeconds}
        onCancel={handleCancelAnalysis}
      />
    </Box>
  );
}
