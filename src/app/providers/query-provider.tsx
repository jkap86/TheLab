"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { createQueryClient } from "@/features/shared";

/**
 * The app's one query client, mounted at the root.
 *
 * At the root rather than around the manager subtree, for the reason the account
 * store is global: `/manager/[searched]`'s layout is remounted on the way out to
 * another tool and back, and a client created there would take the cache with it
 * — which is most of what this exists to prevent. One client for the whole
 * session, shared by every tool that reads through it.
 *
 * `useState` with an initialiser rather than a module-level client: a module
 * client is created once per *process*, which on the server is once per
 * deployment shared by every visitor, so one user's leagues could be served to
 * the next. Per component instance it is per browser session, created once and
 * never re-created on a render.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
