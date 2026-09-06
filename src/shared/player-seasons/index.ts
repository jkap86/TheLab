// The comps corpus: historical player-seasons, stored in `player_seasons` and
// read back as the shape `shared/comps` ranks over. **Server-only** — the read
// reaches Postgres. The arithmetic it feeds is in `shared/comps`, which is pure
// and is what a client module imports.

export { buildCorpus, corpusBounds, toCompMatch, toCompSubject } from "./corpus";
export type {
  CompCorpus,
  CorpusSeason,
  CorpusSubject,
  StoredSeason,
} from "./corpus";
export { CORPUS_TTL_MS, getCompCorpus } from "./read";
export { SAMPLE_CORPUS } from "./sample";
