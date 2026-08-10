# Semantic contract and regression ledger

This file is the durable hand-off for maintainers and agents. The executable
counterpart is `tests/pipeline.test.mjs`; when a bug is fixed here, add or update
a test so bootstrap cannot silently reintroduce it.

## Protected structure

- 12 collections and all 519 folders are immutable in count and identity. The
  two additions are the approved Portuguese and Latin American World folders;
  none of the original 517 was deleted, merged or renamed.
- `collections.discover.recommended` is manually curated and fingerprint-locked.
- Rails may be retired only after evidence and explicit approval. Retired list
  IDs remain in `state.retiredRails`; nightly sync never deletes remote lists.
- Active release: 2,492 sources = 2,490 managed + 2 recommended. Managed sources
  are 398 native and 2,092 materialized lists.

## Media identity and Greek presentation

- Every emitted TMDB source has explicit Nuvio `type`: `movie` for MOVIE and
  `series` for TV. This prevents Nuvio from labeling TV rails as movies.
- `type` and `mediaType` are a single enforced pair: `movie/MOVIE` or
  `series/TV`. The reviewed 2026-08-10 Nuvio export contained 980 corrupted
  `series/MOVIE` pairs across ten collections. `profile-audit` detects this
  stored-state drift and generates a collection-ID replacement artifact.
- Five Golden Globe movie companions legitimately contain the word “σειρά” in
  their explanatory titles. Validation follows the canonical rail media type,
  never a title substring heuristic.
- TMDB reads use language `el`, matching Nuvio 0.8.3's TMDB language setting.
- The import cannot override a user's Nuvio TMDB profile. Set TMDB language to
  Greek and enable Artwork in Nuvio.
- A duplicate is collapsed only when media type, year, poster and canonical
  transliterated original title all match. For Greek works, the Greek-script
  record wins. This fixes the reviewed `Από Ήλιο σε Ήλιο` / `Apo ilio se ilio`
  duplicate without merging merely similar works.

## Poster invariant

- Every refreshed materialized candidate must have a non-empty TMDB `poster_path`.
- If a result payload has no poster, sync verifies the movie/TV details endpoint.
- If details still has no poster, the title is excluded and the count is written
  to `reports/latest.json` as `posterlessExcluded`.
- The check runs again nightly. A matching title automatically returns once TMDB
  publishes a poster.
- Immutable award histories use their already verified typed IDs between weekly
  authoritative refreshes. A write-schema migration applies new item invariants
  directly to those IDs instead of rerunning fuzzy historical title resolution.
- If poster/semantic filtering empties a rail, preparation fails closed: no TMDB
  clear/write occurs and the last-known-good remote list remains intact.
- The 398 native sources are resolved directly by Nuvio 0.8.3 and Nuvio exposes
  no supported `has poster` filter for them. The repository cannot enforce this
  gate on native sources without converting them to additional materialized
  lists. This limitation must not be hidden.

Regression: `poster gate excludes blank cards and automatically restores a
title once TMDB adds a poster`.

## Actors and directors

Actor rails use cast credits only and reject blank roles plus self, himself,
herself, archive footage, uncredited, host, presenter, honoree, interviewee and
guest-judge appearances (including the encoded Greek equivalents). The rule is
global for every actor, not an Al Pacino exception.

Director rails use crew credits only where `job` equals `Director`
case-insensitively. Popular and newest ordering use eligible works. Top uses a
vote-aware Bayesian score (prior mean 6; prior weight 250 movies / 100 TV) so a
single-vote 10.0 cameo cannot outrank established works.

Reviewed evidence:

- Al Pacino: `Internet Love — Self (uncredited)`, Jimmy Fallon, Oscars, Golden
  Globes and other self appearances are excluded. Top movies begin with the
  established Godfather/Scarface/Heat lineage; substantive TV credits include
  `Hunters`, `Angels in America` and the TV version of `The Godfather`.
- Jason Statham and Tom Cruise have no substantive TV cast credits in TMDB. With
  explicit user approval, only their Popular/Top/Newest TV rails were retired:
  `folder-D8PPUHIE` positions 1/3/5 and `folder-ZISLC5VJ` positions 1/3/5.
  Both folders and all six movie rails remain.

Regression: `person rails reject self, archive, and uncredited noise and use
vote-aware Top ranking`, plus the exact retirement assertions in the bootstrap
test.

## Runtime

Runtime is verified locally from each movie details endpoint; TMDB Discover's
runtime filter alone is not trusted. Bounds are mutually exclusive:

- short: `<90`
- standard: `90-149`
- long: `150-179`
- epic: `>=180`

