# Ossetian Market v1.13.7 — PostgreSQL startup hotfix

- Added retry with exponential backoff for transient PostgreSQL startup errors such as `ECONNRESET`.
- Database initialization now uses one dedicated client instead of switching between pooled clients during migrations.
- Broken connections are removed from the pool and are not reused.
- Added a PostgreSQL pool error handler so an idle socket reset does not crash the Node.js process.
- Reduced the default pool size from 15 to 5 to avoid exhausting connection limits on small managed PostgreSQL plans.
- Increased the initial connection timeout to 20 seconds.
- Database migrations use a longer statement timeout and a non-blocking advisory lock to prevent two deployments from running schema initialization simultaneously.
- Existing v1.13.6 listing limits, phone uniqueness, navigation, keyboard, camera, and catalog fixes are preserved.

Optional environment variables:

- `DB_POOL_MAX` (default: `5`)
- `DB_CONNECTION_TIMEOUT_MS` (default: `20000`)
- `DB_INIT_MAX_ATTEMPTS` (default: `8`)
- `DB_INIT_RETRY_BASE_MS` (default: `2000`)
- `DB_INIT_RETRY_MAX_MS` (default: `30000`)
