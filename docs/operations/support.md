# Support

**Status:** Built (AF-M8-10).
**Read before:** answering a customer, or deciding whether something is an incident.
**Companions:** `docs/operations/runbooks.md` (incidents), `docs/operations/beta_launch_checklist.md` (what is not built yet).

---

## 1. Channel

One inbox, `NEXT_PUBLIC_SUPPORT_EMAIL`, monitored during working hours. There is no in-app support widget, no chat, and no ticketing system — during beta the volume does not justify one, and a channel nobody watches is worse than an address.

**There is no on-call rotation.** Out of hours, nothing is watched. Say so if a customer asks; do not imply coverage that does not exist.

---

## 2. Triage

Decide two things, in this order.

**Is it an incident?** If more than one workspace is affected, or the runbooks describe the symptom, it is an incident — go to `runbooks.md` and work the incident first. Answering tickets one by one while the platform is down wastes the time that fixes it.

**Otherwise, which of these is it?**

| Class | Looks like | First move |
|---|---|---|
| **Broken for them only** | One workspace, others fine | Read their execution trace before replying |
| **Working as designed** | Quota refusal, rate limit, expression returning empty | Point at the reference; consider whether the docs failed them |
| **Missing feature** | "Can it do X" | Answer honestly; file it if it recurs |
| **Billing** | Charge, plan, cancellation | See §4 — read it before replying |
| **Data or privacy request** | Export, deletion, "who sees this" | See §5 |

---

## 3. Answering a "my workflow is broken" ticket

Almost always one of five things, in rough order of frequency:

1. **An expression that resolved to nothing.** A path that does not exist renders empty and the run continues — it does not fail. An empty field downstream usually means a typo in the expression, not missing data. `/docs/expressions`.
2. **Escaping.** A JSON body built with `{{ }}` breaks the moment a value contains a quote or an ampersand. `{{{ }}}` or the `json` helper. This is the single most common real bug in a user's workflow.
3. **A quota refusal.** The run fails with `QUOTA_EXCEEDED` — it did not silently vanish. Check the workspace's plan and month-to-date count.
4. **A credential the third party revoked or expired.** The node fails at the provider, not in our system. Expiry warnings go out in advance.
5. **A genuine bug.** Reproduce it before saying so.

Start from the execution trace, every time. It records each node's resolved input and output, so it answers "what did the node actually receive" without guessing.

**One thing you cannot do:** read a customer's stored credential. There is no interface that returns one in plain text, for anyone, including us. That is a property of the system, not a permission that can be granted — do not promise to "check the credential", and be suspicious of any request that asks you to.

**Retention limits debugging.** Run inputs and outputs are erased on the plan's schedule — seven days on FREE. A ticket about a three-week-old run may have no payload left to inspect. Ask for a recent reproduction.

---

## 4. Billing questions

**Read this before answering anything about plans.**

Payment does not currently change a workspace's plan. `Organization.plan` is set to `FREE` at creation and never updated; there is no webhook applying a successful subscription. A customer who has paid is still on FREE limits — quota, rate limits, and retention all read that column.

Until **AF-M8-23** ships:

- Treat any "I paid but I'm still limited" report as **true and expected**, not as a misunderstanding.
- Do not tell a customer to wait for it to propagate. Nothing will propagate.
- Escalate immediately; a manual plan change in the database is the only remedy, and it should be recorded.

---

## 5. Data and privacy requests

- **Export.** Self-serve — workflows and recent execution history are available through the app and the public API. Point them there; it is faster than a ticket.
- **Deletion.** Closing the account deletes workspace data within 30 days. Confirm the request came from someone entitled to make it before acting.
- **"Who can see our data?"** `/privacy` lists the subprocessors, and the list is generated from the code rather than written from memory.
- **A formal data subject request** goes to the privacy address in `src/config/legal.ts`, not to general support. There is a statutory clock.

---

## 6. Telling everyone something

Maintenance, an incident update, a deprecation:

```bash
npm run notify:system -- --id maint-2026-09-14 --title "..." --message "..."
```

Dry-run by default; add `--yes` to send. Idempotent per workspace, so a half-finished broadcast is safe to run again. Keep the same `--id` when correcting wording — a new id announces it a second time to everyone who already read it.

---

## 7. What we do not have

Written down so nobody promises it:

- No on-call rotation and no out-of-hours coverage.
- No ticketing system, SLAs, or response-time commitments.
- No in-app support entry point — the address has to be found on the site.
- No status-page incident history; `/status` reports the current moment only.
- No admin console. Anything an operator must do is a script or a database query.
