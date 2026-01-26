// =============================================================================
// Chat Page - Chat with AI Provider
// =============================================================================

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  TextField,
  IconButton,
  CircularProgress,
  Tooltip,
  Chip,
  Avatar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  Send as SendIcon,
  Delete as DeleteIcon,
  LinkOff as DisconnectIcon,
  Link as ConnectIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
} from "@mui/icons-material";
import { useStore } from "../../store";
import { QueryResultVisualizer } from "../QueryResultVisualizer";

export function ChatPage() {
  const {
    connections,
    activeConnectionId,
    connectionSessionId,
    readOnlyStatus: storeReadOnlyStatus,
    setActiveConnection,
    agents,
    selectedAgent,
    selectAgent,
    agentModels,
    selectedModel,
    selectModel,
    messages,
    loadingChat,
    sendMessage,
    clearChatHistory,
    connectDatabase,
    disconnectDatabase,
    resetChatSession,
  } = useStore();

  const [input, setInput] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [readOnlyStatus, setReadOnlyStatus] = useState<"readonly" | "readwrite" | "unknown" | null>(null);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string>("");
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null); // Track when session started
  // Stable connection flag - only set to true on connect, only set to false on explicit disconnect
  const [hasActiveConnection, setHasActiveConnection] = useState(false);
  const [stableReadOnlyStatus, setStableReadOnlyStatus] = useState<"readonly" | "readwrite" | "unknown" | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reset chat session when entering chat page per requirement:
  // "every time when user enter chat with agent page, frontend shall reset all the cached value, clear chat history and start from beginning"
  useEffect(() => {
    resetChatSession();
  }, []);

  // Handle page leave - show confirmation dialog and disconnect
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (connectionSessionId) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [connectionSessionId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Sync connectionStatus with connectionSessionId for reliability
  useEffect(() => {
    if (connectionSessionId && connectionStatus !== "connected") {
      setConnectionStatus("connected");
    } else if (!connectionSessionId && connectionStatus === "connected") {
      setConnectionStatus("idle");
      setReadOnlyStatus(null);
    }
  }, [connectionSessionId, connectionStatus]);

  // Memoize the effective connection state and read-only status for banner stability
  // Use hasActiveConnection as the most stable source
  const isConnected = useMemo(() => {
    // hasActiveConnection is only set/cleared on explicit connect/disconnect
    return hasActiveConnection || connectionStatus === "connected" || !!connectionSessionId;
  }, [hasActiveConnection, connectionStatus, connectionSessionId]);

  const effectiveReadOnlyStatus = useMemo(() => {
    // stableReadOnlyStatus is the most reliable, then store, then local state
    return stableReadOnlyStatus || storeReadOnlyStatus || readOnlyStatus;
  }, [stableReadOnlyStatus, storeReadOnlyStatus, readOnlyStatus]);

  // Auto-dismiss connection message after 5 seconds
  useEffect(() => {
    if (connectionMessage) {
      const timer = setTimeout(() => {
        setConnectionMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [connectionMessage]);

  const handleConnect = async () => {
    if (!activeConnectionId) return;

    // If already connected, disconnect
    if (connectionStatus === "connected") {
      setConnectionStatus("connecting");
      try {
        await disconnectDatabase(connectionSessionId || "");
        setConnectionStatus("idle");
        setReadOnlyStatus(null);
        setConnectionMessage(null);
        setSessionStartTime(null); // Clear session start time on disconnect
        // Clear stable connection state on explicit disconnect
        setHasActiveConnection(false);
        setStableReadOnlyStatus(null);
      } catch (error) {
        setConnectionStatus("error");
        setConnectionMessage({
          success: false,
          message: error instanceof Error ? error.message : "Disconnection failed",
        });
      }
      return;
    }

    setConnectionStatus("connecting");
    setConnectionMessage(null);
    try {
      const result = await connectDatabase(activeConnectionId);
      if (result.success) {
        setConnectionStatus("connected");
        setReadOnlyStatus(result.readOnlyStatus || "unknown");
        setConnectionMessage({ success: true, message: "Database connected successfully" });
        // Don't set session start time here - it will be set when user sends first message
        // Set stable connection state
        setHasActiveConnection(true);
        setStableReadOnlyStatus(result.readOnlyStatus || "unknown");
      } else {
        setConnectionStatus("error");
        setReadOnlyStatus(null);
        setConnectionMessage({ success: false, message: "Failed to connect to database" });
      }
    } catch (error) {
      setConnectionStatus("error");
      setReadOnlyStatus(null);
      setConnectionMessage({
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      });
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loadingChat) return;

    // Validation check
    if (connectionStatus !== "connected") {
      setValidationMessage("Please connect to a database first");
      setValidationDialogOpen(true);
      return;
    }

    if (!selectedAgent) {
      setValidationMessage("Please select an AI Provider");
      setValidationDialogOpen(true);
      return;
    }

    if (!selectedModel) {
      setValidationMessage("Please select a Model");
      setValidationDialogOpen(true);
      return;
    }

    const message = input;
    setInput("");
    
    // Set session start time when user sends first message (if not already set)
    if (!sessionStartTime) {
      setSessionStartTime(new Date());
    }
    
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle clear chat - reset backend session and clear session start time
  // Session start time will be set when user sends first message after clearing
  const handleClearChat = async () => {
    const result = await clearChatHistory();
    if (result.isNewSession) {
      // Clear session start time - it will be set when user sends first message
      setSessionStartTime(null);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 0, position: "relative", overflow: "hidden" }}>
      {/* READ ONLY / READWRITE Status Banner - Always visible when connected */}
      {/* Use sticky positioning to keep it visible during scroll, positioned below AppBar */}
      {isConnected && (
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 1000,
            width: "100%",
            py: 0.5,
            px: 2,
            backgroundColor: effectiveReadOnlyStatus === "readonly" ? "#4caf50" : "#ff9800",
            color: effectiveReadOnlyStatus === "readonly" ? "white" : "#000",
            fontSize: "11px",
            fontWeight: 600,
            textAlign: "center",
            letterSpacing: "0.5px",
            flexShrink: 0,
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)", // Add shadow to distinguish from content
          }}
        >
          {effectiveReadOnlyStatus === "readonly"
            ? "🔒 READ ONLY CONNECTION - Safe to query"
            : "⚠️ CONNECTION HAS WRITE ACCESS - Consider using a read-only database user for safer queries"}
        </Box>
      )}

      {/* Main Content */}
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 2, gap: 2, flex: 1, overflow: "hidden" }}>
        {/* Connection Message Alert - 25% smaller height */}
        {connectionMessage && connectionMessage.success !== true && (
          <Alert
            severity={connectionMessage.success ? "success" : "error"}
            sx={{ mb: 0, fontSize: "0.75rem", py: 0.75, "& .MuiAlert-icon": { fontSize: "1.2rem" } }}
          >
            {connectionMessage.message}
          </Alert>
        )}

        {/* Top Bar - Connection & Agent Selection */}
        <Paper sx={{ p: 1.2 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", flexWrap: "wrap", fontSize: "0.75rem" }}>
            {/* Database Connection Section */}
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", flex: 1, minWidth: 280 }}>
              <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                <Tooltip title="Select a database to query" arrow placement="top">
                  <InputLabel>Database</InputLabel>
                </Tooltip>
                <Select
                  value={activeConnectionId || ""}
                  label="Database"
                  disabled={connectionStatus === "connected"}
                  onChange={(e) => {
                    const id = e.target.value as number;
                    setActiveConnection(id || null);
                    setConnectionStatus("idle");
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
              <Tooltip title={connectionStatus === "connected" ? "Disconnect Database" : "Connect Database"} arrow>
                <span>
                  <Button
                    variant="outlined"
                    color={connectionStatus === "connected" ? "error" : connectionStatus === "error" ? "error" : "primary"}
                    onClick={handleConnect}
                    disabled={!activeConnectionId || connectionStatus === "connecting"}
                    startIcon={
                      connectionStatus === "connecting" ? (
                        <CircularProgress size={16} />
                      ) : connectionStatus === "connected" ? (
                        <DisconnectIcon />
                      ) : (
                        <ConnectIcon />
                      )
                    }
                    sx={{ minWidth: 100, fontSize: "0.85rem", height: 40 }}
                  >
                    {connectionStatus === "connecting" ? "connecting..." : connectionStatus === "connected" ? "Disconnect" : "Connect"}
                  </Button>
                </span>
              </Tooltip>
            </Box>

            {/* Agent & Model Section */}
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", flex: 1, minWidth: 300 }}>
              <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                <Tooltip title="Select an AI provider for conversation" arrow placement="top">
                  <InputLabel>AI Provider</InputLabel>
                </Tooltip>
                <Select
                  value={selectedAgent?.id || ""}
                  label="AI Provider"
                  onChange={(e) => {
                    const agent = agents.find((a) => a.id === e.target.value);
                    selectAgent(agent || null);
                  }}
                >
                  {agents.map((agent) => (
                    <MenuItem key={agent.id} value={agent.id}>
                      {agent.name} {agent.is_default ? "(default)" : ""}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                <Tooltip title="Select a model for this agent" arrow placement="top">
                  <InputLabel>Model</InputLabel>
                </Tooltip>
                <Select
                  value={selectedModel?.id || ""}
                  label="Model"
                  onChange={(e) => {
                    const model = agentModels.find((m) => m.id === e.target.value);
                    selectModel(model || null);
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
            </Box>
          </Box>
        </Paper>

        {/* Chat Messages */}
        <Paper
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Messages Area */}
          <Box
            sx={{
              flexGrow: 1,
              overflow: "auto",
              p: 1,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              fontSize: "0.8rem",
            }}
          >
            {/* Session Start System Message - Only shown after first message is sent */}
            {sessionStartTime && messages.length > 0 && (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-start",
                  mb: 0.5,
                  // Align with agent message content (avatar width 36px + gap 12px = 48px = 6 * 8px)
                  pl: 6,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.disabled",
                    fontSize: "0.7rem",
                    fontStyle: "italic",
                  }}
                >
                  New conversation started at {sessionStartTime.toLocaleTimeString()}
                </Typography>
              </Box>
            )}
            {messages.length === 0 ? (
              <Box
                sx={{
                  flexGrow: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 2,
                  color: "text.secondary",
                }}
              >
                <BotIcon sx={{ fontSize: 64, opacity: 0.5 }} />
                <Typography variant="h6">Start a conversation</Typography>
                <Typography variant="body2">Select a database and AI agent, then ask questions about your data.</Typography>
              </Box>
            ) : (
              messages.map((message) => (
                <Box
                  key={message.id}
                  sx={{
                    display: "flex",
                    gap: 1.5,
                    alignItems: "flex-start",
                    flexDirection: message.role === "user" ? "row-reverse" : "row",
                    pr: message.role === "assistant" ? 4 : 0,
                    pl: message.role === "user" ? 4 : 0,
                  }}
                >
                  <Avatar
                    sx={{
                      bgcolor: message.role === "user" ? "primary.main" : "#1b5e20",
                      width: 36,
                      height: 36,
                      flexShrink: 0,
                    }}
                  >
                    {message.role === "user" ? <PersonIcon /> : <BotIcon />}
                  </Avatar>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      maxWidth: "calc(100% - 72px)",
                    }}
                  >
                    {/* Message bubble with content */}
                    <Paper
                      elevation={1}
                      sx={{
                        p: 1.5,
                        bgcolor: message.role === "user" ? "primary.light" : "grey.100",
                        color: message.role === "user" ? "primary.contrastText" : "text.primary",
                        borderRadius: 2,
                        display: "inline-block",
                        maxWidth: "100%",
                        width: "auto",
                      }}
                    >
                      {message.isLoading ? (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <CircularProgress size={20} />
                          <Typography variant="body2" sx={{ fontSize: "0.85rem" }}>
                            {message.content}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontSize: "0.85rem",
                          }}
                        >
                          {message.content}
                        </Typography>
                      )}
                      <Typography variant="caption" sx={{ display: "block", mt: 0.5, opacity: 0.7, fontSize: "0.6rem" }}>
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </Typography>
                    </Paper>

                    {/* Query Result Visualizer - Show if SQL exists or result exists */}
                    {message.queryResult && message.role === "assistant" && (
                      <Box sx={{ mt: 1.5 }}>
                        <QueryResultVisualizer result={message.queryResult} explanation={undefined} />
                      </Box>
                    )}
                  </Box>
                </Box>
              ))
            )}
            <div ref={messagesEndRef} />
          </Box>

          {/* Input Area */}
          <Box sx={{ p: 1.2, borderTop: 1, borderColor: "divider" }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
              <TextField
                fullWidth
                multiline
                maxRows={3}
                placeholder="Ask a question about your database..."
                inputProps={{
                  style: { fontSize: "0.85rem" },
                }}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loadingChat}
                size="small"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
                  },
                }}
              />
              <Tooltip title="Send message" arrow>
                <span>
                  <IconButton color="primary" onClick={handleSend} disabled={!input.trim() || loadingChat}>
                    {loadingChat ? <CircularProgress size={24} /> : <SendIcon />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Clear chat history and start new session" arrow>
                <span>
                  <IconButton color="error" onClick={handleClearChat} disabled={messages.length === 0}>
                    <DeleteIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>

            {/* Status Chips - 25% smaller */}
            <Box sx={{ display: "flex", gap: 0.5, mt: 1, flexWrap: "wrap" }}>
              {activeConnectionId && (
                <Chip
                  size="small"
                  label={`DB: ${connections.find((c) => c.id === activeConnectionId)?.name || "Unknown"}`}
                  color={connectionStatus === "connected" ? "success" : connectionStatus === "error" ? "error" : "default"}
                  variant={connectionStatus === "error" ? "filled" : "outlined"}
                  sx={{ fontSize: "0.55rem", height: 16, "& .MuiChip-label": { px: 1 } }}
                />
              )}
              {selectedAgent && (
                <Chip
                  size="small"
                  label={`Provider: ${selectedAgent.name}`}
                  color="primary"
                  variant="outlined"
                  sx={{ fontSize: "0.55rem", height: 16, "& .MuiChip-label": { px: 1 } }}
                />
              )}
              {selectedModel && (
                <Chip
                  size="small"
                  label={`Model: ${selectedModel.name}`}
                  color="primary"
                  variant="outlined"
                  sx={{ fontSize: "0.55rem", height: 16, "& .MuiChip-label": { px: 1 }, borderColor: "orange", color: "orange" }}
                />
              )}
            </Box>
          </Box>
        </Paper>

        {/* Validation Dialog */}
        <Dialog open={validationDialogOpen} onClose={() => setValidationDialogOpen(false)}>
          <DialogTitle>Attention</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {validationMessage}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setValidationDialogOpen(false)} variant="contained">
              OK
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
}
