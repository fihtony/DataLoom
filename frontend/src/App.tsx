// =============================================================================
// Main App Component - DataLoom
// =============================================================================

import { useEffect, useState } from "react";
import {
  Box,
  CssBaseline,
  ThemeProvider,
  createTheme,
  AppBar,
  Toolbar,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";
import {
  Chat as ChatIcon,
  Storage as DatabaseIcon,
  Settings as SettingsIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  Code as CodeIcon,
  LocalLibrary as KnowledgeBaseIcon,
} from "@mui/icons-material";
import { useStore, type MenuType } from "./store";
import { ChatPage } from "./components/pages/ChatPage";
import { DatabasePage } from "./components/pages/DatabasePage";
import { AgentSettingsPage } from "./components/pages/AgentSettingsPage";
import { DevelopmentPage } from "./components/pages/DevelopmentPage";
import { KnowledgeBasePage } from "./components/pages/KnowledgeBasePage";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1976d2",
    },
    secondary: {
      main: "#dc004e",
    },
    background: {
      default: "#f5f5f5",
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: "4px 8px",
          "&.Mui-selected": {
            backgroundColor: "rgba(25, 118, 210, 0.12)",
          },
        },
      },
    },
  },
});

const menuItems: { id: MenuType; label: string; icon: React.ReactNode }[] = [
  { id: "chat", label: "Chat with Agent", icon: <ChatIcon /> },
  { id: "database", label: "Manage Database", icon: <DatabaseIcon /> },
  { id: "settings", label: "Agent Settings", icon: <SettingsIcon /> },
  { id: "knowledgebase", label: "Knowledge Base", icon: <KnowledgeBaseIcon /> },
  // { id: "development", label: "Development", icon: <CodeIcon /> },
];

function App() {
  const { activeMenu, setActiveMenu, loadConnections, loadAgents, connectionSessionId, disconnectDatabase } = useStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [navigationDialogOpen, setNavigationDialogOpen] = useState(false);
  const [pendingMenuId, setPendingMenuId] = useState<string | null>(null);

  useEffect(() => {
    loadConnections();
    loadAgents();
  }, []);

  // Handle menu click with confirmation if there's an active connection
  const handleMenuClick = (menuId: string) => {
    // If navigating away from chat page with an active connection, show confirmation
    if (activeMenu === "chat" && menuId !== "chat" && connectionSessionId) {
      setPendingMenuId(menuId);
      setNavigationDialogOpen(true);
    } else {
      setActiveMenu(menuId as any);
    }
  };

  // Handle confirmation to disconnect and navigate
  const handleConfirmNavigation = async () => {
    if (connectionSessionId) {
      await disconnectDatabase(connectionSessionId);
    }
    if (pendingMenuId) {
      setActiveMenu(pendingMenuId as any);
    }
    setNavigationDialogOpen(false);
    setPendingMenuId(null);
  };

  // Handle cancel navigation
  const handleCancelNavigation = () => {
    setNavigationDialogOpen(false);
    setPendingMenuId(null);
  };

  const renderContent = () => {
    switch (activeMenu) {
      case "chat":
        return <ChatPage />;
      case "database":
        return <DatabasePage />;
      case "settings":
        return <AgentSettingsPage />;
      case "knowledgebase":
        return <KnowledgeBasePage />;
      case "development":
        return <DevelopmentPage />;
      default:
        return <ChatPage />;
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        {/* Header */}
        <AppBar position="static" elevation={1}>
          <Toolbar>
            <IconButton
              color="inherit"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              sx={{ mr: 1 }}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen ? <ChevronLeftIcon /> : <MenuIcon />}
            </IconButton>
            <Box
              component="img"
              src="/icon.png"
              alt="DataLoom"
              sx={{
                width: 32,
                height: 32,
                mr: 1, mb: 0.5,
                objectFit: "contain",
              }}
            />
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              DataLoom
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              AI-Powered Database Query Assistant
            </Typography>
          </Toolbar>
        </AppBar>

        {/* Main Content */}
        <Box sx={{ display: "flex", flexGrow: 1, overflow: "hidden" }}>
          {/* Left Sidebar - Menu */}
          <Paper
            elevation={0}
            sx={{
              width: sidebarOpen ? "auto" : 0,
              minWidth: sidebarOpen ? 240 : 0,
              maxWidth: sidebarOpen ? 260 : 0,
              borderRight: sidebarOpen ? 1 : 0,
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              bgcolor: "background.paper",
              transition: "width 0.3s ease, minWidth 0.3s ease, maxWidth 0.3s ease",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            <List sx={{ flexGrow: 1, pt: 0 }}>
              {menuItems.map((item) => (
                <ListItemButton key={item.id} selected={activeMenu === item.id} onClick={() => handleMenuClick(item.id)}>
                  <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              ))}
            </List>
            <Divider />
            <Box sx={{ p: 2 }}>
              <Typography variant="caption" color="text.secondary">
                DataLoom v1.0.0
              </Typography>
            </Box>
          </Paper>

          {/* Right Content */}
          <Box
            sx={{
              flexGrow: 1,
              overflow: "hidden",
              bgcolor: "background.default",
            }}
          >
            {renderContent()}
          </Box>
        </Box>

        {/* Navigation Confirmation Dialog */}
        <Dialog
          open={navigationDialogOpen}
          onClose={handleCancelNavigation}
          PaperProps={{
            sx: { p: 1 }
          }}
        >
          <DialogTitle>Disconnect Database?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              You have an active database connection. Leaving this page will disconnect the database and clear the chat history.<br/>Do you want to continue?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCancelNavigation} color="primary">
              Cancel
            </Button>
            <Button onClick={handleConfirmNavigation} color="error" variant="contained">
              Disconnect & Leave
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}

export default App;
