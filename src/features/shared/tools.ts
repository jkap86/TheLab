/**
 * The catalogue of tools this app offers — what they are called, where they go,
 * and how to tell whether you are already in one.
 *
 * It lives in `features/shared` rather than in `features/tools` because a second
 * reader arrived: the app bar's tools menu lists the same six entries the grid
 * does, and `features/shared` must not import a feature. `features/tools`
 * re-exports it from where its own consumers already import it, per the usual
 * rule for a moved module.
 *
 * Pure and tested: nothing here is imported at runtime, so `tools.test.ts` can
 * load it under Node's runner.
 */

/** Which glyph the menu draws for a tool; resolved by `ui/tool-icon`. */
export type ToolIconName =
  | "leagues"
  | "players"
  | "leaguemates"
  | "picktracker"
  | "trades"
  | "lineup";

/**
 * The heading a tool sits under in the menu. The split is what a tool is
 * *about*: the manager views read one account's portfolio across every league,
 * the rest read what happens inside a league.
 */
export type ToolGroup = "Manager" | "League tools";

export const TOOL_GROUPS: ToolGroup[] = ["Manager", "League tools"];

export type Tool = {
  /** Where the tool points with no account resolved — and how the grid and the
   *  placeholder page spot the tool they are rendering. */
  href: string;
  text: string;
  description: string;
  group: ToolGroup;
  icon: ToolIconName;
  /**
   * The route the tool owns, for the menu's current-page highlight. A `*`
   * stands for exactly one segment and the match is a prefix, so
   * `/picktracker` covers `/picktracker/[leagueId]` too. It is spelled out
   * rather than derived from `href`, because the account-less href is a search
   * page the tool doesn't own (`/manager` sends you to three different views).
   */
  pattern: string;
  /**
   * Where it points once an account resolves, given that account's username.
   * The three manager views share one account-less href — the username search
   * they'd otherwise send you to — and differ only here, so a caller asks a tool
   * where it goes rather than naming each destination itself. Callers go through
   * {@link toolHref}, which owns the URL-encoding.
   */
  hrefFor?: (username: string) => string;
};

export const tools: Tool[] = [
  // The manager tool is three entries, not one: its tabs answer different
  // questions (which leagues, which players, which people) and land on separate
  // routes, so both the grid and the menu link each directly rather than
  // dropping you on Leagues to navigate again.
  {
    href: "/manager",
    text: "Leagues",
    description:
      "Rank your leagues by record, points, roster value, and projections.",
    group: "Manager",
    icon: "leagues",
    pattern: "/manager/*/leagues",
    hrefFor: (username) => `/manager/${username}/leagues`,
  },
  {
    href: "/manager",
    text: "Players",
    description:
      "See who you hold, in how many leagues, and at what share of them.",
    group: "Manager",
    icon: "players",
    pattern: "/manager/*/players",
    hrefFor: (username) => `/manager/${username}/players`,
  },
  {
    href: "/manager",
    text: "Leaguemates",
    description: "See who you play against most, and which leagues you share.",
    group: "Manager",
    icon: "leaguemates",
    pattern: "/manager/*/leaguemates",
    hrefFor: (username) => `/manager/${username}/leaguemates`,
  },
  {
    href: "/picktracker",
    text: "Pick Tracker",
    description:
      "Track rookie picks selected in a draft using kickers as placeholders.",
    group: "League tools",
    icon: "picktracker",
    pattern: "/picktracker",
  },
  {
    href: "/trades",
    text: "Trades",
    description:
      "Read every trade in your leagues, by date, players, picks or manager.",
    group: "League tools",
    icon: "trades",
    pattern: "/trades",
  },
  {
    href: "/lineupchecker",
    text: "Lineup Checker",
    description: "Validate that your optimal lineup is set.",
    group: "League tools",
    icon: "lineup",
    pattern: "/lineupchecker",
  },
];

/**
 * Where a tool goes for the account in hand — its own destination once one is
 * resolved, the account-less search otherwise.
 *
 * **The encoding lives here, once.** `hrefFor` interpolates the username bare,
 * so encoding it twice 404s any account whose name isn't plain ASCII — exactly
 * the account nobody tests with. With the grid and the bar both resolving
 * destinations, that trap is a single call site rather than a rule each caller
 * has to remember.
 */
export function toolHref(tool: Tool, username: string | null): string {
  if (!username || !tool.hrefFor) return tool.href;
  return tool.hrefFor(encodeURIComponent(username));
}

/**
 * Whether `pathname` is inside the tool — what the menu highlights.
 *
 * The pathname's segments come back from the router already URL-encoded, which
 * doesn't matter here: a `*` accepts whatever one segment holds, and the literal
 * segments are ASCII route names.
 */
export function isToolActive(tool: Tool, pathname: string): boolean {
  const wanted = tool.pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (actual.length < wanted.length) return false;
  return wanted.every(
    (segment, i) => segment === "*" || segment === actual[i],
  );
}

/** The tools in a group, in catalogue order. */
export function toolsInGroup(group: ToolGroup): Tool[] {
  return tools.filter((tool) => tool.group === group);
}
