import dotenv from "dotenv";
import pg from "pg";
import { restoreDatabaseBackup } from "../backup-service.js";

dotenv.config();
const args = Object.fromEntries(process.argv.slice(2).map(item => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));
const filepath = args.file;
const mode = args.mode || "merge";
const confirm = args.confirm || "";
if (!filepath) {
  console.error("Usage: npm run restore -- --file=./backups/file.json.gz [--mode=merge|replace] [--confirm=RESTORE_DATABASE]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const { Pool } = pg;
const ssl = String(process.env.DATABASE_SSL || "true").toLowerCase() !== "false";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: ssl ? { rejectUnauthorized: false } : false, max: 1 });
try {
  const result = await restoreDatabaseBackup(pool, filepath, { mode, confirm });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
