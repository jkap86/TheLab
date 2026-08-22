# Design notes — UI and component decisions

Long-form rationale extracted from `CLAUDE.md` so the always-loaded file stays
small. The invariants distilled from these notes live in `CLAUDE.md` under
"Style"; this file is the argument behind each of them, kept because a rule
without its reasoning is a rule someone will re-litigate. Read the entry for a
part before redesigning it.

## Style

- Comments explain **why**, not what. Match the surrounding density — this
  codebase documents non-obvious decisions (rate budgets, Sleeper quirks,
  ordering constraints) and skips the obvious.
- Tailwind: use the `foreground` token for text/borders/surfaces and `active`
  for the accent. Both are registered in `@theme` in `globals.css`. Do **not**
  use `white` — it was the old convention and has been fully migrated.
- **Three faces are loaded and all three are now wired.** `app/fonts/index.ts`
  self-hosts Geist, Geist Mono and Orbitron; `@theme` maps them to `--font-sans`,
  `--font-mono` and `--font-display`. Only the first two of those registrations
  are recent, and the failure they fixed is the one to recognise if it ever comes
  back: the faces were being downloaded and preloaded on every page while
  `@theme` mapped only Orbitron and `body` named `Arial` outright, so the app
  rendered in Arial and every `font-mono` utility fell through to Tailwind's
  default stack — a different face per platform for the kickoff countdown, the
  record ledges and every number column. **A loaded font is not a used font**;
  the check is a grep for the variable, not for the `localFont()` call. One
  knock-on worth knowing: Geist's tabular figures are *narrower* than Arial's at
  equal size (`1,041.16` is 36.4px against 40.5px at `0.65rem`), so every fixed
  track measured against an Arial string gained slack rather than losing it —
  which is why the measurements in `roster-layout.ts` and `standings.tsx` did
  not all have to be retaken, and why the one that did was a track being asked
  to hold *larger* type rather than a different face.
- **Measure a fixed track, don't estimate it.** The panel's tracks are cut for
  the widest string they can be asked to hold, and the arithmetic is written
  beside them; the way those numbers were taken is a headless Chromium page with
  the real `woff2` files and the compiled stylesheet, rendering the component and
  reading `getBoundingClientRect()`. It is worth doing before touching a track,
  because the two failure modes are invisible in review and opposite: a track a
  hair too narrow clips a total into bad data, and one too wide comes out of the
  name, which is the only column with nowhere else to go.
- Wrap page content in `<PageShell>` rather than repeating the container
  classes.
- **Keyframes live in `globals.css`, not beside the component that uses them.**
  Tailwind v4 has no per-component keyframe mechanism, so `FlaskLoader`'s four
  animations are named there once and the component references them through
  inline `animation`. Two habits travel with that. Per-element timing (a
  bubble's duration and delay) stays in the component as data, since a keyframe
  can't carry it and a class per bubble would be four near-identical rules. And
  an SVG shape animated with `transform` needs `transform-box: fill-box`
  (`.flask-bub`) or `translateY`/`scale` pivot on the SVG root rather than the
  shape — the bubbles would fly across the flask instead of rising in it.
- **A decorative animation freezes under `prefers-reduced-motion`, it doesn't
  disappear.** The media query in `globals.css` kills `animation` on
  `.flask-loader *`, which leaves a static flask that still reads as a loading
  mark — the bubbles rest at their keyframe start (opacity 0), so what remains
  is the glass. Dropping the whole indicator would take the *status* away from
  the reader who asked for less motion, which is not what they asked for.
- **An *exit* animation costs a mounted beat, and the unmount is a timer rather
  than `animationend`.** Every other animation here plays on arrival, so it
  needs nothing of the component; the ADP drawer slides out as well as in, which
  means it has to stay rendered after `open` goes false — `closing`, set in the
  same render-time adjustment against the previous `open` that already resets
  the drawer's floating panels, and cleared by a `setTimeout` of the exit's own
  duration. **`animationend` is the trap**: under `prefers-reduced-motion` the
  media query kills the animation, so the event never fires and a drawer closed
  once would stay mounted forever. That block hides the closing panel outright
  instead, which is what makes waiting the beat out there invisible. Two details
  travel with it — the exit is `forwards`, or the panel snaps back into view for
  the frame between the animation ending and the unmount; and the closing panel
  takes `pointer-events: none`, since a press landing on a drawer that is
  leaving hits a control the reader can no longer see. The scroll lock is held
  across the exit for the same reason (a scrollbar returning mid-slide jumps the
  page sideways), while Escape and the focus move stay on `open` alone: what is
  leaving is not a dialog any more.
- **The flask's glass is the `active` token; its liquid is literal hex, and that
  is the exception rather than a lapse.** `@theme` registers exactly two colors,
  `active` and `foreground`, so a two-stop gradient — a lighter top and a darker
  bottom, plus a surface and a bubble tint — has no token to read, and the
  logo's magenta isn't registered at all. Those five values live in one `TONES`
  table in the component instead of being sprinkled through the markup, which is
  what keeps the exception containable. Anything that isn't a gradient stop still
  takes the token: the outline, the fill wash and the highlight all resolve
  `var(--color-active)` / `var(--color-foreground)` so a retheme reaches them.
  `AmbientBackdrop`'s aurora is the second instance of that exception and follows
  the same containment — literal `rgba` stops because a three-colour glow has two
  colours with no token, with cyan still spelled as the `active` value so the one
  that *does* have a token stays recognisable. Two instances is a pattern now: a
  gradient may hold literal colour, everything around it takes the token.
- **The tools page's treatment is the app's, and it is applied at three seams
  rather than page by page.** The grid used to look like a different product from
  the tool it opened — ambient aurora, glass, the display face and a gradient
  wordmark on `/tools`, flat surfaces and body-face headings everywhere else. The
  three pieces that closed it are shared, and each is shared for the usual
  reason (a second reader appeared, and two copies would drift):
  - `AmbientBackdrop` moved from `features/tools` to `features/shared` and is
    rendered once in `app/layout.tsx`. It is `fixed` at `-z-10`, so no page is
    laid out against it and none has to opt out.

    **Below `sm` it carries no `filter` at all, and that is a memory decision
    rather than a frame-rate one.** Three ~500px boxes under `blur(64px)` are
    three promoted compositor layers whose backing store is expanded by the blur
    radius on every side — tens of megabytes of GPU texture at a device pixel
    ratio of 3, spent on a decoration, on top of every `backdrop-filter` surface
    the page itself wears. That combined budget is what mobile WebKit discards a
    page over, which the shares sheet has already been fixed for once. So the
    gradient's own ramp does the softening instead, running to the full radius
    rather than stopping at 62% and being blurred outward from there, and the
    drift holds still on the same terms `prefers-reduced-motion` already freezes
    it. Desktop keeps the blur, the tighter stop and the drift exactly as they
    were. Two details make it work: the **tint is a custom property**
    (`--aurora-tint`) so the class can own the *shape* at each width while the
    colours stay on the component where the gradient exception puts them, and the
    blur is `sm:blur-3xl` — a Tailwind variant rather than a `filter: none`
    override, since a `.lab-*` rule in `@layer components` loses to a utility and
    would have silently done nothing.
  - `PageHeading` is the eyebrow, the gradient display title and the lede, used
    by every page that leads with a title. `size` is the only thing that varies —
    `hero` for `/tools`, where the wordmark *is* the page, and `page` everywhere
    else, where the app bar has already named the tool. **`/trades` leads with
    its controls instead and has none**, which is the honest end of that
    "the app bar has already named the tool" clause: a board that is a bank of
    filters over a list several thousand rows long was spending ~96px on a word
    the bar says a few pixels above it and a scope line the controls themselves
    now say, beside the keys that set it. Reach for the heading when a page has
    something to say before its content; skip it when the first control *is* the
    content's own description.
  - `LIST_ROW_SURFACE` / `LIST_ROW_HOVER` / `RowSheen` are the tool cards' glass
    held to a row's height, worn by the share cards. (Trade cards wore it and
    don't now, **league cards followed them**, and the lineup checker's rows
    followed those — all three are machined rather than glass, which is argued
    where each card is. That leaves *one* list on this surface rather than the
    three it was written for, so what it is still **for** is worth restating: it
    is a row that opens into more of itself, or is one line of a table, rather
    than an object standing on the page. A fourth list reaching for it should
    check itself against that sentence first; three have now failed it.)
    What they deliberately don't take is the **corner brackets** — those are a
    card-scale device, and four of them on each of a hundred-odd rows reads as
    noise rather than as an instrument. Two details in `RowSheen` are
    load-bearing. The light sweep is clipped by **its own box, not by the row's
    `overflow`**: a stat column's picker menu hangs *below* the row it belongs
    to, so `overflow-hidden` on the row would cut the menu off — a bug that only
    appears once someone opens one. And the sheen must render *before* the row's
    content, with that content positioned (`relative`), since an absolutely
    positioned sibling paints above static content whatever the source order.
  The display face travelled with them onto every named row, one size step down
  (`text-sm` where the body face was `text-[15px]`): Orbitron is wider, so
  holding the size would truncate a long league name sooner than before.
- **A pure-SVG component is not a client component.** `FlaskLoader` has no
  interactivity, so it renders on the server too and stays out of the bundle;
  what makes that safe is `useId` for its gradient and clip ids, so two loaders
  on one page can't collide over a hardcoded `id`. Reach for `"use client"`
  when there's state or a handler, not because a component draws.
- **A debounce is a promise about one subject, and the comps board is where that
  promise broke.** Weight edits are held for a quarter second before they re-key
  the query, which is right for what it was written for: a drag across a slider
  is one request, and the rows on screen still describe the player whose name is
  above them, dimmed under "Updating…". Boards are per position, though — a
  receiver's fields are not a quarterback's — so the subject and the board move
  together on a press while only the board is debounced. Picking a quarterback
  while a customized receiver board was settling therefore built, and sent, a
  request pairing the new subject with the old position's weights. It is not a
  flicker: the answer is a real comparison of that quarterback on a receiver's
  criteria, and it lands in its own cache entry under its own key, so a reader
  returning to that combination is served it again.

  The instinct is to make the effect that adopts the new board fire sooner. That
  is the same bug with a shorter fuse — any state an effect catches up to can be
  a frame behind the state that changed. So what the request is built from is
  **derived** instead (`comps/board-settle.ts`): settled board where it belongs to
  the position on screen, live board the moment it doesn't. A derivation computed
  during render cannot lag its own inputs. The settled state still moves, on a
  tick rather than a timer, because it is the baseline the *next* edit within the
  new position is debounced against — and nothing a request is built from is
  waiting on it.
- **A combobox is one control with one focus, and the popup is scenery.** The
  comps picker was built the other way round and the shape is worth recognising,
  because every symptom of it is invisible on screen: each suggestion was a
  `role="option"` `<li>` with a real `<button>` inside, selecting on
  `pointerdown`. That is two interaction models over one control, and they
  disagreed everywhere they met. Twelve suggestions were twelve tab stops between
  the search box and the rest of the page, so Tab no longer left the picker.
  Enter on one of those buttons fires a `click`, which nothing was listening for,
  so the keyboard could reach a suggestion and then not select it. And the moment
  focus moved to a button the field's `aria-activedescendant` stopped meaning
  anything at all — that attribute only speaks for a *field that holds focus*, so
  a screen reader was being told about an active option by an element that had
  none. None of it fails a type check, none of it fails a render, and a reader
  with a mouse never meets any of it.

  What replaced it is the ARIA pattern taken literally: the field is the only
  focusable part, the options are plain `<li>`s, and `shared/combobox.ts` owns
  the keyboard — pure, so what a press means is tested rather than described.
  Three of its decisions are choices rather than transcription. **An arrow on a
  shut popup opens it and moves nothing**, because advancing as well skips the
  suggestion already highlighted, which is the one most readers want. **Home, End
  and Space are left alone** — a combobox is a text field first, and claiming the
  listbox pattern's keys would leave the reader unable to edit their own query.
  And **Tab closes without committing**: picking here re-keys the whole page
  against a new subject, so a reader tabbing past a search box they were done
  with would arrive somewhere they never asked to be. Escape and a press
  elsewhere are dismissals; Tab is one too, not a shortcut.

  **The pointer half is one line, and it is the line that makes an option a plain
  `<li>` possible.** Focus leaving the field closes the popup, which is what
  makes Tab behave — but a mouse press on a suggestion *also* moves focus, so the
  list would unmount under the click that was about to select. The popup
  therefore swallows the default of `mousedown`, and focus never leaves. It is
  also strictly better than the `pointerdown` it replaces: `pointerdown` fires
  before a gesture is known to be a tap, so a finger dragging to scroll the list
  selected whatever it started on, where the compatibility `mousedown` is
  synthesised only for a real tap. The outside-press close stays beside the blur
  rather than being replaced by it, because a tap on inert page furniture does
  not reliably blur a field on iOS — pointer and focus are two halves of one
  rule, not two copies of it.

  The ids moved for a quieter reason. They were positional (`…-option-3`), so
  every keystroke made the same id a different player — an assistive technology
  caching by id is told the fourth row was renamed rather than that the list was
  replaced. They are keyed by `player_id` now, and both ends of the pair are
  built by the same function, because `aria-activedescendant` is a string that
  has to match an `id` with nothing in the type system relating the two.

  **`LeaguePicker` on `/picktracker` is the same control and has not been
  changed.** It never had the nested button — its options are already plain
  `<li>`s — so it is missing the smaller half of this: it does not close on Tab,
  its first ArrowDown from a shut popup skips a league, Enter after Escape picks
  out of an invisible list, and its option ids are positional. Moving it onto
  `shared/combobox` is the obvious next edit and is why that module is in
  `features/shared` rather than in `features/comps`.
- **The tools page's account section resolves in place; the other two searches
  navigate.** `ManagerSearch` and `PicktrackerSearch` hand what you typed to a
  route and let the destination resolve it, so a typo is only discovered as a
  failed page. `UserLookup` *is* the destination: it asks `/api/user/[username]`
  who that is and shows the avatar and canonical `@username` back, because
  Sleeper resolves a user id as readily as a name — what you typed is not proof
  of who you meant, which is what makes the extra request worth making before a
  tool is picked. A resubmit aborts the lookup still in flight, or the slower
  response wins whichever was asked for last. That resolved identity is now what
  the section is *for*: `ToolsHome` writes it to the shared account store and the
  grid below reads it, as does the pick tracker's own page — so the extra request
  buys the tools something and not just a confirmation.
- **Client-side persistence is one mechanism, `features/shared/local-store.ts`,
  and a `useSyncExternalStore` over `localStorage` per key.** Two things are
  stored — the resolved account and the stat-column selections — and they were
  the same twenty lines, whose rules are subtle enough that a second copy is a
  second chance to get one wrong. Three of them are load-bearing and easy to undo
  by "simplifying" the store away. The server has no storage, so
  `getServerSnapshot` returns null and a stored value appears only after
  hydration — reading `localStorage` during render is the hydration mismatch this
  shape exists to avoid. The snapshot is the **raw string**, parsed in a
  `useMemo` keyed on it, because `useSyncExternalStore` compares snapshots by
  identity and a fresh `JSON.parse` per read looks like a change every render and
  loops. And a write notifies its own listeners by hand, since the `storage`
  event fires in *other* tabs but never the one that wrote. Every key shares one
  listener set: a reader of another key gets the identical string back, so React
  re-renders only what moved. Writes are wrapped in `try`/`catch` because storage
  can be blocked — persistence here is a convenience, never correctness, which is
  why a blocked write still lands in the module-level `memoryFallback`: with the
  store as the only state, dropping it would discard a successful lookup and
  leave the grid locked.
- **The account is what that store was built for.** A reload, or a trip out to a
  tool and back, used to drop you at an empty search box — with the grid gated on
  the account, that made the gate feel like a wall. Only the resolved `UserInfo`
  is kept; leagues re-derive from `user_id`.
  It lives in `features/shared/account.ts` rather than beside the tools page that
  writes it, because a tool *page* reads it: the pick tracker's league picker is
  on `/picktracker` and fills itself from the account resolved on `/tools`. That
  is what the persistence buys beyond surviving a reload — a tool can skip asking
  for a username a second time even though it is a separate route.
- **A stat-column selection is a preference, so it is stored, and it is keyed by
  the catalogue's grain.** `usePersistedColumns(name, defaults, metrics)` is the
  second thing in that store: which metric each slot shows is chosen once and
  then read down a list several hundred rows long, so re-aiming four columns
  after every reload was the whole cost. The key is the grain — `league`,
  `standings`, `roster` — never the page or the league: a selection only means
  anything against the catalogue it was picked from (see the four-catalogue table
  above), and per-league keys would bring back exactly the unreadable list that
  holding columns per *card* would. It matters most in the expanded panel, which
  mounts on expand and unmounts on collapse, so its two tables used to reset
  every time a different league was opened. `resolveColumns` (pure and tested,
  `features/shared/columns.ts`) reconciles what was stored against the catalogue
  **per slot**: a stored selection outlives the build that wrote it, so a metric
  since renamed or dropped falls back on its own rather than resetting three good
  choices with it, and `defaults` fixes the row's length so a table given a third
  column lays out either way. Two writes sit beside it in the same pure module,
  and each closes a hole the per-slot write left. `assignColumn` **swaps**: a
  metric picked into a slot another slot already holds trades places with it,
  rather than spending one of four columns — across a hundred-odd cards — on a
  number already on screen. And **`reset` is what makes the persistence safe to
  have**: the selection outlives the session, so without a way back a reader who
  aimed all four somewhere unhelpful is followed by that board to every later
  visit. It clears the key rather than writing today's defaults into it, since
  what a table opens with is the catalogue's to change.
