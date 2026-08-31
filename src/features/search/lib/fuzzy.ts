import type { SearchResult } from "./types";

/**
 * Fuzzy ranking for the command palette (AF-M7-07).
 *
 * Pure and dependency-free so it is unit-testable and adds nothing to the
 * bundle. The server decides *what* is visible to this tenant; this decides
 * only what order it appears in (design decision locked 2026-08-30 — the
 * palette ranks, it does not filter for permissions).
 */

/** Not a match. Distinct from 0, which is a legitimate weak match. */
export const NO_MATCH = -1;

/**
 * Score `text` against `query` as a subsequence match.
 *
 * Higher is better. The weighting is deliberate: a user typing "wf" wants
 * "WorkFlow" before "sWiFt", so consecutive characters and matches at word
 * boundaries are worth more than scattered hits. An exact prefix wins
 * outright, because someone who typed the beginning of a name is looking for
 * that name.
 */
export function fuzzyScore(text: string, query: string): number {
  if (query.length === 0) return 0;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 900 - haystack.length;

  const wordStart = haystack.indexOf(` ${needle}`);
  if (wordStart !== NO_MATCH) return 800 - wordStart;

  const substring = haystack.indexOf(needle);
  if (substring !== NO_MATCH) return 700 - substring;

  // Subsequence: every needle character in order, not necessarily adjacent.
  let score = 0;
  let textIndex = 0;
  let previousMatch = NO_MATCH;

  for (const char of needle) {
    const found = haystack.indexOf(char, textIndex);
    if (found === NO_MATCH) return NO_MATCH;

    if (found === previousMatch + 1) {
      score += 10; // consecutive
    } else if (found === 0 || haystack[found - 1] === " ") {
      score += 8; // word boundary
    } else {
      score += 1;
    }

    previousMatch = found;
    textIndex = found + 1;
  }

  // Shorter names win ties: "Slack" should beat "Slack approval gate copy 3".
  return score - haystack.length / 100;
}

/** Score against title and subtitle, keeping whichever matched better. */
function scoreResult(result: SearchResult, query: string): number {
  const titleScore = fuzzyScore(result.title, query);
  if (!result.subtitle) return titleScore;

  // A subtitle match is a weaker signal than a title match — it is context,
  // not the thing's name — so it is discounted rather than treated as equal.
  const subtitleScore = fuzzyScore(result.subtitle, query);
  const discounted = subtitleScore === NO_MATCH ? NO_MATCH : subtitleScore / 2;
  return Math.max(titleScore, discounted);
}

/**
 * Rank results, dropping non-matches. Stable for equal scores, so an empty
 * query leaves the server's own ordering (most recent first) intact.
 */
export function rankResults(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  if (query.trim().length === 0) return results;

  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreResult(result, query),
    }))
    .filter((entry) => entry.score !== NO_MATCH)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.result);
}
