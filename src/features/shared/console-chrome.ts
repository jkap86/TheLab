/*
 * The console's shared surfaces, as class strings.
 *
 * A key is a physically raised object: the resting shadow carries a 3px riser
 * under it and the pressed shadow drops to 1px, so pressing one travels. They
 * have to agree, which is the whole argument for the constant — and it lives in
 * `shared/` rather than in `features/tools` because the leagues console builds
 * on it too, which is the line that decides where a client piece goes.
 *
 * There are two shapes of key and four depths of recess, and none of them is
 * interchangeable:
 *
 * - {@link CONSOLE_KEY} is a *pill*, for a key standing on its own in a row of
 *   keys. {@link CONSOLE_KEY_BLOCK} is a *slab*, for a key stacked with others
 *   in a housing where a column of stadiums would read as a list of tablets.
 * - {@link CONSOLE_WELL} is the shallow tray a whole panel of controls sits in,
 *   which at any greater depth would read as a hole rather than a surface.
 *   {@link CONSOLE_TRACK} is the tight channel a single key travels in — deep,
 *   so the key reads proud of it. {@link CONSOLE_CHANNEL} is deeper again, for
 *   a track whose lit key is a *raised face* rather than a flush one. And
 *   {@link CONSOLE_PART_TRAY} is deepest, because what it holds is parts rather
 *   than controls, and a part is seated in a hole.
 *
 * And there is a fourth family at the foot of this file — the **billet**, a
 * solid part chamfered on all four edges, which is what a league card's ledge,
 * its chip rail and its rank windows' headers are milled from. A plate and a
 * key are each one face carrying one thing; a billet is thick enough to hold a
 * name proud on its face and a well cut into the same part. See
 * {@link CONSOLE_BILLET}.
 */

/** The travel every key shares: raised at rest, down on its own shadow when pressed. */
const KEY_PRESS =
  "transition-[transform,box-shadow,color] duration-150 " +
  "active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";

/**
 * Pill geometry and travel, carrying **no colour and no padding of its own**.
 *
 * The split from {@link CONSOLE_KEY} is not tidiness. A key with two states
 * has to be composed as `shape + state`, and appending `border-active/40` to a
 * string that already says `border-foreground/10` is a coin flip: both
 * utilities have the same specificity, so which wins is decided by the order
 * Tailwind happened to emit them in, not by the order they appear in the class
 * attribute. A shape that names no colour cannot lose that flip.
 */
export const CONSOLE_KEY_PILL_BARE =
  `shrink-0 rounded-full border font-mono uppercase ${KEY_PRESS}`;

/**
 * The pill above at the standard type size, and it is split off
 * {@link CONSOLE_KEY_PILL_BARE} for the padding's own reason one property over.
 *
 * `text-[length:…]` and `tracking-[…]` are arbitrary values, so a caller
 * appending a second of either does not override this one — both have the same
 * specificity and which wins is Tailwind's emit order. A key that has to be
 * smaller than the row it stands in (the columns picker's `Save`, milled into a
 * ledge rather than standing on a panel) therefore needs the bare shape, not a
 * size bolted onto this one.
 */
export const CONSOLE_KEY_PILL_SHELL =
  `${CONSOLE_KEY_PILL_BARE} text-[length:var(--fs-11)] tracking-[0.16em]`;

/**
 * The pill above, at the standard gutter.
 *
 * The padding is split out of {@link CONSOLE_KEY_PILL_SHELL} for the reason
 * {@link CONSOLE_CARD_SHELL} is split out of {@link CONSOLE_CARD}, one axis
 * over: a key that wants a tighter gutter — an icon-only cap, say — cannot get
 * one by appending `px-2.5` to a string that already says `px-4`. Both are base
 * utilities of the same specificity, and Tailwind emits the scale in ascending
 * order, so **the larger value wins whatever the class attribute says**. It is
 * the same coin flip this file splits colour out for, and it is worse here,
 * because a key silently laid out at the wrong width still looks like a key.
 *
 * Measured against this project's own Tailwind build: `px-2.5` is emitted
 * before `px-4`, and an arbitrary value (`px-[0.6875rem]`) after both. So a
 * caller with a bare scale step needs the shell; one with an arbitrary value
 * happens to win either way, which is not a difference worth remembering.
 */
export const CONSOLE_KEY_PILL = `${CONSOLE_KEY_PILL_SHELL} px-4 py-2`;

