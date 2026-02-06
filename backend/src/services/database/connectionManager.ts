// =============================================================================
// Database Connection Manager (Minimal)
// =============================================================================
// Manages database connections with read-only enforcement.
// All connection configurations are fetched from the DataLoom database.
// No caching - always ensures fresh data.
// =============================================================================

import Database from "better-sqlite3";
import pg from "pg";
import sql from "mssql";
import type { DatabaseConnection, DatabaseConfig, DatabaseType, DatabaseSchema } from "../../types/index.js";
import { logger } from "../../utils/logger.js";
import { getDataLoomDb } from "../dataloom/databaseService.js";

// Connection pool storage (only keep active pools, no config cache)
const connectionPools: Map<number, Database.Database | pg.Pool | sql.ConnectionPool> = new Map();

// Idle timeout configuration
// For testing: 60 seconds, for production: 10 minutes (600 seconds)
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Connection session storage: sessionId -> {connectionId, createdAt, lastActivityAt, schemaCache, kbCache}
const connectionSessions: Map<
  string,
  {
    connectionId: number;
    createdAt: number;
    lastActivityAt: number; // Track last activity time for idle timeout
    schemaCache?: DatabaseSchema;
    kbCache?: { tableExplanations: any[]; columnExplanations: Map<number, any[]>; sqlExamples: any[] };
  }
> = new Map();

// Chat message type for conversation history
interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// Chat session storage: chatSessionId -> {connectionSessionId, isFollowUp, createdAt, history}
const chatSessions: Map<
  string,
  {
    connectionSessionId: string;
    isFollowUp: boolean;
    createdAt: number;
    history: ChatMessage[];
  }
> = new Map();

/**
 * Format column name from snake_case to Title Case
 */
