/**
 * Marks a describe block as checked by a human reviewer on `date` (YYYY-MM-DD)
 * as correct, intended behaviour, so a failure points at the app before the
 * test. Only add it when a human asks; see Tests in `.claude/CLAUDE.md`.
 */
export function verified(date: string) {
  return { annotation: { type: "verified", description: date } };
}
