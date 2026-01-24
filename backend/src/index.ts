// =============================================================================
// DataLoom Backend - Main Entry Point
// Rebuild trigger: 2026-01-19 10:51:00
// =============================================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";

import queryRouter from "./routes/query.js";
import copilotRouter from "./routes/copilot.js";
import dataloomRouter from "./routes/dataloom.js";

import { initializeDataLoomDb, closeDataLoomDb } from "./services/dataloom/databaseService.js";
import { closeAllConnections } from "./services/database/connectionManager.js";
import { logger } from "./utils/logger.js";

const app = express();
const PORT = process.env.PORT || 8060;

// Backend startup counter for detecting auto-reload
let startupCounter = 0;
const startupTime = new Date().toISOString();

// =============================================================================
// Middleware
// =============================================================================

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable for development
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS - allow frontend origin
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3060",
    credentials: true,
  }),
);

// Parse JSON bodies
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();

  // Log all requests
  if (["POST", "PUT", "PATCH"].includes(req.method) && Object.keys(req.body).length > 0) {
    logger.debug(`${req.method} ${req.path} - Request body: ${JSON.stringify(req.body)}`);
  } else if (req.method === "GET") {
    logger.debug(`${req.method} ${req.path}`);
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// =============================================================================
// Routes
// =============================================================================

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    startupCounter,
    startupTime,
  });
});

// API routes
app.use("/api/query", queryRouter);
app.use("/api/copilot", copilotRouter);
app.use("/api/dataloom", dataloomRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found",
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    success: false,
    error: "Internal server error",
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// Startup
// =============================================================================

async function start() {
  try {
    // Increment startup counter for detecting reloads
    startupCounter++;
    logger.info(`[STARTUP] Backend instance #${startupCounter} starting...`);

    // Initialize DataLoom database
    logger.info("Initializing DataLoom database...");
    initializeDataLoomDb(process.env.DATALOOM_DB_PATH);
    logger.info("DataLoom database initialized");

    // Start server
    app.listen(PORT, () => {
      logger.info(`DataLoom Backend running on http://localhost:${PORT}`);
      logger.info(`API documentation: http://localhost:${PORT}/api`);
      logger.info(`Startup counter: ${startupCounter}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error}`);
    process.exit(1);
  }
}

// =============================================================================
// Shutdown
// =============================================================================

async function shutdown() {
  logger.info("Shutting down...");
  try {
    await closeAllConnections();
    closeDataLoomDb();
    logger.info("Cleanup complete");
    process.exit(0);
  } catch (error) {
    logger.error(`Error during shutdown: ${error}`);
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start the server
start();

export { app };
