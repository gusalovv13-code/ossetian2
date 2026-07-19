import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const DEFAULT_BACKUP_TABLES = Object.freeze([
  "users",
  "products",
  "product_images",
  "product_price_history",
  "favorites",
  "seller_reviews",
  "saved_searches",
  "legal_acceptances",
  "product_feature_requests",
  "payment_orders",
  "business_verification_requests",
  "reports",
  "moderation_settings",
  "moderation_rules",
  "moderation_events",
  "advertising_campaigns",
  "advertising_events",
  "product_view_events",
  "product_engagement_events",
  "ai_usage_events",
  "security_events",
  "admin_logs"
]);

const BACKUP_FORMAT = "ossetian-market-logical-backup-v2";
const LEGACY_FORMAT = "ossetian-market-logical-backup-v1";

function safeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function fileSha256(filepath) {
  const data = await fs.readFile(filepath);
  return createHash("sha256").update(data).digest("hex");
}

export async function createDatabaseBackup(database, options = {}) {
  if (!database?.query) throw new Error("Database connection is required");
  const backupDir = path.resolve(options.backupDir || process.env.BACKUP_DIR || "./backups");
  const retention = safeInteger(options.retention ?? process.env.BACKUP_RETENTION_COUNT, 7, 1, 90);
  const tables = Array.isArray(options.tables) && options.tables.length ? options.tables : DEFAULT_BACKUP_TABLES;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `ossetian-market-${timestamp}.json.gz`;
  const filepath = path.join(backupDir, filename);
  const tempPath = `${filepath}.tmp-${process.pid}`;

  await fs.mkdir(backupDir, { recursive: true });
  const payload = {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    appVersion: String(options.appVersion || "unknown"),
    rowCounts: {},
    tables: {}
  };

  for (const table of tables) {
    try {
      const result = await database.query(`SELECT * FROM ${quoteIdentifier(table)}`);
      payload.tables[table] = result.rows;
      payload.rowCounts[table] = result.rowCount ?? result.rows.length;
    } catch (error) {
      if (error?.code === "42P01") {
        payload.tables[table] = [];
        payload.rowCounts[table] = 0;
        continue;
      }
      throw error;
    }
  }

  const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  await fs.writeFile(tempPath, compressed, { mode: 0o600 });
  await fs.rename(tempPath, filepath);
  const checksum = createHash("sha256").update(compressed).digest("hex");
  await fs.writeFile(`${filepath}.sha256`, `${checksum}  ${filename}\n`, { mode: 0o600 });

  const files = (await fs.readdir(backupDir))
    .filter(name => /^ossetian-market-.*\.json\.gz$/.test(name))
    .sort()
    .reverse();
  for (const stale of files.slice(retention)) {
    await fs.rm(path.join(backupDir, stale), { force: true });
    await fs.rm(path.join(backupDir, `${stale}.sha256`), { force: true });
  }

  return { filepath, filename, bytes: compressed.length, tables: tables.length, checksum, rowCounts: payload.rowCounts };
}

export async function verifyDatabaseBackup(filepath) {
  const resolved = path.resolve(filepath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("Backup path is not a file");
  if (stat.size > 512 * 1024 * 1024) throw new Error("Backup file is too large");

  const actualChecksum = await fileSha256(resolved);
  const checksumPath = `${resolved}.sha256`;
  try {
    const expectedLine = (await fs.readFile(checksumPath, "utf8")).trim();
    const expectedChecksum = expectedLine.split(/\s+/)[0]?.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedChecksum || "") || expectedChecksum !== actualChecksum) {
      throw new Error("Backup SHA-256 checksum mismatch");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const compressed = await fs.readFile(resolved);
  const raw = await gunzipAsync(compressed, { maxOutputLength: 1024 * 1024 * 1024 });
  const payload = JSON.parse(raw.toString("utf8"));
  if (![BACKUP_FORMAT, LEGACY_FORMAT].includes(payload?.format)) throw new Error("Unsupported backup format");
  if (!payload.tables || typeof payload.tables !== "object" || Array.isArray(payload.tables)) throw new Error("Invalid backup tables");

  const unknownTables = Object.keys(payload.tables).filter(table => !DEFAULT_BACKUP_TABLES.includes(table));
  if (unknownTables.length) throw new Error(`Backup contains unsupported tables: ${unknownTables.join(", ")}`);

  return { filepath: resolved, checksum: actualChecksum, payload };
}

export async function restoreDatabaseBackup(database, filepath, options = {}) {
  if (!database?.connect) throw new Error("Database pool with connect() is required");
  const mode = String(options.mode || "merge").toLowerCase();
  if (!new Set(["merge", "replace"]).has(mode)) throw new Error("Restore mode must be merge or replace");
  if (mode === "replace" && options.confirm !== "RESTORE_DATABASE") {
    throw new Error("Replace restore requires confirm=RESTORE_DATABASE");
  }

  const { payload, checksum } = await verifyDatabaseBackup(filepath);
  const client = await database.connect();
  const restored = {};
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(73011901)");
    if (mode === "replace") {
      const existing = [];
      for (const table of DEFAULT_BACKUP_TABLES) {
        const check = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
        if (check.rows[0]?.name) existing.push(quoteIdentifier(table));
      }
      if (existing.length) await client.query(`TRUNCATE TABLE ${existing.join(", ")} RESTART IDENTITY CASCADE`);
    }

    for (const table of DEFAULT_BACKUP_TABLES) {
      const rows = Array.isArray(payload.tables[table]) ? payload.tables[table] : [];
      if (!rows.length) { restored[table] = 0; continue; }
      const columnResult = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1
          AND is_generated='NEVER'
          AND COALESCE(identity_generation, '') <> 'ALWAYS'
        ORDER BY ordinal_position
      `, [table]);
      const allowedColumns = new Set(columnResult.rows.map(row => row.column_name));
      if (!allowedColumns.size) { restored[table] = 0; continue; }

      let inserted = 0;
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const columns = Object.keys(row).filter(column => allowedColumns.has(column));
        if (!columns.length) continue;
        const values = columns.map(column => row[column]);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
        const conflict = mode === "merge" ? " ON CONFLICT DO NOTHING" : "";
        await client.query(
          `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${placeholders})${conflict}`,
          values
        );
        inserted += 1;
      }
      restored[table] = inserted;
    }
    await client.query("COMMIT");
    return { ok: true, mode, checksum, restored, createdAt: payload.createdAt || null, appVersion: payload.appVersion || "unknown" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
