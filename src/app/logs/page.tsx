import { notFound } from "next/navigation";

import { PageShell } from "@/features/shared";
import { LogsHome } from "@/features/logs";
import { logsAccess } from "@/shared/logs";

export const dynamic = "force-dynamic";

/**
 * `/logs` — the visit log.
 *
 * **Unlisted, and gated.** It is deliberately absent from
 * `features/tools/constants/tools.ts`, so it appears in neither the tool grid
 * nor the rack menu — the app it was ported from does the same, and there
 * obscurity is the *only* protection: its page and both its API routes are
 * open, so anyone who guesses the path reads every visitor's address and anyone
 * at all can write rows. Here the path is still unadvertised, but the gate is
 * the token.
 *
 * **A missing or wrong key is `notFound()`, not a 401.** The protection is that
 * the page does not appear to exist; a 401 would confirm that it does, which is
 * the only thing somebody guessing paths is trying to learn. `/api/logs` answers
 * the same way for the same reason.
 *
 * The token is read from the query string and handed to the client, which sends
 * it back on the read. That is the cost of not minting a session cookie for one
 * page: the key sits in the URL and therefore in browser history. It is a
 * bookmarkable page for one reader, and a cookie would need a route handler to
 * set it — a server component cannot.
 */
export default async function LogsPage({
  searchParams,
}: {
  // A Promise in Next 16 — the old synchronous object is gone.
  searchParams: Promise<{ key?: string | string[] }>;
}) {
  const { key } = await searchParams;
  // A repeated `?key=` arrives as an array. Take the first rather than joining:
  // a join would build a string that matches nothing and read as a wrong key,
  // which is the same answer but for the wrong reason.
  const supplied = Array.isArray(key) ? key[0] : key;

  const access = logsAccess(
    process.env,
    supplied,
    process.env.NODE_ENV === "production",
  );
  if (!access.ok) notFound();
  if (access.warning) console.warn(`[logs] ${access.warning}`);

  return (
    <PageShell width="console">
      <LogsHome
        heading={
          // Visible, unlike `/tools`' sr-only heading: the rack engraves "The
          // Lab" on every page but names no page, and this one is not reachable
          // from the menu, so without it the row is empty and nothing on screen
          // says what is being shown. Same mono eyebrow the lineup checker uses.
          <h1 className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
            Visitor logs
          </h1>
        }
        token={supplied ?? ""}
      />
    </PageShell>
  );
}
