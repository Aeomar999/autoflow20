# Airtable, Shopify, MailerLite and Stripe

Nine nodes for commerce and list management (AF-M10-20).

| Node | Kind | Credential |
|---|---|---|
| `AIRTABLE_TRIGGER` | trigger | `airtable.apiKey` |
| `AIRTABLE_READ` | data | `airtable.apiKey` |
| `AIRTABLE_UPDATE` | action | `airtable.apiKey` |
| `SHOPIFY_CREATE_ORDER` | action | `shopify.accessToken` |
| `MAILERLITE_FIND_SUBSCRIBER` | data | `mailerlite.apiKey` |
| `MAILERLITE_CREATE_SUBSCRIBER` | action | `mailerlite.apiKey` |
| `STRIPE_FIND_OR_CREATE_CUSTOMER` | action | `stripe.apiKey` |
| `STRIPE_CREATE_PAYMENT_LINK` | action | `stripe.apiKey` |
| `STRIPE_GET_CUSTOMER` | data | `stripe.apiKey` |

`AIRTABLE_CREATE_RECORD` and `STRIPE_TRIGGER` predate this work and are
unchanged.

---

## A retried step must not create a second anything

That is the requirement this family is built around, and each provider offers
a different amount of help with it.

| Provider | Mechanism | What happens on a retry |
|---|---|---|
| Stripe | `Idempotency-Key` header | returns the original object (24h window) |
| Shopify | `source_name` + `source_identifier` | the lookup finds the order already created |
| MailerLite | upsert by email, by design | updates the same subscriber |
| Airtable | none; `typecast` kept off | reads are safe, the update is a PATCH by id |

### The key has to be stable *and* distinct

`src/lib/server/idempotency.ts` derives the key from the **execution** and the
**node**. Both halves matter, and getting either wrong is worse than not trying:

- A **random key per attempt** defeats the mechanism entirely — every retry
  looks like new work and creates a duplicate.
- A key from the **node alone** is worse still: two runs of the same workflow an
  hour apart would collide, and the second would silently return the first
  run's object instead of doing its work.

It is hashed rather than concatenated, which caps it under Stripe's
255-character limit and keeps record contents out of the provider's logs.

---

## Stripe

These nodes act **as the tenant**, with the tenant's own secret key from a
`stripe.apiKey` credential — separate from the webhook route, which
authenticates with a deployment-level signing secret and only verifies inbound
events. Adding the credential type is what stops one workspace creating
customers on another's account.

**Stripe treats email as a label, not a key**, and will hold four customers
with the same address without complaint. `STRIPE_FIND_OR_CREATE_CUSTOMER`
searches first and creates only on a miss; `created` in the output says which
happened, so a welcome email can fire only for genuinely new people.

**A declined card is not a transient fault.** `402` and `card_error` fail
permanently: the issuer said no, retrying will not change their mind, and each
attempt shows on the customer's statement.

**Stripe takes form encoding, not JSON**, nesting as `metadata[order_id]` and
`line_items[0][price]`. Sending JSON gets a 400 whose message never mentions
the encoding.

`STRIPE_GET_CUSTOMER` reports `deleted` explicitly — Stripe returns a deleted
customer as a normal 200 with `deleted: true` rather than a 404, so a workflow
checking only the status would treat a closed account as live. `balance` is
passed through as Stripe gives it: smallest currency unit, and **negative means
credit**.

Payment links need a **price** (`price_…`), not a product (`prod_…`); the node
says so rather than forwarding Stripe's less specific error.

---

## Shopify

**Orders have no idempotency header.** The guard is the pair Shopify does
offer: `source_name` + `source_identifier`, which it treats as unique per shop.
The node derives the identifier from the run and the node, looks for an
existing order with it, and only writes if there is none. The lookup includes
archived orders (`status: any`) — an order closed between the write and the
retry would otherwise be invisible and get duplicated.

**The shop domain lives in the credential**, alongside the token. In node config
it would let one workflow point a colleague's token at a different store.

The API version is **pinned**. Shopify retires a version about a year after
release and an unversioned call silently follows the newest, so a response shape
could change under a running workflow with nothing deployed.

Receipts are **off by default**: a workflow that starts emailing customers the
first time it is switched on is a bad surprise.

---

## MailerLite

**`POST /subscribers` is an upsert** — MailerLite matches on email and updates
rather than duplicating, so the create node is idempotent with no key and no
pre-check. Worth saying out loud, because the same code against most list
providers would be a duplicate-generator.

**The one that bites:** creating a subscriber who already unsubscribed does
**not** resubscribe them, and MailerLite answers 200 either way. So the node
reports the returned `status` and a derived `subscribed` flag rather than
assuming — "the call worked" is not "they are on the list".

`MAILERLITE_FIND_SUBSCRIBER` returns `found: false` for a 404 rather than
failing: a list-hygiene workflow asks about people who are usually absent.

---

## Airtable

**`typecast` is never enabled.** With it on, Airtable coerces values to the
column's type and will **create new select options** to make a write succeed —
so a workflow writing `Hight` into a status column silently adds `Hight` as a
valid status, and nobody finds out until they open the view.

**Updates are PATCH, not PUT.** PUT clears every field the request does not
mention, turning "set the status" into "delete everything else on the row".

`filterByFormula` runs **server-side**, which matters for cost as well as speed:
without it the node pages the whole table to find three rows, and Airtable
meters requests per base (5/second). Formulas use the column's display name in
braces: `{Status} = "Active"`.

Personal access tokens are **scoped per base**, so a token that works elsewhere
can still be refused here — which is what the 403 message says.

### The trigger, and how it decides an edit counts

`AIRTABLE_TRIGGER` runs on the AF-M10-05 polling framework, so dispatch,
dedupe, backoff and the no-history-replay rule are the framework's. The node
answers one question — which records to consider — and gives each an id.

**The id is the whole mechanism:**

| `modifiedField` | Item id | Effect |
|---|---|---|
| unset | `recID` | each record fires once, ever |
| set | `recID@timestamp` | an edit is a new id, so it fires again |

One config field instead of a second node type.

### A wart worth naming

`AIRTABLE_CREATE_RECORD` predates this client and still carries its own inline
fetch. The task said to leave that node untouched, so there are two callers of
the same API for now. It should move onto the shared client the next time it is
opened for another reason.

---

## Related

- [Apify, Apollo and Google Search/Maps](data-acquisition.md) — the other
  metered family
- [GitHub, Jira and Notion](dev-tools.md)
