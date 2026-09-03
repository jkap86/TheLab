/**
 * The console's ground: the bevelled surface a page sits *on*, run to the
 * viewport edges.
 *
 * The leagues page used to draw this as a rounded, bordered panel inside its
 * own shell, with `--background` showing around it. With the app rack floating
 * above, a second bounded rectangle inside the viewport reads as a panel
 * inside a panel — so the panel surface became the page surface, and
 * `PageShell` governs content width only.
 *
 * **Fixed and viewport-sized, not painted onto the page's box.** `--panel-bg`
 * is a radial gradient anchored at `50% -20%` of whatever box carries it, so a
 * document-sized box stretches that glow over a hundred-league page until it is
 * no longer light falling on a console, just a tint. Pinned to the viewport it
 * stays what it is.
 *
 * **`-z-10` is what lets a route opt in from anywhere in its tree.** The
 * element is out of flow and behind every positioned sibling, so rendering it
 * from a page still puts it under the rack that `layout.tsx` mounted above
 * that page. That is the whole reason this is a component a route renders
 * rather than markup in the root layout: only the console pages want it, and a
 * page that draws its own panel would otherwise get the doubling this exists
 * to remove.
 */
export function ConsoleGround() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 bg-[image:var(--panel-bg)]"
    >
      {/* Grain, then the specular hairline along the ground's top edge. Both
          are what keep a large flat surface from reading as flat. */}
      <span className="absolute inset-0 bg-[image:var(--panel-grain)]" />
      <span className="absolute inset-x-[8%] top-0 h-px bg-[image:var(--panel-specular)]" />
    </div>
  );
}
