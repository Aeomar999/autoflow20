import "server-only";

import { NonRetriableError } from "inngest";
import type { z } from "zod";
import type { NodeRun } from "@/nodes/types";
import type { rubricItemSchema } from "./definition";

/**
 * The config as AUTHORED, not as parsed: `execute` reads the saved node config
 * directly, so a field the schema fills with `.default()` may legitimately be
 * absent here. `z.infer` is `z.output` and would declare it required, which is
 * why the executor's own `?? ...` fallbacks looked redundant (AF-M11-15).
 */
type RubricItem = z.input<typeof rubricItemSchema>;

type CandidateScore = {
  name: string;
  scores: Record<string, number>;
  totalScore: number;
  rank: number;
};

export type CandidateScoreRankData = {
  variableName?: string;
  candidatesJson?: string;
  rubric?: RubricItem[];
};

type CandidateInput = {
  name?: unknown;
  scores?: unknown;
};

export const execute: NodeRun<CandidateScoreRankData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Candidate Score Rank node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  if (!data.candidatesJson?.trim()) {
    throw new NonRetriableError(`${where}: Candidates JSON is missing`);
  }
  const candidatesJson = resolve(data.candidatesJson).trim();
  if (!candidatesJson) {
    throw new NonRetriableError(
      `${where}: the candidates expression resolved to nothing.`,
    );
  }

  const rubric = data.rubric ?? [];
  if (rubric.length === 0) {
    throw new NonRetriableError(`${where}: No rubric criteria configured`);
  }
  if (rubric.every((criterion) => criterion.weight === 0)) {
    throw new NonRetriableError(
      `${where}: at least one rubric criterion must have a non-zero weight`,
    );
  }
  const totalWeight = rubric.reduce(
    (sum, criterion) => sum + criterion.weight,
    0,
  );

  const ranking = await step.run("score-and-rank-candidates", async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidatesJson);
    } catch {
      throw new NonRetriableError(
        `${where}: the candidates expression is not valid JSON`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new NonRetriableError(
        `${where}: the candidates expression must resolve to a JSON array`,
      );
    }
    if (parsed.length > 1000) {
      throw new NonRetriableError(
        `${where}: no more than 1000 candidates can be ranked`,
      );
    }

    const scored: CandidateScore[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const candidate = parsed[i] as CandidateInput;
      if (typeof candidate !== "object" || candidate === null) {
        throw new NonRetriableError(
          `${where}: candidate at index ${i} is not an object`,
        );
      }
      if (typeof candidate.name !== "string" || !candidate.name.trim()) {
        throw new NonRetriableError(
          `${where}: candidate at index ${i} is missing a name`,
        );
      }
      if (typeof candidate.scores !== "object" || candidate.scores === null) {
        throw new NonRetriableError(
          `${where}: candidate "${candidate.name}" is missing a scores object`,
        );
      }

      const scores = candidate.scores as Record<string, unknown>;
      const normalizedScores: Record<string, number> = {};
      let totalScore = 0;
      for (const criterion of rubric) {
        const rawScore = scores[criterion.key];
        if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
          throw new NonRetriableError(
            `${where}: candidate "${candidate.name}" has no score for criterion "${criterion.key}"`,
          );
        }
        normalizedScores[criterion.key] = rawScore;
        totalScore += rawScore * criterion.weight;
      }

      const weighted = totalWeight > 0 ? totalScore / totalWeight : totalScore;
      scored.push({
        name: candidate.name,
        scores: normalizedScores,
        totalScore: Math.round(weighted * 100) / 100,
        rank: 0,
      });
    }

    scored.sort((a, b) => {
      const byScore = b.totalScore - a.totalScore;
      if (byScore !== 0) return byScore;
      return a.name.localeCompare(b.name);
    });
    scored.forEach((candidate, index) => {
      candidate.rank = index + 1;
    });

    return scored;
  });

  return {
    ...context,
    [variableName]: { ranking, rubric },
  };
};
