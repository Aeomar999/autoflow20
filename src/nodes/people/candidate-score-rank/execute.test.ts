import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools, WorkflowContext } from "@/nodes/types";
import { execute } from "./execute";

/**
 * `execute` returns `WorkflowContext` (`Record<string, unknown>`), so a field
 * read off the stored result is `unknown`. Narrowed once here rather than cast
 * at each assertion, so the assertions stay readable and the shape is stated
 * in one place (AF-M11-15).
 */
const shortlistIn = (result: WorkflowContext) =>
  result.shortlist as {
    ranking: {
      name: string;
      scores: Record<string, number>;
      totalScore: number;
      rank: number;
    }[];
    rubric: unknown;
  };

const rubric = [
  { key: "skills", label: "Skills fit", weight: 0.6 },
  { key: "culture", label: "Culture fit", weight: 0.4 },
];

describe("CANDIDATE_SCORE_RANK execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("scores, ranks and stores candidates under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "shortlist",
          candidatesJson: JSON.stringify([
            { name: "Ada", scores: { skills: 9, culture: 7 } },
            { name: "Ben", scores: { skills: 7, culture: 9 } },
          ]),
          rubric,
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result).toEqual({
      shortlist: {
        ranking: [
          {
            name: "Ada",
            scores: { skills: 9, culture: 7 },
            totalScore: 8.2,
            rank: 1,
          },
          {
            name: "Ben",
            scores: { skills: 7, culture: 9 },
            totalScore: 7.8,
            rank: 2,
          },
        ],
        rubric,
      },
    });
  });

  it("breaks score ties alphabetically by name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "shortlist",
          candidatesJson: JSON.stringify([
            { name: "Zoe", scores: { skills: 5, culture: 5 } },
            { name: "Ava", scores: { skills: 5, culture: 5 } },
          ]),
          rubric,
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(
      shortlistIn(result).ranking.map((c: { name: string }) => c.name),
    ).toEqual(["Ava", "Zoe"]);
  });

  it("resolves the candidates from a template expression", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "shortlist",
          candidatesJson: "{{{json pool}}}",
          rubric,
        },
        userId: "user-1",
        context: {
          pool: [{ name: "Ada", scores: { skills: 8, culture: 8 } }],
        },
        step,
        publish,
      }),
    );

    expect(shortlistIn(result).ranking[0]).toEqual({
      name: "Ada",
      scores: { skills: 8, culture: 8 },
      totalScore: 8,
      rank: 1,
    });
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { candidatesJson: "[]", rubric },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: Variable name is missing",
      ),
    );
  });

  it("rejects an empty rubric", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "shortlist", candidatesJson: "[]" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: No rubric criteria configured",
      ),
    );
  });

  it("rejects a rubric where every weight is zero", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "shortlist",
            candidatesJson: "[]",
            rubric: [
              { key: "skills", label: "Skills fit", weight: 0 },
              { key: "culture", label: "Culture fit", weight: 0 },
            ],
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: at least one rubric criterion must have a non-zero weight",
      ),
    );
  });

  it("rejects invalid JSON", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "shortlist",
            candidatesJson: "not json",
            rubric,
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: the candidates expression is not valid JSON",
      ),
    );
  });

  it("rejects a candidates expression that is not an array", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "shortlist", candidatesJson: "{}", rubric },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: the candidates expression must resolve to a JSON array",
      ),
    );
  });

  it("rejects a candidates expression that resolves to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "shortlist", candidatesJson: "{{pool}}" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: the candidates expression resolved to nothing.",
      ),
    );
  });

  it("rejects more than 1000 candidates", async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({
      name: `Candidate ${i}`,
      scores: { skills: 1, culture: 1 },
    }));
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "shortlist",
            candidatesJson: JSON.stringify(tooMany),
            rubric,
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: no more than 1000 candidates can be ranked",
      ),
    );
  });

  it("rejects a malformed candidate entry", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "shortlist",
            candidatesJson: JSON.stringify([{ name: "Ada" }]),
            rubric,
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Candidate Score Rank node: candidate "Ada" is missing a scores object',
      ),
    );
  });

  it("rejects a candidate without a name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "shortlist",
            candidatesJson: JSON.stringify([
              { scores: { skills: 5, culture: 5 } },
            ]),
            rubric,
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Score Rank node: candidate at index 0 is missing a name",
      ),
    );
  });

  it("rejects a candidate missing a rubric score", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "shortlist",
            candidatesJson: JSON.stringify([
              { name: "Ada", scores: { skills: 9 } },
            ]),
            rubric,
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        'Candidate Score Rank node: candidate "Ada" has no score for criterion "culture"',
      ),
    );
  });
});