/** The everyday key: the pill above, unlit. */
export const CONSOLE_KEY =
  `${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] ` +
  "text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout";

/**
 * The same, with square-ish corners, for keys stacked in a housing — a column
 * of stadiums reads as a list of tablets. Colourless for the reason above.
 */
export const CONSOLE_KEY_BLOCK =
  "inline-flex items-center rounded-[0.625rem] border px-3 py-2 " +
  `font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] ${KEY_PRESS}`;

/** The machined housing a key or a readout is mounted in. */
export const CONSOLE_HOUSING =
  "inline-flex items-center rounded-full border border-foreground/8 " +
  "bg-[image:var(--key-bg)] p-1.5 shadow-[var(--plate-shadow)]";

/** The deep channel a single raised key sits in — the nav track, a lens toggle. */
export const CONSOLE_TRACK =
  "rounded-full bg-[image:var(--key-bg)] shadow-[var(--track-shadow)]";

/**
 * The **third depth**: a channel cut deeper than {@link CONSOLE_TRACK}, for a
 * track whose lit key is a raised face rather than a flush one.
 *
 * A key that carries its own riser and cast — the columns dialog's axis rows —
 * standing in `--track-shadow`'s shallow groove reads as an object sitting *on*
 * the track rather than travelling in it, which is the one thing a switch's
 * shape has to say. So the recess goes deeper and its floor is a hole rather
 * than key stock: `--key-bg` is a face catching a light, and there is no face
 * at the bottom of this.
 *
 * A **black alpha rather than a token**, on the shares tray's rule: a recess
 * has to be darker than its surround in *both* themes, which a black alpha is
 * and a `--foreground` alpha is not. It carries no padding and no gap, for
 * {@link CONSOLE_KEY_PILL}'s reason — the caller's own `p-*` would lose the
 * emit-order flip against one written in here.
 */
export const CONSOLE_CHANNEL =
  "rounded-full bg-black/52 " +
  "shadow-[inset_0_4px_10px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(0,0,0,0.9),inset_0_-1px_0_rgba(255,255,255,0.075)]";

/**
 * The same channel, cut into stock that is **pale in light mode**.
 *
 * {@link CONSOLE_CHANNEL}'s own note says why the two are two: that one is a
 * black alpha, on the rule that a recess must be darker than its surround in
 * both themes, and it is safe because its callers sit on dark stock either way.
 * A channel milled into `--key-metal` is not one of those — that face is
 * near-white in light mode, and 52% black on it is not a channel but a hole
 * punched through the part, the darkest object on the panel by a wide margin
 * with four pale keys floating in it. It is `--rack-channel-bg`'s own finding
 * one part smaller, so it takes `--rack-channel-bg`'s own answer: the same
 * values in dark, a slate tint and a lit lower lip in light.
 *
 * No padding, on {@link CONSOLE_CHANNEL}'s terms — the caller's own `p-*` would
 * lose the emit-order flip against one written in here.
 */
export const CONSOLE_CHANNEL_METAL =
  "rounded-full bg-[var(--rack-channel-bg)] shadow-[var(--rack-channel-shadow)]";

/**
 * A tray holding **parts**: the columns dialog's bay rack.
 *
 * Deeper than {@link CONSOLE_WELL} deliberately, and the difference is the same
 * one {@link CONSOLE_CHIP_TRAY} draws one grain smaller: a tray holding
 * *controls* is a surface, and a tray holding *parts* is the absence of one. It
 * is what makes four milled bays read as parts seated in a hole rather than as
 * four keys on a panel — which is the whole of how that rack states its budget,
 * since with every bay always set there is no count to state instead.
 *
 * **Eased once, and the reason is what it now sits in.** The picker's own body
 * used to be the case's face; it is a hole cut in that case, and a hole inside
 * a hole is the one arrangement where a floor this dark stops reading as a
 * floor at all — the tray and the well it sits in were within a few percent of
 * each other. The alphas below are one step back from what they were
 * (`0.46 → 0.42`, both `0.9` insets to `0.85`, the lip `0.07 → 0.08`), which is
 * what keeps the rack a hole in the well rather than a continuation of it.
 *
 * No radius, on {@link CONSOLE_BILLET}'s terms: the caller states its own.
 */
export const CONSOLE_PART_TRAY =
  "bg-black/42 " +
  "shadow-[inset_0_7px_16px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(0,0,0,0.85),inset_0_-1px_0_rgba(255,255,255,0.08)]";

