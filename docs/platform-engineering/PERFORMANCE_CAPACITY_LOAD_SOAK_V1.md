# Performance, Capacity, Load and Soak Program V1

Project: `API_SE_013`  
Canonical source: `src/modules/platform-performance/program.ts`  
Local harness: `scripts/run-http-performance-profile.ts`  
Contract version: `luzione-performance-program/v1`

The registry defines baseline, burst, sustained load, provider slowdown, database-pool pressure, mutation/idempotency, queue backlog and failure/recovery campaigns. Profiles state their concurrency, bounded request/duration shape, target and evidence maturity.

Only three read-only liveness profiles are currently harness-ready. The CLI refuses non-localhost origins, remote TLS targets, POST profiles and profiles whose dependencies do not exist in current runtime. Provider, database-pressure, mutation, queue and recovery campaigns remain `CONTRACT_ONLY` until an approved simulator or disposable canonical owner can expose the required latency, saturation, backlog, idempotency and recovery readbacks.

The summarizer deterministically reports request count, concurrency, throughput, error count/rate and p50/p95/p99. Provisional local thresholds are zero HTTP errors and p95 at or below 750 ms. A local pass is a historical machine-specific measurement, not a capacity ceiling, production SLO window or scalability claim.

The required execution sequence is: build the exact candidate, start it on an isolated localhost port, run the named bounded profile with `PERFORMANCE_EXACT_SHA`, retain the JSON receipt, stop the runtime, and record every unexercised campaign.

Strongest claim before measured receipts and exact-head gates: `IMPLEMENTED | LOCAL_PROVEN | SANDBOX_ONLY | BOUNDED_CLAIM`.