- **The stat columns are named once above the list, not on every card.** The
  selection has always been list-wide — one pick moves the column on all
  hundred-odd rows — and drawing the labels per card said the opposite, which is
  why changing the board read as four unrelated errands. `ColumnsBar` is that
  heading rail: the labels are the editor's triggers in one place, laid on the cards'
  own geometry (`COLUMN_BOX` in `metric-column.tsx`, written once so a heading
  can't drift a pixel off the number under it, with a transparent `divide-x`
  because the cards' own divider sits *inside* their box). Four things it
  taught:
  - **It pins itself under the app bar, and it is the only part of these pages'
    header that does.** A rail that scrolled away halfway down the list would
    leave the numbers unlabelled, which is the whole argument — and for a while it
    was met by riding *inside* `ManagerHeader`, which pinned the manager plate and
    both filter rows along with it. That is a card's worth of facts about the
    account held on screen permanently, paid for out of the list, so that four
    headings could stay. The account is read once and the headings are read at row
    ninety, so the plate scrolls and the rail holds (`ListLedge`'s `pinned`).
    Two things follow. It is a **sibling** of the header and of the list rather
    than a child of either — a sticky part travels only as far as its own parent's
    box, so a rail seated in the header, or in any box wrapping it and the filter
    row, sticks nowhere; the box it needs is the one the rows are in, which is the
    page shell's `<main>`. And it **paints the page's ground on its own box**,
    outside the inset that lands its headings over the cards' numbers, or the rows
    scroll through the gutter either side of the billet.
  - **A card names none of its columns and holds no picker, at any width.** The
    labels used to come back below `sm`, where the rail was dropped, and that
    made one list two products either side of a breakpoint — a heading rail on a
    laptop, four per-card labels and menus on a phone, saying the selection was a
    fact about *this* card when it is a fact about the list. What actually breaks
    down there is geometry, not the rail: a card stacks, so its columns take a
    line of their own — so the rail stacks too (trigger on the first line,
    headings on the second) and still sits over the numbers it names. The cards
    keep an `sr-only` label per column, since nothing visible on the row says
    what "#3 of 12" ranks.
  - **The column is as wide as the longest label from `sm` up, and an equal share
    of the row below it** — 96px up there, where 80px truncated a third of the
    catalogue; `flex-1 min-w-0` down here, because four fixed 96px columns plus
    the card's insets overflow a 390px screen while four equal shares of the
    card's own line cannot overflow at all (and come out wider than the 80px this
    used to hard-code). Both ends resolve through `COLUMN_BOX`/`COLUMN_ROW`, which
    is what lets one heading rail serve two geometries.
  - **The share lists' selection moved up to the tab** for the same reason: the
    rail that edits it is in the header, on the other side of the list, and one
    selection can't be owned by two places. Both share views share the key
    `share`, which is the grain rule doing its job — a stored `adp` column simply
    falls back per slot on the leaguemates list, which has no board price.
- **`ColumnsEditor` is every slot at once, and it commits live.** The
  per-column menus were right for changing one column and wrong for changing the
  board: four slots are rarely four independent choices, so recomposing them was
  four menus and four passes over one flat list with nothing to see until the last
  pick landed. The dialog is the slots across the top, the catalogue in captioned
  bays (`Metric.group` + `groupMetrics`, so the catalogue stays one ordered array
  rather than two lists that can disagree), and `ColumnPreset`s as one press each.
  Where it parts company with `LeagueFiltersModal` is instructive: **that one
  holds a draft because its options carry counts, and a count can't be read while
  the list behind it moves.** Nothing here is counted — the slots preview what
  each column will say — so there is nothing to protect from moving, which is why
  the footer says `Done` and not `Apply`. A preview is against one arbitrary
  subject, so the footer names it.

  **How many slots there are is the caller's, which is what lets one dialog serve
  two tools.** The lists wear four; the league detail panel's standings and roster
  each wear two, since a table rendering at half a card's width has room for two
  numbers. Nothing in the dialog counts to four — the wells lay out on the row
  they are given, and the header spells the count it was handed. The one thing
  that is *not* generic is the layout: a pair of slots keeps `grid-cols-2` at
  every width rather than taking four tracks, since two wells with half a row
  empty beside them read as two columns missing rather than as a table that has
  two. Both class strings are written out whole, the usual Tailwind rule, and
  `columns-editor.render.test.ts` pins the pair — a conditional class and a
  spelled-number table are the category of thing that is invisible in review and
  only wrong on screen.
- **It is the *only* way to aim a column, and a heading is what opens it.** The
  rail's per-slot menus and a `Columns` chip beside them were two controls over
  one board, and each was worse than the dialog at the job the other did: the
  menu was a flat catalogue with no preview, no preset and no word about which
  other slot already held the metric being picked, and the chip always opened on
  slot 1, so changing the fourth column was a press to open and a second press to
  aim at the column already named on screen. Both are gone. `MetricHeadings`
  takes an `onOpen(slot)` and holds no state at all; `ColumnsBar` owns which
  heading was pressed; `ColumnsEditor` takes it as `openSlot` — non-null *is*
  open — and reports every way out (Escape, backdrop, `Done`) through the
  `<dialog>`'s own `close` event, so the parent hears one signal rather than
  three. `openSlot` **seeds** the armed slot rather than being it: re-arming
  inside the dialog has to survive, and the seeding is done during render against
  the previous `openSlot`, since an effect would point the panel at the wrong
  column for a frame.

  **The league detail panel was the last place the retired menus survived, and it
  has them no longer.** Its two tables hung the same flat catalogue under whichever
  heading was pressed — every argument above, one tool over, and doubly so for a
  panel a reader arrives at *from* the list this dialog already serves. Both
  headings open the editor now, one per table, since a team's aggregate and a
  player's number are two catalogues and two selections. What that retired with
  them is an apparatus the panel used to own: one-picker-at-a-time, an
  outside-click listener, an Escape listener, and each half lifting its stacking
  order over the other so an overhanging menu wasn't painted under it. A
  `<dialog>` is in the top layer and reports every way out through its own `close`
  event, so all four are the platform's. **Which is exactly why `LeagueSheet`'s
  `onClose` had to grow a target test**: React walks its own tree for `close`,
  which does not bubble in the DOM, so a dialog opened *inside* that sheet took the
  sheet down with it — the rule the shares sheet already carries, arrived at again
  by a component two modules away growing a dialog.
- **`useColumnsEditor` is which heading was pressed plus the latch that keeps the
  dialog mounted through its own close**, and it is shared because there are three
  of these now — the lists' rail and the panel's two tables. The latch is the half
  worth reading twice: the editor is a `dynamic()` import that reports its exit
  through its own `close` event, so unmounting it the instant the slot clears is
  unmounting a component inside its own handler. Latched, it also makes the second
  press instant.
- **The account is the key to the whole grid: every card is inert until one
  resolves.** Each tool reads that account, so `ToolGrid` passes `disabled={!user}`
  and `ToolLinkCard` renders an `aria-disabled`, dimmed `div` instead of a
  `Link` — there is nothing useful behind any of these cards without knowing
  whose leagues to read. What resolving unlocks differs by tool, which is where
  the two overrides come in: a tool carrying `hrefFor` resolves its own
  destination from the account, skipping the username search it would otherwise
  land you on (you just typed that name — asking twice is the drift `UserLookup`
  exists to prevent) — the manager tool is *three* such cards, Leagues, Players
  and Leaguemates, because its tabs answer different questions and are separate
  routes, so the grid links each rather than dropping you on Leagues to navigate
  again; they share the account-less `/manager` href, which is why cards are
  keyed by name. **`hrefFor` receives the username already URL-encoded** — a new
  tool must interpolate it bare, because encoding again double-escapes and yields
  a 404 for any account whose name isn't plain ASCII, which is exactly the
  account nobody tests with. The encoding itself lives in `toolHref` (in
  `features/shared/tools.ts`, pure and tested): the grid was the single call site
  until the app bar's menu became the second, and a rule two callers have to
  remember is a rule one of them eventually won't. The pick tracker has no
  `hrefFor`, because a league *id* is the one
  thing a username does **not** give you — it links to `/picktracker` and that
  page does the choosing.
- **Choosing a league is a step of the pick tracker, not of picking a tool.** The
  combobox over an account's hundred-odd leagues used to sit inside the grid's
  tool tile (a `PicktrackerCard` that replaced the link entirely); it is on
  `/picktracker` now and the grid card is an ordinary `ToolLinkCard` like every
  other one. Moving it costs no extra typing precisely because the account is
  persisted — the page reads the same stored `UserInfo` and lists its leagues
  without a second username prompt. Two things that page keeps: the raw-id form
  stays *below* the picker whether or not an account is stored, because that is
  the path the route was built for (opened from a league chat mid-draft, where
  there is an id in the URL bar and no Sleeper account in hand), and with no
  account it is the whole page — `useUserLeagues(null)` fetches nothing, so the
  no-account state is idle rather than empty. `/picktracker` is therefore not a
  page the grid merely declines to link to any more; it is where the tool starts.
- **`useUserLeagues` is not `useManagerLeagues`, for the reason the four manager
  sub-resource hooks *are* one hook.** Both decode the same NDJSON stream off
  `/api/user/[username]/leagues`, but the picker wants the list and none of the
  progress-bar machinery the manager tool's header is built around, and it clears
  `loading` on the first `result` rather than waiting out a background refresh
  that may still be syncing — a menu is fillable from the cached copy. Two hooks
  that differ in what they guarantee are two hooks; two that differ only in a URL
  are one. The line worth drawing inside that: **the guarantee is theirs, the
  protocol is shared.** Splitting an NDJSON buffer into whole lines is not a
  guarantee either hook makes, so `takeLines` lives once in
  `features/shared/ndjson.ts` — two copies of it was the same drift the
  `shared/query` primitives were consolidated to stop. Keeping two hooks does not
  mean keeping two of everything in them. It lives in `features/shared` rather
  than in the pick tracker that first wrote it, because `takeLines` is protocol
  and belongs to neither.

  **That line moved, and where it had been drawn was costing the app its most
  expensive read.** `takeLines` was the only thing shared, so `useUserLeagues`
  carried its own decode loop *and its own storage* — `useState` behind a
  `useEffect`, which is not a cache. `/api/user/[username]/leagues` is a manager
  sync behind a blocking advisory lock at up to ~11 Sleeper requests a league, and
  it was being re-streamed in full on every mount: out to `/tools` and back, a hop
  between the two tools that read it, or a press of the back button. Both of them
  are separate routes, so remounting *is* how they are used. The whole decoder is
  `features/shared/leagues-stream.ts` now (`features/manager/query-fns.ts`
  re-exports it, the mover's usual habit) and both hooks are queries over it, so
  the read is one per `MANAGER_STALE_TIMES.leagues` window however many times it
  is mounted, and two tools open on one account are one request. **Neither
  guarantee changed** — that is what makes it the same rule rather than a
  merge. The manager tool still reports per-league progress and a manual refresh;
  the picker still fills at the first `result` rather than waiting out a
  background refresh. Keeping the second of those is the subtle half: the fetcher
  publishes each mid-stream state into the entry and only *resolves* at the end,
  so `loading` is read off the published payload (`result === null`) and not off
  `isPending` — which is wrong at both ends, since a disabled query is pending
  forever and publishing *any* state settles the query, including a cold
  account's `progress` message that carries no leagues yet.

  **And all three readers ask by *username*, which is what makes them one entry
  rather than two that happen to hold the same list.** The pick tracker and the
  lineup checker hold a resolved account, so they could ask by either half of it,
  and they asked by `user_id` — on the honest reasoning that the id is what those
  pages have and that Sleeper resolves either. What that missed is that the
  manager tool has *only* a name (it is the URL segment), so the id was the one
  spelling the three could never share: a reader who looked themselves up in the
  manager tool and then opened the lineup checker paid for the same stream twice,
  under `manager/<id>/leagues` and `manager/<name>/leagues`. The name is the
  spelling they can all reach, `managerQueryKeys` lower-cases it so a typed
  `Jkap` and a canonical `jkap` are one entry, and the route resolves a name
  exactly as it resolved the id. **The cost is that these two pages now depend on
  the stored username still being current**, where an id is immutable — a Sleeper
  rename leaves the stored account naming somebody who no longer exists, and both
  pages 404 until it is re-resolved on `/tools`. That is the same exposure every
  `/manager/<name>` URL already has, and it is the price of the three tools
  sharing one entry. The sub-resource reads are unaffected either way: they put
  the name in the path but send `?user_id=`, which is what actually resolves
  them.
  (The trades page was the second reader of the hook
  itself for a while; it reads every crawled league now and asks about no
  account, so the pick tracker and the lineup checker are its two readers.)
- **A piece read by a second tool moves to `features/shared`; it does not get
  imported across features.** The trades page needed the league-filter
  vocabulary, the modal that drives it, the date primitives and `ordinal`, and
  all four were sitting in `features/manager`. They are
  `features/shared/league-filters/`, `ui/league-filters-modal.tsx`,
  `date-range.ts` and `format.ts` now. Two habits keep that cheap. The mover
  **re-exports from where its old consumers already import it** —
  `adp-controls` still hands out `todayIso` and `shiftDays`, `manager/format`
  still hands out `ordinal` — so one canonical definition is read under two names
  rather than a sweep through a dozen call sites. And what moves is only what a
  second tool actually reads, because a shared module that collects a feature's
  whole vocabulary is just the feature again under another name. **`manager/format`
  is the limit case of that second habit and worth reading as a warning rather
  than as a model**: it kept the KTC values, the week horizons and the contracted
  player name for exactly as long as only the manager tool rendered them, and the
  league detail panel's move took all four — so what is left is a file of
  re-exports with nothing of its own. That is fine and is what the first habit is
  for; what it says is that "only this tool reads it" is a fact with a shelf life,
  not a property of the module.

  **The subject rail and the two shares sheets are the largest thing that rule
  has moved, and the move is instructive for what it had to change rather than
  for its size.** The lineup checker draws the same filter row — the league
  filters' key, the player/leaguemate search, and the two doors onto the ranked
  shares lists — so `subject-rail`, `subject-parts`, `columns-bar`,
  `columns-editor`, `metric-column` and the whole `ui/shares/` subtree are in
  `features/shared/ui/` now, with the pure halves they read (`subjects`,
  `name-search`, `shares`, `leaguemates`, `share-metrics`, tests included) beside
  them and `Chevron`, `SharedLeagueRow` and `ErrorCard` carried along. Two things
  are worth reading:

  - **The cache layer came with it, and the whole table came rather than the two
    entries the rail reads.** `features/shared/manager-query.ts` holds
    `managerQueryKeys`, its TTLs and `fetchManagerResource`, plus
    `useManagerResource`/`useManagerPlayers`/`useManagerLeaguemates` beside it.
    Keying both tools the *same* way is the point rather than a side effect: the
    lineup checker keys on the stored account's **username**, so a reader who has
    looked themselves up in the manager tool pays for none of it again. And
    `managerQueryKeys.manager()` is the prefix every entry hangs off, so splitting
    out `players` and `leaguemates` would leave the manager tool building keys
    onto a root it no longer owns — two spellings of one prefix, which is the
    drift a key module exists to stop.
  - **What the parts took as a prop had to shrink first.** They took
    `FilteredLeagues` — a cached NDJSON stream keyed on a searched name, with its
    filters in providers — which is the manager tool's *state*, not the parts'
    contract. What they actually need is two league lists, two selections and how
    to name a chosen subject, so that is `features/shared/subject-view.ts`, and
    the subject selection travels as a **value** rather than being read from a
    context: a provider is what three routes sharing one selection need, and a
    shared part that insisted on one would be making that choice for a tool that
    is a single page. `useFilteredLeagues` gains three fields and a one-line check
    that its return still satisfies the type — declared where the return is, so a
    rename is an error there rather than in `features/shared`.

  **The league detail panel is the largest thing that rule had moved before it.** The
  trades board opens a trade card into the same standings and rosters, so
  `components/league-detail-panel` and the five components under it are
  `features/shared/ui/league-detail/`, and what they read went with them: the
  standings and roster metric catalogues (`features/shared/{standings,roster}-metrics.ts`,
  tests included), `useLeagueDetail` and the query key and TTL behind it
  (`league-query.ts`, the `schedule-query.ts` precedent), the four formatters the
  panel is written in, and `PanelMessage`/`PanelLoading` (`ui/panel-message.tsx`,
  which the manager views still read through their own `components/ui`). What did
  **not** go with it is anything about a manager — the panel has never asked whose
  leagues these are, which is exactly why it ports to a page with no account at
  all. The three pieces that left no re-export behind (`teamLabel`,
  `managerLabel`, `TeamAvatar`) are the ones whose only readers moved too.

  **The manager plate was the largest before it, and it took four
  modules with it.** The lineup checker draws the same card, so
  `components/manager-header/` is `features/shared/ui/manager-header/`, and what
  it reads went with it: `record.ts` (the record's shape and the two rules that
  sum one), the four formatters the plate is written in plus `formatPoints`, and
  `useKickoff` with the key and TTL it reads (`schedule-query.ts` — the instant
  was never manager-scoped, it is a fact about a season). Each leaves the usual
  re-export behind. Two details worth keeping. The card is **not** on
  `features/shared/index.ts`: it pulls in a countdown, a dial and a query hook,
  and from that barrel it would join the graph of every page that imports
  anything shared — so both call sites name the module path, the rule the ADP
  drawer and the league filters dialog already keep. And the three sync-state
  props are **optional**, because the second page has no leagues stream behind
  it: a page with nothing transient to report passes none rather than threading
  three nulls through to say so.
- **The trades page carries two filter sets, like the manager tabs, and for the
  same reason.** The league filters say *which leagues' trades are in the list at
  all*; the trade filters say *which of those trades* — circle, seek, players,
  picks, managers. One is about where you play, the other about what happened
  there, so they stay two controls rather than two tabs of one dialog. **They
  are no longer the same *kind* of control, and that asymmetry is the point**:
  the trade filters are `TradeControls`, seated on the page with nothing behind a
  press, while the league filters stay a modal, because that dialog is shared
  with the manager tabs and a control rendered on two pages with two shapes is
  the drift a shared component exists to stop. That is also why only one trigger
  on this row needs a word: the modal says `Leagues` (`label`, defaulting to
  `Filters` where it is the page's only one), and there is no second `Filters`
  key to be confused with it — two parts wearing the same word are two answers to
  the same question.

  **The trade filters got there by losing a ledge, and the lesson is worth the
  paragraph.** They were one line that expanded in place onto a panel holding the
  scope and a date window, on the reasoning that both are chosen once and then
  read — which is right about *reading* them and wrong about the press. The scope
  is the page's most consequential narrowing (it is the difference between the
  whole crawled market and one account's corner of it) and the seek is a place in
  the list, which is not a setting at all; behind a press both were invisible, so
  the ledge had to carry a summary line restating them, and **the summary was
  doing the work of the control it was hiding**. On the page they state
  themselves — an instrument naming its circle, a pinned date key — and the
  ledge's own `Filters` trigger, its badge, its `dynamic()` split and half its
  summary line all went with the
  panel. What is left of the summary is `season · league rules · the bays`, and
  the bullet on `tradeFilterSummary` is why: a line beside a control must not
  restate what the control already says, which is the league detail panel's
  dropped team plate one page over. Reach for a disclosure when what is behind it
  is genuinely settings; a control that has to be summarised outside itself is
  one that wanted to be on the page. Both filter sets are applied by
  the **database** now, which is the change the whole page is arranged around
  (see the next bullet); what stays on the client is the league *rules*, because
  they are a slot-group and scoring-key engine over Sleeper's JSONB and a second
  implementation in SQL would drift silently — the symptom being a filter that
  quietly returns the wrong leagues rather than an error. So the rules run over
  `/api/trades/leagues` and their **answer** — a list of league ids — is what
  crosses the wire. The trade filters' own menus are still read *off the trades*
  — which players moved, who deals most, which pick seasons are on the table —
  because a fixed list would offer players nobody traded while hiding the one
  someone wants; they are `/api/trades/facets`, a grouped aggregate over the same
  population, asked for only while the search panel is open. Two details in the menus:
  each option carries how many trades it would leave, counted over everything
  *except* the selection itself — counting over the narrowed list collapses a menu
  to its own selection the moment you make one, and it can't be widened again
  without being cleared — and the whole page is **every crawled league's trades,
  not one account's**. It was scoped to the stored account's leagues and isn't
  now: the leagues someone plays in are a fraction of the trades worth reading,
  and what a league shaped like theirs gave up for a rookie first is most of the
  value. The **circle** is what narrows it back to their own, which is why
  nothing is lost by opening the default — and the page still needs no stored
  account, making it the one tool the grid doesn't grey out without one
  (`accountless` on its catalogue entry, so the grid and the app bar's menu can't
  disagree about whether the card is live): an account buys that one filter and
  changes nothing else on the page.
- **The circle is one selection with four answers, not three switches, and it is
  the only filter here the browser cannot resolve for itself.** "My leagues",
  "trades a leaguemate made" and "any league a leaguemate is in" are the three
  narrowings a reader asks for by name, and they **nest**: every trade in a league
  you play in was made by people you play against, and everyone you play against
  shares a league with you, so `mine ⊆ leaguemates ⊆ leaguemate-leagues` and
  independent switches would only ever offer the widest one ticked. What varies is
  how far out the circle is drawn.

  **So the control is a stepper, and the nesting is what makes it one.** It was
  four keys of equal weight, which is the shape a set of unrelated answers takes
  — in an order (widest, then narrowest, then two middles) no reading of the row
  could decode, wrapping to two lines on a phone, three of them inert without an
  account and each carrying the same sentence saying so. `‹` and `›` are the two
  presses the question actually has, over a `.lab-readout` naming the circle with
  four pips for where along the radius the board is standing. Four things hold it
  up, and the first is why the table moved: **`TRADE_CIRCLES` is in radius order,
  narrowest first**, since the stepper walks it and the pips count along it —
  there is nowhere in a stepper to hide an arbitrary order. **`stepCircle` owns
  both bounds**, the ends of the ladder *and* the account, because a stepper asks
  "can I move" where a key per circle asked "is this one allowed"; it answers null
  rather than clamping, so a key with nowhere to go is drawn inert rather than
  re-selecting what is already showing. **The instrument is a fixed width from
  `sm`**, not a share of its row — beside the sentence it sits next to, whose
  `sm:basis-auto sm:flex-1` resolves to `flex: 1 1 auto` (Tailwind emits
  `basis-auto` after `flex-1`), a share made the readout resize with *that
  sentence's* length and `LEAGUEMATE TRADES` came out as `LEAGU…`. And **the
  sentence under it now always speaks**: the four keys printed each circle's full
  name, so a note repeating the selected one was a restatement and went quiet on
  the widest; a readout has room for the name and not for what the name means,
  which is the half that separates the two leaguemate readings. What it costs is
  up to three presses to reach a named circle where four keys were always one —
  the trade the mockups (`docs/mockups/trades-scope-and-seek.html`) were drawn to
  price, and the one that was chosen.

  Five things hold the circle itself up:
  - **It crosses the wire unresolved, where every other filter sends its answer.**
    The league rules go the other way round — the browser already holds the
    season's leagues for the dialog's counts, so it evaluates them and sends ids —
    but *which leagues are yours* and *who shares one* is the database's answer,
    which a browser would have had to be told first. So `?user=&circle=` travel and
    `shared/trades/circle` resolves them, cached per reader for ten minutes because
    a scroll is many requests. Both parameters go or neither: the account store has
    no server snapshot, so a circle sent alone would key a board the route resolves
    straight back to the unnarrowed one.
  - **Two of them narrow leagues and one narrows who was dealing**, which is why
    the resolver hands back a tagged scope rather than a league list. `mine` is
    `getManagerLeagueIds` — the manager module's own `FIELDED_A_TEAM_SQL`, so the
    board and the manager tool cannot disagree about which leagues are yours.
  - **The reader counts as their own leaguemate for one circle and not the
    other.** `leaguemates` includes them, which is what makes `mine` a subset by
    construction rather than by an argument about counterparties (that argument
    fails on a three-way trade whose other rosters are orphans). `leaguemate-
    leagues` excludes them, because Sleeper leaves a `league_users` row behind
    when someone stops holding a team — counting it would pull a league into the
    widest circle that `mine` deliberately drops, which reads as a bug because it
    is one. Their real leagues arrive anyway, through the leaguemates still in
    them.
  - **The leaguemate-trades predicate is driven by the trade's own roster ids, and
    that is a planner decision.** Written from `rosters` inwards —
    `FROM rosters WHERE league_id = t.league_id AND owner_id = ANY(…)` — the
    subquery is decorrelatable, and against a few hundred leaguemates the planner
    takes it: hash join, whole population, top-N heapsort, the same cost on page 40
    as on page 1. Unnesting `roster_ids` makes it a function of `t` so it cannot be
    pulled up. Measured over 150k transactions with 850 leaguemates: **205ms that
    way, 9ms this way**, and only this way is flat with depth. All four circles are
    ordered index walks off `transactions_trade_keyset_idx`.
    **The trade filters' own managers selection is the same question of a
    different id list, and it spent a while being the copy still written the
    losing way** — which made it the slowest narrowing on the board, at 347ms a
    page against 30ms over 1.2M transactions, for the exact reason above. Both
    read `tradedByOwnersSql` now. Reading roster ids through
    `jsonb_array_elements_text` is also what makes the two forgiving of Sleeper
    sending a roster id as a number or as a string, which the old spelling paid
    for with an explicit `@>` against both — so the fragment is shorter as well
    as faster. It has one consequence worth knowing: a `roster_ids` that is a
    bare jsonb scalar rather than an array now matches nothing, where the
    containment form matched it. That is the reading the facet menu, the circle
    and `assembleTrade` already took of the same column, so the filter joined
    them rather than diverging; Sleeper does not send it (a trade names at least
    two rosters).
  - **An empty circle is an empty board, not an unnarrowed one.** An account this
    database has never synced has no leagues and no leaguemates; folding that back
    to "not narrowing" would answer a question nobody asked. The page's empty state
    says so, which is where a reader can act on it.
- **The date is one date, and it is a place in the board rather than a window
  over it** (`TradeSeek`, `tradeSeekBounds`). It was a `from`/`to` pair with four
  relative presets and a `custom` mode the two fields put it into; what replaced
  all of that is a single field defaulting to today. The argument is the board's
  own ordering: this is a keyset walk newest-first, so a date is exactly what its
  cursor already expresses — the read resumes there and everything older is
  *below* it, which is where a reader scrolling a chronological list expects to
  find it. A window had two halves, a preset table, a mode and a label function to
  answer a question the list answers for free. Five things hold it up:
  - **Only the far end is ever bounded**, which is what makes it a place to scroll
    from rather than a slice to look at. The lower bound is gone from the
    vocabulary, not merely unset — there is no second field to leave half-filled
    and no `custom` mode to enter.
  - **It is stored as null and displayed as today.** No trade completes in the
    future, so "today" and "the newest trades" are one board — and spelling the
    default as a date would put a bound on the query string that narrows nothing,
    minting a fresh cache entry every midnight for an answer that never differs.
    `tradeSeekBounds` folds *both* spellings (and any date past today) to the open
    bounds rather than trusting the control to, which is also what makes picking
    today the one-press way back to the top.
  - **An unreadable date is an unpositioned board, never an empty one** — `NaN` as
    a bound compares false against every trade, which would clear the list with
    nothing on screen to say why. The parse comes before the day shift, since the
    shift is what would throw.
  - **Travelling scrolls the page back to the header, not to the list.** The list
    is unmounted whenever the board is empty (the "no trades" note takes its
    place), so a travel that lands on nothing would have no scroll target — and a
    target that can unmount mid-change takes the scroll with it. The header is
    always mounted, its top edge is where the board begins, and `scroll-mt` is how
    the pinned app bar is accounted for, the same mechanism the leagues list
    scrolls an expanded card by.
  - **It only scrolls when the header has actually scrolled off**, and never on
    mount. A reader still looking at the controls is already at the top, and
    pulling the page to hide the control they just pressed is worse than not
    moving; a board arriving is not a reader travelling.

  **And because it is a position, it is pinned rather than filed with the
  settings** (`SeekKey`). It was a labelled date field on the controls row — the
  right seat for something chosen once and then read, and the wrong one for the
  one control here worth reaching for *while reading*, which is exactly when that
  block is three screens up. It is the ADP block's material at 40px, held under
  the app bar at the board's trailing edge, opening onto the same native input
  and the same way back. Four things hold it up:
  - **The sticky wrapper is the page's, not the key's.** A sticky element travels
    only as far as its own parent's box, so seated inside the header it would
    scroll away with it; it is a sibling of the header in `TradesHome`'s
    fragment, which makes its parent `PageShell`'s `<main>` — the box that spans
    the list. `pointer-events-none` on the wrapper with the key taking them back
    (a box stretched across the column would otherwise swallow presses meant for
    the cards), and `z-30` under the bar's `z-50`, since a floating part must
    never cover the way home.
  - **It rests above the board and only then travels over it.** The wrapper was
    `h-0` — no space in the flow, which reads as free and is not: the key's
    *first* frame was already sitting on the first card's instant ledge, a plate
    at the same corner, so a reader met the two overlapping before scrolling at
    all. Given a band of its own (`mb-5`, the plate's overhang plus clearance,
    paid as margin rather than as a negative offset — the trade card's rule for a
    part rising out of an edge) it covers nothing until it is pinned, which is
    the moment covering something is what it is for. **What a pinned part costs
    is still coverage, and there is no version of one that doesn't pay it** —
    from there on it covers the top-right of whatever is under it, transiently,
    since the card carrying that ledge is whichever one the scroll has put there.
    What the resting band buys is that the cost is never paid *before the reader
    has scrolled*, which is the one moment it looked like a rendering fault
    rather than a part. The size follows: 40px rather than the 34 a key that
    floats from the first frame could afford.
  - **Its date rides the bottom edge on a nameplate** — the trade card's own
    device. An icon alone says a control exists; the plate says the board begins
    at June 30, which is the difference between a pinned control and a pinned
    control that tells the truth about a travelled board. No bound draws no plate
    and no glow: a plate reading "today" would put a bound on screen that the
    query string deliberately does not carry.
  - **`w-fit` on that wrapper is load-bearing**, because the plate is centred on
    it (`left-1/2`) and a block-level flex container fills its parent — so in any
    caller that isn't itself a flex row the plate would centre on the whole column
    and float off to the right of the key.
- **The board is filtered in SQL and paginated, and it used to stream the whole
  season — this is the largest performance decision in the app, and it is worth
  reading as a correction of the one before it.** The old design was a sound
  answer to a constraint it never questioned: every filter ran in the browser and
  the menus were read off the trades, *therefore* the browser needed the
  unnarrowed season, *therefore* the only lever left was making ~20MB arrive
  progressively. Streaming made that cost incremental rather than removing it —
  a season read, sorted, serialised, gzipped, transferred, parsed and held live
  in a browser to render twenty cards, per reader, per visit. Moving the filters
  to the server dissolves the constraint, and everything below follows from that
  one move. Measured against 1.35M transactions holding 50k trades for the
  season, on a single scratch instance:

  | | old (stream) | new (paged) |
  | --- | --- | --- |
  | first cards on screen | 368ms of DB | **13ms** |
  | DB work for the whole read | 455ms | 13ms, then ~5ms a page |
  | page 21 (4,000 deep) | — | **4ms**, flat with depth |
  | unfiltered `count(*)` per request | 49ms | **0** (a stored row) |
  | bytes before the first card | ~0.6MB gz | ~25KB gz |

  - **The read is keyset, not a cursor, and the earlier measurement that argued
    the other way is still true and no longer applies.** Keyset loses badly when
    you walk a whole season through it (529ms against 232ms — the resume
    predicate stops being selective and the plan flips to a bitmap scan and a
    top-N heapsort) and wins the first page hands down. The board reads a page and
    stops, so the case it wins is the only one that happens. `shared/trades/cursor`
    is the opaque `(at, transaction_id)` token, where `at` is
    `coalesce(status_updated, created, 0)` — the zero standing in for Sleeper's
    undated rows, because a row comparison against a null propagates null and
    would drop the undated tail without a word.
  - **The population is written as correlated `EXISTS` subqueries, not joins, and
    that is what makes a page an index walk.** With a `JOIN leagues` and a
    `LEFT JOIN startup_draft` above it the `ORDER BY` sits over a join tree, the
    planner cannot satisfy it from `transactions_trade_keyset_idx`, and it
    collects the whole population and top-N heapsorts it — the same cost on page
    40 as on page 1. As `EXISTS` filters the ordering is over `transactions`
    alone: **23.2ms and 518 buffers as joins, 0.33ms and 21 buffers as `EXISTS`**
    for one page. The rewrite is exact rather than approximate — a trade was kept
    when there was no startup row *or* the row permitted it, so it is dropped
    exactly when a row exists and rejects it — and the counting queries lose
    nothing by sharing it (9.0ms against 9.8ms), so there is still exactly one
    definition of what is on this board.
  - **No Postgres cursor is held while anything is enriched.** The old handler
    interleaved cursor reads with four id lookups per chunk, so a pooled
    connection sat idle-in-transaction across every one of them — at a handful of
    concurrent readers, that was the pool. `listTrades` is one `LIMIT`-bounded
    query that finishes and releases before a single name is resolved. It reads
    one row past the limit and drops it, so "is there another page" costs no
    second query.
  - **The enrichment lookups are cached in-process, bounded and TTL'd**
    (`shared/trades/cache`, `shared/trades/enrich`). A season's vocabulary is a
    fixed few thousand players and managers named in its first pages and repeated
    forever after, so without a cache pagination would re-resolve them per page
    per reader. **Misses are cached too**, deliberately: an id nothing is stored
    for is the one most likely to be asked about repeatedly (KTC prices ~500
    players, so an unpriced kicker appears all season), and not caching the miss
    is how a cache with a 95% hit rate still issues a query per page. Bounded
    because a plain map of every id a process has been asked about is a leak with
    a slow fuse. **`BoundedCache` itself is `shared/util/bounded-cache` now**,
    with `shared/trades/cache` re-exporting it under the mover's usual habit and
    keeping `cachedLookup`, which is the per-id half and still this concern's;
    the second caller is the ADP board below. What it deliberately does *not* do
    is dedupe concurrent misses — two requests arriving together on a cold key
    both compute, which is the right trade for a value this cheap to recompute,
    and a caller needing otherwise wants an advisory lock rather than a change
    there.
  - **A page names its own ids rather than sending a delta.** The stream held a
    set of what it had already sent, so a player crossed the wire once per season;
    the equivalent across separate requests is the client listing everything it
    holds on each one — a few thousand ids in a query string, which is a 414
    waiting for the reader who scrolls furthest. Self-contained, a page re-sends
    ~8KB of names it shares with earlier pages, bounded by the page size rather
    than by the season. The client still *merges* rather than replaces.
  - **The season's size is precomputed** (`trade_market_stats`, refreshed on the
    league crawler's own tick — the loop that writes the trades it counts, so no
    second timer for one query). It was a `count(*)` over the population on every
    request, which pagination would have turned into one per *page*. Narrowed
    counts still can't be stored — the space is unbounded — so they run once per
    filter set, on a first page only. **And a first page states two of them —
    "N of M" — which is one pass, not two.** The scope population (the league
    filters and the circle, the window and the selection lifted out) is a
    superset of the query's by construction, so `countTradeTotals` counts the
    wider one and reads the narrower off an aggregate `FILTER` over the same
    scan. Two counts in parallel already waited on the slower, which is always
    the scope one, so what this buys is the other scan and a pooled connection
    rather than latency — the resource that runs out first here. The freshness gate stamps the *attempt*,
    the `projection_week_syncs` rule: a season with no trades counts zero, and a
    gate reading the count itself would find it unsynced and recount every tick
    forever. The client clamps a stored total up to what it has loaded, since a
    denominator under its own numerator is the one way the lag is visible.
  - **`transactions_trade_keyset_idx`** is what the walk resumes on: partial on
    `type = 'trade' AND status = 'complete'`, ordered on
    `(coalesce(status_updated, created, 0) DESC, transaction_id DESC)` — both keys
    descending so a `LIMIT` is a fast-start ordered walk with no sort, and the
    tiebreaker present so the order is *total* and therefore resumable (without
    it a page boundary inside a group sharing a timestamp drops and duplicates
    rows across the seam). `transactions_trade_adds_idx` is the GIN index behind
    the player filter, partial on the same predicate for the same reason —
    `adds` on a waiver is as big as on a trade and there are twenty times as
    many. **The older `transactions_trade_recency_idx` is not redundant and must
    not be dropped without a change beside it**: it is ordered on
    `coalesce(status_updated, created)` — the *two*-argument coalesce — which is
    a different expression to the planner from the keyset index's three-argument
    one, and it is exactly what the date window in `tradeNarrowingClauses` is
    written on. The board itself never needs it (its `ORDER BY` pins it to the
    keyset walk), but `countTradeTotals` and the facet aggregates have no
    `ORDER BY` at all, so a windowed board's denominators can take it as an index
    range instead of a filter over the season. Spelling the window as
    `TRADE_SORT_SQL` would make the old index droppable and those counts a scan;
    `sql.test.ts` pins each expression to the migration that indexes it, so the
    pair cannot drift apart unnoticed.
  - **The filter menus are their own route and their own aggregate**, kept apart
    from any number counted *with* the selection. That split is not fussiness:
    the menus are counted **without** it (a menu counted over its own selection
    collapses to it) so a checkbox cannot change them, while the board's own
    total changes on every press. Together, one checkbox re-ran a season-wide
    grouped aggregate (~1.5s) to move a number `count(*)` answers in ten
    milliseconds. There was a third route for that number, `/api/trades/count`,
    and committing live retired it: every filter applies on the press, so the
    narrowed total arrives on the first page of the board itself — one route
    fewer, and no way for the promise and the list to disagree. The facets query runs its three
    branches as
    three parallel statements rather than one `UNION ALL` — 2,090ms as one
    statement, ~850ms as three — which costs reading the population three times
    (~50ms a piece) against branches costing 270ms, 270ms and 830ms, and is worth
    it precisely because the branches are so unequal.
  - **The list is windowed** (`TradesList`, `@tanstack/react-virtual`), which is
    what lets the board be the whole season however deep a reader scrolls. It
    virtualises the **window**, not a box of its own, so the document keeps its
    own scrolling — an inner scroller on a phone is a scroll trap — which is why
    it measures `scrollMargin` rather than assuming it. It observes the **page
    header** for that measurement and not `document.body`: the body's box grows
    and shrinks with the list's *own* height, so observing it fired on every card
    measured and every page appended, each firing doing a
    `getBoundingClientRect` that forces a synchronous reflow, and none of that
    traffic could say anything — what moves the list down the page is what is
    above it. Card heights are measured, not computed, and the gap between cards
    is padding *inside* each measured item, since a gap the virtualizer doesn't
    know about drifts down the list. `TradeCard` is `memo`'d, and the reason is
    *width* rather than frequency — the note used to say "every scroll frame",
    which is not what the virtualizer does: it notifies React on
    `[isScrolling, startIndex, endIndex]`, so the list re-renders when the window
    crosses a card boundary and at both ends of a gesture. Each of those renders
    is the whole window though — ~26 cards, of which at most one changed — so
    without the memo every one of them re-ran its exchange assembly and subtree.
    It works because the props are stable by construction (the lookup maps and
    `leaguesById` are `useMemo`s, `metric` is a catalogue entry, a `trade` is an
    object off a cached page), which is why the default shallow comparison is
    enough and a custom `areEqual` would only restate it.
  - **`useInfiniteQuery`, and its pages are never evicted.** The cursor is the
    query's own state, so it survives a remount and a navigation away and back;
    a filter change is a *different key* rather than an invalidation, so widening
    back finds the old board still loaded with its scroll position. It carried
    `maxPages` (20, or 4,000 trades) as the memory half of the same argument, and
    that was wrong for **this** query: React Query drops the *oldest* page past
    the bound, and a keyset walk resumes forwards only, so there is no
    previous-page path to read a dropped one back with. Everything else here
    assumes pages append — the fold reads `total`/`scopeTotal` off the first page,
    the virtualizer keys its measurements by trade id, and `advanceFiltered`
    judges a prefix once — so at page 21 trades a reader had scrolled past
    vanished, the list shrank under the scroll position, and the headline
    denominators blanked. Memory is bounded where it can be bounded honestly:
    `gcTime` of five minutes against the client-wide thirty retires an abandoned
    board (a scrolled board plus every name it resolved is a different order of
    thing from a manager's leagues), and the DOM stays bounded at any depth
    because the list is windowed. The fold itself is `features/trades/trades-data`,
    pure and tested, which is where those assumptions are pinned.

    **What `gcTime` cannot express is *how many* boards, and that is the second
    bound** (`features/trades/board-retention`, pure and tested). Every press on
    the filters is a different key with a full board behind it, and five minutes
    is a long time at the keyboard — a reader working through a search holds
    every combination they tried, on a phone, at the same time. So the count is
    bounded rather than the time: the three most recently read *abandoned* boards
    stay and the rest are removed. Three exclusions carry the safety and none is
    a matter of ordering. **The active key is never dropped**, even before its
    first page has arrived and its `dataUpdatedAt` is still 0 — exactly when a
    plain recency sort would choose it first. **A board with observers is never
    dropped**, because it is on screen or it is the placeholder
    `keepPreviousData` is showing. And **three rather than one**, so "widen back
    and find it loaded with the scroll position" survives coming back two presses
    as well as one. The sweep runs in an effect on the key changing — the moment
    a board is abandoned and the only moment the answer can change — because
    `removeQueries` is a cache write, and a cache write during render mutates
    something another component is reading.
  - **A league set too large for a query string travels in a POST body, not to
    the browser.** Past `MAX_LEAGUE_IDS` (500) the request used to go
    *unnarrowed* and the page filtered the pages as they arrived, which is not a
    degradation but a wrong answer: a first page whose two hundred trades are all
    excluded leaves `visible` empty, which renders the "no trades" note, which
    unmounts `TradesList` — and the list is what would have asked for page two,
    so matching trades further down were unreachable and the counts described a
    population the reader could not see. `/api/trades` and `/api/trades/facets`
    take a POST whose body is the same `leagues`/`xleagues` lists, parsed by
    `parseTradeScopeBody` into the same `TradeQuery`; the query string, the
    keyset cursor, the SQL and the counts are byte-for-byte the GET's, so the two
    methods cannot answer differently. The cache key still inlines the ids —
    two league sets that differ are two boards whatever transport carried them.
    **All of that is shared now, because the ADP board is the second reader of
    the same idea.** `resolveLeagueScope`, `MAX_LEAGUE_IDS` and the body's shape
    are `features/shared/league-scope` (this module re-exports them, the mover's
    usual habit) and the body parser is `shared/query`'s `parseLeagueScopeBody`,
    which `parseTradeScopeBody` is now a name for: the body is JSON this app
    writes and this app reads, so two shape checks would be two chances to be
    wrong about the dedupe, the id pattern or the cap. What is *not* shared is
    the query-string spelling — `/api/trades` reads `leagues`/`xleagues` and
    `/api/adp` reads `league_id`/`xleague_id`, each its own route's vocabulary.
  - **The client's residual filter is three-state** (`features/trades/incremental`,
    pure and tested). With every narrowing in SQL there is nothing left for it to
    deny; what keeps it is that a page which admits everything hands the previous
    arrays back, which is what stops each page from invalidating the
    virtualizer's measurement cache. Two states forced
    an undecidable trade to count as *out*, and the only way to correct that later
    was to discard the whole answer and re-walk — which is exactly what the old
    page's `n${allowedLeagues.size}` generation segment did, once per league that
    arrived, over a list that grew. A third state puts it in a pending bucket, and
    league metadata arriving re-judges *that bucket alone*. Two properties are
    load-bearing: resolved indices are **merged** into the allowed list rather
    than appended, since the board reads newest-first and a trade whose league
    landed late belongs where it arrived; and a page that admits nothing hands the
    **previous arrays** back, since the page memoises on their identity and the
    virtualizer's measurement cache rides on it. The accumulator is `useState`
    adjusted during render (`useFilteredTrades`), never a ref, because a ref
    written during render survives a concurrent render that was thrown away,
    while React re-runs a self-adjusting component before committing anything
    under it.
  - **A control is split at the press, not at the component — and what is not
    behind a press is not split at all.** The seam goes where the trigger ends
    and the contents begin: for the league filters that is the whole dialog,
    which is nothing but a trigger and a `<dialog>`, and for the trade search it
    is one layer in — `TradeSearchPanel`, since the bays and their tokens *are*
    on screen and are what a reader who never opens it reads. The rule either way
    is that the part carrying the badge stays static and the part nobody has
    opened is split. The ADP drawer and the columns editor are split the same way
    in the manager tool, each latched so closing doesn't unmount the dialog
    inside its own `close` handler.

    **`TradeControls` is the counter-example and worth keeping as one**: it had a
    `dynamic()` too, for the panel behind its `Filters` key, and lost both when
    the scope and the date came out onto the page. What is left is four keys, a
    date input and two lines of prose — a chunk boundary costs more than that
    saves, in bytes and in the placeholder needed to hold the row's height while
    it lands. **Split what a reader might never open; a control they always see
    is not a candidate however small the diff looks.**

    **The league sheet is the third on this page and the easiest of the three**,
    because the trigger is a trade card three modules away rather than anything
    in the sheet's own file — so the seam is a module boundary by construction.
    It is the heaviest thing behind a press here (the whole `ui/league-detail`
    subtree: two dense tables, two settings lists, a draft-pick list, two metric
    catalogues and a query hook), and it takes no `loading` fallback, unlike the
    filters key: nothing is holding its place on the page, so a placeholder would
    be a flash rather than a reserved box.

    **A `dynamic()` import splits nothing if the trigger sits in the same module
    as the thing it opens, and nothing at all if a barrel re-exports either
    one.** Both halves were learned here and both are invisible in review — the
    code reads as split and the bundle is not. `AdpTrigger` and `AdpDrawer` lived
    in one file, so the trigger's *static* import pulled the drawer, the range
    scrubber, `nfl-calendar` and `range-domain` into the graph and the
    `dynamic()` beside it bought nothing; `AdpTrigger` is
    `features/shared/ui/adp-trigger.tsx` now, and the seam is a module boundary
    rather than an export name. Then re-exporting the drawer from
    `features/shared/index.ts` put it in the graph of **every page that imports
    anything from that barrel** — `/tools`, `/picktracker` and `/lineupchecker`
    were each shipping an ADP drawer they have no button for. So the barrel
    exports the trigger and never the drawer, and a `dynamic()` call site names
    the module path directly. The check is one command, and worth running
    whenever something behind a press moves house:

    ```
    grep -rl "<a string only the split-out part contains>" .next/static/chunks/
    # → then grep that chunk's name in .next/server/app/<route>.html
    ```

    A route with no button for the part must not name its chunk.

    **The barrel half came back for the second dialog, which is the tell that
    the rule wants stating as a rule and not as a story about the drawer.**
    `LeagueFiltersModal` was re-exported from that same barrel while the trades
    page `dynamic()`'d it, so six prerendered pages carried a 55KB chunk for a
    dialog only two routes have a trigger for — and the `dynamic()` deferred
    bytes the browser had already been sent. The fix is the drawer's, twice
    over: the barrel exports the placeholder and never the dialog, and both call
    sites name the module path. What is new is the **fallback**, because this
    component is the trigger as well as the dialog, so splitting it takes the
    key off the page until the chunk lands. A fallback declared in the dialog's
    own module would pull that module back into the static graph and split
    nothing, so `ui/league-filters-seat.tsx` holds the seat table and the
    placeholder, the dialog imports *it*, and the arrow never points back. That
    is also what keeps one spelling of the key's geometry: the placeholder is
    standing in for its exact box, so a second copy of those classes is a reflow
    waiting for someone to edit one of them.

    **The third instance had no `dynamic()` anywhere near it, which is what makes
    it the general statement of the rule: a barrel is one module to the bundler,
    so importing one name from it pulls every name it exports.** Splitting is
    only ever how you *notice*. `features/manager/index.ts` named the three tab
    views beside the username search, and `/manager` — a prerendered page whose
    entire content is one text field — imported `ManagerSearch` from it and
    shipped the league cards, the league detail panel, both share lists, the
    subject rail and the columns editor with it: **780.6KB across 13 chunks,
    down to 693.9KB across 10** once that barrel kept only the three providers
    and the four routes named module paths. It was also the heaviest of the
    prerendered pages and is now the lightest. The same edit stopped each of the
    three tab routes statically referencing the other two tabs' views — they
    still share most of their weight, which is honest (one scaffold, one header,
    the two shares sheets), but a tab's own view is now the tab's own.
    **Which side of the line a barrel export sits on is what it costs to name**:
    a provider is a context and a `useState`, and the layout that mounts it is on
    the path of every route in the feature anyway; a view is the whole tool.
  - **The board holds its previous pages while a new filter set lands**
    (`keepPreviousData`). It is what makes committing live affordable: a filter
    change is a *different key* with nothing in it, so without this every press
    replaces the whole list with the loading flask and back — the flash `useAdp`
    and the four manager hooks refuse for the same reason. Two things ride on the
    `stale` flag it produces. Pagination is held back, because the cursor belongs
    to the board on its way out and `fetchNextPage` would resume the *new* key
    from it. And the headline count dims — one small element rather than the
    list, since the count is the number the filter was pressed to move and
    showing the old one undimmed is the one place the lag would read as an
    answer.

    **The date control is the one press this has to be undone for**, and that is
    the whole of why travelling scrolls the page (see the seek bullet above).
    Holding the reader's position through a re-key is right for a narrowing —
    the list they are reading stays put while it thins — and wrong for a
    position, where staying put is the one outcome that hides the answer.
- **A trade card's top edge states which league and when; its first interior
  line states what kind of league, and its sides each state one value.** Three
  changes to what a card says, and each replaced something that read as
  information and wasn't:
  - **The instant is on the edge, on a ledge of its own, and the note here used
    to argue it could not be.** That argument was that folding it into the
    nameplate costs nothing vertically but a league name long enough to truncate
    takes the timestamp down with it — true of *one* plate carrying both facts,
    and not true of two plates sharing the edge. A plate that positions itself
    can only cap its own width; two items of one flex row negotiate, so the name
    truncates against the instant rather than against a width guessed ahead of
    it. That is the leagues list's construction exactly (`CardLedge`), and
    adopting it bought the whole interior line for the league's settings. The
    ledge keeps the record ledge's grammar inside, too — the date in a
    `.lab-readout` cut, the time engraved beside it — since a cut into a lit
    plate is machining, which is what keeps the part from reading as a second
    name on the same edge.
    **An undated trade still draws the plate**, which is where it parts company
    with the record ledge: there "nothing to report" means draw nothing, and
    here the absence *is* the answer, since a trade Sleeper filed with no
    timestamp is dropped by every date bound on this board.
  - **The clock time holds the slot the scoring week used to.** "Aug 1, 2026 ·
    Wk 1" said *when* twice, the second time in a unit that is null for most of
    the calendar — Sleeper files an offseason trade under no week at all. Trades
    come in flurries, so which of an afternoon's five deals landed first is the
    question the date alone couldn't answer, and that is what the time is for.
    It is read in the **reader's own zone** — the `todayIso` side of the
    two-todays rule, since this is a wall-clock reading of a moment rather than
    a claim about what the NFL has played — and still spelled by hand rather
    than through `toLocaleTimeString`, so the digits match the date beside them.
    It **lost its own ` · ` separator** with the move, which is worth knowing
    before one is added back: the two facts shared a single readout, so the
    separator had to ride on the *time* — the half that vanishes for an undated
    trade, and a dangling "date unknown ·" is what that prevented. They are two
    elements on a plate now, parted by a gap and a change of material, so
    punctuation between them would be a third thing saying what the layout
    already says.
  - **What kind of league it was has that line to itself, as one bezel of
    gauges** (`features/shared/league-specs.ts` for the run and
    `features/shared/ui/league-specs.tsx` for the bezel — both moved out of this
    feature once the leagues list wore the same part, the mover's usual rule;
    `.lab-bezel` and `.lab-gauge` in `globals.css`). What is still this card's is
    the *line*, which is why the run is derived in `TradeHeaderLine` rather than
    inside the bezel: an empty `<header>` is still 8px of padding under a
    nameplate, so this card has to know there is nothing to draw before it draws
    the wrapper. A second-round pick is a different asset
    in a 10-team redraft from what it is in a 14-team superflex dynasty, and this
    board spans every crawled league — so the card's only answer to "which of
    those am I looking at" was a league name, which helps nobody who doesn't
    already know the league. Six gauges now say it: type, size, the QB and
    superflex slots, tight ends, TE premium where there is one, and best ball
    where it is one. Six decisions in it:
    - **Every value carries the unit it counts, cut into the floor above it.**
      That is what the whole part is for: a reader who has never met this app
      cannot tell what `1QB + SF` is a count of, and the `title` that used to
      answer it does not exist on a phone — which is the width the run is
      tightest at. `LeagueSpec.caption` is that unit, every spec carries one, and
      the tests pin both that and that no caption restates its own value.
    - **The run is one housing, not six.** Six separate readouts read as
      perforation in the card's face rather than as one fact about the league,
      and nothing in a run of six identical pills is easier to find than
      anything else. Housed, it is a single object a reader learns the shape of
      once. It is `inline-flex` and so as wide as the league's own settings: a
      housing that reached both walls would have to be *filled*, and a
      four-gauge redraft league would leave two thirds of it empty.
    - **Both of its depths run downward, which is what keeps it off the press
      grammar.** The bezel is a trough milled into the face and each gauge is a
      window sunk into that trough's floor — where the app bar's block does the
      opposite, standing off the surface with its channel cut into it. A raised
      housing would be the one grammar this app reserves for a press, six times
      per card across the couple of dozen the virtualiser keeps mounted. Nothing
      here is a `.lab-chip`, and nothing here travels.
      **That is a fourth countable level on a card whose own rule is three**
      (plate, groove, readout — "a fourth flattens the other three"), and the
      exception is deliberate rather than an oversight: the fourth is *nested
      inside* the third rather than being a fourth surface competing across the
      face, so what the eye sorts at card scale is still three. The bezel is the
      only place on this card that may hold two, and a second housing anywhere
      on it would be the rule reasserting itself.
    - **The accent appears once per gauge, in the lit lower lip of its cut, and
      never as a ring.** A rim drawn all the way around a value is an outline,
      and an outline is what a control has; light entering the top of a cut and
      catching its far wall is what says recess. The values themselves are the
      `foreground` token at two brightnesses and are not tinted — a cyan-white
      numeral has no token to read, and the accent is already spent in the lip.
    - **Every fact is read through the league filters' own predicates**
      (`slotCount`, `scoringValue`, `leagueType`, and `isBestBall`, which was
      inlined in `matchesFilters` and is exported for this). A card saying
      "1QB + SF" over a filter for `qb+sf ≥ 2` that disagrees is the drift one
      definition prevents, and it is what makes a new QB-eligible flex count
      here the moment the solver learns it.
    - **A fact that isn't known is omitted, never printed as zero.** An
      unsynced `roster_positions` is not evidence a league starts no tight end,
      so the lineup tokens simply aren't drawn — the rule that keeps `k = 0`
      from sweeping in every unsynced league, applied to a label. A lineup that
      is present and *empty* still says `0TE`, which is a different answer.
    - **The always-present facts lead in a fixed order and the conditional ones
      trail.** The run is read down a list rather than across one card, so type,
      size, QB and TE hold the same positions on every card and TE premium and
      best ball follow them; leading with best ball would move every other token
      one place left on the minority of cards that carry it. Best ball prints
      only when true for the same reason the filters' summary names a selection
      and not the absence of one.
    - **The line has no breakpoint left on it.** It held the instant too, which
      is why it used to be a reversed row that stacked below `sm`: the run had
      the ~180px left beside a right-flushed timestamp and took three lines
      there. With the instant on the edge it is one block at every width, and
      what a phone gets is two rows *inside* one bezel rather than a run that
      overflows — the seam is applied by index, so it survives the wrap as the
      housing's own inner edge. The captions cost ~10px of height on every card,
      which is the price of the reading and is stated here rather than
      discovered later.
  - **The value column is the league cards' pickable stat column at this page's
    grain** (`trade-metrics`, and `usePersistedColumns("trade-side", …)`). It is
    **one** slot rather than their four: a trade card is already a table of the
    assets the number sums, so more columns would be reading the card twice. The
    selection is list-wide, so the control is a chip in the header beside the
    two filter triggers and never on a card — forty thousand cards each holding
    a menu is that mistake at its most literal. What it deliberately isn't is
    the manager tool's heading rail: that works because every card puts its
    numbers at one x, where a trade's value belongs to a *side* and the sides
    stack or split by width and count, so the number wears its own label.
  - **That column opens on ADP now, read off the board the panel in the app bar
    is showing** (`TRADE_METRICS`'s `adp` entry, `DEFAULT_TRADE_COLUMNS`). The
    drawer was already seated here and narrowed *nothing* on the page: a reader
    could cut the market to 2024 startups, or to 10-team half-PPR drafts, or
    flatten the value curve, and every card under it went on quoting one
    national dynasty board — the same two-answers-to-one-question that moved the
    manager tool's team value onto `adpValueRead`, arriving on the page
    whose whole premise is that it spans leagues playing different games. So the
    season, the window, the draft kind, the size, the format *and* the steepness
    reach these numbers, and the panel's slider reprices the board rather than
    only its own preview column. Four things hold it up:
    - **Which market a card reads is the league's, not the reader's**, the same
      split `adpBoardFor` draws: `/api/adp` answers redraft and dynasty side by
      side, and `leagueAdpBoard` picks the half the league actually plays in —
      a rookie is a first-round asset in one and undrafted in the other. That
      predicate had been spelled three times before this (`DYNASTY_BOARD_SQL`,
      `getLeagueTypes`, `seedFromLeague`) and is now one function the two client
      readers share. An unanswered league is redraft, the broader market, on the
      same terms an unsynced lineup falls to KTC's 1QB board.
    - **The curve is anchored to the league's own startable pool**
      (`leagueAdpPool` off `total_rosters` and `roster_positions`), which is what
      makes a late first worth the same in a 10- and a 14-team league. The team
      count needs a fallback of its own where the league list hasn't answered:
      `adpValue` floors a pool of zero at one pick, so every player but the 1.01
      would round to nothing — a card of zeroes rather than a shortfall a reader
      can see.
    - **The board is fetched whether or not the drawer is open**, unlike the
      manager tool's Leagues and Leaguemates tabs — the value column is on
      screen either way, which is the Players tab's own rule. It costs nothing
      extra when the drawer *is* opened: both consumers share one query key.
    - **KTC stays in the picker as the other lens, not the other half.** It
      prices the same assets off a *national dynasty* board where this reads
      whichever population the reader selected, on whichever market the league
      plays in. Neither total is the other's units, so they are two columns and
      never one blended number: a haul summing a player's KTC price and a pick's
      ADP value would claim a scale this app nowhere says exists. Moving
      `DEFAULT_TRADE_COLUMNS` is the whole of the migration — `resolveColumns`
      keeps a selection that still names a live metric, so a reader who
      explicitly picked KTC keeps it and everyone else gets the board their own
      panel is set to.
  - **ADP prices the draft picks too, and it does it without a row for one —
    which is the whole idea.** The first cut of this column left picks blank on
    the grounds that a board of player prices has no pick on it, true and beside
    the point on a board where a first is routinely the whole trade (the same
    correction the KTC column had already been through). A rookie pick is a
    *place in a queue*, and the queue is on the board already: rank the rookies
    and the first of them is what the 1.01 returns.
    So a pick is priced by the player it buys, on the same curve, in the same
    units, out of the same population — which is what makes a haul of players
    and picks one sum where summing an ADP value and a KTC price would be a
    scale nobody has defined. `features/shared/pick-value.ts` is the ladder —
    it was `features/trades/pick-value.ts` until the ADP drawer became its second
    reader, and that path re-exports it under the mover's rule — and the
    decisions in it:
    - **Two boards, because ordering and pricing are two questions**
      (`rookieLadder(ordering, pricing, board)`). *Which rookie does this pick
      take* is a fact about **rookie drafts**, whose ADP orders one class against
      itself; *what is that rookie worth* is a fact about **startup drafts**,
      where the class is priced against the whole dynasty player pool. A
      rookie-draft ADP of 1 and a startup ADP of 1 are not one number in two
      spellings, so the ladder is built from the short drafts and each rung
      carries the long drafts' average, which is the only number the value curve
      ever sees. Before this the ladder read whichever board the panel was
      *displaying*, so switching the ADP drawer to "Rookie" repriced every pick
      on the page — the 1.01 at ADP ~1, which the curve reads as the most
      valuable asset in dynasty football. **Presentation state must not reach a
      valuation**: `rookieOrderingBoard`/`startupPricingBoard` in
      `features/shared/adp-controls` are the reader's own population with the
      round bounds fixed, so the season, window, scoring, superflex, best ball
      and size all still propagate and only `rounds` — the one control that *is*
      the choice between these two populations — does not. Their thresholds are
      `ROUNDS_BOUNDS`, the drawer's own, so there is no second definition of "a
      rookie draft" to drift. It costs one extra fetch and not two: the pricing
      board is the displayed board under the default, so React Query resolves it
      to the entry already in flight.
    - **Two markets, two ladders.** A rookie goes in the first round of a
      dynasty startup and the middle of a redraft, so the queues are different
      queues; a league reads the one it plays in. Rookie picks come out cheap in
      a redraft league, which is correct rather than a shortfall — and a market
      whose leagues run no rookie drafts at all has no ladder, which reads as
      unpriced picks rather than as picks priced off the wrong queue.
    - **The two boards are asymmetric about a missing player, and that is the
      whole point of splitting them.** A rookie the *ordering* board never
      averaged is not a rung: the ladder is an ordering, so a place invented for
      a player those drafts didn't take shifts every pick below him by one. A
      rookie the *pricing* board never averaged **keeps** his rung, for the same
      reason read the other way — dropping him renumbers everyone under him, so
      the 1.03 quietly becomes the fourth-best rookie. His price is interpolated
      between the rookies either side of him in *rank* space (`startupSource:
      "interpolated"`), or taken from the nearest priced one at either end
      (`"nearest"`), and only a board that prices nobody leaves a rung with no
      value at all. Interpolating the **ADP** rather than the value is
      deliberate: the curve is exponential, so averaging two points on it lands
      somewhere the board never suggested. This is also why the sample gate
      stays where it is — a missing startup price is a hole to interpolate
      across, not a reason to accept a one-draft average as consensus.
    - **Which rung** is `(round − 1) × teams + slot`, so the league's size is
      what makes the same 2.01 a different pick. An unplaced pick takes the
      middle of its round and is marked a stand-in, the same fallback (and the
      same `mid` tier) the KTC column already makes for a draft that doesn't
      exist yet.
    - **KTC is asked for exactly one thing: what waiting costs**
      (`ktcPickDiscount`). The ladder prices a pick as if it were being spent
      now, and it cannot do better — the class a 2029 first will spend is not a
      class anybody can name. KTC publishes that opinion one row per season, so
      the *ratio* between its rows carries it onto the ADP scale. A ratio is
      dimensionless, which is what makes this one crossing between the two
      boards sound where a sum would not be.
    - **Both ends of that ratio read the same row, and the mismatch it replaced
      was the common case rather than a corner.** Resolving each end through
      `ktcPickPrice` independently let them fall back differently, and KTC drops
      its tiered rows for the seasons it has less of an opinion about — so an
      early 2028 first came out as `2028 generic / 2027 Early`, 3,000 over 6,000
      where the like-for-like answer is 3,000 over 5,000. A 20% error on the
      most-traded asset on the board, always in the direction that understates a
      future first, and nothing about the number looks wrong. The preference is
      the pick's own third then the untiered row for a placed pick, and the
      untiered row then `mid` for an unplaced one; **both ends take the first
      row that prices both seasons**, and no shared row is *no discount* rather
      than a crossed pair. `KtcPickDiscount.tier` is that row, so the card can
      say "estimated from the generic 1st-round market" instead of implying
      something about the league's draft order.
    - **The anchor is read off KTC's board, not off a calendar**
      (`ktcPickBaseSeason` — the earliest season it prices). Which seasons KTC
      carries moves through the year, since a season's rows come off once its
      draft has happened; reading the base from the board is what makes the
      discount mean the same thing in February and in August with nothing being
      told what month it is. A pick at or before that season is undiscounted,
      which is also how a current-year pick is priced.
    - **Five refusals, not one null** (`PickAdpMiss`). No rookies on the rookie
      board, deeper than the class it priced, no startup price anywhere on the
      ladder, too far out for a like-for-like KTC pair, or a pick that doesn't
      name a draft slot at all — and the difference matters to a reader, because
      the first three are facts about the boards the panel describes and widening
      them fixes those. A pick KTC can't reach stays **blank rather than quoted
      at the nearest draft's price**: a 2032 4th is not worth what next year's
      4th is, which is the one wrong answer here that would look like a working
      one.
    - **Three assumptions, three flags** (`slotEstimated`,
      `startupAdpEstimated`, `discountEstimated`; `pickEstimated` is their `or`,
      for the side total that only owes the reader *how much* of itself is a
      stand-in). They were one boolean, printed as `(draft order not set)` —
      so a pick whose slot was known perfectly well and whose KTC row had fallen
      back told a reader something plainly false about their own league. They are
      unrelated facts about unrelated parts of the calculation, and only the
      reader can judge which matters: the first is fixed by the league setting
      its draft order, the second by widening the board, the third by nothing at
      all.
  - **Naming the rookie class took a column out of the players blob, and the
    whole feature rests on it.** `players.years_exp` is promoted from `data`
    (backfilled in the migration, so no re-download), read alongside the names
    on the board's one players lookup (`getPlayersWithExperience`), classified by
    `rookieClassIds`, and sent as `AdpPlayerPayload.rookie`. Two rules travel
    with it. **Absent is "not known to be a rookie", never "veteran"** — it is
    null for a team defence and for anyone Sleeper hasn't filled in, and one
    wrongly-included name shifts the whole ladder. And **the cache carries no
    history, so this always names the class that is a rookie *now***: a board
    for a past season contains none of them and gets an empty ladder, which
    reads as picks being unpriced there rather than as a ladder built from
    prices those players never had. That last one is a **known limitation rather
    than a design**, and the obvious fix is not one: the only experience Sleeper
    gives is `years_exp`, a count of completed seasons *as of now*, so naming the
    2024 class means inferring `activeSeason − years_exp` — wrong for anyone
    whose count didn't advance, and a wrong *inclusion* shifts every rung below
    it. A derivation right for most players is worse than an empty ladder that
    says so. Doing it properly wants a persisted `rookie_season` and a source
    better than `years_exp` to backfill it from.
  - **`/api/trades` sends KTC's pick board whole**, where it used to send the
    four rows per `(season, round)` the page's picks could land on. The tier is
    still resolved client-side (it needs the league's size, which is on the
    league list the browser already holds), so every tier of a row has to travel
    either way; what ended the narrowing is that the discount needs the board's
    *nearest priced season*, which is a fact about the board rather than about
    any pick on the page — a page naming no 2027 pick could never have asked for
    the row that answers it. It is a few dozen rows, so `lookupKtcPickBoard`
    caches it as one value rather than a row at a time.
  - **Those numbers are on the display face and cut into what they sit on**
    (`.lab-engraved`, `.lab-engraved-faint`). The page's subject used to be the
    quietest type on its own card: the league name was Orbitron at 13px tracked,
    the manager's name 13px bold, and the *value* 12px bold body face at 85% with
    the per-asset numbers at 11px/60%. Three rules in the correction:
    - **Engraved rather than lit, and the argument is arithmetic.** There are two
      side totals and up to a dozen line values per card, times the couple of
      dozen cards in the virtualiser's window. A numeral in the accent is a
      signal and fifty signals are wallpaper; cut into the plate it is a
      *finish*, calm at any count and still unmistakably more considered than
      body-face text. It also leaves the accent unspent, and this page has
      exactly one thing worth spending it on.
    - **A size step down comes with the face**, the rule the named list rows
      already follow: Orbitron is wider, so a line value holding 11px would push
      a four-digit price into the name beside it. `tabular-nums` is what keeps
      the column lining up once the face changes under it.
    - **Two strengths, and an em dash gets neither.** `-faint` is the same cut at
      line scale, because the highlight is a fixed 1px whatever the type size —
      at 10px the full-strength lower lip is half the stroke weight and reads as
      a blur. The give track gets no cut at all, since its lines sit in the
      groove whose own lit lip is a millimetre away. And an unpriced line stays
      flat: cutting an *absence* into the plate would give it more presence than
      the numbers that are actually there.
    The totals dropped `.lab-lens` with the same change. A rim of cyan around
    every number is one apparent control per side over forty thousand rows;
    `.lab-readout` alone is the housing, and recessed is right because a readout
    is read and not pressed.
  - **KTC's two boards both travel on the stream, and the card picks one.** The
    board is a fact about the *league* a trade happened in and this stream spans
    every crawled league, so a chunk sends `{sf, oneqb}` per player and the card
    reads `isSuperflexLineup(league.roster_positions)` — the same predicate
    `/api/adp` groups a draft with. An unpriced haul is an em dash and never a
    zero, and a partly-priced one says how much of itself it priced, the same
    habit as `priced` of `rostered`.
  - **Draft picks are priced too, and the note that said otherwise was reading
    the wrong half of KTC's board** (`shared/ktc/picks.ts`, pure and tested).
    KTC publishes ~500 dynasty skill players *and* a few dozen `RDP` rows —
    "2027 Mid 1st", "2029 1st" — which the sync has always stored; nothing read
    them, so a card priced the players in a haul and told the reader picks
    weren't on the board at all. On a page where a first is routinely the whole
    trade, that was a total answering a different question from the one the
    column asks. Four things hold the resolution up:
    - **A pick has no `sleeper_id`, which is why it needed a lookup of its own.**
      The matcher resolves KTC entries to Sleeper players by name and a pick is
      not a player anywhere in that map, so every pick row carries a null id and
      is invisible to `getKtcValuesBySleeperId`. `getKtcPickBoard` reads them
      whole — a few dozen rows — and `lookupKtcPicks` caches that beside the
      player prices.
    - **KTC names a pick by a third of the round and Sleeper by a roster**, so
      the two are joined through the league's own draft order: `pickTier(slot,
      teams)` places slot 3 of 12 as an early 1st. The slot is the map the card
      already names picks from, and the size is `total_rosters` off the league
      list — so **the tier is resolved on the client and the route sends the rows
      it could resolve to**, all three tiers plus the untiered one per `(season,
      round)`. Resolved server-side it would be one entry per pick per league,
      re-sent on every page a pick from that draft appears in.
    - **An unplaced pick is priced, and says that it is a stand-in.** Most picks
      on this board are seasons out, so there is no draft and no order — the
      untiered row is preferred there (it *is* the price of a pick with no
      place) and the mid tier stands in where KTC publishes none, which is what
      every trade calculator does with an unknown future pick. `exact: false`
      travels with it, so the line's hover names the row it read rather than
      passing an assumption off as KTC's answer. Refusing to price them would
      leave nearly every pick on the board blank, which is the failure this
      replaced.
    - **The names are scraped, so they are parsed by token rather than by
      regex.** `parseKtcPickName` reads a season, a round and a tier out of the
      words and fails the whole name on one it doesn't know — a row filed under a
      pick it might not be is worse than one left unpriced — and the read warns
      once per TTL when rows are stored and *none* parse, which is what a KTC
      rename looks like from here and is otherwise silent.
  - **A side lists what it received *and* what it gave, and the second half is
    drawn only where it is honest.** The give column was dropped once, on the
    grounds that a two-sided card printed every asset twice — once as a `+` on
    the side that took it and once as a `−` on the side that sent it — and the
    redundancy is real and unchanged. What was re-weighed is what it buys: a
    manager's block can be read *on its own*, which is how a card in a windowed
    list of forty thousand is actually read, rather than by finding the
    counterparty's column and inverting it. Four things keep the cost paid:
    - **It is paid in material, not in height.** The gives sit in a groove
      milled into the card's face (`.lab-groove`), dimmer and a step smaller,
      where the takes sit on that face itself — recessed is what a card
      already says for "read this, don't act on it". So the card still reads
      take-first at a glance. The groove used to be cut into a *side plate*, and
      losing that surface narrowed the drop from take to give by one step; it is
      the price the card's hierarchy was bought at (see below), and the fix if it
      ever stops reading is a deeper groove, never the plate back.
    - **`givenBundle` answers exactly where `counterpartyRoster` does.** With
      two participants a side's give *is* the other side's take, so there is one
      stored fact read from two directions and the halves cannot disagree. At
      three it declines, for the same reason the pick origin declines — nothing
      Sleeper stores says which participant an asset came through — and the
      column simply isn't drawn, which is better than a column of guessed `−`
      lines.
    - **A give line names the player and nothing else.** Position and team are
      already printed against him on the side that took him (the column exists
      only on a two-sided trade, so that listing is always there), and in a
      track this narrow those eight characters were the difference between one
      line and two. A *pick's* origin is not available anywhere else on the
      card, so that stays on both tracks.
    - **The tracks are columns from `sm` up and stacked below it**, which is what
      happens to the sides themselves one level out and for the same reason: a
      track is ~120px on a phone, and every name in it wrapped to two lines.
      What breaks down there is geometry, not the idea.

    The odd side of a three-way still spans the row rather than leaving a cell
    beside it empty — an empty cell in a grid of sides reads as a participant who
    came away with nothing, which is a state this card draws in words.
  - **The card is machined rather than glass, and the league cards came with
    it.** The share cards wear `LIST_ROW_SURFACE`, and the
    point of sharing it is that several lists read as one material; this one
    wears `.lab-slab` — the app bar's corner-lit block at card scale. What buys
    the divergence is that a trade card is not a row that opens into *more of
    itself*: it is the whole of what it has to say, four columns deep, and the
    depth is what sorts those columns into an order. That reading survives the
    card becoming pressable — what a press opens is the *league*, which is the
    question a trade raises and no height of card could answer, so it is a way
    out rather than a disclosure and there is no chevron on the card to say
    otherwise. Three countable z-levels and no more —
    plate (`.lab-slab`), groove, readout — since a fourth flattens the other
    three, the same arithmetic `.lab-row`'s 2px wall already answers. The cyan
    rail, the hover lift and the bloom all survive, so the card still answers the
    pointer the way its neighbours do; the lift is spelled as a `filter` because
    `clip-path` cuts a `box-shadow` off.
  - **The card is the only object in the list, and four decisions follow from
    that one.** It used to be four z-levels, and the level that went is the one
    that was wrong: a *side* wore `.lab-plate-sm` + `.lab-plate-brushed`, which
    is this card's own construction one step down — raised, walled, brushed,
    rounded, carrying an avatar, a name and a readout. One step is not enough to
    read as containment, so on a phone, where the sides stack, the list showed a
    column of manager plates a reader had to pair up rather than four trades. The
    spacing was never the problem and is the part worth remembering: 8px between
    sides against roughly 32px between the nearest plates of two cards is already
    4:1. **When proximity is right and grouping still fails, the answer is
    weight, and more air buys nothing.** What replaced it:
    - **A side is a region of the card's face** (`SIDE_ZONE`) — no fill, no wall,
      no radius. Nothing inside the card is built like a card because nothing
      inside it is built at all.
    - **What parts two of them is a full-bleed seam** (`SIDE_SEAM_ROW` /
      `SIDE_SEAM_COLUMN`): a dark line with a lit far lip, reaching both walls.
      Reaching them is what makes it machining in one part — the same line inset
      from the edges is a border, a border draws a box, and a box is the plate
      this just stopped drawing. Which way it runs is arithmetic on the index
      rather than a flag, since the sides stack below `sm` and split above it: a
      side in the trailing column (`i % 2 === 1`) is cut on its leading edge and
      one that starts a row is cut along its top, which is what puts a horizontal
      seam above the odd side of a three-way — that one spans both columns rather
      than sitting beside either. The face is therefore padded at the **top
      only**, and each region holds its own inset off the walls.
    - **The league's name rides the top edge on a nameplate** (`.lab-nameplate`),
      the device the lineup checker's plate already uses on its bottom edge for
      its filters key.
      A part rising out of a card is the strongest "one object" mark there is,
      and it is nearly free vertically — it occupies margin the list was already
      spending as a gap. It is a *plate* and not a chip (rectangular, no press
      travel), because "raised means press me" is about keys and pills. It must
      be a sibling of `.lab-slab`: `clip-path` clips its whole subtree, so a
      plate inside the notched face would be severed at the edge it straddles.
      The overhang is padding on the wrapper, never a negative margin, so it
      stays inside the box `TradesList` measures.
    - **`CARD_GAP` went 12 → 18 for the nameplate, not for separation.** At 12
      the plate sat almost exactly between two cards and could be read as
      belonging to either; at 18 there is visibly more ground above it than
      below. Check that before moving it.
  - **The instant shares the top edge on a ledge of its own, and the two plates
    are laid out as one row.** It kept a line inside the face for a while, on the
    reasoning that folding it into the nameplate would let a league name long
    enough to truncate take the timestamp down with it. That is true of one part
    carrying both facts and false of two: a plate that positions itself can only
    cap its own width, where two items of one flex row negotiate — so the name
    truncates against the instant, which is the leagues list's own construction
    and the reason `CardLedge` exists. The two facts still hold the card's
    corners; what changed is that the trailing one is now a part rather than a
    right-aligned span, and the interior line it left is what the league specs
    became a housed instrument on.
  - **The value column reads one asset at a time as well as the side total, and
    only where that says something the total doesn't** (`TradeMetric.asset`,
    `bundleAssets`). A total says which haul was bigger and nothing about which
    piece carried the weight — "three players for a first" is a different trade
    depending on whether the three are 8,000 apiece or 800 — so a line wears its
    own number, right-aligned on the same edge the total sits on. Two rules keep
    it from becoming noise. **A breakdown of one is the total**, so a side is
    counted over the lines the metric actually *covers* and draws none where that
    is a single line — otherwise the most common trade there is prints one
    player's price against his name and the identical figure a line above. And
    **not covered and not priced are different answers**, the distinction the
    total's hover already draws: FAAB gets no cell at all, since a dash there
    would report a hole in a board it was never on, while an unpriced *player* —
    or a pick from a draft KTC no longer carries — is a genuine gap and gets the
    em dash.
  - **The picker holds two lenses on what a haul is worth and nothing that
    counts it, and the counts were removed rather than never written.** A `Haul`
    family sat beside ADP and KTC — players, picks and FAAB, each a count of one
    kind of line — and what those columns said is exactly what the card draws
    underneath them: the lines themselves, named, one per row. That is the
    restatement this codebase keeps having to remove (the trade filters' summary
    line, the league panel's team plate), and here it cost the reader something
    besides a column, because the value column is what **ranks** the tracks: a
    count has no per-asset form, so picking one silently put every haul back in
    Sleeper's arbitrary order. What is left is two columns that both price the
    haul, and every column orders the lines under it —
    `trade-metrics.test.ts` pins both halves, since neither is a claim a type can
    carry. `TradeMetric.asset` stays **optional** all the same and nothing takes
    that path today: what it is for is a metric with genuinely nothing to say per
    line, which is a state the card has to draw (and does, and is tested for)
    rather than one the catalogue happens to be in. Nothing had to migrate —
    `resolveColumns` falls back per slot, so a reader who had picked one of the
    three gets the default board rather than a blank column.
  - **A track lists its players, then its picks, then FAAB — and ranks each of
    those blocks by that same per-asset number, descending** (`bundleAssets`
    for the blocks, `trackLines` for the order inside one). The stored order is
    nothing to rank on: Sleeper's `adds` is a map from player to roster, so what
    arrives is whatever it iterated, which put a first-round pick under two
    throw-ins and the best of three players last on a card a reader is scanning
    rather than reading. Ranked, the top line of each block is the answer to what
    this side actually got. Four things hold it up. **The two halves of the
    ordering are one decision each** — the blocks come back out of `trackLines`
    in the order `bundleAssets` laid them down (a `Map` keyed by kind, iterated
    in insertion order), so players-before-picks is never a rank table here
    agreeing with a construction order there. **The ranking follows the column**,
    since the number it reads is the one drawn beside the name — re-aiming the
    value column re-orders the lines, and a metric with no per-asset form
    (the three counts) ranks nothing and leaves the stored order. **An unpriced
    line sinks to the bottom of its own block and never out of it**: a kicker no
    board prices is still a player this side received, and equal values keep the
    order they arrived in, which is the sort being stable rather than an accident.
    And **`TradeAssetCell.value` is required, beside the `text` it prints**,
    because the ordering has to read a number — `"1,250"` sorts above `"625"` as
    text, which is a card that looks ranked and isn't — and because a metric
    added later would otherwise quietly rank every one of its lines as unpriced.
  - **A pick is named the way Sleeper names it: its slot where the order is set,
    its round where it isn't, and its origin only when that is a surprise**
    (`features/trades/pick-display`, and `pickLabel` in
    `features/shared/pick-value`). Once a league has set that draft's order the
    pick has a *place* — 1.05 rather than "a 1st" — which is the difference
    between the pick that takes the best rookie and the pick that takes the fifth;
    most picks on this board are seasons out, so the round is usually all there
    is. The origin is drawn exactly when the pick did **not** come from the roster
    handing it over: printing "from DarksideEmperors" beside a pick
    DarksideEmperors just gave away is a line of noise on most cards carrying a
    pick at all, and every character earned when the pick came from a third party.
    A three-way has no knowable giver, so the origin stays — with nothing to
    compare against, naming the owner is the only honest thing the line can say.
    Two things make it work. The slot is resolved server-side and rides *beside*
    the page (`pickSlots`, keyed by `pickSlotKey`) rather than on each pick,
    because it is a fact about a league's draft and one entry serves every trade
    naming that roster's pick; **absent means unordered, never zero**. And the
    origin's *manager* rides **on** the pick (`TradePickAsset.user_id`), resolved
    by `assembleTrade` from the league's whole roster→owner map — the pick worth
    naming an owner for usually comes from a roster that isn't in the trade, which
    a client reading only the sides could never resolve.
  - **The draft order is read through `draft_order`, and the season's draft is
    chosen before its order is looked at** (`getDraftSlots`). `draft_order` is
    user → slot, joined back through `rosters.owner_id`; Sleeper's own
    `slot_to_roster_id` would be a hop shorter and isn't stored, and a roster
    whose owner has left resolves to nothing rather than to a guessed slot. An
    auction is excluded outright — its `pick_no` is nomination order, the same
    quirk that keeps auctions off the ADP board, so its `draft_order` is not a
    pick order. The choose-then-check ordering is the subtle half: an inaugural
    league runs a startup and a rookie draft under one season label, and picking
    the latest draft *and then* finding it unordered has to report nothing, where
    filtering unordered drafts out first falls through to the startup and hands
    back that draft's slots for a pick in this one.
- **Pressing a trade card opens its league, as a sheet rather than in place —
  which is the one thing the leagues list does that this board cannot copy.** A
  league card expands where it sits, pins itself under the app bar and caps at
  the viewport; none of that is available over a windowed list, where a card is
  an absolutely positioned item inside a transformed box (so `sticky` resolves
  against the *item*) and a several-hundred-row panel is a measured height change
  on every open. `LeagueSheet` is a `<dialog>` over the board, the shares sheet's
  material and rules: glass on the frame, an opaque plate under the rows, and the
  top layer, focus trap, Escape and backdrop press all the platform's. The
  virtualizer is untouched, so closing puts the reader back exactly where they
  pressed. Four decisions in it:
  - **The panel is the leagues list's panel**, `features/shared/ui/league-detail`
    — the mover's rule, and the largest thing it has moved. A second copy of a
    standings table is two answers to "how is this league going".
  - **The card is the target and the league's name is the button.** The obvious
    implementation is the leagues list's own — `role="button"` on the row — and it
    is wrong at this size: `button` takes presentational children, so a card
    holding two manager blocks, a dozen asset lines and their values would be
    flattened to one label for assistive tech. So the nameplate's `<h2>` holds a
    real `<button>` and the card's wrapper carries only the click handler; a
    keyboard press of that button fires a click that bubbles to it, so one
    handler serves both and neither fires twice.
  - **`onOpenLeague` takes the trade rather than closing over it**, because the
    card is `memo`'d against props that are stable by construction and a per-card
    arrow would re-render all ~26 windowed cards at both ends of every scroll
    gesture. One `useCallback` for the list.
  - **It opens on a roster that dealt** (`focusRosterFor`) — the reader's own
    where they are in the trade, the first side otherwise. The panel's own answer
    is the projected leader, which is right for someone who arrived at a league
    and wrong for someone who arrived at a trade. The panel takes it as
    `focusRosterId`, a *seed* rather than a prop it follows, since a press on a
    standings row must not be undone by the next render; the sheet mounts the
    panel only while open, which is what makes a second press a fresh mount with
    no stale selection to reconcile.
- **Trades made before a league's startup draft ended are not on that board, and
  they are excluded in SQL rather than hidden on the client.** A startup fills
  empty rosters from the whole pool, so everything traded up to its last pick is
  draft position changing hands — dozens in a day in one room — and that is not
  the market the page is about. The boundary is the league's *first* draft's
  `last_picked`, for a league with no `previous_league_id`; each half of that is
  load-bearing. An inaugural league can run a rookie draft after its startup in
  the same year, so the bound comes from the earlier draft or months of real
  trades between the two vanish. A continuing dynasty's draft is additive to
  rosters that already exist, so it bounds nothing. And **a null `last_picked`
  excludes nothing** — a draft nobody has picked in, or one stored before the
  column existed, keeps every trade rather than being hidden behind a boundary
  invented from `start_time`, which is what makes this inert until the crawler
  has re-visited a league instead of wrong in the meantime.
  **That bound only means anything once the startup is over, so the draft's
  `status` is read beside it.** On a running draft `last_picked` is the running
  edge, and a trade made in the draft room lands *after* the pick before it — so
  the comparison kept essentially every in-draft trade, which is the entire
  population it exists to drop, and in August that is most of the board. A
  startup that hasn't reached its first pick is the same hole spelled
  differently: no `last_picked`, so nothing excluded. An unfinished startup
  therefore drops the league's trades outright — until it ends there is no
  post-startup market to be reading — and the comparison applies only to a draft
  that says `complete`. This is why "the running edge is the same question asked
  of a moving target" was wrong: a moving boundary lets everything through as it
  moves. Both columns stay inert when they say nothing, though — an absent
  `last_picked` is no cutoff, and a status Sleeper didn't send reads as finished
  rather than as evidence a draft is running, since hiding a whole league on a
  missing field is the louder failure.
  Doing it in the read stays the point now that nothing is capped, for a plainer
  reason than the budget it used to protect: `total` is counted over the same
  population the rows come from, so the board's stated size means "trades worth
  reading", where hiding the same rows on the client would leave the count
  quoting trades nobody can see. The one trade that goes with that: a trade Sleeper filed with no
  timestamp is dropped *in a league that has a boundary*, since there is no
  honest side of it to put the trade on — the same rule the date filters and
  `/api/adp` follow for an undated draft.
- **The three manager tabs are one scaffold, `LeaguesViewLayout`, over one hook,
  `useFilteredLeagues`.** Leagues, players and leaguemates were line-for-line
  copies of the same chrome — wide shell, cold-load state, header and count line,
  filter control, the note that stands in when the filters match nothing — and
  three copies of that are one edit away from disagreeing about how a failed
  refresh or an empty account looks, which reads as a bug in whichever tab didn't
  get edited. Only three things ever varied: the count line, the body, and that
  the leagues tab says "X of Y" when narrowed. That count is a `stat`
  (`{label, value, sub}`) rather than a free `ReactNode`, because it is now laid
  out as a cell in the header's readout rail: three tabs formatting their own
  label-over-number is the drift this scaffold exists to stop. The body is
  `children` rendered
  *below* the empty-filter check, so a tab only ever reasons about a non-empty
  list. The split between the two is deliberate: the layout is the chrome, the
  hook is the state behind it, and `filtered` stays a value the page can read
  because the players and leaguemates shares memoise on it — buried in the chrome
  it would be out of reach.
- **The filter selection outlives the tab you chose it on, because the three tabs
  are three routes.** Held in each view, a filter snapped back to the default the
  moment you moved between Leagues, Players and Leaguemates — the same league set
  narrowed three ways, re-narrowed by hand each time. So `LeagueFiltersProvider`
  is mounted once in `app/manager/[searched]/layout.tsx` and `useFilteredLeagues`
  reads it through `useLeagueFilters` instead of holding `useState` of its own.
  What makes the shared state safe is where it is mounted: the layout is keyed by
  the searched manager, so the selection follows you across tabs but still starts
  fresh when you look at someone *else* — a per-manager reset, not a global one.
  `useLeagueFilters` throws outside that provider rather than falling back to the
  defaults, since a silent fallback is a filter bar that renders fine and quietly
  moves nothing.
- **The manager tabs carry two independent filter sets, and sharing state between
  them would be a bug.** The header's `LeagueFilters` narrow *which of this
  manager's leagues* a share is counted over; the ADP drawer's `AdpControls`
  narrow *which drafts in the database* the average is taken from. One is about
  the manager, the other about the market, and they are only adjacent on screen —
  a dynasty filter on the header means "count my dynasty leagues", the same word
  in the drawer means "average dynasty drafts, including strangers'". They stay
  independent for that reason. **That rule got harder to keep and no less true
  when the two became the same *control***: `AdpControls.leagueRules` is a
  `LeagueFilters`, edited in the same dialog, and it is still a different
  selection over a different population. Two stores, one control definition — the
  reverse of the arrangement above it, where one store drives one control. Both are now provided from the same place —
  `AdpControlsProvider` sits beside `LeagueFiltersProvider` in the manager layout,
  reset per manager by the same subtree key — because the ADP controls stopped
  being a Players-tab thing: they drive that tab's per-player ADP *and* the
  Leagues tab's team value, so a board chosen on one tab has to survive the trip
  to the other. It used to be only the *steepness* that reached the Leagues tab,
  which was the smaller half of that and left the drawer able to say one thing
  while the cards under it said another — see `adpValueRead`.

  **The provider is per *tool*, not per app, and two other pages mount their
  own.** The trades page reads the same board (`app/trades/page.tsx` wraps
  `TradesHome` in its own `AdpControlsProvider`) and so does the lineup checker,
  which needs one because its player-shares sheet prices rows off that board —
  the sheet is shared, so it reads `useAdpControls` wherever it is opened, and a
  page that opens it has to mount a store. (That is also why `/lineupchecker` is
  `force-dynamic`: the season a board opens on is server-resolved, and a page
  reading it must not be prerendered or the resolution is baked into the bundle.
  It draws no drawer, so the board there is the default one and a reader cannot
  retune it — the honest cost of putting the sheet on a page with no ADP trigger,
  and the fix if it ever matters is that trigger rather than anything about the
  sheet.) The temptation is to hoist one provider
  to the root layout so a board chosen anywhere follows you everywhere. That is
  wrong for the reason the two filter sets above are wrong to merge: what the two
  boards *mean* differs. The manager drawer's "Match a league…" seeds from a
  league you play in; the trades drawer has no account to read and draws no seed
  control at all (see below). A shared selection would carry a board seeded from
  one manager's league onto a page that is about nobody. Two providers, one store
  definition.

  **The provider resolves the league rules as well as holding them**, which is
  the one thing in it that is not simply state: the rules are a browser-side
  predicate engine and what the routes take is their answer, so somebody has to
  run them — and it has to be *one* somebody, or the four reads priced off this
  board (the board itself, the Players tab's column, the cards' team value and
  the panel's two value columns) would be narrowed four ways. It also means the
  league list they run over is fetched exactly when a rule is set rather than on
  every page load; the drawer asks for the same entry whenever it is *open*, for
  the dialog's own counts, so the two gates are one request. With nothing in hand
  the scope is `all` rather than "no league matched" — a board that has not yet
  been narrowed reads as unnarrowed rather than as empty.

  Unlike the league filters, whose
  provider holds a selection from the start, `AdpControls` used to open as
  **null** — its default was the viewed season, which the layout doesn't know, so
  each tab filled it in through a `useAdpControlsFor(season)` the consumers all
  carried a `?? defaultAdpControls(season)` for. The season is back on the
  controls — a board pooling two of them is wrong at every row — but the null is
  not, and the difference is where it comes from: the **layout** passes
  `DEFAULT_SEASON` as a prop, once, before any tab renders. A layout is a server
  component, so that constant crosses to the client store the way a server fact
  should, rather than being re-derived from a clock in pure client code, where it
  would be a guess about when Sleeper rolls a league year over. The provider also
  owns `resetControls` and hands out `defaultSeason` for the same reason: what
  "default" means is the store's business, and the drawer needs it to know which
  relative presets can mean anything. Shared *provider*, still two separate
  selections. "Match a league" is the one bridge, and it is
  deliberately partial: it seeds the *league settings* from one of the manager's
  leagues, while the date range and draft type stay manual — they aren't league
  settings at all. Superflex was outside it too, for want of `roster_positions` on
  the client league; the league filters put that on the wire, so it is seeded now
  through the same predicate `/api/adp` classifies stored leagues with. That one
  matters most of the set: guessing it reads a two-QB league off the board it is
  least like. The season is seeded for the same kind of reason — a 2025 league's
  board is read from 2025 drafts, and leaving it on this year prices the league
  against a market it was never in.

  **That bridge is a manager-tab control and the trades board draws none**
  (`seedLeagues`, which the drawer takes separately from the `leagues` its size
  options are read off). It looks like the same control over a longer list and is
  a different one: seeding is a *shortcut*, and it works because you pick the
  league by name — you know it, and you know what its settings are. The trades
  board's population is every crawled league in the season, so the same menu is
  alphabetised strangers whose settings you have no opinion about and whose names
  you cannot search for. That is the tell for whether a control ports to that
  page: every other filter in this drawer describes the *market* and works there
  unchanged; this one describes the *reader*, and that page deliberately has
  none. Two league props rather than one list passed twice, because the two
  populations genuinely differ there.
- **The ADP controls are a drawer behind one button, not a bar on the page.** Ten
  selects and a caption sat above the first row of every manager tab — ~110px of
  chrome, wrapping to three lines on a laptop — for settings that are chosen once
  and then read. `AdpTrigger` was seated in the header's control dock instead
  (a recessed trough under the plate, since retired), beside the league filters'
  own trigger, badged with the range and the draft count. **It is in the app bar now, and it says one word.** Three things moved
  with it, and each is a consequence of the last:
  - **The seat is a portal, not a prop** (`features/shared/ui/header-slot.tsx`).
    The bar is mounted at the root layout and this trigger reads the manager
    layout's ADP store, drives the drawer that layout renders and shows the board
    it fetches — none of which can climb to a layout that knows nothing about a
    manager. So `HeaderSlotTarget` marks where a part lands and `HeaderSlot`
    portals one there: the part stays a child of the page as far as React is
    concerned and only its *box* is in the bar. An unfilled seat has no width, so
    every other page's bar is laid out exactly as before, and a manager with no
    leagues fills nothing.
  - **The label is the tool's name and the sentence is inside.** `All of 2026 ·
    1,204 drafts` was right in a dock, where a line of chrome can afford a
    sentence; the bar is a row of names at the width a phone has for all of them
    at once, and the drawer states the board and the count in its own header one
    press away. It is still named on hover — the desktop backstop the contracted
    player names already use, not the plan, since the phone is the width the
    change was made for.
  - **It wears its own subject.** An accent rail down the leading face — the
    manager plate's mark for "a readout follows" — and three descending bars,
    which is what an ADP curve looks like at 13px. The bars stand in a milled
    channel rather than being painted on the face, and that is the detail
    carrying the depth: at this size the eye reads the *inside* of a part before
    its outline, so three cyan rectangles are a texture where three solids with a
    lit top edge and a dark side standing in a cut are objects.
  - **The trigger takes a state it deliberately refused before.** It never wore
    the accent, on the grounds that a board is always chosen so tinting it spends
    a signal on a constant — an argument that held *because the trigger named the
    board*. It doesn't now, so `adpNarrowingCount` lights the **bars** when the
    board is narrowed away from the default (the season counts, being a different
    market; the value curve doesn't, narrowing nothing) and raises the block's own
    glow. The signal rides on the part that already means "board", and never on
    the face: the bar keeps exactly one fully lit key, and that is Tools.

  They stay **two controls** rather than two tabs of one dialog for the reason
  the two filter sets stay independent: one narrows this manager's leagues, the
  other the whole crawled database, and one dialog over both would suggest a
  single selection. The split is spatial now as well — the filters stay on the
  header plate, over the list they narrow, and the board sits up in the chrome
  with the population it describes, which belongs to no manager at all.
  Two things inside the
  drawer are load-bearing. The controls are **pinned** and only the board scrolls:
  the point of the shape is that changing a filter and watching the ADP move is one
  glance, which a stacked panel loses by pushing the board below the fold. And
  the board's league filters **are the league filters** — the same
  `LeagueFiltersPanel` the manager tabs and the trades board open, in the Leagues
  bay of that pinned rail.

  **They are drawn *in* the bay, not behind a key in it, and the difference is
  the modality rather than the press.** They arrived here as the whole
  `LeagueFiltersModal` — trigger and `<dialog>` — which made the Leagues bay a
  panel holding one key that opened another panel, and made that panel a **modal
  over the board it narrows**: 1040px of sheet, everything behind it inert,
  including the drawer whose footer and season row a reader was mid-thought in.
  That is the one thing every bay is built not to do. So `LeagueFiltersPanel` is
  the dialog's body extracted whole — season band, fixed rails, rule bays, match
  rail, footer — and the two hosts keep only what is theirs: the dialog keeps
  `showModal`, the backdrop and the focus move; the bay keeps the cap on its own
  height and shuts itself on Apply. Three things follow:
  - **The layout is container-queried, and that is the load-bearing half.** The
    two-column grid, the sticky match rail and the footer's restated count were
    viewport breakpoints — correct while the one host was a ~1000px sheet, and
    exactly wrong inside a 32rem drawer *on the same laptop*, where all three
    would have fired in a box less than half the width they were written for.
    They measure the panel now (`@4xl`, and `@2xl` on the rule bays' own box), so
    the dialog is byte-for-byte what it was and the bay lays out as the one-column
    arrangement the dialog already had for phones. `MatchRail` gave its
    `lg:sticky lg:top-0 lg:self-start` up to the grid item that holds it, the
    usual rule: a shared component that hard-codes a property a caller has to
    override is a component no caller can override it on.
  - **The draft is the host's, not the panel's.** Both hosts hold one — the
    counts beside every option are unreadable if the population moves while they
    are being read, and this board is a network read besides — but what a commit
    *writes* differs, and that difference is why there is no shared hook: the
    dialog emits filters and closes itself, where the bay writes the rules and
    its own draft-kind row into one stored `AdpControls`.
  - **One write, which fixed a silent bug.** That row used to ride the dialog's
    `extra.onApply`, called beside `onChange`; both closed over the same stored
    controls, so the second landed `{...controls, rounds}` on top of the first and
    took the rules back out with it. Changing a rule *and* the draft kind in one
    press applied the draft kind and dropped the rule — and changing either alone
    worked, which is why it survived. `withLeagueFilters` takes both, which makes
    it unrepresentable, and `ExtraSegment` is the row alone now (label, options,
    default) with no `value`/`onApply` for a caller to commit separately.

  **They were four chips of the drawer's own — scoring, superflex, best ball and
  league size — and each already had an exact equivalent in the rule vocabulary.**
  `qb+sf ≥ 2` *is* `isSuperflexLineup`; the size chip is `teams = 12`; the
  reception buckets are what `SCORING_PRESETS` writes. What the chips could not
  express is everything else a reader arrives at a board with — "average the
  drafts of leagues that start a linebacker", "half PPR with a TE bonus over half
  a point" — so the weaker of two filter languages a few pixels apart was the
  thing to fix, not the row's height. **League size joined the shared rules to
  make that swap whole** (`LeagueFilters.settings`, a third `RuleBay` — it
  arrived as `size` and has since widened to the whole `settings` blob): it is a
  fact about a league like every other rule there, so the manager tabs and the
  trades board read it too rather than it being a filter one page knows about. A
  rule rather than a chip because a chip can only ask for an exact count, where
  "at least ten teams" is the question a reader arrives with as often — and a
  *band* is two rules, which is one of the things the lists being an AND is for.

  **The one control left over is the draft kind, and it is seated inside that
  panel rather than beside it** (`ExtraSegment`, `ROUNDS_SEGMENT`). How many
  rounds a room ran is a fact about the room, not about the league, so it has no
  business in `LeagueFilters` where two other pages would inherit a filter that
  means nothing to them; and a panel plus a stray chip is the arrangement this
  replaced. It rides the panel's own draft/apply contract — seeded on mount,
  applied *with* the rules in one write — rather than committing live, or it
  would be the one control in the panel moving the board while the counts beside
  it were being read. It carries **no per-option counts**, unlike the three rows above it: it
  cuts drafts *inside* a league rather than leagues, so every option would show
  the identical league count and that number would be about something the row
  does not narrow (`FilterRail`'s `probe` is optional for exactly this).
  **A chip asks the question, not the column behind it** still, and this one is
  `rounds` under "All drafts / Startup / Rookie": the round count is the evidence
  and what kind of draft it was is what a reader wants. It replaced a
  snake/linear/auction chip in that slot, which named how a room picked rather
  than what market it priced.

  **That row is the one filter the board *opens* narrowed
  (`DEFAULT_ADP_ROUNDS`), and "unnarrowed" was the wrong default because the
  population is two games.** It used to open on "All drafts", on the reasoning
  that a default should cut nothing and let the reader choose — which reads as
  neutral and isn't: a dynasty rookie goes in the first round or two of a rookie
  draft and somewhere in the middle of a startup, so pooling the two averages
  two markets, and the rookies are the rows it is wrong about, which are the rows
  a dynasty board is most often opened for. It is the same call `draft_type`
  already made one rule down — a board is never over auctions — and it stops
  short of that call for the same reason it stayed a chip: a rookie draft's 1.01
  *is* a draft position, so the rookie board is one somebody can want, it is just
  not what the panel opens on. The bucket is `full` (12+ rounds), the one
  labelled "Startup", so the ambiguous 6–11 round middle the two buckets
  deliberately leave to `all` stays out of a board named for startups too.

  The trigger's `adpNarrowingCount` compares every field to **its default**
  rather than to "all" — the season already worked that way and this is the
  precedent it set — or the bars would light for every reader on every page and
  stop meaning "your board differs from theirs". It counts the league rules
  through `activeFilterCount`, one per rule, which is the same arithmetic the
  filters' own trigger does: the two badges count alike because the dialog behind
  them is one dialog. Inside it, the draft-kind row still reads as narrowed from
  the start, since it is not sitting on its first option — which is the honest
  reading, and it is also the only way back to every draft.

  It reaches the Leagues tab's team value too, which took a second change and is
  the rule below.

  **The pinned block is four rows, and each one it lost was a row reporting that
  nothing was set.** It was six — a header, a labelled season row, a labelled
  window row, three wrapped rows of filter chips and a two-line curve — at
  ~337px on a laptop and ~369px on a phone, against ~136 and ~160 now. What
  went, and why each was safe to take:
  - **The header stated the draft count the trigger already carried**, over a
    labelled row holding two season keys. Both fit on one line with the count as
    a `.lab-readout` cell, which is the material the kickoff timer's digits
    already use (plain, not `-live`: the count isn't a running clock, and
    spending the live face on a constant is the same mistake as tinting this
    trigger). The digits *roll* to a new value rather than swapping
    (`RollingNumber`) — the count is the needle the window control moves, and a
    digit that travels is what says the two are connected.
  - **The window is the one part that is expanded, and it is the exception this
    whole list is otherwise about.** Every other row here got shorter by not
    spending height on a control reporting that nothing is set. This one went
    the other way — it was a line (a trigger carrying `boardLabel` and a
    `RangeSparkline`, with the counter floating over the board on a press, and a
    row of relative presets beside it) and is now `LookbackPanel` seated
    permanently in the block. The collapse's arithmetic was never wrong; what it
    left out is *what* was collapsed. A window is the board's **population**, so
    setting one is the first thing the drawer is opened for, and the presets
    beside the trigger made that look answered — a reader who found "30 days"
    sufficient never learned there was an instrument behind the chevron. The
    board below pays the height and scrolls. Four consequences:
    - **The resting line went with the press, not merely the float.** Its two
      halves were the panel's own channel drawn at 16px and the panel's own
      caption; beside an open panel they are the same two facts twice, one edit
      from disagreeing — which is why the sparkline was drawn by calling the
      channel's functions rather than being handed measurements, and why
      deleting it costs nothing that argument was protecting.
    - **The presets went because the counter *is* them.** "Last 30 days" is `30`
      in the day lens (and the board opens on `14`, see below), "All of 2026" is
      that lens left empty, and a historical
      cut is the date lens — so each of the three has exactly one way in now,
      and any edit that removes one removes the only one. Two chips survive
      inside the panel because neither is a fixed window: `Today` re-opens the
      end, and ◆ `Draft` pins the start at a date that moves every April, the
      one anchor no chip and no typed number could ever carry.
    - **And each of those two is seated under the lens it writes**, which is the
      one thing about the row a reader must not have to work out. The window has
      two ends and there is a key for each — `Today` moves the *end*, ◆ `Draft`
      moves the *start* — and held together in a cluster at the trailing end of
      the row they read as two spellings of one thing; worse, the cluster wrapped
      onto a line of its own at every phone width, which put `Today` directly
      under the `Days back` label it has nothing to do with. So `Today` stands
      under `Ending` and the ◆ key under `Days back`. It costs the row **no
      width**, because a key is narrower than the lens above it (~63px under 64,
      ~51px under ~120), so the measured budgets in `lookback-panel` still hold
      and the wrap still falls between the lenses — the only seam left, and the
      one place a break costs no pairing. It costs no *height* at a phone width
      either, since the cluster was already spending a line there; only a drawer
      wide enough to have held all four on one line pays for the seat. Two
      details ride along. The key is a **sibling of the `<label>`, never inside
      it** — a label activates its control, so a nested button answers a press by
      putting the caret in the field it has just written — and the pairing is
      pinned as document order in `lookback-panel.render.test.ts`, because it is
      a seat and a nesting rather than anything a type can carry.
    - **It is seated, not raised over anything.** The floating panel earned its
      cast shadow by being *over* the rows below it; nothing floats now, so the
      face keeps its grade — the channel is a cut, and a cut is read against the
      face it is cut into — and trades the drop shadow for a wall. The three
      behaviours a floating control owed go with the float, and the last of them
      went when the filter tray became the shared `<dialog>`: the drawer holds no
      floating panel at all now, so `openPanel`, its reset on reopen and the two
      thunks `drawerKeydownHandler` read it through are gone, and **Escape closes
      the innermost thing that is up** is the platform's — a dialog in the top
      layer hears the press and never lets it reach the drawer. The same
      apparatus the columns editor retired when it became one.
    - **The block is taller and the phone still fits.** ~360px of an 844px
      screen against ~200, with the two lens groups wrapping to their own lines
      below `sm` — the panel's own `flex-wrap`, unchanged from when it floated.
      That is the cost, stated rather than optimised away; trimming it is a
      trade against the instrument, not a free win.
  - **The filter row is one key and the seed chip.** It was seven chips
    permanently reading "All" — seven controls' worth of height reporting that
    nothing is set — then a badged `Filters` key over a tray of the same seven.
    It is the shared league-filters *panel* now, which retires the tray, the
    summary chips and the `FilterSpec` table with it: what the tray held is a
    panel with per-option counts, quick-adds and a match rail, and what the
    summary chips said the Leagues key's own value line says. It arrived as a
    key opening that panel as a modal and is drawn in the bay itself now — see
    the bullet above on why a bay may hold anything except a second dialog.
    "Match a league…" stays outside it and stays a chip, because it is not a
    filter — it *writes* filters, from a league the reader recognises by name —
    and the trades board passes it no leagues at all.
  - **The league type is not one of those filters — every fetch answers both
    markets, and the list draws both of them.** A dynasty
    startup and a redraft price different games, which is exactly why the type
    chip used to be the most consequential filter here; it is now the split the
    answer itself carries. `/api/adp` averages every player twice — a redraft
    board (keeper folds in: the same season-long game with a few players
    withheld, where leaving it in neither bucket would put its drafts in the
    total and in no column, the Complete-status failure) and a dynasty one —
    with `min_picks` gated per board, so a rookie is a real number on one and an
    honest em dash on the other. **Two keys in the sticky header used to choose
    between them and don't now**: a control whose only use is to take away one
    of two columns the board is already showing side by side is a control that
    can only make the answer smaller, and the draft counts they carried on their
    faces (the population a reader needs before trusting a column) are on the
    ADP headings' own hover, against the column they describe. `boards` is
    still a three-value union — a blank board stays unrepresentable rather than
    guarded against — and what writes a single board is seeding from a league,
    which picks the market that league is in. The display
    re-sorts for what it shows (`adpBoardRows`) because the fetch's order is
    fair to both markets and therefore right for neither column alone — one
    board keeps only what it can average and sorts on it; both keep every row,
    redraft order first, the dynasty-only tail after it in its own order, never
    interleaved on numbers from two different markets. One board shown keeps
    the Taken and Value columns at every width; both trade Taken for the second
    ADP (its share moves to the ADP cells' hover) and seat the two value
    columns only from `@md` up — the panel is its own `@container`, so that
    measures the drawer, not the viewport. **A third pair sits past those in the
    `@lg` tail, and it used to be KTC's and is the auction bids' now.** KTC
    published `SF` and `1QB` — *dynasty* prices standing beside a redraft
    average as readily as a dynasty one, a second lens on the **player** rather
    than a per-market price. That is a question the comps and trades tools
    answer at length and this board only ever restated, where what a reader
    cannot get anywhere else here is what the same drafts actually **paid**: so
    the two tracks went to `Bid R` and `Bid D`, readings of the board's own two
    markets. It is also what finally made that share a column with both boards
    up — it had been on the ADP cells' hover there purely for want of two
    tracks, and the pair occupying them has gone. It stays a **tail** because a
    collapsible column added mid-row makes the board step sideways as the panel
    crosses a tier, and `@lg` rather than `@md` because the densest state is
    still nine columns and 408px of chrome: the panel went 32rem → 36rem to keep
    the name track at 128px there, against `Christian McCaffrey`'s 122.7px. Those
    px are the nominal frame at 16 to the rem; the app runs at
    `--app-font-scale: 1.125`, and since the tracks, the gaps, the panel's cap and
    the type are all `rem` the scale multiplies both sides — on screen that state
    is a 648px panel, a 144px name and a 138.0px `Christian McCaffrey`, measured —
    the name cell carries the team tag too, so the longest names truncate through
    that and a little into themselves, exactly as they did under the pair this
    replaced.
    The one comparison the frame does not carry is against a *viewport*, which
    scales with nothing: a real 390px phone leaves the single-board name 61.5px
    and truncates every name of any length, which is true before this change as
    well as after it, since neither collapsible pair is drawn at that width. Two
    tracks changed width with the swap and both are measurements: the bid pair is
    2.75rem because `Bid R ▲` is 41.3px and would clip inside its own word in the
    2.5rem `SF` sat in, and the value pair pays that back at 3.25 → 3rem because
    its headings read `Val R` here and only the single-board template spells the
    column `Value`. A pick
    row draws an em dash in both, with a hover saying why — what an auction
    sells is players — which is the call the Taken column already makes. The
    pick rows still read KTC, for the future-season discount and for which
    seasons there are picks worth listing at all; what left with the columns is
    `AdpPickRow.ktc` and the per-player `AdpPlayerPayload.ktc`, and with the
    latter a page-sized `getKtcValuesBySleeperId` lookup nothing on the wire
    could report. `boards` lives on `AdpControls`
    beside `steepness` and shares its standing exactly: display state, never on
    the query string (the cache would split into two entries holding identical
    payloads) and never counted as a narrowing. What "Match a league…" seeds
    for the type is therefore *which board is displayed* — the market that
    league is actually in — and the Players tab asks the same question through
    its own column picker instead, where the ADP metrics come one per board.
    **The last place it survived as a *population* question was the shared
    panel's own Type row, and this caller drops it** (`omit` on
    `LeagueFiltersPanel`, threaded to `SegmentTrough`). It was a second control
    over the axis `boards` already owns, and the two disagree in a way that
    looks like a bug rather than a selection: narrow to dynasty leagues with a
    board seeded to redraft and the answer is an empty column with nothing on
    screen saying which control emptied it. Nothing about `LeagueFilters` changes — the
    field stays, the manager tabs and the trades board keep the row, and this
    board simply never writes it (its controls open on
    `DEFAULT_LEAGUE_FILTERS`, and `seedFromLeague` already wrote a league's type
    as `boards` rather than as a rule). It is dropped as a **row** and not as a
    field for the reason a hidden filter is otherwise unanswerable: the match
    rail walks `activeFilters`, which is a fact about the selection rather than
    about which controls are drawn, so a `type` that somehow arrived is still
    named and still clearable there. **It drops the shared dialog's Season band
    for the same argument twice over**, which is why `omit` is a list of rows
    rather than the boolean it started as: this block leads with a season row of
    its own that decides which leagues are fetched at all, so a second season
    inside the panel is a finer cut on an axis already answered a few pixels
    above.
  - **The keys are `.lab-chip`, not the drawer's own outlined `Segment`.** This
    was the last place in the app still drawing flat bordered buttons for
    something you press; the season keys, the window counter's own keys (± ,
    `Today`, ◆ `Draft`) and the filters' own rails all wear the raised pill and
    `.lab-chip-on` for lit, the same grammar as the trigger that opened the
    drawer.
  - **The board's column headings are `sticky`** inside the one region that
    scrolls, painting the panel's own ground rather than a translucent one. It
    is a free consequence of the block above shrinking: the headings are what a
    column of bare numbers three hundred rows down needs, and there was no
    pinned surface to hang them under before.

  **Draft picks are rows on that list, beside the players, and they read off the
  board on screen** (`features/shared/adp-picks`). A board of player averages has
  no row for a pick and doesn't need one: a rookie pick is a place in a queue and
  the queue is on the board already, so the 1.01 stands where the best rookie
  goes, the 1.02 where the second does, and a pick's ADP *is* a player's ADP —
  which is what lets it sort into the list rather than sit in a table of its own.
  Six decisions in it:
  - **Both halves read the displayed board, which is the opposite call from
    `pick-value`'s and deliberately so.** There the ordering comes from rookie
    drafts and the price from startups, because a *valuation* must not follow a
    display choice — that split is the whole of that module's argument. Here the
    display **is** the question: "where do picks fall on the board in front of
    me" has one answer per board, and on a board of rookie drafts the 1.01
    genuinely is ADP ~1. A second population would make the pick rows describe
    drafts the reader is not looking at.
  - **The discount lands on the value and never on the ADP**, which is what
    `pickAdpStand` was split out of `pickAdpValue` for. The curve is dragged a
    notch at a time and reorders nothing (`adpListIdentity`'s own rule), so a
    pick carries an average and a factor and the cell multiplies them — exactly
    as a player row carries an average and prices it in the cell.
  - **The numbered class asks KTC for nothing.** `ladderSeason` tells
    `pickAdpStand` that a pick is the class the ladder describes, so an unsynced
    KTC board costs the future rows and not the current ones. Without it a failed
    scrape takes the whole feature, since `ktcPickDiscount` answers null with no
    anchor to measure against — which is right for a 2032 4th and wrong for a
    pick being spent now.
  - **A future season is one row per round, assumed mid, and only where KTC
    prices it** (`ktcPickBoardRows`). There is no class to number against, so
    there is no honest slot; and a season KTC has no opinion about is a season
    whose picks cannot be discounted, so it is absent rather than quoted at a
    nearer pick's price.
  - **The class season is the *active* one, not the board's.** `rookie` on a row
    names the class that is a rookie now, so a board cut to a past season holds
    none of them and lists no picks — empty rather than mislabelled.
  - **`adpBoardEntries` decides where a pick goes among the players and nothing
    else**: a merge of two ordered lists rather than one sort over both, so
    `adpBoardRows`' own tiebreaks stay its business. A tie puts the player first,
    since the pick is an annotation of the row above it.

  `draft_type` is a constant now (`snake,linear`)
  for the reason it always defaulted that way: an auction's `pick_no` is
  nomination order, so its "ADP" is not one.

  - **The auctions come back as a column rather than as a draft type, and there
    is one of it per market.** What an auction publishes that a snake draft
    cannot is a *price* — the winning bid over the room's budget — so it is a
    second reading of the same players rather than a fourth setting of
    `draft_type`; `shared/manager/adp-auction` reads it over the same leagues,
    season and window with that one filter overridden, and the wire carries its
    own `redraft_auctions`/`dynasty_auctions` because quoting the board's draft
    count beside it would name a sample the share was never taken over. Each
    heading states its own count for the same reason: with both markets lit
    those are two populations, and one shared string would put whichever
    arrived first under both.

    Where it *sits* is arithmetic rather than taste. A per-market share needs one
    column per market, and the both-boards row had no two tracks to give it while
    KTC's pair held the `@lg` tail — which is why the reading lived on each ADP
    cell's hover there, exactly as the Taken share does. It still does below
    that tier, since the pair is seated at `@lg` and the single column at `@md`:
    a hover is what a narrow panel has. With one market lit the column is 2.25rem
    (the position column's width: `Bid ▲` measures 29.9px in a 36px track, and
    the widest cell, `100%`, is 30.7px); with both it is 2.75rem, because a lit
    `Bid R` carries a sort caret and measures 41.3px. A tier lower would put the
    single column on a phone, where the name is 61.5px of a real 390px panel and
    the column plus its gap is 49.5 of the same pixels — 12px left, which is no
    name at all. The single-board state has no `@lg` tier at all now, so at the
    full-width panel with every column up its name has **240px** nominal.

    Two smaller consequences follow the house rules rather than the board. The
    share is written to four characters — integer at or above 10%, one decimal
    below — because a tenth of a percent on a 58% player is noise while a whole
    percent on a $1 flier is zero, and because that is what the narrower of the
    two tracks holds; the wider one is written the same way rather than spelling
    one market's shares to a different precision from the other's. And a *pick*
    row draws an em dash with a hover saying why, the same call the Taken column
    makes one cell to its left: what an auction sells is players, so the column
    does not apply rather than having no data.

  The board is fetched by
  the layout and gated on `open`, so a tab nobody opened it on costs no request;
  on the Players tab that means the same board is fetched twice while the drawer is
  up, which is a bounded cost paid only while someone is looking at both.
- **That board is windowed and its scroll box is *bounded*, and the two are one
  fix rather than a fix and an optimisation.** `/api/adp` answers up to
  `limit=1000`, so the list was a thousand six-column grids mounted at once — and
  the box holding them was `flex-1` with no `min-h-0`, whose automatic minimum is
  its own content, so it never shrank into the drawer and its `overflow-y-auto`
  had nothing left to scroll: the rows ran past the bottom of the panel taking
  the footer with them, and the wheel reached a page whose scroll the drawer had
  already locked. Bounded but unwindowed is a thousand rows behind every frame;
  windowed but unbounded is a spacer nobody can scroll. Five things hold it up:
  - **Fixed size, not measured, and the row is *given* the height rather than
    asked for it.** `ADP_ROW_HEIGHT` is arithmetic (a 20px `text-sm` line box,
    `py-1.5` either side, the 1px top border) and is written onto every `<li>`,
    because the rows are positioned at multiples of it — an *estimate* a pixel
    out is a screen of drift a thousand rows down. It is safe to pin because no
    cell wraps and the name is truncated to one line; a row that ever needs two
    wants `measureElement`, not a bigger constant.
  - **`useVirtualizer` over the drawer's own box, never `useWindowVirtualizer`.**
    The trades board virtualises the *document* on purpose (an inner scroller on
    a phone is a scroll trap); this list already lives in a bounded modal, so its
    scroll element is that box. What that costs is an origin mismatch — the
    virtualizer measures rows from the *list's* top while comparing them against
    the box's `scrollTop` — which `scrollMargin` reconciles, measured off the
    sticky head with a `ResizeObserver` on the **box** (whose size changes with
    the drawer and never with the list inside it). A plain effect suffices
    because `getTotalSize()` and `start - scrollMargin` are both invariant to
    that number: a late measurement moves nothing on screen, it only sharpens
    which rows count as visible.
  - **The head stays a sibling *before* the spacer.** Inside it, it would be
    absolutely positioned along with the rows and stop sticking; the rows pass
    behind it because `sticky z-10` outranks positioned children whose `<ul>`
    opens no stacking context of its own.
  - **The window lives one component down** (`AdpBoardRows`). The virtualizer
    notifies React on `[isScrolling, startIndex, endIndex]`, so whatever holds it
    re-renders every time the window crosses a row boundary — many times a second
    at 33px a row. Held in `AdpBoard`, each of those also rebuilt the board head:
    two keys, seven headings and the three hover strings behind them, none of
    which a scroll can change. (It is also the component the React Compiler
    declines to memoise, which is honest — it *must* re-render on scroll — and
    confining it keeps that skip off the chrome.)
  - **A row takes an `offset`, not a `style`.** The list rebuilds every windowed
    row's props on each notification, and a fresh object would fail `memo`'s
    shallow comparison for two dozen rows of which at most one moved. Rank and
    `aria-posinset` are the index in the *whole* list, so a screen reader hears
    the board's length rather than the DOM's.
- **A board that becomes a *different board* sends the list back to the top, and
  which changes those are is one tested function.** `useAdp` holds
  `keepPreviousData` — which is what keeps the old rows on screen through a fetch,
  and exactly what leaves a reader four hundred rows deep in a list about to be
  seventy-five rows long in a different order. `adpListIdentity` is the key that
  effect runs on, and it is deliberately **not** a list of fields: it is
  `adpBoardRead`'s key (which *is* the population — the league rules included,
  since what it carries is the ids they resolved to — so a filter added there resets the
  scroll without this being touched) plus `boards` (the one display selection that
  isn't merely one — `adpBoardRows` drops the rows a single board can't average
  and re-sorts on that board's column). The **steepness is the exception the whole
  function exists for**: it converts an averaged ADP into draft capital and
  reorders nothing, and it is dragged a notch at a time while the reader watches
  one player's value bend. Two details. The reset fires on the *press*, not on the
  arrival — a beat of the old board's first rows is the honest thing to show,
  where a preserved offset lands the reader among players nobody asked for — and
  it is `behavior: "auto"`, since a glide under a list being replaced is two
  motions fighting. Reading the identity off the query string also gets the
  near-misses right: the `all` preset and a custom window with neither end set
  resolve to the same bounds, so that is not a new list and the reader keeps their
  place.

  **A heading press is that same event, and it resets the scroll for the same
  reason.** Every column sorts now (`adp-sort.ts`, pure and tested), and the
  board's own merge is spelled as a *column* rather than as a null "unsorted"
  state — so `#` is lit like any other heading and pressing it reverses the
  board, which needs no control of its own. Five rules hold it up. **A row with
  no answer sinks in both directions**, because an em dash is not a small number
  and `null`-as-`-Infinity` floats every unpriced kicker to the top of an
  ascending KTC column. **Every sort is total**, tying back to the merge by
  index, so a column of em dashes still comes back in a fixed order rather than
  the engine's. **A value sort is not an ADP sort reversed** — for a player the
  two agree, which is what makes the pick case easy to lose, since a future pick
  carries a discount and is worth less than the rung it stands on. **A sort
  cannot outlive the column it names**: toggling a board off takes two columns
  with it, so `resolveAdpSort` falls back to the merge — at *render*, not
  written back, so toggling that board on again returns the reader to the sort
  they chose. And **the sort is local to `AdpBoard`, never on `AdpControls`** —
  that store is shared with the trades board and the lineup checker, is seeded
  from a league, and drives four priced reads, none of which has any business
  moving because somebody sorted a column. The one thing that reads the curve is
  a value sort, which is why `isValueSort` gates the steepness dependency: the
  other nine columns are invariant to the slider, and re-sorting a thousand rows
  on each of a drag's ~24 notches would be work for an ordering that cannot
  change.
- **The season is the board's population; the window is a cut inside it.** The
  drawer leads with a row of season segments (`seasonOptions`, taken from the
  density rows so a season nobody has crawled isn't offered, with the current one
  and the selected one always present) and the range narrows within whichever is
  chosen. Four things follow that are easy to undo by treating the two as peers:
  - **The window is the second filter the board opens *narrowed*, and it is
    narrowed to a fortnight** (`DEFAULT_ADP_RANGE`, `DEFAULT_ADP_LOOKBACK_DAYS`).
    It has been both of the other answers — twelve months, then the whole season
    once the season did that job properly — and what neither can do is keep the
    board *current*: a season's drafts run May to September and pool a rookie
    market, a startup market and every re-draft between them, so an August reader
    averaging all of them is reading months of consensus the market has moved
    past. Three things hold it up, and each is the `rounds` bucket's own rule read
    again. It is spelled as a **`lookback`, never as stored dates**, or every
    reader's default board is a snapshot of whenever their tab last resolved it.
    **`adpNarrowingCount` and the Window bay compare against the default rather
    than against "is it bounded"** (`isDefaultAdpRange`) — read the old way, the
    board nobody has touched would light the trigger's bars for everybody, which
    is the one thing that count must never do. And the **cost is stated rather
    than discovered**: a narrow window is a smaller sample, so a fortnight in
    which little was crawled is thin and `min_picks` answers more rows as em
    dashes than a season-wide board did. It reaches every read priced off this
    store — the cards' team value, the trades board's ADP column, the rookie
    ladder — because that is what one store means, not a side effect of it.
  - **Changing season drops the window, and drops it to the *whole season*
    rather than to that default.** The same dates against a different season are
    a window that mostly isn't there, and an empty board is a worse answer than
    the new season whole — which is exactly what resetting a relative fortnight
    onto a season that ended a year ago would produce, so `withSeason` writes
    `UNBOUNDED_ADP_RANGE` and the default is deliberately not reused there.
  - **A relative window only means something on a board that can contain
    today**, and with the preset chips gone that is a fact the *counter* carries
    rather than a list to filter. There used to be an `adpRangePresets` deciding
    which chips a season could honestly offer — "the last 30 days" of 2024 is an
    empty board, twelve months inside one season is the season with extra steps
    — and it went with the chips. What replaces it is that the lenses say what
    they mean on any season: a day count is measured back from the **end date**
    in the lens beside it, so a historical board narrows within itself instead
    of reaching for a today it does not contain, and `Today` is a key rather
    than an assumption.
  - **The strip is the season's, not the calendar's.** `/api/adp/density` returns
    `(season, month, drafts)` and the drawer slices to the season it is showing;
    `densityThrough` then runs the domain to today only for a board still being
    drafted, since a strip running from a finished season to today is mostly
    blank. It is drawn once now, in the panel's channel (`range-domain` is still
    where the domain maths lives — it served the resting sparkline and the
    channel together, which is what kept the two from disagreeing about where a
    month sat; there is one reader left and the seam is worth keeping).
- **The window is a sentence — last N days, ending on a date that defaults to
  today — and the sentence replaced the brush.** `RangeScrubber` was a brush
  over the draft histogram: two handles, a sweep, a pan, a slop threshold and a
  proximity router deciding which of them a press meant, plus a marker rail and
  a month axis to read the handles against. Every piece earned its place in
  isolation, and together they read as an instrument that needs a manual —
  while nearly every window a reader actually wants is "how far back should the
  average reach", which is a number, not a gesture. `LookbackPanel` asks it as
  one: a day-count lens with ± keys, and a date lens for the end. It **is** the
  control now — the preset chips that used to fill its fields from outside are
  gone with the collapse, so these lenses are the only way to state a window.
  Six things in it are decisions, not styling:
  - **The two fields are a view over the stored range, never a second store.**
    `lookback.ts` (pure, tested) maps both ways: every `AdpRange` reads as
    `{days, end}`, and a write lands in the storage its meaning asks for. A
    window ending **today is relative** — 30 and 90 land on the *named* presets,
    and any other count is the `lookback` preset carrying its `days` — so it
    rolls forward with the calendar, which is the promise the named presets
    always made. (Those two counts landing on names used to be what lit the
    resting line's chips exactly; with no chips it is about *naming* — the two
    spellings resolve to the same bounds, and `ADP_RANGE_PRESETS` is the one
    table that says "Last 30 days".) A **hand-set
    end freezes** the window into `custom`, because a reader who named a day
    meant that day. The same two lenses show both, so the caption states which
    the board is doing ("rolls forward daily" / "ends Jun 30, 2026").
  - **"Since the NFL draft" survives as a computed key, and it pins rather than
    counts.** The date moves every April, so no fixed chip and no typed number
    can carry it — the ◆ key (and the flag on the channel) fills the lens with
    the day count but *stores* the draft's date (`sinceDraftRange`, a `custom`
    from-bound): days-since-the-draft grows nightly, and a stored count would
    walk the window's start off the date it names. `draftAnchor` resolves which
    draft the key means — the latest at or before the window's end within the
    strip's domain, so the all-seasons board anchors on the newest one and a
    historical cut reaches the one before it — and a domain holding no draft
    draws no key. `nfl-calendar.ts` stays the source; what retired with the
    scrubber is only the clickable REG/PRE bands, whose windows the counter
    expresses as plainly as any other pair of dates.
  - **The density stays on screen and stops being a control.** The same bars in
    a milled channel (`.lab-channel` — the app bar's slot at panel width, bars
    with lit tops standing in a cut), lit inside the window, the window's edges
    ticked over them, the draft's fuchsia hairline kept. It is still narrowed
    by nothing the drawer can change — a readout reshaping under the hand using
    the filters beside it is worse than none — and it still shows **no count**,
    because the bars and the board's `draft_count` are different populations;
    the header states the real one. The draft flag is the channel's one press;
    everything else is paint, which is what retired the gesture machinery
    (`scrubTargetAt`, `panWindow`, `edgeBounds` and the axis-tick thinning went
    with the component, and `range-domain` keeps only the domain-and-bars maths
    the channel reads).
  - **The number previews; the release commits** — the steepness slider's rule,
    for the same reason. A committed window re-fetches the board, so typing
    "104" must not fetch three boards on the way: the channel and the caption
    re-read per keystroke (local and free), and the store moves on blur or
    Enter. The ± keys and every chip commit at once, since a press is a
    finished value. The date field carries the same idea sideways — a
    controlled date input that snaps back on every incomplete value fights the
    keyboard, so the transient string stays local and only a full date the
    window can end on commits.
  - **Stepping down from "whole season" does nothing.** An empty lens means no
    start bound, and the − key counting it down to a one-day board would be a
    press nobody meant; the + key from empty starts at 1, because "narrow this
    a little" has to start somewhere.
  - **What is left of the presets is the naming, and that is not their
    leftovers.** The handles went first and the chips followed;
    `ADP_RANGE_PRESETS` is now a label table and nothing else, and it still
    doesn't offer `custom` or `lookback` — neither is a mode you enter, both are
    what the lenses *produce*, and both name themselves from the dates or the
    count they carry. The four that stay named earn it for the reason they
    always did: "Last 90 days" is still the last 90 days tomorrow, where the
    dates behind it would have to be re-read. `boardLabel` folds an unbounded
    window into the season everywhere the board is named at all — "2026 · All
    time" would be claiming two contradictory things — `rangeLabel` names the
    window alone and speaks the counter's own grammar for the general case
    ("Last 45 days"), and `rangeSummary` is narrower still: it belongs *inside*
    the panel and nowhere else, since naming a window's edges is worth the width
    only where the lenses are sitting on them.
