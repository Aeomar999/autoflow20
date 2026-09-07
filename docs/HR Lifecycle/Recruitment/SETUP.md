# HR Lifecycle — Phase 1: Recruitment · live setup

Takes the `hr-lifecycle-phase-1-recruitment` template from installed to a real
Google Form submission producing a real email and a real Slack post.

Roughly 40 minutes, most of it in the Google Cloud Console. Steps 1–3 are
prerequisites you only do once; 4–7 are per-workflow.

**Target deployment:** `https://autoflow20.vercel.app`. Substitute your own base
URL throughout if it differs — it must match `NEXT_PUBLIC_APP_URL`, because the
trigger dialog and the OAuth redirect are both built from that value.

---

## What the workflow does

```
Google Form submission
  → Download Resume        Drive id from the file-upload answer → a stored file
  → Extract Resume Text    PDF → plain text
  → AI Resume Screening    { qualified, score, summary } against the position
  → Qualified?             score ≥ 70, per the prompt
      ├── yes → Set Booking Link → Gmail invitation  → Slack #recruiting
      └── no  →                    Gmail rejection   → Slack #recruiting
```

Three credentials must be connected before it can run: **Google Drive**,
**Gmail**, and **Slack**. An AI provider key is also needed, but counts as
optional to the installer because the node can fall back across providers.

---

## 1. Google Cloud OAuth client

Drive and Gmail are both driven by one `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` pair (`src/features/credentials/server/oauth-providers.ts`).
Currently both are empty, which is why neither service can be connected.

