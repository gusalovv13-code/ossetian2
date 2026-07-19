import dotenv from "dotenv";
import pg from "pg";
import { createDatabaseBackup } from "../backup-service.js";

dotenv.config();
const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const ssl = String(process.env.DATABASE_SSL || "true").toLowerCase() !== "false";
const pool = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, max: 1 });
try {
  const result = await createDatabaseBackup(pool, {
    appVersion: process.env.APP_VERSION || "cli",
    backupDir: process.env.BACKUP_DIR,
    retention: process.env.BACKUP_RETENTION_COUNT
  });
  console.log(`Backup created: ${result.filepath} (${result.bytes} bytes)`);
} finally {
  await pool.end();
}
