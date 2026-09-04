import type { TemplateSpec } from "./types";

/**
 * Marketing-domain templates (AF-M7-02).
 *
 * Carries the `Marketing` gallery chips plus the two `Revenue` flows, which
 * are marketing-owned in practice (signup enrichment, deal alerting) even
 * though the gallery files them under their own chip.
 */
export const marketingTemplates: TemplateSpec[] = [
  {
    slug: "lead-capture-to-crm",
    name: "Form lead to CRM contact",
    description:
      "Reads each Google Form submission, pulls the contact fields out of the free-text answers with AI, and creates a HubSpot contact — but only when the submission actually names a person to create.",
    category: "Marketing",
    domain: "marketing",
    tags: ["lead", "crm", "hubspot", "forms", "ai"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "form",
          type: "GOOGLE_FORM_TRIGGER",
          name: "Form submitted",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "extract-lead",
          type: "AI_EXTRACT",
          name: "Extract lead fields",
          position: { x: 260, y: 0 },
          data: {
            variableName: "lead",
            model: "openai:gpt-4o-mini",
            fallbackModels: "anthropic:claude-3-5-haiku",
            content:
              "A lead submitted this form. Pull out the contact details.\n\nForm: {{googleForm.formTitle}}\nRespondent: {{googleForm.respondentEmail}}\nAnswers: {{googleForm.responses}}",
            fields: [
              { name: "email", type: "string", description: "Work email." },
              { name: "fullName", type: "string", description: "Full name." },
              {
                name: "company",
                type: "string",
                description: "Company name, or empty if not given.",
              },
              {
                name: "interest",
                type: "string",
                description: "One sentence on what they asked for.",
              },
            ],
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "has-email",
          type: "CONDITION",
          name: "Has an email address?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{lead.email}}",
            operator: "is_not_empty",
          },
        },
        {
          id: "create-contact",
          type: "HUBSPOT_CREATE_CONTACT",
          name: "Create HubSpot contact",
          position: { x: 800, y: -60 },
          data: {
            variableName: "contact",
            properties:
              '{"email":"{{lead.email}}","firstname":"{{lead.fullName}}","company":"{{lead.company}}","hs_lead_status":"NEW"}',
          },
        },
      ],
      edges: [
        { source: "form", target: "extract-lead" },
        { source: "extract-lead", target: "has-email" },
        { source: "has-email", target: "create-contact", sourceHandle: "true" },
      ],
    },
  },
  {
    slug: "content-brief-generator",
    name: "Content brief generator",
    description:
      "Give it a topic and an audience and it drafts a full content brief — angle, outline, keywords, and a suggested title — then posts the brief into Slack for the writer to pick up.",
    category: "Marketing",
    domain: "marketing",
    tags: ["content", "brief", "ai", "slack", "seo"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Run with a topic",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"topic":"How teams automate onboarding","audience":"Ops managers at 50-500 person companies"}',
          },
        },
        {
          id: "defaults",
          type: "SET",
          name: "Apply defaults",
          position: { x: 260, y: 0 },
          data: {
            mappings: [
              { key: "brief_topic", value: "{{topic}}" },
              { key: "brief_audience", value: "{{audience}}" },
              { key: "brief_wordCount", value: "1200" },
            ],
          },
        },
        {
          id: "write-brief",
          type: "AI_LLM",
          name: "Write the brief",
          position: { x: 520, y: 0 },
          data: {
            variableName: "brief",
            model: "anthropic:claude-3-5-sonnet",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You are a content strategist. You write briefs a writer can start from immediately: no filler, no restating the request.",
            userPrompt:
              "Write a content brief.\n\nTopic: {{brief_topic}}\nAudience: {{brief_audience}}\nTarget length: {{brief_wordCount}} words\n\nInclude: a working title, the angle, a section-by-section outline, five keywords to cover, and the one question the piece must answer.",
            temperature: 0.7,
            maxTokens: 1500,
            cacheTtlSeconds: 3600,
          },
        },
        {
          id: "post-brief",
          type: "SLACK",
          name: "Post to Slack",
          position: { x: 780, y: 0 },
          data: {
            variableName: "slackPost",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK",
            content:
              "*New content brief:* {{brief_topic}}\n_Audience: {{brief_audience}}_\n\n{{brief.text}}",
          },
        },
      ],
      edges: [
        { source: "start", target: "defaults" },
        { source: "defaults", target: "write-brief" },
        { source: "write-brief", target: "post-brief" },
      ],
    },
  },
  {
    slug: "weekly-seo-rank-digest",
    name: "Weekly search-rank digest",
    description:
      "Every Monday morning it pulls your tracked keyword positions from any rank-tracking API, has a model explain what moved and why it matters, and posts the digest to Slack.",
    category: "Marketing",
    domain: "marketing",
    tags: ["seo", "digest", "schedule", "slack", "ai"],
    graph: {
      nodes: [
        {
          id: "monday",
          type: "SCHEDULE_TRIGGER",
          name: "Monday 08:00",
          position: { x: 0, y: 0 },
          data: { cron: "0 8 * * 1", timezone: "UTC" },
        },
        {
          id: "fetch-ranks",
          type: "HTTP_REQUEST",
          name: "Fetch rankings",
          position: { x: 260, y: 0 },
          data: {
            variableName: "ranks",
            endpoint: "https://api.example.com/v1/rankings",
            method: "GET",
            queryParams: { period: "7d" },
            timeoutMs: 15000,
            failOnNon2xx: true,
          },
        },
        {
          id: "summarize",
          type: "AI_LLM",
          name: "Explain the movement",
          position: { x: 520, y: 0 },
          data: {
            variableName: "digest",
            model: "openai:gpt-4o-mini",
            systemPrompt:
              "You are an SEO analyst. Lead with what changed, then why it likely changed. Never invent numbers that are not in the data.",
            userPrompt:
              "Here are this week's keyword positions:\n\n{{ranks.httpResponse.data}}\n\nWrite a short digest: the three biggest movers up, the three biggest movers down, and one recommended action.",
            temperature: 0.3,
            maxTokens: 900,
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "post-digest",
          type: "SLACK",
          name: "Post the digest",
          position: { x: 780, y: 0 },
          data: {
            variableName: "slackPost",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK",
            content:
              "*Search rankings — week of {{schedule.timestamp}}*\n\n{{digest.text}}",
          },
        },
      ],
      edges: [
        { source: "monday", target: "fetch-ranks" },
        { source: "fetch-ranks", target: "summarize" },
        { source: "summarize", target: "post-digest" },
      ],
    },
  },
  {
    slug: "webinar-signup-welcome",
    name: "Webinar signup welcome email",
    description:
      "Catches a signup webhook from your registration page, normalises the payload, and sends a personalised confirmation email — skipping anything that arrives without a usable address.",
    category: "Marketing",
    domain: "marketing",
    tags: ["webinar", "email", "webhook", "welcome"],
    graph: {
      nodes: [
        {
          id: "signup",
          type: "WEBHOOK_TRIGGER",
          name: "Signup received",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "normalize",
          type: "SET",
          name: "Normalise the signup",
          position: { x: 260, y: 0 },
          data: {
            mappings: [
              { key: "attendee_email", value: "{{webhook.body.email}}" },
              { key: "attendee_name", value: "{{webhook.body.name}}" },
              { key: "webinar_title", value: "{{webhook.body.webinar}}" },
              { key: "webinar_startsAt", value: "{{webhook.body.startsAt}}" },
            ],
          },
        },
        {
          id: "has-email",
          type: "CONDITION",
          name: "Usable email?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{attendee_email}}",
            operator: "contains",
            right: "@",
          },
        },
        {
          id: "send-welcome",
          type: "EMAIL_SEND",
          name: "Send the confirmation",
          position: { x: 800, y: -60 },
          data: {
            variableName: "welcome",
            from: "hello@example.com",
            fromName: "Events",
            to: "{{attendee_email}}",
            subject: "You're in: {{webinar_title}}",
            body: "Hi {{attendee_name}},\n\nYou're registered for {{webinar_title}}. It starts at {{webinar_startsAt}}.\n\nWe'll send the join link an hour before.\n\n— The team",
          },
        },
      ],
      edges: [
        { source: "signup", target: "normalize" },
        { source: "normalize", target: "has-email" },
        { source: "has-email", target: "send-welcome", sourceHandle: "true" },
      ],
    },
  },
  {
    slug: "stripe-payment-alert",
    name: "Stripe payment alert",
    description:
      "Posts every successful Stripe payment to Slack, routing anything over your deal threshold to a separate loud message so large payments do not scroll past unnoticed.",
    category: "Revenue",
    domain: "marketing",
    tags: ["stripe", "payments", "slack", "revenue", "alerting"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "payment",
          type: "STRIPE_TRIGGER",
          name: "Stripe event",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "shape",
          type: "SET",
          name: "Shape the payment",
          position: { x: 260, y: 0 },
          data: {
            mappings: [
              { key: "payment_amountCents", value: "{{stripe.raw.amount}}" },
              { key: "payment_currency", value: "{{stripe.raw.currency}}" },
              { key: "payment_customer", value: "{{stripe.raw.customer}}" },
              { key: "payment_eventType", value: "{{stripe.eventType}}" },
            ],
          },
        },
        {
          id: "is-large",
          type: "CONDITION",
          name: "Large payment?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{payment_amountCents}}",
            operator: "gte",
            right: "50000",
          },
        },
        {
          id: "alert-large",
          type: "SLACK",
          name: "Alert: large payment",
          position: { x: 800, y: -90 },
          data: {
            variableName: "largeAlert",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK",
            content:
              ":moneybag: *Large payment* — {{payment_amountCents}} {{payment_currency}} (minor units) from {{payment_customer}}. Event: {{payment_eventType}}",
          },
        },
        {
          id: "log-standard",
          type: "SLACK",
          name: "Log: standard payment",
          position: { x: 800, y: 90 },
          data: {
            variableName: "standardLog",
            webhookUrl:
              "https://hooks.slack.com/services/REPLACE/WITH/YOUR_WEBHOOK",
            content:
              "Payment {{payment_amountCents}} {{payment_currency}} (minor units) — {{payment_eventType}}",
          },
        },
      ],
      edges: [
        { source: "payment", target: "shape" },
        { source: "shape", target: "is-large" },
        { source: "is-large", target: "alert-large", sourceHandle: "true" },
        { source: "is-large", target: "log-standard", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "trial-signup-enrichment",
    name: "Trial signup enrichment",
    description:
      "Takes a trial signup webhook, enriches the company from any firmographics API, merges the two sources into one record, and files the result as a HubSpot contact.",
    category: "Revenue",
    domain: "marketing",
    tags: ["trial", "enrichment", "hubspot", "merge", "crm"],
    graph: {
      nodes: [
        {
          id: "trial",
          type: "WEBHOOK_TRIGGER",
          name: "Trial started",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "signup-fields",
          type: "SET",
          name: "Signup fields",
          position: { x: 260, y: -90 },
          data: {
            mappings: [
              { key: "signup_email", value: "{{webhook.body.email}}" },
              { key: "signup_name", value: "{{webhook.body.name}}" },
              { key: "signup_domain", value: "{{webhook.body.companyDomain}}" },
            ],
          },
        },
        {
          id: "enrich",
          type: "HTTP_REQUEST",
          name: "Enrich the company",
          position: { x: 260, y: 90 },
          data: {
            variableName: "firmographics",
            endpoint:
              "https://api.example.com/v1/companies/{{webhook.body.companyDomain}}",
            method: "GET",
            timeoutMs: 10000,
          },
        },
        {
          id: "combine",
          type: "MERGE",
          name: "Combine both sources",
          position: { x: 560, y: 0 },
          data: { mode: "mergeByKey" },
        },
        {
          id: "create-contact",
          type: "HUBSPOT_CREATE_CONTACT",
          name: "Create HubSpot contact",
          position: { x: 820, y: 0 },
          data: {
            variableName: "contact",
            properties:
              '{"email":"{{signup_email}}","firstname":"{{signup_name}}","website":"{{signup_domain}}","industry":"{{firmographics.httpResponse.data.industry}}","hs_lead_status":"IN_PROGRESS"}',
          },
        },
      ],
      edges: [
        { source: "trial", target: "signup-fields" },
        { source: "trial", target: "enrich" },
        { source: "signup-fields", target: "combine" },
        { source: "enrich", target: "combine" },
        { source: "combine", target: "create-contact" },
      ],
    },
  },
  {
    slug: "sheet-row-personalised-draft",
    name: "New sheet row, personalised draft written back",
    description:
      "Watches a spreadsheet of leads and, for each new row, has a model write a personalised opening line and writes it back to that row. This is the shape of the library's outreach automations: the sheet is the queue, the row is the record, and the draft lands beside the lead rather than in a separate system. Rows already present when you publish are NOT replayed — the trigger records where the sheet was and starts from there, so activating this against 500 existing leads sends nothing. Give the sheet a header row with Name / Company / Email / Draft, and set the key column to Email so a re-sorted sheet does not look like new rows.",
    category: "Marketing",
    domain: "marketing",
    tags: ["sheets", "outreach", "personalisation", "ai", "trigger", "leads"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "new-lead",
          type: "SHEETS_TRIGGER",
          name: "New lead row",
          position: { x: 0, y: 0 },
          data: {
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            range: "Leads!A1:E1000",
            // Identity comes from the email, not the row number: a sorted or
            // filtered sheet would otherwise look like a page of new rows.
            keyColumn: "Email",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "write-draft",
          type: "AI_LLM",
          name: "Write the opener",
          position: { x: 300, y: 0 },
          data: {
            variableName: "draft",
            model: "openai:gpt-4o-mini",
            fallbackModels: "anthropic:claude-3-5-haiku",
            systemPrompt:
              "Write one sentence a salesperson could send as the opening line of a cold email. Specific, no flattery, no exclamation marks. Return the sentence only.",
            userPrompt:
              "Name: {{row.fields.Name}}\nCompany: {{row.fields.Company}}",
            temperature: 0.7,
            maxTokens: 120,
          },
        },
        {
          id: "save-draft",
          type: "SHEETS_UPDATE",
          name: "Write it back",
          position: { x: 600, y: 0 },
          data: {
            variableName: "saved",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Leads",
            // The trigger carries the row it fired for, so the draft lands on
            // that row rather than on whatever is at the bottom.
            rowNumber: "{{row.rowNumber}}",
            values:
              '["{{row.fields.Name}}","{{row.fields.Company}}","{{row.fields.Email}}","{{draft.text}}"]',
          },
        },
      ],
      edges: [
        { source: "new-lead", target: "write-draft" },
        { source: "write-draft", target: "save-draft" },
      ],
    },
  },
  {
    slug: "api-collection-to-sheet-sync",
    name: "Sync an API collection into a sheet",
    description:
      "Pulls a collection from an API on a schedule and keeps a sheet in step with it: each record updates the row whose key column matches, or is appended when there is none. Run it as often as you like — the upsert is what makes a repeat harmless, so the sheet never grows a second copy of the same record. The endpoint is a public test service, so it runs before you configure anything; point it at your own collection and give the sheet a header row with Id / Title / Status. If the search range is too small to hold everything, the node fails rather than appending a duplicate it cannot rule out.",
    category: "Data",
    domain: "data",
    tags: ["sheets", "sync", "upsert", "api", "schedule", "idempotent"],
    graph: {
      nodes: [
        {
          id: "hourly",
          type: "SCHEDULE_TRIGGER",
          name: "Every hour",
          position: { x: 0, y: 0 },
          data: { cron: "0 * * * *", timezone: "UTC" },
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
            variableName: "batch",
            code: "return { items: (input.source.httpResponse.data || []).slice(0, 10) };",
          },
        },
        {
          id: "current-rows",
          type: "SHEETS_READ",
          name: "Read what is there",
          position: { x: 780, y: 0 },
          data: {
            variableName: "existing",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            range: "Records!A1:C1000",
            hasHeader: true,
            limit: 1000,
          },
        },
        {
          id: "fan-out",
          type: "SPLIT_OUT",
          name: "One record at a time",
          position: { x: 1040, y: 0 },
          data: { path: "batch.items", maxItems: 10 },
        },
        {
          id: "sync-row",
          type: "SHEETS_UPSERT",
          name: "Update or append",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "synced",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Records",
            range: "Records!A1:C1000",
            matchColumn: "Id",
            matchValue: "{{$item.id}}",
            values: '["{{$item.id}}","{{$item.title}}","{{$item.completed}}"]',
          },
        },
        {
          id: "collect",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1560, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "hourly", target: "fetch" },
        { source: "fetch", target: "shape" },
        { source: "shape", target: "current-rows" },
        { source: "current-rows", target: "fan-out" },
        { source: "fan-out", target: "sync-row" },
        { source: "sync-row", target: "collect" },
      ],
    },
  },
];
