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
      "Give it a topic and an audience and it drafts a full content brief — angle, outline, keywords, and a suggested title. This is the sample a new workspace installs first, so it deliberately connects to nothing: run it and read the brief in the run trace. Add a Slack Post Message node on the end when you want it delivered somewhere.",
    category: "Marketing",
    domain: "marketing",
    tags: ["content", "brief", "ai", "seo", "sample"],
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
      ],
      edges: [
        { source: "start", target: "defaults" },
        { source: "defaults", target: "write-brief" },
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
          type: "SLACK_POST",
          name: "Post the digest",
          position: { x: 780, y: 0 },
          data: {
            variableName: "slackPost",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "*Search rankings — week of {{schedule.timestamp}}*\n\n{{digest.text}}",
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
          type: "SLACK_POST",
          name: "Alert: large payment",
          position: { x: 800, y: -90 },
          data: {
            variableName: "largeAlert",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":moneybag: *Large payment* — {{payment_amountCents}} {{payment_currency}} (minor units) from {{payment_customer}}. Event: {{payment_eventType}}",
          },
        },
        {
          id: "log-standard",
          type: "SLACK_POST",
          name: "Log: standard payment",
          position: { x: 800, y: 90 },
          data: {
            variableName: "standardLog",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "Payment {{payment_amountCents}} {{payment_currency}} (minor units) — {{payment_eventType}}",
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
  {
    slug: "enrich-inbound-lead",
    name: "Enrich an inbound lead before anyone reads it",
    description:
      "Takes a form or webhook signup and asks Apollo who they are — title, company, size, industry — so the first human to look at the lead already knows whether it is worth a call. A miss is reported as found: false rather than failing, because one unknown contact must not stop a batch. Apollo spends a credit per successful match and more to reveal an email, so revealing is off by default and the node refuses a name-only query rather than paying for a guess. Supply an Apollo credential.",
    category: "Revenue",
    domain: "marketing",
    tags: ["apollo", "enrich", "lead", "inbound", "crm", "prospect"],
    graph: {
      nodes: [
        {
          id: "signup",
          type: "WEBHOOK_TRIGGER",
          name: "New signup",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "enrich",
          type: "APOLLO_ENRICH",
          name: "Who is this?",
          position: { x: 280, y: 0 },
          data: {
            variableName: "lead",
            mode: "person",
            email: "{{webhook.body.email}}",
            revealPersonalEmails: false,
          },
        },
        {
          id: "known",
          type: "CONDITION",
          name: "Matched?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{lead.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "score",
          type: "CODE",
          name: "Score the lead",
          position: { x: 840, y: -80 },
          data: {
            code: 'const p = input.lead?.person ?? {};\nconst size = p.companyEmployees ?? 0;\nconst title = (p.title ?? "").toLowerCase();\n\nconst senior = /(chief|head|director|vp|founder|owner|manager)/.test(title);\n\nreturn {\n  tier: size >= 200 && senior ? "A" : size >= 50 || senior ? "B" : "C",\n  summary: `${p.name ?? "Unknown"} — ${p.title ?? "no title"} at ${p.companyName ?? "unknown company"} (${size || "?"} staff)`,\n};\n',
          },
        },
        {
          id: "unknown",
          type: "CODE",
          name: "Record the miss",
          position: { x: 840, y: 100 },
          data: {
            code: '// Not a failure. Plenty of real signups are from people Apollo has\n// never heard of, and they still need routing.\nreturn {\n  tier: "unknown",\n  summary: `No Apollo match for ${input.webhook?.body?.email ?? "this address"}`,\n};\n',
          },
        },
      ],
      edges: [
        { source: "signup", target: "enrich" },
        { source: "enrich", target: "known" },
        { source: "known", target: "score", sourceHandle: "true" },
        { source: "known", target: "unknown", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "pre-call-company-research",
    name: "Company research brief before the call",
    description:
      "Given a company domain, pulls the firmographics from Apollo and the most recent web coverage from Google, then has a model write a one-page brief for whoever is taking the meeting. Custom Search is metered — a hundred queries a day are free and everything after is billed — so the node caps results and reports how many queries it spent. Supply an Apollo credential and a Google Custom Search credential.",
    category: "Revenue",
    domain: "marketing",
    // Apollo for the firmographics, Google for the coverage.
    tier: "library",
    tags: ["apollo", "google", "research", "brief", "sales", "ai"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Run with a domain",
          position: { x: 0, y: 0 },
          data: { payload: '{"domain":"example.com"}' },
        },
        {
          id: "company",
          type: "APOLLO_ENRICH",
          name: "Firmographics",
          position: { x: 280, y: 0 },
          data: {
            variableName: "company",
            mode: "organization",
            domain: "{{domain}}",
          },
        },
        {
          id: "news",
          type: "GOOGLE_SEARCH",
          name: "Recent coverage",
          position: { x: 560, y: 0 },
          data: {
            variableName: "coverage",
            query: "{{company.organization.name}} news",
            limit: 10,
            // Last year only: older coverage is rarely what a caller needs.
            dateRestrict: "y1",
          },
        },
        {
          id: "brief",
          type: "AI_LLM",
          name: "Write the brief",
          position: { x: 840, y: 0 },
          data: {
            variableName: "brief",
            model: "anthropic:claude-3-5-sonnet",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You brief salespeople before a call. One page, specific, no filler. If the evidence is thin, say so rather than padding.",
            userPrompt:
              "Company: {{company.organization.name}} ({{domain}})\nIndustry: {{company.organization.industry}}\nStaff: {{company.organization.employees}}\n\nRecent coverage:\n{{{json coverage.results}}}\n\nWrite the brief: what they do, what changed recently, and two questions worth asking.",
            temperature: 0.4,
            maxTokens: 1200,
          },
        },
      ],
      edges: [
        { source: "start", target: "company" },
        { source: "company", target: "news" },
        { source: "news", target: "brief" },
      ],
    },
  },
  {
    slug: "form-to-stripe-payment-link",
    name: "Quote request to payment link",
    description:
      "Publishes a form, finds or creates the Stripe customer behind the email, and returns a payment link for the chosen price. Stripe treats email as a label rather than a key and will happily hold four customers with the same address, so the find-or-create is what stops a billing account filling up with duplicates. Both writes carry an idempotency key derived from the run and the node, so a retried step returns the customer and link it already made rather than a second pair. Supply a Stripe credential and put real price ids in the Code node.",
    category: "Revenue",
    domain: "marketing",
    tags: ["stripe", "payment", "link", "form", "customer", "checkout"],
    graph: {
      nodes: [
        {
          id: "request",
          type: "FORM_TRIGGER",
          name: "Quote request",
          position: { x: 0, y: 0 },
          data: {
            title: "Request a quote",
            description:
              "Tell us what you need and we will send a payment link.",
            submitLabel: "Request quote",
            successMessage: "Thanks — your payment link is on its way.",
            fields: [
              {
                name: "email",
                label: "Your email",
                type: "email",
                required: true,
              },
              {
                name: "name",
                label: "Your name",
                type: "text",
                required: true,
              },
              {
                name: "plan",
                label: "Which plan?",
                type: "text",
                required: true,
              },
            ],
          },
        },
        {
          id: "price",
          type: "CODE",
          name: "Pick the price",
          position: { x: 280, y: 0 },
          data: {
            code: 'const plan = String(input.form?.fields?.plan ?? "").toLowerCase();\n\n// Replace with your own Stripe price ids. A payment link needs a PRICE\n// (price_...), not a product (prod_...).\nconst prices = {\n  starter: "price_REPLACE_STARTER",\n  pro: "price_REPLACE_PRO",\n};\n\nreturn {\n  priceId: prices[plan] ?? prices.starter,\n  planName: plan || "starter",\n};\n',
          },
        },
        {
          id: "customer",
          type: "STRIPE_FIND_OR_CREATE_CUSTOMER",
          name: "Find or create the customer",
          position: { x: 560, y: 0 },
          data: {
            variableName: "customer",
            email: "{{form.fields.email}}",
            name: "{{form.fields.name}}",
            metadata: '{"source": "quote-form", "plan": "{{planName}}"}',
          },
        },
        {
          id: "link",
          type: "STRIPE_CREATE_PAYMENT_LINK",
          name: "Create the payment link",
          position: { x: 840, y: 0 },
          data: {
            variableName: "link",
            priceId: "{{priceId}}",
            quantity: 1,
            metadata: '{"customer": "{{customer.id}}"}',
          },
        },
      ],
      edges: [
        { source: "request", target: "price" },
        { source: "price", target: "customer" },
        { source: "customer", target: "link" },
      ],
    },
  },
  {
    slug: "stripe-payment-to-shopify-order",
    name: "Paid in Stripe, ordered in Shopify",
    description:
      "When a Stripe payment succeeds, reads the customer and raises the matching Shopify order. Neither system knows about the other, so the risk is doing it twice: Shopify has no idempotency header for orders, and this uses the mechanism it does provide — a source identifier derived from the run and the node, which Shopify treats as unique per shop. A retry after a lost response returns the order already created rather than charging the customer again. Receipts are off by default so switching this on does not silently email people. Supply a Stripe credential and a Shopify credential.",
    category: "Revenue",
    domain: "marketing",
    // Stripe to read the payment, Shopify to raise the order.
    tier: "library",
    tags: ["stripe", "shopify", "order", "payment", "commerce", "fulfilment"],
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
          type: "STRIPE_GET_CUSTOMER",
          name: "Read the customer",
          position: { x: 280, y: 0 },
          data: {
            variableName: "customer",
            customerId: "{{stripe.data.object.customer}}",
          },
        },
        {
          id: "cart",
          type: "CODE",
          name: "Build the line items",
          position: { x: 560, y: 0 },
          data: {
            code: 'const payment = input.stripe?.data?.object ?? {};\n\n// Stripe amounts are in the smallest currency unit; Shopify wants a\n// decimal string.\nconst amount = Number(payment.amount ?? payment.amount_total ?? 0) / 100;\n\nreturn {\n  lineItems: [\n    {\n      title: payment.description || "Order",\n      quantity: 1,\n      price: amount.toFixed(2),\n    },\n  ],\n};\n',
          },
        },
        {
          id: "order",
          type: "SHOPIFY_CREATE_ORDER",
          name: "Raise the order",
          position: { x: 840, y: 0 },
          data: {
            variableName: "order",
            email: "{{customer.email}}",
            lineItems: "{{{json lineItems}}}",
            tags: "stripe,automated",
            note: "Created from Stripe payment {{stripe.data.object.id}}",
            sendReceipt: false,
          },
        },
      ],
      edges: [
        { source: "paid", target: "customer" },
        { source: "customer", target: "cart" },
        { source: "cart", target: "order" },
      ],
    },
  },
  {
    slug: "signup-to-mailerlite",
    name: "Add a signup to the right MailerLite group",
    description:
      "Takes a signup webhook and adds the person to a group — after checking whether they already exist. MailerLite matches on email and updates rather than duplicating, so the add itself is safe to repeat; the lookup is there for a different reason. Someone who previously unsubscribed still exists, and adding them again returns 200 without resubscribing them. The branch means the workflow can tell the difference instead of reporting success for a person who is not on the list.",
    category: "Marketing",
    domain: "marketing",
    tags: ["mailerlite", "subscriber", "signup", "group", "list", "email"],
    graph: {
      nodes: [
        {
          id: "signup",
          type: "WEBHOOK_TRIGGER",
          name: "New signup",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "existing",
          type: "MAILERLITE_FIND_SUBSCRIBER",
          name: "Do we know them?",
          position: { x: 280, y: 0 },
          data: {
            variableName: "existing",
            email: "{{webhook.body.email}}",
          },
        },
        {
          id: "opted-out",
          type: "CONDITION",
          name: "Previously unsubscribed?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{existing.status}}",
            operator: "equals",
            right: "unsubscribed",
          },
        },
        {
          id: "add",
          type: "MAILERLITE_CREATE_SUBSCRIBER",
          name: "Add to the group",
          position: { x: 840, y: 100 },
          data: {
            variableName: "subscriber",
            email: "{{webhook.body.email}}",
            fields: '{"name": "{{webhook.body.name}}"}',
            groupIds: "REPLACE_WITH_GROUP_ID",
          },
        },
        {
          id: "respect",
          type: "CODE",
          name: "Leave them alone",
          position: { x: 840, y: -100 },
          data: {
            code: '// They opted out. Re-adding would not resubscribe them anyway, and\n// pretending otherwise is how a workflow reports success for someone\n// who never receives anything.\nreturn {\n  skipped: true,\n  reason: `${input.webhook?.body?.email ?? "This address"} previously unsubscribed`,\n};\n',
          },
        },
      ],
      edges: [
        { source: "signup", target: "existing" },
        { source: "existing", target: "opted-out" },
        { source: "opted-out", target: "respect", sourceHandle: "true" },
        { source: "opted-out", target: "add", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "one-post-two-networks",
    name: "Write once, publish to X and LinkedIn",
    description:
      "Takes a topic, drafts a post for each network in its own register, and publishes both. The two are written separately on purpose: the same words that work in 280 characters read as terse on LinkedIn, and the LinkedIn version can carry the detail X has no room for. Length is checked before either call — X counts weighted characters, so a post with emoji is longer than it looks, and its rejection does not say by how much. Supply an X credential and a LinkedIn credential; both need account-level permissions the connect flow cannot grant, which the config panel spells out.",
    category: "Marketing",
    domain: "marketing",
    // X to post, LinkedIn to post. Different accounts, different approvals.
    tier: "library",
    tags: ["x", "twitter", "linkedin", "social", "publish", "cross-post"],
    graph: {
      nodes: [
        {
          id: "brief",
          type: "MANUAL_TRIGGER",
          name: "Run with a topic",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"topic":"What we learned shipping our automation library","angle":"a lesson, not an announcement"}',
          },
        },
        {
          id: "draft",
          type: "AI_LLM",
          name: "Draft both versions",
          position: { x: 280, y: 0 },
          data: {
            variableName: "drafts",
            model: "anthropic:claude-3-5-sonnet",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You write for two audiences at once. The X post is under 240 characters, has no hashtags, and makes one point. The LinkedIn post is three short paragraphs and can carry the detail X has no room for. Never write the same words twice.",
            userPrompt:
              "Topic: {{topic}}\nAngle: {{angle}}\n\nReturn the X post first, then a line containing only ---, then the LinkedIn post.",
            temperature: 0.7,
            maxTokens: 900,
          },
        },
        {
          id: "split",
          type: "CODE",
          name: "Separate them",
          position: { x: 560, y: 0 },
          data: {
            code: 'const raw = String(input.drafts?.text ?? "");\nconst [first, ...rest] = raw.split(/^---$/m);\n\n// Falling back to the whole text rather than an empty string: a model that\n// ignored the separator should still produce a publishable post rather than\n// silently posting nothing.\nreturn {\n  xPost: (first ?? raw).trim(),\n  linkedinPost: (rest.join("---") || raw).trim(),\n};\n',
          },
        },
        {
          id: "x",
          type: "X_POST",
          name: "Post to X",
          position: { x: 840, y: -80 },
          data: {
            variableName: "xResult",
            text: "{{xPost}}",
          },
        },
        {
          id: "linkedin",
          type: "LINKEDIN_POST",
          name: "Post to LinkedIn",
          position: { x: 840, y: 100 },
          data: {
            variableName: "linkedinResult",
            text: "{{linkedinPost}}",
            visibility: "PUBLIC",
          },
        },
      ],
      edges: [
        { source: "brief", target: "draft" },
        { source: "draft", target: "split" },
        { source: "split", target: "x" },
        { source: "split", target: "linkedin" },
      ],
    },
  },
  {
    slug: "publish-video-everywhere",
    name: "Publish one video to YouTube and Instagram",
    description:
      "Fetches a rendered video, uploads it to YouTube, and publishes it through Upload-Post to Instagram and TikTok. The video is streamed from the run's file store to each platform rather than loaded into memory, so a large file costs a buffer instead of its own size — and several concurrent runs do not take the worker down with them. YouTube uploads start as private on purpose: an unverified Google Cloud project forces that anyway, and finding out after a public upload is worse than choosing it. Supply a YouTube credential and an Upload-Post credential.",
    category: "Marketing",
    domain: "marketing",
    // YouTube to upload, Upload-Post to syndicate.
    tier: "library",
    tags: ["youtube", "instagram", "video", "upload", "publish", "social"],
    graph: {
      nodes: [
        {
          id: "ready",
          type: "WEBHOOK_TRIGGER",
          name: "Video ready",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "fetch",
          type: "FILE_DOWNLOAD",
          name: "Fetch the render",
          position: { x: 280, y: 0 },
          data: {
            variableName: "video",
            url: "{{webhook.body.videoUrl}}",
            // 100 MB — the store's own per-file ceiling, which binds before
            // any platform limit. The upload streams from there, so this
            // bounds what is STORED rather than what is held in memory.
            maxBytes: 104857600,
          },
        },
        {
          id: "youtube",
          type: "YOUTUBE_UPLOAD",
          name: "Upload to YouTube",
          position: { x: 560, y: -80 },
          data: {
            variableName: "youtube",
            // Three braces: the file reference is an object.
            videoRef: "{{{json video.file}}}",
            title: "{{webhook.body.title}}",
            description: "{{webhook.body.description}}",
            tags: "automation,workflow",
            // Private first. An unverified project forces this regardless, and
            // discovering that after a public upload is the worse order.
            privacyStatus: "private",
          },
        },
        {
          id: "social",
          type: "UPLOAD_POST_PUBLISH",
          name: "Publish to Instagram",
          position: { x: 560, y: 120 },
          data: {
            variableName: "social",
            profile: "REPLACE_WITH_UPLOAD_POST_PROFILE",
            platforms: "instagram,tiktok",
            caption: "{{webhook.body.title}}",
            mediaRef: "{{{json video.file}}}",
            isVideo: true,
          },
        },
      ],
      edges: [
        { source: "ready", target: "fetch" },
        { source: "fetch", target: "youtube" },
        { source: "fetch", target: "social" },
      ],
    },
  },
  {
    slug: "free-image-from-a-prompt",
    name: "Turn a prompt into an image, free",
    description:
      "Publishes a form that takes a prompt and returns a generated image, using Pollinations — which needs no API key and costs nothing. Free means rate-limited and occasionally overloaded, so the node retries rather than failing: a busy Pollinations answers 200 with an HTML page, and storing that would produce a run that looks successful and leaves a corrupt file behind. Set a seed to make the same prompt reproduce the same image. Nothing to connect.",
    category: "Marketing",
    domain: "marketing",
    tags: ["image", "generate", "free", "pollinations", "prompt", "ai"],
    graph: {
      nodes: [
        {
          id: "ask",
          type: "FORM_TRIGGER",
          name: "Describe the image",
          position: { x: 0, y: 0 },
          data: {
            title: "Generate an image",
            description: "Describe what you want and it will be generated.",
            submitLabel: "Generate",
            successMessage: "Generating — your image will appear in the run.",
            fields: [
              {
                name: "prompt",
                label: "What should it show?",
                type: "textarea",
                required: true,
                maxLength: 1000,
              },
            ],
          },
        },
        {
          id: "image",
          type: "POLLINATIONS_IMAGE",
          name: "Generate it",
          position: { x: 300, y: 0 },
          data: {
            variableName: "picture",
            prompt: "{{form.fields.prompt}}",
            width: 1024,
            height: 1024,
            filename: "generated.jpg",
          },
        },
      ],
      edges: [{ source: "ask", target: "image" }],
    },
  },
  {
    slug: "article-to-hero-image",
    name: "Give an article a hero image",
    description:
      "Takes a headline, has a model turn it into an image brief, and generates the picture — because a good prompt is a different piece of writing from a good headline, and feeding the headline straight to an image model produces literal, stock-looking results. The generated image is stored as a run file, so a Drive upload, a LinkedIn post or an email attachment can take it directly. DALL·E rewrites prompts, and the node reports what it actually rendered, which is the difference between an image that is wrong and a model that changed the brief. Supply an OpenAI credential.",
    category: "Marketing",
    domain: "marketing",
    tags: ["image", "openai", "dalle", "hero", "article", "generate"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Run with a headline",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"headline":"Why most automation projects stall in month three"}',
          },
        },
        {
          id: "brief",
          type: "AI_LLM",
          name: "Write the image brief",
          position: { x: 280, y: 0 },
          data: {
            variableName: "brief",
            model: "anthropic:claude-3-5-sonnet",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You write image briefs. Describe a scene, a composition and a mood — never text, never logos, never a literal illustration of the words. One paragraph, no preamble.",
            userPrompt:
              "Write an image brief for an article headlined: {{headline}}",
            temperature: 0.8,
            maxTokens: 300,
          },
        },
        {
          id: "hero",
          type: "OPENAI_IMAGE",
          name: "Generate the image",
          position: { x: 560, y: 0 },
          data: {
            variableName: "hero",
            prompt: "{{brief.text}}",
            model: "gpt-image-1",
            size: "1536x1024",
            filename: "hero.png",
          },
        },
      ],
      edges: [
        { source: "start", target: "brief" },
        { source: "brief", target: "hero" },
      ],
    },
  },
  {
    slug: "template-video-to-social",
    name: "Render a video from a template and post it",
    description:
      "Fills a Creatomate template with values from a webhook, waits for the render, and publishes the result to Instagram and TikTok. The wait is a durable, cancellable step rather than a held worker — a render takes minutes, and cancelling the run asks Creatomate to stop rather than leaving it to finish and bill. The rendered file is stored rather than passed on as a URL: Creatomate's link is tied to the render and will stop working. Modification keys must match the template's own element names exactly, which is what its 400 means. Supply a Creatomate credential and an Upload-Post credential.",
    category: "Marketing",
    domain: "marketing",
    // Creatomate to render, Upload-Post to publish.
    tier: "library",
    tags: ["creatomate", "video", "render", "instagram", "social", "template"],
    graph: {
      nodes: [
        {
          id: "request",
          type: "WEBHOOK_TRIGGER",
          name: "Render requested",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "render",
          type: "CREATOMATE_RENDER",
          name: "Render the video",
          position: { x: 280, y: 0 },
          data: {
            variableName: "video",
            templateId: "REPLACE_WITH_TEMPLATE_ID",
            // Keys are the template's element names. Three braces: two would
            // HTML-escape the quotes and the JSON would not parse.
            modifications:
              '{"Headline": "{{webhook.body.headline}}", "Subtitle": "{{webhook.body.subtitle}}"}',
            maxWaitSeconds: 900,
          },
        },
        {
          id: "publish",
          type: "UPLOAD_POST_PUBLISH",
          name: "Publish it",
          position: { x: 560, y: 0 },
          data: {
            variableName: "published",
            profile: "REPLACE_WITH_UPLOAD_POST_PROFILE",
            platforms: "instagram,tiktok",
            caption: "{{webhook.body.headline}}",
            mediaRef: "{{{json video.file}}}",
            isVideo: true,
          },
        },
      ],
      edges: [
        { source: "request", target: "render" },
        { source: "render", target: "publish" },
      ],
    },
  },
  {
    slug: "veo-clip-to-youtube",
    name: "Generate a short clip and upload it",
    description:
      "Turns a prompt into a Veo clip and uploads it to YouTube as a private video. Generation takes minutes and is billed per second of output, so the wait is bounded and cancellable and the cost lands in the run's own trace rather than only on an invoice. The upload starts private deliberately — an unverified Google Cloud project forces that anyway, and finding out after a public upload is the worse order. Veo needs Vertex AI enabled on a billed project with the account granted the Vertex AI User role; the config panel says so, because it arrives as a 403 otherwise. Supply a Google credential with Vertex access and a YouTube credential.",
    category: "Marketing",
    domain: "marketing",
    // Vertex for generation, YouTube for the upload. Different scopes.
    tier: "library",
    tags: ["veo", "video", "generate", "youtube", "upload", "ai"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "MANUAL_TRIGGER",
          name: "Run with a prompt",
          position: { x: 0, y: 0 },
          data: {
            payload:
              '{"prompt":"A slow aerial shot over a misty pine forest at dawn","title":"Dawn over the pines"}',
          },
        },
        {
          id: "clip",
          type: "VEO_GENERATE",
          name: "Generate the clip",
          position: { x: 300, y: 0 },
          data: {
            variableName: "clip",
            prompt: "{{prompt}}",
            durationSeconds: 8,
            aspectRatio: "16:9",
            maxWaitSeconds: 900,
          },
        },
        {
          id: "upload",
          type: "YOUTUBE_UPLOAD",
          name: "Upload to YouTube",
          position: { x: 600, y: 0 },
          data: {
            variableName: "video",
            videoRef: "{{{json clip.file}}}",
            title: "{{title}}",
            description: "Generated from: {{prompt}}",
            privacyStatus: "private",
          },
        },
      ],
      edges: [
        { source: "start", target: "clip" },
        { source: "clip", target: "upload" },
      ],
    },
  },
];