/**
 * The same channel, from `sm` up only.
 *
 * A recess exists to hold a key that stands proud of it, so a key drawn
 * *etched* on a phone (see {@link PLATE_KEY}) has nothing to be recessed from
 * and the track goes with it. Derived from {@link CONSOLE_TRACK} by hand rather
 * than by a prefixing helper, because Tailwind scans class strings statically
 * and a computed prefix produces no CSS at all — the two have to be kept in
 * step, which is why they sit together.
 */
export const CONSOLE_TRACK_SM =
  "sm:rounded-full sm:bg-[image:var(--key-bg)] sm:shadow-[var(--track-shadow)]";

/**
 * {@link CONSOLE_PANE_TRACK} on the same terms — a recess cut in **metal**,
 * from `sm` up only.
 *
 * The pair {@link CONSOLE_TRACK} / {@link CONSOLE_TRACK_SM} makes one width
 * decision and this makes the same one for the other floor: a recess exists to
 * hold a key that stands proud of it, so a key drawn *etched* on a phone (see
 * {@link BILLET_KEY_CHROME}) has nothing to be recessed from and the track goes
 * with it. Which of the two tracks a caller wants is the material it is cut
 * into, not where it sits — key stock inside a panel, `--recess-bg` inside a
 * billet or a ledge.
 *
 * Spelled out by hand rather than derived from {@link CONSOLE_PANE_TRACK},
 * for `CONSOLE_TRACK_SM`'s reason: Tailwind scans class strings statically, so
 * a computed `sm:` prefix produces no CSS at all. The two have to be kept in
 * step, which is why the note says so rather than a helper doing it.
 */
export const CONSOLE_METAL_TRACK_SM =
  "sm:rounded-full sm:bg-[color:var(--recess-bg)] sm:shadow-[var(--track-shadow)]";

/**
 * A key **etched into a plate** rather than raised on one, below `sm`, and an
 * ordinary {@link CONSOLE_KEY_PILL} from `sm` up.
 *
 * The manager header's phone row is what asks for it: it is one stamped
 * reading with a control at the end of it, and a key standing 3px proud among
 * stamped figures reads as an object dropped onto the part rather than as
 * something cut into it. So on a phone it is a hairline and a hint of inset
 * light, and the geometry steps down with the figures beside it.
 *
 * The **geometry** is what that header still takes; its surface is
 * {@link BILLET_KEY_CHROME}, because the part is milled metal now rather than a
 * recessed plate. {@link PLATE_KEY_CHROME} is the surface for a key on a
 * *plate*, which is what makes it the pair to this one — it has no caller
 * today, and it is the half of this constant that says what a plate-mounted key
 * looks like.
 *
 * Geometry and chrome are two constants for {@link CONSOLE_KEY_PILL}'s reason:
 * a key with states composes as `shape + state`, and a shape that names a
 * colour makes which one wins a matter of Tailwind's emit order. The travel and
 * the focus ring are the same at both widths — an etched key still presses.
 */
export const PLATE_KEY =
  "inline-flex shrink-0 items-center rounded-full border px-2 py-[0.3125rem] " +
  "font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] " +
  `sm:px-4 sm:py-2 sm:text-[length:var(--fs-11)] ${KEY_PRESS}`;

/** {@link PLATE_KEY}'s surface: cut into the plate below `sm`, raised above it. */
export const PLATE_KEY_CHROME =
  "bg-foreground/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] " +
  "sm:bg-[image:var(--key-bg)] sm:shadow-[var(--key-shadow)]";

/**
 * The same key on a **billet** rather than on a recessed plate.
 *
 * {@link PLATE_KEY_CHROME}'s two surfaces are both drawn for a plate — a
 * `--foreground` alpha reads as a shallow cut in *plate* stock, and `--key-bg`
 * is the face a key on a panel wears. Neither is right on milled metal, and
 * both fail in the same direction: they are the surfaces of the thing the
 * billet is not.
 *
 * So the etched half is `--recess-bg`, which is the token for a hole cut in
 * metal whose label is ink on metal — a black alpha would be a hole punched
 * through a pale part in light mode, which is the case that token exists for.
 * And the raised half is `--key-metal` rather than `--key-bg`: a key standing
 * on a machined face is machined, and the brushed grain in that token is what
 * says so beside the billet's own.
 *
 * It carries neither a border nor an ink, and that is not an omission —
 * `LeagueFiltersDialog` owns both, because what "something is filtering"
 * changes is the key's border and its legend rather than its surface. See that
 * component's `triggerChrome`, which this is passed as.
 */
