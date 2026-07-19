import fs from "fs/promises";
import path from "path";
import { gzip } from "zlib";

const DEFAULT_TABLES = Object.freeze([
  "users",
  "products",
  "product_images",
  "favorites",
  "seller_reviews",
  "saved_searches",
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

function safeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export async function createDatabaseBackup(database, options = {}) {
  if (!database?.query) throw new Error("Database connection is required");
  const backupDir = path.resolve(options.backupDir || process.env.BACKUP_DIR || "./backups");
  const retention = safeInteger(options.retention ?? process.env.BACKUP_RETENTION_COUNT, 7, 1, 90);
  const tables = Array.isArray(options.tables) && options.tables.length ? options.tables : DEFAULT_TABLES;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `ossetian-market-${timestamp}.json.gz`;
  const filepath = path.join(backupDir, filename);

  await fs.mkdir(backupDir, { recursive: true });
  const payload = {
    format: "ossetian-market-logical-backup-v1",
    createdAt: new Date().toISOString(),
    appVersion: String(options.appVersion || "unknown"),
    tables: {}
  };

  for (const table of tables) {
    // Table names are taken only from the hard-coded allowlist above.
    try {
      const result = await database.query(`SELECT * FROM ${table}`);
      payload.tables[table] = result.rows;
    } catch (error) {
      // Backups remain forward/backward compatible when a table does not exist yet.
      if (error?.code === "42P01") {
        payload.tables[table] = [];
        continue;
      }
      throw error;
    }
  }

  const compressed = await gzip(Buffer.from(JSON.stringify(payload)), { level: 9 });
  await fs.writeFile(filepath, compressed, { mode: 0o600 });

  const files = (await fs.readdir(backupDir))
    .filter(name => /^ossetian-market-.*\.json\.gz$/.test(name))
    .sort()
    .reverse();
  for (const stale of files.slice(retention)) {
    await fs.rm(path.join(backupDir, stale), { force: true });
  }

  return { filepath, filename, bytes: compressed.length, tables: tables.length };
}
