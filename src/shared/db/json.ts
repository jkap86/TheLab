/** Serialize a value for a JSONB column parameter (null/undefined stay null). */
export const jsonb = (v: unknown): string | null =>
  v == null ? null : JSON.stringify(v);
