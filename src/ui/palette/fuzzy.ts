/**
 * Fuzzy matcher for the command palette (R7.11): subsequence matching with
 * positional scoring — consecutive-character and word-start bonuses rank
 * "نام" above "نامشروع", and exact prefix hits rank highest.
 *
 * RTL/Persian-aware by construction: matching is per Unicode code point,
 * so Persian text works identically (no locale-specific casing tricks
 * beyond case-insensitivity for Latin).
 */

/** One scored match. */
export interface FuzzyMatch<T> {
  /** The matched item. */
  readonly item: T;
  /** The relevance score (higher = better; 0 = no match). */
  readonly score: number;
}

/**
 * Normalises a string for matching (casefold + whitespace collapse).
 *
 * @param value - the raw string.
 * @returns the normalised form.
 */
function normalise(value: string): string {
  return value.trim().toLocaleLowerCase("fa-IR").replace(/\s+/g, " ");
}

/**
 * Scores a candidate against a query (subsequence with bonuses). Both
 * sides are normalised first, so callers can pass raw display strings.
 *
 * @param candidate - the raw candidate text.
 * @param query - the raw query string.
 * @returns the score (0 = no match).
 */
export function fuzzyScore(candidate: string, query: string): number {
  const normalisedCandidate = normalise(candidate);
  const normalisedQuery = normalise(query);
  const candidateText = normalisedCandidate;
  const queryText = normalisedQuery;
  if (queryText.length === 0) {
    return 1;
  }
  if (candidateText === queryText) {
    return 1000;
  }
  if (candidateText.startsWith(queryText)) {
    return 800;
  }
  let score = 0;
  let searchFrom = 0;
  let streak = 0;
  for (const char of queryText) {
    const found = candidateText.indexOf(char, searchFrom);
    if (found === -1) {
      return 0;
    }
    streak = found === searchFrom ? streak + 1 : 0;
    // Consecutive-character bonus (compounding).
    score += 10 + streak * 8;
    // Word-start bonus: the char begins a word.
    if (found === 0 || /\s/.test(candidateText[found - 1] ?? "")) {
      score += 12;
    }
    searchFrom = found + 1;
  }
  // Shorter candidates rank higher at equal hit quality.
  score += Math.max(0, 40 - candidateText.length / 4);
  return score;
}

/**
 * Filters + ranks items by their extracted text.
 *
 * @param items - the items to filter.
 * @param query - the raw query string.
 * @param textOf - extracts the searchable text of one item.
 * @returns the matches sorted by descending score (stable on ties).
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): readonly FuzzyMatch<T>[] {
  const matches: FuzzyMatch<T>[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(textOf(item), query);
    if (score > 0) {
      matches.push({ item, score: score + (items.length - index) / 1000 });
    }
  });
  matches.sort((a, b) => b.score - a.score);
  return matches;
}
