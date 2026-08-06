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
