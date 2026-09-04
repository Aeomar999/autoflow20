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
  {
    slug: "outreach-personalized-gmail",
    name: "Hyper-personalized email outreach",
    description:
      "Reference automation #1. Reads prospect rows from a Google Sheet, drafts a tailored reply with a model, sends it through Gmail, and marks the row done so the same lead is never emailed twice. PREREQUISITES: Google credentials covering Sheets and Gmail (they are separate scoped credentials here, so connect both), an AI provider key, and a sheet with the columns First Name, Email ID, Inquiry Intent, Original Inquiry, plus a Sent column this workflow writes back to. DEVIATIONS FROM THE SOURCE: the source syncs the Gmail sender display name from the account before sending — that is a read this product has no node for, so the From address is configured on the node instead. The source has no already-sent guard; the Sent column and the filter on it are added here, because a sheet-polling trigger that re-reads a row after an edit would otherwise email the same person again.",
    category: "Revenue",
    domain: "marketing",
    // Sheets to read and write, Gmail to send. The AI key is optional.
    tier: "library",
    tags: ["outreach", "gmail", "sheets", "ai", "personalization", "leads"],
    graph: {
      nodes: [
        {
          id: "new-lead",
          type: "SHEETS_TRIGGER",
          name: "New prospect row",
          position: { x: 0, y: 0 },
          data: {
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            range: "Leads!A:F",
            // The email is the row's identity, so a re-ordered sheet does not
            // replay rows that were already handled.
            keyColumn: "Email ID",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "unsent",
          type: "CONDITION",
          name: "Not already sent?",
          position: { x: 280, y: 0 },
          data: {
            left: "{{row.fields.Sent}}",
            operator: "is_empty",
          },
        },
        {
          id: "draft",
          type: "AI_LLM",
          name: "Draft the reply",
          position: { x: 560, y: -60 },
          data: {
            variableName: "draft",
            model: "openai:gpt-4o",
            fallbackModels: "anthropic:claude-3-5-sonnet",
            systemPrompt:
              "You write short, specific replies to inbound enquiries. Answer what they actually asked, propose one concrete next step, and never open with a compliment. No subject line, no signature.",
            userPrompt:
              "Reply to this enquiry.\n\nName: {{row.fields.[First Name]}}\nWhat they want: {{row.fields.[Inquiry Intent]}}\n\nTheir message:\n{{row.fields.[Original Inquiry]}}",
            temperature: 0.6,
            maxTokens: 700,
          },
        },
        {
          id: "send",
          type: "GMAIL_SEND",
          name: "Send it",
          position: { x: 840, y: -60 },
          data: {
            variableName: "sent",
            to: "{{row.fields.[Email ID]}}",
            subject: "Re: {{row.fields.[Inquiry Intent]}}",
            text: "{{draft.text}}",
          },
        },
        {
          id: "mark-sent",
          type: "SHEETS_UPDATE",
          name: "Mark the row sent",
          position: { x: 1120, y: -60 },
          data: {
            variableName: "marked",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Leads",
            rowNumber: "{{row.rowNumber}}",
            // Written AFTER the send, so a failed send leaves the row eligible
            // for a retry rather than silently skipping the lead.
            values: '{"Sent": "{{$now.iso}}"}',
          },
        },
      ],
      edges: [
        { source: "new-lead", target: "unsent" },
        { source: "unsent", target: "draft", sourceHandle: "true" },
        { source: "draft", target: "send" },
        { source: "send", target: "mark-sent" },
      ],
    },
  },
  {
    slug: "upwork-proposal-generator",
    name: "Upwork proposal drafts from scraped jobs",
    description:
      "Reference automation #2. Runs an Apify actor to collect Upwork jobs matching your criteria, drafts a proposal for each against your company knowledge base, writes the draft back to the sheet for review, and emails a 'proposals ready' notification. Nothing is submitted automatically — the sheet is the review step. PREREQUISITES: an Apify account with API credits, a Google Sheet with the columns Title, URL, Description, Skills, Questions, Applied, Proposal Template, a Google Sheets credential, a Gmail credential, and an AI provider key. DEVIATIONS FROM THE SOURCE: the source notes it uses n8n community nodes and is self-hosted only — that constraint does not apply here, since Apify is a first-class node. The source scrapes and logs in one workflow then reads the sheet back; this runs the actor and drafts in one pass, because the intermediate write existed only to cross an n8n execution boundary.",
    category: "Revenue",
    domain: "marketing",
    // Apify to scrape, Sheets to log, Gmail to notify.
    tier: "library",
    tags: ["upwork", "apify", "proposal", "sheets", "freelance", "ai"],
    graph: {
      nodes: [
        {
          id: "daily",
          type: "SCHEDULE_TRIGGER",
          name: "Every morning",
          position: { x: 0, y: 0 },
          data: { cron: "0 7 * * *", timezone: "UTC" },
        },
        {
          id: "scrape",
          type: "APIFY_RUN",
          name: "Scrape Upwork jobs",
          position: { x: 260, y: 0 },
          data: {
            variableName: "run",
            actorId: "REPLACE_WITH_UPWORK_ACTOR",
            input: '{"searchQuery":"n8n automation","maxItems":25}',
            waitForFinish: true,
            maxWaitSeconds: 600,
          },
        },
        {
          id: "jobs",
          type: "APIFY_GET_DATASET",
          name: "Read the jobs",
          position: { x: 520, y: 0 },
          data: {
            variableName: "jobs",
            datasetId: "{{run.datasetId}}",
            limit: 50,
            clean: true,
          },
        },
        {
          id: "shape",
          type: "CODE",
          name: "Shape the list",
          position: { x: 780, y: 0 },
          data: {
            code: 'const jobs = input.jobs?.items ?? [];\n\nreturn {\n  items: jobs.map((job) => ({\n    title: job.title ?? "",\n    url: job.url ?? "",\n    description: (job.description ?? "").slice(0, 4000),\n    skills: Array.isArray(job.skills) ? job.skills.join(", ") : "",\n  })),\n  found: jobs.length,\n};\n',
          },
        },
        {
          id: "each-job",
          type: "SPLIT_OUT",
          name: "One job at a time",
          position: { x: 1040, y: 0 },
          data: { path: "items", maxItems: 25 },
        },
        {
          id: "propose",
          type: "AI_LLM",
          name: "Draft the proposal",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "proposal",
            model: "google:gemini-1.5-pro",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You write Upwork proposals. Open with the client's actual problem, not with your credentials. Name one thing you would do first. Under 200 words. Replace the knowledge base below with your own.\n\nKNOWLEDGE BASE: We build workflow automations. Ten years across integrations and data pipelines. Fixed-price discovery, then delivery.",
            userPrompt:
              "Job: {{$item.title}}\nSkills wanted: {{$item.skills}}\n\n{{$item.description}}",
            temperature: 0.7,
            maxTokens: 600,
          },
        },
        {
          id: "log",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Log for review",
          position: { x: 1560, y: 0 },
          data: {
            variableName: "logged",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Jobs",
            values:
              '{"Title": "{{$item.title}}", "URL": "{{$item.url}}", "Skills": "{{$item.skills}}", "Applied": "", "Proposal Template": "{{proposal.text}}"}',
          },
        },
        {
          id: "collected",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1820, y: 0 },
          data: {},
        },
        {
          id: "notify",
          type: "GMAIL_SEND",
          name: "Proposals ready",
          position: { x: 2080, y: 0 },
          data: {
            variableName: "notified",
            to: "REPLACE_WITH_YOUR_EMAIL",
            subject: "{{found}} Upwork proposals ready to review",
            text: "{{found}} jobs were scraped and drafted. Review them in the sheet before submitting — nothing has been sent.",
          },
        },
      ],
      edges: [
        { source: "daily", target: "scrape" },
        { source: "scrape", target: "jobs" },
        { source: "jobs", target: "shape" },
        { source: "shape", target: "each-job" },
        { source: "each-job", target: "propose" },
        { source: "propose", target: "log" },
        { source: "log", target: "collected" },
        { source: "collected", target: "notify" },
      ],
    },
  },
  {
    slug: "lead-gen-apollo-gpt4",
    name: "Funded-company prospecting with Apollo enrichment",
    description:
      "Reference automation #3. Scrapes newly funded companies with Apify, enriches each with Apollo to find a decision-maker and a verified email, drafts cold outreach against the funding signal, and logs the result to a Google Sheet as a ready-to-send list. Nothing is emailed. PREREQUISITES: an Apify account with credits, Apollo.io API credentials, a Google Sheets credential, and an AI provider key. The sheet needs the columns Company, Domain, Contact, Title, Email, Draft. DEVIATIONS FROM THE SOURCE: the source uses GPT-4 by name; this uses the model registry's fallback chain so a workflow does not fail when one provider is down. Apollo misses are reported as found:false and skipped rather than failing the run — enriching a list of fifty companies must not stop because Apollo has never heard of one of them.",
    category: "Revenue",
    domain: "marketing",
    // Apify to scrape, Apollo to enrich, Sheets to log.
    tier: "library",
    tags: ["apollo", "apify", "leads", "funding", "outreach", "b2b"],
    graph: {
      nodes: [
        {
          id: "weekly",
          type: "SCHEDULE_TRIGGER",
          name: "Weekly sweep",
          position: { x: 0, y: 0 },
          data: { cron: "0 8 * * 1", timezone: "UTC" },
        },
        {
          id: "scrape",
          type: "APIFY_RUN",
          name: "Newly funded companies",
          position: { x: 240, y: 0 },
          data: {
            variableName: "run",
            actorId: "REPLACE_WITH_FUNDING_ACTOR",
            input: '{"maxItems":50}',
            waitForFinish: true,
            maxWaitSeconds: 900,
          },
        },
        {
          id: "companies",
          type: "APIFY_GET_DATASET",
          name: "Read the companies",
          position: { x: 480, y: 0 },
          data: {
            variableName: "companies",
            datasetId: "{{run.datasetId}}",
            limit: 100,
            clean: true,
          },
        },
        {
          id: "shape",
          type: "CODE",
          name: "Normalise domains",
          position: { x: 720, y: 0 },
          data: {
            code: 'const rows = input.companies?.items ?? [];\n\n// Apollo matches on a bare domain. A homepage URL produces a confident\n// no-match rather than an error, so the normalisation happens here.\nconst domainOf = (value) =>\n  String(value ?? "")\n    .trim()\n    .toLowerCase()\n    .replace(/^https?:\\/\\//, "")\n    .replace(/^www\\./, "")\n    .replace(/\\/.*$/, "");\n\nreturn {\n  items: rows\n    .map((row) => ({\n      company: row.name ?? row.company ?? "",\n      domain: domainOf(row.website ?? row.domain),\n      raised: row.amount ?? row.raised ?? "",\n    }))\n    .filter((row) => row.domain.length > 0),\n};\n',
          },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One company at a time",
          position: { x: 960, y: 0 },
          data: { path: "items", maxItems: 50 },
        },
        {
          id: "enrich",
          type: "APOLLO_ENRICH",
          name: "Find a decision-maker",
          position: { x: 1200, y: 0 },
          data: {
            variableName: "org",
            mode: "organization",
            domain: "{{$item.domain}}",
          },
        },
        {
          id: "known",
          type: "CONDITION",
          name: "Apollo knows them?",
          position: { x: 1440, y: 0 },
          data: {
            left: "{{org.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "draft",
          type: "AI_LLM",
          name: "Draft the outreach",
          position: { x: 1680, y: -80 },
          data: {
            variableName: "draft",
            model: "openai:gpt-4o",
            fallbackModels: "anthropic:claude-3-5-sonnet,google:gemini-1.5-pro",
            systemPrompt:
              "You write cold emails that reference one specific, checkable fact. No flattery, no 'I hope this finds you well', under 120 words, one question at the end.",
            userPrompt:
              "Company: {{org.organization.name}} ({{$item.domain}})\nIndustry: {{org.organization.industry}}\nStaff: {{org.organization.employees}}\nRecently raised: {{$item.raised}}\n\nWrite the email.",
            temperature: 0.6,
            maxTokens: 500,
          },
        },
        {
          id: "log",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Log the lead",
          position: { x: 1920, y: -80 },
          data: {
            variableName: "logged",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Prospects",
            values:
              '{"Company": "{{org.organization.name}}", "Domain": "{{$item.domain}}", "Title": "{{org.organization.industry}}", "Draft": "{{draft.text}}"}',
          },
        },
        {
          id: "collected",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 2160, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "weekly", target: "scrape" },
        { source: "scrape", target: "companies" },
        { source: "companies", target: "shape" },
        { source: "shape", target: "each" },
        { source: "each", target: "enrich" },
        { source: "enrich", target: "known" },
        { source: "known", target: "draft", sourceHandle: "true" },
        { source: "draft", target: "log" },
        { source: "log", target: "collected" },
        { source: "known", target: "collected", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "cold-outreach-gemini",
    name: "Personalized cold emails written back to the sheet",
    description:
      "Reference automation #4. Reads leads from a Google Sheet, skips the ones already processed, generates a personalized email per lead from fields like company, industry and job title, and writes the subject and body back to the same row. Nothing is sent — the sheet is the output. PREREQUISITES: a Google Sheets credential and an AI provider key. The sheet needs lead columns (Name, Company, Industry, Title) and empty output columns (Subject, Email Body, Processed). DEVIATIONS FROM THE SOURCE: the source names Google Gemini specifically; this uses the registry's fallback chain, so the workflow survives one provider being unavailable. The source parses the model's output into a structured format with a separate parser node — this asks the model for the two fields directly and splits on a marker, which is one node fewer and one fewer place for the format to drift.",
    category: "Revenue",
    domain: "marketing",
    tags: ["outreach", "gemini", "sheets", "cold email", "personalization"],
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
          id: "leads",
          type: "SHEETS_READ",
          name: "Read the leads",
          position: { x: 260, y: 0 },
          data: {
            variableName: "sheet",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            range: "Leads!A:H",
            hasHeader: true,
            limit: 500,
          },
        },
        {
          id: "pending",
          type: "FILTER",
          name: "Skip processed rows",
          position: { x: 520, y: 0 },
          data: {
            variableName: "pending",
            items: "{{{json sheet.rows}}}",
            itemPath: "fields.Processed",
            operator: "is_empty",
          },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One lead at a time",
          position: { x: 780, y: 0 },
          data: { path: "pending.items", maxItems: 50 },
        },
        {
          id: "write",
          type: "AI_LLM",
          name: "Write the email",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "email",
            model: "google:gemini-1.5-pro",
            fallbackModels: "openai:gpt-4o,anthropic:claude-3-5-sonnet",
            systemPrompt:
              "You write cold emails. Output the subject line, then a line containing only ---, then the body. Under 120 words. No flattery and no 'quick question'.",
            userPrompt:
              "Name: {{$item.fields.Name}}\nCompany: {{$item.fields.Company}}\nIndustry: {{$item.fields.Industry}}\nTitle: {{$item.fields.Title}}",
            temperature: 0.7,
            maxTokens: 500,
          },
        },
        {
          id: "split-parts",
          type: "CODE",
          name: "Separate subject and body",
          position: { x: 1300, y: 0 },
          data: {
            code: 'const raw = String(input.email?.text ?? "");\nconst [first, ...rest] = raw.split(/^---$/m);\n\n// Falling back to the whole text rather than empty: a model that ignored\n// the separator should still produce something usable in the sheet.\nreturn {\n  subject: (first ?? raw).trim().slice(0, 200),\n  body: (rest.join("---") || raw).trim(),\n};\n',
          },
        },
        {
          id: "write-back",
          type: "SHEETS_UPDATE",
          name: "Write it back",
          position: { x: 1560, y: 0 },
          data: {
            variableName: "updated",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Leads",
            rowNumber: "{{$item.rowNumber}}",
            values:
              '{"Subject": "{{subject}}", "Email Body": "{{body}}", "Processed": "{{$now.iso}}"}',
          },
        },
        {
          id: "collected",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1820, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "hourly", target: "leads" },
        { source: "leads", target: "pending" },
        { source: "pending", target: "each" },
        { source: "each", target: "write" },
        { source: "write", target: "split-parts" },
        { source: "split-parts", target: "write-back" },
        { source: "write-back", target: "collected" },
      ],
    },
  },
  {
    slug: "linkedin-profile-research",
    name: "LinkedIn career research into an opening line",
    description:
      "Reference automation #5. Reads a shortlist of LinkedIn profile URLs from a Google Sheet, enriches each with career data through an Apify profile scraper, has a model read the career journey and write one specific opening line, and saves the subject and body back to the row. Built for a named shortlist rather than bulk scraping. PREREQUISITES: an Apify account supporting a LinkedIn Profile Scraper actor, a Google Sheets credential, and an AI provider key. The sheet needs the columns First Name, Last Name, LinkedIn, Profile Data, Subject, Email Body. DEVIATIONS FROM THE SOURCE: rows already carrying Profile Data are skipped, which the source does not do — an Apify run per row costs credits, and a scheduled sheet read that re-scrapes the same twenty profiles every hour is an expensive way to get the same answer. Scraping LinkedIn may breach its terms; that is the operator's call and the reason this reads a shortlist you supply rather than discovering profiles itself.",
    category: "Revenue",
    domain: "marketing",
    // Apify to enrich, Sheets to read and write back.
    tier: "library",
    tags: ["linkedin", "apify", "research", "sheets", "outreach", "sdr"],
    graph: {
      nodes: [
        {
          id: "daily",
          type: "SCHEDULE_TRIGGER",
          name: "Daily",
          position: { x: 0, y: 0 },
          data: { cron: "0 9 * * *", timezone: "UTC" },
        },
        {
          id: "shortlist",
          type: "SHEETS_READ",
          name: "Read the shortlist",
          position: { x: 260, y: 0 },
          data: {
            variableName: "sheet",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            range: "Profiles!A:F",
            hasHeader: true,
            limit: 200,
          },
        },
        {
          id: "unresearched",
          type: "FILTER",
          name: "Not yet researched",
          position: { x: 520, y: 0 },
          data: {
            variableName: "todo",
            items: "{{{json sheet.rows}}}",
            // An Apify run per row costs credits. Re-scraping a profile that
            // already has data is money for an answer we hold.
            itemPath: "fields.[Profile Data]",
            operator: "is_empty",
          },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One profile at a time",
          position: { x: 780, y: 0 },
          data: { path: "todo.items", maxItems: 20 },
        },
        {
          id: "scrape",
          type: "APIFY_RUN",
          name: "Scrape the profile",
          position: { x: 1040, y: 0 },
          data: {
            variableName: "run",
            actorId: "REPLACE_WITH_LINKEDIN_PROFILE_ACTOR",
            input: '{"profileUrls":["{{$item.fields.LinkedIn}}"]}',
            waitForFinish: true,
            maxWaitSeconds: 300,
          },
        },
        {
          id: "profile",
          type: "APIFY_GET_DATASET",
          name: "Read the career data",
          position: { x: 1300, y: 0 },
          data: {
            variableName: "profile",
            datasetId: "{{run.datasetId}}",
            limit: 1,
            clean: true,
          },
        },
        {
          id: "opening",
          type: "AI_LLM",
          name: "Write the opening line",
          position: { x: 1560, y: 0 },
          data: {
            variableName: "opening",
            model: "google:gemini-1.5-pro",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You read a career history and write ONE opening line that could only be written about this person. Reference a move, a span, or a change of direction — never a job title alone. Output the subject line, then a line containing only ---, then the opening line.",
            userPrompt:
              "{{$item.fields.[First Name]}} {{$item.fields.[Last Name]}}\n\nCareer data:\n{{{json profile.items}}}",
            temperature: 0.7,
            maxTokens: 400,
          },
        },
        {
          id: "parts",
          type: "CODE",
          name: "Separate the parts",
          position: { x: 1820, y: 0 },
          data: {
            code: 'const raw = String(input.opening?.text ?? "");\nconst [first, ...rest] = raw.split(/^---$/m);\n\nreturn {\n  subject: (first ?? raw).trim().slice(0, 200),\n  body: (rest.join("---") || raw).trim(),\n  // Stored so the skip filter above sees this row as done next run.\n  profileSummary: JSON.stringify(input.profile?.items ?? []).slice(0, 4000),\n};\n',
          },
        },
        {
          id: "write-back",
          type: "SHEETS_UPDATE",
          name: "Save to the row",
          position: { x: 2080, y: 0 },
          data: {
            variableName: "saved",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Profiles",
            rowNumber: "{{$item.rowNumber}}",
            values:
              '{"Profile Data": "{{profileSummary}}", "Subject": "{{subject}}", "Email Body": "{{body}}"}',
          },
        },
        {
          id: "collected",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 2340, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "daily", target: "shortlist" },
        { source: "shortlist", target: "unresearched" },
        { source: "unresearched", target: "each" },
        { source: "each", target: "scrape" },
        { source: "scrape", target: "profile" },
        { source: "profile", target: "opening" },
        { source: "opening", target: "parts" },
        { source: "parts", target: "write-back" },
        { source: "write-back", target: "collected" },
      ],
    },
  },
  {
    slug: "lead-gen-google-search-maps",
    name: "Local lead lists from Google Search and Maps",
    description:
      'Reference automation #6. Takes a query like "dentists in Leeds", searches Google and Google Maps for matching businesses, visits each website for contact details, and appends deduplicated leads to a Google Sheet. PREREQUISITES: a Google Cloud project with the Custom Search JSON API enabled, a Programmable Search Engine id (the cx value, which lives on the credential rather than in node config), a Google Maps Platform key with the Places API enabled — a Custom Search key is refused by Places, so these are two credentials — and a Google Sheets credential. The sheet needs Business Name, Email, Phone, URL, Description, Socials, Search Query. DEVIATIONS FROM THE SOURCE: the source is triggered from a chat interface; this uses a hosted form, because that is the equivalent this product ships. Both APIs are metered — Custom Search gives 100 free queries a day and Places bills every request — so the result caps are deliberate and the run reports how many queries it spent.',
    category: "Revenue",
    domain: "marketing",
    // Custom Search, Places and Sheets. Three keys, three enablements.
    tier: "library",
    tags: ["google", "maps", "search", "leads", "local", "sheets"],
    graph: {
      nodes: [
        {
          id: "query",
          type: "FORM_TRIGGER",
          name: "What are you looking for?",
          position: { x: 0, y: 0 },
          data: {
            title: "Build a local lead list",
            description:
              'Describe the businesses you want, e.g. "dentists in Leeds".',
            submitLabel: "Find them",
            successMessage: "Searching — results will appear in your sheet.",
            fields: [
              {
                name: "trade",
                label: "Type of business",
                type: "text",
                required: true,
              },
              {
                name: "place",
                label: "Where?",
                type: "text",
                required: true,
              },
            ],
          },
        },
        {
          id: "places",
          type: "GOOGLE_MAPS_SEARCH",
          name: "Search Maps",
          position: { x: 280, y: -80 },
          data: {
            variableName: "places",
            query: "{{form.fields.trade}}",
            region: "{{form.fields.place}}",
            limit: 40,
            // Billed on a higher tier, and the point of a lead list.
            includeContactDetails: true,
          },
        },
        {
          id: "web",
          type: "GOOGLE_SEARCH",
          name: "Search the web",
          position: { x: 280, y: 120 },
          data: {
            variableName: "web",
            query: "{{form.fields.trade}} {{form.fields.place}} contact",
            limit: 20,
          },
        },
        {
          id: "merge",
          type: "CODE",
          name: "Merge and dedupe",
          position: { x: 560, y: 0 },
          data: {
            code: 'const places = input.places?.places ?? [];\nconst web = input.web?.results ?? [];\n\nconst host = (url) => {\n  try {\n    return new URL(url).hostname.replace(/^www\\./, "").toLowerCase();\n  } catch {\n    return "";\n  }\n};\n\n// Maps entries win: they carry a phone and an address the web result does\n// not. The web results only add businesses Maps did not return.\nconst byHost = new Map();\n\nfor (const place of places) {\n  const key = host(place.website ?? "") || place.name;\n  if (!key) continue;\n  byHost.set(key, {\n    name: place.name,\n    url: place.website ?? "",\n    phone: place.phone ?? "",\n    description: place.address ?? "",\n    rating: place.rating ?? null,\n  });\n}\n\nfor (const result of web) {\n  const key = host(result.link);\n  if (!key || byHost.has(key)) continue;\n  byHost.set(key, {\n    name: result.title,\n    url: result.link,\n    phone: "",\n    description: result.snippet,\n    rating: null,\n  });\n}\n\nreturn {\n  items: [...byHost.values()],\n  fromMaps: places.length,\n  fromWeb: web.length,\n  queriesUsed: input.web?.queriesUsed ?? 0,\n};\n',
          },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One business at a time",
          position: { x: 840, y: 0 },
          data: { path: "items", maxItems: 50 },
        },
        {
          id: "site",
          type: "HTTP_REQUEST",
          name: "Fetch the website",
          position: { x: 1100, y: 0 },
          data: {
            variableName: "page",
            endpoint: "{{$item.url}}",
            method: "GET",
            // A business site that is down is not a reason to fail the run;
            // the row is still worth keeping without an email.
            failOnNon2xx: false,
            timeoutMs: 15000,
          },
        },
        {
          id: "contacts",
          type: "CODE",
          name: "Parse contact details",
          position: { x: 1360, y: 0 },
          data: {
            code: 'const html = String(input.page?.httpResponse?.data ?? "");\n\nconst emails = [\n  ...new Set(\n    (html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g) ?? [])\n      .map((e) => e.toLowerCase())\n      // Image filenames and tracking pixels match the pattern too.\n      .filter((e) => !/\\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e)),\n  ),\n];\n\nconst socials = [\n  ...new Set(\n    (html.match(/https?:\\/\\/(www\\.)?(linkedin|facebook|instagram|x|twitter)\\.com\\/[^"\'\\s<>]+/gi) ?? []).slice(0, 5),\n  ),\n];\n\nreturn {\n  email: emails[0] ?? "",\n  socials: socials.join(", "),\n};\n',
          },
        },
        {
          id: "append",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Add the lead",
          position: { x: 1620, y: 0 },
          data: {
            variableName: "appended",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Leads",
            values:
              '{"Business Name": "{{$item.name}}", "Email": "{{email}}", "Phone": "{{$item.phone}}", "URL": "{{$item.url}}", "Description": "{{$item.description}}", "Socials": "{{socials}}", "Search Query": "{{form.fields.trade}} {{form.fields.place}}"}',
          },
        },
        {
          id: "collected",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 1880, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "query", target: "places" },
        { source: "query", target: "web" },
        { source: "places", target: "merge" },
        { source: "web", target: "merge" },
        { source: "merge", target: "each" },
        { source: "each", target: "site" },
        { source: "site", target: "contacts" },
        { source: "contacts", target: "append" },
        { source: "append", target: "collected" },
      ],
    },
  },
  {
    slug: "outreach-from-job-signals",
    name: "Prospect off hiring signals, not cold lists",
    description:
      "Reference automation #7. Scrapes LinkedIn job postings for a target role with Apify, filters them into a target-account list, finds a decision-maker at each company through Apollo, and drafts a cold email that references the specific opening. Results go to a Google Sheet as a ready-to-send list; nothing is emailed. PREREQUISITES: an Apify account with a LinkedIn Jobs Scraper actor configured, Apollo.io API credentials, a Google Sheets credential with a spreadsheet id, and an AI provider key. DEVIATIONS FROM THE SOURCE: the source filters by company size and industry from the scrape results; Apify actors differ in which of those they return, so the filter here is on company name being present and the size check moved to after Apollo enrichment, where the number is reliable. Apollo misses are skipped rather than failing the run — a fifty-company list must not stop at the first unknown.",
    category: "Revenue",
    domain: "marketing",
    // Apify to scrape, Apollo to enrich, Sheets to log.
    tier: "library",
    tags: ["hiring", "apify", "apollo", "signals", "outreach", "recruiting"],
    graph: {
      nodes: [
        {
          id: "weekly",
          type: "SCHEDULE_TRIGGER",
          name: "Weekly",
          position: { x: 0, y: 0 },
          data: { cron: "0 8 * * 2", timezone: "UTC" },
        },
        {
          id: "jobs",
          type: "APIFY_RUN",
          name: "Scrape job postings",
          position: { x: 240, y: 0 },
          data: {
            variableName: "run",
            actorId: "REPLACE_WITH_LINKEDIN_JOBS_ACTOR",
            input:
              '{"title":"ML Engineer","location":"United Kingdom","maxItems":50}',
            waitForFinish: true,
            maxWaitSeconds: 900,
          },
        },
        {
          id: "postings",
          type: "APIFY_GET_DATASET",
          name: "Read the postings",
          position: { x: 480, y: 0 },
          data: {
            variableName: "postings",
            datasetId: "{{run.datasetId}}",
            limit: 100,
            clean: true,
          },
        },
        {
          id: "accounts",
          type: "CODE",
          name: "Build the account list",
          position: { x: 720, y: 0 },
          data: {
            code: 'const postings = input.postings?.items ?? [];\n\nconst domainOf = (value) =>\n  String(value ?? "")\n    .trim()\n    .toLowerCase()\n    .replace(/^https?:\\/\\//, "")\n    .replace(/^www\\./, "")\n    .replace(/\\/.*$/, "");\n\n// One row per COMPANY, not per posting: three openings at the same firm is\n// one conversation, and three emails is a complaint.\nconst byCompany = new Map();\n\nfor (const job of postings) {\n  const company = job.companyName ?? job.company ?? "";\n  if (!company) continue;\n  if (byCompany.has(company)) continue;\n  byCompany.set(company, {\n    company,\n    domain: domainOf(job.companyWebsite ?? job.companyUrl),\n    role: job.title ?? "",\n    jobUrl: job.url ?? "",\n  });\n}\n\nreturn { items: [...byCompany.values()] };\n',
          },
        },
        {
          id: "each",
          type: "SPLIT_OUT",
          name: "One company at a time",
          position: { x: 960, y: 0 },
          data: { path: "items", maxItems: 40 },
        },
        {
          id: "contact",
          type: "APOLLO_ENRICH",
          name: "Find the hiring manager",
          position: { x: 1200, y: 0 },
          data: {
            variableName: "person",
            mode: "organization",
            domain: "{{$item.domain}}",
          },
        },
        {
          id: "found",
          type: "CONDITION",
          name: "Apollo knows them?",
          position: { x: 1440, y: 0 },
          data: {
            left: "{{person.found}}",
            operator: "equals",
            right: "true",
          },
        },
        {
          id: "draft",
          type: "AI_LLM",
          name: "Draft against the opening",
          position: { x: 1680, y: -80 },
          data: {
            variableName: "draft",
            model: "google:gemini-1.5-pro",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              "You write cold emails that open on a hiring signal. Reference the specific role and why it implies a need. Never say 'I noticed you're hiring' — say what the hire implies. Under 120 words.",
            userPrompt:
              "Company: {{person.organization.name}}\nIndustry: {{person.organization.industry}}\nStaff: {{person.organization.employees}}\nOpen role: {{$item.role}}\nPosting: {{$item.jobUrl}}",
            temperature: 0.6,
            maxTokens: 500,
          },
        },
        {
          id: "log",
          type: "GOOGLE_SHEETS_APPEND",
          name: "Add to the list",
          position: { x: 1920, y: -80 },
          data: {
            variableName: "logged",
            spreadsheetId: "REPLACE_WITH_SPREADSHEET_ID",
            sheetName: "Signals",
            values:
              '{"Company": "{{person.organization.name}}", "Role": "{{$item.role}}", "Posting": "{{$item.jobUrl}}", "Staff": "{{person.organization.employees}}", "Draft": "{{draft.text}}"}',
          },
        },
        {
          id: "collected",
          type: "AGGREGATE",
          name: "Collect",
          position: { x: 2160, y: 0 },
          data: {},
        },
      ],
      edges: [
        { source: "weekly", target: "jobs" },
        { source: "jobs", target: "postings" },
        { source: "postings", target: "accounts" },
        { source: "accounts", target: "each" },
        { source: "each", target: "contact" },
        { source: "contact", target: "found" },
        { source: "found", target: "draft", sourceHandle: "true" },
        { source: "draft", target: "log" },
        { source: "log", target: "collected" },
        { source: "found", target: "collected", sourceHandle: "false" },
      ],
    },
  },
];
