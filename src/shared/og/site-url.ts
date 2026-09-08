/**
 * Where this app is served from, decided once and testably.
 *
 * Pure — the environment arrives as an argument — so the production rule can be
 * checked without setting `NODE_ENV` in a test process. It is `db/config.ts`'s
 * shape, for its reason.
 *
 * **This exists for `metadataBase`, and the failure it prevents is silent.**
 * Without a base, Next emits a *relative* `og:image`, and several scrapers —
 * iMessage among them — resolve that against the wrong origin and show no
 * preview at all. Nothing about the page looks broken; the card simply never
 * appears, in the one place nobody is watching a log.
 *
 * **`SITE_URL` has to be set in the *build* environment, not only at runtime**,
 * and that is the part most likely to be got wrong. A statically prerendered
 * page — which is most of this app — has its `<meta>` written at build time, so
 * the origin is baked in then. Verified: with the variable set only at runtime,
 * `/tools` still shipped `og:image` at `http://localhost:3000` while
 * `/picktracker/[leagueId]`, which is `force-dynamic`, resolved correctly.
 */

/** The variable every path here is about. */
export const SITE_URL_ENV = "SITE_URL";

/**
 * Next's own default when `metadataBase` is unset. Keeping it as the fallback
 * means an unconfigured deployment is no worse off than it is today — it just
 * says so.
 */
const DEV_ORIGIN = "http://localhost:3000";

export type SiteUrlResolution = {
  url: string;
  /** Set where the value was guessed rather than configured, and it matters. */
  warning?: string;
};

/**
 * Resolve the public origin.
 *
 * A missing variable is **not fatal**, unlike `DATABASE_URL`: refusing to boot
 * over an unfurl would be worse than the unfurl. In development it is not even
 * a warning — a checkout with no `.env` should render pages, and localhost is
 * genuinely where it is served from. In production it is a warning naming the
 * variable, because there the guess is wrong and the only symptom is a link
 * that stops previewing.
 *
 * A value with no scheme is read as `https://`, since that is the only thing a
 * bare hostname in a deployment config can mean, and a `new URL("thelab.app")`
 * throws.
 */
export function resolveSiteUrl(
  env: Record<string, string | undefined>,
  production: boolean,
): SiteUrlResolution {
  const raw = env[SITE_URL_ENV]?.trim();

  if (raw) {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      return { url: new URL(withScheme).origin };
    } catch {
      return {
        url: DEV_ORIGIN,
        warning:
          `${SITE_URL_ENV} is set to ${raw}, which is not a URL. Falling back ` +
          `to ${DEV_ORIGIN}; link previews will point at the wrong origin.`,
      };
    }
  }

  if (!production) return { url: DEV_ORIGIN };

  return {
    url: DEV_ORIGIN,
    warning:
      `${SITE_URL_ENV} is not set. Open Graph images will be advertised at ` +
      `${DEV_ORIGIN}, so links to this app will not preview. Set it to the ` +
      `origin this app is served from, in the build environment as well as at ` +
      `runtime — a prerendered page bakes the origin at build time.`,
  };
}
