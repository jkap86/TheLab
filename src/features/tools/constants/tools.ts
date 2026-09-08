import type { Tool } from "../types/tools.types";

/**
 * The tool registry, in the order the rack's tray and the `/tools` grid both
 * read it.
 *
 * **The order is the grouping**, and the grouping is what a reader is meant to
 * see: the two tools that answer a question about *your* account, then the one
 * that follows a draft as it happens, then the one that reads the whole crawled
 * corpus. `group` is what the tray cuts a bay between — see {@link Tool.group},
 * which is why this is one list with a field rather than three arrays.
 */
export const tools: Tool[] = [
  // One entry, and `hrefFor` is why: `/manager` with no account is the username
  // search, and the same card becomes a direct link to that manager's page once
  // an account resolves, rather than dropping you on a search you already did.
  //
  // **No `short`.** It read `Mgr` in the rack below `sm`, which was the row
  // paying for a wordmark and two Browse caps that have since been measured
  // against seven characters rather than three: `Manager` is exactly the count
  // `Lineups` already carries at 390 on `/lineupchecker`, which is the tightest
  // row either page produces. A page whose own billet spells the tool out has
  // no reason for the rack above it to abbreviate.
  {
    href: "/manager",
    text: "Manager",
    group: 1,
    description:
      "Rank your leagues by record, points, roster value, and projections.",
    hrefFor: (username) => `/manager/${username}`,
  },
  // `hrefFor` for Manager's reason: the tool is about one manager's leagues,
  // and the route names which — so the card and the rack key resolve to the
  // stored account rather than dropping a reader on a page with no subject.
  //
  // **`short` stays here**, and it is now the field's only reader. `Lineup
  // Checker` is fourteen characters and wants ~65px the phone row does not
  // have; the only way to pay for it is dropping the wordmark below 390, which
  // is a worse trade than a name the page's own eyebrow already abbreviates the
  // same way.
  {
    href: "/lineupchecker",
    text: "Lineup Checker",
    short: "Lineups",
    group: 1,
    description: "Validate that your optimal lineup is set.",
    hrefFor: (username) => `/lineupchecker/${username}`,
  },
  {
    href: "/picktracker",
    text: "Pick Tracker",
    group: 2,
    description:
      "Track rookie picks selected in a draft using kickers as placeholders.",
  },
  {
    href: "/trades",
    text: "Trades",
    group: 3,
    description:
      "Read every trade in every crawled league, by date, players, picks or manager.",
    accountless: true,
  },
];
