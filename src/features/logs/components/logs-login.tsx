"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { CONSOLE_KEY, CONSOLE_WELL } from "@/features/shared";

import type { ApiErrorPayload } from "@/shared/contract";

/**
 * The visit log's sign-in.
 *
 * One password field and one key. The credential goes to
 * `POST /api/logs/session` as a JSON body — never into the URL, never into
 * storage — and on a 200 the server page is refreshed, which is what turns
 * this form into the table: the cookie the response set is what the page
 * reads. The field is cleared on success and left on a failure, and a 429 is
 * named as what it is with the wait it carries, so a reader who has been
 * locked out is not left retyping into a refusal.
 */
export function LogsLogin({ heading }: { heading: ReactNode }) {
  const router = useRouter();
  const id = useId();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || token.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/logs/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) {
        setToken("");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiErrorPayload | null;
      if (res.status === 429) {
        const wait = res.headers.get("retry-after");
        setError(`Too many attempts. Try again in ${wait ?? "a few"} seconds.`);
      } else {
        setError(body?.error ?? `Sign-in failed (${res.status})`);
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="py-8">
      <div className="flex flex-wrap items-center gap-3">{heading}</div>
      <form onSubmit={submit} className={`${CONSOLE_WELL} mt-6 max-w-md p-3`}>
        <label
          htmlFor={id}
          className="mb-1 block font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/60"
        >
          Access token
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={id}
            type="password"
            name="token"
            autoComplete="current-password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
            className="min-w-0 flex-1 basis-48 rounded-[0.5rem] border border-black/85 bg-[image:var(--readout-bg)] px-3 py-2 text-[length:var(--fs-13)] text-readout shadow-[var(--window-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          />
          <button
            type="submit"
            aria-disabled={pending || token.length === 0}
            className={CONSOLE_KEY}
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </div>
        <p
          id={`${id}-error`}
          role="status"
          className="mt-3 min-h-5 font-mono text-[length:var(--fs-11)] text-error"
        >
          {error ?? ""}
        </p>
      </form>
    </div>
  );
}
