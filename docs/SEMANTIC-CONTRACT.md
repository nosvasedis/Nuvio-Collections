# Semantic contract and regression ledger

This file is the durable hand-off for maintainers and agents. The executable
counterpart is `tests/pipeline.test.mjs`; when a bug is fixed here, add or update
a test so bootstrap cannot silently reintroduce it.

## Protected structure

- 12 collections and all 517 folders are immutable in count and identity.
- `collections.discover.recommended` is manually curated and fingerprint-locked.
- Rails may be retired only after evidence and explicit approval. Retired list
  IDs remain in `state.retiredRails`; nightly sync never deletes remote lists.
- Active release: 2,477 sources = 2,475 managed + 2 recommended. Managed sources
  are 398 native and 2,077 materialized lists.

## Media identity and Greek presentation

- Every emitted TMDB source has explicit Nuvio `type`: `movie` for MOVIE and
  `series` for TV. This prevents Nuvio from labeling TV rails as movies.
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

## Streaming and other semantics

- Streaming evaluates GR first with only `flatrate|free|ads`. A successful empty
  GR result may fall back to a Worldwide union for that rail only. Results never
  mix, and an API error never triggers fallback.
- Provider Trending prefers the official TMDB day window. If that provider has
  no day result in either GR or Worldwide, it widens to the official week window;
  it never relabels generic popularity as trending.
- World rails use origin-country semantics. Awards contain winner works, not
  people. Released-only rails cap dates at the current Athens date.
- Nature documentary rails require Documentary and use an OR of the reviewed
  nature/wildlife/natural-history/environment/ecology tags, because TMDB rarely
  applies the generic `nature` keyword consistently.
- Materialized lists are homogeneous and compiled with `sortBy: original`.
- Ordered typed IDs are fingerprinted. Identical runs perform no writes; changes
  reconcile only that list and require exact v3 ordered read-back.
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
- full live dry-run considers all 2,077 materialized rails with zero failures;
- production updates pass exact read-back and leave zero active empty rails;
- compiled `dist/nuvio-collections-v5.0.json` contains 2,477 sources;
- secret scan finds no credentials in tracked files.
