# Postgres Query node

Runs a **parameterized SQL query** against a connected PostgreSQL database and
stores the returned rows in the run context. Used to read, write, or aggregate
data mid-flow.

- **Type id** (persisted in `Node.type`): `POSTGRES_QUERY`
- **Category**: ACTION
- **Icon**: `Database` (lucide)
- **Credential**: `postgres` (host, port, database, username, password, SSL mode)
- Since: AF-M3-06

## Config reference

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | string | at run time | Key the result is stored under in the run context. |
| `credentialId` | string | at run time | The Postgres credential to connect through. Resolved server-side; secrets never reach the client or the run trace. |
| `query` | string (≤65,536) | at run time | Static SQL with `$1, $2, ...` placeholders. Never template-compiled — see the parameterization rule below. |
| `params` | string (≤65,536) | optional | JSON array of values bound positionally to the placeholders. String entries are template-compiled at run time; numbers, booleans, and null pass through as-is. |

The config schema is the single source of truth for the settings dialog and
the save boundary — see `src/nodes/postgres/query/definition.ts`.

## Parameterization rule

The statement text is **never rewritten**. `query` argvars are not supported:
value substitution happens only through `params`, which are bound as
PostgreSQL parameters (`$1`, `$2`, …).

```
query:  SELECT * FROM users WHERE id = $1 AND active = $2
params: ["{{data.userId}}", true]
```

is executed as `SELECT * FROM users WHERE id = $1 AND active = $2` with
`values = ["usr_123", true]` — a malicious payload cannot be concatenated into
the SQL.

## SSL mapping

The credential's `ssl` field maps onto the `pg` client as:

- `require` → `ssl: { rejectUnauthorized: false }`
- unset/`false` → `ssl: undefined` (plain connection)

Connection timeout is bounded at 10s and each statement at 30s, so a dead host
or a slow/locked query fails the run instead of hanging it.

## Result

The query outcome is stored under `variableName` as:

```
{
  "rows":   [{ "id": 1, "email": "ada@example.com" }, ...],
  "rowCount": 2,
  "truncated": false
}
```

`rows` is capped at 10,000 rows; when the result set is larger, `truncated` is
`true` and the rest is dropped. Reference the output downstream as
`{{queryResult.rows}}`, `{{queryResult.rowCount}}`, etc.

## Example

Load an active user's profile for a downstream step:

- `variableName`: `queryResult`
- `credentialId`: the `analytics` Postgres credential
- `query`:
  ```
  SELECT id, email, plan FROM users WHERE id = $1 AND active = $2
  ```
- `params`: `["{{data.userId}}", true]`

The downstream step can then read `{{queryResult.rows}}` or
`{{queryResult.rows.[0].email}}`.

## Rules

- The database password is read only inside the execute step and is never
  stored, logged, or traced (see `docs/architecture/security.md` §3).
- Query, credential, and variable name are required at run time; a missing
  field is a non-retriable config error, not a retry candidate.
- `params` must be a JSON array; anything else is rejected before the client
  connects.
- The SQL text never interpolates run values. If a dynamic statement is
  genuinely needed, build the pieces in upstream nodes and reference the
  finished statement via `{{...}}` in a later `params`-style field — do not
  hand-concatenate.