// =============================================================================
// Copilot API Routes - Gateway to CopilotBridge
// =============================================================================

import { Router, Request, Response } from "express";
import { z } from "zod";
import { chat, checkCopilotBridge, getAvailableModels } from "../services/copilot/copilotClient.js";
import { logger } from "../utils/logger.js";

const router = Router();

// GET /api/copilot/status - Check CopilotBridge status
router.get("/status", async (req: Request, res: Response) => {
  try {
    const available = await checkCopilotBridge();
    res.json({
      success: true,
      data: {
        available,
        url: process.env.COPILOT_BRIDGE_URL || "http://localhost:1287",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/copilot/models - List available models
router.get("/models", async (req: Request, res: Response) => {
  try {
    const models = await getAvailableModels();
    res.json({
      success: true,
      data: models,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Failed to get models: ${error}`);
    res.status(500).json({
      success: false,
      error: "Failed to get available models",
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/copilot/chat - Direct chat with CopilotBridge
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const { prompt, context, model, timeout } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        success: false,
        error: "Prompt is required",
        timestamp: new Date().toISOString(),
      });
    }

    const response = await chat({
      prompt,
      context,
      model,
      timeout,
    });

    if (!response.success) {
      return res.status(500).json({
        success: false,
        error: response.error,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: {
        response: response.response,
        usage: response.usage,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Chat failed: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: `Chat failed: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
