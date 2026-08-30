# Knowledge Base & Retrieval (`ai.retrieve`)

AutoFlow's Knowledge Base subsystem provides document ingestion, chunking, and semantic vector search via PostgreSQL **pgvector** to ground LLM reasoning in workspace data (RAG).

- **Type id** (persisted in `Node.type`): `AI_RETRIEVE`
- **Category**: AI
- **Icon**: `BookOpen` (lucide)
- **Credential**: `openai.apiKey` (optional; falls back to workspace default OpenAI key)
- **Since**: M-KB (AF-KB-01 through AF-KB-05)

---

## 1. Node Config Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `variableName` | string | required | Key the retrieved context is stored under in the run context. |
| `query` | string (≤100,000) | required | Search query or question. Supports `{{variables}}` templates (e.g. `{{$json.question}}`). |
| `sourceIds` | string (≤1,024) | optional | Comma-separated Knowledge Source IDs to search. When omitted, all user sources are searched. |
| `topK` | number (1–20) | `4` | Maximum number of most relevant chunks to return. |
| `minSimilarity` | number (0.0–1.0) | `0.5` | Minimum cosine similarity score threshold (0.5 = 50% match). |
| `credentialId` | string | optional | OpenAI API credential used to embed the query vector. |

---

## 2. Ingestion & Storage Lifecycle

Documents uploaded or synced via the Knowledge Base UI (`/knowledge`) move through an asynchronous Inngest pipeline:

1. **Ingestion & Extraction**:
   - `PDF`: binary text extraction via `pdf-parse`.
   - `DOCX`: word processing XML extraction via `mammoth`.
   - `TXT` / `MD`: direct UTF-8 decoding.
   - `URL`: SSRF-protected egress fetch (`assertSafeEndpoint`), script/style stripping, entity decoding, and text normalization.
2. **Chunking**:
   - Recursive character chunker with hierarchical boundary splits (paragraphs → sentences → clauses → words).
   - Target chunk size: ~1,000 characters (~250 tokens), with 150-character overlap between adjacent chunks.
3. **Embeddings & Vector Storage**:
   - Chunks are embedded in batches using OpenAI `text-embedding-3-small` (1536 dimensions).
   - Chunks and vector embeddings are persisted to PostgreSQL `KnowledgeChunk` with an **HNSW** index (`vector_cosine_ops`).
   - Version history: chunks are tagged with the source `revision`.

---

## 3. PostgreSQL pgvector Runbook

### Neon & Production
Neon supports `pgvector` out of the box. The migration `20260829120000_knowledge_base_pgvector` enables the extension:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Local Docker Postgres
For local testing, run a Postgres image with pgvector enabled:
```bash
docker run -d --name autoflow-pgvector -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=autoflow -p 5432:5432 pgvector/pgvector:pg16
```
