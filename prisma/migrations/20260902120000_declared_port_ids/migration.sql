-- AF-M9-03 (gap G1). `Connection.fromOutput` / `toInput` are the node's declared
-- `PortDef.id` — that is the contract in `docs/architecture/node_sdk.md`, and it is
-- what the engine's `markTakenEdges` compares a branching node's `_outputPort`
-- against. The canvas, however, rendered ONE hardcoded handle pair per node
-- (`source-1` / `target-1`) and `saveGraph` persisted those literals verbatim.
--
-- Consequence for live data: a CONDITION emits `_outputPort = "true"`, no edge
-- ever had `fromOutput = 'true'`, so no edge was marked taken and the engine
-- marked the CONDITION's ENTIRE downstream `SKIPPED`. Every branching workflow
-- built in the editor has been silently doing nothing after the condition.
--
-- This rewrites the stored literals onto the real declared ports. Idempotent:
-- it matches only the legacy literals, so a second run updates zero rows.
--
-- The port ids below are a snapshot of the manifest at 2026-09-02, which is
-- correct for a migration: it repairs history, it does not track the registry.
-- At that date CONDITION is the only registered type whose first output is not
-- `main` (`true` / `false`); every other type is `main` in and `main` out.

-- 1. Inputs. Every registered type's first input port is `main`, and `main` is
--    also the fallback for a type the manifest no longer knows (the AF-M8-12
--    retired AI nodes), so this needs no per-type branching.
UPDATE "Connection"
   SET "toInput" = 'main'
 WHERE "toInput" = 'target-1';

-- 2. Outputs, non-branching types. Same reasoning as inputs.
UPDATE "Connection" c
   SET "fromOutput" = 'main'
  FROM "Node" n
 WHERE c."fromNodeId" = n."id"
   AND c."fromOutput" = 'source-1'
   AND n."type" <> 'CONDITION';

-- 3. Outputs from a CONDITION, but ONLY where that node has a single legacy
--    outgoing edge. One edge is unambiguous: the author drew the only line the
--    canvas allowed, and the affirmative branch is what they meant — it maps to
--    `true`, the first declared output, which is also what the append
--    affordance now produces.
--
--    A CONDITION with two or more legacy edges is NOT resolvable: both were
--    drawn from the same rendered handle, so nothing recorded which was meant
--    to be the false branch. Rewriting both to `true` would invent a graph the
--    author never drew and make the run take both paths. Those rows are left
--    exactly as they are and reported below, so a human reconnects them.
UPDATE "Connection" c
   SET "fromOutput" = 'true'
  FROM "Node" n
 WHERE c."fromNodeId" = n."id"
   AND c."fromOutput" = 'source-1'
   AND n."type" = 'CONDITION'
   AND (
     SELECT COUNT(*)
       FROM "Connection" c2
      WHERE c2."fromNodeId" = c."fromNodeId"
        AND c2."fromOutput" = 'source-1'
   ) = 1;

-- 4. Report whatever could not be resolved. A NOTICE keeps the migration
--    non-destructive and replayable while still being impossible to miss in the
--    deploy log — the alternative, failing the migration, would block a deploy
--    on a graph the operator may not own.
DO $$
DECLARE
  ambiguous_edges  BIGINT;
  ambiguous_nodes  BIGINT;
  leftover_handles BIGINT;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT c."fromNodeId")
    INTO ambiguous_edges, ambiguous_nodes
    FROM "Connection" c
    JOIN "Node" n ON n."id" = c."fromNodeId"
   WHERE c."fromOutput" = 'source-1'
     AND n."type" = 'CONDITION';

  SELECT COUNT(*)
    INTO leftover_handles
    FROM "Connection"
   WHERE "fromOutput" IN ('source-1', 'target-1')
      OR "toInput" IN ('source-1', 'target-1');

  IF ambiguous_edges > 0 THEN
    RAISE NOTICE
      'AF-M9-03: % edge(s) across % CONDITION node(s) left on the legacy "source-1" handle because the node has more than one outgoing edge and nothing recorded which was the false branch. Those branches did not execute before this migration either. Reconnect them in the editor: SELECT c.id, c."fromNodeId", c."toNodeId" FROM "Connection" c JOIN "Node" n ON n.id = c."fromNodeId" WHERE c."fromOutput" = ''source-1'' AND n.type = ''CONDITION'';',
      ambiguous_edges, ambiguous_nodes;
  END IF;

  IF leftover_handles > ambiguous_edges THEN
    RAISE NOTICE
      'AF-M9-03: % row(s) still carry a legacy handle id beyond the ambiguous CONDITION edges above. Inspect before assuming the migration is complete.',
      leftover_handles - ambiguous_edges;
  END IF;
END $$;
