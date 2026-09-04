# X, LinkedIn, YouTube and Upload-Post

Four nodes for publishing to social platforms (AF-M10-22).

| Node | Credential | Account requirement |
|---|---|---|
| `X_POST` | `x.oauth2` | **paid API tier** — free is read-only |
| `LINKEDIN_POST` | `linkedin.oauth2` | app approved for *Share on LinkedIn* |
| `YOUTUBE_UPLOAD` | `google.youtube` | verified Cloud project for public uploads |
| `UPLOAD_POST_PUBLISH` | `uploadPost.apiKey` | Instagram Business/Creator account |

---

## The failures no credential can fix

Every node here carries an `accountRequirement`, rendered in the config panel.
That field exists because this family shares a failure mode the others don't:
a **403 that looks exactly like a scope problem but isn't**.

An X app on the free tier authenticates cleanly, holds every scope you asked
for, and returns 403 on every post — because v2 write endpoints are not sold at
that tier. No amount of reconnecting changes it. The same shape applies to
LinkedIn's product approval, YouTube's project verification, and Upload-Post's
Instagram account type.

So the requirement is stated while the node is being **configured**, not
discovered from a failed run, and the runtime errors name the tier before they
mention scopes.

---

## Media is streamed, never buffered

`readFile` returns a Buffer. That is correct for a PDF and wrong for a video: a
100 MB upload buffered whole is 100 MB of worker heap, and a handful of
concurrent runs is an OOM that takes every unrelated run on that worker with
it.

So the blob store gained `getStream`, `file-service` gained `readFileStream`
(with the **same tenant check** — a streaming variant that skipped it would be
a hole in exactly the place that matters), and the upload paths hand the stream
straight to `fetch`. The bytes go store → socket; peak memory is a chunk.

Two consequences worth knowing:

- **`duplex: "half"` is required.** Node's fetch throws without it when the
  body is a stream, and the message does not mention streaming.
- **A consumed stream cannot be re-sent.** Anything that retries has to re-open
  the file, which is why the upload helpers take a `fileId` rather than a
  stream.

### The real size ceiling

`MAX_FILE_BYTES` caps a **stored** file at 100 MB, and that binds long before
any platform limit. The per-node caps (2 GB for YouTube, 1 GB for Upload-Post)
are backstops for if that ceiling is ever raised — they are not what a workflow
hits today.

---

## X

**Length is counted the way X counts it.** X uses *weighted* characters: emoji
and most non-Latin characters count as two. `String.length` would let a post
through that X then rejects, and the rejection does not say by how much. The
node refuses early, with the weighted number in the message.

Media upload is a **different API** on a different host with a chunked
INIT/APPEND/FINALIZE protocol, so this node posts text and references media
uploaded elsewhere rather than pretending they are one call.

A post's id is also its thread anchor: pass it to a later node's `replyToId`.

Rate limits on the lower tiers are counted **per 24 hours**, so the retry wait
is long on purpose — a 30-second retry would just burn an attempt.

---

## LinkedIn

Posting an image is a **three-step dance**, and doing step 3 before step 2
finishes produces a post with a broken image and no error:

1. `registerUpload` → a one-time upload URL and an asset URN
2. PUT the bytes to that URL (different host, different auth, answers 201 empty)
3. Create the UGC post referencing the asset URN

That is why it is one function rather than three the caller sequences.

`X-Restli-Protocol-Version: 2.0.0` is required on every v2 call; without it
LinkedIn applies legacy response shaping and fields come back under different
names.

The upload URL is nested under a long versioned key, so the client reads the
first value rather than hardcoding it — a version bump would otherwise break
this with "cannot read property of undefined".

Access tokens expire after **60 days** and are not refreshed silently, which is
what the 401 message says.

---

## YouTube

**Resumable upload, and not because of resuming.** The simple endpoint takes
the whole file as one body and caps at 5 MB, which no real video is. Resumable
is two steps — announce metadata, get a session URL; then PUT the bytes — and
the second is where the stream goes.

The session URL is valid for a **week**, and re-PUTting to it resumes rather
than duplicating. That is what makes a failed upload safe to retry without
creating a second video, and why the announce is its own step.

Three things that fail with unhelpful messages otherwise:

- `X-Upload-Content-Length` and `X-Upload-Content-Type` are **required** by the
  protocol.
- `selfDeclaredMadeForKids` has been required of API clients since 2021;
  omitting it is a 400 that names no field.
- Angle brackets in a title are rejected with a 400 that names the field but
  not the character.

`uploadStatus` is returned because YouTube processes asynchronously —
"uploaded" is not "watchable".

The node defaults to `private`. An unverified project forces that anyway, and
finding out after a public upload is the worse order.

---

## Upload-Post

A broker: it holds the user's Instagram/TikTok connections and posts on their
behalf. It exists in this family because Instagram's own Graph API needs a
Business account, an app review and a Facebook Page, none of which a workflow
tool can shortcut.

**It answers HTTP 200 with a per-platform result map**, so a request that
"succeeded" can contain an Instagram entry that failed — the same trap as
Slack's `ok: false`, in a different shape. The node reports `published` and
`failed` separately: every platform failing is a failed run, and a partial
failure is reported rather than thrown, because two of three platforms is a
real outcome a workflow may want to branch on.

The profile name is the one created in the Upload-Post dashboard, not the
Instagram handle — which is what the 404 says.

One unavoidable buffer: `FormData` has no streaming entry in Node's fetch, so
the media is collected into a Blob for the multipart body. The stream still
means the file is read once, lazily, rather than being held twice.

---

## Related

- [Telegram and WhatsApp](messaging.md)
- [Apify, Apollo and Google Search/Maps](data-acquisition.md) — the other
  metered family