- **A modal that refocuses itself must not depend on its callers' callbacks.**
  `AdpDrawer`'s open effect held `onClose` in its deps, and every caller passes a
  fresh arrow each render — so every keystroke re-ran it and `panel.focus()` took
  focus off whatever was in use. That was survivable while the drawer held only
  selects; it is not survivable for a slider nudged one arrow-press at a time. The
  callback lives in a ref and the effect depends on `open` alone.
- **Decide per read whether a failure is fatal — on the client too, not just in a
  route.** `/api/league/[leagueId]` already catches its projections read and
  sends `outlook: null`, and the KTC route lets a failed solve cost the split but
  not the value. `useAdpDensity` is the same call one layer out: a failure leaves
  `months` empty rather than tearing the control down, because the bars are the
  only part of the window control that needs them — the lenses and the draft key
  work on dates alone, so the channel degrades to an empty slot
  and the caption says the activity is unavailable. Ask what a read is
  *load-bearing* for before letting its failure propagate; here it decorates a
  control that still functions without it.
- **`useAdp` is not keyed to the manager, unlike every other hook on these
  pages.** The four sub-resource hooks re-fetch on the leagues array because they
  read what that stream wrote; ADP describes the whole crawled database narrowed
  by settings, so it calls `/api/adp` directly and re-fetches on the *query
  string*. It keeps the one habit they share — loaded data is never blanked on
  refetch — because a filter tweak that flashes every ADP cell to an em dash and
  back is worse than a moment of staleness. A `null` query means don't ask at all,
  which is how the layout keeps a closed drawer from costing a request — the
  Players tab passes its query unconditionally, since its ADP column is on screen
  either way.
