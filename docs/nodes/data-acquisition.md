# Apify, Apollo, Google Search and Maps

Five nodes for getting data in from outside (AF-M10-19).

| Node | Kind | Credential |
|---|---|---|
| `APIFY_RUN` | action | `apify.apiKey` |
| `APIFY_GET_DATASET` | data | `apify.apiKey` |
| `APOLLO_ENRICH` | data | `apollo.apiKey` |
| `GOOGLE_SEARCH` | data | `googleCustomSearch.apiKey` |
| `GOOGLE_MAPS_SEARCH` | data | `googleMaps.apiKey` |

**Every node here spends money.** That is the organising fact for this family:
each one is metered by its provider, so the failure mode that matters is not a
crash but a bill. The caps below are defaults you can raise — they are not
there to be conservative, they are there so nothing runs unbounded by accident.

---

## Costs at a glance

| Service | Billed on | This node's default cap |
|---|---|---|
| Apify | compute units per **second the actor is alive** | 300s wait, 1,000 dataset items |
| Apollo | **credits per successful match** (more to reveal an email) | one match per run; reveal off |
| Custom Search | **per query**; 100/day free, then paid | 10 results = 1 query |
| Places | **per request**, tiered by requested fields | 20 results = 1 request; contact fields off |

---

## Apify

### The wait is a real step, and it aborts on the way out

`APIFY_RUN` starts the actor, then polls with **durable sleeps** — each sleep
and each poll is its own step. That matters for three reasons:

- **Cancel means cancel.** A wait parked inside one long `step.run` cannot
  notice it was cancelled until that step returns, so pressing cancel on a
  ten-minute scrape would mean "stop in ten minutes".
- The worker is not held for the length of a scrape.
- The wait survives a redeploy.

**Every path that stops waiting aborts the actor run.** Apify bills for as long
as an actor is alive, so a run nobody is reading is a bill, not a loose end.
On a timeout or a cancellation the node calls `abort`, and its error says
whether that worked — if it did not, the message tells you to stop it in the
console rather than leaving you to find out from an invoice.

The node also sets Apify's **own** run timeout slightly above its wait, as a
backstop: if this workflow dies between polls, the actor still stops by itself.

The starting call is its own step, so a retry of a later step cannot launch a
second run — which would bill twice and produce two datasets.

### A failed actor is a successful API call

Apify reports actor failure as HTTP 200 describing a `FAILED` run. The node
checks the run's terminal state, not just the response, or it would report
success and hand an empty dataset to the next node. `FAILED`, `TIMED-OUT` and
`ABORTED` are all failures with their own message.

### Actor ids

`username~actor-name` is the API form; the node accepts the `username/actor`
you get from the console URL and converts it. Without that, a pasted id 404s in
a way that reads like the actor does not exist.

### Datasets

`APIFY_GET_DATASET` caps at `limit` and **reports `truncated`**. A crawl of a
large site yields tens of thousands of items; a workflow that silently
processed the first thousand looks like it worked.

---

## Apollo

### A 429 can mean "wait a minute" or "wait a day"

Apollo enforces per-minute, per-hour and per-day windows and answers 429 for
all of them. The node reads the remaining-requests headers: an exhausted
**daily** allowance is a permanent failure for this run, because retrying every
thirty seconds spends the whole attempt budget to learn nothing. A per-minute
limit retries normally.

### A miss is a 200

Apollo answers a no-match with `{"person": null}`, not a 404. The node reports
`found: false` and carries on rather than failing, so enriching a list is not
stopped by one unknown contact. Check `found` before reading `person`.

### It refuses a query it would only guess at

A person match needs an email, or a name **plus** a company domain. A name
alone matches too many people to be worth a credit, so the node refuses it
rather than spending one. Domains are normalised — a pasted homepage URL
becomes a bare domain, which is what Apollo expects and what it silently
mismatches without.

`revealPersonalEmails` is off by default; turning it on costs extra credits.

---

## Google Custom Search

### Quota exhaustion is not a rate limit

Google answers 429 for both a per-second burst **and** a daily quota that will
not reset for hours. The node tells them apart by the error `reason`:
`rateLimitExceeded` retries, `dailyLimitExceeded` and `quotaExceeded` fail with
a message saying so. Retrying an exhausted day is how a run burns every attempt
and then reports the wrong cause.

The free tier is **100 queries a day**.

### Results and cost are the same number

Google serves ten results per request and will not page past 100 for a query,
whatever `start` says. So `limit: 50` is five billed queries. The node reports
`queriesUsed` so the cost is visible in the run rather than only on the bill.

`cx` — the search-engine id — comes from the **credential**, never from node
config. It identifies the engine the key is billed against, and letting a
workflow set it would let one workflow point a colleague's key elsewhere.

An empty query is refused rather than sent: it would cost a billed request and
return nothing.

---

## Google Maps

### The field mask is the price list

Places (New) bills by SKU according to which fields you ask for. `*` — the
obvious shortcut — puts every call on the most expensive tier. The node builds
the mask from what it was actually configured to want:

| `includeContactDetails` | Fields requested |
|---|---|
| off (default) | name, address, types, maps link, rating, review count |
| on | the above **plus** phone, website, opening hours |

The mask is mandatory — a request without one is a 400 — so this is not an
optimisation you can skip.

### Result ceiling

Places serves 20 per page and at most 60 across three pages, each a separately
billed request. The node stops at 60 rather than paging until Google refuses.

### The key is not the Custom Search key

A Google Cloud key restricted to the Custom Search API returns 403 for Places;
they are separate API enablements. That is why `googleMaps.apiKey` is its own
credential type, and why the 403 message says so rather than blaming the key.

`region` is folded into the text query — Places' `locationBias` takes
coordinates, and what a workflow has is a place name. Text search reads
"dentists in Leeds" the way a person would.

---

## Related

- [GitHub, Jira and Notion](dev-tools.md)
- [Slack nodes](slack.md)
