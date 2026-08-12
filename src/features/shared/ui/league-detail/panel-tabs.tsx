import { useRef, type KeyboardEvent } from "react";

/** Which of the panel's two readings is on screen. */
export type PanelTab = "standings" | "settings";

/**
 * The two tabs, in the order the strip lays them out.
 *
 * Standings leads because it is what the panel is opened for: a league card is
 * pressed to see how the league is going, and its configuration is the question
 * that follows. It is also what the strip opens on, so the leading tab is the lit
 * one on arrival.
 */
export const PANEL_TABS: readonly { id: PanelTab; label: string }[] = [
  { id: "standings", label: "Standings" },
  { id: "settings", label: "Settings" },
];

/** The strip's own tab ids, so the tab and the body it names agree. */
export const panelTabId = (baseId: string, tab: PanelTab) =>
  `${baseId}-tab-${tab}`;

/** The id of the body those tabs switch, which each of them points at. */
export const panelBodyId = (baseId: string) => `${baseId}-panel`;

/**
 * The band on the card's head that switches the panel between its standings and
 * this league's settings.
 *
 * **It holds the seat the telemetry strip used to.** That strip was a rank dial
 * and two totals — where the selected team places, what it projects, what it is
 * carrying on the bench — and every one of those is still on screen: the
 * standings are *ordered* by that rank and each row wears it as a tab on its
 * corner, and the projection and the bench are two of the metrics the table's
 * own value columns open on. So what the swap costs is a restatement, and what it
 * buys is the league's own configuration, which nothing in the app said at all.
 *
 * The band itself is unchanged, because what it is has not changed: full bleed
 * under a machined seam (a dark cut with a lit far wall), which is what makes it
 * read as the card's head continuing rather than as a third object between the
 * league's name and its detail. It does not scroll — the two halves below it are
 * the panel's scrolling parts and this is the head they scroll under — which is
 * `shrink-0`'s job here as it was there.
 *
 * **The material is the app bar's grammar and not a segmented control.** The lit
 * tab is a recessed well ("you are here", the bar's own current-page chip) and
 * the other is a raised key ("press me"), seated in a trough — the same pairing
 * the ADP drawer's bay rail already draws, so a reader who has met one has met
 * both. The rail is `inline-flex` rather than stretched across the head: a
 * housing that reached both walls would have to be filled, and two tabs holding
 * a card's full width read as a table header rather than as a control.
 */
export function PanelTabs({
  tab,
  onTab,
  baseId,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** The panel's own id root — see {@link panelTabId} and {@link panelBodyId}. */
  baseId: string;
}) {
  const keys = useRef<(HTMLButtonElement | null)[]>([]);

  // The arrow keys are what makes this a tablist rather than two buttons with
  // tab roles on them: the strip is one stop in the tab order (only the lit tab
  // is reachable with Tab), and the arrows move *within* it — which is the whole
  // of what a reader gets in exchange for the roles being there at all.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = PANEL_TABS.findIndex((t) => t.id === tab);
    const to =
      event.key === "ArrowRight"
        ? (from + 1) % PANEL_TABS.length
        : event.key === "ArrowLeft"
          ? (from - 1 + PANEL_TABS.length) % PANEL_TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? PANEL_TABS.length - 1
              : null;
    if (to === null) return;
    // Or the press scrolls whatever this panel is sitting in as well as moving
    // the selection.
    event.preventDefault();
    onTab(PANEL_TABS[to].id);
    // Selection follows focus, so focus has to follow the selection: a reader
    // arrowing across the strip must not leave the keyboard behind on the tab
    // they have just left.
    keys.current[to]?.focus();
  };

  return (
    // The left inset clears the same cyan rail the card's name line clears, so
    // the strip starts under the league's name rather than under its chevron.
    <div className="shrink-0 border-t border-black/40 py-1.5 pl-5 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] @lg:py-2 @lg:pr-4">
      <div
        role="tablist"
        aria-label="League detail"
        onKeyDown={onKeyDown}
        className="lab-trough inline-flex items-stretch gap-1 rounded-[10px] p-1"
      >
        {PANEL_TABS.map(({ id, label }, i) => {
          const active = id === tab;
          return (
            <button
              key={id}
              ref={(node) => {
                keys.current[i] = node;
              }}
              type="button"
              role="tab"
              id={panelTabId(baseId, id)}
              aria-selected={active}
              aria-controls={panelBodyId(baseId)}
              // Roving: the strip is one Tab stop, and the arrows above are how
              // a reader reaches the tab that isn't lit.
              tabIndex={active ? 0 : -1}
              onClick={() => onTab(id)}
              className={`rounded-[7px] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] transition-colors @lg:text-[0.7rem] ${
                active
                  ? "lab-well text-active"
                  : "lab-chip lab-chip-sm text-foreground/60"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