- The expanded league panel uses container queries, not viewport breakpoints,
  because it renders at half width inside a card. **Both its halves shed their
  second value column below `@xl`, and both shed it in three places at once** —
  the grid template, the heading picker, and the row's own cell. A cell rendered
  into a track that isn't there doesn't overflow, it *wraps* onto an implicit
  second row, where the column's own `justify-self-end` lands it in the rank
  gutter and pushes it off the left edge of the panel. That is what the standings
  heading did on a phone.
- **`@xl` for that column though the gutters widen at `@lg` — three tiers, not
  two, and collapsing them back to one breakpoint is the regression to watch
  for.** A container tier measures the *panel*, and each half is barely half of
  it: at `@lg` a half is ~230px, and once its own `p-4` and two fixed 3.25rem
  tracks come out of that, the name track is left with **32px**. The failure did
  not look like crowding, which is why it survived — the *name* spans all three
  columns and rendered fine, so what broke was everything confined to the track
  itself: `Starters` clipped to `S…`, `Manager` clipped inside its own word, and
  the NFL team beside the position badge squeezed to zero width and simply
  vanished. Widening a gutter and adding a column look like one decision at one
  breakpoint and are two. When moving either tier, sweep the *band just above*
  it — the panel's width is not monotonic in what it can hold, since a tier that
  adds a column takes back more than it gained (the points-for's
  `@sm:inline @xl:hidden @2xl:inline` is the same non-monotonicity, and it tracks
  whichever tier the second column arrives at).
- **The panel's `@container` is a bare wrapper, never the plate that carries the
  padding.** An element is never its own query container, so `@container` and
  `@lg:p-4` on one div made that padding resolve against an ancestor container
  that doesn't exist: it silently never applied and the panel wore its narrow
  inset at every width — no error, no warning, just a rule that does nothing.
  Splitting them is also what makes the query *stable*, since a container whose
  own padding is set by a query on itself changes the content box that query is
  measured against, so the threshold moves as it is crossed. Any `@container`
  element whose own classes carry a `@`-prefixed variant is this bug.
- **In that panel, horizontal chrome is spent twice and comes out of the names.**
  Four boxes nest across it — the plate's inset, the split's gutter, each half's
  own face, then a standings row's own `px` — so a pixel of padding at the top is
  a pixel taken from *both* halves, and the only track with nowhere else to go is
  the name (`minmax(0,1fr)`, between a fixed gutter and an `auto` number column
  sized by `3,249.98`). Below `@lg` every one of those insets is therefore a step
  tighter than it is above, and the rank gutter is `1rem` rather than the wide
  tier's `2rem` — two digits at 0.65rem is all it ever holds. Measured at a 390px
  viewport that is 108px → 123px of manager name and 112px → 119px of player
  name, which is `David Montgo…` becoming `David Montgomery`. **What does *not*
  give is the column gutter**: it went from 4px to 8px to stop the record and the
  value beside it reading as one run of digits, and an inset holds content off an
  edge nothing is written on where a gutter is the only thing separating two
  columns. Trim the padding, never the gap. The two halves' insets are also
  deliberately unequal — a standings row is a lit key and carries its own `px`,
  a roster row carries none — so the plates differ by a step to land both lists
  on a comparable left edge.
- **The scroll bar is the fifth box across that width, and it is a lane rather
  than an accident.** Each half scrolls on its own, so each has a bar, and with
  nothing reserved it painted over the trailing value column — the numbers are
  right-aligned against the box's own edge, which is exactly where a bar rides.
  8px of trailing padding on the scroll box is the lane, and **the heading rail
  above it takes the same 8px**, because the rail is *outside* the box it names
  and anything the box gives up it has to give up too or a heading and its
  column disagree about where the column is. Half of the lane is paid for by
  bleeding the box into the plate's own inset (`-mr-1`), so a row gives up 4px
  and not 8. It is padding and **not `scrollbar-gutter: stable`**, which is the
  spelling that looks right and reserves nothing where it matters: a gutter is
  ignored wherever scrollbars *overlay* content — iOS, and macOS by default —
  which is the case the bar was covering numbers in, while padding is reserved a
  second time where they don't. So the overlay case is exact and a classic bar
  takes its own width on top, narrow rather than the platform's 15px because
  `.lab-scroll` thins and tints it. Zeroing that residue too would need the
  heading inside the scroll box, which is where it used to be and cannot go
  back: it is the only thing naming a column of bare numbers, and it is the
  control that aims one.