export const BILLET_KEY_CHROME =
  "bg-[color:var(--recess-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] " +
  "sm:bg-[image:var(--key-metal)] sm:shadow-[var(--key-shadow)]";

/** The shallow tray a panel of controls sits in — a filter rail, a rule bay. */
export const CONSOLE_WELL =
  "rounded-[0.875rem] border border-foreground/8 bg-[image:var(--key-bg)] " +
  "shadow-[var(--well-shadow)]";

/**
 * A card as an *instrument housing*: a bezel with lit windows set into it.
 *
 * The console cards used to be glass — `--card-bg` with readout tiles floating
 * on it — and this inverts that relationship: the card body is the housing and
 * everything carrying a reading is a window cut into it. Shared because all
 * three league cards (trades, manager, lineup checker) are the same object seen
 * three times, and a housing that drifted between them would read as three
 * different instruments.
 *
 * The 18px radius is part of it, and so is the padding — which is why there
 * are two constants. {@link CONSOLE_CARD_SHELL} is the housing with **no
 * padding of its own**; {@link CONSOLE_CARD} is that plus the standard inset.
 */
export const CONSOLE_CARD_SHELL =
  "relative rounded-[1.125rem] border border-foreground/10 " +
  "bg-[image:var(--housing-bg)] shadow-[var(--housing-shadow)]";

/**
 * The housing with its own padding: `30px 18px 18px`, the top of it what the
 * plate straddling the card's edge needs to clear.
 *
 * Split from {@link CONSOLE_CARD_SHELL} for {@link CONSOLE_KEY_PILL}'s reason,
 * one axis over: a card that needs a *different* inset at a phone's width
 * cannot get it by appending `px-3.5` to a string that already says
 * `px-[1.125rem]`. Both are base `px-*` utilities of the same specificity, so
 * which one wins is Tailwind's emit order rather than the class attribute's —
 * and it is a card silently laid out at the wrong width rather than an error.
 * A card that wants its own gutter composes the shell with it; everything else
 * takes this and is unchanged.
 */
export const CONSOLE_CARD =
  `${CONSOLE_CARD_SHELL} px-[1.125rem] pb-[1.125rem] pt-[1.875rem]`;

/**
 * A readout set *into* a housing, as opposed to sitting on a panel.
 *
 * {@link CONSOLE_READOUT} with the lit bottom lip that closes the recess
 * against the bezel around it — see `--window-shadow`. Same `relative
 * overflow-hidden` contract: the scanlines are an absolutely-positioned child,
 * so every window carries one.
 */
export const CONSOLE_WINDOW_SHELL =
  "relative overflow-hidden border bg-[image:var(--readout-bg)] " +
  "shadow-[var(--window-shadow)]";

/**
 * That shell with its resting border, which is what a window normally wears.
 *
 * **Split from it for {@link CONSOLE_KEY_PILL}'s reason**, one property over: a
 * window that lights when the reading inside it is the one a reader picked
 * cannot get there by appending `border-active/55` to a string that already
 * says `border-black/85`. Both are base border-colour utilities of the same
 * specificity, so which one wins is Tailwind's emit order rather than the class
 * attribute's — and it is a control that silently never lights rather than an
 * error. A window that has two states composes the shell with both of them;
 * everything else takes this and is unchanged.
 */
export const CONSOLE_WINDOW = `${CONSOLE_WINDOW_SHELL} border-black/85`;

/**
 * The plate that straddles a housing's top edge — the league name, the record,
 * the week's projection.
 *
 * Colourless in the same sense {@link CONSOLE_KEY_PILL} is not: a plate has one
 * state, so its border travels with it. What it does *not* carry is layout —
 * the row it sits in, and whether it is the left plate or the right one, belong
 * to the card.
 */
export const CONSOLE_PLATE =
  "rounded-full border border-foreground/14 bg-[image:var(--plate-raised-bg)] " +
  "shadow-[var(--plate-raised-shadow)]";

/**
 * Lit glass: the surface a *number* is drawn on, as opposed to a label.
 *
 * `relative` and `overflow-hidden` are part of it because the scanlines are an
 * absolutely-positioned child — CSS has no way to spell a repeating overlay as
 * a second background on an element that already has one here, so every
 * readout in the app carries the same `aria-hidden` span.
 */
