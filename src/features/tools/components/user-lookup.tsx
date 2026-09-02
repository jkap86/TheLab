"use client";

import { useEffect, useRef, useState } from "react";

import type { UserInfo } from "@/shared/contract";

import { apiFetch, errorMessage, isAbortError } from "@/features/shared";

import { AccountReadout } from "./account-readout";

export function UserLookup({
  user,
  onUserChange,
}: {
  user: UserInfo | null;
  onUserChange: (user: UserInfo | null) => void;
}) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Nothing below is worth doing once this is gone, and the abort is what stops
  // a resolved user landing in state after unmount.
  useEffect(() => () => inFlight.current?.abort(), []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = username.trim();
    if (!value) return;

    // Submitting again while the first lookup is out would otherwise race, and
    // the slower response would win regardless of which was asked for last.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/user/${encodeURIComponent(value)}`, {
        signal: controller.signal,
        fallbackError: "Failed to look that username up",
      });
      const json = (await res.json()) as UserInfo;
      onUserChange(json);
      setLoading(false);
    } catch (err: unknown) {
      // An abort means a newer lookup (or unmount) has taken over the state,
      // including the loading flag — leaving it alone is the point.
      if (isAbortError(err)) return;
      setError(errorMessage(err, "Something went wrong"));
      setLoading(false);
    }
  };

  const handleChange = () => {
    inFlight.current?.abort();
    onUserChange(null);
    setError(null);
  };

  // Resolved and unresolved are different objects now, not two states of one
  // card: the readout is an instrument reporting a value, and the lookup is the
  // control you use when it has none.
  if (user) {
    return (
      <div className="flex flex-col items-end gap-2">
        <AccountReadout user={user} onChange={handleChange} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <form
        onSubmit={handleSubmit}
        className="flex w-full items-center rounded-full border border-foreground/8 bg-[image:var(--key-bg)] p-1.5 shadow-[var(--plate-shadow)] sm:w-auto"
      >
        <label htmlFor="tools-username" className="sr-only">
          Sleeper username
        </label>
        {/* The window shrinks with the row below `sm` and takes the design's
            fixed width above it: a `w-56` input is wider than the panel's
            content box on a phone, and the row has no other slack to give. */}
        <div className="relative flex min-w-0 flex-1 items-center overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)] sm:flex-none">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
          />
          <input
            id="tools-username"
            type="text"
            name="username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Sleeper username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="relative w-full min-w-0 bg-transparent px-4 py-2 font-mono text-[0.9375rem] text-readout placeholder:text-foreground/35 focus:outline-none sm:w-56"
          />
        </div>

        <span
          aria-hidden
          className="mx-2 my-[0.1875rem] w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
        />

        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="shrink-0 rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-4 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/80 shadow-[var(--key-shadow)] transition-[transform,box-shadow,color] duration-150 hover:text-readout active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 disabled:cursor-not-allowed disabled:text-foreground/25 disabled:shadow-[var(--key-shadow-pressed)] disabled:active:translate-y-0"
        >
          {loading ? "Finding…" : "Find"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
