/**
 * The keys this tool's reads are cached under.
 *
 * Built in one place rather than at the call site, the rule `managerQueryKeys`
 * exists for: a key that differs by a stray segment is not a shared cache entry,
 * it is a second request that looks like a hit in the code and a miss in the
 * network panel.
 *
 * **The table itself moved to `features/shared/lineup-query`**, and this file is
 * the re-export the mover's habit leaves behind — see that module for why a
 * shared part now needs to name these keys. Nothing about their shape changed,
 * and this tool's own hooks read them from here as they always have.
 */
export {
  MATCHUPS_STALE_TIME,
  lineupQueryKeys,
} from "@/features/shared/lineup-query";
