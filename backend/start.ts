// =============================================================================
// Bootstrap script - Load dotenv BEFORE any other imports
// =============================================================================

import dotenv from "dotenv";

// Load .env file immediately
dotenv.config();

// NOW import and run the app
import("./src/index.js").catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
