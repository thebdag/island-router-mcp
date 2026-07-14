/** Truncate long text with an AXI-style size hint. */
export function truncateText(
  text: string,
  limit = 800,
): { text: string; truncated: boolean; totalChars: number } {
  const totalChars = text.length;
  if (totalChars <= limit) {
    return { text, truncated: false, totalChars };
  }
  const preview = text.slice(0, limit).trimEnd();
  return {
    text: `${preview}\n... (truncated, ${totalChars} chars total — use --full to see complete body)`,
    truncated: true,
    totalChars,
  };
}

export function truncateLine(text: string, limit = 80): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

/** Pick a minimal field subset for list rows. */
export function pickFields<T extends Record<string, unknown>>(
  row: T,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in row) out[field] = row[field];
  }
  return out;
}

export function parseFieldsFlag(
  value: string | boolean | undefined,
  defaults: string[],
): string[] {
  if (typeof value !== "string" || !value.trim()) return defaults;
  return value.split(",").map((f) => f.trim()).filter(Boolean);
}
