# Telegram and WhatsApp (WAHA)

Five nodes for chat messaging (AF-M10-21).

| Node | Kind | Credential |
|---|---|---|
| `TELEGRAM_TRIGGER` | trigger | `telegram.botToken` |
| `TELEGRAM_SEND_MESSAGE` | action | `telegram.botToken` |
| `TELEGRAM_GET_FILE` | action | `telegram.botToken` |
| `WAHA_TRIGGER` | trigger | `waha.apiKey` |
| `WAHA_SEND_MESSAGE` | action | `waha.apiKey` |

---

## Neither provider signs its webhooks

This is the fact that shapes both routes, and it is worth being blunt about:
**GitHub and Intuit sign their deliveries with an HMAC; Telegram and WAHA do
not.** There is nothing to verify cryptographically. The only proof a delivery
is genuine is a shared secret, so anyone who learns it can forge one.

Given that, both routes:

- use **one endpoint per workflow**, carrying the workflow's own secret — never
  a deployment-wide one, so a leak is contained to one workflow;
- compare in **constant time** (`secureCompare`);
- verify **before reading the body**, so an unauthenticated request cannot make
  the process allocate;
- cap the body at **1 MB** — a chat update is a few hundred bytes, and anything
  at that size is not one;
- answer **404**, not 401, for every reason a delivery cannot run, so the
  endpoint is not an oracle for which workflow ids exist.

Telegram's secret is the `secret_token` you give `setWebhook`, which it echoes
in `X-Telegram-Bot-Api-Secret-Token`. A secret shorter than 16 characters is
**refused outright** — Telegram permits a single character, and accepting that
would make the header a formality.

---

## Telegram

### Failure is an `ok: false` envelope

Like Slack: an HTTP 200 can describe a refusal, so the envelope decides, not the
status. On a 429 Telegram states `parameters.retry_after` explicitly and means
it — guessing a shorter wait gets the bot throttled harder.

**403 is the one people hit.** A bot cannot message someone who has not started
a chat with it, cannot message someone who blocked it, and must be a member of a
group to post there. Telegram's own wording ("bot was blocked by the user")
doesn't say any of that, so the node's error does.

### The bot token is in the URL

Not a header — it is a path segment. So it lands in anything that logs a URL.
Nothing in this client logs a request URL, and errors quote Telegram's
`description` rather than the path.

### Long messages are split, not truncated

Telegram **rejects** a message over 4096 characters rather than trimming it, so
the alternative to splitting is sending nothing. The split prefers a line or
sentence boundary in the last quarter of the window, so a digest stays readable
instead of being cut mid-sentence — but only there, or an early newline would
produce a five-character first chunk.

Every message id is returned in `messageIds`, so a workflow replying in-thread
knows which one to use.

### Files

`TELEGRAM_GET_FILE` turns a `file_id` into a stored run file, so Drive Upload,
Jira Add Attachment and Gmail Send can all take it directly.

Two calls, because that is the API: `getFile` returns a path valid for about an
hour, and the bytes come from a different host. **Files over 20 MB cannot be
fetched through the Bot API at all** — `getFile` answers with an error rather
than a path — so the node checks that limit and says so, instead of surfacing a
confusing 400. An expired path is retriable: re-running the step gets a fresh
one.

A photo arrives as an **array of sizes, ascending**. The node takes the last —
taking the first would silently fetch a thumbnail and the workflow would process
a blurry image.

### The command filter strips `@botname`

In a group, `/report` arrives as `/report@my_bot`. A plain equality check would
never match there.

---

## WhatsApp (WAHA)

### The base URL is user input, so it is egress-guarded

WAHA is self-hosted, so its base URL comes from the credential rather than from
us. That makes every call an SSRF risk of exactly the kind `HTTP_REQUEST` was
hardened against: a credential pointing at `http://169.254.169.254/` would turn
a WhatsApp node into a cloud-metadata reader, and one pointing at an internal
host would make it a port scanner with the server's network position.

So requests go through the same `safeFetch` as `HTTP_REQUEST`: the hostname is
resolved, loopback/private/link-local/CGNAT addresses are refused, the
connection is **pinned to the address that was vetted**, and every redirect hop
is re-vetted. The URL is also checked up front, so a bad credential fails with a
sentence rather than a connection error mid-run.

### The echo loop

**WAHA delivers the bot's own outbound messages back as events.** A workflow
that replies to everything it receives would reply to its own replies — forever,
at WhatsApp's expense and the recipient's. The route drops `fromMe` events
before anything is dispatched.

That is the single most important line in the WAHA integration, and it is a
route-level filter rather than something each template has to remember.

### Chat ids

WAHA addresses individuals as `<digits>@c.us` and groups as
`<digits>-<digits>@g.us`. A raw phone number is **accepted and delivered
nowhere** — no error, no message — so the node normalises whatever format the
number arrives in. A group id is recognised before the digit strip, which would
otherwise turn `123-456` into `123456` and address an individual who is not in
the group.

### Sessions

A WAHA instance serves **named** sessions and `default` is only the default. A
404 usually means the session name is wrong; a 422 usually means the session
exists but has not had its QR code scanned, so it cannot send yet. Both errors
say so.

---

## Related

- [Slack nodes](slack.md) — the other `ok: false` envelope
- [GitHub, Jira and Notion](dev-tools.md) — webhooks that *are* signed
