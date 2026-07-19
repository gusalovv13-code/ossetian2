const baseUrl = String(process.env.SMOKE_BASE_URL || process.argv[2] || "").replace(/\/+$/, "");
if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
  console.error("Set SMOKE_BASE_URL or pass URL: npm run smoke -- https://example.com");
  process.exit(1);
}
const checks = [
  ["liveness", "/api/health", [200]],
  ["readiness", "/api/ready", [200, 503]],
  ["version", "/api/version", [200]],
  ["config", "/api/config", [200]],
  ["homepage", "/", [200]]
];
let failed = 0;
for (const [name, pathname, expected] of checks) {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    const ok = expected.includes(response.status);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: HTTP ${response.status} (${Date.now() - started}ms)`);
    if (!ok) failed += 1;
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
if (failed) process.exit(1);