1. In the [Google Cloud Console](https://console.cloud.google.com), create a
   project (or reuse one).
2. **APIs & Services → Library** — enable **Google Drive API** and **Gmail API**.
3. **APIs & Services → OAuth consent screen** — External, publishing status
   **Testing**. Add every Google account that will connect a credential (yours,
   and the recruiting mailbox if different) under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Add both authorised redirect URIs, exactly:

   ```
   https://autoflow20.vercel.app/api/oauth/google.drive/callback
   https://autoflow20.vercel.app/api/oauth/google.gmail/callback
   ```

5. Copy the client id and secret into the **Vercel dashboard** (Project →
   Settings → Environment Variables) as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, scoped to Production. **Redeploy** — Next.js reads
   these at runtime on the server, but a running deployment will not pick up new
   variables without one.

**On Testing mode.** `drive` and `gmail.send`/`gmail.modify` are Google
*restricted* scopes. In Testing you may use them with named test users and no
Google review; the grant expires and needs re-consent periodically. Publishing
the app for arbitrary users would require Google's verification process.

**Why the full `drive` scope.** ADR-0023 explains: `drive.file` only sees files
the app itself created, and a resume uploaded through someone else's form is not
one of those.

## 2. The Google Form

Create the form at [forms.google.com](https://forms.google.com) with exactly
these four questions, **in this wording** — the Apps Script keys every answer by
its question title, so the title *is* the contract:

| Question title | Type | Required |
|---|---|---|
| `Full Name` | Short answer | yes |
| `Email` | Short answer | yes |
| `Position` | Short answer (or Dropdown of open roles) | yes |
| `Resume` | **File upload** | yes |

On the `Resume` question, restrict to **PDF** and **1 file**, max size 10 MB —
the Drive Download node caps at 10 MB and will fail a larger file rather than
truncate it.

Renaming a question later silently breaks the workflow: the expression resolves
to an empty string rather than erroring. If you must rename one, update the
matching `{{googleForm.responses.[…]}}` expressions in the workflow.

> **File upload forces sign-in.** Google requires respondents to be signed in to
> a Google account to upload, and the files land in *your* Drive against *your*
> quota. That is inherent to Google Forms, not to this workflow.

## 3. Slack

Connect the Slack workspace in AutoFlow (**Credentials → New → Slack**) and note
the target channel's **ID** (`C0123ABCD…`) — in Slack, open the channel, click
its name, and the ID is at the bottom of the About tab. An ID is stable across
channel renames; a `#name` also works but breaks if renamed.

Invite the AutoFlow app to that channel, or posting will fail with
`not_in_channel`.

## 4. Install the workflow

Templates are seeded into the database, so the entry must exist in the
environment you are using. If the gallery does not list **HR Lifecycle - Phase 1:
Recruitment**, re-seed:

```bash
DATABASE_URL="<the target database>" npm run seed:templates
```

The seeder runs the authoring harness before it writes, so a malformed
catalogue cannot be seeded.

Then: **Templates → HR Lifecycle - Phase 1: Recruitment → Use template.**

## 5. Fill in the placeholders

Open each node and replace the values the template ships as placeholders:

| Node | Field | Value |
|---|---|---|
| Download Resume | Credential | your Google Drive connection |
| AI Resume Screening | Credential | your OpenAI key (or switch `model` to a provider you have) |
| Set Booking Link | `bookingLink` | your real scheduling URL — the template's `cal.com/team/interview` is a placeholder |
| Send Interview Booking Email | Credential, `from` | Gmail connection; `from` must be an address that account may send as |
| Send Polite Rejection | Credential, `from` | same |
| Notify Recruiting — Qualified | Credential, `channel` | Slack connection; replace `REPLACE_WITH_CHANNEL_ID` |
| Notify Recruiting — Not Qualified | Credential, `channel` | same |

Also review the two email bodies — they say "Acme Corp".

**Save.** The workflow needs a `webhookSecret`, which exists from creation, but
the next step reads it from the saved workflow.

## 6. Wire the Apps Script

1. In the AutoFlow editor, open the **Job Application** trigger node and its
   configuration dialog. Copy the **webhook URL** — it looks like
   `https://autoflow20.vercel.app/api/webhooks/google-form?workflowId=…&secret=…`.
2. Click **Copy Google Apps Script**. The script already contains your URL.
3. In the Google Form: **⋮ → Apps Script**, paste the script over anything
   there, and save.
4. In Apps Script: **Triggers** (clock icon) **→ Add Trigger** →
   function `onFormSubmit`, source **From form**, event **On form submit** →
   Save. Authorise the script when prompted (it will warn the app is unverified —
   expected in Testing mode; choose Advanced → Go to project).

The URL secret is the only credential on this endpoint — Google Forms cannot sign
its requests — so treat the webhook URL as a secret. Rotating it means changing
the workflow's `webhookSecret` and re-pasting the script.

**No publish step.** Unlike the AutoFlow-hosted form, the Google Form webhook
checks only the workflow id and secret, and the engine runs the workflow's
current saved graph. Edits are live as soon as they are saved — which also means
a half-finished edit is live. Edit deliberately.

## 7. First live run

Submit the form twice against a job description you can predict:

1. **A strong candidate** — a real PDF resume that matches the position.
   Expect: the interview email in the candidate's inbox, and a ✅ post in Slack
   carrying the score and summary.
2. **A weak candidate** — a resume unrelated to the position.
   Expect: the rejection email, and a ❌ post.

Check **Executions** in AutoFlow for each run. Every node should be `SUCCESS`,
with the untaken branch `SKIPPED`. Open **AI Resume Screening** and confirm the
prompt it received contains the candidate's real name and position — an empty
name there means a question title no longer matches.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| No execution appears at all | The Apps Script trigger is not installed, or `UrlFetchApp` was never authorised. Check **Executions** in the Apps Script editor for failures. |
| `404 Not found` from the webhook | Wrong `workflowId` or a rotated `webhookSecret`. Re-copy the URL from the trigger dialog. |
| Blank name/position in the email or Slack post | A form question was renamed. The titles must match the `{{googleForm.responses.[…]}}` expressions exactly. |
| `Drive Download node: File ID not configured` | The `Resume` question is not a file-upload question, or the answer was empty. |
| Extraction fails on `[object Object]` | The `file` expression lost its triple braces. It must be `{{{json resumeFile.file}}}`. |
| `Gmail Send node: Sender not configured` | `from` was left as `REPLACE_WITH_YOUR_ADDRESS`. |
| `Slack Post node: Channel not configured` | `channel` was left as `REPLACE_WITH_CHANNEL_ID`. |
| Slack `not_in_channel` | Invite the AutoFlow app to the channel. |
| `invalid_grant` when connecting Google | The Testing-mode grant expired, or the account is not in **Test users**. |
| Runs start but never finish | Inngest is not processing. Check the Inngest Cloud dashboard for the synced app. |

## Related

- Design and the defects this fixed: `docs/superpowers/specs/2026-09-07-hr-recruitment-google-forms-design.md`
- The n8n original this ports: `HR Recruitment.md` in this directory
- Business framing: `docs/Stakeholder_Mega_Workflow_Brief.md`
