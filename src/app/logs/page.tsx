import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { PageShell } from "@/features/shared";
import { LogsHome, LogsLogin } from "@/features/logs";
import { LOGS_SESSION_COOKIE, logsAccess } from "@/shared/logs";

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
 * a session.
 *
 * **The credential is never on this page.** It was a query parameter once — read off the
 * query string and handed to the client as a prop, which put it in browser
 * history, in the page's own HTML and, the reason it moved, in Heroku's router
 * logs. It is entered once now, in `LogsLogin`, posted to
 * `/api/logs/session`, and what comes back is an HttpOnly cookie this page
 * reads through `cookies()` and never sees the value of beyond "is it a live
 * session".
 *
 * **Unconfigured in production is `notFound()`**, so the page does not appear
 * to exist; an unauthenticated visit to a configured deployment is the sign-in
 * form, which is the one place the page's existence is admitted — a form that
 * pretended to be a 404 would be a page nobody could sign in to.
 */
export default async function LogsPage() {
  const store = await cookies();
  const access = logsAccess(
    process.env,
    store.get(LOGS_SESSION_COOKIE)?.value,
    process.env.NODE_ENV === "production",
  );
  if (!access.ok && access.reason === "denied") notFound();
  if (access.ok && access.warning) console.warn(`[logs] ${access.warning}`);

  const heading = (
    // Visible, unlike `/tools`' sr-only heading: the rack engraves "The Lab" on
    // every page but names no page, and this one is not reachable from the
    // menu, so without it the row is empty and nothing on screen says what is
    // being shown. Same mono eyebrow the lineup checker uses.
    <h1 className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
      Visitor logs
    </h1>
  );

  return (
    <PageShell width="console">
      {access.ok ? (
        // A sign-out key only where there is a session to end: an open
        // development page has none.
        <LogsHome heading={heading} canSignOut={access.expiresAt !== undefined} />
      ) : (
        <LogsLogin heading={heading} />
      )}
    </PageShell>
  );
}