export const CONSOLE_READOUT =
  "relative overflow-hidden border border-black/85 bg-[image:var(--readout-bg)] " +
  "shadow-[var(--readout-shadow)]";

/**
 * A **milled billet**: a solid machined part, chamfered on all four edges.
 *
 * The fourth surface family the console has, and it exists because the other
 * three cannot hold two lines. A {@link CONSOLE_PLATE} is screwed onto a
 * housing and a {@link CONSOLE_KEY} is pressed into one — both are one face
 * with one thing on it — where a billet is thick enough to carry a name proud
 * on its face *and* a well cut into the same part below it. That is what lets
 * the league card's ledge replace two plates competing for one line.
 *
 * The chamfer is the whole of it: bright top, dark underside, lit left, shaded
 * right, in one shadow list because a shadow list is atomic — a caller that
 * appended a fifth inset would replace all four. It carries **no radius and no
 * padding**, for {@link CONSOLE_CARD_SHELL}'s reason: the ledge and a chip are
 * the same stock at two sizes, and two base `rounded-*` utilities of the same
 * specificity are decided by Tailwind's emit order rather than by the class
 * attribute.
 *
 * **It carries no `position` either, for the same reason and a sharper one.**
 * A billet is a positioning context — the grain and the raking specular are
 * absolutely-positioned children, since CSS cannot spell either as a second
 * background on an element that already has one — but the ledge is itself
 * `absolute`, hung off the card's top edge, and `relative` written in here
 * would be a second base `position` utility competing with it. Which one wins
 * is Tailwind's emit order; when `relative` did, the ledge dropped 71px into
 * the card's own padding and sat where the chip rail should be, with `left`
 * and `right` doing nothing at all. So the caller states its own: `relative`
 * on a chip, `absolute` on the ledge. `overflow-hidden` stays, being the half
 * of the contract nothing composes against.
 *
 * **And it does not compose with a cast**, which is why
 * {@link CONSOLE_BILLET_FACE} exists beside it: a shadow list is atomic, so a
 * caller appending `shadow-[0_10px_20px_…]` to this does not add a cast under
 * the chamfer, it *replaces* the chamfer — and which of the two arbitrary
 * `shadow-[…]` utilities wins is Tailwind's emit order rather than the class
 * attribute's. A billet that throws a shadow onto what is under it spells the
 * whole list with `var(--billet-shadow)` as its head, on the face alone.
 */
export const CONSOLE_BILLET_FACE =
  "overflow-hidden bg-[image:var(--billet-bg)]";

/** The face above, chamfered, for a billet that casts nothing. */
export const CONSOLE_BILLET = `${CONSOLE_BILLET_FACE} shadow-[var(--billet-shadow)]`;

/**
 * The shallow well cut into a billet's own face — the standing drops into this.
 *
 * Its gradient is the face's **inverted**, and that inversion is the entire
 * cue: a surface lit from above is bright where it faces the light, and a
 * recess is bright where it faces away. Read as a token rather than as a second
 * {@link CONSOLE_WELL}, which is a tray cut into a *panel* and takes the
 * panel's own key background — there is no key stock inside a billet.
 */
export const CONSOLE_MILLED_WELL =
  "bg-[image:var(--billet-well-bg)] shadow-[var(--billet-well-shadow)]";

/**
 * A row **cut into glass**: the channel a standings row or a seat row sits in.
 *
 * The expanded card's panes are parts, and inside each part's glass the rows
 * are grooves milled across it — a dark channel with a lit lip along its
 * bottom edge, which is the one detail that says "cut" rather than "painted".
 * It is the same idea as {@link CONSOLE_MILLED_WELL} one material over, and
 * that difference is the whole reason there are two: **a well on glass is a
 * dark channel, never `--billet-well-bg`**, which is *metal* — a recess in a
 * billet's face, with a face's own gradient inverted. Glass has no face to
 * invert, so a metal well drawn here reads as a chip that has fallen onto the
 * screen.
 *
 * Carries no radius, no height and no padding, for {@link CONSOLE_CARD_SHELL}'s
 * reason: the desktop row and the two-line phone row are the same channel at
 * two sizes, and a constant naming a `rounded-*` is a second base utility for
 * the caller's own to lose an emit-order coin flip against.
 *
 * **No expanded-card pane draws one any more.** The four row components that
 * did — the standings row, the two seat rows and the drawer row — are one
 * `PaneRow` now, and that part is a billet **standing on** the glass rather
 * than a channel cut into it: see {@link CONSOLE_TILE}, and `pane-row.tsx` for
 * why the drawer's own rows are what settled it. What still reads this is the
 * gametime **stat board**, whose rows genuinely are a table on one sheet of
 * glass rather than a list of subjects — so the channel is not dead, it simply
 * no longer describes a pane. The distinction it draws against
 * {@link CONSOLE_MILLED_WELL} is the one place the two materials' grammar is
 * written down, and it is the reason this note says so rather than the
 * constant being deleted.
 */
