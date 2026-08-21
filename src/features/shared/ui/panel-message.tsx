import { FlaskLoader } from "./flask-loader";

/**
 * The two states a panel shows instead of its content: a message, and a message
 * with the flask bubbling over it.
 *
 * They came here from the manager tool's `components/ui.tsx` with the league
 * detail panel, which is their first caller and now belongs to two tools. The
 * manager views that also draw them (the players and leaguemates tabs, the shares
 * sheet, the leagues layout) read them back through that module's re-export,
 * which is the mover's habit everywhere else here.
 */

/** A full-width message standing in for a panel's content. */
export function PanelMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      // Only the error tone interrupts: the muted spelling is an *answer* ("no
      // leagues match these filters"), and the count beside the control that
      // narrowed them already announces it.
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-lg border px-4 py-6 text-center text-sm ${
        tone === "error"
          ? "border-red-500/20 bg-red-500/5 text-red-300"
          : "border-foreground/10 bg-foreground/[0.02] text-foreground/45"
      }`}
    >
      {children}
    </p>
  );
}

/**
 * {@link PanelMessage}'s chrome around a wait, with the flask bubbling in it. The
 * panel mounts on expand and its rosters are a fetch away, so this is the one
 * panel state that is going somewhere — a still line of text says only that
 * nothing has happened yet, which is what a slow league card looked like.
 *
 * The flask is small — the panel can render at half a card's width — and the
 * message is a plain string rather than a node so it can be both the visible
 * line and the loader's accessible name: the flask already carries the
 * `role="status"`, so a second one under it would announce the wait twice.
 */
export function PanelLoading({ children }: { children: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-4 py-5 text-center text-sm text-foreground/45">
      <FlaskLoader size={36} label={children} />
      <p aria-hidden="true">{children}</p>
    </div>
  );
}

/**
 * A read that failed, standing in for what it would have filled.
 *
 * Its own tone rather than {@link PanelMessage}'s `error`, because it replaces a
 * *page* or a whole list rather than a panel's contents: it came here from the
 * manager tool's cold-load states with the shares sheet, which draws it when the
 * rosters behind a browse can't be read and which two tools now open.
 */
export function ErrorCard({ message }: { message: string }) {
  return (
    // A read that failed is worth interrupting for, and this one replaces the
    // page — the same call `UserLookup` and the pick tracker's league list make.
    <div
      role="alert"
      className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-200"
    >
      {message}
    </div>
  );
}

/**
 * A section of a page that could not be computed, reported **beside** the
 * content that could.
 *
 * The third tone in this file, and the difference from the other two is what it
 * replaces: {@link PanelMessage}'s error tone stands in for a panel's contents
 * and {@link ErrorCard} for a whole page, where this one stands in for nothing
 * at all — the rows are drawn, the columns it names are blank, and the line says
 * which. That is the amber the manager tabs already wear for "refresh failed —
 * showing cached data", which is the same situation one layer out.
 *
 * `role="status"` rather than `alert`: nothing is broken from the reader's side,
 * there is nothing to press, and the entry behind it is stale so the next read
 * re-asks. Interrupting for it would be the intrusive spelling of a message
 * whose whole content is "this will sort itself out".
 */
export function DegradedNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      // `shrink-0` because one of its three call sites is a flex column whose
      // other child is a panel that scrolls: a line of text has nothing to give
      // up, and squeezing it is how a two-line sentence becomes one and a half.
      className="mb-3 shrink-0 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-300"
    >
      {children}
    </p>
  );
}
