import type { Metadata } from "next";
import { checkHealth } from "@/features/health/server/checks";
import type { HealthCheck, HealthState } from "@/lib/health";
import { cn } from "@/lib/utils";

/**
 * Public status page (AF-M8-07).
 *
 * Deliberately outside the `(dashboard)` group: the moment this page is needed
 * is the moment the app may not be able to render an authenticated shell, so
 * it renders standalone with no session, no tRPC, and no client JavaScript.
 *
 * It reports what this instance can observe about itself and says so plainly.
 * That is honest but limited - an instance that is completely down serves no
 * page at all, which is exactly why the runbook (`docs/operations/runbooks.md`)
 * puts an external uptime monitor on `/api/health` rather than trusting this
 * page to be the alarm.
 */

export const metadata: Metadata = {
  title: "AutoFlow — status",
  description: "Current operational status of this AutoFlow instance.",
};

/** Never a cached render: a stale status page is worse than none. */
export const dynamic = "force-dynamic";

const SUMMARY: Readonly<Record<HealthState, string>> = {
  ok: "All systems operational",
  degraded: "Degraded — some functionality is affected",
  down: "Major outage",
};

const CHECK_LABELS: Record<string, { label: string; detail: string }> = {
  database: {
    label: "Database",
    detail: "Reads and writes for workflows, runs, and credentials.",
  },
  runner: {
    label: "Execution engine",
    detail: "Workflow runs being picked up and driven to completion.",
  },
};

const STATE_LABEL: Readonly<Record<HealthState, string>> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Outage",
};

const dotClass = (state: HealthState) =>
  cn(
    "size-2.5 shrink-0 rounded-full",
    state === "ok" && "bg-emerald-500",
    state === "degraded" && "bg-amber-500",
    state === "down" && "bg-red-500",
  );

const CheckRow = ({ check }: { check: HealthCheck }) => {
  const copy = CHECK_LABELS[check.name] ?? {
    label: check.name,
    detail: "",
  };

  return (
    <li className="flex items-start justify-between gap-4 border-t border-hairline py-4 first:border-t-0">
      <div className="min-w-0">
        <p className="font-medium">{copy.label}</p>
        {copy.detail ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{copy.detail}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <span className={dotClass(check.state)} aria-hidden />
        <span className="text-sm text-muted-foreground">
          {STATE_LABEL[check.state]}
        </span>
      </div>
    </li>
  );
};

export default async function StatusPage() {
  const report = await checkHealth();
  const checkedAt = new Date();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">
          AutoFlow status
        </p>
        <div className="flex items-center gap-3">
          <span className={dotClass(report.status)} aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">
            {SUMMARY[report.status]}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Checked{" "}
          <time dateTime={checkedAt.toISOString()}>
            {checkedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
          </time>
          . Reload for a fresh reading.
        </p>
      </header>

      <section aria-label="Components">
        <ul className="rounded-xl border border-hairline bg-panel px-5">
          {report.checks.map((check) => (
            <CheckRow check={check} key={check.name} />
          ))}
        </ul>
      </section>

      <footer className="text-sm text-muted-foreground">
        <p>
          This page reflects what this instance can observe about itself, at the
          moment you loaded it. It is not an incident history, and it cannot
          report an outage severe enough to stop it rendering — which is why
          alerting watches{" "}
          <code className="rounded bg-well px-1 py-0.5 text-xs">
            /api/health
          </code>{" "}
          from outside.
        </p>
      </footer>
    </main>
  );
}