Folder IDs select the boundary, never translated display text. The reviewed
live sample produced 127/182/113/121 valid titles and zero cross-rail overlap.

Regression: exact boundary and four-folder parameter tests.

## Studio feature films and curated animation canons

- Every movie rail in `collections.studios` is details-verified as a genuine
  feature film: runtime at least 40 minutes, already released, not adult/video,
  not Documentary, and not a TMDB TV Movie. TV studio rails remain typed TV and
  are never folded into the movie list.
- `Πρόσφατες ταινίες` first applies the normal rolling 24-month window. If that
  window contains no eligible feature (only shorts/documentaries, or genuinely
  no studio release), it widens to the studio's latest eligible released feature
  films. Thus “recent” means the studio's most recent valid works rather than an
  empty rail or unrelated filler.
- The first rail in Walt Disney Animation Studios, Pixar, Illumination and
  Studio Ghibli preserves the reviewed Trakt memberships as immutable provenance
  and reviewed baselines: 64 / 31 / 17 / 25 films respectively. The runtime
  source is still TMDB so Nuvio receives homogeneous, typed TMDB lists.
- These four rails additionally search their canonical TMDB company IDs each
  night. A newly discovered title is admitted only after the same details
  verification plus Animation genre validation. The result is sorted by release
  date newest to oldest.
- Studio Ghibli deliberately permits TMDB genre `TV Movie` because the reviewed
  25-film canon contains feature-length works whose TMDB distribution type is
  television. Disney/Pixar/Illumination exclude that genre.
- The reviewed IDs and policy live in `data/curated-studio-features.json`; the
  bootstrap and audit both fail if their count, uniqueness or Trakt provenance
  drifts. A pinned film failing semantic validation fails the rail closed instead
  of silently deleting it from the canon.

Regressions: exact four-rail bootstrap mapping, feature rejection boundaries,
and dynamic curated merge/order tests.

## Streaming and other semantics

- Streaming evaluates GR first with only `flatrate|free|ads`. A successful empty
  GR result may fall back to a Worldwide union for that rail only. Results never
  mix, and an API error never triggers fallback.
- Provider Trending prefers the official TMDB day window. If that provider has
  no day result in either GR or Worldwide, it widens to the official week window;
  it never relabels generic popularity as trending.
- World rails use origin-country semantics. Awards contain winner works, not
  people. Released-only rails cap dates at the current Athens date.
- Spain is exactly `ES`. Latin America is the reviewed origin union
  `MX|GT|HN|SV|NI|CR|PA|CU|DO|PR|CO|VE|EC|PE|BO|PY|UY|AR|CL|BR` and excludes
  Spain. Portugal is exactly `PT`. None uses an original-language restriction.
- Portugal currently has seven rails: its exact Top TV of the current year is
  omitted because the official predicate is empty even at quorum 3. No filler
  or zero-vote ranking replaces it.
- Genre New rails preserve their configured vote floor; New rails outside
  Genres continue to use pure current-year recency without inherited quorum.
- Nature documentary rails require Documentary and use an OR of the reviewed
  nature/wildlife/natural-history/environment/ecology tags, because TMDB rarely
  applies the generic `nature` keyword consistently.
- Materialized lists are homogeneous and compiled with `sortBy: original`.
- Ordered typed IDs are fingerprinted. Identical runs perform no writes; changes
  reconcile only that list and require exact v3 ordered read-back. Missing
  `media_type` in that read-back is now a hard failure, preventing Nuvio from
  silently interpreting a TV item as a movie.
- A write-schema migration whose verified ordered IDs are unchanged upgrades the
  checkpoint without clearing/re-adding the same remote list.
- TMDB v4 item-level `Media is invalid` and `Media is required` rejections are
  quarantined as typed IDs for 30 days; the rest of the rail is retried and
  exact-read back instead of failing permanently.
- More than 40% change requires a distinct confirmation client. Its cache is
  shared across sibling rails to avoid redundant requests without weakening the
  independent-fetch check.

## Release evidence checklist

Record current evidence in `reports/latest.json` and README, never only in chat:

- bootstrap counts match constants and every non-recommended folder is non-empty;
- all tests pass;
- audit passes folder/recommended locks, source counts and compatibility rules;
- full live dry-run considers all 2,092 materialized rails with zero failures;
- production updates pass exact read-back and leave zero active empty rails;
- compiled `dist/nuvio-collections-v5.0.json` contains 2,492 sources;
- the reviewed Nuvio profile repair report records 980 managed media-type mismatches,
  and the post-import export must record zero;
- secret scan finds no credentials in tracked files.
