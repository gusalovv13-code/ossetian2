const baseUrl = String(process.env.LOAD_TEST_BASE_URL || process.argv[2] || "").replace(/\/+$/, "");
const concurrency = Math.max(1, Math.min(200, Number(process.env.LOAD_TEST_CONCURRENCY || 20)));
const total = Math.max(concurrency, Math.min(10000, Number(process.env.LOAD_TEST_REQUESTS || 200)));
if (!/^https?:\/\//i.test(baseUrl)) {
  console.error("Set LOAD_TEST_BASE_URL or pass URL: npm run loadtest -- https://example.com");
  process.exit(1);
}
const paths = ["/api/health", "/api/version", "/api/products?limit=20"];
let cursor = 0;
let failures = 0;
const latencies = [];
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= total) return;
    const pathname = paths[index % paths.length];
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}${pathname}`, { signal: AbortSignal.timeout(15000) });
      latencies.push(performance.now() - started);
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    } catch {
      failures += 1;
      latencies.push(performance.now() - started);
    }
  }
}
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
latencies.sort((a,b)=>a-b);
const percentile = p => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
const seconds = (performance.now() - started) / 1000;
console.log(JSON.stringify({ total, concurrency, failures, seconds: Number(seconds.toFixed(2)), rps: Number((total/seconds).toFixed(1)), p50Ms: Number(percentile(.5).toFixed(1)), p95Ms: Number(percentile(.95).toFixed(1)), p99Ms: Number(percentile(.99).toFixed(1)) }, null, 2));
if (failures) process.exitCode = 1;
