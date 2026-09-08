export type Tool = {
  /** Where the tool points with no account resolved — and how the grid spots
   *  the tool it is rendering. */
  href: string;
  text: string;
  /**
   * The name at a phone's width, where the rack's readout carries it beside the
   * wordmark and the flask. Omitted where {@link Tool.text} already fits.
   *
   * It lives here rather than being truncated in `ToolsMenu` because a short
   * name is a fact about the tool — "Lineup Checker" abbreviates to "Lineups"
   * and not to "Lineup Ch…" — and a component cutting a string at a character
   * count would have to be right about every entry the registry grows into.
   *
   * **One entry carries one today**, which is the field earning its place
   * rather than outliving it: `Manager` gave its `Mgr` back when the phone row
   * was measured against seven characters, and `Lineup Checker`'s fourteen are
   * what the row genuinely cannot hold. A registry heading for eight to ten
   * entries will meet the second case again.
   */
  short?: string;
  /**
   * Which bay of the rack's tool tray this sits in. Rows sharing a value are
   * one bay; the tray cuts between changes, so the field is read as a *run*
   * rather than as a key — which is what keeps it honest against the list's own
   * order, and why a registry entry cannot land in a bay its neighbours are not
   * in without being moved to them.
   *
   * The three are what a tool asks about: your account (Manager, Lineup
   * Checker), a draft as it happens (Pick Tracker), and the whole crawled
   * corpus (Comps, Trades).
   *
   * **One field rather than three arrays**, so the tray and the `/tools` grid
   * stay one list read two ways. Only the tray reads it; the grid renders the
   * order, which the grouping already is.
   */
  group: 1 | 2 | 3;
  description: string;
  /**
   * Where it points once an account resolves, given that account's username.
   * A tool whose account-less `href` is already its destination omits this.
   * Callers go through {@link toolHref}, which owns the URL-encoding.
   */
  hrefFor?: (username: string) => string;
  /**
   * Whether the tool answers anything with no account resolved. False for all
   * but two, which is why the grid gates on the account at all: there is nothing
   * behind "your leagues" without knowing whose. Trades is the exception — it
   * reads every crawled league, so a username is a filter it offers rather than
   * the question it asks — and a card the grid links to but greys out is the
   * drift this flag prevents.
   */
  accountless?: true;
};
