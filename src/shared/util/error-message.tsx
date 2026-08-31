export function errorMessage(error: unknown): string | unknown;
export function errorMessage(error: unknown, fallback: string): string;
export function errorMessage(error: unknown, fallback?: string): unknown {
  if (error instanceof Error) return error.message;
  return fallback ?? error;
}