- **A heading that shares the name's track is sized against the track, not
  against its sibling headings.** `Starters` at `text-xs` exactly filled that
  track and clipped to `STARTE…`; it takes 0.65rem below `@lg`, the size the
  standings' own heading row already uses at that tier. A clipped *name* still
  reads as a long name, where a heading clipped inside its own word reads as
  broken — so where something has to truncate, it should be the field whose
  content varies, never the fixed label above it.
- **`hidden` does not beat a `display` utility that sorts after it.** Tailwind v4
  emits the display utilities in *alphabetical* order, so `.block` loses to
  `.hidden` (which is why the standings *cells* hid correctly) while
  `.inline-flex`, `.inline` and `.table` all win against it. It is the rule
  behind `ColumnHeading` taking its type treatment from the caller rather than
  owning it: both rails set sentence case at their narrow tiers, and two
  `text-transform` utilities on one element are decided by their order in the
  stylesheet, not in the attribute. The general form — a shared component that
  hard-codes a property a caller has to override is a component no caller can
  override it on, and the failure is silent in both the class list and the
  compiler. Source order in the `class` attribute never enters into it.
- **Every `/manager/[searched]/…` view renders one `ManagerHeader`, and so does
  the lineup checker.** Who is being looked at, the season, the sync state and
  the manager's record are the same facts on all of them; only the headline count
  differs, which is what `stat` is. The fourth page swaps the *aggregation*
  behind `record` — `projectedRecord` over this week's matchups rather than
  `aggregateRecord` over the season — because the two are one shape
  counted by the same two rules (the denominator is what contributed; zero and
  absent are different answers), and a second card drawn to say that would be a
  second chance for one of them to drift. Its week goes in `scope`, which is the
  slot that names what a record was counted over, and its filters are the manager
  tabs' own — the league dialog *and* the subject search, on the same
  {@link SubjectRail} in the same seat, held in local `useState` rather than in
  providers, since a provider is what three *routes* sharing one selection need
  and this tool is one page.
  **The plate's bottom-right corner is retired, and this page is why.** It was
  the last seat for the filters' key: the manager tabs moved theirs onto the
  subject rail, and the argument that moved it — three of that plate's four
  corners are readouts, so the one control among them was seated in the wrong
  company, while the row below was already a filter row with a hole at its
  leading end — turned out to be this page's too the moment it grew the same row.
  So `SEATS.corner`, `FilterSeat` and `ManagerHeader`'s `filters` prop are gone,
  and `bodyPadding`/`statePadding` are constants rather than a branch on whether
  a key had to be cleared. What the seat leaves behind is the rule it was built
  to keep: **a seat may change a control's shape and nothing else** — that one
  had to run at the plate's tab scale rather than the pill's, because at
  `text-sm` the part was 32px tall and crossed the win-pct dial above it.

  **Its rows are the leagues list's cards too, and what they put on the trailing
  plate is the opponent.** Same `features/shared/ui/league-card`: same slab, same
  nameplate, same press into the league detail panel. The record is what a
  season-long list is about and who you are playing is what a week's list is
  about, so one fact swaps for the other in one housing — which is the whole of
  the difference between the two lists' cards, and the reason the card is
  parameterised on that plate rather than forked. Two decisions are this page's:
  the panel opens on **this manager's own roster** (`focusRosterId`, the one
  thing this card knows that the leagues list doesn't — a reader arrives here
  because of their own lineup, so landing on the projected leader's bench answers
  a question nobody asked), and the plate is drawn **even when there is nobody to
  name**. That is where it parts company with the record ledge, which draws
  nothing rather than an empty housing: here "nothing" is itself the answer, and
  {@link matchupState}'s three kinds of it — a real bye, a week the crawler has
  not reached, a season with nothing stored ahead of today — are three different
  facts. Collapsing them into an absent plate would tell a reader their league
  has no game when what it has is no data.

  **The plate's trailing end is the verdict, and a median league carries two of
  them.** One mark per projected result — `W`, `L` or `T` in a `.lab-readout`
  cut, after the opponent's name (or after whichever of the three kinds of
  nothing the plate is saying, since a median league's bye is still a game). Four
  decisions in it. **Two housings and never one holding both letters**: a median
  week is two games rather than one game with a footnote, so `W L` has to read as
  a win and a loss — which is also what lets each carry its own tone. **Which is
  which is the seat**, since there is no room on this plate to write *opponent*
  and *median*; the head-to-head always leads, and the hover and the `sr-only`
  carry the sentence for the two readings that have no seat to read. **A win is
  the accent and a loss is dim, never amber** — amber is the needs-attention tone
  and it is already spent one column over on the shortfall, which is the number
  here a reader can act on, and two alarms on one row is neither of them. And the
  marks are **`shrink-0` with a fixed width**: the plate is capped rather than
  shrinkable (see `CardLedge`), so what gives is the opponent's name, and a
  verdict that truncated would be a `W` and an `L` reading identically.

  **The one thing that aggregation changes on the card is which instrument the
  readout wears, and that is a prop rather than something the readout works
  out.** The countdown takes the slot on a claim about the *record* beside it:
  before kickoff every league reports `0-0`, so the dial is an em dash by rule
  and the clock is the only moving number on the plate. That claim is the
  manager tabs', not the card's — a projected week is live months before
  kickoff, since Sleeper publishes those projections that far out, so all
  offseason the timer was sitting on the one figure the lineup checker exists to
  produce. `countdown={false}` keeps the dial there. Nothing in the header can
  see the difference for itself: both records arrive as the same `OverallRecord`
  and only the page knows which question it counted. The branch is a **component
  boundary** inside `HeaderReadout` rather than a conditional below its hooks, so
  a page that never draws the clock never mounts `useKickoff` and costs no
  `/api/kickoff` request either.

  **It scrolls away, and only the list's heading rail stays.** It used to pin
  under the app bar and carry the filter row and that rail inside it, so all
  three held the top together — which is the argument that also took its tabs
  off it (navigation left the card entirely, first to a tab strip in the bar and
  then to the bar's tools menu, which listed the three views anyway) and then
  argued itself out: a card that stays on screen is paying for its height out of
  the list behind it, and what a reader still needs at row ninety is the names of
  the four columns they are scanning, not the account they looked up at the top
  of the page. So the rail pins itself now (see the columns bar above) and this
  is an ordinary card above a list. Five things went with the pinning, and each
  belonged to it rather than to the card: the `sticky` and the `z` that ranked
  it, the `-mx-4 px-4` bleed to `PageShell`'s `wide` gutter, the `--background`
  paint (both so a list passed *behind* the card rather than through the gaps
  around its rounded corners), the `::after` that faded that paint into the
  ambient aurora rather than ending against it, and the `-mt-10` that cancelled
  the shell's top padding so the card's resting place *was* its pinned one. The
  first four are the rail's now (at `z-30`, since what it has to rank against is
  the open card under it and the search panel over it, not a list of menus). The
  fifth is simply gone: with no top to pin to, the page's ordinary breathing room
  above the card is the right answer.
  **What the card no longer renders is the filter row and that rail**, and it
  could not if it wanted to — a sticky part seated in a box that scrolls away
  scrolls away with it. Both are the page's own children, beside the rows.
- **A league card is a trade card, and the slab stops at the press.** It wore
  `LIST_ROW_SURFACE` and wears `.lab-slab` now — wall, brushed face, chamfered
  corners, its name riding out of the top edge on a nameplate, its record in a
  `.lab-readout` — because the trades board's argument for leaving the glass is
  this card's too: a league card is not a line of a table, it is the whole of
  what one league has to say with four ranked columns across it, and depth is
  what sorts those columns into an order. The two lists read as one instrument
  now, which is what a reader crossing between the two tools experiences.

  **The card itself is `features/shared/ui/league-card`, because a third list
  wears it**: the lineup checker's rows are the same card with this week's
  opponent where the record goes. What is parameterised is exactly the three
  things that differ — the trailing plate (`ledge`), the stat columns, and
  whether a line under the head names the league's settings (`specs`) — and
  nothing
  else: the slab, the head's inset, the press, the panel and the whole
  pull-to-the-top-and-cap gesture are one definition, which is what keeps the two
  lists from becoming slightly different products. `CardLedge` is the plate's box
  so the two ledges cannot drift either, and the one thing about it that is not
  obvious is that it is **capped rather than shrinkable**: flex shrinks a box and
  lets its contents overflow, so `min-w-0 shrink` gave a 71px plate around a 118px
  readout hanging off the right of a 390px screen. It takes what it needs up to a
  share of the edge, and the name — which truncates — takes the rest.

  **`CardLedge` itself lives in `ui/nameplate.tsx`, and that is a bundle
  decision rather than a filing one.** The trade card became its third caller
  (its ledge holds the instant), and *this* module statically imports
  `LeagueDetailPanel` — two dense tables, two settings lists, a draft-pick list and a
  query hook. A barrel is one module to the bundler and so is a component file:
  importing one name from here pulls the whole subtree into the graph of
  whatever imported it, which on the trades board is the first paint of a page
  whose panel is deliberately behind a press. Measured both ways — importing the
  ledge from here put a league-detail chunk in `/trades`'s static graph, and
  importing it from `nameplate` (which imports nothing) does not, while the two
  routes that *do* draw the panel inline still carry it. This file re-exports it
  under the mover's usual habit, so the two lists that already read it from here
  keep one import. It is the same failure the ADP drawer and the league filters
  dialog were each caught by, arrived at without a `dynamic()` anywhere near it.

  Six things in it are decisions rather than styling:
  - **A line under the head names the league's settings, as the trade card's own
    bezel of gauges** — type, size, the QB and superflex slots, tight ends, TE
    premium and best ball, read through the league filters' own predicates so a
    card and a filter cannot disagree about one league. The argument is the trade
    card's arriving at the same place from the opposite end: that board spans
    strangers' leagues, so the name alone helps nobody; this list is a reader's
    *own* hundred leagues, most of which differ in exactly these six ways, and
    the only thing that answered "which of these is my superflex dynasty" was the
    filters dialog — which **narrows** a list rather than describing a row of it,
    so the answer was gone the moment the dialog closed.

    **Where it goes was measured, and the obvious seat lost.** The head's leading
    half is a `flex-1` holding nothing but the chevron, so seating the run there
    reads as free — and at the list's widest (an 864px card) it is: ~400px of
    room against a four-gauge run's 279px, one row, +11px a card against a
    line's +47. What that reasoning leaves out is the band nobody develops in. In
    headless Chromium with the real faces and the compiled stylesheet, at `sm`
    the cluster leaves **144px** beside four fixed 96px columns, and the same run
    wraps to *three* rows there — a 137px card against 70px — with a
    fully-specified league at five rows and 193px. On its own line it is one row
    at every width from `sm` up (the six-gauge run's natural width is 430px
    against the 576px a 640px viewport leaves) and two rows only on a phone
    carrying every conditional gauge. Flat +47px: a 35px bezel and the 12px under
    it. **A `flex` line box rather than a block one**, since the bezel is
    `inline-flex` and sat on a text baseline otherwise — 6px of descender leading
    on every card, which is invisible in review and measurable in a browser.

    Two rules ride on it. **The box is the shell's and the decision is the
    caller's**, the split `ledge` already draws: the inset is per-state and a
    caller cannot know which state the card is in, while whether a league has
    anything to say about itself is a fact about what is being said — so a league
    the sync has not answered for draws no line at all rather than an empty 12px
    one. And **it goes below the head, not above it like the trade card's**: the
    chevron stays at the card's top-left where a disclosure mark belongs, the
    four columns keep the first line directly under the rail that names them, and
    the settings read as the context under them — which is the rank the trade
    card gives the same run, below both manager names there.
  - **The top edge carries two plates, which is the one place this card goes
    further than the trade card.** That readout was in the *head*, between the
    chevron and the stat columns — the one part of the card that has to stay
    quiet, since the columns are what a list a hundred rows long is scanned on,
    and two numbers in front of them were read as a fifth. So the record and the
    standing hold the trailing corner on a plate of their own (`RecordLedge`),
    opposite the name: the card's two corners holding its two identities, which
    league this is and how it is going. Four things hold it up:
    - **It is a housing, not a second name.** Same plate, but the record keeps
      the `.lab-readout` cut it already wore, and a cut into a lit face is
      machining — so the part reads as an instrument label rather than a label
      with a name on it. The standing beside it is `.lab-engraved`, the trade
      card's own finish and for its arithmetic: one of these per card down the
      whole list, where a numeral in the accent at that count is wallpaper.
    - **The standing is the rank alone** — `2nd`, not `2nd of 12`. The
      denominator is what a stat column's rank cell spends its width on, and here
      it would come straight out of the league name's truncation budget for a
      fact the four columns state four times over. It survives on the hover and
      in an `sr-only`, where it costs no width: a bare ordinal is a rank out of
      nothing, and this is the one reading of the card with no hover to fall back
      on.
    - **The edge is one flex row, not two placed parts.** A plate that positions
      itself can only cap its own width, and what the name may take is whatever
      the ledge doesn't — a width that is its own contents. As two items of one
      row the negotiation is the layout's, which is what holds at 390px. The row
      is `pointer-events-none` and each plate takes them back, or a press landing
      between the two hits the row instead of the toggle underneath. This is what
      `Nameplate`'s `seat` prop is: `edge` is a plate alone on an edge (the trade
      card), `row` is one sharing it.
    - **Absent is not zero**, the card's existing rule surviving the move: no
      record and no standing draws no plate rather than an empty housing, and a
      preseason league draws the record without a rank, since `0-0` is a true
      count where a rank there would place a season nobody has played.
  - **An expanded card is still `.lab-plate`, and the slab makes that swap read
    better rather than making it redundant.** A slab is an *object in a list* —
    a wall you could pick it up by, a static specular sweep — and none of that
    is what a several-hundred-row instrument wants: the sweep would be a
    diagonal wash across a page of standings, and the wall's `drop-shadow` would
    be repainted around a box the reader is scrolling inside. The panel renders
    straight onto the plate's face, as it did before; what changed is that the
    swap is now a change of *part* rather than of material, which is what it
    always meant.
  - **The head's inset is spelled differently in each state, and that is the
    two boxes agreeing rather than disagreeing.** The heading rail is laid on
    the cards' geometry (`border border-transparent px-4 pl-5`), so content
    starts 21px in and ends 17px off the trailing edge, and a heading a hair off
    the number under it reads as a misaligned table. A slab spends 6px of that
    trailing gutter on its wall and nothing on a border, so its face gives 6px
    back (`pl-[21px] pr-[11px]`); the plate is a bordered box like the glass it
    replaced and keeps the rail's own spelling (`pl-5 pr-4`). Both land at the
    same two edges, which is also what keeps the columns from stepping sideways
    as a card opens — and below `sm` the columns divide the head's own width, so
    the two insets have to *sum* the same as well as ending in the same place.
    **The ledge's own trailing inset is that arithmetic one edge up**, and it is
    per-state for the same reason: the plates are siblings of the *card*, so the
    offset is measured from the card's box while the ledge has to land against
    the *face's* trailing edge — `right-5` at rest, where 6px of that gutter is
    the wall, and `right-[15px]` open, where the face is a bordered box at full
    width. The leading edge needs no pair, since a slab's padding is bottom and
    trailing only.
  - **The name is the button and the head carries no `role`.** `role="button"`
    on the head takes presentational children, which flattened four stat columns
    and their screen-reader labels into one string; the nameplate's real
    `<button>` announces the league and its expanded state, and the head's click
    is the mouse affordance over the same toggle. The trade card's rule, arrived
    at for the same reason.
  - **`RowSheen` is worn only while open.** A slab has a specular sweep of its
    own and a bloom under it, so a second travelling band is the one part of the
    card claiming to be glass — and the rail it draws is what the nameplate's
    already says. Open, it is worth having for the half the plate can't do:
    marking which league is being worked in.
  The list's gap went 16 → 18 with it, which is the nameplate's number and not a
  separation one — the same 18 the trades board arrived at, for the same part.
  `Nameplate` itself is in `features/shared` under the mover's rule: the plate's
  box, its rail and the heading's type are shared, and the *control* inside it is
  not, because the two cards open different things.
- **A hover warms the league the reader is about to open, and three bounds are
  what keep that from being a request per card** (`useLeaguePrefetch`). It is the
  **core** read alone: the prices, the outlook and the week are the expensive
  ones, and speculatively solving a lineup per team per week for every card a
  pointer crosses would cost far more than the hover could save. It is **fine
  pointers only** (`hasFinePointer`), because `pointerenter` fires on a touch and
  a tap would otherwise prefetch and then immediately fetch — the request twice,
  on the connection least able to afford it; keyboard focus is exempt, since
  focus is deliberate on any device. And it is **debounced** at 120ms and
  cancelled on leave, which is comfortably under the time it takes to move a hand
  to a card and press it and comfortably over what a passing pointer spends on a
  row. `prefetchQuery` is itself a no-op inside the entry's stale time, so a
  reader moving back and forth over one card costs one request rather than one
  per crossing.
- **What an open card does *not* start is the timeline.** The history rail is
  behind a `History` key and its query is disabled until that key is pressed —
  the read is the heaviest either of its hosts makes, and mounting the card used
  to fire it at exactly the moment the panel beside it was making its own reads,
  so a card opened to glance at the standings paid for a season of moves nobody
  scrubbed. Nothing after the press changed, cache included, so opening the
  history twice still costs one request. The seat is a fixed height across its
  four states (unopened, reading, nothing stored, the rail), so pressing the key
  moves nothing under it — and "nothing stored" is a *word* rather than the
  nothing it used to draw, since a control that vanishes on press is worse than
  one that says what it found.
- **A rewound league draws the panel's stat columns, and *which of them can
  answer* is decided per metric rather than by dropping the columns.** The past
  body used to draw no numbers at all, on the sound reasoning that ranks,
  records, points for and projections are facts about the league *today* and
  would be attributing them to a team that no longer exists. That reasoning is
  intact; what was wrong was the conclusion. A reader who has aimed both tables
  at KTC and then scrubs back is asking what that roster was worth, and dropping
  their selection made them press `Now`, read the number, and press back — the
  same errand the ADP drawer's own two-answers-to-one-question rules keep
  closing. `features/shared/timeline-columns.ts` is the rule, pure and tested,
  and five things hold it up:
  - **What a rewind knows is the roster's *composition*, so exactly one question
    survives: what are these players worth.** A board price prices an *asset*, so
    summing today's KTC or ADP over the players somebody held then is a real
    number and the one a rewind is usually opened for — it is how a trade is
    judged after the fact. `REWINDABLE_METRICS` is that set, one set read at both
    grains, since a team's column is the sum of the player column beside it.
  - **A key is not rewindable until it is named there**, which is the direction
    the default has to fail in: a metric added to either catalogue that quietly
    read today's numbers under a past date is invisible on screen, where an em
    dash is not.
  - **The refusal is gated *before* the catalogue's own null path, and that is
    not belt and braces.** `proj` with no outlook already says "No projection",
    which is true of a league nothing could be projected for and misleading about
    a moment that cannot have one. So the hover here says to press `Now`, which
    is the thing a reader can act on. `TeamMetricContext.team` went nullable for
    the same reason one layer down — there is no standings row at a past moment,
    and `pf` says so itself rather than being handed a fabricated one.
  - **The selection is the panel's own, under the panel's own stored keys**, so
    "the columns the current view shows" holds by construction rather than by a
    prop somebody has to keep threaded — and aiming a column here aims it there,
    since both write one entry. The headings open the same `ColumnsEditor` the
    panel does, which is what keeps the app's rule that a heading is the only way
    to aim a column: a reader whose columns are all blank at this moment is one
    press from two that answer.
  - **The blanks are explained once, under both halves, and only where there are
    any** (`timelineColumnNote`) — the `N of M` rule again, since a line saying
    every column is fine would be a permanent band on the plate. It names the
    columns rather than counting them, because "Proj and Bench" is what a reader
    can act on where "2 columns" is not.

  What it costs, stated rather than discovered: the two tables' *defaults* are a
  projection and a record apiece, so a reader who has never aimed a column sees
  four em dashes and the note. That is the honest answer — this app stores no
  price history and no past standings — and the note is what turns it into a
  next step.
- **An open league card is one screen: pulled to the top, capped there, and
  scrolling inside itself** (in two places — see the bullet after this one). The
  panel is several hundred rows in a deep dynasty
  league, so left to run it pushed its own card's head off the top of the screen
  and the rest of the list several screens down. Four pieces hold the correction
  up, and each is easy to undo by treating the cap as styling:
  - **Which league is open lives in `ManagerLeagues`, not in the card.** Opening
    one is a claim about the whole page — the card takes the screen, and the
    heading rail pinned above it drops its fade because the card is now flush
    against it — and two cards making that claim at once is two things each
    asking to be the thing being read. So it is one id, and opening a league
    closes the one before it. It is also **read against the filtered list during
    render** rather than trusted: narrowing the filters can take the open league
    off screen, and an id pointing at a card nobody can see would leave the rail
    dropping a fade for a panel that isn't there.
  - **The scroll is `scrollIntoView` against a `scroll-mt`,** so the chrome's
    height is the browser's arithmetic rather than a number read at runtime — the
    app bar plus the heading rail pinned under it, whose own height is the app's
    one runtime measurement (`--list-ledge-h`, published by the rail) because
    the rail takes a second line below `sm`. And only on *open*: closing scrolls
    nothing, since reversing a scroll the reader didn't ask for is how a list
    loses its place.
  - **The panel takes no `flex-1`.** A flex item's default `0 1 auto` is what
    makes a short panel — one still loading, or a shallow league — exactly as
    tall as its contents while only an overrunning one shrinks into the cap and
    scrolls; `flex-1` would stretch every open card to the full screen whatever
    it had to say. `min-h-0` is what allows the shrink at all, and the card's
    head is `shrink-0` because the league's name is what says which panel this
    is.
  - **The cap is `svh`, and the box under the head repeats the card's radius.**
    `svh` is the viewport *with* the browser's own chrome showing, which is the
    only unit that keeps the promise on a phone; `dvh` would grow and shrink the
    card as that chrome hides, which on a scrolling panel reads as the page
    fighting the finger. That box clips, so without `rounded-b-xl` the last
    roster row paints square across the card's rounded corners.
- **What scrolls under that cap is each half of the panel, not the card's
  contents.** One scroll box over the whole panel is the obvious spelling and it
  takes the wrong things with it. The tab strip is the only way back to whichever
  of the panel's two readings is not on screen, so scrolling the roster carried
  the way out of the roster off with it; each half's column headings are what say which metric its value
  columns are pointed at, so a list past its own heading is a column of
  unlabelled numbers — and those headings are what open the columns editor, so
  the panel's only controls were the first thing to leave. And the two lists are wildly unequal
  (a forty-row roster beside a twelve-team table), which is the case for
  scrolling them separately rather than together: finding a player took the
  standings with him. Four things hold it up:
  - **It is a height chain, not an `overflow` class.** Card → animation wrapper →
    clip box → panel → body → the grid → each half → its own list, and every link
    is `0 1 auto` with `min-h-0`. Nothing is `flex-1`, which is what keeps a short
    panel exactly as tall as its contents; `min-h-0` at each link is what lets an
    overrunning one shrink, since a flex item's floor is its own content
    otherwise. A single missing `min-h-0` anywhere on that chain doesn't error, it
    just puts the scrollbar back on the page.
  - **What the *holder* owes that chain is a bound, not a scroller — and there
    are two holders now.** Everything above the panel in that list belongs to the
    leagues list's card, which supplies the bound by capping itself at the
    viewport; the trades board's `LeagueSheet` is the second, and a `<dialog>` of
    a fixed height supplies it with `min-h-0 flex-1` and nothing else. The
    tempting spelling there is an `overflow-y-auto` body, which satisfies no
    `min-h-0` below it and quietly returns the panel to one long scroll carrying
    the strip and both heading rails away with it — the failure this bullet is
    about, arrived at from outside the panel rather than inside it. A holder
    scrolls nothing; it says how tall.
  - **The grid holding the two halves needs `grid-rows-[minmax(0,1fr)]`.** A bare
    `1fr` row is `minmax(auto,1fr)`, and that auto minimum is the taller half's
    full height — the row refuses to be smaller than the list it is supposed to be
    scrolling, so the panel overruns the cap with no scrollbar anywhere.
  - **A heading cannot live inside the box it scrolls.** It is the only thing
    naming a column of bare numbers *and* the way to change one, so carried off
    the top it takes both with it. The standings' heading row was already above
    its `<ul>`; the roster's were inside each section, drawing the same two labels
    twice for one shared selection, so they are one `ColumnRail` above the scroll
    box now — the leagues list's own rule about naming a list-wide selection once
    above the list. The rule used to rest on a second argument that has since
    expired — a picker's menu was absolutely positioned, so a scroll box clipped
    it and scrolled it away from its own trigger — and it is worth knowing the
    argument outlived the menus: **the reason to hoist a control is that it names
    what is under it, not that its popup would be clipped.**
  - **What stays fixed is what qualifies the numbers.** The standings' week range
    is a footer outside its scroll box, and the outlook caveat sits outside both;
    the roster's value footnote and draft picks scroll *with* the list, because
    they are its tail rather than a note over it. `overscroll-contain` moved onto
    the two lists with the scrolling, so a flick at the end of either doesn't
    carry on into the page behind the card.
- **The header is one plate whose four corners are readouts, and it got there in
  four moves worth reading together.** It was one card stacking
  identity, the season, the record and both control pills, which on a phone was
  ~590px of a 700px screen — the controls wrapping onto their own lines because
  they shared a flex row with the season. The first move split it by what a thing
  *is*: a milled identity plate, and a recessed dock under it holding the
  triggers. The second retired the dock, because once the board's trigger went up
  into the app bar it was a ~50px trough seating a single control — and this card
  was *pinned* at the time, so that was 50px of league rows covered on all three
  tabs for a part pressed once a session.

  **The third move took the key off this plate on the manager tabs, and what it
  says about the two before it is that they were solving the wrong problem.**
  Both were about finding the key a *cheaper* home; neither asked whether the
  plate was its home at all. Three of the plate's four corners are readouts, so
  the one control on it was seated among facts — and the subject rail directly
  below was already a filter row with an obvious hole at its leading end. The
  key leads that rail now (see {@link SubjectRail}), the plate keeps its three
  readout corners, and the 16px the seat cost — 12 of body padding, 4 of overhang
  margin — goes back to the list this card was, at the time, pinned over.

  **The fourth move deleted the seat, and the lineup checker is why.** That page
  was the last one in the corner — one list, no subject rail, nothing else to
  seat a key on — and it grew the same rail, at which point the corner had no
  user and the third move's argument applied to it too. So `SEATS.corner`,
  `FilterSeat` and the `filters` prop are gone, and `bodyPadding`/`statePadding`
  are constants: both were a branch on whether a lit key had to be held clear of
  the readout above it. **What the seat is worth remembering for is the two rules
  it kept**, either of which a future part seated in this plate's edge would have
  to keep again. *A control that looks like content is one nobody presses* — the
  plate's corner tabs are wells because they are readouts, so the key was raised,
  and the obvious simplification (a third tab cut into the edge) would have been
  the card telling you to read its filter. And *the plate keeps `overflow-hidden`
  and a raised part has to live outside it* — the clip is load-bearing (the rail
  and the sweep are square boxes drawn against rounded corners) and `.lab-chip`'s
  wall is a `box-shadow` the clip would cut, leaving a part with no thickness,
  which is exactly what a pressable part must not be. Two things still hold:
  - **The plate's height is the same in September as in December.** The record
    bar keeps its empty rail when nothing has been played: the rule arrived while
    the card was pinned, where its height was list rows covered, and it survives
    the card letting go of the top for the plainer reason that a header growing a
    row as the season turns over moves the whole list under it. The transient
    state line is the one thing allowed to grow.
  - **The material says which part is which**, the same raised/recessed grammar
    as the app bar: the plate is a milled face (a specular sweep, the cyan rail)
    and its corner tabs are wells because they are readouts. Every corner is a
    well now, which is what makes the rule easy to break by accident — the next
    part added to this plate has to ask which of the two it is before it picks a
    material.
