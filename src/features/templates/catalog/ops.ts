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
          type: "SLACK_POST",
          name: "Alert the channel",
          position: { x: 800, y: -60 },
          data: {
            variableName: "downAlert",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":red_circle: *Health check failed* — https://example.com/health returned {{health.httpResponse.status}} {{health.httpResponse.statusText}} at {{schedule.timestamp}}",
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
          type: "SLACK_POST",
          name: "Notify Slack",
          position: { x: 800, y: -90 },
          data: {
            variableName: "slackNotice",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":rocket: *Deployed to production* — `{{deploy_sha}}` by {{deploy_author}}\n{{deploy_message}}",
          },
        },
        {
          id: "notify-discord",
          type: "DISCORD",
          name: "Notify Discord",
          position: { x: 800, y: 90 },
          data: {
            variableName: "discordNotice",
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
    // QuickBooks to record the expense, Slack to report it.
    tier: "library",
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
          type: "SLACK_POST",
          name: "Request approval",
          position: { x: 800, y: -90 },
          data: {
            variableName: "approvalRequest",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":receipt: *Approval needed* — {{expense.vendor}}, {{expense.amount}} {{expense.currency}} ({{expense.category}}) on {{expense.purchasedAt}}, submitted by {{webhook.body.submittedBy}}",
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
  {
    slug: "contract-review-pdf-report",
    name: "Contract review to a PDF report",
    description:
      "Downloads a contract, extracts its text, has a model review it against a plain-English risk brief, and renders the findings as a PDF you can send to a lawyer. The report is built from HTML the workflow controls, and rendering runs with no network access and no script execution — a contract that arrived from outside cannot make the renderer fetch anything. Supply the document URL and an AI credential. The PDF comes back as a file reference, so the next node can email it, upload it to Drive, or archive it without the bytes ever entering the run payload.",
    category: "Ops",
    domain: "ops",
    tags: ["contract", "legal", "pdf", "report", "extract", "review"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Run manually",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "fetch-contract",
          type: "FILE_DOWNLOAD",
          name: "Download the contract",
          position: { x: 260, y: 0 },
          data: {
            variableName: "contract",
            url: "https://example.com/contracts/acme-msa.pdf",
            maxBytes: 26214400,
          },
        },
        {
          id: "read-contract",
          type: "EXTRACT_DOCUMENT_TEXT",
          name: "Extract the text",
          position: { x: 520, y: 0 },
          data: {
            variableName: "contractText",
            file: "{{{json contract.file}}}",
            maxCharacters: 150000,
          },
        },
        {
          id: "review",
          type: "AI_LLM",
          name: "Review the clauses",
          position: { x: 780, y: 0 },
          data: {
            variableName: "review",
            model: "anthropic:claude-3-5-haiku",
            fallbackModels: "openai:gpt-4o-mini",
            systemPrompt:
              "You are reviewing a commercial contract for a non-lawyer. Return an HTML fragment only — no <html>, <head> or <script> — using <h2>, <p>, <ul> and a <table> of clause / risk / why it matters. Flag indemnity, liability caps, auto-renewal, termination and data terms. If the supplied text is marked truncated, say so at the top: never imply you reviewed the whole agreement.",
            userPrompt:
              "Truncated: {{contractText.truncated}}\nPages: {{contractText.pageCount}}\n\n{{contractText.text}}",
            temperature: 0.1,
            maxTokens: 2000,
          },
        },
        {
          id: "render",
          type: "HTML_TO_PDF",
          name: "Render the report",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "report",
            filename: "contract-review.pdf",
            pageSize: "A4",
            orientation: "portrait",
            header: "Contract review — {{contract.file.$file.filename}}",
            footer: "Generated by AutoFlow. Not legal advice.",
            // The model returns an HTML fragment; the surrounding structure is
            // the workflow's, not the model's, so a prompt injection cannot
            // change the document's shape.
            html: "<h1>Contract review</h1><p><strong>Source:</strong> {{contract.file.$file.filename}}</p>{{{review.text}}}",
          },
        },
      ],
      edges: [
        { source: "start", target: "fetch-contract" },
        { source: "fetch-contract", target: "read-contract" },
        { source: "read-contract", target: "review" },
        { source: "review", target: "render" },
      ],
    },
  },
  {
    slug: "spend-request-approval-gate",
    name: "Spend request with an approval gate",
    description:
      "Takes a spend request from a hosted form, routes anything over the threshold to a named approver by email, and only records approved requests. The approver does not need an AutoFlow account: the email carries single-use, expiring links, and clicking one opens a confirmation page rather than approving on the spot — mail scanners follow links, and an approval a scanner granted is worse than no gate at all. Requests under the threshold skip the gate entirely. Supply an SMTP credential, a sender address, the approver's address, and the endpoint that records the decision.",
    category: "Ops",
    domain: "ops",
    tags: ["approval", "human-in-the-loop", "spend", "form", "gate", "email"],
    graph: {
      nodes: [
        {
          id: "request",
          type: "FORM_TRIGGER",
          name: "Spend request",
          position: { x: 0, y: 0 },
          data: {
            title: "Request spend approval",
            description:
              "Requests over the threshold go to a manager. Under it, they are recorded immediately.",
            submitLabel: "Submit request",
            successMessage: "Submitted. You will hear back by email.",
            fields: [
              {
                name: "requester",
                label: "Your email",
                type: "email",
                required: true,
              },
              {
                name: "amount",
                label: "Amount (GBP)",
                type: "number",
                required: true,
              },
              {
                name: "reason",
                label: "What is it for?",
                type: "textarea",
                required: true,
                maxLength: 2000,
              },
            ],
          },
        },
        {
          id: "needs-approval",
          type: "CONDITION",
          name: "Over the threshold?",
          position: { x: 280, y: 0 },
          data: {
            left: "{{form.fields.amount}}",
            operator: "gt",
            right: "1000",
          },
        },
        {
          id: "gate",
          type: "APPROVAL",
          name: "Manager approval",
          position: { x: 560, y: -80 },
          data: {
            variableName: "approval",
            channel: "email",
            approvers: "manager@example.com",
            from: "automation@example.com",
            subject: "Spend approval needed: GBP {{form.fields.amount}}",
            prompt:
              "{{form.fields.requester}} is requesting GBP {{form.fields.amount}}.\n\nReason: {{form.fields.reason}}",
            // One working day. A request nobody answered by then routes to the
            // rejected branch with the reason recorded, rather than holding
            // the run open indefinitely.
            timeoutSeconds: 86400,
          },
        },
        {
          id: "record-approved",
          type: "HTTP_REQUEST",
          name: "Record it",
          position: { x: 860, y: -80 },
          data: {
            variableName: "recorded",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"requester":"{{form.fields.requester}}","amount":"{{form.fields.amount}}","approvedBy":"{{approval.respondedBy}}","note":"{{approval.comment}}"}',
            failOnNon2xx: true,
          },
        },
        {
          id: "record-small",
          type: "HTTP_REQUEST",
          name: "Record without approval",
          position: { x: 860, y: 120 },
          data: {
            variableName: "recorded",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"requester":"{{form.fields.requester}}","amount":"{{form.fields.amount}}","approvedBy":"under-threshold"}',
            failOnNon2xx: true,
          },
        },
      ],
      edges: [
        { source: "request", target: "needs-approval" },
        { source: "needs-approval", sourceHandle: "true", target: "gate" },
        {
          source: "needs-approval",
          sourceHandle: "false",
          target: "record-small",
        },
        { source: "gate", sourceHandle: "approved", target: "record-approved" },
      ],
    },
  },
  {
    slug: "drive-contract-intake-and-file",
    name: "Drive folder intake, reviewed and filed",
    description:
      "Watches a Drive folder, extracts the text of each new document, has a model summarise the obligations it creates, and then MOVES the file to a processed folder. The move is the important part: a watched folder that is never emptied re-reads the same contract on every poll, and the summary arrives again each time. Files already in the folder when you publish are not replayed — the trigger records where the folder was and starts from there. Google Docs are exported to .docx automatically, so a native Doc works the same as an uploaded PDF. Supply a Drive credential, the two folder ids, and an AI credential.",
    category: "Ops",
    domain: "ops",
    tags: ["drive", "intake", "contract", "extract", "move", "review"],
    graph: {
      nodes: [
        {
          id: "new-file",
          type: "DRIVE_TRIGGER",
          name: "New file in intake",
          position: { x: 0, y: 0 },
          data: {
            folderId: "REPLACE_WITH_INTAKE_FOLDER_ID",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "download",
          type: "DRIVE_DOWNLOAD",
          name: "Download it",
          position: { x: 280, y: 0 },
          data: {
            variableName: "downloaded",
            fileId: "{{file.id}}",
          },
        },
        {
          id: "read",
          type: "EXTRACT_DOCUMENT_TEXT",
          name: "Extract the text",
          position: { x: 560, y: 0 },
          data: {
            variableName: "extracted",
            file: "{{{json downloaded.file}}}",
            maxCharacters: 150000,
          },
        },
        {
          id: "summarise",
          type: "AI_LLM",
          name: "Summarise the obligations",
          position: { x: 840, y: 0 },
          data: {
            variableName: "summary",
            model: "anthropic:claude-3-5-haiku",
            fallbackModels: "openai:gpt-4o-mini",
            systemPrompt:
              "Summarise what this document commits the reader to. Lead with obligations and dates. If the text is marked truncated, say so first and never imply you saw all of it.",
            userPrompt:
              "File: {{file.name}}\nTruncated: {{extracted.truncated}}\n\n{{extracted.text}}",
            temperature: 0.2,
            maxTokens: 900,
          },
        },
        {
          id: "file-it",
          type: "DRIVE_MOVE",
          name: "Move to processed",
          position: { x: 1120, y: 0 },
          data: {
            variableName: "filed",
            fileId: "{{file.id}}",
            toFolderId: "REPLACE_WITH_PROCESSED_FOLDER_ID",
          },
        },
      ],
      edges: [
        { source: "new-file", target: "download" },
        { source: "download", target: "read" },
        { source: "read", target: "summarise" },
        { source: "summarise", target: "file-it" },
      ],
    },
  },
  {
    slug: "meeting-briefing-before-it-starts",
    name: "Meeting briefing, fifteen minutes before",
    description:
      "Watches your calendar two hours ahead and, for each meeting that appears, waits until fifteen minutes before it starts and then emails you a briefing with the attendees and the agenda. The wait is what makes it useful: a briefing sent when the meeting was scheduled is read and forgotten, and one sent as you join is read. Meeting rooms are filtered out of the attendee list — they are attendees to Calendar and not to you. A rescheduled meeting briefs again, because the reminder is keyed to the slot rather than the invitation. Supply a Calendar credential and a Gmail credential.",
    category: "Ops",
    domain: "ops",
    // Calendar to read the meeting, Gmail to deliver the briefing. Two
    // services is what this automation is; see `TemplateSpec.tier`.
    tier: "library",
    tags: ["calendar", "meeting", "briefing", "wait", "gmail", "reminder"],
    graph: {
      nodes: [
        {
          id: "upcoming",
          type: "CALENDAR_TRIGGER",
          name: "Meeting soon",
          position: { x: 0, y: 0 },
          data: {
            calendarId: "primary",
            lookaheadMinutes: 120,
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "hold",
          type: "WAIT",
          name: "Wait until T-15",
          position: { x: 300, y: 0 },
          data: {
            mode: "until",
            // A time already past resolves immediately, so a meeting found
            // inside fifteen minutes briefs straight away rather than being
            // skipped.
            until: "{{event.start}}",
          },
        },
        {
          id: "brief",
          type: "AI_LLM",
          name: "Write the briefing",
          position: { x: 600, y: 0 },
          data: {
            variableName: "briefing",
            model: "openai:gpt-4o-mini",
            fallbackModels: "anthropic:claude-3-5-haiku",
            systemPrompt:
              "Write a short pre-meeting briefing. Lead with who is attending and what the meeting is for. Six lines at most. No preamble.",
            userPrompt:
              "Title: {{event.summary}}\nStarts: {{event.start}}\nLocation: {{event.location}}\nAgenda: {{event.description}}\nAttendees: {{{json event.attendees}}}",
            temperature: 0.3,
            maxTokens: 400,
          },
        },
        {
          id: "send",
          type: "GMAIL_SEND",
          name: "Email the briefing",
          position: { x: 900, y: 0 },
          data: {
            variableName: "sent",
            from: "REPLACE_WITH_YOUR_ADDRESS",
            to: "REPLACE_WITH_YOUR_ADDRESS",
            subject: "In 15 minutes: {{event.summary}}",
            html: '<h2>{{event.summary}}</h2><p>{{briefing.text}}</p><p><a href="{{event.htmlLink}}">Open in Calendar</a></p>',
          },
        },
      ],
      edges: [
        { source: "upcoming", target: "hold" },
        { source: "hold", target: "brief" },
        { source: "brief", target: "send" },
      ],
    },
  },
  {
    slug: "quickbooks-invoice-from-order",
    name: "Invoice a customer from an incoming order",
    description:
      'Takes an order over a webhook, looks the customer up in QuickBooks, creates them if this is their first order, and raises the invoice. The lookup is the point: QuickBooks rejects a duplicate display name outright, so a flow that always creates fails on every returning customer — and one that always assumes the customer exists fails on every new one. Lines are read from the order payload, so amounts arriving as "$1,299.00" from a store or a spreadsheet are handled. Sandbox or production is decided by the credential you connect, never by this graph, so copying it between companies cannot point it at the wrong books. Supply a QuickBooks credential; the webhook URL is on the trigger once you publish.',
    category: "Finance",
    domain: "ops",
    tags: ["quickbooks", "invoice", "order", "customer", "webhook", "billing"],
    graph: {
      nodes: [
        {
          id: "order",
          type: "WEBHOOK_TRIGGER",
          name: "Order received",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "lookup",
          type: "QBO_FIND_CUSTOMER",
          name: "Find the customer",
          position: { x: 260, y: 0 },
          data: {
            variableName: "lookup",
            displayName: "{{webhook.body.customer.name}}",
            email: "{{webhook.body.customer.email}}",
          },
        },
        {
          id: "known",
          type: "CONDITION",
          name: "Do we know them?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{lookup.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "invoice-existing",
          type: "QBO_CREATE_INVOICE",
          name: "Invoice (existing)",
          position: { x: 800, y: -120 },
          data: {
            variableName: "invoice",
            customerId: "{{lookup.customerId}}",
            lines: "{{{json webhook.body.items}}}",
            customerMemo: "Order {{webhook.body.orderId}}",
          },
        },
        {
          id: "new-customer",
          type: "QBO_CREATE_CUSTOMER",
          name: "Create the customer",
          position: { x: 800, y: 120 },
          data: {
            variableName: "created",
            displayName: "{{webhook.body.customer.name}}",
            email: "{{webhook.body.customer.email}}",
          },
        },
        {
          id: "invoice-new",
          type: "QBO_CREATE_INVOICE",
          name: "Invoice (new)",
          position: { x: 1060, y: 120 },
          data: {
            variableName: "invoice",
            customerId: "{{created.customerId}}",
            lines: "{{{json webhook.body.items}}}",
            customerMemo: "Order {{webhook.body.orderId}}",
          },
        },
      ],
      edges: [
        { source: "order", target: "lookup" },
        { source: "lookup", target: "known" },
        // Two invoice nodes rather than a merge: only one branch runs, and a
        // MERGE waits for inputs that will never arrive on the other side.
        { source: "known", target: "invoice-existing", sourceHandle: "true" },
        { source: "known", target: "new-customer", sourceHandle: "false" },
        { source: "new-customer", target: "invoice-new" },
      ],
    },
  },
  {
    slug: "quickbooks-invoice-alerts-in-slack",
    name: "Post new QuickBooks invoices to Slack",
    description:
      "Watches the connected QuickBooks company and posts a line in Slack whenever an invoice is created or updated. QuickBooks tells you what changed but not what it now says, so the workflow reads the record back before writing the message — otherwise the alert could only ever name an id. Intuit sends every connected company's events to one endpoint, so the trigger's credential is what decides which company this workflow is listening to; a second connected company will not start it. Supply a QuickBooks credential and a Slack incoming-webhook URL.",
    category: "Finance",
    domain: "ops",
    // QuickBooks to read the invoice, Slack to post it.
    tier: "library",
    tags: ["quickbooks", "invoice", "slack", "alert", "webhook", "finance"],
    graph: {
      nodes: [
        {
          id: "changed",
          type: "QBO_WEBHOOK_TRIGGER",
          name: "Invoice changed",
          position: { x: 0, y: 0 },
          data: {
            entities: ["Invoice"],
            operations: ["Create", "Update"],
          },
        },
        {
          id: "read",
          type: "QBO_GET",
          name: "Read the invoice",
          position: { x: 300, y: 0 },
          data: {
            variableName: "invoice",
            entity: "Invoice",
            entityId: "{{qbo.entityId}}",
          },
        },
        {
          id: "post",
          type: "SLACK_POST",
          name: "Post to Slack",
          position: { x: 600, y: 0 },
          data: {
            variableName: "posted",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "Invoice {{invoice.record.DocNumber}} {{qbo.operation}}d — {{invoice.record.CustomerRef.name}}, {{invoice.record.TotalAmt}} (balance {{invoice.record.Balance}})",
          },
        },
      ],
      edges: [
        { source: "changed", target: "read" },
        { source: "read", target: "post" },
      ],
    },
  },
  {
    slug: "quickbooks-invoice-pdfs-to-drive",
    name: "File every QuickBooks invoice PDF in Drive",
    description:
      "Whenever an invoice is created in QuickBooks, fetches the PDF QuickBooks itself would email and files it in a Drive folder. The PDF is the rendered document, not a reconstruction — it carries the company's own template and numbering, which is what makes the archive worth keeping. It moves through the workflow as a reference rather than as bytes, so the size of the invoice does not change what the graph can do, and it is named after the invoice number rather than its internal id so the folder is readable. Supply a QuickBooks credential, a Drive credential and the destination folder id.",
    category: "Finance",
    domain: "ops",
    // QuickBooks to read the invoice, Drive to file it. Two services is what
    // this automation is; see `TemplateSpec.tier`.
    tier: "library",
    tags: ["quickbooks", "invoice", "pdf", "drive", "archive", "finance"],
    graph: {
      nodes: [
        {
          id: "raised",
          type: "QBO_WEBHOOK_TRIGGER",
          name: "Invoice raised",
          position: { x: 0, y: 0 },
          data: { entities: ["Invoice"], operations: ["Create"] },
        },
        {
          id: "pdf",
          type: "QBO_GET_INVOICE_PDF",
          name: "Fetch the PDF",
          position: { x: 300, y: 0 },
          data: {
            variableName: "pdf",
            invoiceId: "{{qbo.entityId}}",
          },
        },
        {
          id: "file-it",
          type: "DRIVE_UPLOAD",
          name: "File it in Drive",
          position: { x: 600, y: 0 },
          data: {
            variableName: "archived",
            file: "{{{json pdf.file}}}",
            folderId: "REPLACE_WITH_INVOICES_FOLDER_ID",
          },
        },
      ],
      edges: [
        { source: "raised", target: "pdf" },
        { source: "pdf", target: "file-it" },
      ],
    },
  },
  {
    slug: "slack-deal-room-per-opportunity",
    name: "A Slack channel per deal, created and staffed",
    description:
      'Takes a new opportunity over a webhook, opens a dedicated Slack channel for it, pulls the deal team in, and posts the opening summary. Channel names are normalised to Slack\'s rules first, so "Acme Corp — Q3 renewal" becomes a channel Slack will actually accept. Creating is safe to re-run: a name that already exists returns the existing channel rather than failing, so a retried delivery does not fail and does not make a second room. Inviting someone already in the channel is likewise not an error. The listing step is there so the run records what was already present — useful when you are wondering why a channel was reused. Supply a Slack credential with channels:manage.',
    category: "Revenue",
    domain: "ops",
    tags: ["slack", "channel", "deal", "sales", "create", "invite"],
    graph: {
      nodes: [
        {
          id: "opportunity",
          type: "WEBHOOK_TRIGGER",
          name: "New opportunity",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "existing",
          type: "SLACK_LIST_CHANNELS",
          name: "Is there a room already?",
          position: { x: 260, y: 0 },
          data: {
            variableName: "existing",
            nameFilter: "deal-{{webhook.body.accountSlug}}",
            limit: 500,
          },
        },
        {
          id: "room",
          type: "SLACK_CREATE_CHANNEL",
          name: "Open the deal room",
          position: { x: 520, y: 0 },
          data: {
            variableName: "room",
            // Called unconditionally: the node returns the existing channel
            // when the name is taken, so no branch is needed and a retry is
            // safe. `room.created` says which happened.
            name: "deal-{{webhook.body.accountSlug}}",
            isPrivate: false,
            purpose: "Deal room for {{webhook.body.accountName}}",
          },
        },
        {
          id: "staff",
          type: "SLACK_INVITE",
          name: "Pull the deal team in",
          position: { x: 780, y: 0 },
          data: {
            variableName: "staffed",
            channel: "{{room.channelId}}",
            // Slack user IDs (U0123ABCD), not emails — the invite API takes
            // ids only.
            userIds: "{{webhook.body.teamUserIds}}",
          },
        },
        {
          id: "brief",
          type: "SLACK_POST",
          name: "Post the opening brief",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "posted",
            channel: "{{room.channelId}}",
            text: ":handshake: *{{webhook.body.accountName}}* — {{webhook.body.amount}}\nOwner: {{webhook.body.owner}}\nStage: {{webhook.body.stage}}",
          },
        },
      ],
      edges: [
        { source: "opportunity", target: "existing" },
        { source: "existing", target: "room" },
        { source: "room", target: "staff" },
        { source: "staff", target: "brief" },
      ],
    },
  },
  {
    slug: "meeting-briefing-slack-dm",
    name: "DM each attendee before the meeting",
    description:
      "Watches your calendar, waits until shortly before each meeting starts, and sends every attendee a direct message with the agenda. Attendees are matched to Slack accounts by email, which is the part that needs care: the address must be the one on their Slack profile, and that is often not their work address. External guests have no Slack account at all, so the lookup is set to skip them quietly rather than fail — otherwise one contractor on the invite would stop everyone else being messaged. Meeting rooms are already filtered out, because Calendar counts them as attendees and a room has nobody to brief. Supply a Calendar credential and a Slack credential with users:read.email.",
    category: "Ops",
    domain: "ops",
    // Calendar to read the meeting, Slack to deliver the briefing.
    tier: "library",
    tags: ["slack", "calendar", "meeting", "dm", "briefing", "reminder"],
    graph: {
      nodes: [
        {
          id: "upcoming",
          type: "CALENDAR_TRIGGER",
          name: "Meeting soon",
          position: { x: 0, y: 0 },
          data: {
            calendarId: "primary",
            lookaheadMinutes: 120,
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "hold",
          type: "WAIT",
          name: "Wait until it starts",
          position: { x: 280, y: 0 },
          data: { mode: "until", until: "{{event.start}}" },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One per attendee",
          position: { x: 540, y: 0 },
          // A dot-path against the node's input, not a template expression:
          // SPLIT_OUT reads the array itself rather than a rendered string.
          data: { path: "event.attendees", maxItems: 50 },
        },
        {
          id: "dm",
          type: "SLACK_DM_BY_EMAIL",
          name: "DM the attendee",
          position: { x: 800, y: 0 },
          data: {
            variableName: "dm",
            email: "{{$item.email}}",
            // An external guest has no Slack account; skipping is the
            // expected outcome, not a failure of the run.
            skipIfNotFound: true,
            text: ":calendar: *{{event.summary}}* starts now.\n{{event.description}}\n{{event.htmlLink}}",
          },
        },
        {
          id: "done",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1060, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "upcoming", target: "hold" },
        { source: "hold", target: "each" },
        { source: "each", target: "dm" },
        { source: "dm", target: "done" },
      ],
    },
  },
  {
    slug: "webhook-payload-reshaper",
    name: "Reshape a webhook and forward it",
    description:
      "Receives one service's webhook, reshapes the payload into the form another service expects, forwards it, and answers the original caller with the result. This is the glue you would otherwise write a small server for — the two systems never have to agree on a format. The forward is set to fail the run on a non-2xx, so a rejected hand-off shows as a failed execution rather than a silent drop. The target here is a public echo service; point it at your own endpoint, and add a credential on the HTTP node if it needs authentication.",
    category: "Ops",
    domain: "ops",
    tags: ["webhook", "transform", "forward", "proxy", "integration", "glue"],
    graph: {
      nodes: [
        {
          id: "incoming",
          type: "WEBHOOK_TRIGGER",
          name: "Source webhook",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "reshape",
          type: "CODE",
          name: "Reshape the payload",
          position: { x: 280, y: 0 },
          data: {
            code: 'const body = input.webhook?.body ?? {};\n\n// Whatever the source sends, emit the shape the target wants.\nreturn {\n  payload: {\n    external_id: String(body.id ?? body.uuid ?? ""),\n    full_name: [body.first_name, body.last_name].filter(Boolean).join(" ") || body.name || "",\n    contact_email: body.email ?? body.email_address ?? null,\n    source: "webhook",\n    received_at: new Date().toISOString(),\n  },\n};\n',
          },
        },
        {
          id: "forward",
          type: "HTTP_REQUEST",
          name: "Forward to the target",
          position: { x: 560, y: 0 },
          data: {
            variableName: "forwarded",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            body: "{{{json payload}}}",
            headers: { "Content-Type": "application/json" },
            // A hand-off the target rejected must fail the run. Defaulting the
            // other way turns a dropped record into a green execution.
            failOnNon2xx: true,
            timeoutMs: 15000,
          },
        },
        {
          id: "reply",
          type: "RESPOND_TO_WEBHOOK",
          name: "Answer the caller",
          position: { x: 840, y: 0 },
          data: {
            statusCode: 200,
            contentType: "application/json",
            body: '{"forwarded":true,"status":{{forwarded.httpResponse.status}}}',
          },
        },
      ],
      edges: [
        { source: "incoming", target: "reshape" },
        { source: "reshape", target: "forward" },
        { source: "forward", target: "reply" },
      ],
    },
  },
  {
    slug: "github-pr-opens-jira-issue",
    name: "Every pull request gets a Jira issue",
    description:
      "When a pull request is opened, files a Jira issue that tracks it, with the author, the branch and a link back to the PR. The issue type is resolved by name against your project, so this works whether your team calls them Tasks, Stories or Bugs. Deliveries are rejected unless GitHub's HMAC signature verifies, so nobody can start your workflows by posting a payload that names your repository. Supply a GitHub credential and an Atlassian credential, and point a repository webhook at the GitHub endpoint.",
    category: "Ops",
    domain: "ops",
    tags: ["github", "jira", "pull request", "issue", "tracking", "webhook"],
    graph: {
      nodes: [
        {
          id: "pr",
          type: "GITHUB_TRIGGER",
          name: "Pull request opened",
          position: { x: 0, y: 0 },
          data: {
            repo: "REPLACE_WITH_OWNER/REPO",
            events: "pull_request",
            actions: "opened,reopened",
          },
        },
        {
          id: "issue",
          type: "JIRA_CREATE_ISSUE",
          name: "File the tracking issue",
          position: { x: 300, y: 0 },
          data: {
            variableName: "tracked",
            projectKey: "REPLACE_WITH_PROJECT_KEY",
            issueType: "Task",
            summary:
              "Review PR #{{github.payload.pull_request.number}}: {{github.payload.pull_request.title}}",
            description:
              "Opened by {{github.sender}} on {{github.repository}}.\n\nBranch: {{github.payload.pull_request.head.ref}} → {{github.payload.pull_request.base.ref}}\n\n{{github.payload.pull_request.html_url}}",
            labels: "code-review,from-github",
          },
        },
      ],
      edges: [{ source: "pr", target: "issue" }],
    },
  },
  {
    slug: "github-merge-closes-jira-issue",
    name: "Merging the PR moves the Jira issue",
    description:
      'When a pull request is merged, moves the Jira issue named in its title or branch to the finished status and leaves a comment saying which PR did it. The transition is looked up by NAME against that issue\'s own workflow at run time — which is what makes this work in more than one project. Transition ids are assigned per workflow scheme, so an automation that hardcodes "31" works where it was written and silently fails everywhere else. Supply a GitHub credential and an Atlassian credential.',
    category: "Ops",
    domain: "ops",
    tags: ["github", "jira", "merge", "transition", "status", "done"],
    graph: {
      nodes: [
        {
          id: "closed",
          type: "GITHUB_TRIGGER",
          name: "Pull request closed",
          position: { x: 0, y: 0 },
          data: {
            repo: "REPLACE_WITH_OWNER/REPO",
            events: "pull_request",
            actions: "closed",
          },
        },
        {
          id: "merged",
          type: "CONDITION",
          name: "Actually merged?",
          position: { x: 280, y: 0 },
          data: {
            // A closed PR is not a merged one. Without this the issue would
            // also move when someone abandons a branch.
            left: "{{github.payload.pull_request.merged}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "key",
          type: "CODE",
          name: "Find the issue key",
          position: { x: 560, y: -80 },
          data: {
            code: 'const pr = input.github?.payload?.pull_request ?? {};\nconst haystack = `${pr.title ?? ""} ${pr.head?.ref ?? ""}`;\n\n// Jira keys look like ENG-123. Take the first one mentioned in the\n// title or the branch name.\nconst match = haystack.match(/[A-Z][A-Z0-9]+-\\d+/);\n\nreturn {\n  issueKey: match ? match[0] : "",\n  found: Boolean(match),\n  prNumber: pr.number ?? null,\n  prUrl: pr.html_url ?? "",\n};\n',
          },
        },
        {
          id: "named",
          type: "CONDITION",
          name: "Names an issue?",
          position: { x: 840, y: -80 },
          data: {
            left: "{{found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "move",
          type: "JIRA_TRANSITION",
          name: "Move it to Done",
          position: { x: 1120, y: -140 },
          data: {
            variableName: "moved",
            issueKey: "{{issueKey}}",
            // A NAME, not an id. Resolved against this issue's workflow when
            // the node runs, and matched against the destination status too,
            // so "Done" works when the transition is called "Finish Work".
            transition: "Done",
            comment: "Merged in PR #{{prNumber}} — {{prUrl}}",
          },
        },
      ],
      edges: [
        { source: "closed", target: "merged" },
        { source: "merged", target: "key", sourceHandle: "true" },
        { source: "key", target: "named" },
        { source: "named", target: "move", sourceHandle: "true" },
      ],
    },
  },
  {
    slug: "auto-pr-for-pushed-branch",
    name: "Open a pull request for every feature branch",
    description:
      "Watches pushes and opens a draft pull request the moment a branch matching your prefix appears, so work in progress is visible before anyone remembers to raise it. Re-running is safe: an open PR for the same branch is returned rather than failing, and a branch with no commits ahead of the base is reported as exactly that rather than as an API error. Only a GitHub credential is needed.",
    category: "Ops",
    domain: "ops",
    tags: ["github", "pull request", "branch", "draft", "automation", "push"],
    graph: {
      nodes: [
        {
          id: "push",
          type: "GITHUB_TRIGGER",
          name: "Branch pushed",
          position: { x: 0, y: 0 },
          data: {
            repo: "REPLACE_WITH_OWNER/REPO",
            events: "push",
          },
        },
        {
          id: "branch",
          type: "CODE",
          name: "Read the branch",
          position: { x: 280, y: 0 },
          data: {
            code: 'const ref = input.github?.payload?.ref ?? "";\nconst branch = ref.replace(/^refs\\/heads\\//, "");\nconst commits = input.github?.payload?.commits ?? [];\n\nreturn {\n  branch,\n  // Only branches the team prefixes as work. Change the prefix here.\n  isFeature: branch.startsWith("feat/"),\n  headline: commits.length > 0 ? commits[0].message.split("\\n")[0] : branch,\n};\n',
          },
        },
        {
          id: "wanted",
          type: "CONDITION",
          name: "A feature branch?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{isFeature}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "pr",
          type: "GITHUB_CREATE_PR",
          name: "Open a draft PR",
          position: { x: 840, y: -60 },
          data: {
            variableName: "pr",
            repo: "REPLACE_WITH_OWNER/REPO",
            title: "{{headline}}",
            head: "{{branch}}",
            // Blank base means the repository's default branch, which is not
            // always "main".
            body: "Opened automatically when `{{branch}}` was pushed.",
            draft: true,
          },
        },
      ],
      edges: [
        { source: "push", target: "branch" },
        { source: "branch", target: "wanted" },
        { source: "wanted", target: "pr", sourceHandle: "true" },
      ],
    },
  },
  {
    slug: "stale-pr-digest",
    name: "Nudge the pull requests nobody reviewed",
    description:
      "Every morning, finds open pull requests that have gone quiet and posts one digest to the team channel instead of pinging people individually. The search uses GitHub's own query syntax, so you can narrow it to a team, a label or a path without touching the workflow. GitHub caps a search at 1000 results, and the node reports when it hit that rather than pretending it saw everything. Supply a GitHub credential and a Slack credential.",
    category: "Ops",
    domain: "ops",
    // GitHub to search, Slack to post.
    tier: "library",
    tags: ["github", "slack", "pull request", "review", "stale", "digest"],
    graph: {
      nodes: [
        {
          id: "morning",
          type: "SCHEDULE_TRIGGER",
          name: "Weekday mornings",
          position: { x: 0, y: 0 },
          data: { cron: "0 9 * * 1-5", timezone: "UTC" },
        },
        {
          id: "stale",
          type: "GITHUB_SEARCH_PRS",
          name: "Find the quiet ones",
          position: { x: 280, y: 0 },
          data: {
            variableName: "stale",
            repo: "REPLACE_WITH_OWNER/REPO",
            // GitHub's own qualifiers: untouched for three days, not a draft.
            query: "draft:false updated:<{{$now.minusDays3.date}}",
            state: "open",
            limit: 50,
          },
        },
        {
          id: "summary",
          type: "CODE",
          name: "Write the digest",
          position: { x: 560, y: 0 },
          data: {
            code: 'const prs = input.stale?.pullRequests ?? [];\n\nif (prs.length === 0) {\n  return { hasStale: false, digest: "" };\n}\n\nconst lines = prs\n  .slice(0, 15)\n  .map((pr) => `• <${pr.url}|#${pr.number}> ${pr.title} — ${pr.author}`);\n\nreturn {\n  hasStale: true,\n  count: prs.length,\n  digest: lines.join("\\n"),\n};\n',
          },
        },
        {
          id: "any",
          type: "CONDITION",
          name: "Anything to say?",
          position: { x: 840, y: 0 },
          data: {
            // No message at all beats a daily "0 stale PRs" nobody reads.
            left: "{{hasStale}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "post",
          type: "SLACK_POST",
          name: "Post the digest",
          position: { x: 1120, y: -60 },
          data: {
            variableName: "posted",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":eyes: *{{count}} pull requests are waiting on review*\n\n{{digest}}",
          },
        },
      ],
      edges: [
        { source: "morning", target: "stale" },
        { source: "stale", target: "summary" },
        { source: "summary", target: "any" },
        { source: "any", target: "post", sourceHandle: "true" },
      ],
    },
  },
  {
    slug: "fan-out-one-payload-to-many-calls",
    name: "Split one payload into many calls",
    description:
      'Receives a batch — an array of records in one webhook — and makes a separate call per record, then answers the sender with a per-item result rather than a bare 200. Items are processed one at a time so a slow or failing target does not turn into a burst, and the aggregate reports which items failed instead of losing them. This is the shape most "send these 50 things somewhere" jobs actually need. Nothing to connect.',
    category: "Ops",
    domain: "ops",
    tags: ["webhook", "batch", "fan-out", "split", "http", "aggregate"],
    graph: {
      nodes: [
        {
          id: "batch",
          type: "WEBHOOK_TRIGGER",
          name: "Batch arrives",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "shape",
          type: "CODE",
          name: "Normalise the batch",
          position: { x: 280, y: 0 },
          data: {
            code: "const body = input.webhook?.body ?? {};\n\n// Accept either a bare array or { items: [...] }, because senders differ\n// and neither is worth arguing about.\nconst raw = Array.isArray(body) ? body : (body.items ?? []);\n\nreturn {\n  items: raw.map((item, index) => ({\n    index,\n    id: item.id ?? String(index),\n    payload: item,\n  })),\n};\n",
          },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One at a time",
          position: { x: 560, y: 0 },
          data: { path: "items", maxItems: 50 },
        },
        {
          id: "deliver",
          type: "HTTP_REQUEST",
          name: "Deliver the item",
          position: { x: 840, y: 0 },
          data: {
            variableName: "delivery",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            body: "{{{json $item.payload}}}",
            headers: { "Content-Type": "application/json" },
            failOnNon2xx: true,
            timeoutMs: 15000,
          },
        },
        {
          id: "collected",
          type: "AGGREGATE",
          name: "Collect the results",
          position: { x: 1120, y: 0 },
          data: {},
        },
        {
          id: "reply",
          type: "RESPOND_TO_WEBHOOK",
          name: "Answer the sender",
          position: { x: 1400, y: 0 },
          data: {
            statusCode: 200,
            contentType: "application/json",
            // The failed count is the point: a bare 200 would hide that three
            // of fifty items never arrived.
            body: '{"processed":{{count}},"failed":{{failed}}}',
          },
        },
      ],
      edges: [
        { source: "batch", target: "shape" },
        { source: "shape", target: "each" },
        { source: "each", target: "deliver" },
        { source: "deliver", target: "collected" },
        { source: "collected", target: "reply" },
      ],
    },
  },
  {
    slug: "paced-backfill-over-a-list",
    name: "Work through a list without tripping a rate limit",
    description:
      "Takes a list, processes it one item at a time with a deliberate pause between each, and collects the results — the shape you need when the far end allows a handful of requests a second and will ban you for more. The pause is a durable wait rather than a busy loop, so the worker is free between items and a long backfill survives a redeploy. The aggregate reports which items failed rather than losing them. Nothing to connect.",
    category: "Ops",
    domain: "ops",
    tags: ["backfill", "rate limit", "batch", "pacing", "wait", "http"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Run with a list",
          position: { x: 0, y: 0 },
          data: { payload: '{"ids":["a1","a2","a3"]}' },
        },
        {
          id: "shape",
          type: "CODE",
          name: "Build the work list",
          position: { x: 280, y: 0 },
          data: {
            code: "const ids = input.ids ?? [];\n\nreturn {\n  items: ids.map((id, index) => ({ id, index })),\n};\n",
          },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One at a time",
          position: { x: 560, y: 0 },
          data: { path: "items", maxItems: 200 },
        },
        {
          id: "pace",
          type: "WAIT",
          name: "Pause between items",
          position: { x: 840, y: 0 },
          data: { mode: "duration", seconds: 2 },
        },
        {
          id: "call",
          type: "HTTP_REQUEST",
          name: "Process the item",
          position: { x: 1120, y: 0 },
          data: {
            variableName: "processed",
            endpoint: "https://httpbin.org/anything/{{$item.id}}",
            method: "GET",
            failOnNon2xx: true,
            timeoutMs: 15000,
          },
        },
        {
          id: "done",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1400, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "start", target: "shape" },
        { source: "shape", target: "each" },
        { source: "each", target: "pace" },
        { source: "pace", target: "call" },
        { source: "call", target: "done" },
      ],
    },
  },
];
