import type { TemplateSpec } from "./types";

/**
 * Support-domain templates (AF-M7-02).
 *
 * Four `Support` gallery entries plus the retrieval-grounded answer agent,
 * which the gallery files under `AI agents` but which support teams own.
 */
export const supportTemplates: TemplateSpec[] = [
  {
    slug: "support-ticket-triage",
    name: "Support ticket triage",
    description:
      "Classifies every inbound ticket for category, severity, and customer sentiment, then routes urgent ones to your on-call channel and everything else to the normal queue.",
    category: "Support",
    domain: "support",
    tags: ["support", "triage", "ai", "slack", "routing"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "ticket",
          type: "WEBHOOK_TRIGGER",
          name: "Ticket received",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "classify",
          type: "AI_EXTRACT",
          name: "Classify the ticket",
          position: { x: 260, y: 0 },
          data: {
            variableName: "triage",
            model: "openai:gpt-4o-mini",
            fallbackModels: "google:gemini-1.5-flash",
            content:
              "Subject: {{webhook.body.subject}}\n\nBody:\n{{webhook.body.message}}\n\nFrom: {{webhook.body.email}}",
            fields: [
              {
                name: "category",
                type: "string",
                description:
                  "One of: billing, bug, how_to, feature_request, other.",
              },
              {
                name: "severity",
                type: "string",
                description:
                  "One of: urgent, high, normal, low. Use urgent only for outages or data loss.",
              },
              {
                name: "sentiment",
                type: "string",
                description: "One of: angry, frustrated, neutral, happy.",
              },
              {
                name: "summary",
                type: "string",
                description: "The ask in one sentence.",
              },
            ],
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "is-urgent",
          type: "CONDITION",
          name: "Urgent?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{triage.severity}}",
            operator: "equals",
            right: "urgent",
          },
        },
        {
          id: "page-oncall",
          type: "SLACK_POST",
          name: "Page on-call",
          position: { x: 800, y: -90 },
          data: {
            variableName: "pageOncall",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":rotating_light: *Urgent ticket* ({{triage.category}}, customer sounds {{triage.sentiment}})\n{{triage.summary}}\n\nFrom: {{webhook.body.email}}",
          },
        },
        {
          id: "queue",
          type: "SLACK_POST",
          name: "Add to the queue",
          position: { x: 800, y: 90 },
          data: {
            variableName: "queuePost",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "[{{triage.severity}}/{{triage.category}}] {{triage.summary}} — {{webhook.body.email}}",
          },
        },
      ],
      edges: [
        { source: "ticket", target: "classify" },
        { source: "classify", target: "is-urgent" },
        { source: "is-urgent", target: "page-oncall", sourceHandle: "true" },
        { source: "is-urgent", target: "queue", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "kb-answer-draft",
    name: "Knowledge-base answer draft",
    description:
      "Searches your knowledge base for passages that actually address the question, drafts a reply grounded in them with citations, and posts the draft back to your helpdesk for an agent to approve.",
    category: "Support",
    domain: "support",
    tags: ["rag", "knowledge", "draft", "support", "ai"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "question",
          type: "WEBHOOK_TRIGGER",
          name: "Question received",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "retrieve",
          type: "AI_RETRIEVE",
          name: "Search the knowledge base",
          position: { x: 260, y: 0 },
          data: {
            variableName: "kb",
            query: "{{webhook.body.question}}",
            topK: 5,
            minSimilarity: 0.5,
          },
        },
        {
          id: "draft",
          type: "AI_LLM",
          name: "Draft the answer",
          position: { x: 520, y: 0 },
          data: {
            variableName: "answer",
            model: "anthropic:claude-3-5-haiku",
            fallbackModels: "openai:gpt-4o-mini",
            systemPrompt:
              "Answer only from the supplied context. If the context does not contain the answer, say so plainly and suggest what the agent should check — never guess.",
            userPrompt:
              "Question: {{webhook.body.question}}\n\nContext:\n{{kb.context}}\n\nWrite the reply, then list the sources you used.",
            temperature: 0.2,
            maxTokens: 800,
            cacheTtlSeconds: 86400,
          },
        },
        {
          id: "post-draft",
          type: "WEBHOOK_OUT",
          name: "Post the draft back",
          position: { x: 780, y: 0 },
          data: {
            variableName: "draftPosted",
            url: "https://helpdesk.example.com/api/tickets/{{webhook.body.ticketId}}/draft",
            headers: { "Content-Type": "application/json" },
            body: '{"draft":"{{answer.text}}","citations":"{{kb.citations}}","status":"needs_review"}',
            timeoutMs: 10000,
          },
        },
      ],
      edges: [
        { source: "question", target: "retrieve" },
        { source: "retrieve", target: "draft" },
        { source: "draft", target: "post-draft" },
      ],
    },
  },
  {
    slug: "csat-followup-email",
    name: "CSAT follow-up email",
    description:
      "Each afternoon it pulls the tickets you resolved that day, writes a follow-up that references what was actually fixed, and emails it to the customer.",
    category: "Support",
    domain: "support",
    tags: ["csat", "email", "followup", "schedule", "ai"],
    graph: {
      nodes: [
        {
          id: "daily",
          type: "SCHEDULE_TRIGGER",
          name: "Weekdays 17:00",
          position: { x: 0, y: 0 },
          data: { cron: "0 17 * * 1-5", timezone: "UTC" },
        },
        {
          id: "fetch-resolved",
          type: "HTTP_REQUEST",
          name: "Fetch resolved tickets",
          position: { x: 260, y: 0 },
          data: {
            variableName: "resolved",
            endpoint: "https://helpdesk.example.com/api/tickets",
            method: "GET",
            queryParams: { status: "resolved", resolved_since: "24h" },
            timeoutMs: 20000,
            failOnNon2xx: true,
          },
        },
        {
          id: "write-followup",
          type: "AI_LLM",
          name: "Write the follow-up",
          position: { x: 520, y: 0 },
          data: {
            variableName: "followup",
            model: "openai:gpt-4o-mini",
            systemPrompt:
              "You write short, specific customer follow-ups. Reference the actual fix. No marketing language, no more than 120 words.",
            userPrompt:
              "These tickets were resolved today:\n\n{{resolved.httpResponse.data}}\n\nWrite one follow-up email body that thanks the customer, names what was fixed, and asks for a one-to-five rating.",
            temperature: 0.5,
            maxTokens: 500,
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "send",
          type: "EMAIL_SEND",
          name: "Send the follow-up",
          position: { x: 780, y: 0 },
          data: {
            variableName: "followupSent",
            from: "support@example.com",
            fromName: "Support",
            to: "{{resolved.httpResponse.data.0.requesterEmail}}",
            subject: "How did we do?",
            body: "{{followup.text}}",
          },
        },
      ],
      edges: [
        { source: "daily", target: "fetch-resolved" },
        { source: "fetch-resolved", target: "write-followup" },
        { source: "write-followup", target: "send" },
      ],
    },
  },
  {
    slug: "escalation-daily-digest",
    name: "Escalation daily digest",
    description:
      "Queries your ticket database for everything still open past its SLA, has a model group the escalations by root cause, and posts one digest instead of thirty alerts.",
    category: "Support",
    domain: "support",
    // AI provider plus Slack — the digest is written and then posted.
    tier: "library",
    tags: ["escalation", "postgres", "digest", "slack", "sla"],
    graph: {
      nodes: [
        {
          id: "morning",
          type: "SCHEDULE_TRIGGER",
          name: "Daily 09:00",
          position: { x: 0, y: 0 },
          data: { cron: "0 9 * * *", timezone: "UTC" },
        },
        {
          id: "query",
          type: "POSTGRES_QUERY",
          name: "Open escalations",
          position: { x: 260, y: 0 },
          data: {
            variableName: "escalations",
            query:
              "SELECT id, subject, customer, priority, opened_at FROM tickets WHERE status = 'open' AND opened_at < now() - ($1)::interval ORDER BY opened_at ASC LIMIT 100",
            params: '["24 hours"]',
          },
        },
        {
          id: "group",
          type: "AI_LLM",
          name: "Group by root cause",
          position: { x: 520, y: 0 },
          data: {
            variableName: "digest",
            model: "openai:gpt-4o-mini",
            fallbackModels: "groq:llama-3.3-70b-versatile",
            systemPrompt:
              "You cluster support escalations by underlying cause. Report only clusters the data supports.",
            userPrompt:
              "Open escalations past SLA:\n\n{{escalations.rows}}\n\nGroup them by likely root cause, biggest cluster first, with the ticket count per cluster and the single oldest ticket in each.",
            temperature: 0.2,
            maxTokens: 900,
            cacheTtlSeconds: 0,
          },
        },
        {
          id: "post",
          type: "SLACK_POST",
          name: "Post the digest",
          position: { x: 780, y: 0 },
          data: {
            variableName: "digestPost",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "*Escalations past SLA — {{escalations.rowCount}} open*\n\n{{digest.text}}",
          },
        },
      ],
      edges: [
        { source: "morning", target: "query" },
        { source: "query", target: "group" },
        { source: "group", target: "post" },
      ],
    },
  },
  {
    slug: "rag-support-agent",
    name: "Grounded support agent",
    description:
      "A retrieval-first agent: it searches your knowledge base, answers only from what it found, and when the base does not cover the question it hands off to a human instead of guessing.",
    category: "AI agents",
    domain: "support",
    tags: ["agent", "rag", "handoff", "knowledge", "ai"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "ask",
          type: "WEBHOOK_TRIGGER",
          name: "Question asked",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "retrieve",
          type: "AI_RETRIEVE",
          name: "Retrieve context",
          position: { x: 240, y: 0 },
          data: {
            variableName: "kb",
            query: "{{webhook.body.question}}",
            topK: 6,
            minSimilarity: 0.6,
          },
        },
        {
          id: "answer",
          type: "AI_LLM",
          name: "Answer from context",
          position: { x: 480, y: 0 },
          data: {
            variableName: "agent",
            model: "anthropic:claude-3-5-sonnet",
            fallbackModels: "openai:gpt-4o",
            systemPrompt:
              'Answer strictly from the context. If it is insufficient, reply with exactly "HANDOFF" and nothing else.',
            userPrompt:
              "Question: {{webhook.body.question}}\n\nContext:\n{{kb.context}}",
            temperature: 0.1,
            maxTokens: 700,
            cacheTtlSeconds: 86400,
          },
        },
        {
          id: "needs-human",
          type: "CONDITION",
          name: "Needs a human?",
          position: { x: 720, y: 0 },
          data: {
            left: "{{agent.text}}",
            operator: "contains",
            right: "HANDOFF",
          },
        },
        {
          id: "escalate",
          type: "SLACK_POST",
          name: "Hand off to an agent",
          position: { x: 1000, y: -90 },
          data: {
            variableName: "handoff",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":raising_hand: *Knowledge base did not cover this*\n> {{webhook.body.question}}\n\nMatches found: {{kb.count}}",
          },
        },
        {
          id: "reply",
          type: "WEBHOOK_OUT",
          name: "Send the answer",
          position: { x: 1000, y: 90 },
          data: {
            variableName: "replied",
            url: "https://helpdesk.example.com/api/conversations/{{webhook.body.conversationId}}/reply",
            headers: { "Content-Type": "application/json" },
            body: '{"body":"{{agent.text}}","citations":"{{kb.citations}}"}',
            timeoutMs: 10000,
          },
        },
      ],
      edges: [
        { source: "ask", target: "retrieve" },
        { source: "retrieve", target: "answer" },
        { source: "answer", target: "needs-human" },
        { source: "needs-human", target: "escalate", sourceHandle: "true" },
        { source: "needs-human", target: "reply", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "intake-form-triage-and-route",
    name: "Intake form, triaged and routed",
    description:
      "Publishes a hosted intake form, has a model classify each submission by urgency and topic, and routes it — urgent to Slack immediately, everything else to a digest channel. The form is public at a stable URL and needs no Google account, no Apps Script and no embed: authored fields become a real page. Attachments arrive as file references, so a 9 MB screenshot moves through the workflow without touching the run payload. Supply an AI credential and a Slack incoming-webhook URL; publish the workflow and the form goes live at its URL.",
    category: "Support",
    domain: "support",
    tags: ["form", "intake", "triage", "routing", "slack", "support"],
    featured: true,
    graph: {
      nodes: [
        {
          id: "intake",
          type: "FORM_TRIGGER",
          name: "Support request",
          position: { x: 0, y: 0 },
          data: {
            title: "Contact support",
            description:
              "Tell us what went wrong. We reply to every request within one business day.",
            submitLabel: "Send request",
            successMessage:
              "Thanks — we have your request and will be in touch shortly.",
            fields: [
              {
                name: "email",
                label: "Your email",
                type: "email",
                required: true,
                placeholder: "you@company.com",
              },
              {
                name: "topic",
                label: "What is this about?",
                type: "select",
                required: true,
                options: "Billing\nBug report\nAccount access\nSomething else",
              },
              {
                name: "summary",
                label: "What happened?",
                type: "textarea",
                required: true,
                maxLength: 5000,
                help: "Include what you expected and what you saw instead.",
              },
              {
                name: "screenshot",
                label: "Screenshot (optional)",
                type: "file",
                help: "PNG, JPEG or PDF, up to 10 MB.",
              },
            ],
          },
        },
        {
          id: "triage",
          type: "AI_EXTRACT",
          name: "Classify it",
          position: { x: 280, y: 0 },
          data: {
            variableName: "triage",
            model: "openai:gpt-4o-mini",
            fallbackModels: "anthropic:claude-3-5-haiku",
            content:
              "Topic: {{form.fields.topic}}\nFrom: {{form.fields.email}}\n\n{{form.fields.summary}}",
            fields: [
              {
                name: "urgency",
                type: "string",
                description:
                  "One of: urgent, normal. Urgent means the customer is blocked right now or money is at stake.",
              },
              {
                name: "one_line",
                type: "string",
                description: "One sentence a support lead can triage from.",
              },
            ],
          },
        },
        {
          id: "is-urgent",
          type: "CONDITION",
          name: "Urgent?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{triage.urgency}}",
            operator: "equals",
            right: "urgent",
          },
        },
        {
          id: "page-oncall",
          type: "SLACK_POST",
          name: "Page on-call",
          position: { x: 840, y: -80 },
          data: {
            variableName: "paged",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: ":rotating_light: *Urgent support request* — {{triage.one_line}}\n*From:* {{form.fields.email}} · *Topic:* {{form.fields.topic}}",
          },
        },
        {
          id: "queue-it",
          type: "SLACK_POST",
          name: "Add to the queue",
          position: { x: 840, y: 80 },
          data: {
            variableName: "queued",
            channel: "REPLACE_WITH_CHANNEL_ID",
            text: "New request — {{triage.one_line}}\n*From:* {{form.fields.email}} · *Topic:* {{form.fields.topic}}",
          },
        },
      ],
      edges: [
        { source: "intake", target: "triage" },
        { source: "triage", target: "is-urgent" },
        { source: "is-urgent", sourceHandle: "true", target: "page-oncall" },
        { source: "is-urgent", sourceHandle: "false", target: "queue-it" },
      ],
    },
  },
  {
    slug: "inbox-triage-auto-reply",
    name: "Inbox triage with an acknowledgement",
    description:
      "Watches a Gmail mailbox for unread mail matching a search, classifies each message, and replies in the same thread to acknowledge it. Mail already sitting unread when you publish is not replayed — the trigger records where the mailbox was and starts from there, so switching this on does not send two hundred acknowledgements. The reply threads correctly rather than starting a new conversation. Narrow the search to the addresses you actually want handled before you publish; `is:unread` alone means your whole inbox. Supply a Gmail credential and an AI credential.",
    category: "Support",
    domain: "support",
    tags: ["gmail", "triage", "inbox", "auto-reply", "trigger", "classify"],
    graph: {
      nodes: [
        {
          id: "new-mail",
          type: "GMAIL_TRIGGER",
          name: "New support mail",
          position: { x: 0, y: 0 },
          data: {
            query: "is:unread to:support@example.com",
            pollIntervalSeconds: 300,
          },
        },
        {
          id: "classify",
          type: "AI_EXTRACT",
          name: "Classify it",
          position: { x: 300, y: 0 },
          data: {
            variableName: "triage",
            model: "openai:gpt-4o-mini",
            fallbackModels: "anthropic:claude-3-5-haiku",
            content:
              "From: {{message.from}}\nSubject: {{message.subject}}\n\n{{message.body}}",
            fields: [
              {
                name: "category",
                type: "string",
                description:
                  "One of: billing, bug, account, other. Lower case, one word.",
              },
              {
                name: "one_line",
                type: "string",
                description: "One sentence a support lead can triage from.",
              },
            ],
          },
        },
        {
          id: "acknowledge",
          type: "GMAIL_SEND",
          name: "Acknowledge in-thread",
          position: { x: 600, y: 0 },
          data: {
            variableName: "replied",
            from: "support@example.com",
            to: "{{message.from}}",
            subject: "Re: {{message.subject}}",
            // Threading, so the reply lands in the conversation rather than
            // starting a second one the sender has to reconcile.
            threadId: "{{message.threadId}}",
            html: "<p>Thanks — we have your message and have logged it under <strong>{{triage.category}}</strong>.</p><p>Summary we recorded: {{triage.one_line}}</p>",
          },
        },
      ],
      edges: [
        { source: "new-mail", target: "classify" },
        { source: "classify", target: "acknowledge" },
      ],
    },
  },
  {
    slug: "idempotent-webhook-receiver",
    name: "A webhook that ignores replays",
    description:
      "Accepts a webhook, remembers the delivery id it has already seen, and answers a repeat delivery with 200 without doing the work twice. Almost every provider retries on a timeout or a non-2xx, so any endpoint that does something real — charging a card, creating a ticket, sending mail — will eventually be asked to do it twice. Answering 200 rather than an error is deliberate: a retry is not a failure, and returning 4xx makes some providers keep retrying or disable the endpoint. Set the key to whatever the sender uses as its delivery id. Nothing to connect.",
    category: "Support",
    domain: "support",
    tags: ["webhook", "idempotent", "dedupe", "retry", "replay", "endpoint"],
    graph: {
      nodes: [
        {
          id: "delivery",
          type: "WEBHOOK_TRIGGER",
          name: "Incoming delivery",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "seen",
          type: "DEDUPE",
          name: "Seen this delivery?",
          position: { x: 280, y: 0 },
          data: {
            variableName: "dedupe",
            // The provider's own delivery id. Hashing the whole body instead
            // would treat a legitimate identical-looking event as a replay.
            key: "{{webhook.body.id}}",
            mode: "window",
            windowSize: 5000,
          },
        },
        {
          id: "fresh",
          type: "CONDITION",
          name: "First time?",
          position: { x: 560, y: 0 },
          data: {
            left: "{{dedupe.duplicate}}",
            operator: "equals",
            right: "false",
          },
        },
        {
          id: "work",
          type: "CODE",
          name: "Do the work once",
          position: { x: 840, y: -100 },
          data: {
            code: 'const body = input.webhook?.body ?? {};\n\n// Replace this with the side effect that must not happen twice.\nreturn {\n  handled: true,\n  deliveryId: String(body.id ?? ""),\n  summary: `Processed ${body.type ?? "event"}`,\n};\n',
          },
        },
        {
          id: "ack",
          type: "RESPOND_TO_WEBHOOK",
          name: "200 Processed",
          position: { x: 1120, y: -100 },
          data: {
            statusCode: 200,
            contentType: "application/json",
            body: '{"status":"processed","summary":"{{summary}}"}',
          },
        },
        {
          id: "ack-replay",
          type: "RESPOND_TO_WEBHOOK",
          name: "200 Already handled",
          position: { x: 840, y: 100 },
          data: {
            // 200, not 409. A retry is the sender doing the right thing, and
            // an error status makes several providers retry harder or shut
            // the endpoint off.
            statusCode: 200,
            contentType: "application/json",
            body: '{"status":"duplicate","note":"already processed"}',
          },
        },
      ],
      edges: [
        { source: "delivery", target: "seen" },
        { source: "seen", target: "fresh" },
        { source: "fresh", target: "work", sourceHandle: "true" },
        { source: "work", target: "ack" },
        { source: "fresh", target: "ack-replay", sourceHandle: "false" },
      ],
    },
  },
  {
    slug: "jira-sprint-report-attached",
    name: "Sprint report, filed back into Jira",
    description:
      "Runs a JQL search at the end of each sprint, renders the result as a PDF, files a report issue, and attaches the PDF to it — so the report lives where the work does rather than in someone's downloads folder. Only named fields are fetched from Jira, because the default response carries every custom field on every issue and a mature site makes that tens of kilobytes a row. Only an Atlassian credential is needed.",
    category: "Ops",
    domain: "support",
    tags: ["jira", "sprint", "report", "jql", "pdf", "attachment"],
    graph: {
      nodes: [
        {
          id: "sprint-end",
          type: "SCHEDULE_TRIGGER",
          name: "Every other Friday",
          position: { x: 0, y: 0 },
          data: { cron: "0 17 * * 5", timezone: "UTC" },
        },
        {
          id: "done",
          type: "JIRA_SEARCH",
          name: "What closed this sprint",
          position: { x: 280, y: 0 },
          data: {
            variableName: "closed",
            jql: "project = REPLACE_WITH_PROJECT_KEY AND status changed to Done during (-14d, now()) ORDER BY updated DESC",
            limit: 200,
          },
        },
        {
          id: "html",
          type: "CODE",
          name: "Build the report",
          position: { x: 560, y: 0 },
          data: {
            code: 'const issues = input.closed?.issues ?? [];\n\nconst rows = issues\n  .map(\n    (i) =>\n      `<tr><td>${i.key}</td><td>${i.summary}</td><td>${i.assignee ?? "Unassigned"}</td></tr>`,\n  )\n  .join("");\n\nreturn {\n  issueCount: issues.length,\n  reportHtml: `<html><body><h1>Sprint report</h1><p>${issues.length} issues closed.</p><table border="1" cellpadding="6"><tr><th>Key</th><th>Summary</th><th>Assignee</th></tr>${rows}</table></body></html>`,\n};\n',
          },
        },
        {
          id: "pdf",
          type: "HTML_TO_PDF",
          name: "Render the PDF",
          position: { x: 840, y: 0 },
          data: {
            variableName: "report",
            html: "{{reportHtml}}",
            filename: "sprint-report.pdf",
            pageSize: "A4",
            orientation: "portrait",
          },
        },
        {
          id: "issue",
          type: "JIRA_CREATE_ISSUE",
          name: "File the report issue",
          position: { x: 1120, y: 0 },
          data: {
            variableName: "reportIssue",
            projectKey: "REPLACE_WITH_PROJECT_KEY",
            issueType: "Task",
            summary: "Sprint report — {{$now.date}}",
            description:
              "{{issueCount}} issues closed this sprint. The full report is attached.",
            labels: "sprint-report",
          },
        },
        {
          id: "attach",
          type: "JIRA_ADD_ATTACHMENT",
          name: "Attach the PDF",
          position: { x: 1400, y: 0 },
          data: {
            variableName: "attached",
            issueKey: "{{reportIssue.key}}",
            // Three braces: the file reference is an object, and two braces
            // would HTML-escape it into something unparseable.
            fileRef: "{{{json report.file}}}",
          },
        },
      ],
      edges: [
        { source: "sprint-end", target: "done" },
        { source: "done", target: "html" },
        { source: "html", target: "pdf" },
        { source: "pdf", target: "issue" },
        { source: "issue", target: "attach" },
      ],
    },
  },
  {
    slug: "form-to-pdf-receipt",
    name: "Turn a form submission into a PDF",
    description:
      "Publishes a form, and renders every submission as a tidy PDF you can archive, print or attach downstream. Useful for expense claims, sign-off sheets, incident reports — anywhere a submission needs to become a document rather than a database row. Values are escaped before they reach the HTML, because a name with an ampersand in it should not be able to break the layout. Nothing to connect; add a Drive, Jira or email node on the end when you want it delivered somewhere.",
    category: "Ops",
    domain: "support",
    tags: ["form", "pdf", "receipt", "document", "render", "archive"],
    graph: {
      nodes: [
        {
          id: "submission",
          type: "FORM_TRIGGER",
          name: "Expense claim",
          position: { x: 0, y: 0 },
          data: {
            title: "Submit an expense claim",
            description:
              "Fill this in and a PDF receipt is generated for your records.",
            submitLabel: "Submit claim",
            successMessage: "Received. Your receipt is being generated.",
            fields: [
              {
                name: "claimant",
                label: "Your name",
                type: "text",
                required: true,
              },
              {
                name: "email",
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
                name: "purpose",
                label: "What was it for?",
                type: "textarea",
                required: true,
                maxLength: 2000,
              },
            ],
          },
        },
        {
          id: "render",
          type: "CODE",
          name: "Build the document",
          position: { x: 300, y: 0 },
          data: {
            code: 'const f = input.form?.fields ?? {};\n\n// Escaped before it reaches the HTML: a name containing & or < would\n// otherwise break the layout, and worse in any renderer that follows.\nconst esc = (v) =>\n  String(v ?? "")\n    .replace(/&/g, "&amp;")\n    .replace(/</g, "&lt;")\n    .replace(/>/g, "&gt;");\n\nconst reference = `EXP-${Date.now().toString(36).toUpperCase()}`;\n\nreturn {\n  reference,\n  claimant: esc(f.claimant),\n  receiptHtml: `<html><body style="font-family:sans-serif">\n  <h1>Expense claim ${reference}</h1>\n  <p><strong>Claimant:</strong> ${esc(f.claimant)} (${esc(f.email)})</p>\n  <p><strong>Amount:</strong> £${esc(f.amount)}</p>\n  <p><strong>Purpose:</strong><br>${esc(f.purpose)}</p>\n  <hr><p style="color:#666">Submitted ${new Date().toISOString()}</p>\n</body></html>`,\n};\n',
          },
        },
        {
          id: "pdf",
          type: "HTML_TO_PDF",
          name: "Render the receipt",
          position: { x: 600, y: 0 },
          data: {
            variableName: "receipt",
            html: "{{receiptHtml}}",
            filename: "{{reference}}.pdf",
            pageSize: "A4",
            orientation: "portrait",
          },
        },
      ],
      edges: [
        { source: "submission", target: "render" },
        { source: "render", target: "pdf" },
      ],
    },
  },
  {
    slug: "webhook-retry-with-backoff",
    name: "Keep trying a flaky endpoint, then give up",
    description:
      "Calls an endpoint, and if it fails, waits and tries again with a longer gap each time — three attempts, then a clean failure that says what happened. This is the shape you need when the far end is occasionally unavailable and the engine's own retry is too blunt: here the delay grows, the attempt count is visible in the run, and the final give-up is a deliberate outcome rather than an exhausted retry budget. The waits are durable, so a run holding for eight minutes costs nothing and survives a redeploy. Nothing to connect.",
    category: "Ops",
    domain: "support",
    tags: ["retry", "backoff", "resilience", "http", "wait", "flaky"],
    graph: {
      nodes: [
        {
          id: "start",
          type: "WEBHOOK_TRIGGER",
          name: "Work arrives",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "attempt-1",
          type: "HTTP_REQUEST",
          name: "First attempt",
          position: { x: 260, y: 0 },
          data: {
            variableName: "try1",
            endpoint: "https://httpbin.org/status/200,503",
            method: "GET",
            // Deliberately false: this graph decides what a failure means,
            // rather than letting the engine's retry take over.
            failOnNon2xx: false,
            timeoutMs: 15000,
          },
        },
        {
          id: "ok-1",
          type: "CONDITION",
          name: "Worked?",
          position: { x: 520, y: 0 },
          data: {
            left: "{{try1.httpResponse.status}}",
            operator: "equals",
            right: "200",
          },
        },
        {
          id: "back-off-1",
          type: "WAIT",
          name: "Wait 30s",
          position: { x: 780, y: 120 },
          data: { mode: "duration", seconds: 30 },
        },
        {
          id: "attempt-2",
          type: "HTTP_REQUEST",
          name: "Second attempt",
          position: { x: 1040, y: 120 },
          data: {
            variableName: "try2",
            endpoint: "https://httpbin.org/status/200,503",
            method: "GET",
            failOnNon2xx: false,
            timeoutMs: 15000,
          },
        },
        {
          id: "ok-2",
          type: "CONDITION",
          name: "Worked now?",
          position: { x: 1300, y: 120 },
          data: {
            left: "{{try2.httpResponse.status}}",
            operator: "equals",
            right: "200",
          },
        },
        {
          id: "back-off-2",
          type: "WAIT",
          name: "Wait 2m",
          position: { x: 1560, y: 240 },
          data: { mode: "duration", seconds: 120 },
        },
        {
          id: "attempt-3",
          type: "HTTP_REQUEST",
          name: "Last attempt",
          position: { x: 1820, y: 240 },
          data: {
            variableName: "try3",
            endpoint: "https://httpbin.org/status/200,503",
            method: "GET",
            // The last one DOES fail the run: three tries over two and a half
            // minutes is a real outage, not a blip, and the execution should
            // say so rather than finishing green.
            failOnNon2xx: true,
            timeoutMs: 15000,
          },
        },
      ],
      edges: [
        { source: "start", target: "attempt-1" },
        { source: "attempt-1", target: "ok-1" },
        { source: "ok-1", target: "back-off-1", sourceHandle: "false" },
        { source: "back-off-1", target: "attempt-2" },
        { source: "attempt-2", target: "ok-2" },
        { source: "ok-2", target: "back-off-2", sourceHandle: "false" },
        { source: "back-off-2", target: "attempt-3" },
      ],
    },
  },
];
