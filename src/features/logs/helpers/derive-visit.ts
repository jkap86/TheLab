/**
 * What a stored route says about a visit.
 *
 * The table holds the pathname whole and nothing derived from it, so this is
 * where the route vocabulary lives — a seventh tool is a line here rather than
 * a migration. Pure, and tested, which is the other half of why it is a module
 * and not an inline `split` in the component.
 *
 * **It is total.** The version this was ported from opens with
 * `route_array[1].toLowerCase()` on an unguarded index: any row whose route has
 * no second segment throws during the map that builds the whole list, and the
 * page renders blank with a console error nobody is looking at. Reachable there,
 * because its write endpoint is open and accepts any string as a route.
 */

export type Visit = {
  /** The tool the path names — `manager`, `trades`, … — or "" for `/`. */
  tool: string;
  /**
   * Who or what the page was *about*: a Sleeper username on `/manager`, a league
   * id on `/picktracker`. Null where the route names neither, which is most of
   * them — not every page has a subject, and an empty string would sort and
   * filter as though it did.
   */
  subject: string | null;
};

/**
 * There is deliberately no `tab`. The app this was ported from derives one,
 * because its manager page is `/manager/<user>/<tab>`; every page here is a
 * single route with its state in the client, so a Tab facet would be a control
 * whose menu is always empty. The full route is a column on the page, so a
 * deeper path is still visible if one ever appears.
 */

/** The routes that carry a subject, and which kind each carries. */
const SUBJECT_ROUTES: Record<string, "username" | "league"> = {
  manager: "username",
  lineupchecker: "username",
  picktracker: "league",
};

export function deriveVisit(route: string): Visit {
  const segments = route.split("/").filter(Boolean);
  const tool = segments[0]?.toLowerCase() ?? "";

  const kind = SUBJECT_ROUTES[tool];
  if (!kind) return { tool, subject: null };

  // A league id is a Sleeper number and is not a name, so it is left exactly as
  // stored; a username is case-insensitive to Sleeper, so folding it is what
  // stops one person appearing as two rows in the facet menu.
  const raw = segments[1];
  return {
    tool,
    subject: raw ? (kind === "username" ? raw.toLowerCase() : raw) : null,
  };
}
