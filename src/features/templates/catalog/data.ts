import type { TemplateSpec } from "./types";

/** Data-domain templates (AF-M7-02) — all four on the `Data` gallery chip. */
export const dataTemplates: TemplateSpec[] = [
  {
    slug: "form-response-to-sheet",
    name: "Form responses to a spreadsheet",
    description:
      "Appends every Google Form submission to a spreadsheet as a flat row — respondent, timestamp, and answers — so the responses are queryable without opening the form.",
    category: "Data",
    domain: "data",
    tags: ["forms", "sheets", "collection", "google"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "submitted",
          type: "GOOGLE_FORM_TRIGGER",
          name: "Form submitted",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "flatten",
          type: "SET",
          name: "Flatten the response",
          position: { x: 280, y: 0 },
          data: {
            mappings: [
              { key: "row_submittedAt", value: "{{googleForm.timestamp}}" },
              {
                key: "row_respondent",
                value: "{{googleForm.respondentEmail}}",
              },
              { key: "row_form", value: "{{googleForm.formTitle}}" },
              { key: "row_answers", value: "{{googleForm.responses}}" },
            ],
          },
        },
        {
          id: "append",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Append the row",
          position: { x: 560, y: 0 },
          data: {
            variableName: "appended",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Responses",
            values:
              '[["{{row_submittedAt}}","{{row_respondent}}","{{row_form}}","{{row_answers}}"]]',
          },
        },
      ],
      edges: [
        { source: "submitted", target: "flatten" },
        { source: "flatten", target: "append" },
      ],
    },
  },
  {
    slug: "daily-metrics-narrative",
    name: "Daily metrics narrative",
    description:
      "Runs your daily metrics query, has a model turn the numbers into two paragraphs a human will actually read, and posts it to Slack every morning.",
    category: "Data",
    domain: "data",
    // An AI provider to write the narrative, Slack to post it.
    tier: "library",
    tags: ["metrics", "postgres", "reporting", "slack", "ai"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "daily",
          type: "SCHEDULE_TRIGGER",
          name: "Daily 07:00",
          position: { x: 0, y: 0 },
          data: { cron: "0 7 * * *", timezone: "UTC" },
        },
        {
          id: "query",
          type: "POSTGRES_QUERY",
          name: "Yesterday's metrics",
          position: { x: 260, y: 0 },
          data: {
            variableName: "metrics",
            query:
              "SELECT date_trunc('day', created_at) AS day, count(*) AS signups, count(*) FILTER (WHERE converted) AS conversions FROM users WHERE created_at >= now() - ($1)::interval GROUP BY 1 ORDER BY 1 DESC",
            params: '["7 days"]',
          },
        },
        {
          id: "narrate",
          type: "AI_LLM",
          name: "Narrate the numbers",
          position: { x: 520, y: 0 },
          data: {
            variableName: "narrative",
            model: "openai:gpt-4o-mini",
            fallbackModels: "deepseek:deepseek-chat",
            systemPrompt:
              "You explain metrics to a non-analyst. Quote only numbers present in the data, and say when a change is too small to mean anything.",
            userPrompt:
              "Last seven days of signups and conversions:\n\n{{metrics.rows}}\n\nWrite two short paragraphs: what happened yesterday relative to the week, and the one thing worth checking.",
            temperature: 0.3,
            maxTokens: 700,
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "post",
          type: "SLACK_POST",
          name: "Post the narrative",
          position: { x: 780, y: 0 },
          data: {
            variableName: "narrativePost",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "*Daily metrics*\n\n{{narrative.text}}",
          },
        },
      ],
      edges: [
        { source: "daily", target: "query" },
        { source: "query", target: "narrate" },
        { source: "narrate", target: "post" },
      ],
    },
  },
  {
    slug: "api-to-airtable-sync",
    name: "API to Airtable sync",
    description:
      "Pulls records from any REST API on a schedule, maps the fields you care about, and writes them into an Airtable table — the plumbing for keeping a base in step with a system that has no native integration.",
    category: "Data",
    domain: "data",
    tags: ["sync", "airtable", "api", "etl", "schedule"],
    graph: {
      nodes: [
        {
          id: "hourly",
          type: "SCHEDULE_TRIGGER",
          name: "Hourly",
          position: { x: 0, y: 0 },
          data: { cron: "0 * * * *", timezone: "UTC" },
        },
        {
          id: "fetch",
          type: "HTTP_REQUEST",
          name: "Fetch records",
          position: { x: 260, y: 0 },
          data: {
            variableName: "source",
            endpoint: "https://api.example.com/v1/records",
            method: "GET",
            queryParams: { updated_since: "1h", limit: "100" },
            timeoutMs: 20000,
            failOnNon2xx: true,
          },
        },
        {
          id: "map-fields",
          type: "SET",
          name: "Map the fields",
          position: { x: 520, y: 0 },
          data: {
            mappings: [
              {
                key: "record_externalId",
                value: "{{source.httpResponse.data.0.id}}",
              },
              {
                key: "record_name",
                value: "{{source.httpResponse.data.0.name}}",
              },
              {
                key: "record_status",
                value: "{{source.httpResponse.data.0.status}}",
              },
              {
                key: "record_updatedAt",
                value: "{{source.httpResponse.data.0.updatedAt}}",
              },
            ],
          },
        },
        {
          id: "write",
          type: "AIRTABLE_CREATE_RECORD",
          name: "Write to Airtable",
          position: { x: 800, y: 0 },
          data: {
            variableName: "written",
            baseId: "REPLACE_WITH_BASE_ID",
            tableId: "Records",
            fields:
              '{"External ID":"{{record_externalId}}","Name":"{{record_name}}","Status":"{{record_status}}","Updated":"{{record_updatedAt}}"}',
          },
        },
      ],
      edges: [
        { source: "hourly", target: "fetch" },
        { source: "fetch", target: "map-fields" },
        { source: "map-fields", target: "write" },
      ],
    },
  },
  {
    slug: "document-field-extraction",
    name: "Document field extraction",
    description:
      "Posts a document to this workflow and gets clean JSON back — the document-intelligence primitive, with the extracted fields delivered to whatever system asked for them.",
    category: "Data",
    domain: "data",
    tags: ["extraction", "documents", "json", "webhook", "ai"],
    graph: {
      nodes: [
        {
          id: "document",
          type: "WEBHOOK_TRIGGER",
          name: "Document posted",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "extract",
          type: "AI_EXTRACT",
          name: "Extract the fields",
          position: { x: 260, y: 0 },
          data: {
            variableName: "doc",
            model: "openai:gpt-4o-mini",
            fallbackModels:
              "anthropic:claude-3-5-haiku,google:gemini-1.5-flash",
            content: "{{webhook.body.text}}",
            fields: [
              {
                name: "documentType",
                type: "string",
                description:
                  "One of: invoice, contract, purchase_order, statement, other.",
              },
              {
                name: "counterparty",
                type: "string",
                description: "The other party named in the document.",
              },
              {
                name: "totalAmount",
                type: "number",
                description: "Headline amount, or 0 if the document has none.",
              },
              {
                name: "effectiveDate",
                type: "string",
                description: "ISO 8601 date, or empty if absent.",
              },
              {
                name: "referenceNumber",
                type: "string",
                description: "Invoice, PO, or contract number.",
              },
            ],
            // Documents are re-posted on retry far more often than they change;
            // a day of caching turns a duplicate submission into a free hit.
            cacheTtlSeconds: 86400,
          },
        },
        {
          id: "envelope",
          type: "SET",
          name: "Build the envelope",
          position: { x: 520, y: 0 },
          data: {
            mappings: [
              { key: "result_sourceId", value: "{{webhook.body.documentId}}" },
              { key: "result_type", value: "{{doc.documentType}}" },
              { key: "result_counterparty", value: "{{doc.counterparty}}" },
              { key: "result_total", value: "{{doc.totalAmount}}" },
              { key: "result_reference", value: "{{doc.referenceNumber}}" },
            ],
          },
        },
        {
          id: "deliver",
          type: "WEBHOOK_OUT",
          name: "Deliver the result",
          position: { x: 780, y: 0 },
          data: {
            variableName: "delivered",
            url: "https://api.example.com/v1/documents/{{result_sourceId}}/fields",
            headers: { "Content-Type": "application/json" },
            body: '{"documentType":"{{result_type}}","counterparty":"{{result_counterparty}}","totalAmount":"{{result_total}}","referenceNumber":"{{result_reference}}"}',
            timeoutMs: 10000,
            failOnNon2xx: true,
          },
        },
      ],
      edges: [
        { source: "document", target: "extract" },
        { source: "extract", target: "envelope" },
        { source: "envelope", target: "deliver" },
      ],
    },
  },
  /**
   * W3 (AF-M9-15). Derives from
   * `n8n-workflows/workflows/Templates/9002_Rapid_ETL_HTTP_Transform_Deliver_Manual.json`.
   *
   * Ships in the **full** form, not the batched fallback M9 §1 reserved: the
   * AF-M9-14 fan-out landed, so `SPLIT_OUT` → per-item `HTTP_REQUEST` →
   * `AGGREGATE` is expressible and each record retries independently. No
   * deviation to record.
   */
  {
    slug: "api-etl-batch-deliver",
    name: "API to per-record delivery",
    description:
      "Pulls a collection from an API, reshapes it in a Code node, then delivers one record at a time — each with its own retry — and collects the outcomes into a single `{ items, count, failed }` summary. Capped at ten records as shipped so a first run cannot surprise you; raise the Split Out limit once you have watched it work. Both endpoints are public test services, so it runs before you configure anything.",
    category: "Data",
    domain: "data",
    tags: ["etl", "api", "fan-out", "split-out", "aggregate", "code", "batch"],
    graph: {
      nodes: [
        {
          id: "run",
          type: "MANUAL_TRIGGER",
          name: "Run",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "fetch-data",
          type: "HTTP_REQUEST",
          name: "Fetch data",
          position: { x: 260, y: 0 },
          data: {
            variableName: "posts",
            endpoint: "https://jsonplaceholder.typicode.com/posts",
            method: "GET",
            failOnNon2xx: true,
            _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10000 },
          },
        },
        {
          id: "transform",
          type: "CODE",
          name: "Transform",
          position: { x: 520, y: 0 },
          data: {
            // Returns an array, which the engine stores under `items` — the
            // key Split Out reads by default.
            code: "const rows = input.posts.httpResponse.data;\nreturn rows.slice(0, 10).map((p) => ({\n  id: p.id,\n  title: p.title,\n  userId: p.userId,\n}));\n",
          },
        },
        {
          id: "fan-out",
          type: "SPLIT_OUT",
          name: "Fan out",
          position: { x: 780, y: 0 },
          data: { path: "items", maxItems: 10 },
        },
        {
          id: "deliver",
          type: "HTTP_REQUEST",
          name: "Deliver",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "delivery",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            body: "{{{json $item}}}",
            headers: { "content-type": "application/json" },
            failOnNon2xx: true,
            // Retries are per item: one flaky record is retried on its own and
            // does not re-send the nine that already succeeded.
            _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10000 },
          },
        },
        {
          id: "collect",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1300, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "run", target: "fetch-data" },
        { source: "fetch-data", target: "transform" },
        { source: "transform", target: "fan-out" },
        { source: "fan-out", target: "deliver" },
        { source: "deliver", target: "collect" },
      ],
    },
  },
  {
    slug: "archive-file-to-sheet-log",
    name: "Archive a file and log it to a sheet",
    description:
      "Fetches a file from a URL into AutoFlow's file storage and appends a row recording its name, size and SHA-256 to a Google Sheet. Use it as an audit log for exported reports, signed contracts or nightly database dumps: the sheet tells you what arrived and the hash tells you whether it changed. You supply the URL (or template it from the trigger), a Google Sheets credential, and a spreadsheet with the columns Downloaded at / Filename / Size (bytes) / SHA-256. The file itself never enters the run payload — only a reference does — so a 90 MB archive moves through the workflow as easily as a 2 KB CSV.",
    category: "Data",
    domain: "data",
    tags: ["file", "download", "archive", "checksum", "sheets", "audit"],
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
          id: "fetch",
          type: "FILE_DOWNLOAD",
          name: "Download the file",
          position: { x: 260, y: 0 },
          data: {
            variableName: "artifact",
            // Replace with the artifact URL, or template it from the trigger.
            url: "https://example.com/exports/report.csv",
            // Uncomment authMode and bind a credential when the URL is behind
            // an API. The secret is never templated into the request.
            maxBytes: 26214400,
          },
        },
        {
          id: "log",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Log it to the sheet",
          position: { x: 540, y: 0 },
          data: {
            variableName: "logged",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Downloads",
            // The FileRef's fields are what make this row useful: the hash is
            // stable for identical content, so a repeated row with a new hash
            // means the upstream artifact actually changed.
            values:
              '[["{{$now}}","{{artifact.file.$file.filename}}","{{artifact.file.$file.size}}","{{artifact.file.$file.sha256}}"]]',
          },
        },
      ],
      edges: [
        { source: "start", target: "fetch" },
        { source: "fetch", target: "log" },
      ],
    },
  },
  {
    slug: "sync-new-records-once-only",
    name: "Sync new records, once each",
    description:
      'Pulls a collection from an API every fifteen minutes, keeps only the entries that are ready, and delivers each one exactly once — even across restarts. The Filter drops entries whose `completed` flag is false using a typed boolean comparison, so a literal `false` is not mistaken for the non-empty string "false". The Dedupe node remembers every id it has already delivered, in state scoped to that node, so a re-run on an overlapping window sends nothing twice. Both endpoints are public test services, so it runs before you configure anything; point the first HTTP node at your own collection and the last one at wherever the record should go.',
    category: "Data",
    domain: "data",
    tags: ["filter", "dedupe", "idempotent", "fan-out", "schedule", "sync"],
    graph: {
      nodes: [
        {
          id: "every-15m",
          type: "SCHEDULE_TRIGGER",
          name: "Every 15 minutes",
          position: { x: 0, y: 0 },
          data: { cron: "*/15 * * * *", timezone: "UTC" },
        },
        {
          id: "fetch",
          type: "HTTP_REQUEST",
          name: "Fetch the collection",
          position: { x: 260, y: 0 },
          data: {
            variableName: "source",
            endpoint: "https://jsonplaceholder.typicode.com/todos",
            method: "GET",
            failOnNon2xx: true,
          },
        },
        {
          id: "shape",
          type: "CODE",
          name: "Take the first page",
          position: { x: 520, y: 0 },
          data: {
            // The public fixture returns 200 rows; the cap keeps a first run
            // small enough to watch. Raise it once you have seen it work.
            code: "return { items: (input.source.httpResponse.data || []).slice(0, 10) };",
          },
        },
        {
          id: "fan-out",
          type: "SPLIT_OUT",
          name: "One at a time",
          position: { x: 780, y: 0 },
          data: { path: "batch.items", maxItems: 10 },
        },
        {
          id: "only-ready",
          type: "FILTER",
          name: "Only completed",
          position: { x: 1040, y: 0 },
          data: {
            left: "{{$item.completed}}",
            operator: "is_true",
            // Typed, deliberately: a string comparison would treat the
            // rendered "false" as a non-empty value and keep everything.
            valueType: "boolean",
          },
        },
        {
          id: "not-seen-before",
          type: "DEDUPE",
          name: "Not sent before",
          position: { x: 1300, y: 0 },
          data: {
            key: "{{$item.id}}",
            // `forever` because a repeated id here is always a duplicate; use
            // `window` when ids legitimately recur after a while.
            mode: "forever",
          },
        },
        {
          id: "deliver",
          type: "HTTP_REQUEST",
          name: "Deliver",
          position: { x: 1560, y: 0 },
          data: {
            variableName: "delivery",
            endpoint: "https://httpbin.org/post",
            method: "POST",
            body: "{{{json $item}}}",
            headers: { "content-type": "application/json" },
            failOnNon2xx: true,
            _run: { maxAttempts: 3, backoffMs: 1000, timeoutMs: 10000 },
          },
        },
        {
          id: "collect",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1820, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "every-15m", target: "fetch" },
        { source: "fetch", target: "shape" },
        { source: "shape", target: "fan-out" },
        { source: "fan-out", target: "only-ready" },
        { source: "only-ready", target: "not-seen-before" },
        { source: "not-seen-before", target: "deliver" },
        { source: "deliver", target: "collect" },
      ],
    },
  },
  {
    slug: "document-summary-morning-digest",
    name: "Summarise a document, post it in the morning",
    description:
      "Downloads a document, extracts its text, has a model summarise it, then holds the summary until 08:00 UTC before posting to Slack — so a contract that lands at 2am is waiting for you at the start of the day rather than buried in overnight noise. The extraction reports whether the text was truncated, so a summary of half a contract is visible as one rather than presented as complete. Supply the document URL, an AI credential, and a Slack incoming-webhook URL.",
    category: "Ops",
    domain: "ops",
    tags: ["pdf", "extract", "summary", "wait", "digest", "slack"],
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
          id: "fetch-doc",
          type: "FILE_DOWNLOAD",
          name: "Download the document",
          position: { x: 260, y: 0 },
          data: {
            variableName: "doc",
            url: "https://example.com/contracts/latest.pdf",
            maxBytes: 26214400,
          },
        },
        {
          id: "read-doc",
          type: "EXTRACT_DOCUMENT_TEXT",
          name: "Extract the text",
          position: { x: 520, y: 0 },
          data: {
            variableName: "extracted",
            file: "{{{json doc.file}}}",
            maxCharacters: 120000,
          },
        },
        {
          id: "summarise",
          type: "AI_LLM",
          name: "Summarise it",
          position: { x: 780, y: 0 },
          data: {
            variableName: "summary",
            model: "anthropic:claude-3-5-haiku",
            fallbackModels: "openai:gpt-4o-mini",
            systemPrompt:
              "Summarise the document for someone who has not read it. Lead with what it commits the reader to. If the supplied text is marked as truncated, say so in the first line — never imply you have seen the whole document.",
            userPrompt:
              "Truncated: {{extracted.truncated}}\nPages: {{extracted.pageCount}}\n\n{{extracted.text}}",
            temperature: 0.2,
            maxTokens: 900,
          },
        },
        {
          id: "hold-until-morning",
          type: "WAIT",
          name: "Hold until 08:00",
          position: { x: 1040, y: 0 },
          data: {
            mode: "until",
            // A time already past resolves immediately, so a run started at
            // 09:00 posts straight away rather than waiting 23 hours.
            until: "{{formatDate $now 'yyyy-MM-dd'}}T08:00:00Z",
          },
        },
        {
          id: "post",
          type: "SLACK_POST",
          name: "Post the summary",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "posted",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "*{{doc.file.$file.filename}}*\n{{summary.text}}",
          },
        },
      ],
      edges: [
        { source: "start", target: "fetch-doc" },
        { source: "fetch-doc", target: "read-doc" },
        { source: "read-doc", target: "summarise" },
        { source: "summarise", target: "hold-until-morning" },
        { source: "hold-until-morning", target: "post" },
      ],
    },
  },
  {
    slug: "weekly-report-to-drive",
    name: "Weekly report, rendered and archived to Drive",
    description:
      "Pulls figures from an API every Monday, renders them as a PDF, and files it in a Drive folder. The report is built from HTML the workflow controls, and rendering runs with no network access and no script execution, so data pulled from outside cannot make the renderer fetch anything. The PDF moves through the workflow as a reference rather than as bytes, so the size of the report does not change what the graph can do. The endpoint is a public test service; point it at your own and supply a Drive credential and the destination folder id.",
    category: "Data",
    domain: "data",
    tags: ["report", "pdf", "drive", "archive", "schedule", "weekly"],
    graph: {
      nodes: [
        {
          id: "monday",
          type: "SCHEDULE_TRIGGER",
          name: "Every Monday 07:00",
          position: { x: 0, y: 0 },
          data: { cron: "0 7 * * 1", timezone: "UTC" },
        },
        {
          id: "figures",
          type: "HTTP_REQUEST",
          name: "Fetch the figures",
          position: { x: 260, y: 0 },
          data: {
            variableName: "figures",
            endpoint: "https://jsonplaceholder.typicode.com/users",
            method: "GET",
            failOnNon2xx: true,
          },
        },
        {
          id: "render",
          type: "HTML_TO_PDF",
          name: "Render the report",
          position: { x: 520, y: 0 },
          data: {
            variableName: "report",
            filename: "weekly-report.pdf",
            pageSize: "A4",
            orientation: "portrait",
            header: "Weekly report",
            footer: "Generated by AutoFlow",
            html: "<h1>Weekly report</h1><p>Records this week: {{figures.httpResponse.data.length}}</p>",
          },
        },
        {
          id: "archive",
          type: "DRIVE_UPLOAD",
          name: "File it in Drive",
          position: { x: 800, y: 0 },
          data: {
            variableName: "archived",
            file: "{{{json report.file}}}",
            folderId: "REPLACE_WITH_REPORTS_FOLDER_ID",
          },
        },
      ],
      edges: [
        { source: "monday", target: "figures" },
        { source: "figures", target: "render" },
        { source: "render", target: "archive" },
      ],
    },
  },
  {
    slug: "quickbooks-receipt-from-stripe-payment",
    name: "Record a Stripe payment as a QuickBooks sales receipt",
    description:
      "Turns a completed Stripe payment into a QuickBooks sales receipt. A receipt rather than an invoice, deliberately: the money has already arrived, and raising an invoice would leave a balance somebody has to remember to clear. The customer is matched on the email Stripe supplies; when no match exists the run stops rather than inventing a customer, because a receipt filed against the wrong account is harder to find than one that was never filed. Point the deposit account at wherever Stripe settles in your chart of accounts. Supply a QuickBooks credential; the Stripe trigger uses the platform's own signing secret.",
    category: "Finance",
    domain: "data",
    tags: [
      "quickbooks",
      "stripe",
      "receipt",
      "payment",
      "reconcile",
      "finance",
    ],
    graph: {
      nodes: [
        {
          id: "paid",
          type: "STRIPE_TRIGGER",
          name: "Payment succeeded",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "customer",
          type: "QBO_FIND_CUSTOMER",
          name: "Match the customer",
          position: { x: 280, y: 0 },
          data: {
            variableName: "customer",
            email: "{{stripe.raw.billing_details.email}}",
          },
        },
        {
          id: "matched",
          type: "CONDITION",
          name: "Matched?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{customer.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "receipt",
          type: "QBO_CREATE_SALES_RECEIPT",
          name: "Record the receipt",
          position: { x: 840, y: -80 },
          data: {
            variableName: "receipt",
            customerId: "{{customer.customerId}}",
            // Stripe reports in the currency's minor unit, so 4999 is 49.99.
            lines:
              '[{"description":"Stripe payment {{stripe.raw.id}}","amount":{{stripe.raw.amount}}}]',
            customerMemo: "Stripe {{stripe.eventId}}",
          },
        },
      ],
      edges: [
        { source: "paid", target: "customer" },
        { source: "customer", target: "matched" },
        // Only the matched branch continues. The unmatched one ends here on
        // purpose: a receipt filed against a guessed customer is worse than
        // one a person files by hand.
        { source: "matched", target: "receipt", sourceHandle: "true" },
      ],
    },
  },
  {
    slug: "quickbooks-estimate-from-sheet-row",
    name: "Turn a spreadsheet row into a QuickBooks estimate",
    description:
      "Watches a sheet of quote requests and raises a QuickBooks estimate for each new row. An estimate rather than an invoice: nothing posts to the ledger until the customer accepts, so a quote that goes nowhere leaves no trace to reverse. Rows already in the sheet when you publish are not replayed — the trigger records where the sheet was and starts from there. Give the sheet a header row and a stable key column (a quote number or an email); identifying rows by position is only safe on a sheet nobody ever sorts. Headers are addressed as {{row.fields.Quote}}, so a header containing a space needs bracket syntax — {{row.fields.[Quote ID]}} — which is why this template's columns are single words. The customer must already exist in QuickBooks. Supply a Sheets credential and a QuickBooks credential.",
    category: "Finance",
    domain: "data",
    // Sheets to read the request, QuickBooks to raise the estimate.
    tier: "library",
    tags: ["quickbooks", "estimate", "quote", "sheets", "trigger", "finance"],
    graph: {
      nodes: [
        {
          id: "new-row",
          type: "SHEETS_TRIGGER",
          name: "New quote request",
          position: { x: 0, y: 0 },
          data: {
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            range: "Quotes!A1:F1000",
            keyColumn: "Quote",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "customer",
          type: "QBO_FIND_CUSTOMER",
          name: "Find the customer",
          position: { x: 300, y: 0 },
          data: {
            variableName: "customer",
            displayName: "{{row.fields.Customer}}",
            email: "{{row.fields.Email}}",
          },
        },
        {
          id: "estimate",
          type: "QBO_CREATE_ESTIMATE",
          name: "Raise the estimate",
          position: { x: 600, y: 0 },
          data: {
            variableName: "estimate",
            customerId: "{{customer.customerId}}",
            lines:
              '[{"description":"{{row.fields.Description}}","amount":"{{row.fields.Amount}}"}]',
            customerMemo: "Quote {{row.fields.Quote}}",
          },
        },
      ],
      edges: [
        { source: "new-row", target: "customer" },
        { source: "customer", target: "estimate" },
      ],
    },
  },
  {
    slug: "quickbooks-expense-with-receipt",
    name: "Record an expense and attach its receipt",
    description:
      "Records a QuickBooks expense from a submitted claim and attaches the receipt image to the same record, so the document and the entry are never separated. QuickBooks calls this a Purchase in its API and an Expense on screen — the same thing under two names, which is worth knowing when reading its docs. Both account ids come from your own chart of accounts: the payment account is where the money left, the expense account is what it is booked against. Amounts arriving with a currency symbol are handled; a blank one stops the run rather than booking a zero. Supply a QuickBooks credential.",
    category: "Finance",
    domain: "data",
    tags: ["quickbooks", "expense", "receipt", "attach", "claim", "finance"],
    graph: {
      nodes: [
        {
          id: "claim",
          type: "WEBHOOK_TRIGGER",
          name: "Expense claim",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "receipt-file",
          type: "FILE_DOWNLOAD",
          name: "Fetch the receipt",
          position: { x: 260, y: 0 },
          data: {
            variableName: "receipt",
            url: "{{webhook.body.receiptUrl}}",
          },
        },
        {
          id: "expense",
          type: "QBO_CREATE_EXPENSE",
          name: "Record the expense",
          position: { x: 520, y: 0 },
          data: {
            variableName: "expense",
            paymentAccountId: "REPLACE_WITH_PAYMENT_ACCOUNT_ID",
            paymentType: "CreditCard",
            expenseAccountId: "REPLACE_WITH_EXPENSE_ACCOUNT_ID",
            amount: "{{webhook.body.amount}}",
            description: "{{webhook.body.description}}",
          },
        },
        {
          id: "attach",
          type: "QBO_ATTACH",
          name: "Attach the receipt",
          position: { x: 800, y: 0 },
          data: {
            variableName: "attached",
            entity: "Purchase",
            entityId: "{{expense.id}}",
            file: "{{{json receipt.file}}}",
          },
        },
      ],
      edges: [
        { source: "claim", target: "receipt-file" },
        { source: "receipt-file", target: "expense" },
        { source: "expense", target: "attach" },
      ],
    },
  },
  {
    slug: "webhook-json-api-with-validation",
    name: "A validated JSON endpoint, no backend",
    description:
      "Turns a webhook into a real HTTP API: it validates the incoming body, answers 200 with the accepted record, and answers 400 with the specific field that was wrong. The two response nodes are the point — an endpoint that returns 200 whatever you send it is not validation, it is a shape that logs. Nothing to connect: publish it and POST to the trigger's URL. Extend the check by editing the Code node, which returns { valid, errors, record } and nothing else.",
    category: "Data",
    domain: "data",
    tags: ["webhook", "api", "validation", "json", "endpoint", "respond"],
    graph: {
      nodes: [
        {
          id: "request",
          type: "WEBHOOK_TRIGGER",
          name: "Incoming request",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "check",
          type: "CODE",
          name: "Validate the body",
          position: { x: 280, y: 0 },
          data: {
            code: 'const body = input.webhook?.body ?? {};\nconst errors = [];\n\nif (typeof body.email !== "string" || !body.email.includes("@")) {\n  errors.push("email must be an email address");\n}\nif (typeof body.name !== "string" || body.name.trim() === "") {\n  errors.push("name is required");\n}\nif (body.quantity !== undefined && !Number.isInteger(body.quantity)) {\n  errors.push("quantity must be a whole number");\n}\n\nreturn {\n  valid: errors.length === 0,\n  errors,\n  record: {\n    email: String(body.email ?? "").trim().toLowerCase(),\n    name: String(body.name ?? "").trim(),\n    quantity: body.quantity ?? 1,\n  },\n};\n',
          },
        },
        {
          id: "ok",
          type: "CONDITION",
          name: "Valid?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{valid}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "accept",
          type: "RESPOND_TO_WEBHOOK",
          name: "202 Accepted",
          position: { x: 840, y: -100 },
          data: {
            statusCode: 202,
            contentType: "application/json",
            body: '{"status":"accepted","record":{{{json record}}}}',
          },
        },
        {
          id: "reject",
          type: "RESPOND_TO_WEBHOOK",
          name: "400 Bad Request",
          position: { x: 840, y: 100 },
          data: {
            statusCode: 400,
            contentType: "application/json",
            // Naming the failing fields is what makes this an API rather than
            // a black box: a caller that gets a bare 400 cannot fix anything.
            body: '{"status":"rejected","errors":{{{json errors}}}}',
          },
        },
      ],
      edges: [
        { source: "request", target: "check" },
        { source: "check", target: "ok" },
        { source: "ok", target: "accept", sourceHandle: "true" },
        { source: "ok", target: "reject", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "release-notes-to-notion",
    name: "Weekly release notes, written and filed",
    description:
      "Collects the week's commits, has a model turn them into release notes a human would read, and files the result as a page in your Notion release database. Merge commits and bot noise are dropped before the model sees them, because a changelog assembled from raw subjects is mostly \"Merge branch main\". Column values are wrapped to match your database's own schema, so you write plain strings rather than Notion's property union. Supply a GitHub credential and a Notion credential, and share the database with the integration.",
    category: "Ops",
    domain: "data",
    // GitHub to read the history, Notion to file the page.
    tier: "library",
    tags: ["github", "notion", "release notes", "changelog", "ai", "weekly"],
    graph: {
      nodes: [
        {
          id: "weekly",
          type: "SCHEDULE_TRIGGER",
          name: "Friday afternoon",
          position: { x: 0, y: 0 },
          data: { cron: "0 16 * * 5", timezone: "UTC" },
        },
        {
          id: "commits",
          type: "GITHUB_LIST_COMMITS",
          name: "This week's commits",
          position: { x: 280, y: 0 },
          data: {
            variableName: "week",
            repo: "REPLACE_WITH_OWNER/REPO",
            since: "{{$now.minusDays7.iso}}",
            limit: 300,
          },
        },
        {
          id: "clean",
          type: "CODE",
          name: "Drop the noise",
          position: { x: 560, y: 0 },
          data: {
            code: 'const commits = input.week?.commits ?? [];\n\nconst meaningful = commits.filter((c) => {\n  const s = c.subject ?? "";\n  // Merge commits and dependency bots dominate a raw log and say nothing\n  // a reader wants.\n  if (/^Merge (branch|pull request)/i.test(s)) return false;\n  if (/dependabot|renovate/i.test(c.authorLogin ?? "")) return false;\n  return s.trim().length > 0;\n});\n\nreturn {\n  hasWork: meaningful.length > 0,\n  subjects: meaningful.map((c) => `- ${c.subject} (${c.authorName})`).join("\\n"),\n  total: meaningful.length,\n};\n',
          },
        },
        {
          id: "shipped",
          type: "CONDITION",
          name: "Anything shipped?",
          position: { x: 840, y: 0 },
          data: {
            left: "{{hasWork}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "notes",
          type: "AI_LLM",
          name: "Write the notes",
          position: { x: 1120, y: -60 },
          data: {
            variableName: "notes",
            model: "anthropic:claude-3-5-sonnet",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You write release notes for people who use the product, not for the people who wrote it. Group related commits, describe the effect rather than the diff, and drop anything a user would not notice.",
            userPrompt:
              "Turn this week's commits into release notes. Use short sections with headings, and no preamble.\n\n{{subjects}}",
            temperature: 0.3,
            maxTokens: 1500,
          },
        },
        {
          id: "file",
          type: "NOTION_CREATE_PAGE",
          name: "File in Notion",
          position: { x: 1400, y: -60 },
          data: {
            variableName: "page",
            databaseId: "REPLACE_WITH_NOTION_DATABASE_URL",
            // Column names must match the database exactly — Notion is
            // case-sensitive, and the node says so if they do not.
            properties:
              '{"Name": "Release notes — {{$now.date}}", "Status": "Draft", "Commits": "{{total}}"}',
            content: "{{notes.text}}",
          },
        },
      ],
      edges: [
        { source: "weekly", target: "commits" },
        { source: "commits", target: "clean" },
        { source: "clean", target: "shipped" },
        { source: "shipped", target: "notes", sourceHandle: "true" },
        { source: "notes", target: "file" },
      ],
    },
  },
  {
    slug: "notion-content-calendar-digest",
    name: "What is due in Notion this week",
    description:
      "Reads your Notion content calendar, keeps the rows due in the next seven days, and produces a digest grouped by owner. Property values come back flattened to plain strings, numbers and lists, so downstream steps read them without knowing Notion's property union. Only a Notion credential is needed — share the database with the integration, or it will report that it cannot see it, which is far more often the cause than a wrong id.",
    category: "Marketing",
    domain: "data",
    tags: ["notion", "calendar", "content", "digest", "planning", "due"],
    graph: {
      nodes: [
        {
          id: "monday",
          type: "SCHEDULE_TRIGGER",
          name: "Monday morning",
          position: { x: 0, y: 0 },
          data: { cron: "0 8 * * 1", timezone: "UTC" },
        },
        {
          id: "rows",
          type: "NOTION_QUERY_DATABASE",
          name: "Read the calendar",
          position: { x: 280, y: 0 },
          data: {
            variableName: "calendar",
            databaseId: "REPLACE_WITH_NOTION_DATABASE_URL",
            sortProperty: "Due",
            sortDirection: "ascending",
            limit: 200,
          },
        },
        {
          id: "digest",
          type: "CODE",
          name: "Group by owner",
          position: { x: 560, y: 0 },
          data: {
            code: 'const items = input.calendar?.items ?? [];\nconst horizon = Date.now() + 7 * 24 * 60 * 60 * 1000;\n\nconst due = items.filter((row) => {\n  const date = row.properties?.Due;\n  if (!date) return false;\n  const at = Date.parse(date);\n  return Number.isFinite(at) && at <= horizon;\n});\n\nconst byOwner = {};\nfor (const row of due) {\n  const owner = (row.properties?.Owner ?? []).join(", ") || "Unassigned";\n  byOwner[owner] = byOwner[owner] ?? [];\n  byOwner[owner].push(`${row.properties?.Name ?? "Untitled"} (${row.properties?.Due})`);\n}\n\nreturn {\n  dueCount: due.length,\n  summary: Object.entries(byOwner)\n    .map(([owner, rows]) => `${owner}:\\n  ${rows.join("\\n  ")}`)\n    .join("\\n\\n"),\n};\n',
          },
        },
      ],
      edges: [
        { source: "monday", target: "rows" },
        { source: "rows", target: "digest" },
      ],
    },
  },
  {
    slug: "api-data-contract-monitor",
    name: "Tell me when an API quietly changes",
    description:
      "Calls an endpoint on a schedule and checks the shape of what comes back — required fields present, types right, data fresh enough — then posts an alert only when a check fails. This catches the failure that monitoring misses: the endpoint is up, returns 200, and has quietly dropped a field or gone stale. Edit the Code node to describe your own contract; it returns { ok, failures } and nothing else. Nothing to connect — point the alert step at any webhook URL you already have.",
    category: "Data",
    domain: "data",
    tags: ["monitoring", "api", "contract", "schema", "alert", "schedule"],
    graph: {
      nodes: [
        {
          id: "every-hour",
          type: "SCHEDULE_TRIGGER",
          name: "Hourly",
          position: { x: 0, y: 0 },
          data: { cron: "0 * * * *", timezone: "UTC" },
        },
        {
          id: "fetch",
          type: "HTTP_REQUEST",
          name: "Call the endpoint",
          position: { x: 280, y: 0 },
          data: {
            variableName: "probe",
            endpoint: "https://jsonplaceholder.typicode.com/posts/1",
            method: "GET",
            // The contract check below decides pass or fail, so a non-2xx is
            // one of the things being measured rather than a reason to stop.
            failOnNon2xx: false,
            timeoutMs: 15000,
          },
        },
        {
          id: "contract",
          type: "CODE",
          name: "Check the contract",
          position: { x: 560, y: 0 },
          data: {
            code: 'const res = input.probe?.httpResponse ?? {};\nconst body = res.data ?? {};\nconst failures = [];\n\nif (res.status !== 200) {\n  failures.push(`status was ${res.status}`);\n}\n\n// Required fields. Add your own.\nfor (const field of ["id", "title", "body"]) {\n  if (body[field] === undefined || body[field] === null) {\n    failures.push(`missing field "${field}"`);\n  }\n}\n\n// Types, which is where a silent change usually shows first.\nif (body.id !== undefined && typeof body.id !== "number") {\n  failures.push(`id is ${typeof body.id}, expected number`);\n}\n\nreturn {\n  ok: failures.length === 0,\n  failures: failures.join("; "),\n  checkedAt: new Date().toISOString(),\n};\n',
          },
        },
        {
          id: "broken",
          type: "CONDITION",
          name: "Contract broken?",
          position: { x: 840, y: 0 },
          data: {
            left: "{{ok}}",
            operator: "equals",
            right: "false",
          },
        },
        {
          id: "alert",
          type: "HTTP_REQUEST",
          name: "Raise the alert",
          position: { x: 1120, y: -60 },
          data: {
            variableName: "alerted",
            endpoint: "REPLACE_WITH_YOUR_ALERT_WEBHOOK_URL",
            method: "POST",
            body: '{"text":"API contract check failed: {{failures}}"}',
            headers: { "Content-Type": "application/json" },
            failOnNon2xx: true,
            timeoutMs: 15000,
          },
        },
      ],
      edges: [
        { source: "every-hour", target: "fetch" },
        { source: "fetch", target: "contract" },
        { source: "contract", target: "broken" },
        { source: "broken", target: "alert", sourceHandle: "true" },
      ],
    },
  },
];
