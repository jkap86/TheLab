import type { UserInfo } from "@/shared/contract";

import { Avatar, CONSOLE_HOUSING, CONSOLE_KEY } from "@/features/shared";

/**
 * The resolved account, as a lit readout in a machined housing: window, milled
 * groove, key. One housing rather than three floating chips, so the row reads
 * as a single instrument.
 *
 * The window is a *lit* surface, not a translucent card, which is why it names
 * `--readout-bg` and `--readout-text` instead of the usual foreground alphas:
 * the glow that makes it read as lit is a text-shadow in dark mode and nothing
 * at all in light mode, where the same glow would only smear the type.
 */
export function AccountReadout({
  user,
  onChange,
}: {
  user: UserInfo;
  onChange: () => void;
}) {
  return (
    <div className={CONSOLE_HOUSING}>
      <div className="relative flex items-center gap-[0.5625rem] overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] px-4 py-2 shadow-[var(--readout-shadow)]">
        {/* Scanlines. The one thing that makes the window read as emitting
            light rather than being painted. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
        />
        <span className="relative">
          <Avatar
            url={user.avatar_url}
            name={user.display_name || user.username}
            size="md"
          />
        </span>
        {/* Sleeper lets a display name go missing, so the username is the
            fallback everywhere this pair is shown. */}
        <span className="relative font-mono text-[length:var(--fs-15)] tracking-[0.01em] text-readout [text-shadow:var(--readout-text-glow)]">
          {user.display_name || user.username}
        </span>
        {/* The dot's expanding ring animates via `tools-pulse` and freezes
            under reduced motion (`.lab-anim`). */}
        <span
          aria-hidden
          className="lab-anim relative size-[0.4375rem] rounded-full bg-active shadow-[0_0_10px_var(--accent-glow)]"
          style={{ animation: "tools-pulse 2.4s ease-out infinite" }}
        />
        <span className="sr-only">Connected</span>
      </div>

      <span
        aria-hidden
        className="mx-2 my-[0.1875rem] w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
      />

      <button type="button" onClick={onChange} className={CONSOLE_KEY}>
        Change
      </button>
    </div>
  );
}