export const CONSOLE_ROW_WELL =
  "bg-[color:var(--row-well-bg)] shadow-[var(--row-well-shadow)]";

/**
 * A row **standing on** that glass instead: the tile every pane row is cut
 * from.
 *
 * Billet stock chamfered on four edges, casting onto the readout behind it —
 * {@link CONSOLE_BILLET} at row scale with a shorter cast, since forty of
 * these in one scrolling list would otherwise be a wash of black under the
 * glass rather than forty parts on it.
 *
 * **It is a part rather than a channel because the drawer's rows already
 * were.** A bench row is a part bolted over the starters, drawn in
 * {@link CONSOLE_MILLED_WELL}; the starters were holes. So the same player was
 * two different objects one press apart, and unifying them meant picking one —
 * and a row carrying a face, a name and a figure is a *subject*, which is a
 * thing rather than an absence of one.
 *
 * Carries **no radius, no padding and no `position`**, on
 * {@link CONSOLE_BILLET}'s own terms: the row is 34px at `lg` and two lines of
 * 48 below it, the tile is `relative` and `BilletFinish`'s two overlays are
 * `absolute` children of it, and a constant naming any of the three is a base
 * utility for the caller's own to lose an emit-order coin flip against.
 */
export const CONSOLE_TILE =
  "overflow-hidden bg-[image:var(--tile-bg)] shadow-[var(--tile-shadow)]";

/**
 * The same tile **in a drawer**: one step less cast.
 *
 * A drawer's rows sit on a *part* rather than on glass, and a part throws less
 * onto metal than onto a lit surface behind it. It is a second constant rather
 * than a caller appending a cast for {@link CONSOLE_CHIP_RAISED}'s reason — a
 * shadow list is atomic, so appending replaces the chamfer instead of adding
 * to it, and which of two arbitrary `shadow-[…]` utilities wins is Tailwind's
 * emit order.
 */
export const CONSOLE_TILE_DRAWER =
  "overflow-hidden bg-[image:var(--tile-bg)] shadow-[var(--tile-drawer-shadow)]";

/**
 * A tile that is **pressed**: teal-rimmed, lifted and cast a little deeper.
 *
 * Spelled whole rather than composed onto {@link CONSOLE_TILE}, for that
 * constant's own reason one property over — both the face and the shadow list
 * are single base utilities, so a caller appending either would be replacing
 * rather than adding and the winner would be Tailwind's emit order.
 *
 * **A part can carry state that a channel cannot**, which is half of why the
 * row became one: a selected channel had to be a wash *over* the row (a fill
 * would flood the cut and the row would stop reading as cut at all), where a
 * selected part is simply lit — its own face, its own rim, its own cast.
 */
export const CONSOLE_TILE_SELECTED =
  "overflow-hidden bg-[image:var(--tile-selected-bg)] " +
  "shadow-[var(--tile-selected-shadow)]";

/**
 * The smaller channel cut into a row, which one figure sits in.
 *
 * One pattern used twice at two depths — a row in the glass, a figure in the
 * row — and the nesting is what gives the pane its depth without a single
 * gradient or border. Deeper and darker than the row around it, because a cut
 * into a cut has to read as further in.
 *
 * `overflow-hidden` is part of it: a figure wider than its cell is clipped by
 * the channel's own edge rather than spilling across the row, which is what
 * keeps a six-figure KeepTradeCut total from running under the team name.
 */
export const CONSOLE_FIGURE_WELL =
  "overflow-hidden rounded-[5px] bg-[color:var(--figure-well-bg)] " +
  "shadow-[var(--figure-well-shadow)]";

