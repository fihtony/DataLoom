// =============================================================================
// Logger utility
// =============================================================================

import winston from "winston";
import fs from "fs";
import path from "path";

const { combine, timestamp, printf, colorize } = winston.format;

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Generate dated log filename
const getDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

let _logger: winston.Logger | null = null;

/**
 * Get or create the logger instance.
 * Ensures logger is created with the correct LOG_LEVEL from process.env
 */
function getLogger(): winston.Logger {
  if (_logger === null) {
    const logLevel = process.env.LOG_LEVEL || "info";

    _logger = winston.createLogger({
      level: logLevel,
      format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
      transports: [
        new winston.transports.Console({
          format: combine(colorize(), timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
        }),
        new winston.transports.File({
          filename: path.join(logsDir, `backend-${getDateString()}.log`),
          level: logLevel,
          maxsize: 10485760, // 10MB
          maxFiles: 30,
        }),
        new winston.transports.File({
          filename: path.join(logsDir, `error-${getDateString()}.log`),
          level: "error",
          maxsize: 10485760,
          maxFiles: 30,
        }),
      ],
    });

    _logger.info(`Logger initialized - Logs directory: ${logsDir}`);
    _logger.info(`Environment: LOG_LEVEL=${logLevel}, NODE_ENV=${process.env.NODE_ENV}`);
  }

  return _logger;
}

export const logger = new Proxy(
  {},
  {
    get(target, prop) {
      const log = getLogger();
      return (log as any)[prop];
    },
  },
) as winston.Logger;