- **The season corner steps, and it is the one control this plate may carry —
  because a season is the page's *population* rather than a filter of it.** The
  four moves above end with every corner a fact and every control on the rail
  below, and that rule is about *filters*: the league rules say what a league is,
  the subjects say who is in it, and both narrow leagues the page already holds.
  Stepping the season re-keys the leagues stream itself and every read hanging
  off it — rosters, membership, ranks, KTC, ADP valuation — which is the standing
  the ADP drawer already gives the same word ("the season is the board's
  population; the window is a cut inside it"). So the corner that has always
  *named* the season is where choosing it belongs, and it is not the filter seat
  this card spent a while regretting. Eight things hold it up:
  - **The well stays the readout and the two steps are raised keys riding in
    it**, which keeps the grammar rather than bending it: `.lab-well`'s own note
    already describes that arrangement ("used for the bar's current-page chip
    **and as the trough a raised part sits in**"), and it is `.lab-slider` one
    scale down — recessed because it is read, raised because it is grabbed. What
    would have broken the rule is a tab-shaped well you press.
  - **A ladder, so a stepper** — the trades board's circle and the lineup
    checker's week, arrived at a third time from the same argument: what is being
    chosen is a position on a line, so `‹` and `›` are the two presses the
    question has. No pips (a year is its own pip strip) and no menu (a list of a
    decade of years is a list where every entry but two is a place nobody is
    going). `stepSeason` owns both bounds and answers null, so a key with nowhere
    to go is drawn inert rather than silently re-selecting the season showing;
    the ceiling is the app's own season (a league year Sleeper has not rolled
    over to holds no leagues for anybody) and the floor is
    `FIRST_SLEEPER_SEASON`. It **fails closed** on anything that isn't a
    four-digit year, because Sleeper answers an unknown season with an empty
    league list — which reads as "this manager has none" and is the one wrong
    answer here that looks like a working one.
  - **The keys clear the plate's chamfer by construction.** `.lab-notch-all`
    takes a 9px diagonal off this exact corner and `clip-path` clips a whole
    subtree, so the tab's own `pl-3.5` starting them 14px in is load-bearing: any
    further left and a lit face is sliced, leaving a part with no thickness,
    which is the one thing a pressable part must never be.
  - **The plate is one height for both spellings.** The keys are 22px against the
    bare digits' 20, so the body's top inset is a constant `pt-6` rather than a
    branch on whether a page draws a stepper — a card that is two heights
    depending on its props is the layout shift the reserved caveat lane and the
    empty record rail already exist to refuse.
  - **`seasonParam` is what keeps three tools on one cache entry.** The routes
    default an absent `?season` to `getActiveSeason()` and `managerQueryKeys`
    files it under `"default"`, so the current season has two spellings that mean
    one thing and key differently — and the pick tracker and the lineup checker
    read the leagues stream with no season at all. A manager tool that always
    named its season would file the identical answer under a second key and a
    reader crossing between the tools would pay for the account twice: the same
    drift the lower-casing of `searched` exists to stop, one segment along. So
    the current season sends nothing and a *past* season, which is a genuinely
    different selection, gets its own entries.
  - **The whole page moves together or it lies.** The season is resolved once, in
    `useFilteredLeagues`, and threaded into the stream, the two shares reads, the
    ranks, the KTC values and the ADP valuation — plus `publishManagerLeagues`,
    so a new revision invalidates *that* season's dependents. A league list from
    one season beside rosters from another is the failure with no error and no
    wrong-looking number, only wrong rows.
  - **It is a fourth provider, keyed per manager**, beside the league filters,
    the subjects and the ADP board — not a field on `LeagueFilters`, which is the
    type the trades board runs over leagues it has no account for and where a
    manager's viewing season means nothing. The ceiling comes from the layout's
    single `await getActiveSeason()`, handed to this store and the board's alike
    so the two cannot disagree.
  - **`SubjectView.seasonRead`, not `season`, and the rename is the point.** The
    lineup checker's view already carries the season its *payload* came back
    with, for display; this is the season its *requests* ask for. Different type
    (`string | null` against `string | undefined`), different meaning, so
    different names — sharing one would have made the collision a matter of which
    file you were reading.

  What it costs, stated rather than discovered: stepping to a season this
  manager has never been synced for is a cold foreground fan-out, so the page
  shows the ordinary cold-load screen — which now names the season, since
  otherwise a press that starts a minute of syncing looks like a press that did
  nothing. The stepper is not drawn on that screen: it belongs to the plate, and
  a second spelling of it standing alone would be one control with two shapes.
- **The plate's record readout is where the filter bar used to be.** The two rows
  of segment buttons are behind a modal (`LeagueFiltersModal`, which is that
  panel's other host) whose trigger has
  moved twice since — into the dock beside `AdpTrigger`, into this plate's own
  bottom edge when the board went up to the app bar and the dock followed it out,
  and finally off the plate altogether on the manager tabs, to the head of the
  subject rail — and the space they freed carries the manager's season across the
  filtered leagues: a dial for the win percentage, a proportion bar for the wins
  and losses behind it. The `Rostered` cell that used to stand in a rail of its
  own is folded onto the record's line, since how many of the leagues on screen
  carry a record is that record's denominator and a population-derived number
  travels with its population. Four things that look like polish and are not:
  - **The record is summed over `filtered`, not over the account.** That is the
    point of putting it next to the filters — "how am I doing in my dynasty
    leagues" is a different question from "how am I doing", and both are one
    click apart. `LeaguesViewLayout` memoises it so the header renders numbers
    rather than deriving them.
  - **It is counted over leagues that *carry* a record, and the count is stated
    only where it is a shortfall.** Membership without a roster arrives as
    `record: null` (the same Sleeper quirk that would deflate a player share), so
    `aggregateRecord` returns the contributing count alongside the totals — a
    denominator smaller than the list is only honest if it is stated. But it
    usually isn't smaller, and "116 of 116 leagues" is a denominator restating
    its own numerator on a line that has to stay short, so the two agreeing is
    left unsaid and only `record.leagues < leagueCount` is written out. The rule
    holds exactly where it means something. What the account holds is a fact
    about the account, so the leagues count itself is a pill on the identity line
    beside the season — which is also where each tab's own headline count (`stat`)
    now sits.
  - **No games and `.000` are different answers**, so `pct` is null rather than
    zero and the dial draws an em dash before kickoff. Preseason every league
    reports `0-0-0`; a win percentage there is a claim about games nobody played,
    while the `0-0` itself is a true count, so the record line shows the digits
    even then. Only filters that leave no records keep their own words — a `0-0`
    counted over nothing would be quoting records that don't exist.
  - **The state line carries a live countdown to the season's opening kickoff,
    drawn as a segment readout, and the instant is Sleeper's word before it is
    ours.** It holds the slot the headline count used to, and that swap is the
    plate's own trade: before kickoff the count is a constant and the clock is
    the only moving number on the card, so the moving one gets the instrument
    and the constant goes up beside the name. The cells are milled wells — the
    dock's material at a smaller size — one per unit with the unit spelled
    underneath and the seconds lit, each fixed-width and zero-padded
    (`countdownSegments`) so the row ticks in place rather than reflowing; the
    row narrows only when a unit empties for good. `formatCountdown` is the
    *join* of that primitive rather than a second calculation, which is what
    lets the group carry the string as its `aria-label` while the cells are
    `aria-hidden` — split across four elements they would be read as four
    numbers. Past kickoff the slot says "season underway" instead of emptying,
    since the state line is fixed-height for the same reason the record bar
    keeps its empty rail. `useKickoff` asks
    `/api/kickoff` (the schedule call's earliest week-1 `start_time`); the NFL
    calendar table's `firstKickoff` — the regular season's start date at the
    traditional 8:20 PM ET slot, explicitly provisional — stands in only when
    Sleeper hasn't scheduled the season, which is the same spring window the
    table's own dates are provisional in. Nothing renders until that question
    settles, so the timer appears once with the right instant rather than twice
    with two. It ticks on the reader's own clock (the `todayIso` side of the
    two-todays rule), starts only after mount (the account store's hydration
    rule, applied to a clock), and past kickoff renders nothing rather than a
    zero — the interval retires itself too, so a header left open across
    kickoff stops re-rendering a hidden timer. **That whole trade is about the
    record beside it**, so a page whose record is already live before kickoff
    passes `countdown={false}` and keeps the dial — see the lineup checker,
    above.
  - **A modal hides its own state, so the state is repeated outside it — when
    there is a state to repeat.** The trigger wears the count of active filters
    and the record line names the selection in words (`filterSummary`, lower case
    because it is read mid-sentence), beside the number those filters scope.
    Both come from the same option table the dialog's buttons do. The summary is
    passed as `null` when `activeFilterCount` is zero rather than falling back to
    its own "all leagues": that default is the *absence* of a selection
    describing itself, and it sat permanently on the plate for the sake of the
    narrowed case. Each option in the
    dialog also carries how many leagues it would leave, which is why the
    selection is edited as a draft and committed on Apply: those counts can't be
    read while the list behind them moves.
- **The league filters are a season band, three fixed rails and three lists of
  rules the reader writes.** Status, type and format describe what a league *is*,
  and stay closed sets of three to five answers. How it is configured, what its
  lineup starts and what its scoring pays are not closed sets, so they are rows —
  `teams ≥ 10`, `trade_deadline ≤ 12`, `QB+SF ≥ 2`, `IDP = 0`, `rec = 0.5`,
  `bonus_rec_te > 0` — each a settings key, a slot group or a `scoring_settings`
  key, a comparison and a number, added with a `+` and removed with an `×`. They
  replaced four fixed pairs (superflex/one-QB, IDP/offense, the reception bucket,
  TE premium), which were four hard-coded questions out of a space readers arrive
  with their own question in: "no kicker", "three flexes", "half PPR with a TE
  bonus over half a point". One dialog, so the trades page's league filter gained
  the rules with it — and, later, the ADP board's.

  **The season is the one filter here that is not an attribute of a league**, and
  it is seated accordingly: a band above the trough with a lit leading rail, not
  a fourth row in it. It is the *population* the rest are read against — the ADP
  drawer's own rule ("the season is the board's population; the window is a cut
  inside it") one control over — and filed as a peer a reader reads it as a
  fourth attribute and never notices that changing it swaps the corpus out from
  under every count below. It is a `LeagueFilters` field like any other, so
  `activeFilters` names it and the rail clears it; the band is a seating decision
  and not a second mechanism. **It draws nothing where there is only one season
  in hand**, which is every caller but the ADP board's widest setting — those
  resolve a season server-side, so the row would be one key, permanently lit,
  reporting a fact rather than offering a choice, which is what every other row
  in this panel was shortened to stop doing. Its options come off the leagues in
  hand (`seasonOptions`), so it turns on by itself the day a caller widens its
  fetch. Making it *do* something on the manager tabs is a route change and not a
  dialog one: `/api/user/[username]/leagues` answers one season, and
  `manager_league_order` is keyed per manager *per season*.

  Seven things worth keeping:
  - **The four old chips survive as quick-adds that write the equivalent rule.**
    `qb+sf ≥ 2` *is* `isSuperflexLineup`; the preset is the one-click path and
    the row is what you edit it into. A preset already on the list is dimmed
    rather than hidden, so the row doesn't reflow as it's used.
  - **A slot group is a predicate derived from the solver's tables, never a
    list.** `QB+SF` is `QB_ELIGIBLE_STARTING_SLOTS` — the same slot walk that
    picks a league's KTC board — `IDP` is `IDP_SLOTS`, `FLEX` is the multi-position
    slots that take neither a QB nor a defender (so `WRRB_FLEX` and `REC_FLEX`
    count as flexes without being named), and `Starters` is "not a bench slot",
    which has to keep counting a slot spelling this build has never seen. A new
    flex therefore counts the moment the solver learns it. The slot tables live
    in `league-filters/defaults.ts` and come in relatively with an explicit `.ts`
    extension, since the package is tested.
  - **Null and zero are different answers, per rule.** `k = 0` means "leagues
    without a kicker", and a league whose `roster_positions` were never synced is
    not evidence of one — an unknown lineup fails a slot rule rather than reading
    as zero. A key *absent from a stored* `scoring_settings` is 0, though, because
    Sleeper omits what a league doesn't pay for: that is exactly what makes
    `bonus_rec_te > 0` the TE-premium question. A missing blob is unknown again.
  - **Comparisons carry an epsilon.** A passing yard is 0.04 and a reception 0.5;
    `rec === 0.5` is one binary representation away from reporting that a half-PPR
    league doesn't pay half a point.
  - **The scoring key menu is read off the leagues in hand**, the way the trades
    page's menus are read off the trades — what a league pays for is a house rule,
    and a fixed list would offer keys nobody scores while hiding the one someone
    wants. `COMMON_SCORING_KEYS` only *ranks* them, and is the fallback on a cold
    load. A rule's own key is always an option in its row, since a preset can name
    a key no league in view scores and a `<select>` whose value is absent from its
    options silently shows a different one.
  - **The Complete status is the complement of the live ones, not a match on
    `"complete"`.** An end-of-season spelling this code doesn't know would
    otherwise be visible in the total and in none of the buckets, which reads as a
    filter losing leagues.
  - **The settings list arrived as `size` and widened into the blob, which cost
    nothing structural.** That board had its own `All sizes / 10 / 12 / 14`,
    which can only ask for an exact count — where "at least ten teams" is the
    question a reader arrives with as often, and a *band* is `teams ≥ 10` **and**
    `teams ≤ 12`, which is one of the things the lists being an AND is for. So it
    was a rule list from the start, and widening it to the rest of Sleeper's
    `settings` was a key menu and a reader: the blob already crosses the wire
    whole (`ManagerLeague.settings`) and was being read for exactly two fields,
    so the bay costs no route change, no migration and no payload growth. It is
    one bay at full width above the other two rather than a third equal column —
    it is the bay a reader builds three rules in, and a rule row at a third of
    the panel could not hold `Trade deadline · = · No deadline · 24 · ×` without
    truncating the key it is named by. (The scoring bay lost its second word with
    it: `Scoring settings` beside a bay called `Settings` is one word doing two
    jobs.)
  - **The key menu is read off the leagues in hand, exactly as the scoring keys
    are.** How a league is configured is a house rule, and a fixed list would
    offer keys nobody sets while hiding the one someone wants. `SETTING_KEYS`
    only *ranks and names*: an unranked key is still offered, spelled with its
    underscores opened out and read as a plain quantity, which is what makes the
    bay safe to ship without a survey of the corpus. Two keys are dropped
    outright (`NON_SETTING_KEYS`): `type` and `best_ball` are the Type and Format
    rails four inches above, and a second way to ask one question is the failure
    this codebase keeps closing — `type = 2` as a rule with Redraft lit on the
    rail is an empty list with nothing on screen saying which control emptied it.
    Only numbers are offered, since a rule is a comparison against one.
  - **`teams` is the one key not in the blob**, reading `total_rosters` off the
    league row — so it is always offered, and it keeps the null rule with a
    wrinkle of its own: **zero is unknown, not a real size**, since Sleeper
    always reports it for a live league. A 0 is a row stored before the league
    answered, and `teams < 10` sweeping in every such league is the `k = 0` trap
    one bullet up.
  - **What an *absent* key means is read per key, and cannot have one rule.**
    Sleeper omits what a league doesn't set, so a count or a flag missing is a
    real `0` — `taxi_slots` absent is no taxi squad, `disable_trades` absent is
    trades enabled — which is `scoringValue`'s rule and the reason
    `bonus_rec_te > 0` is how TE premium is asked. A **week** has no zero on its
    scale, so absent there is unknown and fails the rule rather than reporting
    week 0. `SettingKey.absent` is that decision, declared per key; an unranked
    key reads as `"zero"`, the common case. A whole missing blob is unknown for
    every key.
  - **There are three value kinds, not two, and the third is the interesting
    one.** A *quantity* (teams, slots, budget) gets a number field and every
    comparison. A *label* — a key whose numbers are names, `disable_trades` and
    `pick_trading` — gets a value menu and only `=` / `≠`, because `>` on an enum
    is a question with no meaning and `disable_trades = 1` is a rule a reader
    cannot check. A *quantity carrying a sentinel* needs **both controls at
    once**: `trade_deadline: 99` is Sleeper's "no deadline", so `≤ 12` has to
    stay typeable while 99 stays reachable. `settingValue` reads the sentinel as
    **null**, or `trade_deadline ≥ 13` answers "leagues that trade late" with
    every league that never stops trading — a filter returning the wrong rows
    rather than an error, and the same shape as the `total_rosters` of 0 above.
    Unlike that zero it is a *known* answer rather than an absence, so it is also
    **reachable by name**: `isSentinelRule` matches it by identity, the row draws
    it as a lit key beside the number field (lit, it *is* the value and the field
    stands down), and the chip reads `trade deadline is no deadline` rather than
    quoting 99. Both halves are needed — null alone makes it unaskable, name
    alone leaves the comparison lying.
  - **Where a `values` table is a reading and where it would be a guess.**
    `disable_trades` and `pick_trading` are flags whose own names say which way
    they read — a `disable_*` at 1 is disabled — so naming them costs nothing.
    `waiver_type`'s 0/1/2 is an *ordering*, which the key's name does not carry,
    so it stays a quantity until somebody has read the stored blobs. A quantity
    is never wrong here, only terse; a wrong name is a filter that lies. That is
    also why there is no waiver quick-add: a chip states its rule as a fact.
  `roster_positions` crosses the wire for this — it is what `settings` doesn't
  carry and the rules count over, which is also what retires the note on
  `seedFromLeague` that superflex had to stay manual for want of it. `IDP_SLOTS`
  is still not `DEFENSIVE_SLOTS`: nearly every league starts a team defence, so
  that set says nothing about what game a league is playing while starting a
  linebacker does, and the wider set still gates the projections caveat.
  `deriveScoring` stays in this package — the filters no longer bucket anything,
  but it is the bucket `/api/adp` groups by, `adp-controls` re-exports it, and
  `seedFromLeague` writes its `rec` rules *as* that bucket's two bounds, since
  `features/shared` can't import a feature.

  **A caller may seat a fourth segment row in the trough, and exactly one does**
  (`ExtraSegment`). The ADP board's draft-kind chip is not a fact about a league —
  how many rounds a room ran is a fact about the room — so it must not become a
  `LeagueFilters` field that two other pages inherit and cannot use; seating it
  in the panel instead is what makes that board's filters one control rather than
  a control and a stray chip. It rides the same draft/apply contract as everything
  else in the panel, and it carries **no per-option counts**: it cuts drafts
  inside a league rather than leagues, so every option would show the identical
  league count and that number would be about something the row does not narrow.
  `FilterRail`'s `probe` is optional for that reason alone. **It is the row and
  not the commit** — label, options, and what Reset returns it to, with the draft
  and the write left to the host, because that host writes this row and the
  filters into one stored object and a callback of its own is how one of those
  two writes silently reverts the other.

  **It is six modules and not one file** (`types`, `defaults`, `predicates`,
  `summaries`, `options`, `breakdown`, behind a barrel). It was one, at 640 lines
  mixing the types, the option tables, the matching rules, the summary strings,
  the menu builders and the breakdown counts — six audiences for one import. The
  arrows all point at `types`, which depends on nothing, so a component that only
  threads the state around imports an erased module; `trade-query` takes
  `predicates` and no option tables; and the dialog — which is dynamically
  imported and off the first-paint bundle — is the only thing that pulls in all
  of it. Two things went with the split: `activeFilterCount` counts without
  building the labels it never reads (it is on every render of two headers, and
  on the trades page it decides whether a request is narrowed at all), and
  `leagueBreakdown` counts its four rows in **one** pass rather than four, which
  matters because the trades page counts them over a whole season's leagues and
  re-counts on every keystroke in the rules editor.
- **Narrowing by *who is in a league* is a third selection, and it is deliberately
  not one of those rules.** "Leagues holding this player" and "leagues shared with
  this manager" are the two questions `LeagueFilters` cannot express, and the
  reason is structural rather than a gap: every filter in that package is a key,
  a comparison and a number read off the league's own settings, and its predicate
  is the one the trades board runs over a whole season of leagues it has no
  account for. Owning a player is `rosters[league_id]` and sharing a league is
  `members[league_id]` — lookups a `ManagerLeague` doesn't carry and that page
  could never satisfy. So `features/shared/subjects.ts` is pure and separate from
  that package, and the narrowing runs **after** `matchesFilters` — in
  `useFilteredLeagues` for the manager tabs, in `useLineupView` for the lineup
  checker.

  **Where the selection is *held* is the page's business, not the rail's.** The
  manager tabs keep it in `SubjectFiltersProvider`, a third store beside the
  league filters and the ADP controls, because three routes share one selection;
  the lineup checker keeps it in `useState`, because it is one page. That is why
  it reaches the shared parts as a value on {@link SubjectView} rather than
  through a context: a shared part that read the provider directly would be
  choosing a mounting strategy for both of its callers. Five rules in it:
  - **A subject is not a rule, so the control is a search that leaves tokens
    behind** — there is nothing to compare a name to, and there are several
    hundred of them. One field over both kinds, grouped in the results: they are
    the same question, and two fields would make a reader pick which one they
    meant before typing a name that exists in only one. It stays capped at eight,
    because it is the door for a reader who already knows the name they want.
  - **The second door is a sheet, not a taller panel** (`player-shares-sheet`).
    The names worth narrowing by are mostly the ones held everywhere, so the
    *Player shares* key opens the whole ranked list — but a floating panel can
    only say a name and a count, which is the table the Players tab was before
    its columns were pickable. So the browse *is* that tab's list, over the page
    it narrows: `ShareList` → `ShareCard` → `MetricColumns` on the same persisted
    `share` selection, the same catalogue, and the league filters key in its
    title bar (`seat="bar"`) — every row's share is out of the leagues the other
    filters leave, so narrowing there rewrites every number and reorders the list
    under it. Six rules it keeps:
    - **The list is windowed, and that is what makes the browse openable at
      all.** A hundred-league account rosters several hundred distinct players,
      and this used to mount a `ShareCard` for every one of them synchronously —
      four metric cells and two controls each, every one a gradient, a shadow and
      its own `backdrop-filter`, inside a dialog that is itself
      `backdrop-blur-xl` — while the sheet lazy-loaded the ADP apparatus and
      started two reads. Mobile WebKit answered by discarding the page and
      reloading it. `ShareList` reads the well through `SharesScrollProvider` and
      draws a window (measured 10–16 cards of 420 at every viewport, flat with
      depth); with no provider — the two manager tabs — it draws every row
      exactly as before, which is why the box arrives as a **context** rather
      than as a prop threaded through a render prop (a ref passed into a call
      during render is a ref read at a moment React has not promised is current,
      and its own lint rule says so) and never by `querySelector`. Four details:
      heights are **measured**, since a card expands into its leagues, and
      `SHARE_ROW_ESTIMATE` is only what the scrollbar believes beforehand; the
      key is the row's **domain id**, so a search that reshuffles the list cannot
      hand an expanded card's height to whoever now sits at that index; the gap
      is the virtualizer's own `gap` option and not padding, because a share card
      *is* its `<li>` and padding would land inside the visible surface; and the
      offset is `top` and not a transform, since an inline `transform` outranks
      `LIST_ROW_HOVER`'s own lift. Which rows are **open** moves up to the list
      for the same reason the measurements are keyed that way — a card that
      scrolls out unmounts, and a remounted collapsed card laid out in an
      expanded card's slot is a blank gap followed by a jump.
    - **`LIST_ROW_SURFACE`'s blur is `sm` and up**, which is the belt beside
      that. A `backdrop-filter` is a live composited texture rather than a paint,
      and below `sm` these rows sit on an *opaque* well — so there is nothing
      legible behind one for the blur to have been softening, and everything that
      makes the card read as glass (border, gradient, inset highlight, shadow,
      sheen) is unchanged at every width. The sheet's own frame keeps its
      `backdrop-blur-xl`: that is the blur that says the page is still underneath.
    - **Counted over `leagueFiltered`**, like the menu it replaces: the numerator
      is what you picked, the denominator is what you picked it from.
    - **A row press picks; the chevron expands.** `ShareCard` splits its one
      target only when `onSelect` is passed, so the tabs keep the whole-row
      expand — a press nine times out of ten is the pick, and a card whose own
      mark did nothing would be worse than two behaviours.
    - **The glass is spent on the frame.** A translucent panel is the one new
      material here and it is what says the page is still underneath; the rows
      sit on an opaque well, because four numbers read over a drifting league
      list is what the effect must not buy.
    - **`onClose` tests its target.** The filters modal and the columns editor
      are dialogs *inside* this one, and React walks its own tree for `close` —
      which doesn't bubble in the DOM — so an unguarded handler closes the sheet
      whenever a reader dismisses either of them. Everything else about the
      stacking (top layer, Escape innermost-first, presses inside a nested dialog
      never reaching this one's box) is the platform's, which is why this is a
      `<dialog>` and not an overlay.
    - **`showModal()` throws, so it is never called bare** (`shared/dialog-open`,
      pure and tested). It throws on a dialog already open non-modally, on one
      detached between the press and the effect, and by absence on an engine that
      never shipped it — and the call is inside an effect, where a throw is an
      uncaught error in a commit that React answers by unmounting to the nearest
      boundary. On a route with none that is the page blanking on the press meant
      to open the sheet, which is indistinguishable from the crash above.
      `openDialog` returns an outcome instead and falls back to the non-modal
      `open` attribute — the same panel without the top layer, which beats a
      dialog nobody can open. Nothing navigates or reloads.
    - **Autofocus is a fact about the pointer, asked of the platform**
      (`shared/pointer`, `(pointer: fine)` — never the user agent string). On a
      mouse the field takes the focus, because the sheet is opened to be typed
      into. On a finger, focusing a text field *is* raising the software keyboard
      — over a sheet sized in `vh`, on top of the list the reader came to scroll
      — so the panel takes it instead, on a `tabIndex={-1}` that is a place to
      put the focus and not a tab stop. Unknown answers *false*: autofocus
      withheld from a desktop reader costs one click, where autofocus given to a
      phone costs the list.
  - **Each sheet is latched in from the *press*, never from the render body**
    (`shared/sheet-latch`). The two browses are separate `dynamic()` chunks and
    mounting is what downloads one, so which have ever been opened has to be
    remembered — and it was remembered by an `if (…) setMounted(…)` while
    rendering, which is a render-phase update: opening a browse re-ran the whole
    rail synchronously before React committed anything, in the frame already
    carrying a `<dialog>` mounting, two chunks evaluating and two reads starting.
    As a fold called from the handler the latch and the open are one batched
    update. It returns the *same array* on a no-op, or every press would
    re-render the sheet that is not being opened; and `closeSheet` clears only
    its own kind, since a sheet closing is the last thing that happens on the way
    out of it and a flat `null` would cancel whatever had just been asked for.

    **The same correction has since been made everywhere else that latched**, so
    read this as the rule rather than as one sheet's story: the trades board's
    search panel and ADP drawer, the manager tabs' drawer, and the columns
    editor's own `useColumnsEditor` all spelled it `if (open && !everOpened)
    setEverOpened(true)` in the render body. `features/shared/use-latched-
    disclosure` is the boolean case of `sheet-latch` — `open`/`mounted` with
    `show`/`hide`/`toggle` that set both in one batched update — and
    `useColumnsEditor` keeps its own hook only because its open state is *which
    slot* rather than a flag. What made those worth fixing is where the second
    pass landed: pressing a heading re-ran a hundred-odd league cards, four
    metric cells each, synchronously before React committed anything, in the same
    frame as a `<dialog>` mounting and its chunk evaluating. **A render-body
    latch is legal, so nothing catches it — the tell is a `setState` reached from
    the render body whose condition is "has this ever been true".**
  - **Null and false are different answers, exactly as `slotCount`'s are.** A
    league whose rosters were never synced is not evidence a player is absent
    from it, so `holdsSubject` returns null and a rule against it *fails* rather
    than passing on an assumed empty. A league present and empty — a pre-draft
    roster — is a real false, the same distinction `playerShares` counts around.
  - **This is the one list that earns `all`/`any`.** The league rules AND because
    each narrows on an *attribute*; these are subjects, where "Bijan or Chase" is
    asked as often as "both" — the case `TradeFilters.match` already makes, down
    to defaulting to `all`.
  - **Two filtered lists, because the menus are counted over the wider one.**
    `leagueFiltered` is after the league filters and before the subjects, and it
    is what `subjectOptions` counts over: a menu counted over its own selection
    collapses to that selection the moment anything is picked and cannot be
    widened again without being cleared.
  - **While the maps load the list is empty, not unnarrowed.** A page that showed
    all 121 leagues under "owns Bijan" and then dropped to 19 would have answered
    the question wrongly first. The two payloads are the other tabs' resources
    behind a shared cache, fetched when the panel opens or a subject is selected —
    both naming the same query keys, so the two gates cost one request.
- **The manager's three views are a switch above the rail, and what it replaced
  was not a control but the absence of one.** Leagues, Players and Leaguemates
  are three *routes* and always have been — three entries in `tools.ts` with a
  `pattern` and an `hrefFor` apiece, which the tools grid and the app bar's menu
  already read. On the page there was nothing: the only way between them was the
  menu, behind a press, in a list of seven. What stood in for them were the
  subject rail's two shares keys, 10px pills at the trailing end of the filter
  row — and those open a **picker** over the list you are already on and have
  never gone to either view. So the two most valuable readings of an account
  were named by the least prominent parts on the screen, by parts that did not
  go there.

  That is the diagnosis the mockups converged on and it is worth keeping,
  because "make the buttons bigger" was the request and would not have fixed it:
  the keys were not too small, they were **seated among controls that narrow and
  named a destination they did not have**. Six things hold the answer up:
  - **Raised means press me, recessed means you are here, and that is the whole
    of the state.** The two you can go to are `.lab-billet` blocks — a wall
    running down *and* right, graded lit-corner to dark, which is the strongest
    "separate object" mark the app owns and the same block the ADP trigger
    wears. The one you are on is the same box with the face cut away, and the
    current cell is a `<span>` rather than a link to itself: a part that does
    nothing when pressed must not travel under the finger. No "active" tint is
    doing any work here, which is what makes it legible before it is read.
  - **`.lab-seat` is a fourth member of the sink family, not a reuse of the
    third.** `.lab-well`, `.lab-readout` and `.lab-trough` exist separately
    because a shadow does not scale, and the switch adds a fourth scale:
    `.lab-readout` is tuned for a 28px countdown digit and at the switch's 43px
    read as a *tinted box* rather than a cut — measured against the two blocks
    beside it, which is the only comparison that matters, since "you are here"
    here means lower than those. Deeper sink, a fill that falls away from the
    light, a hard black lip on the top edge (light dying on a cut's near wall is
    what says the face was removed rather than darkened), and the hairline a
    step brighter than the family's, because on this one the ring is carrying
    state. Found by rendering it, not by reading it — the entry beside this one
    on sampling pixels, third instance.
  - **The three cells are one height, and that is arithmetic.** A raised cell is
    its face plus the 5px it stands on; the sunk one has no wall and takes those
    5px back as padding, 2 above and 3 below. One number on both and the tops do
    not line up, which reads as three parts seated wrong rather than as one
    switched. 5px rather than the bar's 6px because thickness falls with count
    and this is three of the heaviest part in the app on one line, under a
    header plate that is already a lit face.
  - **The cells are intrinsic at every width, and equal thirds is the thing that
    was tried and reverted.** Thirds of 354px is 110px, which clips
    "LEAGUEMATES" to "LEAGUEM…" — a tool's own name reading as broken, where the
    truncation rule only ever licensed clipping a field whose *content varies*.
    Measured at 390px the three come to 312px of 354, so they fit with 26px to
    spare and `flex-wrap` is the honest failure for a width that does not: a
    name on its own line, never one cut inside a word. What a phone loses is the
    22px glyph seat and nothing else — the labels never contract, so the glyph
    is not what tells one key from another — and the 3px lit rail **stays**,
    being the mark that says which cell at exactly the width the sunk material
    has least room to say it alone.
  - **The key that stays says the act, not the list.** With the switch above
    naming Players and Leaguemates, the rail's two keys contracting to those
    same words was one word on one screen meaning two things. They read "Browse
    players" / "Browse leaguemates" now and contract to "Browse" alone, which is
    what they always did — open a picker over the list you are on. This is the
    lineup checker's rail too, where it is simply the more accurate label.
  - **`usePathname` is typed `string` and answers null off the App Router**,
    which reached `isToolActive` as `.split` on null. `ViewSwitch` reads the
    router and folds it; `ViewSwitchRow` takes a string and draws. That split is
    the thin-I/O-wrapper rule applied to routing, and it is what lets the two
    claims a compiler cannot make — which cell is sunk, and that the links go to
    the **searched** manager rather than the connected one the menu resolves —
    be a test rather than an assertion in a comment.

- **On the leagues page that switch is two keys and no third cell, because the
  other two views are drawers down either side of a list that never leaves.**
  The entry above put the three routes on the page; this is the next step, and
  it is a change to what the other two *are* rather than to how they are drawn.
  Players and Leaguemates already existed twice over — as routes, and as the two
  shares browses the rail's keys opened over the leagues list, which are the
  matching tab's own list with the same four pickable columns and the same
  league filters. So the leagues page now draws exactly two keys, they are
  buttons, and what they open is the browse: Players from the left edge,
  Leaguemates from the right, with the league cards still on screen between
  them. `ManagerViewDrawers` is the row; `LeaguesViewLayout` takes it through a
  `views` slot whose default is still `ViewSwitch`, so the two routes that
  remain are unchanged.

  Five things hold it up.
  - **The Leagues cell going is the point, not a saving.** A switch draws the
    view you are on as a cut-in seat — a cell that says "you are here" and does
    nothing when pressed, which is honest when the three are three routes and is
    a cell spent on nothing the moment the other two stop being somewhere to
    leave by. What is left is two keys, both of which do something, over a list
    that is always there.
  - **The browse became a side drawer, and the list beside it is the whole
    argument.** Centred at 1180px the sheet covered the page it narrows edge to
    edge on every laptop, so committing live — a row press narrowing the league
    list behind the glass — was a claim a reader had to take on trust and then
    close the sheet to check. Anchored at 46rem the cards are next to it, still
    scrolled where they were left, visibly going as subjects are picked. 46rem is
    a column budget rather than a taste: 432px of that is the four stat columns
    at `sm:w-24` in the app's 18px rem, and what the sheet's padding, the well,
    the card's insets, the chevron and the avatar spend around them leaves the
    name 204px — measured in headless Chromium against the compiled stylesheet,
    per the rule two entries up. On a 1280px laptop that leaves ~450px of cards.
  - **Which side is the *kind's* fact, not the door's.** The two variants declare
    it (`SharesSheet`'s `side`), so a browse opens in the same place whichever
    key was pressed, and *which* browse is up is legible from the geometry before
    a word of it is read. The four things that follow from a side — the margins
    that pin the dialog, the corners and wall it keeps, the shadow's direction
    and the keyframe it arrives on — come off one `SIDES` table, because getting
    one of them from the other side is a panel sliding in through its own wall
    and three of the four are invisible in review. The keyframes are named by the
    edge (`drawer-in-left`, `drawer-in-right`) rather than by the part, and the
    ADP drawer's own were renamed onto them.
  - **The rail gives its two Browse keys up here, and only here.** They open the
    identical drawers; one thing behind two pairs of doors forty pixels apart
    reads as two different lists until one of them is opened. `SubjectRail`'s
    `browse` is false on this page and default everywhere else — the two routes
    that remain, and the lineup checker, where the rail is still the only door.
    The seam before the keys goes with them, since a groove parts two groups and
    one with nothing on its far side is a rule.
  - **The row is derived from the tools catalogue, not from a list of two.** A
    manager view that is a ranked list of subjects says which (`Tool.browses`),
    and the row is the views that said one — so Leagues is *absent* rather than
    filtered out by name, and a fourth view joins by declaring what it browses,
    exactly as it joins the switch by joining the group. The names, glyphs and
    order stay the catalogue's, and the keys are the switch's own cells to the
    class (`VIEW_KEY` and its neighbours, exported rather than retyped): a reader
    crossing from the Players route back to Leagues should meet the same part,
    not a second part shaped like it. The state behind both doors is one hook,
    `useSharesBrowse`, holding the latch that keeps each browse's chunk split.

- **The league filters lead that rail, which is what makes it the page's filter
  row rather than one of two.** The key was machined into the header plate's
  bottom-right corner — 20px, the smallest type on the card, under the countdown,
  diagonally furthest from the list it narrows — and what made it hard to find
  was its *company* rather than its size: it was the one control among three
  readouts, while the row below already asked the sibling question and had a hole
  at its leading end. The two are applied one after the other in
  `useFilteredLeagues` and the plate's scope line has always named them in that
  order, so the row now reads in it: **what these leagues are · who is in them ·
  what survives.** Five things hold it up:
  - **They stay two controls, not one dialog with two tabs.** A league rule is an
    attribute of the league (`qb+sf ≥ 2`); a subject is a person or player in it.
    One dialog over both would suggest a single selection, which is the same
    argument that keeps the ADP board a third control elsewhere again. What is
    shared is the *surface* — which is what a reader was looking for.
  - **`SEATS.rail` is the two shares keys' exact box, and it reaches past shape
    to do it.** Every other seat differs only in the edge it meets, because
    everywhere else the key is the only part of its kind in view; here it is the
    first of three on one milled face, so it takes their 10px type, their padding
    *and* their `.lab-chip-sm` wall. A key standing a pixel prouder than its
    neighbours is the same fault as a corner key that overhangs.
  - **`.lab-chip-on.lab-chip-sm` is what keeps that true when it lights.**
    `.lab-chip-sm` thins the wall and `.lab-chip-on` re-declares it, and the lit
    rule is the later of the two — so every small chip in the app stood proud the
    moment it started narrowing something. Written as the intersection, it
    outranks both, so neither has to move. It fixes four call sites that already
    had the flaw and were never noticed, which is the tell for how a row hides
    it: one part seated wrong reads as a state.
  - **A seam parts the groups, not spacing.** The row wraps below `sm`, and
    spacing does not survive a wrap — the same reason the count and the two doors
    are one flex item. `RailSeam` is that groove written once, since the row now
    has two of them.
  - **The count is against the account, not the league-filtered list.** With one
    control on the rail, `N of M` named a population stated nowhere on screen;
    with both, the denominator is the whole account and the numerator is what the
    two leave between them — one number answering the row it is on. Unnarrowed it
    is the bare total, since a denominator restating its numerator is the thing
    the plate keeps having to relearn.
- **That control is a `.lab-slab` of its own above the heading billet, and it
  spent a while as a second storey *of* that billet — which is the cheaper
  construction and the wrong one here.** The economics of the storey are real and
  still hold where they apply: a separate part costs its wall, its cast shadow
  and the clearance holding its lit face off the rail's lit face — the same 20px
  the plate's filters key gave back by seating flush in its corner — and one
  billet pays those once. What that argument leaves out is what the two rows
  *are*. Two storeys are the same material at the same width with a 1px seam
  between them, so a control over the list read as part of the table's own head,
  and stacked under the pinned plate it made the header three lit faces deep.
  The headings name what a row **says**; this names which rows there **are**.
  **Reach for a storey when the second row is saying the same kind of thing as
  the headings, and pay for a part when it isn't** — the shares sheet still takes
  the storey (`ColumnsBar`'s `storey` prop), because there its tokens name the
  rows the list is about and there genuinely is one header.

  Six things hold the split up, and three of them were caught by *rendering* it
  rather than by reading it:
  - **The material is the separation, and the slab is what it is for.** A wall
    running down *and* right, graded from a lit near corner to a dark far one,
    brushed face, chamfers on all four corners against the billet's two — nothing
    else in the page's header has a wall on two sides. It wears `.lab-slab-fixed`
    because it is a **surface holding controls, not a card**: `.lab-slab`'s lift
    and brightening bloom belong to a part you press, and a rail that rose under
    the cursor would promise a press that lands on whatever chip is under the
    finger. That class is declared after `.lab-slab:hover` on purpose — both are
    one class and one pseudo-class, so they tie on specificity and source order
    decides, and moving it up silently restores the lift.
  - **A corner-lit gradient is a claim about a box's shape, and it degenerates
    off that shape.** `.lab-slab-face` fills at 168°, and the gradient line for
    an angle over a w×h box is `|w·sinθ| + |h·cosθ|` — ~382px over a 1700×34
    rail, so the three stops resolve inside the leading fifth and 1300px sit flat
    on the last one. Worse, the bottom falloff (`inset 0 -20px 38px -22px`) is a
    soft shading over the last sixth of a 150px card and over **half the height**
    of a rail. Measured, the far end came out at rgb(11,21,31) against a page of
    rgb(10,20,30): a face indistinguishable from its own ground, with the two keys
    at that end appearing to float off the part. `.lab-slab-face-rail` re-lays the
    fill horizontally in percentages (so it scales with the part) and scales both
    falloffs, keeping the three 1px bevel lines untouched — a specular edge is 1px
    whatever the box is. **Sample the pixels rather than trusting the class**: this
    was invisible in review and obvious at rgb().
  - **The search trigger takes `.lab-channel`, not the heading rail's
    `.lab-ledge-slot`.** A cut is read against the face it is cut into: that one
    is tuned for the ledge's *light* face and gets lighter towards its bottom,
    which is a deep slot there and a raised sliver on a face this dark.
  - **The clearance is the point rather than spacing.** The slab's own wall is
    6px, so `gap-3` between the two parts leaves ~18px of ground under a lit face
    before the billet's begins. Below that they read as one crowded instrument
    again, which is what splitting them was for.
  - **The search panel is outside the slab, and it has to be.** `clip-path` clips
    a whole subtree, so the chamfered face would cut off anything floating under
    the rail — the panel is a sibling, in a `relative` wrapper that is otherwise
    the billet's own geometry so the two parts share a left edge. It is `z-40`,
    which is a window rather than a spare number: it hangs *down* over the
    heading billet, which pins itself at `z-30` while the list scrolls under it,
    and it stays below the app bar's `z-50`. This is the same
    rule `ListLedge` owns its wrapper for.
  - **The row wraps rather than compresses**, and the caption goes below `sm`.
    At 390px a caption, a token, a trigger and the count do not fit one line, and
    a nowrap row pushed the count off the end of the part. Everything in the row
    is content, so it takes a second line down there; the caption is the one part
    a phone can lose, since the trigger reads "Player or leaguemate" until
    something is picked.
  - **The search is the row's only channel; the two shares keys are raised
    pills at its trailing end.** All three were `.lab-ledge-slot` in one adjacent
    run — same material, same size, no divider — which is a segmented text input
    in every respect a reader judges by, so the two doors onto a whole ranked list
    were being offered as somewhere else to type. The fix is the app's own
    grammar rather than three parts told apart: a channel is what *becomes* a
    field (this trigger does, a frame after it is pressed) and a pill is what
    opens something (`lab-chip lab-chip-sm rounded-full`, the ADP drawer's
    smallest key, borrowed rather than reinvented). **Material and seating are
    two halves and only one survives a phone.** The seating is real — the count
    and the two keys all describe the *population* where the field is the reader's
    own input, the argument that put the ADP block beside Tools — but the row
    wraps down there and the two ends become two lines, so material is what
    carries it at the width the confusion is worst. The seating has one
    consequence worth spelling: they are **one flex item**, because `ml-auto`
    resolves per flex line, and loose they sat right on the first line and hard
    against the *left* of the second.

  Two knock-ons worth keeping. **The headings are what's conditional, never the
  rail** — `ColumnsBar` takes `headings`, and the tab decides, because what
  counts as a row is the tab's grain (leagues here, shares on the other two).
  With the filter its own part, no rows now means *no billet at all* rather than
  a storey-only one: a heading rail with nothing to head and no control on it is
  a lit face saying nothing. What must not come back is this slot **swapping
  between two different trees** as the list narrows — that is what it did before,
  and remounting the control closed the search panel on exactly the press that
  emptied the list. And **the
  plate's scope line names both selections**, since the record beside it is summed
  over the list the subjects leave — a line naming only the league filters would
  be labelling a number counted over something narrower than it says.
  `subjectSummary` falls back to counting ("1 player") rather than printing a raw
  Sleeper id while the names are still loading.
- **The filters dialog is a bay layout with a readout rail, and the two halves
  fix different failures.** Stacked — three segment groups, then the two rule
  lists — the rules fell below a 60vh scroll box, so a reader who wanted
  "superflex leagues that pay a TE bonus" scrolled past everything they *didn't*
  want to reach the control that asks it, and the feature read as missing. The
  fixed filters are facts about a league and compress into one trough; the rule
  lists sit under it, which on a laptop puts every rule and every quick-add tray
  on screen at once. Five things worth keeping:
  - **A fixed filter is a rail with every option's count on it, and the collapse
    that stood between was a correction of the layout rather than of the
    control.** Three captions and thirteen keys stacked as three *sections* was
    ~290px of a 700px phone — the same crowding the bay layout was fixing, one
    layer in — so the rows were collapsed to a summary and a popover. What that
    got wrong is that a caption and its options on **one line** is shorter than
    the collapsed row was (118px against 124 on a laptop), and the collapse cost
    the thing the dialog is opened for: the counts. Behind a press they were
    three of thirteen, and comparing two of them meant two presses and two panels
    that could not be on screen together. Every `probe` closes over the draft, so
    a trough of rails is a **live cross-tab** — lighting Dynasty moves the Format
    row's numbers underneath it, which is exactly what the popovers were hiding.
    The phone pays ~120px for that and the bays still open above the fold, so the
    failure that produced the collapse does not come back.
    **The rails are rails at every width**, which is the half most likely to be
    "simplified": a collapsed row on a phone and a rail on a laptop would be two
    different controls either side of a breakpoint, the mistake the league cards'
    own per-card column labels were removed for. What legitimately changes at a
    width is geometry — the keys wrap after the caption.
    Four behaviours went with the popovers and are owed by nothing now: the
    one-open-at-a-time state, the outside-press dismissal, the focus return, and
    the `preventDefault` on the dialog's own `cancel` that made Escape close the
    innermost thing that was up. Escape is the platform's again.
  - **The rail is beside the controls, not under them.** The match count was a
    line of footer text next to Apply, and it is the number the whole dialog
    exists to move — it changes while you edit, and a number you have to scroll
    to is a number you check once. So it is a readout with a meter against the
    account it came out of, and the footer restates it only below the width where
    the rail is stacked (same `matched`, so the two can't disagree).
  - **The chips are the selection restated outside the controls that built it.**
    That matters most for the rules: a settings rule and a scoring rule live in
    different bays, so a reader who narrowed to nothing otherwise has two lists to
    audit. A settings chip reads the *sentence* the row shows rather than the
    digits underneath it (`trade deadline is no deadline`, not `= 99`), off the
    same table the row renders from — a chip a reader cannot check is the whole
    reason those keys have names. Each strikes itself out in place, which is what `clearFilter` is —
    and it addresses a rule by **position**, since two identical rules are
    indistinguishable and "remove the matching one" would be ambiguous.
  - **`activeFilters` is one walk, and the count, the summary and the chips are
    all derived from it.** They were three walks over the same fields, which is
    three chances for a filter added above to be counted and not named, or named
    and not removable. Its labels are already lower case, because the summary
    reads mid-sentence and a chip beside it saying "Dynasty" would be the same
    selection under two spellings.
  - **The breakdown rows are filters, not predicates.** `leagueBreakdown` counts
    each row with `matchesFilters`, so "Superflex 17" is by construction the
    number the superflex quick-add would leave — and it inherits the null rule
    for free, an unsynced lineup failing the row exactly as it fails the rule.
    It is counted over the *matched* list, since the rail's question is what you
    just narrowed to and not what the account holds.
  The one thing that reliably regresses here is that a **dimmed quick-add is
  drawn flat where a live one is a raised key**. That is the app bar's grammar
  held to at the smallest size: a part that does nothing when pressed must not
  look pressable, so the already-added state loses its wall rather than only
  dimming its text.
- **`SiteHeader` is the only global chrome, and it is four zones: the mark
  home, the page you are on, one seat the page fills, and every tool.** Every tool is reached by navigating
  away from `/tools`, which used to leave the back button as the only way home;
  the slim bar in `app/layout.tsx` closes that loop. It hides itself on `/tools`
  — the wordmark and the whole tool list *are* that page — which is the whole
  reason it reads `usePathname` and therefore the whole reason it is a client
  component. Its container matches `PageShell`'s so the wordmark lines up with
  the content under it. It is **pinned**, so the way home is reachable from the
  bottom of a several-hundred-row list and not only from the top; its height is
  `--site-header-h` (a variable, not padding) because a list's heading rail pins
  itself directly underneath and has to know where this ends.
  **It carries a route list now, which this note used to forbid.** The old rule
  was that a second navigation system competes with the first; what it produced
  instead was `/tools` as a mandatory waypoint between any two tools, since the
  bar's single link home was the only way out of one. `ToolsMenu` is not a second
  system — it is the *only* one, the tools grid reached without the round trip,
  read from the same catalogue that grid renders (which is why `tools.data` moved
  to `features/shared/tools.ts`, with `features/tools` re-exporting it under the
  usual mover's rule).
- **The bar's middle zone states where you are; it does not switch.** It held
  `ManagerTabs` — Leagues, Players, Leaguemates — and that was a second way to do
  what the menu already does, since those are three of its six entries. So the
  component is gone, the bar's `children` slot with it, and what sits there is the
  tool's own name from `activeTool(pathname)`: one claim, from the catalogue, so
  the label and the menu's highlight cannot disagree. **Null is a real answer** —
  `/manager` is the username search and belongs to no tool, so the bar names
  nothing rather than guessing. The cost is real and was the trade asked for:
  Leagues → Players is two presses now instead of one.
- **The seat beside it is the one place a page may put a part in the chrome, and
  it holds a control rather than a link.** That is what keeps it from being the
  second navigation system the note above spent two paragraphs retiring: the ADP
  block opens a drawer belonging to the tool you are already in, and pressing it
  moves nobody anywhere. **It sits at the bar's trailing end, immediately left of
  the tools key** — grouped with it in one `ml-auto` wrapper. It used to sit with
  the page chip on the leading side, on the reasoning that a page's own control
  belongs with the page's own name and the two navigation parts should hold the
  ends; what that produced was a bar with a hole in the middle and the one thing
  you press on most pages the furthest thing from the thumb already reaching for
  Tools. Adjacency to the *hand* beat adjacency to the *idea*. The bar owns
  *where* the part goes and nothing about what it is —
  `HeaderSlotTarget` is an empty flex box with a `data-header-seat` hook, and the
  only thing the bar asks about its occupant is whether there is one. Two rules
  ride on that question and both are easy to undo. **The seat takes exactly one
  occupant per route**, which is a layout's job where a tool spans several routes
  (the three manager tabs fill it once, from
  `app/manager/[searched]/layout.tsx`, rather than three racing to) and the
  page's own where a tool is one route (`/trades`, from `TradesHome`). Read the
  rule as one-per-route and not as "a layout must do it" — filling it from a
  component that mounts twice is the failure, wherever that component lives; and the wordmark's text hides below `sm` **only
  when the seat is filled**, since a mark, a wordmark, one chip and the tools key
  fit a 390px bar and a fifth part does not — with the block in and the wordmark
  out, "Leagues" is spelled in full where it had truncated to "Le…". That is the
  `:has()` query the tabs' removal retired, brought back for the same arithmetic
  and this time asking about a seat rather than about a slot of tabs. It is
  written as one `max-sm:group-has-[…]` utility rather than as `hidden` against
  `sm:inline`, because those two collide: Tailwind v4 emits the display utilities
  alphabetically and `.inline` beats `.hidden` at every width.
- **A tool's `pattern` matches by prefix and the first match wins, so catalogue
  order is load-bearing.** `isToolActive` compares segment by segment and accepts
  a longer pathname, which is what makes `/picktracker` name the tool while you
  are at `/picktracker/[leagueId]`. Nothing nests today — the six patterns are
  disjoint — but the moment one is a prefix of another (`/trades` beside a
  `/trades/*` detail tool, or a broad `/manager/*` beside the three view
  patterns), the broader one silently wins every match if it is listed first, and
  the symptom is a bar that names the wrong tool rather than an error. Put the
  more specific pattern earlier, and remember the same list drives the menu's
  order on screen — the two are one array on purpose, so a reorder for matching
  is also a reorder for the reader.
- **The bar is machined, not glass, and the material has a grammar: raised means
  press me, recessed means you are here.** The tools trigger is a raised keycap
  that travels its own thickness on `:active`; the current-page chip is a
  recessed well; the icon tiles are moulded. Break that pairing and a label
  invites a press that does nothing. Eight things in `globals.css` hold it up:
  - **A `.lab-*` class carries material and never layout**, and it is in
    `@layer components` so a utility beside it wins. Both halves were learned the
    same way. `.lab-face` used to own `display: flex` and `width: 100%`, so a
    browser holding a copy of the stylesheet from before the redesign — a stale
    dev chunk is enough, and one survived a server restart here — laid the tools
    trigger out as an inline box at *min-content* width: the glyph, the label and
    the chevron stacked three rows deep, the keycap burst out of a bar with no
    height for it, and every other part centred against the wreckage. That is the
    whole of the "app bar is broken" report. Layout now comes from the same
    utilities as the rest of the page, so the same missing stylesheet costs the
    machining and nothing else. And unlayered, these rules outranked every utility
    on their own elements, which had quietly eaten the wordmark's hover glow and
    its inset — the call sites had been writing `group-hover:[filter:…]` into a
    void.
  - **A key sizes itself off its face, never the reverse.** The face carries the
    box (`w-[34px]`, or the label's own padding) and the wrapper shrink-wraps it,
    so no part of the bar is a percentage of a box that is itself sizing to
    content — the construct engines disagree about, and the one that collapsed to
    min-content above. The face is also the flex row rather than the `<button>`,
    since a form control is the element engines disagree about as a flex
    container, and it is `whitespace-nowrap`: the failure worth making impossible
    is contents stacking in chrome that cannot grow to hold them.
  - **`clip-path` cuts a `box-shadow` off.** A notched part cannot cast its
    shadow or glow with `box-shadow` at all — `filter: drop-shadow()` applies
    after clipping and follows the notched silhouette, which is why `.lab-key`
    reaches for `filter` and why a "simplification" back to `box-shadow` silently
    deletes every shadow in the bar.
  - **Thickness is a stacked layer, not a shadow.** Wrapper is the dark side
    wall, child is the lit face, the wrapper's `padding-bottom` is how thick the
    part is. That is also what makes the press animation free: swap the padding
    to the top and the face meets the wall.
  - **`.lab-billet` is a block rather than a face — the one part with a wall on
    two sides.** Every other part extrudes 3px straight down, which reads as a row
    lit from directly above and is what keeps them from competing; the ADP
    trigger is the bar's one control belonging to the *page*, so its wall runs
    6px down **and** right, graded from a lit near corner to a dark far one with a
    hairline contact shadow under it. The thickness is the whole point and the
    thing to resist trimming: at 3px a wall is a line and its colour is
    decoration, at 6px it is a face you read the shading of, which is the
    difference between an object sitting on the bar and a rectangle drawn in it.
    Four details are load-bearing and each is a way of getting it wrong. The
    chamfer is `.lab-notch-all` on **both** layers — a wall that turns two corners
    shows a square one wherever the clip doesn't follow it. The press is a
    `transform` and not the padding swap, since the part travels along both walls
    at once and there is no padding on the side that would say so (which is why
    the reduced-motion block cancels it beside `.lab-chip`'s). The face carries a
    specular sweep, the manager plate's device held to a 34px part, which is what
    makes it read as metal rather than as a gradient. And the narrowed state
    lights the bars in `.lab-channel`, never the face: the bar keeps exactly one
    fully lit key, and that is Tools. **`.lab-channel` is where the depth
    actually lives** — a slot cut into the face with the light catching its far
    wall, the bars raised in it with their dark sides falling the same way as the
    block's own. Its bars' three heights stay at the call site, since they are
    data (the shape of a board) and a class cannot carry three of anything.
  - **The bar's extruded edge is drawn *inside* the header box** (`--bar-edge-h`,
    counted into `--site-header-h`). As an outside shadow it would be covered by
    a list's heading rail, which pins at exactly that offset.
  - **The plate is tinted glass, and the blur is what makes that safe.** It was
    opaque, on the reasoning that a surface with visible thickness can't have
    page content showing through its extrusion. What that bought was a flat band
    cut across the top of the ambient aurora, which is fixed behind every page
    and is most of what makes the app read as one product. So the two gradient
    stops carry an alpha and the bar carries `backdrop-blur` — the blur is the
    load-bearing half, since it diffuses the rows scrolling underneath into
    colour rather than legible content, which is the failure the opacity was
    actually preventing. The stops are still dark enough to hold the bar's text
    on their own where `backdrop-filter` is unsupported, the same out the
    glass-and-blur bar before it relied on. The extruded bottom edge stays
    opaque: it is the part that reads as thickness, and a translucent side wall
    is what would look like a rendering bug.
  - **`.lab-chip` is that grammar off the bar**, for a control that stays a
    rounded pill: nothing clips it, so its side wall can simply *be* a shadow
    (`0 3px 0 var(--edge)`) and the whole part is one element rather than the
    wrapper-and-face pair `.lab-key` needs. It obeys both halves of the first
    rule — material only, inside the layer — so a chip that loses its stylesheet
    is a plain pill rather than a control that resizes. Two page triggers share
    it — the league filters and the trade filters — plus the ADP drawer's own
    keys, which is the
    point of putting it in `globals.css` rather than in one of them:
    `LeagueFiltersModal` renders on two pages, and one control with two looks is
    exactly the drift a shared class prevents. Its one unlayered rule is the
    reduced-motion override, which has to outrank the layered `:active` it
    cancels. **`.lab-chip-sm` is the same pill at half the thickness**, worn
    *with* `.lab-chip` and overriding only the wall and its press travel:
    thickness is how a secondary press says so, which the filters' quick-adds
    need because they sit in a bay whose segment keys are full height and a tray
    of five parts at that height reads as five more filters rather than as the
    one-click path to a rule. It is declared after `.lab-chip:active` so its own
    press wins.
  - **`.lab-slider` is that grammar for a continuous control** — the ADP drawer's
    value curve: a milled slot with a raised key riding in it, recessed track
    because it is read and raised thumb because it is grabbed. Two things it
    teaches. A range input is styled through **per-engine pseudo-elements that
    cannot share a selector** — one unknown pseudo-element voids the whole rule,
    so WebKit's and Firefox's are written out twice even where they are identical,
    and a "deduplication" of them silently deletes the styling in one browser.
    And `appearance: none` is what unhooks the native widget while carrying no box
    of its own, so the material-only rule still holds: the width and the layout
    come from utilities at the call site.
  - **`.lab-trough` / `.lab-plate` / `.lab-row` are that grammar at *panel*
    scale** — the expanded league detail. The panel is one milled instrument: a
    plate holding a recessed field (the standings, which is read) beside a raised
    one (the roster, which is acted on), with the selected team a lit key rather
    than a tinted row. Three things it teaches that the chip-scale classes don't.
    **A shadow doesn't scale**, which is why the trough is not `.lab-well`:
    2px/5px of inset reads as a slot on a chip and as flat paint across a 400px
    table, and the sink is the whole signal. **A part seated in another has to
    catch more light than what it is seated in** — `.lab-plate-sm` lifts the
    face as well as thinning the wall, where `.lab-chip-sm` only thins, because a
    chip is ranked against a page and this one against the same face it is made
    of; a thinner wall alone left the two reading as one surface with a seam.
    And **thickness has to fall with count**: `.lab-row` runs a 2px wall and no
    outer bloom, since a dozen chip-thickness parts stacked 4px apart read as mud
    rather than as a dozen parts. The lit row is the one part in the family that
    does *not* travel on press — pressing the selected team selects it again, so
    it is the raised spelling of the app bar's current-page well.
    The knock-on inside the components is that **a dimmed cell on the lit face
    can't ask for a shade of `foreground`**: on cyan that is a shade of the wrong
    colour, so the rows switch to plain `opacity-*` rather than carrying a second
    palette of on-cyan text tokens that would have to be kept in step with the
    face above them.
  - **`.lab-bezel` / `.lab-gauge` are that grammar at *token* scale**, and the
    one part in the app that stacks two recesses. The bezel is a trough milled
    into the trade card's face; each gauge is a window sunk into that trough's
    floor. Three things it teaches. **Down twice is how a run of facts becomes an
    object without becoming a control** — the app bar's block is the same idea
    inverted (a part standing off the surface with a channel cut into it), and
    raising this one would be six apparent presses per card across a windowed
    list of forty thousand. **A housing that carries a caption cannot be a bare
    trough**: the floor is deliberately lighter than `.lab-groove`, because 6px
    type on near-black is a caption nobody reads, and the sink comes from the
    inset shadow and the lit lower lip instead. And **what stands a cut off its
    face is the depth of the sink and the lit lip at its far edge, not darkness
    in the fill** — a darker floor alone is a darker patch of the same surface.
    A worked surround (a dark hairline above the recess, a brighter line below,
    a contact shadow — the lip a real milling leaves) was drawn and then taken
    off: it reads, and it is more than one part per card in a windowed list of
    forty thousand needs. One lit line under the cut is what is left, and it is
    the recess's own exit edge rather than a lip around it. Reach for the sink
    and the lip before the surround; darkness *outside* a cut is how it starts
    reading as a border.
  - **`.lab-ledge` is that grammar carrying a heading rail**, and it is the one
    place the bar's material left the bar: the stat columns' headings are a
    machined billet the list scrolls *under*. It is `.lab-key`'s construction
    (wall wrapper, lit face, `.lab-notch-lg` on both) at a rail's width, for the
    plain reason that a heading here is a **trigger** — pressing one opens the
    columns editor armed on that slot — and four flat labels over a list read as
    a caption instead. Three details it teaches beyond what a key already
    teaches. **A chamfer is three stops, not an inset line**: a hard specular
    pixel, a bright band, then the face falling away — one `inset 0 1px` reads as
    a border, which is what the labels used to be. **A groove is a dark cut with
    a lit far wall**, and the two halves live in different places on purpose: the
    cut is the call site's `divide-x`, because a border changes the box and the
    cards' own columns spend the same pixel (drop it and every heading after the
    first sits one pixel left of the number it names, four unevenly shared
    below `sm`), while the lit wall is an inset highlight in the class. And the
    **hover lights the part, not the label** — a column that answers the cursor
    with a colour change alone is text, where a lit surface is a part.
    **The face is lighter than the rows it heads, and each heading is cut into
    it (`.lab-ledge-slot`) rather than painted on it.** Both halves fix one
    complaint — the rail read as a grey band between the filter dock and the
    first card — and the first half is the cause: the face used to end at
    `#0c1c29`, *under* the page ground and well under the cards' lit glass, so a
    header darker than its own content read as a gap between sections whatever
    weight its labels were set in. Keep the darkest stop above the ground colour.
    The second half is `.lab-channel` at heading scale, for the reason that class
    exists: at 10px a label lying on a surface is text, and the same label in a
    milled slot is a part — which is what a heading has to be here, since
    pressing one opens the columns editor. The slot is what the *hover* lights
    now, not the cell around it: with the label in a channel the channel is the
    control, and washing the face beside it would light the one thing that
    isn't. Two knock-ons worth keeping. The slot replaced the disclosure caret
    rather than joining it — a channel says "control" without spending two
    characters of a label that has to fit in 76px — and it retired the face's
    two corner **dimples**, which now fall inside a slot's lit lip (the last
    column's at every width, the first column's below `sm`, where the subject
    cell is dropped): a 4px dot inside a channel reads as a blemish on the part,
    not as machining in the face. The slot's inset comes out of the column's own,
    which is why `COLUMN_WIDTH` is split from `COLUMN_BOX` — 6px of cell plus 4px
    of channel lands the label at the same x as the number under it, and a shared
    box owning the inset would have to be overridden by the rail.
  The notch is kept for the small parts and the panel stays rounded (the `H3`
  mockup of three): six rows of 11px text want a calm surface, and nothing else
  in the app has to change its corners to match.
- **The menu's open state is the route it was opened on, not a boolean.**
  Navigating is what a nav menu is *for*, so `openedAt === pathname` closes it on
  arrival as a matter of arithmetic; a boolean would need an effect to notice the
  route changed, which is a cascading render (and what the lint rule objects to).
  It also closes on Escape — returning focus to the trigger — and on a press
  outside it.
- **A tool entry in the bar links where the same card on `/tools` greys out.**
  The grid is where an account is resolved, so a dead card there is a prompt; in a
  nav bar it would be a dead end. Without an account an entry lands on the
  username search the tool starts with, and the panel's account row — avatar and
  `@username`, or "no account connected" — says which of the two you are getting.
  That row is also what makes "Leagues" mean *your* leagues in a menu that never
  names the manager.
- **The wordmark keeps its text wherever the bar has room for it, which is now a
  question rather than a constant.** Three tabs, a mark, a wordmark and a trigger
  did not fit a 390px bar, and the wordmark gave way behind a `:has()` query
  asking whether the slot was filled; dropping the tabs left a mark, a wordmark,
  one chip and the trigger fitting with room to spare, and the query went with
  them. The ADP block spends that room, so the same query is back — asking about
  the header seat instead, and only below `sm`. On every page with an empty seat
  the wordmark reads in full at every width, exactly as the retired rule said.
  The part that yields after it is the chip, which `truncate`s if a tool name
  ever runs long.
- **The four manager sub-resource hooks are one hook, bound four ways.**
  `useManagerPlayers`, `useManagerLeaguemates`, `useManagerRanks` and
  `useManagerKtc` read `/api/user/[username]/{players,leaguemates,ranks,ktc}`,
  and they were four line-for-line copies differing only in the path and the
  error string. They delegate to `useManagerResource` now, with each file keeping
  its name, its result type and a note on what its route is for. The shared body
  is not boilerplate — it carries two rules worth having in one place: every one
  of these resources reads what the *leagues stream* wrote, so the hook takes the
  leagues array and its identity is what re-runs the fetch (a ready flag couldn't
  re-trigger on the second `result` a background refresh sends); and `data` is
  never reset to null on refetch, because blanking several hundred rows to redraw
  them nearly unchanged is worse than a moment of staleness. `useLeagueDetail`
  looks like a fifth copy and is not one: it *does* clear on change, since a new
  league id means the rows on screen belong to a different league, and it tracks
  `loading` because its panel mounts on expand. `useManagerLeagues` is not one
  either — it decodes an NDJSON stream. Two hooks that differ in what they
  guarantee are two hooks.
- **The leagues route lists the leagues you *fielded a team in*, not every
  membership Sleeper reports.** `getManagerLeagues` narrows the `league_users`
  join by `FIELDED_A_TEAM_SQL`: a roster owned now, or — **in a chopped league
  only** — a place in the draft when it happened. Membership alone is not
  evidence of a team — Sleeper leaves you in `league_users` after you stop
  holding one — so a league joined and abandoned arrived looking exactly like one
  being played, and every page downstream counts over this list.
  **A vanished roster means opposite things in the two formats, which is why the
  draft half is gated rather than standing alone.** In a chopped league — Sleeper's
  native guillotine, `settings.type` 3 beside 0/1/2 — being knocked out is that
  game's ending, not an exit, so the league belongs in the list afterwards.
  Everywhere else a vanished roster means you walked away, and an ungated draft
  half kept those leagues forever on the strength of a draft you attended once.
  The gate is `CHOPPED_LEAGUE_SQL`, regex-guarded before its cast like every other
  numeric read off `settings` and falling back to redraft, which is not chopped
  either way. Sleeper models the format natively now, so this is an exact test
  where it used to be an approximation that could not tell the two cases apart —
  and the client's type filter offers **Chopped** as a fourth option for the same
  reason the Complete status is the complement of the live ones: a type visible in
  the total and in none of the buckets reads as a filter losing leagues. Within a
  chopped league both draft signals are read because neither covers the other —
  `draft_order` is null until an order is set (a league can hold rosters with no
  draft yet), and `picked_by` is an empty string on an autopick, so a manager who
  autopicked appears in the order and nowhere in the picks. The knock-on is worth
  stating: a league you left *does* now drop out, and with it its leaguemates.
  **Every read answering "this manager's leagues" applies it**, not just the
  route — `getManagerLeagueRosters` behind `ranks`, `ktc` and `adp-value`, and
  `getManagerLeaguemates` — because a league missing from the list but still
  ranked and priced is a projection solve per team for rows nobody renders, and
  one narrowed read beside an unnarrowed one is two answers to the same question.
  `getManagerRosters` needs no clause: it joins on `owner_id`, which is this
  predicate's first half. Inside `getManagerLeaguemates` the two halves pull
  opposite ways on purpose — which leagues count is this predicate, who counts
  within one is bare membership, so the guillotine leaguemate the page exists for
  survives.
- **That list is in Sleeper's order, and preserving it takes its own table.** The
  order `/user/:id/leagues/nfl/:season` answers in is the order a manager already
  reads their leagues in on Sleeper, so it is the one ordering carrying any of
  their own arrangement — alphabetical threw it away. It is a fact about a
  *manager's enumeration*, not about a league, which is why it can't ride on
  `leagues` or `league_users`: both are replaced wholesale by any sync of that
  league, including the crawler's, which arrives from whichever member came up in
  its queue and knows nothing about whose list the league sits in.
  `manager_league_order` is written by `syncManagerLeagues` (the only place a
  known manager is enumerated) and joined by `getManagerLeagues`, which orders
  `position NULLS LAST, name` — a league the crawler stored before any
  manager-driven sync has no position, and sorting those to the end by name keeps
  the page stable rather than leaving it to Postgres. Two details: the ordering
  is written over **every** league Sleeper listed, before the graphs are fetched,
  so a league whose graph fails this pass keeps its place instead of falling to
  the end of the list; and the wipe is guarded on a non-empty response, the same
  rule the projections refresh follows, since Sleeper's 200-with-null for an
  unresolvable user arrives as `[]` and would silently re-sort the whole page.
- **A player share is out of the leagues that hold a roster of yours, not the
  leagues listed.** They are different numbers — 121 leagues, 113 rosters for the
  account this was built against — because Sleeper keeps you in `league_users`
  after you stop holding a team (a guillotine league you were knocked out of, one
  you left). Counting membership would quietly deflate every share on the page,
  so `playerShares` counts only leagues that contributed a roster, and an empty
  roster (pre-draft) still counts: holding nobody is a real answer.
- **The shares are cards, the same card a league wears.** They were a dense table
  of two fixed numbers — the count and that count as a percentage — while the
  leagues tab beside them carried four pickable stat columns; the columns are the
  point of the change, and a table row 28px tall has nowhere to put them. Both
  numbers are kept and are still what the cards open on: the count is what's
  actually held and compares between players, the share is what it means for a
  portfolio and moves when the filters do.
- **A leaguemate is shared by membership, though a player share is counted by
  roster — the opposite choices on purpose.** The ghost `league_users` rows that
  would deflate a player share are exactly who this page is for: someone
  knocked out of your guillotine league is still someone you know, and dropping
  them because they no longer hold a team answers a different question. So
  `leaguemateShares` (pure, beside `shares`) counts co-membership over the
  filtered leagues, and its denominator is leagues that contributed a member
  list. The manager's own row is *kept* in `members` — every synced league has
  it, so its presence is what separates "shared with nobody" from "not cached" —
  and dropped by the counting, which takes the self id as an argument for it.
  Rows are labelled by `display_name` per the standings rule (recognising the
  same person across leagues is the page), and the list itself is the player
  shares list with a person in the player column: same card, same columns, same
  expansion.
- **Both share views *are* `ShareList`, and a share row *is* `ShareCard`.** The
  card chrome, the stat columns and the expansion were copied between
  `player-shares` and `leaguemate-shares` — only the first column's contents and
  which metrics are on offer ever differed — so they live once and each view is
  now ~30 lines naming its own. What a caller supplies is `icon` (a position pill,
  an avatar), an optional `note` — the dim trailing detail, the NFL team on a
  player row and nothing on a person — the metric catalogue, and its default
  columns. The one asymmetry is `adpFor`: the players view resolves a board entry
  per row for the ADP metrics, and the leaguemates view omits it because its menu
  holds nothing that reads one. `Chevron` and `SharedLeagueRow` remain in `ui.tsx`:
  the standings and the roster panel use them too, so they are atoms rather than
  part of this list.
- **Which metric each share column shows lives in `ShareList`, not in the card** —
  the same rule as `ManagerLeagues` above the league cards, for the same reason: a
  list several hundred rows long is scanned vertically, and per-card columns would
  make it unreadable. `ShareCard` holds only whether *it* is expanded — the
  pickers are in the heading rail, so a card has no menu state to keep — and it
  gives that up too where the list is windowed, since a card that scrolls out
  unmounts and would lose the disclosure with it (see the shares sheet above).
- **The expanded standings are ordered by projected points, not by record.**
  What the panel adds over Sleeper is the projection, so the Proj column is the
  one the rows are ranked on — the numbers descend down the page, and the `#`
  column numbers the same ranking the collapsed card's chip quotes. The record
  isn't lost, it keeps its grid column on every row's second line. The sort
  (`orderByProjectedPoints` in `shared/manager/rank.ts`, pure and tested) is
  stable over the standings order the server sends, so ties, unprojected teams
  and a league with no outlook at all degrade to the standings rather than to a
  shuffle.
- **The panel leads with a tab strip — Standings and Settings — and what it
  replaced was a readout of numbers already on screen.** That band held
  `PanelTelemetry`: a rank dial and two milled cells, projected and on bench, for
  the *selected* team. Each of the three survives the swap in the place it was
  actually read. The rank **is** the standings' own ordering, and every row wears
  it as a tab on its corner, so the dial was a second drawing of the table under
  it. Projected and on bench are two of the metrics that table's value columns
  open on, which the strip's own note conceded ("the overlap with the
  `proj` / `bench` columns is paid on purpose") — a defensible trade while the
  band had nothing better to hold, and not one worth making against a reading the
  app did not offer at all. Five things about what is there now:
  - **Settings answers a question no part of this app answered.** What a league
    pays for a reception and whether it has a trade deadline were facts a card
    could hint at (the trade card's gauges say type, size and the QB/TE slots) and
    nothing could state. It matters most where a reader has no prior knowledge of
    the league, which is exactly the trades board — every crawled league in the
    season, most of them strangers'.
  - **Two columns of one material, because both are read.** Everywhere else in
    this panel the raised/recessed pairing is load-bearing — the standings is the
    field you read and the roster the one you act on — and there is no such split
    between a scoring list and a settings list, so inventing one would say
    something untrue. Both are troughs, each scrolling under its own fixed
    heading, the 50/50 split held at every width the way the two halves beside
    them hold it.
  - **The lit tab is recessed and the other is raised**, which is the app bar's
    grammar rather than a segmented control: "you are here" against "press me",
    the pairing `AdpBayRail` already draws one control over. The rail is
    `inline-flex` for the trade card's bezel reason — a housing that reached both
    walls would have to be filled, and two tabs across a card read as a table
    header.
  - **A head-to-head draws no strip**, on the tabs' own terms rather than as an
    exception: `Standings` would name a table the lineup checker's panel
    deliberately does not have. That is the same gate the telemetry strip sat
    behind, arrived at from the other direction.
  - **The strip is one of two occupants of that band, so the band is its own
    component** (`PanelHead`). It was the strip's own wrapper for as long as the
    strip was the only thing that could be up there, which the bullet above is
    the tell for: the panel with no tabs is exactly the panel the sync key
    belongs to, so a band nested inside the strip would have been a box that only
    existed when the *other* occupant did. `justify-between` plus the trailing
    seat's own `ml-auto` is what holds both ends whichever is drawn, and the
    tablist takes `shrink-0` now that it shares a row — the note beside the key
    is the part written to give way.

    **There are three occupants now and still two ends**, which is the one thing
    to know before adding a fourth: `WeekMedianBar` shares the *leading* end with
    the strip, wrapped in a flex group rather than passed as a third loose child,
    because `justify-between` distributes free space between all its children —
    three loose items put the median somewhere in the middle of the band instead
    of beside whatever leads it. So the band is two slots however many parts are
    in it.
  - **The median is a fact about the week and belongs to neither half**, which is
    why it sits on the band rather than in a roster heading: it is the middle of
    the *whole field*, so seating it on one side would say it was that side's,
    and either side can be over or under it. It is drawn only where the league
    plays one — `median` is null on the week payload for every league without
    Sleeper's `league_average_match`, and *nothing* is drawn there rather than an
    em dash, since an em dash reports a hole in a number and a league whose
    scoring never applies a median has no number to be missing. It is free here
    and only here: this read already solves every team, so the middle of them is
    a fold over `team_projection` (`medianLineups`) where the lineup checker's
    route has to widen its solve to get one.
  - **It states the bar and never the verdict, and it prints the headings'
    reading.** The two headings under it carry each team's own number in the same
    units, so which side of the bar a team falls on is a comparison the reader is
    already making a few pixels away — a `W` beside it would restate two numbers
    both on screen, which is the restatement this panel keeps having to relearn
    (the team plate that named the lit standings row, the prose that named the
    two lists under it). The mark belongs where the numbers are *not* on screen,
    which is the lineup checker's row. That is also why the figure is the
    **optimal** median with `current` on the hover: `RosterHeading`'s own
    arrangement, and a median taken over a different reading from the numbers
    beside it would be three figures on one band that cannot be compared.
    `medianLineups` folds both because neither derives from the other — a median
    is not linear, so the middle of the best lineups is not the middle of the set
    ones plus anything, and the two can sit on different teams.
  - **`median_match` is the one field of `LeagueDetail` the core payload does not
    carry**, and the omission is `league_type`'s rule read backwards: a fact
    crosses when something on the client needs it. This one decides whether the
    week read folds a median at all, and what a reader sees is the median itself,
    which rides on the week payload where null already says "no bar to beat".
    Sending the flag as well would be a second way to ask one question, on the
    response every open of this panel pays for.
  - **It names nothing itself.** Every label, ranking and value name in
    `league-settings.ts` comes from `league-filters` — `SETTING_KEYS`,
    `COMMON_SCORING_KEYS`, `settingKeyLabel`, `scoringKeyLabel`,
    `formatRuleValue`, the sentinel and the named values — so the word a reader
    narrows on is the word this panel prints back. Two readings are the module's
    own and both are the codebase's existing rules read once more:
    - **A stored scoring zero is dropped**, because `scoringValue`'s rule is that
      an absent key is 0 — so a league that omits `rec` and one that stores
      `rec: 0` are the same league, and a list drawing them differently would be
      reporting Sleeper's serialisation rather than the league's scoring. It is
      also what keeps the column from opening with forty rows of nothing.
    - **Three facts lead the settings column because a bare walk of the blob
      answers them badly**: teams is not in the blob at all (the payload's own
      rosters are counted), and `type: 2` / `best_ball: 1` are a filter's
      vocabulary rather than a reader's — so they are named from the rails that
      offer them and the generic run skips exactly those two, which is
      `NON_SETTING_KEYS` read a second time for the same shape of reason. The
      format comes from the payload's `best_ball` (that is `BEST_BALL_SQL`'s
      answer) rather than from the blob beside it, so the panel cannot disagree
      with the board that priced the card it opened from.
- **The trailing end of that band is a sync key, and it is the app's one
  reader-driven write.** This panel is where a lineup is *read* and Sleeper is
  where one is *set*, so the flow it exists for — see the shortfall, go and make
  the swap, come back — ends at whatever the crawler last stored, which in season
  is up to fifteen minutes old. Nothing about the crawl can be tuned to serve
  that: the TTL is a capacity claim over the whole corpus, and shortening it to
  seconds is that corpus times eleven requests a minute for one reader's benefit.
  So `POST /api/league/[leagueId]/sync` re-reads one league on request, through
  `refreshLeague` and then through `syncLeagueGraphs` — the same function the
  manager sync and the crawler's refresh pass call, so a league refreshed here is
  written by the same code, gated on the same stored week tails and reconciled by
  the same guards. Six decisions in it:
  - **It is drawn on a week panel and nowhere else, derived rather than passed.**
    A `week` is what the lineup checker sends and what the leagues list and the
    trades board do not, so a panel that has one is by construction the one
    somebody is setting a lineup in — "a head-to-head draws no strip" read the
    other way. It matters most where it is *absent*: the trades board spans every
    crawled league, most of them strangers', and a key on each of those cards is
    a public control for spending Sleeper budget on leagues nobody here plays in.
    It is deliberately not gated on there being a *game*, since a bye and an
    unsynced week are both weeks a reader may have just changed something in.
  - **Four bounds, and none is redundant** — they are argued together in
    `refreshLeague` because each alone makes the others look like belt and
    braces. The league must **already be stored** (a refresh re-reads the corpus,
    it is not a way to make this app fetch an arbitrary league id). A
    **per-league advisory lock**, blocking, so a second presser gets the winner's
    answer instead of starting a second fan-out — and the only bound of the four
    that survives a second dyno. A **cooldown inside that lock**, so a held-down
    key is not a fan-out per press. And a **process-wide admission**
    (`leagueRefreshAdmission`), because the lock is per league and a hundred
    leagues is a hundred locks that never contend, each holding a pool connection
    across a Sleeper fan-out — the arithmetic `sync-admission` spells out one
    grain up, and exactly what an unbounded public write route would reproduce.
  - **The cooldown is a hammer bound, not a freshness policy**
    (`LEAGUE_REFRESH_COOLDOWN_MS`, fifteen seconds, in `sync-freshness` beside
    the manager gate it mirrors). A window sized like `SYNC_TTL_MS` would refuse
    exactly the press this exists to serve. It stamps `sync_attempt_at` — the
    crawler's own column, reused rather than duplicated — **before** the fetch,
    so a league Sleeper is failing on holds it too, and `updated_at` stays what
    only `persistLeagueGraph` writes.
  - **Every request that press makes is cache-busted, and nothing else is**
    (`sleeper/fresh.ts`, `freshUrl`/`cacheBustToken`). Sleeper sits behind a CDN,
    so a roster read seconds after somebody set a lineup can be answered from an
    edge copy minted before they did — and every layer below then behaves
    perfectly: a 200 with the old starters is stored as the league's current
    state, `updated_at` advances, the panel refetches, and the reader sees what
    they saw before pressing. **That is the one failure this path cannot tell
    from working**, which is why the token is minted inside `refreshLeague`
    rather than left as something a caller may pass. It is one token for the
    whole ~11-request graph, so a press is one group in an access log, and it is
    a timestamp so two presses can never re-request a URL the edge has already
    answered. Threaded as an optional last argument through the league getters
    and `fetchLeagueGraph` rather than switched on in `sleeperGet`, because the
    scheduled callers want the opposite: the crawler is promising a
    fifteen-minute TTL, so an edge copy is inside its own error bars and letting
    the CDN answer costs Sleeper's origin nothing. **A `Cache-Control: no-cache`
    request header is deliberately not sent** and should not be added later as
    though it did the same job — the major CDNs ignore it from anonymous
    clients, so it would read as a fix while changing nothing.
  - **The successful refresh is the one success this app logs.** A refresh that
    fetched stale data and a refresh that never ran look identical from outside —
    unchanged rows either way — so the line naming the league, the roster count
    and the token is what separates them without guessing. The cooldown is what
    keeps it from becoming chatter.
  - **A race is a success, not a refusal.** An attempt landing after this caller
    began queueing means somebody else's fan-out wrote what it was waiting for;
    reported as a throttle it would tell a reader their data is stale at its very
    freshest. `leagueRefreshGate` draws that line and `LeagueSyncPayload.synced`
    is where the two say the same thing to a client.
  - **Every outcome but "not in the corpus" is a 200.** A cooldown is not an
    error and a race is a success under another name, so spelling either as a 4xx
    would put a red note over a league that is perfectly current. Only a 404 and
    the database's own 503 leave that shape.
  - **The press invalidates two entries, and the second is not this panel's.**
    `useLeagueRefresh` marks the league's detail *prefix* (every board and week
    of it) and the lineup checker's whole cache, because the **card** the panel
    opened out of prints that league's shortfall off
    `/api/user/[username]/matchups` — leave it and a reader gets a panel saying
    nothing is left on the bench over a row still quoting the twelve points they
    just moved. That is why `lineupQueryKeys` is in `features/shared` now: a
    shared part invalidating them cannot reach into a feature for the key, and a
    second spelling here would be two entries for one question. Never a bare
    `invalidateQueries()`. What it does *not* send is an `AbortSignal` — a
    refresh fills shared Postgres state rather than this component's answer, the
    leagues route's own reasoning, so a card closed mid-refresh must not throw
    away budget already spent.
  - **A success says nothing; a press that fetched nothing speaks**
    (`syncStatusNote`, pure and tested). The refetch is what the reader is
    looking at, so a "Synced" badge beside changed rows would be the key
    congratulating itself — and the presses that leave the screen *identical*
    (cooldown, a refresh already running, a Sleeper failure) are the ones with
    nothing on screen to explain them. Only the two that mean "this league could
    not be read" take the attention amber; a cooldown is ordinary operation.
- **The collapsed card's stat columns are four slots the reader aims, not four
  fixed rankings.** `league-metrics.ts` is the catalogue of what a slot can hold
  and how to read it off the cached ranks and KTC value — the card hard-coded
  record, points, KTC starters and projected points, which answers where a roster
  places on four axes and nothing about the shape behind them. Three things to
  keep. The list holds **two shapes on purpose**: a `rank` metric is `#N of M`,
  tinted and metered against its league, while a `value` metric is a bare number
  with no field to place it in (bench value, the raw points behind a rank) — same
  menu, different cells, because "3rd of 12" and "41,200" are not comparable
  claims. The selection lives in `ManagerLeagues`, not per card, so the columns
  line up down the list and one pick moves them all — per-card columns would
  make the list unreadable vertically, which is the axis it is scanned on. And
  the module keeps the pure-and-tested bar its neighbours `shares` and `filters`
  hold: everything from `./types` arrives as an erased `import type`, so the
  accessors test without a fetch (`league-metrics.test.ts`).
- **There are six metric catalogues, one per grain, and that is the axis they
  divide on — not the screen they appear on.** `ColumnsEditor` is how every one
  of them is aimed and `MetricColumn` draws the cards' cells; what differs is what
  a row *is*:

  | Module | Grain | Where |
  | --- | --- | --- |
  | `manager/league-metrics` | one league | collapsed card |
  | `shared/standings-metrics` | one team | league detail panel's standings |
  | `shared/roster-metrics` | one player | league detail panel's roster list |
  | `shared/share-metrics` | one subject held across several leagues | players and leaguemates cards |
  | `trades/trade-metrics` | one side of one trade | trade card |
  | `lineupchecker/lineup-metrics` | one league's **week** | lineup row |

  **The sixth is what made the lineup checker's headings pressable, and the two
  lists it now matches are the argument for it.** That tool drew its four columns
  by hand — a bench-gap cell and three reserved slots — with a heading rail that
  deliberately wore no milled channel, because a part that lights under the cursor
  and then does nothing is exactly what this app's raised/recessed grammar exists
  to prevent. A catalogue is what put something behind the press, and nothing
  about the geometry moved: the cells are `MetricColumns` and the headings
  `MetricHeadings`, so a heading still sits over the number it names at both
  widths. Three things it settles that a seventh will meet too. **A week is its
  own grain**, so the persisted key is `lineup` and not `league` however alike the
  two lists look — a selection only means anything against the catalogue it was
  picked from. **A blank is a metric**, since three slots have nothing to show
  yet: it is named `Blank` rather than drawn as an em dash, because a heading is a
  control now and a reader cannot press a word they cannot read (the *cell* keeps
  the em dash, which is how this app spells "no answer" everywhere), and being
  pickable is also the only way to give a column back once one has been aimed. And
  **a repeated key is legitimate** — three slots hold `blank` — which is why the
  editor asks what the *armed slot* holds rather than where a key first appears;
  `columns.indexOf(key) === slot` is the same question for a unique key and the
  wrong answer for a repeated one, lighting nothing when the third blank is armed.

  **`MetricCell`'s value arm carries an optional `tone`, and it is meant to stay
  rare.** Nearly every number in these catalogues is a measurement, and a
  measurement has no business being tinted — a card of four coloured figures reads
  as an alarm. What earns it is a cell whose whole point is that there is
  something to *do*: the lineup shortfall wore the app's needs-attention amber
  while it was hand-drawn, and the tone is what let it move into the shared column
  without losing the one thing separating a verdict from a count. It is a named
  tone rather than a class name, since a catalogue that could hand a Tailwind
  class through could hand any class through.

  **Three of them are in `features/shared` and three are not, and the split is the
  mover's rule rather than the grain**: the panel the standings and roster
  catalogues feed is drawn by the leagues list *and* by a trade card, and the
  share catalogue feeds two sheets the lineup checker opens as well as the manager
  tabs. Nothing else about them changed — all three are still pure, still tested
  beside themselves, and still take their subject shapes as erased `import type`s
  (from `@/shared/contract`, `@/shared/manager` and `@/shared/projections`
  directly now, since there is no feature `types.ts` where they landed).

  The fifth is the first outside the manager tool, which is what moved the
  vocabulary they all speak — `Metric<C>`, `MetricCell`, `metricPreview` — to
  `features/shared/metric-cell.ts`, with `features/manager/metric-cell.ts`
  re-exporting it under the usual mover's rule. A trade's grain is a **side**
  and nothing coarser: the sides are the same assets counted twice, so a trade
  as a whole has no value worth printing, while "which side got more" is one
  number per side.

  Put a metric where its subject lives, not where you happen to want to see it.
  KTC and ADP appear in most of them and mean something different each time — a
  whole roster summed in `standings-metrics`, a single player's price in
  `roster-metrics`, and in `share-metrics` that same player's price shown against
  *how many of your leagues hold him* — which is why the same lens is not one
  shared metric. The other split worth keeping: only `league-metrics` holds `rank`
  cells, because only the collapsed card places a league against its peers; the
  standings and roster panels are already ranked lists, so their columns are plain
  values and a rank in them would be a second ordering competing with the rows.
  All six hold the same pure-and-tested bar, and all are *client* modules
  under `features/` — they format for display, so they belong beside the
  components, and their `./format.ts` import is relative with an explicit
  extension for the usual test-runner reason.

  **All six now speak `Metric<C>` outright, and the two panel catalogues took a
  small type trick to get there.** They had cell types of their own —
  `TeamMetricCell`, `PlayerMetricCell` — that were the union's `value` arm minus
  its tag, so they could not be handed to the editor without an adapter array in
  between, which is one more definition of the catalogue to drift. Spelling
  `kind: "value"` on them is the whole fix, since only the tag was missing. The
  trap is in *how* the narrowing is written: `Metric<C> & { cell: … }` reads
  right and silently loses it, because an intersection of two `cell` properties
  makes an overload and a call resolves to the **first** — `Metric`'s, returning
  the union — so `cell.text` stops compiling in the file the narrow type exists
  to keep simple. `Omit<Metric<C>, "cell"> & { cell: … }` is the spelling that
  works. `PlayerMetricCell`'s own `muted`/`short` ride along untouched: extra
  properties never block assignability to the union arm, and the editor reads
  neither.
- **The share catalogue serves two views and is still one grain.** A player share
  and a leaguemate share are the same subject shape — something held across some
  of the manager's leagues — and the only thing a player has that a person does
  not is a price on the ADP board. That is four extra metrics
  (`PLAYER_SHARE_METRICS = SHARE_METRICS + an ADP and a pick-spread column per
  league-type board`, since the fetch answers the redraft and dynasty markets
  side by side and a column must never read the other market's number), not a
  second catalogue; the leaguemates menu never lists them, so the null they
  would read can't surface. Its record metrics are the **manager's** own over the leagues behind
  the row — how the teams holding a player are doing, how he fares against the
  crowd a leaguemate is part of — and they carry the two `aggregateRecord` rules
  intact: counted over leagues that report a record, and no games played is an em
  dash rather than `.000`.
- **A share cell is a third shape beside `rank` and `value`, and the difference is
  the tinting.** `metric-cell.ts` holds the vocabulary all four catalogues speak
  (`MetricCell`, `Metric<C>`, `metricPreview`) precisely because it is no longer
  about leagues. A `share` cell is `N of M` where *more is more*, metered by the
  plain fraction and never tiered: a rank's colour bands read 8-of-121 as a bad
  result the way 8th-of-12 is, which would paint nearly every row of a shares list
  red. Same menu, three cells, one column drawing them (`MetricColumn`, generic in
  its context so a league card and a share card share it). The cluster around them
  is shared too: `MetricColumns` is the four cells in the columns' own geometry,
  and it is *only* cells — one-menu-at-a-time, the outside click and Escape all
  belong to `MetricHeadings` now, since the rail is the one place a column is
  aimed from. That is what leaves a card with no stacking order to lift and no
  menu state to report.
- **The rank metrics come from one batch route,
  `/api/user/[username]/ranks`.** A collapsed league costs no request — the
  panel loads on expand — and a hundred cards each fetching a league detail to
  learn one number would undo that; ranking also needs every *other* team's
  total, which is why the client can't derive it from anything it already has.
  The batch (`getManagerLeagueRosters` → `getWeeklyTeamPoints`) reads the
  remaining weeks, stat lines and positions once for the union of every roster
  and runs only what genuinely differs per league — scoring and lineup solves —
  so it isn't `getLeagueOutlook` in a loop. The numbers ranked are
  `weekly_optimal_points` and `weekly_bench_points` under each league's own
  scoring, through the same pure modules as the panel's Proj column, so card and
  table can't disagree. Ties share the better rank (two at 250.0 are both #1),
  and a league where every total is zero gets *no* rank — pre-draft, "1st of 12"
  would dress an empty league up as a lead (`projectedRank`, tested).
- **The bench half rides along because the solve already had it.**
  `getWeeklyTeamPoints` returns `bench` beside `points` from one weekly solve, so
  ranking a roster by depth costs nothing beyond carrying the map — it was being
  discarded in the batch path. It is worth ranking for the reason the KTC chip
  splits into three: two teams level on projected starters are not the same team
  when one carries twice the production it isn't playing. `proj_bench` is null on
  exactly the terms `proj` is, which includes the case that matters — a shallow or
  undrafted league where every bench prices at zero gets no rank rather than an
  arbitrary #1. Note the two views read it differently on purpose: `standings`
  still shows bench as dimmer *context* beside `Proj`, while a card column ranks
  it outright. A number can be context in a table that is already ranked on
  something else, and the answer in its own column.
- **The card's KTC chip is three numbers, and the bench one is a subtraction.**
  A total says nothing about shape: two rosters worth 40k are not the same roster
  when one can start 30k of it and the other is depth behind a thin lineup. So
  `/api/user/[username]/ktc` sends `total`, `starters` and `bench`, with `bench`
  computed as `total − starters` so the three always reconcile — everything not in
  the optimal lineup lands there, the bench plus any IR or taxi player who didn't
  crack it (they are candidates now, so a stashed stud lands in `starters`
  instead), which is the honest reading of "value this roster holds and isn't
  starting". The starting half is summed by walking the
  *roster* and asking whether each player starts, never by walking the lineup, so
  a lineup naming someone the roster doesn't hold can't hand back a negative
  bench (`rosterKtcValue`, tested). Its cell goes blank when nothing is priced,
  on the same terms as a rank metric: a pre-draft roster is empty and KTC's board
  is skill players only, so "0 ktc" would dress both up as a claim about the
  team.
- **The KTC metrics are batched like the rank ones, and for the same reason.** A
  collapsed card costs no request, so a hundred of them each fetching a value
  would undo that. The route reads `getManagerLeagueRosters` and prices and
  solves *every* team, not just the manager's own — the card carries a
  starter-value rank now, and a rank of one roster can't be known without the
  other eleven's starter values, so the old shortcut of dropping them before the
  projections read is gone on purpose.
  `getOptimalLineups` is the third entry point in `projections/outlook`
  beside `getLeagueOutlook` and `getWeeklyTeamPoints`, and it is the cheapest of
  the three per team: the aggregate lineup is ranked on a season total, so the
  stat lines are summed once for the whole account (scoring is linear, so a
  player's aggregate is league-independent) and each league scores that sum once
  per player, where the weekly totals need a solve per team per week. It returns
  the same lineup the expanded panel lists as Starters, so a chip and the card it
  opens can't disagree about who starts. Its failure costs the split and not the
  value — pricing a roster needs no projection, so the totals still answer, which
  is why `split` is nullable rather than the whole league being dropped.
- **Two of those three batch reads are asked for only when a column actually
  draws them** (`managerDataRequirements`, and each metric's own `reads`). "A
  collapsed card costs no request" is what the batching bought; what it left is
  that the *batch* was unconditional — four columns out of a catalogue of
  thirteen, so a reader can aim all four away from a dataset, and both optional
  ones are the expensive kind at the far end (the KTC route solves every team's
  optimal lineup in every league, the ADP one prices every one of those rosters
  against a crawled board, per board). A projection-only board paid for both and
  drew neither. Four things hold it up. **`reads` is declared per metric and not
  inferred from `group`**, which agrees today and is a display caption — what a
  bay is *called* has no business deciding whether a request is made — and it is
  required, so a new metric cannot forget to say what it costs. **The agreement
  is what the test pins**: for every metric, nulling a declared dataset must
  change its cell and nulling an undeclared one must not, which catches
  over-fetching and a silently-blank column with one property. **`ranks` is
  unconditional**, and that is a fact about the card rather than a derivation: the
  record ledge reads `ranks.standing`, which is deliberately not a metric, so no
  column controls it — it is returned anyway so the rule has somewhere to be
  asserted. And **the columns editor is a consumer too**: it previews the whole
  catalogue against the first league, so `ColumnsBar`'s `onEditorOpen` latches
  both reads on the first press of a heading — otherwise a reader about to pick a
  KTC column would be choosing between em dashes. Nothing is invalidated either
  way; re-aiming a slot re-enables the query against the same key, and an entry
  inside its stale time is a cache read.
- **The steepness default is a measurement now, and `scripts/fit-adp-curve.ts`
  is what took it.** It was 4 — a reasonable-sounding number of halvings — and
  it is 2.75, because every completed trade is a revealed near-indifference
  between two hauls and the curve that makes the fewest of them look lopsided is
  the curve the market is using. Price both hauls on the league's own pool and
  board, score the median `|log(ΣA / ΣB)|`, grid-search the steepness. Over the
  14,082 two-sided player-for-player trades of 2026, held out by time, the
  optimum is **2.70** and the old default scored 16% worse. Four things make that
  a reading rather than a number off a chart, and each is a way the same exercise
  could have fooled itself:
  - **Only the count-asymmetric trades identify it.** A 1-for-1 balances under
    *every* curve, so the even subset prefers the flattest one on offer and its
    argmin runs to whatever floor the search has — it went to 0.25 of a halving,
    which is not a reading, it is the degeneracy. The asymmetric subset has a
    genuine interior minimum with the loss rising either side. The script reports
    the two apart for that reason alone.
  - **The search is wider than the slider.** The first run searched
    `STEEPNESS_RANGE` and came back with 2.05 against a floor of 2.00, which is
    indistinguishable from a clamp. What a reader may pick and what the market
    prefers are different questions; if the answer falls outside the control,
    that is a finding about the control.
  - **The one bias we know about points the other way**, so 2.70 is a ceiling.
    A 3-for-1 favours the consolidating side because roster spots are scarce and
    nothing in this curve prices one, so an uncorrected fit reads part of the
    price of a roster spot as steepness.
  - **It is scored on trades it was not fitted across** — the newest fifth of the
    season — because a curve chosen and graded on one sample is graded on its own
    noise. It runs on player-for-player trades only, since a pick is priced
    through the rookie ladder and a KTC ratio and including one measures those.
- **`avg(pick_no)` is a poor statistic for a convex curve, and the obvious
  correction is *not* the fix — this is the negative result, and it is here so it
  is not rediscovered.** The curve is convex, so by Jensen `E[v(P)] > v(E[P])`
  and reading it at the mean undervalues a player the board is split about. That
  argument is correct and the correction built on it was shipped and reverted
  within the day. It is a cumulant series in `λσ`, exact for a Gaussian and
  useful while `λσ` is well under 1 — and the **dynasty board's median `λσ` is
  3.32**, where the series does not converge at all. Measured on the real board
  it moved the median player **2.25×** and the 95th percentile **558×**, and the
  `min_pick` clamp that was supposed to make truncation safe was the only thing
  standing between it and absurdity: a bench player taken at pick 1 in one odd
  draft priced near the peak. The trade fit above confirmed it independently,
  preferring the plain mean (0.265 against 0.280).
  The diagnosis is the part worth keeping. A dynasty board whose drafts put one
  player a hundred picks apart is not describing a polarising player; it is
  saying **it does not know where he goes**, and that should cost confidence
  rather than earn convexity value. Whatever replaces the mean — a trimmed
  average, a median, a shrink toward replacement level weighted by the sample —
  wants to move in that direction, and wants running through `fit-adp-curve.ts`
  before it ships. The redraft board is nowhere near this problem (median `λσ`
  0.41), which is exactly why a change that looked fine in the small can be
  wrong for most of the app: the value column mostly runs on dynasty leagues.

- **ADP is ordinal, so it cannot be summed — `adp-value` makes it cardinal
  first.** A draft position is a rank where lower is better, so adding raw ADPs
  gives a deep roster a bigger (worse) number and lets a stud *lower* the total.
  `adpValue` inverts it onto a scale, and the shape of that inversion is the
  point: value decays across a league's **startable pool** (`teams × starting
  slots`), not a fixed pick count, so the gap between picks 1 and 2 is worth
  vastly more than the gap between 100 and 101, and a plain `maxPick − adp` would
  overvalue bench depth. Anchoring to the pool rather than the pick count is what
  makes a late first-rounder worth the same in a 10- and a 14-team league, and a
  deeper-starting league (superflex, extra flex, IDP) carry value further down
  the board — because it starts more players (`startingSlotCount` reuses the slot
  vocabulary, so a new flex counts the moment the solver learns it). The one knob
  is the **steepness** — how many times value halves across that pool — and it is
  a *user control*, not a hardcoded constant: a slider in the shared ADP drawer,
  sent to the route as a `steepness` param it clamps to `STEEPNESS_RANGE`. It is a
  modeling choice and changing it reprices every card, which is why it is exposed
  rather than baked in; `ADP_PEAK` is only the scale the numbers are read on.
  **It is the one piece of that vocabulary the two ends do *not* carry
  separately**, and the exception is instructive: the board filters are a matched
  pair of strings because they name populations SQL has to recognise, where this
  is a single scalar with an obvious ordering — so `adp-value.ts` owns the range
  and its default, and the client reads them relatively (`.ts` extension, the way
  it already reads `isSuperflexLineup`) rather than re-typing three preset names.
  It *was* three names, and they were only ever three points on the scale; a
  slider says so, and the drawer's board previews the curve as it moves. Two rules
  travel with that. **Dragging previews, releasing commits** — a committed value
  re-fetches every league's team value, so a drag across the range would fire two
  dozen of those; the drawer holds the in-flight value locally and moves the store
  on pointer-up, key-up or blur. And **a preview needs a pool it doesn't have**:
  the drawer's board belongs to no league, so `previewAdpPool` anchors on an
  **exact** size rule where the reader has written one (`teams = 12`) and a
  typical 12-team lineup otherwise — an assumption, which is why the footer states
  it rather than letting the column pass as a card's own number. Only an equality
  answers it: the size *chip* it reads in place of could say nothing but "12-team",
  where a rule can also say `teams ≥ 12`, and that describes a range of pools
  rather than one — a preview guessing at an end of it would quote a pool no
  filter asked for.
- **This is the third team-value lens, and the three answer different
  questions.** `ktc` prices a *dynasty* asset, `ranks` models a *season*, and
  `adp-value` reads the *market consensus* of the drafts this app crawled — which
  is why a roster can rank differently under each and none of them is the wrong
  answer. It is batched like the other two for the same reason (a collapsed card
  costs no request). The trap it adds is that **ADP pooled across different games
  is meaningless**: a superflex dynasty board and a 1QB redraft board are not one
  population, the same lesson as KTC's two boards. So each league is priced
  against the board most like it and leagues sharing a `boardSignature` share one
  query — grouped and fetched once per board, never once per league.

  **The league-type half of that is answered by *both* boards and chosen by the
  column, which is the one axis where matching the league was the wrong call.**
  Superflex and scoring pick the fetch, and getting either wrong misprices a
  roster; the league type doesn't, because both readings of a roster are true —
  a dynasty team's redraft value is what a win-now market would pay for the same
  players, and the gap between the two is the clearest thing on a card about
  whether it is built to win now or later. Reading only the league's own market
  cost that *and* made a column dishonest: a stat column is scanned down a list
  holding leagues of both kinds, so one `ADP value` heading sat over two markets'
  numbers with nothing saying which row was which. `LeagueAdpEntry` therefore
  carries `redraft` and `dynasty` side by side — the shape `/api/adp` already
  answers a player row in — and `league-metrics` offers one value and one rank
  per board (`adp_total_dynasty`, `adp_rank_redraft`, …). It costs no query: both
  markets are already in `getDraftAdpForPlayers`'s answer, so what doubles is a
  curve and a sum over ids in memory. `board` still travels, saying which market
  the league itself plays in — it gates neither reading now, it tells a reader
  which of the two columns is native and the other column's hover says so.
  Two consequences worth keeping. `priced` is **per board** and `rostered` is
  hoisted out of both, since how many players a roster holds is a fact about the
  roster while what a board prices genuinely differs (a rookie is on one and
  absent from the other). And a heading is 76px, so those four columns are
  labelled `Dynasty` / `Redraft` and `Dynasty #` / `Redraft #`: `Dynasty value`
  measures 90px and a truncated heading is the only name its column has.

  **Which axes a *reader* may set and which a league answers for itself is the
  whole design of `adpBoardFor`, so it is a type (`AdpBoardChoices`) and not a
  convention.** The drawer drives this route now — it used to send only the
  steepness, which let the panel be narrowed to startup drafts while every card
  under it went on being priced off every draft crawled, two answers to one
  question a few pixels apart. What crosses is the *population*: the season, the
  window, the kind of draft, and the leagues the reader's rules resolved to — all
  of which `adpBoardFor` previously hard-nulled. What does **not** cross is
  `scoring` and `superflex`, and the reason is not tidiness: they are facts about
  the league being priced, matched per league on the server, and a superflex
  roster valued off 1QB drafts is wrong at every position rather than only at
  quarterback. They are not even expressible from the drawer any more — its chips
  for both became league *rules*, and a rule set says which leagues' drafts are on
  the board without saying which board a given roster reads. The arrow between a
  league and those two runs the other way; that is what `seedFromLeague` is.

  **And it is why both those routes answer a POST.** The rules resolve to a list
  of league ids that can outgrow a request line, and a card priced on a different
  board from the drawer above it is the exact two-answers-to-one-question this
  path exists to close — so `readLeagueScope` reads the body, the query string is
  identical either way, and `parseAdpFilters` folds the body's list into the field
  the query-string one would have filled. GET and POST are one question with one
  handler, `/api/trades`' own arrangement. The **cache key inlines the ids
  regardless** (`AdpRead.key`): two league sets that differ are two boards
  whatever transport carried them.

  **The expanded panel reads the same board, and that is the point rather than a
  tidy-up.** `/api/league/[leagueId]` used to call `adpBoardFor` with no choices
  and read `DEFAULT_STEEPNESS`, on the honest grounds that the panel offers no
  controls of its own — true, and beside the point once the drawer started
  driving the card: a rookie's ADP in the roster list would read off a pool of
  rookie drafts while the card that opened it was priced off startups. **A panel
  driven by a selection has to be driven by the *same* selection**, which is the
  roster panel's own rule about not restating the selection, run one level up.
  So both routes take one request (`adpValueRead`) through one parser
  (`parseAdpBoardChoices`), and the panel reads the drawer's curve too — its pool
  is still the league's own, since two leagues on one board are priced on their
  own size.

  Three details in the plumbing. The season travels as **`board_season`**,
  because `?season` belongs to `resolveManagerRequest` on all six routes under
  that prefix, where it means *which season's leagues are on screen* and picks
  the rosters to price — sharing the name would have made moving the drawer to
  2024 swap the card list out from under itself. `/api/league/[leagueId]` reads
  no `?season` at all and *still* uses that name: one spelling for one question
  beats a second that is only accidentally free. Both map it back and validate
  through `parseAdpFilters`, so there is exactly one parser for these parameters
  rather than a second spelling to drift. And `boardSignature` names **every**
  axis the board carries, not only the two that vary within a request: the
  reader's choices are constant across one call, so this changes no grouping
  today, but a signature standing for less than its board is a silent collision
  the moment a caller varies one — leagues priced off somebody else's window with
  nothing in the payload to say so.

  **`useLeagueDetail` is four queries, and which of them a press reaches is the
  whole design.** `core` (rosters, standings, members, picks, names) depends on
  neither the board nor the week; `values` carries the board; `outlook` carries
  neither; `week` carries the week. That used to be *one* key with the board and
  the week as segments, because it was one payload — so narrowing the drawer or
  stepping a week discarded a dozen rosters, their managers, their picks and
  several hundred player names to move two columns. The panel renders on `core`
  alone and reads the other three as "no answer yet", which is a state every one
  of its components already drew an em dash for; only `core`'s failure is the
  panel's failure.

  **They are combined as state and never awaited together.** Composing them
  behind a `Promise.all` in one `queryFn` recreates exactly the blocking the
  split removed, with three extra requests as the only difference.

  **`core` clears on a new league; `values` and `week` hold through a new board
  or a new week, and that is one rule rather than three exceptions.** These are
  the reads whose previous answer can be *about something else*, which is why
  none of them takes bare `keepPreviousData`: a new league id must show nothing
  rather than leave the last league's rosters on screen under the new name. A new
  board or week of the same league is the opposite case — the rows are right and
  two columns are about to move — so blanking several hundred of them is the
  flash every other hook here refuses. The placeholder is therefore kept only
  when the previous key names this same league, which is what
  `leagueQueryKeys.league` is: a prefix to compare against, since the whole key
  is what just changed. It is also what one invalidation of a refreshed league
  reaches, so the split cost `useLeagueRefresh` nothing.

  **And the panel's own selection had to stop being *initialised* from the
  ranking.** The standings are ordered by projected points, so the head of the
  list is the standings leader before the outlook lands and the projected leader
  after — a `useState(teams[0])` therefore pinned whichever row happened to lead
  during the first render, which is now always the wrong one. It is null until a
  reader actually presses a row, and `teams[0]` is read as a fallback: the panel
  opens on the standings leader, follows the ranking the moment it arrives, and
  any press pins the choice for good.
- **A list of managers is labelled by username, a team by team name.** `ui.tsx`
  has both — `managerLabel` (display_name → team_name → roster number) and
  `teamLabel` (the reverse) — and the column heading says which one it is.
  `standings` is a Manager column, so it uses the username: a team name is a
  nickname someone picked for one league and changes at will, so labelling by it
  makes the same opponent read as a different person in every league they're in.
  The team name isn't dropped, it's demoted — it stays on the row's hover, which
  is now the only place it is written. The roster panel beside it used to lead
  with a plate naming the selected team (avatar, team name, record, points for),
  and that plate said what the highlighted row a few pixels to its left already
  says — at the cost of ~64px of a half that is ~155px wide on a phone, before a
  single player was listed. **A panel driven by a selection should not restate the
  selection**; the same reasoning took the `Optimal <total>` chip under it, which
  is the number the standings are ranked on and states in the column beside it —
  and, eventually, the `start … · sit …` line under that, which restated the two
  lists it sat over rather than any one number. That head is now the coverage
  caveat, plus one line on a best-ball week saying why nothing on the list is
  marked — which is the exception proving the rule rather than a breach of it: it
  states something no row below it can. Pass the same string to
  `TeamAvatar`'s `label` so its fallback initial matches the name shown next to it.
- **Rows in that panel give the name its own line — the standings always, the
  roster only where it has to.** Both lists put the team or player name alone on
  the first line and everything else (record, points for, position, NFL team,
  both totals) on a second line under it, because the name is the field a reader
  scans for and it lost every fight for horizontal space in a panel rendering at
  half a card's width. A roster row takes that shape below `@3xl` and collapses
  to one line above it, which is worth two notes. **The tier is `@3xl` rather
  than the `@2xl` it reads as wanting**, because a tier that adds a *cell* takes
  back more width than it gained: measured in a browser, one line leaves the
  name 121px at a 690px panel against the 198px the two-line shape already gives
  it at 520px, so switching earlier would truncate `Christian McCaffrey` in the
  tier immediately above the one that had just started showing it whole. That
  non-monotonicity is the thing to sweep for whenever either threshold moves.
  And **the two shapes are the same cells in the same DOM order** — what changes
  is `--cols`, whether the meta cell is drawn, and whether the slot chip is in
  flow — so there is one row rather than two designs either side of a
  breakpoint. The numbers keep their own grid columns on that second
  line rather than being folded into a sentence, because they are what's worth
  comparing down the list. Row and heading share **one** grid template
  (`SectionLayout` in `roster-layout`, the `columns` string in `standings`) — a
  header laid out separately drifts the moment a width changes, which is why the
  layout lives in its own file: `roster-detail` renders the headings and
  `player-row` lays the cells, and the template they share is the contract
  between them. Every template is written out as a whole class string so
  Tailwind can see it.
- **Below `@lg` a roster row contracts the first name to an initial, and the
  reason it isn't conditional is worth keeping.** Giving the name its own line
  bought it ~126px on a phone, and at 14px that is roughly where real player
  names *start*: `Michael Pittman Jr.` measures 118px, `Christian McCaffrey`
  123, `Chigoziem Okonkwo` 128, and an IDP league's `Jeremiah Owusu-Koramoah`
  174. So `shortPlayerName` (in `manager/format`, pure and tested) is what the
  narrow tier draws, with the whole name back at `@lg` — the usual two spans,
  `@lg:hidden` against `hidden @lg:inline`, since `.inline` outranks `.hidden`
  at every width otherwise. **A length threshold cannot express this**: the two
  names above are 17 and 19 characters at 128px and 118px, so a character count
  is a poor proxy for a width and every setting of it either contracts names
  that had room or clips names that didn't. Contracting all of them is also what
  keeps the column uniform, which is how a box score has written this for a
  century. Two exclusions, both load-bearing: a team defence is returned whole
  (`Pittsburgh Steelers` is the team's name, and `P. Steelers` is nothing), and
  so is a name with no space (the `Empty` placeholder, an unresolved player id).
  It does not promise a fit — `J. Owusu-Koramoah` is 128px and still loses its
  last letter — but it takes that row from losing a third of the name to losing
  one character, which is the whole of the claim. The `title` beside it is the
  desktop backstop and deliberately not the plan: there is no hover on a phone,
  which is the width where the name is short of room in the first place.
- **The slot gutter is `1.25rem` below `@lg`, and it is measured rather than
  picked** — `DEF` is the widest label the column can be asked to hold at
  `text-[0.6rem]`, at 19.2px. It was `1.75rem`, a track sized for `SFLX` at the
  *wider* tier's type, spending 28px on a two-letter `RB` out of the one column
  whose contents can't be shortened. `NARROW_SLOT_LABEL` in `player-row` is the
  two labels that don't fit that width (`FLEX` and `SUPER_FLEX`, 24.5px each),
  overriding `SLOT_LABEL` rather than replacing it — above `@lg` the fuller
  spellings are drawn, because `FLEX` is a word a reader knows and `FLX` is a
  concession to a width, so the concession is made only where the width demands
  it. The table and the track are a matched pair with no compiler link between
  them: a label added there wants a width check here, or the *marker* truncates,
  and a clipped label reads as broken where a clipped name only reads as long.
  **Neither gutter may be `auto`**, which is the tempting simplification and the
  one that breaks: every row and every section heading is its own grid
  container, so an intrinsic track is measured per row — the starters section
  would size to `FLEX` and the bench section, whose rows carry no slot, to zero,
  putting the two lists' names and number columns at different x. Same trap in
  the standings one row over, where `1` and `12` would not agree.
- **The standings' rank gutter is where this ran out, and it was left alone.**
  It was already dieted once, from `2rem` to `1rem`, for exactly this reason,
  and a 12-team league needs two digits — `12` is 11.6px against that 16px
  track. Trimming further is worth ~4px, which moves no name across any
  boundary, and the 8px column gutter that would have to give with it is a
  decision this panel already made deliberately (see the gutter rule above:
  trim the padding, never the gap). A long username therefore still truncates,
  and it has no lossless treatment available — it is one token, so there is no
  first name to contract and no break point but a mid-word one. Spending the
  avatar for the rank is the only real lever left there; it is a trade rather
  than a free win, so it stays unmade.
- **`roster-detail` shows the optimal lineup on a season panel and the *actual*
  one on a week panel, and the two opposite answers come from one question: what
  did the reader arrive asking?** On a season panel there is no current/optimal
  toggle — the current lineup is a click away in Sleeper, what this tool adds is
  the best lineup available, so the starters list *is* that lineup and the bench
  is everyone it doesn't seat. **The diff against what the team is actually
  starting is not drawn there at all**, which took two things that each looked
  like the panel's own subject and were the *other* lineup wearing its clothes.
  The `start … · sit …` prose above the list named players who were already on
  rows a few pixels below, in the section that answers where each of them should
  be — the same restatement the team plate and the `Optimal <total>` chip were
  removed for, and the argument holds harder here because the sentence was a
  second spelling of the two lists rather than of one number. And a tinted
  promoted starter beside a dimmed sat bench player made a section's rows unequal
  on an axis the section isn't about: that half is the lineup to hold, so which
  list a player is in is the whole of the advice, and the marking only reported
  how far the team currently is from taking it. What survives as a *number* is
  the gap, which is the lineup checker's own column on the row that opens this
  panel and the week projection's hover inside it — which is also why
  `optimal.ts` computes `current` / `current_points`: `points_left` is a
  difference against them and is on screen.
  The one thing left above the list is `LineupCoverage`, the caveat naming slots
  the solver didn't recognise — kept because nothing else on screen can raise it,
  where everything else up there was already said below.

  **A week panel inverts every clause of that, and the inversion is the same
  sentence read the other way.** A reader who arrived at a *lineup* is asking
  what to change, and a list of the best available answers that question by
  hiding it: the players who need moving are the ones the list silently drops,
  so the one thing a lineup checker exists to show was the one thing not on
  screen. So the starters section lists **what the team is actually starting**,
  and `start`/`sit` — computed and tested since the solver was written, and until
  now drawn by nothing — are what carries the difference: a starter the week's
  solve would bench is amber, the bench player it would start is in the accent.
  Five things hold it up.
  - **The marks are a *diff*, which is exactly why the season panel still refuses
    them.** The argument above was never "marks are noise"; it was that a list
    which already *is* the recommendation has nothing to diff against. A list of
    what is says nothing about what should be, and that gap has nowhere else on
    the panel to appear.
  - **Both ends of a swap are marked, because they sit in two different lists.**
    A starter to move out, with no bench row saying who replaces him, is half an
    answer — and the bench of a week panel is therefore sorted by the **week's**
    projection rather than the season's, so the player a marked starter sends the
    reader to is at the top of the list they land in.
  - **The lineup travels on the wire** (`TeamWeekProjectionPayload.lineup`,
    `sit`, `start`) rather than being rebuilt from `starters` on the client,
    which cannot reproduce it: eligibility is `fantasy_positions` (not on
    `PlayerSummary`), played-game locking is a server read, and the slots this
    app doesn't recognise are dropped by the solver's own rule. A second reading
    of any of the three on the client is a second answer.
  - **The tone is on the name, not on a badge.** At ~120px of name track on a
    phone a word costs the thing it is marking. `sit` takes the app's
    needs-attention amber — the same amber the lineup row's own gap column wears
    one tool over, for that number at the team's grain — and `start` takes the
    accent, since it is where those points are rather than a second alarm. A
    `title` and an `sr-only` carry what colour alone cannot.
  - **The opponent's half is marked too**, and what says which lineup you can act
    on is the recessed surface it is drawn on — the pairing that already exists
    for exactly that. A lineup leaving points on the bench is worth knowing about
    on the side you are playing.
- **A best-ball league is the one league where `starters` is not the lineup, and
  it is answered in the solver rather than at the panel.** Sleeper seats such a
  lineup itself, from the whole roster, after the games are played — so that
  array holds whatever the draft left behind, and reading it produced a gap
  against a lineup nobody sets: advice a manager cannot act on, on every
  best-ball league in the account, all season. `compareLineup`'s `bestBall` is
  the fix and it is four consequences of one sentence: `current` **is** the
  optimal lineup, `points_left` is zero, `start`/`sit` are empty, and `locked` is
  ignored — a seat chosen after the fact is not constrained by a game already
  played. Four things travel with it:
  - **It is one rule, so it reaches everything.** The flag rides on
    `LeagueTeamsInput`, so the lineup checker's `vs optimal` column (through
    `/api/user/…/matchups`) and the panel it opens (through
    `/api/league/[leagueId]`) get the same answer — the row saying `-12.34` over
    a panel with nothing to swap is precisely the two-answers-to-one-question
    this codebase keeps closing.
  - **The setting is read through `BEST_BALL_SQL`**, the fragment `/api/adp`
    already filters on and the client's `isBestBall` already mirrors, for the
    reason `LEAGUE_TYPE_SQL` is shared: a league priced as best ball on the board
    and solved as an ordinary one here is a difference no type can catch. Absent
    or unparseable reads false, which is what Sleeper's omitted default means.
  - **The panel says so** (`LineupNote`), because an unmarked lineup is otherwise
    ambiguous: it reads identically to one the manager got right, and the players
    listed differ from the ones Sleeper shows under Starters. One line separates
    "nothing to do" from "nothing you could have done".
  - **It changes nothing on a season panel**, whose list is the best
    rest-of-season lineup whoever sets the weekly one — so the note is gated on
    the week rather than on the flag.
- **On a week panel every roster row also names the NFL game its player is in —
  the opponent and the kickoff — and it is seated rather than appended.** Which
  starters have already played, which kick off in ten minutes and which club is
  on a bye are the three things a lineup is actually set on, and the row said
  none of them. Five decisions:
  - **The whole week's schedule crosses, keyed by NFL team**
    (`LeagueWeekViewPayload.games`, off `weekGames` in `shared/schedule`), and
    the client joins on the team already drawn beside the name. Per player it
    would be one kickoff written several hundred times with every copy free to
    disagree; trimmed to the rostered clubs it could not answer the bye, which is
    an **absence** and so only readable against a population. `{}` is a schedule
    this app could not read and draws nothing at all — `BYE` on every row of
    every lineup is what reading the first as the second looks like.
    `playerGame` is those three refusals, pure and tested for exactly the reason
    `head-to-head` beside it is.
  - **`weekKickoffs` is derived from `weekGames` rather than walked for itself**,
    and one `getWeekGames` cache entry serves both readers — so the panel naming
    a player's kickoff and the ordering that re-seats him for it cost one
    scoreboard request between them (see the gotcha on why it is the scoreboard
    and not the schedule) and read one answer.
  - **It takes a seat on the row's second line** (`SectionLayout.gameSeat`),
    which costs the narrow shape *nothing*: the leading cell of that line — the
    retired meta cell's — is already there and already paid for, since the
    numbers start in the second track. The wide shape grows a line, and only on a
    week panel. The alternative was the name's width and it was measured and
    rejected: ~87px of a ~150px name track on a phone, so `Christian McCaffrey`
    truncates at every tier. The **row** is explicit and not just the column, or
    auto-placement drags the value cells onto the second line with it.
  - **The clock is `Sun 1:05p`, `Sun 12p`** — a one-letter meridiem and no `:00`
    — which is where it parts company with the trade card's `3:07 PM`. That one
    sits on a plate; this shares a measured 90px cell with the matchup, and the
    pair that has to fit is `vs WAS` beside a noon kickoff, which is not a corner
    case: it is the ordinary 1pm ET slot as every Central reader sees it. Both
    compressions are measured in the rendered panel, not guessed.
  - **A bye takes no tone of its own**, though it is the row most worth noticing.
    The colour this list spends is the amber `sit` mark, which is precisely what
    a startable bench player behind a bye *produces* — and where there is none
    there is nothing to do, so a second alarm would be one the reader can't act
    on.
- **Every roster row carries two numbers, not one: `start` and `bench`.** A
  season total answers the wrong question on both sides of the roster. A backup
  quarterback projected 361 points behind two better starters is worth *nothing* —
  none of it reaches a lineup — while one projected 398 is worth only the 46 he
  scores in the two weeks he is the better start, and a single total calls those
  the same. The columns are labelled once for the whole half (`ColumnRail`, laid
  on the sections' own `SectionLayout` grid so the headings stay over the cells)
  rather than on every row — and once rather than per section, since the
  selection is shared and one of the two labels was always a copy of the other.
  IR and taxi are no longer a section of their own: a stashed player
  is treated as bench depth that could be started, so it sits in the bench list
  with the same `start`/`bench` split as the rest of it (the user chose this over
  keeping them unstartable — Sleeper needs a roster move to seat one).
- **The roster panel lists a team's future draft picks under its bench.**
  `getLeagueDetail` resolves each roster's owned picks from the league's
  `traded_picks` — the whole pick grid for the seasons that appear in trades, with
  the traded rows overriding who holds each cell — in `ownedDraftPicks` (pure and
  tested, beside `shares` and `rank`). A pick is tagged with the roster it
  originally belonged to, so the client marks the ones a team *acquired* ("1st
  from Bob") apart from its own, resolving the source name from the teams it
  already has rather than a per-pick field on the wire.
- **A dynasty league's seasons are a fixed horizon, not whatever has been
  traded** (`dynastyPickGrid`). Sleeper carries the next three drafts and rolls
  them forward the moment a rookie class is taken — 2026–2028 with the 2026
  draft still ahead, 2027–2029 once it completes — so deriving the seasons from
  `traded_picks` answered a different question and got the roll-over wrong in
  *both* directions: a league whose 2026 picks had all been dealt months ago went
  on listing a draft that had already happened, while a quiet league listed
  nothing at all. Every other format keeps the derived grid, since only a dynasty
  league has a standing horizon to read and a redraft league has no future picks
  to list. Three readings hold it up, and each is the same "absent is not
  evidence" rule this file keeps arriving at:
  - **The startup is not this year's rookie draft.** An inaugural league runs
    both under one season label, so `season = league season AND status =
    'complete'` would roll the window forward the moment the *startup* ended and
    hide a rookie class nobody has drafted. Which draft is the startup is
    `STARTUP_DRAFT_SQL`'s rule asked in TypeScript — the earliest one, and only
    in a league with no `previous_league_id` (spelled null, `''` or `'0'`).
  - **Only `complete` counts as taken.** A draft in progress hasn't happened, and
    neither has one the crawler has never stored — a season with no draft row
    keeps the nearer year, which fails toward showing a pick that exists rather
    than hiding one.
  - **The depth is the last rookie draft's, and the startup's is worthless.**
    Sleeper publishes no round count for a draft that doesn't exist yet, so the
    grid runs as deep as the deepest traded pick *or* the most recent rookie
    draft, whichever proves more — a traded 2026 fourth is evidence 2028 runs
    four rounds too. An inaugural league that has only run its 25-round startup
    reports null rather than inventing next May's shape, and a league offering
    neither bound still shows nothing, which is the quiet tail this
    deliberately under-reports rather than inventing rounds that may not exist.