/**
 * The control track on a pane's own ledge.
 *
 * {@link CONSOLE_TRACK} is cut into a *panel* and takes the panel's key stock;
 * this is cut into a **ledge**, which is machined metal, so it is a hole in
 * that metal rather than a channel of key stock. Its colour is `--recess-bg`
 * rather than the `bg-black/N` this file usually spells a recess with — see
 * that token: the label stamped on this one is ink on metal, and 34% black
 * under a near-white ledge takes it to 3.4:1.
 */
export const CONSOLE_PANE_TRACK =
  "rounded-full bg-[color:var(--recess-bg)] shadow-[var(--track-shadow)]";

/** A chip of the same billet stock: one raised part carrying a pair of bays. */
export const CONSOLE_CHIP =
  "bg-[image:var(--chip-bg)] shadow-[var(--chip-shadow)]";

/**
 * The same chip standing in a **well** rather than lying in a tray.
 *
 * A chip in {@link CONSOLE_CHIP_TRAY} is one of a row set into a hole and
 * throws nothing; a game chip sits in a `StandingBay`'s milled well, where it
 * is the only raised thing and wants a cast onto the floor under it. A separate
 * constant rather than a caller appending one, because **a shadow list is
 * atomic**: a second `shadow-[…]` replaces the chamfer rather than adding to
 * it, and which of the two wins is Tailwind's emit order. `--chip-shadow-raised`
 * composes the pair in CSS, so the light counterpart comes from the chamfer's.
 */
export const CONSOLE_CHIP_RAISED =
  "bg-[image:var(--chip-bg)] shadow-[var(--chip-shadow-raised)]";

/**
 * The tray of holes a rail of {@link CONSOLE_CHIP}s sits in.
 *
 * Flat rather than a gradient, deliberately: it is a hole, and a hole has no
 * face to catch a light. That is also what separates it from
 * {@link CONSOLE_WELL} — a tray holding controls is a surface, a tray holding
 * chips is the absence of one.
 */
export const CONSOLE_CHIP_TRAY =
  "bg-[color:var(--chip-tray-bg)] shadow-[var(--chip-tray-shadow)]";

/**
 * The machined header a lit window's words are stamped into, above its glass.
 *
 * The unit and the scope live on the **metal** so the glass below holds only
 * the figure and its meter. That is the hierarchy fix rather than a decoration:
 * on one surface a caption and a number are peers however they are sized, and
 * on two the caption is plainly a label for the thing beneath it.
 */
export const CONSOLE_WINDOW_LEDGE =
  "bg-[image:var(--window-ledge-bg)] shadow-[var(--window-ledge-shadow)]";

/**
 * Lit glass with **no teal in its recess** — {@link CONSOLE_WINDOW}'s other
 * half, for a window that carries a machined header.
 *
 * `--glass-shadow` is `--window-shadow` with the inner accent glow taken out
 * and a black ring put in. The league card spends teal in exactly two places
 * now — the format lamp and a lit pip — and a third behind every rank figure is
 * what made the old tile row read as noise. A window whose words sit on metal
 * has a ledge to separate it from the housing, so it does not need the lit lip
 * `--window-shadow` closes that gap with either.
 */
export const CONSOLE_GLASS =
  "relative overflow-hidden bg-[image:var(--readout-bg)] shadow-[var(--glass-shadow)]";

/**
 * A housing set *inside* a housing, with its own padding — **and nothing draws
 * one any more.**
 *
 * It was the lineup checker's expanded week view until that half became an
 * `ExpandedPanel` like the manager and trade cards': the two halves of a card
 * are one piece of stock under a milled groove now, rather than a second
 * housing set into the first. `--housing-inset-shadow` lost its last reader
 * with it. Both are kept and noted rather than deleted, on the design bundle's
 * own instruction and `peekActiveSeason`'s terms — the argument below is what a
 * reader would otherwise have to reconstruct.
 *
 * Not a {@link CONSOLE_WINDOW}, and that is the decision rather than the
 * spelling. Every seat inside it is a window, and a lit card inside a lit pane
 * reads as glass on glass — so the pane is the bezel those windows are set
 * into, which is the manager card's grammar one plane down. The 12px radius is
 * the inner one; a nested surface repeating its parent's 18px reads as a card
 * that has slipped out of its own frame.
 *
 * Its shadow is `--housing-inset-shadow` rather than `--housing-shadow`: see
 * the token, which is that stack with the three drop shadows taken off. It is
 * `relative overflow-hidden` on {@link CONSOLE_WINDOW}'s contract, and its
 * `overflow: hidden` is safe here for the reason it is not on the card — this
 * sits *outside* the summary's `preserve-3d` subtree, where a clip has no
 * depth to collapse. (A `perspective` on it is safe for a narrower reason and
 * the two are worth telling apart: perspective survives a clip, where
 * `preserve-3d` does not. The manager card's expanded half projects its parts
 * from this element and is clipped by it.)
 *
 * {@link CONSOLE_HOUSING_INSET_SHELL} is the same surface carrying **no
 * radius**, for {@link CONSOLE_CARD_SHELL}'s reason: the manager card's
 * expanded half is a 14px part where the week view is a 12px one, and two base
 * `rounded-*` utilities of the same specificity are decided by Tailwind's emit
 * order rather than by the class attribute.
 */
