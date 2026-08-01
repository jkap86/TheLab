"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeading } from "@/features/shared";

/**
 * Sleeper username entry — the way into the manager tool.
 *
 * A real `<form>` rather than an input beside a click handler, so Enter submits
 * and the browser treats it as one control: that is how anyone typing a
 * username expects it to behave.
 */
export function ManagerSearch({ title }: { title: string }) {
  const [username, setUsername] = useState("");
  const router = useRouter();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = username.trim();
    if (value) router.push(`/manager/${encodeURIComponent(value)}/leagues`);
  };

  return (
    <div>
      <PageHeading
        title={title}
        lede="Look up a Sleeper manager to browse their leagues."
        className="mb-8"
      />

      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <label htmlFor="manager-username" className="sr-only">
          Sleeper username
        </label>
        <input
          id="manager-username"
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
          disabled={!username.trim()}
          className="rounded-lg border border-active/40 bg-active/10 px-5 py-2.5 font-medium text-active transition-colors hover:bg-active/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50 disabled:cursor-not-allowed disabled:border-foreground/10 disabled:bg-transparent disabled:text-foreground/25"
        >
          Search
        </button>
      </form>
    </div>
  );
}
