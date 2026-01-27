// =============================================================================
// Chat Page - Chat with AI Provider
// =============================================================================

import { useState, useRef, useEffect, useMemo, useLayoutEffect, useCallback } from "react";
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
import { api } from "../../services/api";

export function ChatPage() {
  const {
    connections,
    activeConnectionId,
    connectionSessionId,
    readOnlyStatus: storeReadOnlyStatus,
    showConnectionLostDialog,
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
    addSystemMessage,
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
  const [connectionLostDialogOpen, setConnectionLostDialogOpen] = useState(false);
  
  // Stable connection flag - only set to true on connect, only set to false on explicit disconnect
  const [hasActiveConnection, setHasActiveConnection] = useState(false);
  const [stableReadOnlyStatus, setStableReadOnlyStatus] = useState<"readonly" | "readwrite" | "unknown" | null>(null);
  const previousConnectionSessionId = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isUserDisconnecting = useRef<boolean>(false); // Track if user is manually disconnecting

  // Track when we last added connection lost message to prevent duplicates within short time window
  const lastConnectionLostMessageTimeRef = useRef<number>(0);
  const CONNECTION_LOST_MESSAGE_COOLDOWN_MS = 5000; // 5 seconds cooldown to prevent duplicates
  
  // Common function to add connection lost system message
  const addConnectionLostMessage = useCallback(() => {
    const now = Date.now();
    const timeSinceLastAdd = now - lastConnectionLostMessageTimeRef.current;
    
    // Check if we recently added a connection lost message (within cooldown period)
    // This prevents duplicate messages from query error and health check triggering simultaneously
    // But allows new messages if enough time has passed (e.g., reconnection then disconnection again)
    // IMPORTANT: We don't check messages list because reconnection preserves chat history,
    // so we rely only on time-based cooldown to prevent duplicates
    if (timeSinceLastAdd < CONNECTION_LOST_MESSAGE_COOLDOWN_MS) {
      return;
    }
    
    // Mark as added and add the message
    lastConnectionLostMessageTimeRef.current = now;
    const lostTime = new Date();
    addSystemMessage(`⚠️ Database connection has been lost. Please reconnect to continue. ${lostTime.toLocaleTimeString()}`);
  }, [addSystemMessage]);

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

  // Immediately show connection lost dialog when store flag is set (from INVALID_SESSION error)
  // This handles INVALID_SESSION errors from /query endpoint
  // Use multiple mechanisms to ensure immediate response:
  // 1. Custom event listener (most reliable, bypasses React render cycle)
  // 2. Zustand subscribe (backup mechanism)
  // 3. useLayoutEffect (React-based backup)
  useEffect(() => {
    let isHandling = false;
    
    // Handler function to show dialog and stop health check
    const handleConnectionLost = () => {
      if (isHandling) {
        return;
      }
      isHandling = true;
      console.log("[ChatPage] Connection lost detected - showing dialog immediately");
      
      // Add connection lost system message (if not already present)
      // This handles the case when query error response triggers connection lost
      addConnectionLostMessage();
      
      // Immediately stop health check and show dialog
      setHasActiveConnection(false);
      setConnectionStatus("idle");
      setReadOnlyStatus(null);
      setStableReadOnlyStatus(null);
      setConnectionLostDialogOpen(true);
      // Reset the flag in store
      setTimeout(() => {
        useStore.setState({ showConnectionLostDialog: false });
        isHandling = false;
      }, 100);
    };
    
    // Method 1: Custom event listener (most reliable)
    const handleCustomEvent = (event: CustomEvent) => {
      console.log("[ChatPage] Received 'connectionLost' custom event:", event.detail);
      handleConnectionLost();
    };
    window.addEventListener("connectionLost", handleCustomEvent as EventListener);
    
    // Method 2: Zustand subscribe (backup)
    let previousValue = useStore.getState().showConnectionLostDialog;
    const unsubscribe = useStore.subscribe((state) => {
      const currentValue = state.showConnectionLostDialog;
      if (currentValue && !previousValue && !isHandling) {
        console.log("[ChatPage] INVALID_SESSION detected via Zustand subscribe");
        handleConnectionLost();
      }
      previousValue = currentValue;
    });
    
    return () => {
      window.removeEventListener("connectionLost", handleCustomEvent as EventListener);
      unsubscribe();
    };
  }, [addConnectionLostMessage]);
  
  // Also use useLayoutEffect as a backup for React-based state changes
  useLayoutEffect(() => {
    if (showConnectionLostDialog) {
      console.log("[ChatPage] useLayoutEffect - INVALID_SESSION detected, showing dialog");
      
      // Add connection lost system message (if not already present)
      addConnectionLostMessage();
      
      setHasActiveConnection(false);
      setConnectionStatus("idle");
      setReadOnlyStatus(null);
      setStableReadOnlyStatus(null);
      setConnectionLostDialogOpen(true);
      useStore.setState({ showConnectionLostDialog: false });
    }
  }, [showConnectionLostDialog, addConnectionLostMessage]);

  // Sync connectionStatus with connectionSessionId for reliability
  // Also detect connection loss and show error dialog
  useEffect(() => {
    // Detect connection loss: had connection before, but now it's null
    if (previousConnectionSessionId.current && !connectionSessionId) {
      // Connection was lost (could be idle timeout, server restart, or INVALID_SESSION error)
      const wasActive = hasActiveConnection || !!previousConnectionSessionId.current;
      
      setConnectionStatus("idle");
      setReadOnlyStatus(null);
      setHasActiveConnection(false);
      setStableReadOnlyStatus(null);
      
      // Show dialog and system message if we had a connection (even if hasActiveConnection was false)
      // This covers the case where INVALID_SESSION error occurs during a query
      // BUT: Don't show dialog or add message if user manually disconnected
      if (wasActive) {
        // Check if this is a user-initiated disconnect using the ref flag
        // This is more reliable than checking messages due to async state updates
        const isUserDisconnect = isUserDisconnecting.current;
        
        // Also check messages as a backup (in case ref check fails)
        const hasUserDisconnectMessage = messages.some(
          msg => msg.role === "system" && msg.content.includes("User disconnected the database")
        );
        
        // Only proceed if this is NOT a user-initiated disconnect
        if (!isUserDisconnect && !hasUserDisconnectMessage) {
          // Add connection lost system message (if not already present)
          addConnectionLostMessage();
          
          // Show dialog for connection loss (not user-initiated)
          setConnectionLostDialogOpen(true);
        }
        // If it's a user-initiated disconnect, do nothing (message already added in handleConnect)
      }
    } else if (connectionSessionId && connectionStatus !== "connected") {
      setConnectionStatus("connected");
    } else if (!connectionSessionId && connectionStatus === "connected") {
      setConnectionStatus("idle");
      setReadOnlyStatus(null);
      setHasActiveConnection(false);
      setStableReadOnlyStatus(null);
    }
    
    // Update previous value
    previousConnectionSessionId.current = connectionSessionId;
  }, [connectionSessionId, connectionStatus, hasActiveConnection, addSystemMessage, messages]);

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

  // Connection health check - keep connection alive and detect disconnections
  // This effect automatically stops when connectionSessionId becomes null or hasActiveConnection becomes false
  // When INVALID_SESSION error is received from /query endpoint:
  // 1. Store sets connectionSessionId to null and showConnectionLostDialog to true
  // 2. showConnectionLostDialog useEffect sets hasActiveConnection to false and shows dialog
  // 3. This effect detects connectionSessionId is null or hasActiveConnection is false, stops health check
  useEffect(() => {
    if (!connectionSessionId || !hasActiveConnection) {
      // No active connection - don't start health check
      // This also serves as cleanup: when connectionSessionId becomes null or hasActiveConnection becomes false,
      // this effect re-runs and the cleanup function (return below) is called
      if (!connectionSessionId && hasActiveConnection) {
        // Connection was lost - ensure hasActiveConnection is also false
        console.log("[ChatPage] Health check stopped - connectionSessionId is null, stopping health check");
        setHasActiveConnection(false);
      }
      return;
    }

    // Check connection health every 30 seconds
    // Note: This only checks backend state, doesn't trigger database operations or update lastActivityAt
    const healthCheckInterval = setInterval(async () => {
      const currentSessionId = connectionSessionId; // Capture current value
      if (!currentSessionId) {
        return; // Already disconnected
      }

      try {
        const result = await api.checkConnectionHealth(currentSessionId);
        if (!result.success && result.errorCode === "INVALID_SESSION") {
          // Connection lost - clear connection state immediately but preserve messages
          console.warn("[ChatPage] Connection health check failed - session invalidated, clearing connection state (preserving messages)");
          
          // Add connection lost system message (if not already present)
          addConnectionLostMessage();
          
          // Show dialog for connection loss (from health check)
          setConnectionLostDialogOpen(true);
          
          // Clear connection state in store and local state (will trigger UI update via useEffect)
          // Preserve messages when connection is lost due to timeout/error
          await disconnectDatabase(currentSessionId, true);
          // Also update local state to ensure UI updates immediately
          setConnectionStatus("idle");
          setHasActiveConnection(false);
          setStableReadOnlyStatus(null);
        }
      } catch (error) {
        // If health check fails with network error, also treat as connection lost
        console.error("[ChatPage] Health check error:", error);
        
        // Add connection lost system message (if not already present)
        addConnectionLostMessage();
        
        // Show dialog for connection loss (from health check network error)
        setConnectionLostDialogOpen(true);
        
        // Preserve messages when connection is lost due to network error
        await disconnectDatabase(currentSessionId, true);
        setConnectionStatus("idle");
        setHasActiveConnection(false);
        setStableReadOnlyStatus(null);
      }
    }, 30000); // Check every 30 seconds

    // Cleanup function: stops health check when connectionSessionId or hasActiveConnection changes
    // This is automatically called when:
    // 1. connectionSessionId becomes null (e.g., when INVALID_SESSION error is received)
    // 2. hasActiveConnection becomes false (e.g., when connection is lost)
    // 3. Component unmounts
    return () => {
      clearInterval(healthCheckInterval);
      console.log("[ChatPage] Health check stopped - connection lost or component unmounted");
    };
  }, [connectionSessionId, hasActiveConnection]);

  const handleConnect = async () => {
    if (!activeConnectionId) return;

    // If already connected, disconnect
    if (connectionStatus === "connected") {
      setConnectionStatus("connecting");
      // Mark that this is a user-initiated disconnect
      isUserDisconnecting.current = true;
      
      try {
        // Cancel any ongoing query before disconnecting
        const currentAbortController = useStore.getState().currentQueryAbortController;
        if (currentAbortController) {
          console.log("[ChatPage] Cancelling ongoing query before disconnect");
          currentAbortController.abort();
        }
        
        // Add system message for user-initiated disconnect with timestamp (don't show dialog)
        const disconnectTime = new Date();
        addSystemMessage(`User disconnected the database at ${disconnectTime.toLocaleTimeString()}`);
        
        // Clear the showConnectionLostDialog flag to prevent dialog from showing
        // This is a user-initiated disconnect, not an error
        useStore.setState({ showConnectionLostDialog: false });
        
        // Preserve messages when user manually disconnects
        await disconnectDatabase(connectionSessionId || "", true);
        setConnectionStatus("idle");
        setReadOnlyStatus(null);
        setConnectionMessage(null);
        // Clear stable connection state on explicit disconnect
        setHasActiveConnection(false);
        setStableReadOnlyStatus(null);
        // Ensure dialog is closed (in case it was open)
        setConnectionLostDialogOpen(false);
        
        // Reset the flag after a short delay to allow useEffect to check it
        setTimeout(() => {
          isUserDisconnecting.current = false;
        }, 100);
      } catch (error) {
        isUserDisconnecting.current = false;
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
        // Set stable connection state
        setHasActiveConnection(true);
        setStableReadOnlyStatus(result.readOnlyStatus || "unknown");
        
        // Show "Start new conversation" system message immediately when connected
        const startTime = new Date();
        addSystemMessage(`New conversation started at ${startTime.toLocaleTimeString()}`);
        
        // Reset connection lost message timestamp when reconnecting
        // This allows new connection lost messages if connection is lost again after reconnection
        // Set to 0 so that timeSinceLastAdd will be large enough to pass cooldown check
        lastConnectionLostMessageTimeRef.current = 0;
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
    
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle clear chat - reset backend session
  const handleClearChat = async () => {
    await clearChatHistory();
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
              messages.map((message) => {
                // System messages have special styling
                if (message.role === "system") {
                  return (
                    <Box
                      key={message.id}
                      sx={{
                        display: "flex",
                        justifyContent: "center",
                        my: 1,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.disabled",
                          fontSize: "0.7rem",
                          fontStyle: "italic",
                          textAlign: "center",
                          px: 2,
                          py: 0.5,
                          // Removed bgcolor and borderRadius to match requirement
                        }}
                      >
                        {message.content}
                      </Typography>
                    </Box>
                  );
                }

                return (
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
                );
              })
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

        {/* Connection Lost Dialog */}
        <Dialog 
          open={connectionLostDialogOpen} 
          onClose={() => setConnectionLostDialogOpen(false)}
        >
          <DialogTitle>Database Connection Lost</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mt: 1 }}>
              The database connection has been lost or terminated. Please reconnect to the database to continue.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button 
              onClick={() => {
                setConnectionLostDialogOpen(false);
                // Optionally auto-trigger reconnect if connection ID is still available
                if (activeConnectionId) {
                  handleConnect();
                }
              }} 
              variant="contained"
              color="primary"
            >
              Reconnect
            </Button>
            <Button onClick={() => setConnectionLostDialogOpen(false)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
}