export const CONSOLE_HOUSING_INSET_SHELL =
  "relative overflow-hidden border border-foreground/10 " +
  "bg-[image:var(--housing-bg)] shadow-[var(--housing-inset-shadow)]";

/** The same, at the inner 12px radius. */
export const CONSOLE_HOUSING_INSET = `${CONSOLE_HOUSING_INSET_SHELL} rounded-xl`;

/**
 * The metal finish, as a set of token overrides on a card's own container.
 *
 * A card wearing this reads as a machined face rather than a moulded one: the
 * housing, the plates straddling its edge and the keys mounted on it all pick
 * up the rolled banding and the fine vertical brush, and **not one element
 * moves to get it**. Every surface inside already names `--housing-bg`,
 * `--plate-raised-bg` or `--key-bg`, so overriding those three here is the
 * whole of the application — the cascade does the rest, and the grain is a
 * background layer rather than an overlaid span, which is what keeps it clear
 * of the `preserve-3d` constraint the card is built under (a clip collapses
 * the depth, with no error to say so).
 *
 * **Three surfaces, because three surfaces have readers.** `--plate-bg` and
 * `--bezel-bg` have metal counterparts in the design and no reader on this
 * card — the recessed plate is the page header's and the turned bezel is the
 * avatar mount's, both of which sit outside a card. A token nothing reads is
 * the dead weight this file's own history is written about, so they arrive
 * with the surface that wants them.
 *
 * It is a *finish*, not a shape: nothing here names a radius, a padding or a
 * colour of type. Compose it with {@link CONSOLE_CARD} or its shell.
 */
export const CONSOLE_METAL =
  "[--housing-bg:var(--housing-metal)] [--housing-shadow:var(--housing-metal-shadow)] " +
  "[--plate-raised-bg:var(--plate-metal)] [--plate-raised-shadow:var(--plate-metal-shadow)] " +
  "[--key-bg:var(--key-metal)]";

/**
 * A lit window a reader can *press* — **and nothing draws one any more.**
 *
 * It was the lineup checker's seat card until that view took the manager
 * card's pane grammar: a seat is a channel cut into the pane's glass now
 * ({@link CONSOLE_ROW_WELL}), because the two cards list the same leagues and a
 * row drawn as a lit window on one page and as a cut on the other is the drift
 * that convergence removed. Kept rather than deleted on `peekActiveSeason`'s
 * terms — what it carries is the argument below, which is the thing a later
 * reader would otherwise get wrong twice: why a pressable window is colourless,
 * and why its scanlines are a background layer rather than a child.
 *
 * {@link CONSOLE_WINDOW}'s surface with the scanlines folded in as a second
 * background layer rather than drawn as a child. A window normally carries its
 * own `<Scanlines />` span, and here it cannot: the element is a `<button>`
 * whose children are the row's content, and an absolutely-positioned overlay
 * inside one would sit above the text unless every cell were given a stacking
 * context of its own. Layered onto the background it costs nothing.
 *
 * **Colourless, for {@link CONSOLE_KEY_PILL}'s reason.** A pressed seat is lit
 * by an accent border and a halo, and appending `border-active` to a string
 * that already says `border-black/85` is decided by Tailwind's emit order
 * rather than by the class attribute. The caller composes `shape + state`, and
 * the state is a border colour and a shadow — **never a fill**, which would
 * stop the card reading as a window at all.
 */
export const CONSOLE_WINDOW_KEY =
  "relative flex w-full items-center rounded-[0.5625rem] border " +
  "bg-[image:var(--readout-scanlines),var(--readout-bg)] text-left " +
  "transition-[box-shadow,border-color] duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";
