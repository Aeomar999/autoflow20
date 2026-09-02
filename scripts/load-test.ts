/**
 * AF-M8-05: load generator for the public REST API.
 *
 * The public API is the right surface to load-test: it is the only
 * authenticated entry point a generator can drive without a browser session,
 * and it exercises the whole stack a customer's traffic touches — bearer-token
 * auth, the per-key token bucket, the org scope, the database, and (on the run
 * profile) enqueueing an execution.
 *
 * Two profiles, because they fail differently:
 *
 *   read  GET  /api/v1/workflows        auth + rate limit + one indexed read.
 *                                       Cheap. Finds connection-pool limits.
 *   run   POST /api/v1/workflows/:id/run  quota check + Execution insert +
 *                                       enqueue. Expensive, and the one that
 *                                       actually costs money to get wrong.
 *
 * `run` is destructive: every request that is not rate-limited or quota-denied
 * starts a real workflow run against whatever that workflow is connected to.
 * Point it at a workflow you own, in a workspace you do not mind filling with
 * executions, and never at production.
 *
 * Usage:
 *   npm run load-test -- --url https://staging.example.com --key af_xxx
 *   npm run load-test -- --url ... --key ... --concurrency 50 --duration 60
 *   npm run load-test -- --url ... --key ... --profile run --workflow wf_123
 *
 * Exits non-zero when the run misses the target in `docs/operations/load_test.md`,
 * so it can gate a release.
 */
import "dotenv/config";

interface Options {
  url: string;
  key: string;
  profile: "read" | "run";
  workflowId: string | null;
  concurrency: number;
  durationSeconds: number;
}

/**
 * Pass/fail thresholds. Rationale in `docs/operations/load_test.md`; the short
 * version is that these are the numbers the SLOs in `slos.md` already imply,
 * not new promises invented here.
 */
