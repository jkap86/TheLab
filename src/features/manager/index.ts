/**
 * What the manager routes may import by feature name — the three stores its
 * layout mounts, and nothing else.
 *
 * **The four view components are deliberately absent, and this is the same rule
 * `features/shared/index.ts` keeps for the ADP drawer and the league filters
 * dialog.** A barrel is a single module as far as the bundler is concerned, so
 * one name imported from here pulls every name it exports into that route's
 * static graph. `/manager` is a page whose whole content is a username field,
 * and importing `ManagerSearch` from here shipped it the league cards, the
 * expanded league detail panel, both share lists, the subject rail and the
 * columns editor — 780KB for a search box, and every byte of it about a manager
 * nobody had searched for yet.
 *
 * So the routes name the module path (`./components/manager-leagues`), which is
 * what the two dialogs' call sites already do one feature over. The providers
 * stay because they are the opposite case: a context and a `useState` each, and
 * the layout that mounts them is on the path of every one of these routes
 * anyway.
 *
 * The check is the one in CLAUDE.md, run against the prerendered page rather
 * than against a route with a trigger:
 *
 * ```
 * grep -rl "<a string only the heavy part contains>" .next/static/chunks/
 * # → then grep that chunk's name in .next/server/app/manager.html
 * ```
 */
export {
  AdpControlsProvider,
  LeagueFiltersProvider,
  SubjectFiltersProvider,
} from "./filters-context";
