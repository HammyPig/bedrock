/** Splits a search query into lowercase words, in whatever order the user typed them. */
export function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every token appears somewhere across the fields, in any order/field. */
export function matchesAllTokens(fields: string[], tokens: string[]): boolean {
  return tokens.every((token) => fields.some((field) => field.toLowerCase().includes(token)));
}

/** True when at least one token appears in this specific field (used to decide what to display). */
export function fieldMatchesAnyToken(field: string, tokens: string[]): boolean {
  const lower = field.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}