export const TARGETS = {
  /** S1 availability is 99.5%; a load test that fails more than that is worse
   *  than the steady state it is meant to prove. */
  maxErrorRate: 0.005,
  /** 5xx is never acceptable under load — a saturated service must shed with
   *  429, which is a correct answer, not an error. */
  maxServerErrors: 0,
  /** The API must stay interactive while saturated. Not an SLO (slos.md §2
   *  deliberately declines to write HTTP latency targets against
   *  instrumentation we do not have), but a release gate. */
  p95Millis: 1_000,
} as const;

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }
    const name = token.slice(2);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value.`);
    }
    values.set(name, value);
  }

  const url = values.get("url") ?? process.env.LOAD_TEST_URL;
  const key = values.get("key") ?? process.env.LOAD_TEST_API_KEY;
  if (!url) throw new Error("--url (or LOAD_TEST_URL) is required.");
  if (!key) throw new Error("--key (or LOAD_TEST_API_KEY) is required.");

  const profile = (values.get("profile") ?? "read") as Options["profile"];
  if (profile !== "read" && profile !== "run") {
    throw new Error(`--profile must be "read" or "run" (got "${profile}").`);
  }

  const workflowId = values.get("workflow") ?? null;
  if (profile === "run" && !workflowId) {
    throw new Error("--workflow <id> is required for the run profile.");
  }

  const concurrency = Number(values.get("concurrency") ?? 25);
  const durationSeconds = Number(values.get("duration") ?? 30);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("--duration must be a positive number of seconds.");
  }

  return {
    url: url.replace(/\/$/, ""),
    key,
    profile,
    workflowId,
    concurrency,
    durationSeconds,
  };
}

/** Nearest-rank percentile over a sorted array. */
export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

interface Sample {
  status: number;
  millis: number;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  const target =
    options.profile === "read"
      ? { method: "GET", path: "/api/v1/workflows?limit=10" }
      : {
          method: "POST",
          path: `/api/v1/workflows/${options.workflowId}/run`,
        };

  console.log(`Target      : ${options.url}${target.path}`);
  console.log(`Profile     : ${options.profile} (${target.method})`);
  console.log(`Concurrency : ${options.concurrency}`);
  console.log(`Duration    : ${options.durationSeconds}s`);
  if (options.profile === "run") {
    console.log(
      "\nWARNING: this starts real workflow runs. Not for production.\n",
    );
  }

  // One warm-up request outside the measurement, and a hard failure if the
  // credentials or URL are wrong - otherwise the run "passes" by measuring
  // thousands of identical 401s.
  const warmUp = await fetch(`${options.url}${target.path}`, {
    method: target.method,
    headers: { Authorization: `Bearer ${options.key}` },
  });
  if (warmUp.status === 401 || warmUp.status === 403) {
    throw new Error(
      `Credentials rejected (${warmUp.status}). Check --key and its scopes.`,
    );
  }
  if (warmUp.status === 404) {
    throw new Error(
      `404 from ${target.path}. Check --url and, on the run profile, --workflow.`,
    );
  }

  const samples: Sample[] = [];
  const failures = new Map<number, string>();
  const deadline = Date.now() + options.durationSeconds * 1_000;

  /** One worker, looping until the clock runs out. */
  const worker = async () => {
    while (Date.now() < deadline) {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${options.url}${target.path}`, {
          method: target.method,
          headers: {
            Authorization: `Bearer ${options.key}`,
            ...(options.profile === "run"
              ? { "Content-Type": "application/json" }
              : {}),
          },
          ...(options.profile === "run" ? { body: "{}" } : {}),
        });
        samples.push({
          status: response.status,
          millis: Date.now() - startedAt,
        });

        // Keep one body per failing status. Under load these are identical,
        // and printing thousands of them buries the numbers that matter.
        if (response.status >= 400 && !failures.has(response.status)) {
          failures.set(response.status, (await response.text()).slice(0, 300));
        }
      } catch (error) {
        // A transport error (socket exhaustion, DNS, TLS) is a finding, not a
        // reason to stop: recorded as 0 so it counts against the error rate.
        samples.push({ status: 0, millis: Date.now() - startedAt });
        if (!failures.has(0)) {
          failures.set(0, error instanceof Error ? error.message : "unknown");
        }
      }
    }
  };

  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: options.concurrency }, () => worker()),
  );
  const elapsedSeconds = (Date.now() - startedAt) / 1_000;

  const byStatus = new Map<number, number>();
  for (const sample of samples) {
    byStatus.set(sample.status, (byStatus.get(sample.status) ?? 0) + 1);
  }

  const latencies = samples
    .map((sample) => sample.millis)
    .sort((a, b) => a - b);
  const ok = samples.filter(
    (sample) => sample.status >= 200 && sample.status < 300,
  ).length;
  // 429 is the rate limiter doing its job. Counting it as an error would make
  // a correctly-shedding service look broken and hide the real failures.
  const throttled = byStatus.get(429) ?? 0;
  const serverErrors = samples.filter((sample) => sample.status >= 500).length;
  const transportErrors = byStatus.get(0) ?? 0;
  const errors = samples.length - ok - throttled;

  console.log(`\nRequests        : ${samples.length}`);
  console.log(
    `Throughput      : ${(samples.length / elapsedSeconds).toFixed(1)} req/s over ${elapsedSeconds.toFixed(1)}s`,
  );
  console.log(`2xx             : ${ok}`);
  console.log(`429 (shed)      : ${throttled}`);
  console.log(`5xx             : ${serverErrors}`);
  console.log(`transport fails : ${transportErrors}`);
  console.log("\nStatus distribution");
  for (const [status, count] of [...byStatus].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${status === 0 ? "ERR" : status}: ${count}`);
  }

  console.log("\nLatency (ms)");
  console.log(`  p50 : ${percentile(latencies, 0.5)}`);
  console.log(`  p95 : ${percentile(latencies, 0.95)}`);
  console.log(`  p99 : ${percentile(latencies, 0.99)}`);
  console.log(`  max : ${latencies.at(-1) ?? 0}`);

  if (failures.size > 0) {
    console.log("\nFirst body per failing status");
    for (const [status, body] of failures) {
      console.log(`  ${status === 0 ? "ERR" : status}: ${body}`);
    }
  }

  const errorRate = samples.length === 0 ? 1 : errors / samples.length;
  const p95 = percentile(latencies, 0.95);
  const verdict: string[] = [];
  if (serverErrors > TARGETS.maxServerErrors) {
    verdict.push(
      `${serverErrors} server errors (target ${TARGETS.maxServerErrors})`,
    );
  }
  if (errorRate > TARGETS.maxErrorRate) {
    verdict.push(
      `error rate ${(errorRate * 100).toFixed(2)}% (target ${(TARGETS.maxErrorRate * 100).toFixed(2)}%)`,
    );
  }
  if (p95 > TARGETS.p95Millis) {
    verdict.push(`p95 ${p95}ms (target ${TARGETS.p95Millis}ms)`);
  }

  if (verdict.length === 0) {
    console.log("\nPASS - within the targets in docs/operations/load_test.md.");
    return;
  }

  console.log(`\nFAIL - ${verdict.join("; ")}.`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
