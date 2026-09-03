import type { TemplateSpec } from "./types";

/**
 * Operations-domain templates (AF-M7-02).
 *
 * Four `Ops` gallery entries plus the receipt-triage flow, which the gallery
 * files under `Finance` but which runs on the ops team's rails.
 */
export const opsTemplates: TemplateSpec[] = [
  {
    slug: "uptime-check-alert",
    name: "Uptime check with alert",
    description:
      "Polls a health endpoint every five minutes and posts to Slack the moment it stops returning 200 — including the status it did return, so you are not guessing what broke.",
    category: "Ops",
    domain: "ops",
    tags: ["uptime", "monitoring", "alerting", "slack", "schedule"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "every-5m",
          type: "SCHEDULE_TRIGGER",
          name: "Every 5 minutes",
          position: { x: 0, y: 0 },
          data: { cron: "*/5 * * * *", timezone: "UTC" },
        },
        {
          id: "probe",
          type: "HTTP_REQUEST",
          name: "Probe the endpoint",
          position: { x: 260, y: 0 },
          data: {
            variableName: "health",
            endpoint: "https://example.com/health",
            method: "GET",
            timeoutMs: 10000,
            // Deliberately false: a non-2xx IS the signal here. Throwing would
            // fail the run before the condition could route on the status.
            failOnNon2xx: false,
          },
        },
        {
          id: "is-down",
          type: "CONDITION",
          name: "Not healthy?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{health.httpResponse.status}}",
            operator: "not_equals",
            right: "200",
          },
        },
        {
          id: "alert",
          type: "SLACK",
          name: "Alert the channel",
          position: { x: 800, y: -60 },
          data: {
            variableName: "downAlert",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK",
            content:
              ":red_circle: *Health check failed* — https://example.com/health returned {{health.httpResponse.status}} {{health.httpResponse.statusText}} at {{schedule.timestamp}}",
          },
        },
      ],
      edges: [
        { source: "every-5m", target: "probe" },
        { source: "probe", target: "is-down" },
        { source: "is-down", target: "alert", sourceHandle: "true" },
      ],
    },
  },
  {
    slug: "incident-log-to-airtable",
    name: "Incident log to Airtable",
    description:
      "Turns a rough incident note into a structured postmortem starter — impact, timeline, contributing factors — and files it as an Airtable record so the log is written while it is still fresh.",
    category: "Ops",
    domain: "ops",
    tags: ["incident", "postmortem", "airtable", "ai", "documentation"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Log an incident",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"title":"Checkout latency spike","severity":"SEV2","notes":"p95 went from 300ms to 4s for 40 minutes after the 14:10 deploy; rolled back at 14:52"}',
          },
        },
        {
          id: "fields",
          type: "SET",
          name: "Incident fields",
          position: { x: 260, y: 0 },
          data: {
            mappings: [
              { key: "incident_title", value: "{{title}}" },
              { key: "incident_severity", value: "{{severity}}" },
              { key: "incident_notes", value: "{{notes}}" },
            ],
          },
        },
        {
          id: "write-up",
          type: "AI_LLM",
          name: "Draft the postmortem",
          position: { x: 520, y: 0 },
          data: {
            variableName: "postmortem",
            model: "anthropic:claude-3-5-sonnet",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You draft blameless postmortems. State only what the notes support; mark anything unknown as an open question rather than filling it in.",
            userPrompt:
              "Incident: {{incident_title}} ({{incident_severity}})\n\nNotes:\n{{incident_notes}}\n\nProduce: impact, timeline, contributing factors, open questions, and proposed follow-ups.",
            temperature: 0.3,
            maxTokens: 1200,
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "file-record",
          type: "AIRTABLE_CREATE_RECORD",
          name: "File in Airtable",
          position: { x: 800, y: 0 },
          data: {
            variableName: "record",
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Incidents",
            fields:
              '{"Title":"{{incident_title}}","Severity":"{{incident_severity}}","Postmortem":"{{postmortem.text}}","Status":"Draft"}',
          },
        },
      ],
      edges: [
        { source: "start", target: "fields" },
        { source: "fields", target: "write-up" },
        { source: "write-up", target: "file-record" },
      ],
    },
  },
  {
    slug: "deploy-notification-fanout",
    name: "Deploy notification fan-out",
    description:
      "Announces production deploys to Slack and Discord at once, and stays quiet for every other environment so staging noise never reaches the channels people actually watch.",
    category: "Ops",
    domain: "ops",
    tags: ["deploy", "ci", "slack", "discord", "fanout"],
    graph: {
      nodes: [
        {
          id: "deployed",
          type: "WEBHOOK_TRIGGER",
          name: "Deploy finished",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "shape",
          type: "SET",
          name: "Shape the deploy",
          position: { x: 260, y: 0 },
          data: {
            mappings: [
              { key: "deploy_env", value: "{{webhook.body.environment}}" },
              { key: "deploy_sha", value: "{{webhook.body.commitSha}}" },
              { key: "deploy_author", value: "{{webhook.body.author}}" },
              { key: "deploy_message", value: "{{webhook.body.message}}" },
            ],
          },
        },
        {
          id: "is-production",
          type: "CONDITION",
          name: "Production?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{deploy_env}}",
            operator: "equals",
            right: "production",
          },
        },
        {
          id: "notify-slack",
          type: "SLACK",
          name: "Notify Slack",
          position: { x: 800, y: -90 },
          data: {
            variableName: "slackNotice",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK",
            content:
              ":rocket: *Deployed to production* — `{{deploy_sha}}` by {{deploy_author}}\n{{deploy_message}}",
          },
        },
        {
          id: "notify-discord",
          type: "DISCORD",
          name: "Notify Discord",
          position: { x: 800, y: 90 },
          data: {
            variableName: "discordNotice",
            webhookUrl:
              "https://discord.com/api/webhooks/REPLACE/WITH_YOUR_WEBHOOK",
            username: "Deploys",
            content:
              "Deployed to production — `{{deploy_sha}}` by {{deploy_author}}\n{{deploy_message}}",
          },
        },
      ],
      edges: [
        { source: "deployed", target: "shape" },
        { source: "shape", target: "is-production" },
        {
          source: "is-production",
          target: "notify-slack",
          sourceHandle: "true",
        },
        {
          source: "is-production",
          target: "notify-discord",
          sourceHandle: "true",
        },
      ],
    },
  },
  {
    slug: "oncall-handoff-summary",
    name: "On-call handoff summary",
    description:
      "At every shift change it pulls the open incidents, summarises them through your own OpenAI-compatible endpoint — Groq, Ollama, vLLM, anything — and posts the handoff to Discord.",
    category: "Ops",
    domain: "ops",
    tags: ["oncall", "handoff", "discord", "self-hosted", "ai"],
    graph: {
      nodes: [
        {
          id: "shift-change",
          type: "SCHEDULE_TRIGGER",
          name: "Shift change",
          position: { x: 0, y: 0 },
          data: { cron: "0 8,20 * * *", timezone: "UTC" },
        },
        {
          id: "fetch-incidents",
          type: "HTTP_REQUEST",
          name: "Fetch open incidents",
          position: { x: 260, y: 0 },
          data: {
            variableName: "incidents",
            endpoint: "https://status.example.com/api/incidents",
            method: "GET",
            queryParams: { state: "open" },
            timeoutMs: 15000,
            failOnNon2xx: true,
          },
        },
        {
          id: "summarize",
          type: "OPENAI_COMPATIBLE_CHAT",
          name: "Summarise for the next shift",
          position: { x: 520, y: 0 },
          data: {
            variableName: "handoff",
            baseUrl: "https://api.groq.com/openai/v1",
            model: "llama-3.3-70b-versatile",
            systemPrompt:
              "You write on-call handoffs. Lead with what the next engineer must watch. Be terse.",
            userPrompt:
              "Open incidents at {{schedule.timestamp}}:\n\n{{incidents.httpResponse.data}}\n\nWrite the handoff: what is still burning, what is being watched, and what can wait.",
          },
        },
        {
          id: "post-handoff",
          type: "DISCORD",
          name: "Post the handoff",
          position: { x: 800, y: 0 },
          data: {
            variableName: "handoffPost",
            webhookUrl:
              "https://discord.com/api/webhooks/REPLACE/WITH_YOUR_WEBHOOK",
            username: "On-call",
            content: "**Handoff — {{schedule.timestamp}}**\n\n{{handoff.text}}",
          },
        },
      ],
      edges: [
        { source: "shift-change", target: "fetch-incidents" },
        { source: "fetch-incidents", target: "summarize" },
        { source: "summarize", target: "post-handoff" },
      ],
    },
  },
  {
    slug: "expense-receipt-triage",
    name: "Expense receipt triage",
    description:
      "Reads vendor, amount, date, and category off an incoming receipt, sends anything above your approval threshold to Slack for a human, and books everything below it straight to Airtable.",
    category: "Finance",
    domain: "ops",
    tags: ["expenses", "receipts", "approval", "airtable", "ai"],
    graph: {
      nodes: [
        {
          id: "receipt",
          type: "WEBHOOK_TRIGGER",
          name: "Receipt received",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "read-receipt",
          type: "AI_EXTRACT",
          name: "Read the receipt",
          position: { x: 260, y: 0 },
          data: {
            variableName: "expense",
            model: "openai:gpt-4o-mini",
            fallbackModels: "google:gemini-1.5-flash",
            content:
              "Receipt text submitted by {{webhook.body.submittedBy}}:\n\n{{webhook.body.text}}",
            fields: [
              { name: "vendor", type: "string", description: "Merchant name." },
              {
                name: "amount",
                type: "number",
                description: "Total in major currency units.",
              },
              {
                name: "currency",
                type: "string",
                description: "ISO 4217 code.",
              },
              {
                name: "purchasedAt",
                type: "string",
                description: "ISO 8601 date.",
              },
              {
                name: "category",
                type: "string",
                description:
                  "One of: travel, software, meals, hardware, other.",
              },
            ],
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "needs-approval",
          type: "CONDITION",
          name: "Above the threshold?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{expense.amount}}",
            operator: "gt",
            right: "500",
          },
        },
        {
          id: "request-approval",
          type: "SLACK",
          name: "Request approval",
          position: { x: 800, y: -90 },
          data: {
            variableName: "approvalRequest",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/FINANCE_WEBHOOK",
            content:
              ":receipt: *Approval needed* — {{expense.vendor}}, {{expense.amount}} {{expense.currency}} ({{expense.category}}) on {{expense.purchasedAt}}, submitted by {{webhook.body.submittedBy}}",
          },
        },
        {
          id: "book-expense",
          type: "AIRTABLE_CREATE_RECORD",
          name: "Book the expense",
          position: { x: 800, y: 90 },
          data: {
            variableName: "booked",
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Expenses",
            fields:
              '{"Vendor":"{{expense.vendor}}","Amount":"{{expense.amount}}","Currency":"{{expense.currency}}","Date":"{{expense.purchasedAt}}","Category":"{{expense.category}}","Status":"Auto-approved"}',
          },
        },
      ],
      edges: [
        { source: "receipt", target: "read-receipt" },
        { source: "read-receipt", target: "needs-approval" },
        {
          source: "needs-approval",
          target: "request-approval",
          sourceHandle: "true",
        },
        {
          source: "needs-approval",
          target: "book-expense",
          sourceHandle: "false",
        },
      ],
    },
  },
  {
    slug: "deployment-env-router",
    name: "Deployment environment router",
    description:
      "Accepts a deployment webhook, reads the environment field out of its payload, and forwards the delivery to the target for that environment — so prod, staging, and dev builds each land where they belong.",
    category: "Ops",
    domain: "ops",
    tags: ["deployment", "webhook", "switch", "routing", "ops"],
    graph: {
      nodes: [
        {
          id: "deploy",
          type: "WEBHOOK_TRIGGER",
          name: "Deployment webhook",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "route-env",
          type: "SWITCH",
          name: "Route by environment",
          position: { x: 260, y: 0 },
          data: {
            rules: [
              {
                outputKey: "prod",
                left: "{{webhook.body.environment}}",
                operator: "equals",
                right: "prod",
              },
              {
                outputKey: "staging",
                left: "{{webhook.body.environment}}",
                operator: "equals",
                right: "staging",
              },
              {
                outputKey: "dev",
                left: "{{webhook.body.environment}}",
                operator: "equals",
                right: "dev",
              },
            ],
            fallback: "none",
          },
        },
        {
          id: "deliver-prod",
          type: "WEBHOOK_OUT",
          name: "Forward to prod channel",
          position: { x: 560, y: -120 },
          data: {
            variableName: "prodDelivery",
            url: "https://hooks.example.com/prod/REPLACE_WITH_WEBHOOK",
            body: '{"environment":"prod","commit":"{{webhook.body.commit}}"}',
          },
        },
        {
          id: "deliver-staging",
          type: "WEBHOOK_OUT",
          name: "Forward to staging channel",
          position: { x: 560, y: 0 },
          data: {
            variableName: "stagingDelivery",
            url: "https://hooks.example.com/staging/REPLACE_WITH_WEBHOOK",
            body: '{"environment":"staging","commit":"{{webhook.body.commit}}"}',
          },
        },
        {
          id: "deliver-dev",
          type: "WEBHOOK_OUT",
          name: "Forward to dev channel",
          position: { x: 560, y: 120 },
          data: {
            variableName: "devDelivery",
            url: "https://hooks.example.com/dev/REPLACE_WITH_WEBHOOK",
            body: '{"environment":"dev","commit":"{{webhook.body.commit}}"}',
          },
        },
      ],
      edges: [
        { source: "deploy", target: "route-env" },
        { source: "route-env", target: "deliver-prod", sourceHandle: "prod" },
        {
          source: "route-env",
          target: "deliver-staging",
          sourceHandle: "staging",
        },
        { source: "route-env", target: "deliver-dev", sourceHandle: "dev" },
      ],
    },
  },
  /**
   * W1 (AF-M9-15). Derives from
   * `n8n-workflows/workflows/Templates/9001_Scalable_Webhook_Orchestrator_Webhook.json`
   * — one of only four files in that 2,061-workflow library whose `connections`
   * survived intact (see M9 §0), and credential-free, so it runs in CI.
   *
   * Deviations from the source, all deliberate:
   *  - The source pins the receiver path in the trigger's config
   *    (`template/scalable-orchestrator`). `WEBHOOK_TRIGGER` takes no path
   *    config — the URL is derived from the workflow id — so the path is
   *    omitted rather than faked.
   *  - `?sync=true` is a query parameter on the call, not node config, so it
   *    is documented in the description instead of encoded in the graph.
   */
  {
    slug: "api-router-sync-response",
    name: "Sync API endpoint with action routing",
    description:
      "Turns a workflow into a real HTTP endpoint: it reads an `action` from the request body, routes to the branch that handles it, and returns that branch's own JSON response to the caller, status code included. Call the webhook with `?sync=true` to get the response back on the same request. Ships with two actions, `ping` and `process` — add a Switch rule and a branch for each new one.",
    category: "Ops",
    domain: "ops",
    tags: ["webhook", "api", "router", "switch", "sync", "endpoint"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "inbound",
          type: "WEBHOOK_TRIGGER",
          name: "Inbound",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "parse-input",
          type: "SET",
          name: "Parse input",
          position: { x: 260, y: 0 },
          data: {
            mappings: [
              {
                key: "action",
                value: '{{default webhook.body.action "ping"}}',
                type: "string",
              },
              {
                key: "payload",
                // `{{#if}}` rather than a bare `{{{json …}}}`: the field is
                // typed `object`, and a request with no payload at all (every
                // `ping`) would otherwise resolve to `null`, which AF-M9-08
                // correctly refuses to coerce into an object. An absent
                // payload means "an empty one", and that has to be said.
                value:
                  "{{#if webhook.body.payload}}{{{json webhook.body.payload}}}{{else}}{}{{/if}}",
                type: "object",
              },
            ],
          },
        },
        {
          id: "route-by-action",
          type: "SWITCH",
          name: "Route by action",
          position: { x: 520, y: 0 },
          data: {
            rules: [
              {
                outputKey: "ping",
                left: "{{action}}",
                operator: "equals",
                right: "ping",
              },
              {
                outputKey: "process",
                left: "{{action}}",
                operator: "equals",
                right: "process",
              },
            ],
            // "none": an unrecognised action takes no branch, so the run ends
            // SUCCESS having done nothing, rather than falling through into a
            // handler written for a different action.
            fallback: "none",
          },
        },
        {
          id: "compose-ping",
          type: "SET",
          name: "Compose ping",
          position: { x: 800, y: -120 },
          data: {
            mappings: [
              { key: "ok", value: "true", type: "boolean" },
              { key: "message", value: "pong", type: "string" },
            ],
          },
        },
        {
          id: "service-a",
          type: "HTTP_REQUEST",
          name: "Service A",
          position: { x: 800, y: 120 },
          data: {
            variableName: "serviceA",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            body: "{{{json payload}}}",
            headers: { "content-type": "application/json" },
            failOnNon2xx: true,
            _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10000 },
          },
        },
        {
          id: "compose-result",
          type: "SET",
          name: "Compose result",
          position: { x: 1060, y: 120 },
          data: {
            mappings: [
              { key: "ok", value: "true", type: "boolean" },
              {
                key: "data",
                value: "{{{json serviceA.httpResponse.data.json}}}",
                type: "object",
              },
              { key: "source", value: "serviceA", type: "string" },
            ],
          },
        },
        {
          id: "respond",
          type: "RESPOND_TO_WEBHOOK",
          name: "Respond",
          position: { x: 1320, y: 0 },
          data: {
            statusCode: 200,
            contentType: "application/json",
            body: "{{{json $json}}}",
          },
        },
      ],
      edges: [
        { source: "inbound", target: "parse-input" },
        { source: "parse-input", target: "route-by-action" },
        {
          source: "route-by-action",
          target: "compose-ping",
          sourceHandle: "ping",
        },
        {
          source: "route-by-action",
          target: "service-a",
          sourceHandle: "process",
        },
        { source: "service-a", target: "compose-result" },
        { source: "compose-ping", target: "respond" },
        { source: "compose-result", target: "respond" },
      ],
    },
  },
  /**
   * W2 (AF-M9-15). Derives from
   * `n8n-workflows/workflows/Templates/9003_FanOut_Broadcast_and_Merge_Webhook.json`.
   *
   * No deviations in shape. The two branches genuinely run against isolated
   * inputs (AF-M9-12) and land on distinct MERGE input ports (AF-M9-11) — the
   * pair of gaps that made this graph inexpressible before M9. Same
   * webhook-path caveat as W1.
   */
  {
    slug: "multi-channel-broadcast-merge",
    name: "Broadcast to two channels and merge",
    description:
      "Fans one inbound message out to two delivery channels at once, waits for both, and returns a single combined result to the caller. Both HTTP nodes point at a request-echo service so the template runs exactly as shipped — repoint each at your real channel (Slack, SMS, a partner API) and the shape is unchanged.",
    category: "Ops",
    domain: "ops",
    tags: ["webhook", "broadcast", "fan-out", "merge", "parallel", "sync"],
    graph: {
      nodes: [
        {
          id: "inbound",
          type: "WEBHOOK_TRIGGER",
          name: "Inbound",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "prepare-message",
          type: "SET",
          name: "Prepare message",
          position: { x: 260, y: 0 },
          data: {
            mappings: [
              {
                key: "message",
                value: '{{default webhook.body.message "Hello from AutoFlow"}}',
                type: "string",
              },
            ],
          },
        },
        {
          id: "broadcast-a",
          type: "HTTP_REQUEST",
          name: "Broadcast A",
          position: { x: 540, y: -120 },
          data: {
            variableName: "respA",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            body: '{"text":"{{message}}","channel":"alpha"}',
            headers: { "content-type": "application/json" },
            failOnNon2xx: true,
            _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10000 },
          },
        },
        {
          id: "broadcast-b",
          type: "HTTP_REQUEST",
          name: "Broadcast B",
          position: { x: 540, y: 120 },
          data: {
            variableName: "respB",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            body: '{"text":"{{message}}","channel":"beta"}',
            headers: { "content-type": "application/json" },
            failOnNon2xx: true,
            _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10000 },
          },
        },
        {
          id: "merge-results",
          type: "MERGE",
          name: "Merge results",
          position: { x: 820, y: 0 },
          // byInput keeps each branch under its own key (`input0`, `input1`)
          // instead of letting one overwrite the other — the entire reason for
          // waiting on both.
          data: { mode: "byInput", inputCount: 2 },
        },
        {
          id: "respond",
          type: "RESPOND_TO_WEBHOOK",
          name: "Respond",
          position: { x: 1080, y: 0 },
          data: {
            statusCode: 200,
            contentType: "application/json",
            body: "{{{json $json}}}",
          },
        },
      ],
      edges: [
        { source: "inbound", target: "prepare-message" },
        { source: "prepare-message", target: "broadcast-a" },
        { source: "prepare-message", target: "broadcast-b" },
        {
          source: "broadcast-a",
          target: "merge-results",
          targetHandle: "input-0",
        },
        {
          source: "broadcast-b",
          target: "merge-results",
          targetHandle: "input-1",
        },
        { source: "merge-results", target: "respond" },
      ],
    },
  },
];
