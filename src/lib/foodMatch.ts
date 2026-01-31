export function normalizeFoodText(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
