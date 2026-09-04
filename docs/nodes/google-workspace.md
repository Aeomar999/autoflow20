# Google Workspace nodes

Eleven nodes across four services (AF-M10-15). They are the widest single
dependency in the automation library: 21 of the 35 reference automations need
Google beyond the one sheet append that existed before.

| Node | Service | Kind | Credential |
|---|---|---|---|
| `SHEETS_READ` | Sheets | action | `google.sheets` |
| `SHEETS_UPDATE` | Sheets | action | `google.sheets` |
| `SHEETS_UPSERT` | Sheets | action | `google.sheets` |
| `SHEETS_TRIGGER` | Sheets | polling trigger | `google.sheets` |
| `GOOGLE_SHEETS_APPEND` | Sheets | action | `google.sheets\|google.oauth2` |
| `GMAIL_SEND` | Gmail | action | `google.gmail` |
| `GMAIL_TRIGGER` | Gmail | polling trigger | `google.gmail` |
| `DRIVE_TRIGGER` | Drive | polling trigger | `google.drive` |
| `DRIVE_DOWNLOAD` | Drive | action | `google.drive` |
| `DRIVE_UPLOAD` | Drive | action | `google.drive` |
| `DRIVE_MOVE` | Drive | action | `google.drive` |
| `CALENDAR_TRIGGER` | Calendar | polling trigger | `google.calendar` |

Each service has its own credential type, with its own scopes. Connecting
Google for Sheets does not grant a workflow access to your mail — see
[ADR-0023](../decisions/0023-one-google-credential-per-service.md) and
[the connector setup manual](../operations/oauth_connectors_setup.md).

---

## The shared client

All eleven nodes go through `src/features/google/server/google-client.ts`.
Three things every Google node needs, each easy to get subtly wrong once per
node:

**Error classification, and the direction matters.** A `429`, or a `403` whose
*reason* is a quota, is transient: it backs off and retries. A `401`, or a
`403` whose reason is permissions, is permanent: it fails the node immediately.
Getting this backwards is expensive in both directions — retrying a permission
error three times spends the user's remaining quota to receive the same
refusal, and buries "the token lacks the Drive scope" under retry noise; not
retrying a quota error fails a run that would have succeeded a minute later.
Google overloads `403` across both cases, so the response's `reason` is read,
not just its status.

**Bounded pagination.** `while (nextPageToken)` against a folder holding
200,000 files is one node issuing an unbounded sequence of requests. The page
budget is 20; when a listing is cut short the node's output says
`truncated: true` rather than looking like a complete answer.

**Auth from the resolved credential only.** Tokens reach the executor through
`NodeRunParams.credentials` and never through `data`, because `data` is
persisted as `NodeExecution.input` (AF-M3-04).

---

## Sheets

### Header mapping

`SHEETS_READ` returns `{ headers, rows, count, range, truncated }`, where each
row carries the same data three ways:

```
{ rowNumber: 7, fields: { Email: "a@b.com", Status: "" }, cells: ["a@b.com", ""] }
```

`fields` is keyed by the header row, `cells` is positional, and `rowNumber` is
the sheet's own row number — which is what `SHEETS_UPDATE` needs to write back
to the row you just read. Three decisions worth knowing:

- **Short rows are padded.** Sheets omits trailing empty cells entirely, so a
  row that ends in three blanks comes back shorter than the header. Without
  padding, `{{row.fields.Status}}` would be `undefined` for exactly the rows
  where status is unset — the rows a workflow most often filters on. They come
  back as `""` instead.
- **A duplicate header keeps the first column.** Two columns named `Email` are
  a real spreadsheet, and silently taking the last one means the automation
  reads a column the user cannot see it is reading.
- **A blank header cell becomes `Column3`**, and a sheet read with
  `hasHeader: false` is keyed by its column letters (`A`, `B`, `C`). Either way
  every cell is addressable; an unnamed column is not silently dropped.

`startRowOf` and `columnLabel` translate between the A1 notation Sheets speaks
and the row indices a graph counts in, so `SHEETS_UPDATE` writes to the row the
user meant rather than one off from it.

### `SHEETS_UPSERT`

Matches on a column value and updates that row, or appends if no row matches.
The match is a full read of the key column, so it is bounded by the same page
budget as any other read.

### `SHEETS_TRIGGER`

A polling trigger over the seen-id window rather than a cursor: a spreadsheet
has no "modified since" for individual rows. Activating a workflow against an
existing 500-row sheet dispatches **zero** runs — see
[ADR-0024](../decisions/0024-polling-triggers.md).

---

## Gmail

### `GMAIL_SEND`

Builds an RFC 2822 message and hands Gmail the base64url `raw` field.
Multipart only when there are attachments — a plain HTML mail is a simpler
message and renders more predictably in old clients.

Three things the message builder does that a naive one does not:

- **Header values are CR/LF-stripped.** A newline in a header ends it and
  starts another, so a subject of `"Hi\nBcc: everyone@example.com"` adds a
  recipient. These values are templated from run data, so this is not
  hypothetical — it is the most likely injection point in the node.
- **Headers are RFC 2047-encoded** when they contain non-ASCII. A subject with
  an em dash, or a recipient with an accented name, is ordinary; sending it raw
  produces mojibake in most clients.
- **Attachment base64 is wrapped at 76 characters.** Unwrapped base64 breaches
  RFC 5322's 998-character line limit, and some relays reject or mangle it.

Attachments come from `FileRef`s ([ADR-0025](../decisions/0025-binary-payloads-by-reference.md)),
capped at 20 MB total per message (Gmail's own ceiling is 25 MB).

Set `threadId` to reply inside an existing conversation. Without it the reply
starts a second thread the recipient has to reconcile against the first.

### `GMAIL_TRIGGER`

Polls a Gmail search query. Two behaviours worth stating:

- **Bodies are not fetched on the first poll.** The polling framework
  dispatches nothing on a first sight — it is recording where the mailbox is —
  so fetching each message would spend the user's quota on results that are
  immediately discarded.
- **The message tree is flattened recursively.** A real message is
  `multipart/mixed` containing `multipart/alternative` containing the text and
  the HTML; a one-level scan finds the body of a test message and nothing at
  all of a genuine one. Where a message has only an HTML part, tags are
  stripped to readable text so a model is not handed a page of markup.

**Narrow the query before publishing.** `is:unread` on its own means the whole
inbox.

---

## Drive

### `DRIVE_MOVE` — the one people are surprised by

Drive has no move operation. A move is a parent swap, and **the old parent must
be named explicitly** or the file ends up in both folders — which means the
watched folder still contains it and the next poll reprocesses the same file.

`moveDriveFile` reads the file first, which does two jobs: it makes a retried
step idempotent (a file already in the destination returns without a write,
where removing a parent it no longer has would fail), and it collects **every**
current parent, not just the first. A file can genuinely be in two folders.

A watch-and-process automation that never moves the file re-reads it forever.
The move is not a tidiness step; it is the termination condition.

### `DRIVE_DOWNLOAD` — Google Docs have no bytes

`alt=media` returns an error for a Doc, Sheet or Slides file: they must be
exported. `DRIVE_DOWNLOAD` exports them to the Office equivalent
(`.docx`/`.xlsx`/`.pptx`, and PDF for a Drawing) and reports `exported: true`,
so the filename and MIME type match what the caller actually received. A
mismatched pair breaks the *next* node rather than this one, which is a much
worse place to debug it.

A Form, a Site or a shortcut has neither bytes nor an export. The node names
the type in its error instead of handing back an empty file.

Downloads are capped at 100 MB and land as a `FileRef`.

### `DRIVE_TRIGGER`

Unlike Sheets and Gmail, this trigger has a real cursor: `modifiedTime`. It
advances to the newest `modifiedTime` **it actually saw**, never to `now` —
using the local clock would skip any file written between the request and the
response.

Shared drives are included (`supportsAllDrives`, `includeItemsFromAllDrives`);
without those flags a file in a team folder is invisible, and team folders are
where shared work actually lives.

### Query escaping

Folder ids and names go into a quoted string in Drive's query language. An
unescaped apostrophe closes the string and the remainder is parsed as syntax —
the same class of bug as SQL injection, in a query language people forget is
one. `escapeDriveQuery` handles it; a folder named `O'Brien Contracts` works.

---

## Calendar

### `CALENDAR_TRIGGER`

Polls a forward window (`lookaheadMinutes`) for events that are about to start.

- **Recurring events are expanded** (`singleEvents: true`), so an automation
  sees the instance on Thursday rather than the recurrence rule.
- **Cancelled events are filtered out.** A meeting called off should not brief.
- **The item key is `${event.id}@${event.start}`**, not the event id. A
  rescheduled meeting is a different slot and should brief again; keying on the
  id alone would treat the new time as already handled.
- **Rooms and equipment are dropped from `attendees`.** Calendar counts a
  meeting room as an attendee, and a room has no address to look up and nobody
  to brief.

All-day events carry a date and no time; `allDay` is set so a template can
format them differently instead of rendering `00:00`.

---

## Related

- [ADR-0023 — one Google credential per service](../decisions/0023-one-google-credential-per-service.md)
- [ADR-0024 — polling triggers](../decisions/0024-polling-triggers.md)
- [ADR-0025 — binary payloads by reference](../decisions/0025-binary-payloads-by-reference.md)
- [OAuth connector setup manual](../operations/oauth_connectors_setup.md)
- [`google-sheets-append.md`](google-sheets-append.md) — the pre-M10 node, still supported
