# QuickBooks Online nodes

Ten nodes (AF-M10-16). QuickBooks is the largest single-service dependency in
the automation library: 10 of the 35 reference automations touch it.

| Node | Kind | What it does |
|---|---|---|
| `QBO_FIND_CUSTOMER` | data | Look a customer up by display name or email |
| `QBO_CREATE_CUSTOMER` | action | Create a customer |
| `QBO_CREATE_INVOICE` | action | Raise an invoice |
| `QBO_CREATE_ESTIMATE` | action | Raise an estimate (quote) |
| `QBO_CREATE_SALES_RECEIPT` | action | Record money already taken |
| `QBO_CREATE_EXPENSE` | action | Record an expense (a `Purchase` in the API) |
| `QBO_GET` | data | Read one record by type and id |
| `QBO_GET_INVOICE_PDF` | data | Fetch the invoice PDF as a file reference |
| `QBO_ATTACH` | action | Attach a stored file to a record |
| `QBO_WEBHOOK_TRIGGER` | trigger | Start on a record change in the company |

All ten use the `intuit.oauth2` credential. See
[the connector setup manual](../operations/oauth_connectors_setup.md) for
connecting one.

---

## Sandbox vs production is a property of the credential

**Not of a node, and a node cannot override it.** The company id (`realmId`)
and the sandbox/production choice are both captured during the connect flow and
live inside the sealed credential.

This is deliberate and it is the one design decision worth reading before
anything else. The source templates make the company id node config, which is
how they end up shipping with a sandbox company baked into a workflow that
somebody then runs against their real books — or, worse, pointed at production
while still carrying sandbox item and account ids. Here, moving a workflow
between companies means picking a different credential, and there is nothing in
the graph that can disagree with it.

Anything that is not exactly `"sandbox"` is treated as production. Defaulting
the other way would point a misconfigured connection at a company that does not
exist, and the failure would read as "not found" rather than as "wrong
environment".

## The minor version is pinned

Every request carries `minorversion=75`. Intuit ships breaking response changes
*inside* v3 behind minor versions, so an unpinned request silently receives
whatever is current — and a field that exists today can vanish on a Tuesday
with no deploy on our side. Bumping the pin is a deliberate change with a
changelog to read.

## Errors

Classified by whether a retry could conceivably succeed:

| Response | Treated as |
|---|---|
| `429` (Intuit throttles at 500 req/min per realm) | retriable, backs off |
| `5xx` | retriable |
| `401` | permanent — reconnect the credential |
| `403` | permanent — feature not enabled, or missing scope |
| `404` | permanent |
| Validation faults | permanent |

Error **6240** ("Duplicate Name Exists in the table") gets its own message.
It is the most common QBO write failure, and Intuit reports it as "Business
Validation Error", which tells the user nothing about what to change — the
node's message names `QBO_FIND_CUSTOMER` and the find-then-create pattern
instead.

## Query escaping

Values reaching QBO's `query` endpoint go into single-quoted strings in a
SQL-like language. `O'Brien Ltd` is an ordinary company name, and unescaped it
closes the string and has its remainder parsed as syntax. `escapeQboQuery`
handles it — escaping the backslash first, so a caller-supplied backslash
cannot consume the escape we add.

Pagination is `STARTPOSITION`/`MAXRESULTS` in the query text rather than a page
token, and it is **1-indexed**: a loop starting at 0 re-reads the first page's
tail forever, which is an infinite loop that looks like a working one. The page
budget is 10, and truncation is reported.

---

## Find, then create

`QBO_FIND_CUSTOMER` returns `found: false` rather than failing when nothing
matches. That is the whole point: "no such customer" is the expected answer in
a find-or-create flow, and a node that failed the run would make the create
branch unreachable.

It also reports `matches`. Two customers sharing an email is a real
bookkeeping state, and silently taking the first is how an invoice lands on the
wrong account.

The two search fields are combined with **OR**, not AND — a name and an email
are alternative ways of naming the same person, and requiring both would miss a
customer whose email is not on file.

Because only one branch of a find-or-create actually runs, wire the two paths
to their own terminal nodes rather than through a `MERGE`: merge waits for
inputs that will never arrive on the branch that was not taken.

## Lines

Invoices, estimates and sales receipts take `lines` as a JSON expression:

```
{{{json order.items}}}
```

