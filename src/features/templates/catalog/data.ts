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
          type: "SLACK",
          name: "Post the narrative",
          position: { x: 780, y: 0 },
          data: {
            variableName: "narrativePost",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK",
            content: "*Daily metrics*\n\n{{narrative.text}}",
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
];
