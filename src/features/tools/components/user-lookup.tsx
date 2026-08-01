"use client";

import { useEffect, useRef, useState } from "react";

import type { UserInfo } from "@/shared/contract";
import { errorMessage } from "@/shared/util";

import { Avatar, apiFetch, isAbortError } from "@/features/shared";

/**
 * Sleeper username entry that resolves in place rather than navigating.
 *
 * Unlike `ManagerSearch` and `PicktrackerSearch` — which hand what you typed to
 * a route and let the destination resolve it — this one is the destination: it
 * asks `/api/user/[username]` who that is and shows the answer here, so the
 * account is confirmed (right avatar, right spelling) before any tool is picked.
 * That is also why the lookup is worth a request at all: Sleeper accepts a user
 * id as readily as a name, so what you typed is not proof of who you meant.
 *
 * The resolved user is lifted to `ToolsHome` rather than held here, because the
 * tools below now read it — the pick tracker card lists this account's leagues.
 * Only the resolved identity is controlled; the search box text and the
 * in-flight/error state stay local, since nothing else needs them.
 *
 * A real `<form>` for the same reason as the other two: Enter submits, and the
 * browser treats input and button as one control.
 *
 * The card carries no margin of its own — it is pinned inside `ToolsHome`'s
 * plate, and spacing around a pinned part belongs to the thing doing the
 * pinning (the same split `PageHeading` makes).
 */
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

  return (
    <section className="rounded-2xl border border-foreground/12 bg-foreground/[0.04] p-6 shadow-[0_24px_60px_-34px_rgba(0,0,0,0.7)] backdrop-blur-xl">
      <h2 className="mb-4 font-display text-[11px] font-medium uppercase tracking-[0.28em] text-active/80">
        Your Sleeper account
      </h2>

      {user ? (
        <div className="flex items-center gap-4">
          <Avatar
            url={user.avatar_url}
            name={user.display_name || user.username}
            size="xl"
          />
          <div className="min-w-0 flex-1">
            {/* Sleeper lets a display name go missing, and falls back to the
                username itself — the same pairing `ManagerHeader` shows. */}
            <p className="truncate font-display text-2xl font-semibold tracking-tight">
              {user.display_name || user.username}
            </p>
            <p className="text-sm text-foreground/45">@{user.username}</p>
          </div>
          {/* This account is resolved (right avatar, right spelling) — the whole
              point of looking it up before a tool is picked — so it reads as a
              live connection. The dot's expanding ring animates via `tools-pulse`
              and freezes under reduced motion (`.lab-anim`). */}
          <span className="hidden shrink-0 items-center gap-2 text-xs text-foreground/55 sm:inline-flex">
            <span
              className="lab-anim h-1.5 w-1.5 rounded-full bg-active"
              style={{ animation: "tools-pulse 2.4s ease-out infinite" }}
            />
            Connected
          </span>
          <button
            type="button"
            onClick={handleChange}
            className="shrink-0 rounded-lg border border-foreground/15 px-4 py-2 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50"
          >
            Change
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-3"
        >
          <label htmlFor="tools-username" className="sr-only">
            Sleeper username
          </label>
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
            className="min-w-0 flex-1 rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-2.5 text-base placeholder:text-foreground/35 focus:border-active/50 focus:outline-none focus:ring-1 focus:ring-active/40"
          />
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="rounded-lg border border-active/40 bg-active/10 px-5 py-2.5 font-medium text-active transition-colors hover:bg-active/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50 disabled:cursor-not-allowed disabled:border-foreground/10 disabled:bg-transparent disabled:text-foreground/25"
          >
            {loading ? "Finding…" : "Find"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