**Three braces, not two.** Two braces HTML-escape the quotes, so the value
arrives as `[{&quot;amount&quot;:1}]`. The node names this specific mistake
rather than reporting a JSON parse error, because it is the most likely
authoring error by a wide margin.

Each line is `{ amount, description?, quantity?, unitPrice?, itemId? }`.
QuickBooks' own capitalisation (`Amount`, `Description`, `Qty`, `UnitPrice`)
is accepted too, so a line read back from QBO can be fed straight into a
create without renaming four fields.

Amounts are coerced: a value arriving as `"$1,299.00"` from a store or a
spreadsheet becomes `1299`. A **blank** one is refused rather than posted as
zero — `Number("")` is `0`, and a zero-amount line on a real invoice is never
what was meant. Amounts are rounded to cents, because a quantity times a unit
price in floating point produces `41.980000000000004` and QuickBooks stores
that and renders it on a customer-facing PDF.

Every line is written as a `SalesItemLineDetail`. The bare `Amount` form QBO
also accepts posts to the ledger and renders as a blank row on the document the
customer receives.

## Expenses

QuickBooks calls this a `Purchase` in its API and an Expense on screen — the
same thing under two names, which is worth knowing when reading Intuit's docs.

Two account ids, both from your own chart of accounts:

- **Payment account** — the bank or credit-card account the money left
- **Expense account** — what the cost is booked against

## Attachments

`QBO_ATTACH` posts to the `/upload` endpoint, which pairs a metadata part with
a content part by name (`file_metadata_0` ↔ `file_content_0`). Getting the
pairing wrong uploads the file with no link to the record — which reads as
success and leaves an orphan in the company's attachment list.

The endpoint also reports per-part failures **inside a 200**, so the response is
inspected rather than trusted; without that check a rejected attachment is
indistinguishable from a stored one.

Set `includeOnSend` to attach the file to the copy QuickBooks emails the
customer.

---

## The webhook trigger

**Intuit posts to one endpoint per app, not per workflow.** Every connected
company's events arrive at the same URL, and the payload names the company
rather than the workflow. That makes this trigger's shape different from the
Stripe and Google Form ones:

1. The **signature is the only proof**. There is no per-workflow secret in the
   URL to check first.
2. Routing happens **after** verification: the realm is matched to a stored
   credential, then to the published workflows whose QuickBooks trigger binds
   it.
3. The trigger's **credential is how a workflow says which company it means**.
   Without it, a second connected company's invoices would start it too.

### Verification

`intuit-signature` is the base64 HMAC-SHA256 of the **raw request body** under
the app's verifier token (`INTUIT_WEBHOOK_VERIFIER_TOKEN`).

Raw matters. Reading the body with `request.json()` and signing
`JSON.stringify(parsed)` is the obvious implementation and it is wrong: key
order, whitespace and number formatting all differ, so every check fails — and
it fails in a way that looks like a wrong verifier token. There is a test for
exactly this.

The comparison is constant-time, and a wrong-length signature is rejected
without calling `timingSafeEqual` (which throws on a length mismatch, and an
unhandled throw would turn a forged request into a 500 rather than a
rejection). A deployment with no verifier token configured **rejects
everything**; a webhook endpoint that cannot verify must never fail open.

Rejections are logged as structured warnings, deliberately **not** written to
`AuditLog`: that table is org-scoped, and an unverified payload has no proven
realm, so every rejection would have to be filed against a guessed tenant — in
the one table whose value depends on its rows being true.

### Dispatch

One run **per entity event**, not per notification. Intuit batches, so an
invoice created and then emailed inside the same window arrives as two entity
events in one request; handing a graph a list it has to loop over would make
the common case — one record changed — the awkward one. A notification may
start at most 100 runs.

The trigger reports **what** changed, not what it now says, so pair it with
`QBO_GET`:

```
qbo.entity      → "Invoice"
qbo.entityId    → "142"
qbo.operation   → "Create"
qbo.realmId     → the company
qbo.lastUpdated → Intuit's timestamp
```

Narrow the entity and operation filters. Empty means every type, and "anything
changed" in an active company fires constantly.

---

## Related

- [OAuth connector setup manual](../operations/oauth_connectors_setup.md)
- [ADR-0025 — binary payloads by reference](../decisions/0025-binary-payloads-by-reference.md) (invoice PDFs and attachments)
