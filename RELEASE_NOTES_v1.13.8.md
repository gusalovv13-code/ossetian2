# Ossetian Market v1.13.8 — Render/PostgreSQL startup recovery

- HTTP server now binds to `0.0.0.0:$PORT` immediately, before database migrations.
- Render no longer rejects the deployment with “No open ports detected” while PostgreSQL is unavailable.
- Database initialization continues in the background and repeats until PostgreSQL becomes available.
- Database-dependent API routes return HTTP 503 with `DATABASE_UNAVAILABLE` during recovery.
- `/api/health` is a liveness endpoint; `/api/ready` reports database readiness.
- TLS is forced on Render and conflicting SSL query parameters are removed from `DATABASE_URL`.
- Docker health check now uses the actual `PORT` environment variable.
- Safe database target diagnostics log host, port and database name without credentials.

Important: this release keeps the web service online, but it cannot revive an expired, suspended or deleted Render Postgres instance. The database must show `Available`, and `DATABASE_URL` must point to its current connection URL.
