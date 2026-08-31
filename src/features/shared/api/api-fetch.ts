import { ApiErrorPayload } from "@/shared/contract";

export async function apiFetch(
  url: string,
  init: RequestInit & { fallbackError?: string } = {},
): Promise<Response> {
  const { fallbackError = "Request failed", ...requestInit } = init;

  const res = await fetch(url, requestInit);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorPayload | null;
    throw new Error(body?.error ?? `${fallbackError} (${res.status})`);
  }
  return res;
}