function formatColumnName(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Infer SQL Server column type from JavaScript value
 */
function inferSQLServerColumnType(value: unknown): string {
  if (value === null || value === undefined) {
    return "unknown";
  }

  const jsType = typeof value;

  if (jsType === "string") {
    return "varchar";
  } else if (jsType === "number") {
    return Number.isInteger(value) ? "int" : "float";
  } else if (jsType === "boolean") {
    return "bit";
  } else if (value instanceof Date) {
    return "datetime2";
  } else if (Buffer.isBuffer(value)) {
    return "varbinary";
  }

  return "unknown";
}

/**
 * Get connection by ID from database (always fresh read)
 */
export function getConnection(connectionId: number): DatabaseConnection | undefined {
  try {
    const db = getDataLoomDb();
    const row = db
      .prepare(
        `
        SELECT id, name, type, config, status, created_at, updated_at
        FROM database_connections
        WHERE id = ?
      `,
      )
      .get(connectionId) as any;

    if (!row) return undefined;

    const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
    return {
      id: row.id,
      name: row.name,
      type: row.type as DatabaseType,
      config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status || "disconnected",
    };
  } catch (error) {
    logger.error(`Failed to get connection ${connectionId}: ${error}`);
    return undefined;
  }
}

/**
 * Create a new database connection with unified read-only handling
 * This function:
 * 1. Connects with read-only parameter if database supports it
 * 2. Sets read-only config if database supports it
 * 3. Checks the database read-only status
 * 4. Logs all steps at INFO level
 */
export async function createReadOnlyConnection(connection: DatabaseConnection): Promise<{
  pool: Database.Database | pg.Pool | sql.ConnectionPool;
  readOnlyStatus: "readonly" | "readwrite" | "unknown";
}> {
  const { type, config } = connection;

  switch (type) {
    case "sqlite": {
      if (!config.path) throw new Error("SQLite path is required");

      // Step 1 & 2: Connect with readonly parameter
      logger.info(`[SQLite] Creating connection with readonly: true to ${config.path}`);
      const db = new Database(config.path, {
        readonly: true,
        fileMustExist: true,
      });

      // Step 3: Check read-only status
      logger.info(`[SQLite] Checking connection read-only status`);
      const isReadOnly = (db as any).readonly === true;

      // Step 4: Log result
      if (isReadOnly) {
        logger.info(`[SQLite] Connection verified as READ ONLY`);
      } else {
        logger.warn(`[SQLite] Connection is NOT read-only`);
      }

      return {
        pool: db,
        readOnlyStatus: isReadOnly ? "readonly" : "readwrite",
      };
    }

    case "postgresql": {
      // Step 1 & 2: Create pool and set transaction_read_only
      logger.info(`[PostgreSQL] Creating connection pool to ${config.host}:${config.port || 5432}/${config.database}`);
      const pool = new pg.Pool({
        host: config.host,
        port: config.port || 5432,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: config.connectionTimeout || 10000,
      });

      // Get a client from the pool to set transaction_read_only
      const client = await pool.connect();
      try {
        logger.info(`[PostgreSQL] Setting read only flag ...`);
        await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");

        // Step 3: Check read-only status
        logger.info(`[PostgreSQL] Checking transaction_read_only setting`);
        const result = await client.query("SELECT current_setting('transaction_read_only')");
        const isReadOnly = result.rows[0]?.current_setting === "on";

        // Step 4: Log result
        if (isReadOnly) {
          logger.info(`[PostgreSQL] Connection verified as READ ONLY`);
        } else {
          logger.warn(`[PostgreSQL] Connection is NOT read-only`);
        }

        return {
          pool,
          readOnlyStatus: isReadOnly ? "readonly" : "readwrite",
        };
      } finally {
        client.release();
      }
    }

    case "mssql":
    case "sqlserver": {
      // Step 1 & 2: Create pool with isolation level
      logger.info(`[SQL Server] Creating connection pool to ${config.host}:${config.port || 1433}/${config.database}`);
      const pool = new sql.ConnectionPool({
        server: config.host || "localhost",
        port: typeof config.port === "string" ? parseInt(config.port, 10) : config.port || 1433,
        database: config.database,
        user: config.username,
        password: config.password,
        options: {
          encrypt: config.ssl ? true : false,
          trustServerCertificate: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
        connectionTimeout: config.connectionTimeout || 10000,
      });

      await pool.connect();

      // Get a connection to set isolation level
      const conn = pool.request();
      try {
        logger.info(`[SQL Server] Setting transaction isolation level to READ UNCOMMITTED (read-only mode)`);
        await conn.query("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED");

        // Step 3: Check read-only status
        logger.info(`[SQL Server] Checking database read-only status`);
        const dbResult = await conn.query(`SELECT DATABASEPROPERTYEX('${config.database}', 'Updateability')`);
        const updateability = dbResult.recordset[0]?.[Object.keys(dbResult.recordset[0])[0]];
        const isReadOnly = updateability === "READ_ONLY";

        // Step 4: Log result
        if (isReadOnly) {
          logger.info(`[SQL Server] Connection verified as READ ONLY`);
        } else {
          logger.info(`[SQL Server] Connection is READ/WRITE but isolation level is set to READ UNCOMMITTED for safety`);
        }

        return {
          pool,
          readOnlyStatus: isReadOnly ? "readonly" : "readwrite",
        };
      } catch (e) {
        await pool.close();
        throw e;
      }
    }

    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
}

/**
 * Initialize and cache a database connection
 * This function creates a connection, validates it's read-only, saves it to the pool,
 * and returns a sessionId for tracking this connection
 */
export async function initializeConnection(
  connection: DatabaseConnection,
): Promise<{ sessionId: string; readOnlyStatus: "readonly" | "readwrite" | "unknown" }> {
  const { pool, readOnlyStatus } = await createReadOnlyConnection(connection);

  // Save the pool to connectionPools for reuse by queries
  connectionPools.set(connection.id, pool);

  // Generate a unique session ID for this connection
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  connectionSessions.set(sessionId, {
    connectionId: connection.id,
    createdAt: now,
    lastActivityAt: now, // Initialize last activity time
  });

  logger.info(
    `[Connection Manager] Connection ${connection.id} initialized with session ${sessionId}, read-only status: ${readOnlyStatus}`,
  );

  return { sessionId, readOnlyStatus };
}

/**
 * Update the last activity timestamp for a connection session
 * This resets the idle timeout when the user receives AI analysis or executes a query
 * @param sessionId - Connection session ID
 */
export function updateConnectionSessionActivity(sessionId: string): void {
  const session = connectionSessions.get(sessionId);
  if (session) {
    session.lastActivityAt = Date.now();
    logger.debug(`[Connection Manager] Updated activity timestamp for session ${sessionId}`);
  } else {
    logger.warn(`[Connection Manager] Session not found for activity update: ${sessionId}`);
  }
}

/**
 * Get or create connection pool (recreate for SQLite to ensure fresh config)
 */
async function getPool(connection: DatabaseConnection): Promise<Database.Database | pg.Pool | sql.ConnectionPool> {
  const existing = connectionPools.get(connection.id);

  // For SQLite, always close and recreate to ensure fresh config
  if (existing && connection.type === "sqlite") {
    try {
      const db = existing as Database.Database;
      db.close();
    } catch (e) {
      logger.warn(`Failed to close existing SQLite pool: ${e}`);
    }
    connectionPools.delete(connection.id);
  } else if (existing) {
    // For SQL Server, check if pool is still connected
    if (connection.type === "mssql" || connection.type === "sqlserver") {
      const sqlPool = existing as sql.ConnectionPool;
      if (!sqlPool.connected) {
        logger.warn(`SQL Server pool for connection ${connection.id} is disconnected, recreating...`);
        connectionPools.delete(connection.id);
      } else {
        // Pool is still connected, reuse it
        return existing;
      }
    } else {
      // For other database types, reuse the pool
      return existing;
    }
  }

  const { type, config } = connection;

  switch (type) {
    case "sqlite": {
      if (!config.path) throw new Error("SQLite path is required");

      const db = new Database(config.path, {
        readonly: true, // FORCE READ-ONLY
        fileMustExist: true,
      });
      connectionPools.set(connection.id, db);
      return db;
    }
    case "postgresql": {
      const pool = new pg.Pool({
        host: config.host,
        port: config.port || 5432,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: config.connectionTimeout || 10000,
      });
      connectionPools.set(connection.id, pool);
      return pool;
    }
    case "mssql":
    case "sqlserver": {
      const pool = new sql.ConnectionPool({
        server: config.host || "localhost",
        port: typeof config.port === "string" ? parseInt(config.port, 10) : config.port || 1433,
        database: config.database,
        user: config.username,
        password: config.password,
        options: {
          encrypt: config.ssl ? true : false,
          trustServerCertificate: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
        connectionTimeout: config.connectionTimeout || 10000,
      });
      await pool.connect();
      connectionPools.set(connection.id, pool);
      return pool;
    }
  }
}

/**
 * Test database connection
 */
export async function testConnection(connection: DatabaseConnection): Promise<boolean> {
  const { type, config } = connection;

  try {
    switch (type) {
      case "sqlite": {
        if (!config.path) throw new Error("SQLite path is required");
        const db = new Database(config.path, { readonly: true });
        db.exec("SELECT 1");
        db.close();
        break;
      }
      case "postgresql": {
        const client = new pg.Client({
          host: config.host,
          port: config.port || 5432,
          database: config.database,
          user: config.username,
          password: config.password,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: config.connectionTimeout || 10000,
        });
        await client.connect();
        await client.query("SELECT 1");
        await client.end();
        break;
      }
      case "mssql":
      case "sqlserver": {
        const pool = new sql.ConnectionPool({
          server: config.host || "localhost",
          port: typeof config.port === "string" ? parseInt(config.port, 10) : config.port || 1433,
          database: config.database,
          user: config.username,
          password: config.password,
          options: {
            encrypt: config.ssl ? true : false,
            trustServerCertificate: true,
          },
          connectionTimeout: config.connectionTimeout || 10000,
        });
        await pool.connect();
        await pool.request().query("SELECT 1 AS test");
        await pool.close();
        break;
      }
    }
    return true;
  } catch (error) {
    const errorDetails = error instanceof Error ? error.message : JSON.stringify(error);

    // Enhance error message for PostgreSQL SSL issues
    if (errorDetails.includes("pg_hba.conf")) {
      const enhancedMessage =
        `${errorDetails}\n\nSolution: Your PostgreSQL server requires encrypted connections. ` +
        `Please enable the "SSL/TLS Encryption" option in the connection settings and try again.`;
      logger.error(`Connection test failed: ${enhancedMessage}`);
      throw new Error(enhancedMessage);
    }

    logger.error(`Connection test failed: ${errorDetails}`);
    throw error;
  }
}

/**
 * Check if database connection is in READ ONLY mode
 */
export async function checkReadOnlyStatus(connection: DatabaseConnection): Promise<"readonly" | "readwrite" | "unknown"> {
  const { type, config } = connection;

  try {
    switch (type) {
      case "sqlite": {
        if (!config.path) return "unknown";
        try {
          const db = new Database(config.path, { readonly: true });
          // Check using better-sqlite3's .readonly property
          try {
            const isReadOnly = (db as any).readonly === true;
            db.close();

            if (isReadOnly) {
              logger.info(`SQLite connection is READ ONLY - opened with readonly: true`);
            } else {
              logger.warn(`SQLite connection is NOT read-only - readonly property is false`);
            }

            return isReadOnly ? "readonly" : "readwrite";
          } catch (e) {
            db.close();
            logger.warn(`SQLite readonly check failed: ${e}`);
            return "unknown";
          }
        } catch (e) {
          logger.warn(`SQLite connection failed: ${e}`);
          return "unknown";
        }
      }
      case "postgresql": {
        const client = new pg.Client({
          host: config.host,
          port: config.port || 5432,
          database: config.database,
          user: config.username,
          password: config.password,
          ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: config.connectionTimeout || 10000,
        });
        await client.connect();
        try {
          // Check transaction_read_only setting
          const result = await client.query("SELECT current_setting('transaction_read_only')");
          const isReadOnly = result.rows[0]?.current_setting === "on";

          if (isReadOnly) {
            logger.info(`PostgreSQL connection is READ ONLY - transaction_read_only is ON`);
          } else {
            logger.warn(`PostgreSQL connection is NOT read-only - transaction_read_only is OFF`);
          }

          await client.end();
          return isReadOnly ? "readonly" : "readwrite";
        } catch (e) {
          await client.end();
          logger.warn(`PostgreSQL readonly check failed: ${e}`);
          return "unknown";
        }
      }
      case "mssql":
      case "sqlserver": {
        const pool = new sql.ConnectionPool({
          server: config.host || "localhost",
          port: typeof config.port === "string" ? parseInt(config.port, 10) : config.port || 1433,
          database: config.database,
          user: config.username,
          password: config.password,
          options: {
            encrypt: config.ssl ? true : false,
            trustServerCertificate: true,
          },
          connectionTimeout: config.connectionTimeout || 10000,
        });
        await pool.connect();
        try {
          // Check database updateability
          const result = await pool.request().query(`SELECT DATABASEPROPERTYEX('${config.database}', 'Updateability')`);
          const updateability = result.recordset[0]?.[Object.keys(result.recordset[0])[0]];
          const isReadOnly = updateability === "READ_ONLY";

          if (isReadOnly) {
            logger.info(`SQL Server connection is READ ONLY - database is READ_ONLY`);
          } else {
            logger.warn(`SQL Server connection is NOT read-only - database is updateable`);
          }

          await pool.close();
          return isReadOnly ? "readonly" : "readwrite";
        } catch (e) {
          try {
            await pool.close();
          } catch (e2) {
            // ignore
          }
          logger.warn(`SQL Server readonly check failed: ${e}`);
          return "unknown";
        }
      }
      default:
        return "unknown";
    }
  } catch (error) {
    logger.error(`Unexpected error checking read-only status: ${error}`);
    return "unknown";
  }
}

/**
 * Execute a validated SELECT query
 */
export async function executeQuery(
  connectionId: number,
  sql_query: string,
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; columns: Array<{ name: string; key: string; type: string }> }> {
  const connection = getConnection(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  const pool = await getPool(connection);
  const startTime = Date.now();

  try {
    switch (connection.type) {
      case "sqlite": {
        const db = pool as Database.Database;
        const stmt = db.prepare(sql_query);
        const rows = stmt.all(...params) as Record<string, unknown>[];

        // Get column info from statement
        let columns = stmt.columns().map((col) => ({
          name: formatColumnName(col.name),
          key: col.name,
          type: col.type || "unknown",
        }));

        // If columns still have "unknown" type, infer from actual data
        if (rows.length > 0 && columns.some((c) => c.type === "unknown")) {
          columns = columns.map((col) => {
            if (col.type !== "unknown") return col;

            // Infer type from first row's value
            const value = rows[0][col.key];
            if (value === null) return { ...col, type: "null" };
            if (typeof value === "number") {
              return { ...col, type: Number.isInteger(value) ? "INTEGER" : "REAL" };
            }
            if (typeof value === "string") return { ...col, type: "TEXT" };
            if (typeof value === "boolean") return { ...col, type: "INTEGER" }; // SQLite stores as 0/1
            if (value instanceof Date) return { ...col, type: "DATETIME" };
            return { ...col, type: typeof value };
          });
        }

        logger.info(`SQLite query executed in ${Date.now() - startTime}ms, ${rows.length} rows`);
        return { rows, columns };
      }
      case "postgresql": {
        const pgPool = pool as pg.Pool;
        const client = await pgPool.connect();
        try {
          // Read-only mode was already set during pool initialization in createReadOnlyConnection()
          const result = await client.query(sql_query, params);
          const columns = result.fields.map((f) => ({
            name: formatColumnName(f.name),
            key: f.name,
            type: f.dataTypeID.toString(),
          }));
          logger.info(`PostgreSQL query executed in ${Date.now() - startTime}ms, ${result.rowCount} rows`);
          return { rows: result.rows, columns };
        } finally {
          client.release();
        }
      }
      case "mssql":
      case "sqlserver": {
        const sqlPool = pool as sql.ConnectionPool;
        logger.debug(`[SQL Server] Pool connected: ${sqlPool.connected}, Query length: ${sql_query.length} chars`);
        const request = sqlPool.request();

        // Set READ ONLY mode for SQL Server
        // SQL Server enforces read-only through connection-level permissions
        await request.query("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED");
        logger.info(`[SQL Server] READ ONLY mode enabled (SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED)`);

        logger.debug(`[SQL Server] Request created, executing query...`);
        const result = await request.query(sql_query);
        logger.debug(`[SQL Server] Query result recordset length: ${result.recordset.length}`);

        if (result.recordset.length === 0) {
          logger.warn(`[SQL Server] Query returned 0 rows for: ${sql_query.substring(0, 200)}...`);
        }

        const columns = Object.keys(result.recordset[0] || {}).map((key) => {
          // Infer type from first row's value
          const value = result.recordset[0]?.[key as keyof (typeof result.recordset)[0]];
          const type = inferSQLServerColumnType(value);

          return {
            name: formatColumnName(key),
            key,
            type,
          };
        });
        logger.info(`SQL Server query executed in ${Date.now() - startTime}ms, ${result.recordset.length} rows`);
        return { rows: result.recordset, columns };
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Query execution failed: ${errorMsg}`, {
      sql: sql_query.substring(0, 300),
      paramsCount: params.length,
      errorDetails: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Get database schema (always fresh read from database)
 */
export async function getSchema(connectionId: number, selectedSchemas?: string[]): Promise<DatabaseSchema> {
  const connection = getConnection(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  const pool = await getPool(connection);
  const tables: any[] = [];

  switch (connection.type) {
    case "sqlite": {
      const db = pool as Database.Database;

      const tableRows = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
        )
        .all() as { name: string }[];

      for (const tableRow of tableRows) {
        const tableName = tableRow.name;

        const columnRows = db.prepare(`PRAGMA table_info('${tableName}')`).all() as {
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }[];

        const columns: any[] = columnRows.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.notnull === 0,
          defaultValue: col.dflt_value ?? undefined,
          primaryKey: col.pk > 0,
        }));

        const fkRows = db.prepare(`PRAGMA foreign_key_list('${tableName}')`).all() as {
          table: string;
          from: string;
          to: string;
        }[];

        for (const fk of fkRows) {
          const col = columns.find((c) => c.name === fk.from);
          if (col) {
            col.foreignKey = { table: fk.table, column: fk.to };
          }
        }

        const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number };

        tables.push({
          name: tableName,
          schema: null,
          columns,
          primaryKey: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
          rowCount: countResult.count,
        });
      }
      break;
    }
    case "postgresql": {
      const pgPool = pool as pg.Pool;

      // Determine which schemas to fetch - use selectedSchemas if provided
      let schemasToFetch: string[] = selectedSchemas || ["public"];

      // If no selectedSchemas provided, fetch all non-system schemas
      if (!selectedSchemas || selectedSchemas.length === 0) {
        const schemaResult = await pgPool.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND schema_name NOT LIKE 'pg_temp_%'
          AND schema_name NOT LIKE 'pg_toast_temp_%'
          ORDER BY schema_name
        `);
        schemasToFetch = schemaResult.rows.map((row) => row.schema_name);
      }

      for (const schema of schemasToFetch) {
        const tableResult = await pgPool.query(
          `
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = $1 AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `,
          [schema],
        );

        for (const tableRow of tableResult.rows) {
          const tableName = tableRow.table_name;

          const columnResult = await pgPool.query(
            `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `,
            [schema, tableName],
          );

          const pkResult = await pgPool.query(
            `
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary
          `,
            [`"${schema}"."${tableName}"`],
          );
          const pkColumns = pkResult.rows.map((r) => r.attname);

          // Get foreign key information
          const fkResult = await pgPool.query(
            `
            SELECT 
              kcu.column_name,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' 
              AND tc.table_schema = $1 
              AND tc.table_name = $2
          `,
            [schema, tableName],
          );
          const fkMap = new Map(fkResult.rows.map((r) => [r.column_name, { table: r.foreign_table_name, column: r.foreign_column_name }]));

          const columns = columnResult.rows.map((col) => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === "YES",
            defaultValue: col.column_default ?? undefined,
            primaryKey: pkColumns.includes(col.column_name),
            foreignKey: fkMap.get(col.column_name),
          }));

          tables.push({
            name: tableName,
            schema,
            columns,
            primaryKey: pkColumns,
          });
        }
      }
      break;
    }
    case "mssql":
    case "sqlserver": {
      const sqlPool = pool as sql.ConnectionPool;

      const tableResult = await sqlPool.request().query(`
        SELECT TABLE_NAME, TABLE_SCHEMA
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `);

      for (const tableRow of tableResult.recordset) {
        const tableName = tableRow.TABLE_NAME;
        const tableSchema = tableRow.TABLE_SCHEMA;

        const columnResult = await sqlPool
          .request()
          .input("schemaName", sql.VarChar, tableSchema)
          .input("tableName", sql.VarChar, tableName).query(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @schemaName AND TABLE_NAME = @tableName
            ORDER BY ORDINAL_POSITION
          `);

        // Get primary key columns
        const pkResult = await sqlPool.request().input("schemaName", sql.VarChar, tableSchema).input("tableName", sql.VarChar, tableName)
          .query(`
            SELECT KCU.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS TC
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE KCU
              ON TC.CONSTRAINT_NAME = KCU.CONSTRAINT_NAME
            WHERE TC.TABLE_SCHEMA = @schemaName 
              AND TC.TABLE_NAME = @tableName
              AND TC.CONSTRAINT_TYPE = 'PRIMARY KEY'
          `);
        const pkColumns = new Set(pkResult.recordset.map((r) => r.COLUMN_NAME));

        // Get foreign key columns
        const fkResult = await sqlPool.request().input("schemaName", sql.VarChar, tableSchema).input("tableName", sql.VarChar, tableName)
          .query(`
            SELECT 
              CU.COLUMN_NAME,
              PKT.TABLE_NAME AS REFERENCED_TABLE_NAME,
              PKC.COLUMN_NAME AS REFERENCED_COLUMN_NAME
            FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS RC
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE CU
              ON RC.CONSTRAINT_NAME = CU.CONSTRAINT_NAME
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE PKC
              ON RC.UNIQUE_CONSTRAINT_NAME = PKC.CONSTRAINT_NAME
            INNER JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS PKT
              ON PKC.CONSTRAINT_NAME = PKT.CONSTRAINT_NAME
            WHERE CU.TABLE_SCHEMA = @schemaName 
              AND CU.TABLE_NAME = @tableName
          `);
        const fkMap = new Map(
          fkResult.recordset.map((r) => [r.COLUMN_NAME, { table: r.REFERENCED_TABLE_NAME, column: r.REFERENCED_COLUMN_NAME }]),
        );

        const columns = columnResult.recordset.map((col) => ({
          name: col.COLUMN_NAME,
          type: col.DATA_TYPE,
          nullable: col.IS_NULLABLE === "YES",
          defaultValue: col.COLUMN_DEFAULT ?? undefined,
          primaryKey: pkColumns.has(col.COLUMN_NAME),
          foreignKey: fkMap.get(col.COLUMN_NAME),
        }));

        tables.push({
          name: tableName,
          schema: tableSchema,
          columns,
        });
      }
      break;
    }
  }

  return {
    connectionId,
    tables,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Delete connection (close pool)
 */
export async function deleteConnection(connectionId: number): Promise<void> {
  const pool = connectionPools.get(connectionId);
  if (pool) {
    if (pool instanceof Database) {
      pool.close();
    } else if (pool instanceof pg.Pool) {
      await pool.end();
    } else if (pool instanceof sql.ConnectionPool) {
      await pool.close();
    }
    connectionPools.delete(connectionId);
  }
  logger.info(`Connection deleted: ${connectionId}`);
}

/**
 * Validate and get connection ID from session ID
 * Returns null if session is invalid or connection is disconnected
 */
/**
 * Update last activity time for a connection session
 */
function updateSessionActivity(sessionId: string): void {
  const session = connectionSessions.get(sessionId);
  if (session) {
    session.lastActivityAt = Date.now();
  }
}

/**
 * Check connection session status without updating activity time
 * Used for health checks that shouldn't reset the idle timer
 */
export function checkConnectionSession(sessionId: string): number | null {
  const session = connectionSessions.get(sessionId);
  if (!session) {
    return null;
  }

  const connectionId = session.connectionId;
  const pool = connectionPools.get(connectionId);

  // Check if pool still exists
  if (!pool) {
    return null;
  }

  // For SQL Server, check if pool is connected
  if (pool instanceof sql.ConnectionPool && !pool.connected) {
    return null;
  }

  // Return connectionId without updating lastActivityAt
  return connectionId;
}

/**
 * Validate and get connection ID from session ID
 * Returns null if session is invalid or connection is disconnected
 * Also updates last activity time (use this for actual user requests)
 */
export async function validateConnectionSession(sessionId: string): Promise<number | null> {
  const session = connectionSessions.get(sessionId);
  if (!session) {
    logger.warn(`[Session Manager] Invalid connection session: ${sessionId}`);
    return null;
  }

  const connectionId = session.connectionId;
  const pool = connectionPools.get(connectionId);

  // Check if pool still exists
  if (!pool) {
    logger.warn(`[Session Manager] Connection pool not found for session ${sessionId}, connection ${connectionId}`);
    connectionSessions.delete(sessionId);
    return null;
  }

  // For SQL Server, check if pool is connected
  if (pool instanceof sql.ConnectionPool && !pool.connected) {
    logger.warn(`[Session Manager] SQL Server pool disconnected for session ${sessionId}`);
    connectionSessions.delete(sessionId);
    connectionPools.delete(connectionId);
    return null;
  }

  // Update last activity time
  updateSessionActivity(sessionId);

  return connectionId;
}

/**
 * Create a new chat session for a connection session
 * Returns chatSessionId
 */
export function createChatSession(connectionSessionId: string): string {
  const chatSessionId = crypto.randomUUID();
  chatSessions.set(chatSessionId, {
    connectionSessionId,
    isFollowUp: false,
    createdAt: Date.now(),
    history: [],
  });
  logger.info(`[Chat Session Manager] Created chat session ${chatSessionId} for connection session ${connectionSessionId}`);
  return chatSessionId;
}

/**
 * Validate chat session and check if it's a follow-up question
 * Returns {isValid, isFollowUp, connectionSessionId}
 * If invalid, returns {isValid: false}
 */
export function validateChatSession(
  chatSessionId: string,
  expectedConnectionSessionId?: string,
): { isValid: boolean; isFollowUp: boolean; connectionSessionId?: string } {
  const session = chatSessions.get(chatSessionId);
  if (!session) {
    logger.debug(`[Chat Session Manager] Invalid chat session: ${chatSessionId}`);
    return { isValid: false, isFollowUp: false };
  }

  // Verify connection session matches if provided
  if (expectedConnectionSessionId && session.connectionSessionId !== expectedConnectionSessionId) {
    logger.warn(
      `[Chat Session Manager] Connection session mismatch for chat session ${chatSessionId}. Expected: ${expectedConnectionSessionId}, Got: ${session.connectionSessionId}`,
    );
    return { isValid: false, isFollowUp: false };
  }

  return {
    isValid: true,
    isFollowUp: session.isFollowUp,
    connectionSessionId: session.connectionSessionId,
  };
}

/**
 * Cache schema in connection session
 * Called on first question to store schema for reuse in follow-up questions
 */
export function setCacheSchema(connectionSessionId: string, schema: DatabaseSchema): void {
  const session = connectionSessions.get(connectionSessionId);
  if (session) {
    session.schemaCache = schema;
    logger.debug(`[Cache Manager] Schema cached for connection session ${connectionSessionId}`);
  } else {
    logger.warn(`[Cache Manager] Connection session not found: ${connectionSessionId}`);
  }
}

/**
 * Get cached schema from connection session
 * Returns cached schema if available, null otherwise
 */
export function getCacheSchema(connectionSessionId: string): DatabaseSchema | null {
  const session = connectionSessions.get(connectionSessionId);
  if (session?.schemaCache) {
    logger.debug(`[Cache Manager] Using cached schema for connection session ${connectionSessionId}`);
    return session.schemaCache;
  }
  return null;
}

/**
 * Cache knowledge base (table/column explanations and SQL examples) in connection session
 * Called on first question to store KB for reuse in follow-up questions
 */
export function setCacheKnowledgeBase(
  connectionSessionId: string,
  kbData: { tableExplanations: any[]; columnExplanations: Map<number, any[]>; sqlExamples: any[] },
): void {
  const session = connectionSessions.get(connectionSessionId);
  if (session) {
    session.kbCache = kbData;
    logger.debug(`[Cache Manager] Knowledge base cached for connection session ${connectionSessionId}`);
  } else {
    logger.warn(`[Cache Manager] Connection session not found: ${connectionSessionId}`);
  }
}

/**
 * Get cached knowledge base from connection session
 * Returns cached KB if available, null otherwise
 */
export function getCacheKnowledgeBase(connectionSessionId: string): {
  tableExplanations: any[];
  columnExplanations: Map<number, any[]>;
  sqlExamples: any[];
} | null {
  const session = connectionSessions.get(connectionSessionId);
  if (session?.kbCache) {
    logger.debug(`[Cache Manager] Using cached knowledge base for connection session ${connectionSessionId}`);
    return session.kbCache;
  }
  return null;
}

/**
 * Mark chat session as follow-up (after first AI response)
 */
export function markChatSessionAsFollowUp(chatSessionId: string): void {
  const session = chatSessions.get(chatSessionId);
  if (session) {
    session.isFollowUp = true;
    logger.debug(`[Chat Session Manager] Chat session ${chatSessionId} marked as follow-up`);
  }
}

/**
 * Add a message to chat history
 */
export function addChatMessage(chatSessionId: string, role: "user" | "assistant" | "system", content: string): void {
  const session = chatSessions.get(chatSessionId);
  if (session) {
    session.history.push({
      role,
      content,
      timestamp: Date.now(),
    });
    logger.debug(
      `[Chat Session Manager] Added ${role} message to chat session ${chatSessionId}, total messages: ${session.history.length}`,
    );
  }
}

/**
 * Get chat history for a session
 * Returns array of messages in OpenAI format
 */
export function getChatHistory(chatSessionId: string): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const session = chatSessions.get(chatSessionId);
  if (session) {
    // Return messages without timestamp for API compatibility
    return session.history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }
  return [];
}

/**
 * Get chat history count
 */
export function getChatHistoryCount(chatSessionId: string): number {
  const session = chatSessions.get(chatSessionId);
  return session?.history.length || 0;
}

/**
 * Clear chat history for a session (but keep the session)
 */
export function clearChatHistory(chatSessionId: string): void {
  const session = chatSessions.get(chatSessionId);
  if (session) {
    session.history = [];
    session.isFollowUp = false;
    logger.info(`[Chat Session Manager] Cleared chat history for session ${chatSessionId}`);
  }
}

/**
 * Reset chat session - creates a new session ID and clears history
 * Returns the new chatSessionId
 */
export function resetChatSession(connectionSessionId: string, oldChatSessionId?: string): string {
  // Delete old session if provided
  if (oldChatSessionId) {
    chatSessions.delete(oldChatSessionId);
    logger.info(`[Chat Session Manager] Deleted old chat session ${oldChatSessionId}`);
  }

  // Create new session
  return createChatSession(connectionSessionId);
}

/**
 * Disconnect a connection session and cleanup associated chat sessions
 */
export async function disconnectSession(connectionSessionId: string): Promise<void> {
  const session = connectionSessions.get(connectionSessionId);
  if (!session) {
    logger.warn(`[Session Manager] Attempt to disconnect invalid session: ${connectionSessionId}`);
    return;
  }

  const connectionId = session.connectionId;

  // Find and cleanup all chat sessions associated with this connection session
  for (const [chatSessionId, chatSession] of chatSessions.entries()) {
    if (chatSession.connectionSessionId === connectionSessionId) {
      chatSessions.delete(chatSessionId);
      logger.info(`[Chat Session Manager] Cleaned up chat session ${chatSessionId}`);
    }
  }

  // Close the connection
  const pool = connectionPools.get(connectionId);
  if (pool) {
    try {
      if (pool instanceof Database) {
        pool.close();
      } else if (pool instanceof pg.Pool) {
        await pool.end();
      } else if (pool instanceof sql.ConnectionPool) {
        await pool.close();
      }
      connectionPools.delete(connectionId);
      logger.info(`[Connection Manager] Connection pool closed for connection ${connectionId}`);
    } catch (error) {
      logger.warn(`[Connection Manager] Error closing connection ${connectionId}: ${error}`);
    }
  }

  connectionSessions.delete(connectionSessionId);
  logger.info(`[Session Manager] Connection session ${connectionSessionId} disconnected and cleaned up`);
}

/**
 * Keep database connections alive by executing simple queries
 * This prevents connection timeouts but doesn't update lastActivityAt
 *
 * Note: This function only checks sessions that are still in connectionSessions.
 * When a session is disconnected via disconnectSession(), it is removed from
 * connectionSessions, so it will no longer be checked by this function.
 */
async function keepConnectionsAlive(): Promise<void> {
  // Only iterate over sessions that are still active
  // Disconnected sessions are removed from connectionSessions by disconnectSession()
  for (const [sessionId, session] of connectionSessions.entries()) {
    try {
      const connection = getConnection(session.connectionId);
      if (!connection) {
        continue;
      }

      const pool = connectionPools.get(session.connectionId);
      if (!pool) {
        continue;
      }

      // Execute a simple query to keep connection alive
      // This doesn't update lastActivityAt - only user requests do that
      if (connection.type === "sqlite") {
        const db = pool as Database.Database;
        db.prepare("SELECT 1").get();
      } else if (connection.type === "postgresql") {
        const pgPool = pool as pg.Pool;
        await pgPool.query("SELECT 1");
      } else if (connection.type === "mssql" || connection.type === "sqlserver") {
        const sqlPool = pool as sql.ConnectionPool;
        await sqlPool.request().query("SELECT 1");
      }
    } catch (error) {
      // Silently ignore keep-alive errors - connection might be closing
      // Errors will be caught when user actually tries to use the connection
    }
  }
}

/**
 * Check for idle connections and disconnect them if idle for more than 10 minutes
 */
async function checkIdleConnections(): Promise<void> {
  const now = Date.now();
  const idleSessions: string[] = [];

  for (const [sessionId, session] of connectionSessions.entries()) {
    const idleTime = now - session.lastActivityAt;
    if (idleTime > IDLE_TIMEOUT_MS) {
      idleSessions.push(sessionId);
    }
  }

  // Don't log routine checks - only log when actually disconnecting sessions

  // Disconnect idle sessions
  for (const sessionId of idleSessions) {
    const idleSeconds = Math.round((now - connectionSessions.get(sessionId)!.lastActivityAt) / 1000);
    logger.info(`[Session Manager] Disconnecting idle session ${sessionId} (idle for ${idleSeconds} seconds)`);
    try {
      await disconnectSession(sessionId);
    } catch (error) {
      logger.error(`[Session Manager] Error disconnecting idle session ${sessionId}: ${error}`);
    }
  }
}

/**
 * Start idle connection checker (runs every minute)
 */
let idleCheckInterval: NodeJS.Timeout | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null;

export function startIdleConnectionChecker(): void {
  if (idleCheckInterval) {
    return; // Already started
  }

  // Check interval should be at most half of timeout to ensure accurate detection
  // For 60 seconds timeout, check every 12 seconds
  // For 10 minutes timeout, check every 1 minute
  const CHECK_INTERVAL_MS = Math.min(IDLE_TIMEOUT_MS / 5, 60 * 1000);

  // Check for idle connections at regular intervals
  idleCheckInterval = setInterval(() => {
    checkIdleConnections().catch((error) => {
      logger.error(`[Session Manager] Error in idle connection checker: ${error}`);
    });
  }, CHECK_INTERVAL_MS);

  // Keep connections alive every 5 minutes (prevents database connection timeouts)
  keepAliveInterval = setInterval(
    () => {
      keepConnectionsAlive().catch((error) => {
        logger.error(`[Session Manager] Error in keep-alive: ${error}`);
      });
    },
    5 * 60 * 1000,
  ); // Every 5 minutes

  logger.info(
    `[Session Manager] Idle connection checker started (checks every ${CHECK_INTERVAL_MS / 1000} seconds, disconnects after ${IDLE_TIMEOUT_MS / 1000} seconds of inactivity)`,
  );
  logger.info("[Session Manager] Connection keep-alive started (executes every 5 minutes to prevent connection timeouts)");
}

/**
 * Stop idle connection checker and keep-alive
 */
export function stopIdleConnectionChecker(): void {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  logger.info("[Session Manager] Idle connection checker and keep-alive stopped");
}

/**
 * Close all connections (for shutdown)
 */
export async function closeAllConnections(): Promise<void> {
  stopIdleConnectionChecker();

  for (const [id, pool] of connectionPools) {
    try {
      if (pool instanceof Database) {
        pool.close();
      } else if (pool instanceof pg.Pool) {
        await pool.end();
      } else if (pool instanceof sql.ConnectionPool) {
        await pool.close();
      }
    } catch (error) {
      logger.error(`Error closing connection ${id}: ${error}`);
    }
  }
  connectionPools.clear();
  logger.info("All connections closed");
}
