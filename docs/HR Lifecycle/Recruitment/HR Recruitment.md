# HR Recruitment

Here's a complete breakdown of the one workflow in this project: **"[HR Lifecycle - Phase 1: Recruitment](https://aeomar999.app.n8n.cloud/workflow/XE9AqbTXTR052l27)"** (currently unpublished/inactive). It has 11 nodes.

## The main flow (linear, left to right)

**1. Job Application Form** — `n8n-nodes-base.formTrigger` (v2.6)

- **Role:** Entry point / trigger. Hosts a public n8n form titled "Job Application" at path `job-application`, collecting Full Name, Email, Position, and a required PDF Resume upload.
- **Integration/credential:** None — n8n-native hosted form.
- **Connections:** → *Extract Resume Text*.

**2. Extract Resume Text** — `n8n-nodes-base.extractFromFile` (v1.1)

- **Role:** Reads the uploaded PDF (`operation: pdf`, binary property `Resume`) and joins all pages into a single `text` field.
- **Integration/credential:** None — local file processing.
- **Connections:** *Job Application Form* → this → *AI Resume Screening*.

**3. AI Resume Screening** — `@n8n/n8n-nodes-langchain.openAi` (v2.3)

- **Role:** Sends the resume text plus position/name to OpenAI (`gpt-4o-mini`). A system prompt tells it to act as a recruiter and return a strict JSON schema: `qualified` (boolean), `score` (0–100), `summary`. Temperature 0.2, max 800 tokens. "Qualified" = score ≥ 70.
- **Integration/credential:** OpenAI — requires an **OpenAI API credential** (not yet configured).
- **Connections:** *Extract Resume Text* → this → *Qualified?*. It also has an `ai_tool` input coming from *AI Agent Tool* (see the anomaly below).

**4. Qualified?** — `n8n-nodes-base.if` (v2.2)

- **Role:** Branches on `{{ $json.output[0].content[0].text.qualified }} === true`.
- **Integration/credential:** None.
- **Connections:** TRUE → *Set Booking Link*; FALSE → *Send Polite Rejection*.

### Qualified branch (TRUE)

**5. Set Booking Link** — `n8n-nodes-base.set` (v3.5)

- **Role:** Assigns a `bookingLink` string. Currently a **placeholder** (`<__PLACEHOLDER_VALUE__...__>`) — needs a real interview/calendar URL.
- **Integration/credential:** None.
- **Connections:** → *Send Interview Booking Email*.

**6. Send Interview Booking Email** — `n8n-nodes-base.gmail` (v2.2)

- **Role:** Emails the candidate (to their form email) an HTML invitation with the booking link.
- **Integration/credential:** Gmail — requires a **Gmail OAuth2 credential** (not yet configured).
- **Connections:** → *Notify Recruiting - Qualified*.

**7. Notify Recruiting - Qualified** — `n8n-nodes-base.slack` (v2.7)

- **Role:** Posts a Slack message to a recruiting channel with name, email, score, and summary.
- **Integration/credential:** Slack (OAuth2) — requires a **Slack OAuth2 credential**. Also the target `channelId` is **empty** and must be selected.
- **Connections:** Terminal node.

### Not-qualified branch (FALSE)

**8. Send Polite Rejection** — `n8n-nodes-base.gmail` (v2.2)

- **Role:** Sends a courteous rejection email to the candidate.
- **Integration/credential:** Gmail OAuth2 (same as node 6).
- **Connections:** → *Notify Recruiting - Not Qualified*.

**9. Notify Recruiting - Not Qualified** — `n8n-nodes-base.slack` (v2.7)

- **Role:** Slack notice to recruiting that the candidate was rejected.
- **Integration/credential:** Slack OAuth2; `channelId` also **empty**.
- **Connections:** Terminal node.

## Detached AI sub-nodes (not wired into the working path)

**10. AI Agent Tool** — `@n8n/n8n-nodes-langchain.agentTool` (v3)

- **Role:** Described as "Read Applicant requirements", exposed as an `ai_tool`.
- **Connections:** Its `ai_tool` output feeds *AI Resume Screening*'s tool input, and it receives an `ai_languageModel` input from Google Gemini.

**11. Google Gemini Chat Model** — `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` (v1.1)

- **Role:** A language model sub-node.
- **Integration/credential:** Google Gemini (PaLM) API — would require a **Google Gemini credential**.
- **Connections:** `ai_languageModel` → *AI Agent Tool*.

## Things worth flagging

- **The workflow is not published/active** (`activeVersionId: null`), so it won't run yet.
- **Three credentials are unconfigured:** OpenAI, Gmail, Slack (and Google Gemini for the detached branch).
- **Two Slack channels are empty** — no target channel selected.
- **The booking link is a placeholder** — needs a real URL.
- **The AI Agent Tool + Gemini pairing looks half-wired / likely a mistake.** Attaching an `agentTool` (whose language model is Gemini) as a *tool* to the OpenAI screening node is unusual — the screening node already
does the evaluation directly via its JSON schema. This sub-branch
doesn't contribute to the main logic and would probably confuse
execution rather than help. I'd recommend removing it unless there was a specific intent behind it.