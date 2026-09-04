# 0025 — Binary payloads by reference, never by value

**Status:** Accepted (AF-M10-06); implemented 2026-09-03 in `src/features/files/`, `prisma/migrations/20260903150000_add_stored_file`.
**Companion:** ADR-0018 (bounded node output), ADR-0015 / ADR-0017 (guarded egress); `docs/architecture/data_model.md`.

## Context

**12 of M10's 35 reference automations move a PDF, an image or a video between nodes** — an invoice from Gmail into a Gemini extraction, a contract from Drive into a text extractor, a rendered video into YouTube.

`WorkflowContext` is `Record<string, unknown>`, JSON-serialized into `NodeExecution.output` and bounded by ADR-0018's per-node byte cap. A 3 MB invoice returned from a download node does not "work but slowly" — it fails the run at the output boundary, and the failure is attributed to the node that produced it rather than to the design that made it impossible. Base64 makes it worse: a 3 MB file becomes 4 MB of string, copied into every subsequent node's `{ ...context }`, so ADR-0018's quadratic-growth problem returns with a 4 MB multiplier.

There was also no blob dependency in `package.json` — nowhere for bytes to go even if the context could carry them.

## Decision

**1. What travels is a reference, not the bytes.**

```ts
{ $file: { id, filename, mimeType, size, sha256 } }
```

A few hundred bytes, so it moves through the context exactly like any other small value and cannot breach ADR-0018. The `$file` wrapper key is what lets a downstream node, the trace viewer or a template recognise "this is a file" without a schema; identification is structural, because a `FileRef` survives a JSON round trip through `NodeExecution.output` and comes back as a plain object.

`sha256` is on the reference rather than looked up because AF-M10-07 keys the AI response cache on it: two different invoices must not share a cache entry, and two copies of one should.

**2. One `BlobStore` interface, two implementations, no SDK type above it.**

`put`/`get`/`delete`/`exists`, `Buffer` in and out, string keys. `LocalBlobStore` (dev/CI) and `S3BlobStore` (any S3-compatible store: AWS, R2, MinIO, B2). The AWS SDK is imported lazily *inside* the S3 class, so a local install never loads it.

This is what makes the local store a real implementation rather than a mock — the file-service tests exercise the same code path production does, with no container and no network.

**3. Selection is by configuration present, not by `NODE_ENV`.**

S3 when `BLOB_S3_BUCKET` and its credentials are set; local otherwise. A production deployment that forgets the bucket would, under a `NODE_ENV` rule, silently write to a container filesystem that vanishes on the next deploy — and nobody finds out until a user opens a run from yesterday. A half-configured S3 (bucket, no credentials) in production is a boot error rather than a fallback, for the same reason.

**4. Keys carry the org prefix structurally: `<org>/<yyyy-mm>/<id>`.**

Not a convention a caller can forget. Keys are validated against a charset and rejected if they contain `..` or resolve outside the store root — a key reaches the filesystem as a path, and `..` in an object key is how one tenant would read another's files.

**5. Reading requires the org, and the org is not optional.**

A `FileRef` is a plain object in a run context, and a context can be built by a `CODE` node, a template, or a webhook body — all tenant-controlled. `readFile` takes `{ fileId, organizationId }` and refuses a mismatch. "Not found" and "belongs to someone else" return the **same** message: telling them apart turns the endpoint into an existence oracle for other tenants' files.

**6. Quota is checked before the write; the ceiling is per file and per org.**

100 MB per file, 5 GB per org by default, computed by summing rows rather than maintaining a counter someone forgets to decrement. Overshoot is bounded by one file rather than by however many runs are concurrent.

An **empty** file is refused outright. A zero-byte result is almost always a failed fetch reported as success, and storing it turns a loud failure into a silent one three nodes later.

**7. Blob lifetime is execution retention, with one explicit exception.**

`StoredFile.executionId` is `ON DELETE SET NULL`, not `CASCADE` — deliberately. The row must **outlive** its execution long enough for the sweep to delete the object too; cascading would make the database forget a file that is still occupying storage and being paid for.

The AF-M8-06 retention sweep therefore deletes a run's blobs *before* deleting the run, in the same batch. A file with no execution — an intake-form upload that arrives before any run exists — carries an explicit 48-hour `expiresAt` and is collected by a second, bounded stage.

**8. Objects are written before rows, and deleted before rows.**

Both orders are chosen so the survivable failure is the one that happens. A crash after `put` and before `create` leaves an orphaned object the sweep can find by key prefix. The other order leaves a row pointing at nothing, which every reader treats as data loss.

## Consequences

**Buys.** 12 automations become expressible. Node output stays small regardless of payload size, so ADR-0018's cap keeps meaning what it says. `FILE_DOWNLOAD` inherits the full egress guard — vetted host, pinned socket, re-vetted redirects — because it goes through `safeFetch` like every other outbound request.

**Costs.** A node that wants bytes must fetch them, which is a store round trip rather than a property read. Files are buffered whole in memory during transfer; AF-M10-22 (a video upload) will need a streaming path, and that is a change to the interface rather than to its callers.

Orphaned objects are possible in the crash window and are only reclaimed by a key-prefix sweep that does not exist yet — noted as a known gap rather than pretended away. The window is small and the failure is over-retention, not data loss.

**Forecloses.** Nothing. Streaming can be added as `putStream`/`getStream` alongside the buffered pair; the reference shape does not change.

## Alternatives considered

**Base64 in the context.** Rejected on arithmetic: 33% inflation, copied into every downstream node's context, against a 1 MiB per-node cap. It fails for a 1 MB PDF and the failure looks like a mysterious node error.

**Raise the ADR-0018 cap for file-carrying nodes.** Rejected — the cap exists because Inngest bounds a run's total retained state at 32 MB, which no per-node exception can move.

**A dedicated file-passing channel outside the context.** Considered: it avoids the `$file` wrapper. Rejected because a file would then be invisible to templates, to `SET`/`CODE`, and to the trace viewer — three places users need to see it.

**Store bytes in Postgres as `bytea`.** Rejected: it puts multi-megabyte blobs in the same table space as the rows every dashboard query scans, and makes retention a `VACUUM` problem.

**`CASCADE` on `executionId`.** Rejected, and it is the subtle one: it is the obvious choice, it looks tidier, and it silently leaks storage forever. The row is the only record of the object's key.
