# Semantic contract and regression ledger

This file is the durable hand-off for maintainers and agents. The executable
counterpart is `tests/pipeline.test.mjs`; when a bug is fixed here, add or update
a test so bootstrap cannot silently reintroduce it.

## Protected structure

- 13 collections and all 548 active folders are immutable in count and identity.
  The sole approved historical deletion is Genres/Reality
  (`folder-KQEZGAMF`) with four preserved list tombstones. The remaining 516
  original folders, Portuguese/Latin-American additions and 30 v5.0.1
  additions are fingerprint-locked.
- `collections.discover.recommended` is manually curated and fingerprint-locked.
- Rails may be retired only after evidence and explicit approval. Retired list
  IDs remain in `state.retiredRails`; nightly sync never deletes remote lists.
- Active release: 2,677 sources = 2,675 managed + 2 recommended. Managed sources
  are 396 native and 2,279 materialized lists.

## Media identity and Greek presentation

- Every emitted TMDB source has explicit Nuvio `type`: `movie` for MOVIE and
  `series` for TV. This prevents Nuvio from labeling TV rails as movies.
- `type` and `mediaType` are a single enforced pair: `movie/MOVIE` or
  `series/TV`. The reviewed 2026-08-10 Nuvio export contained **987** corrupted
  `series/MOVIE` pairs across ten collections (was 980 before the Portuguese and
  Latin American World TV rails). All 987 are materialized `tmdbSourceType:LIST`
  rails. The 121 native TV sources (`DISCOVER` / `NETWORK`) stayed `series/TV`.
  `profile-audit` detects this stored-state drift and generates a collection-ID
  replacement artifact covering only the affected collections (10 of 12).
- Nuvio 0.8.3 root cause (stable tag `0.8.3-beta`):
  - Import path: `CollectionManagementViewModel` /
    `AddonConfigServer` → `CollectionsDataStore.importFromJson` →
    `SerializableSource.toDomainSource`, which **reads** `mediaType` and only
    defaults absent/invalid values to `MOVIE`. A clean DataStore round-trip keeps
    `LIST` + `TV` (Gson drops advisory `type` on TMDB re-serialize).
  - Create / web-editor paths: native `CollectionEditorViewModel`, web
    `AddonWebPage` (`LIST|COLLECTION` forced to `MOVIE`, including hidden media
    inputs for non-NETWORK modes), and Mobile `CollectionEditorRepository` all
    hard-code `LIST|COLLECTION → MOVIE` when adding or rebuilding a TMDB source.
    Display suffixes use `source.mediaType` (`CatalogRow.rawType` /
    `toCollectionRawType`), so a stored `MOVIE` yields «Ταινία» even when
    `type` remains `series` and the TMDB list items are TV.
  - Reviewed export fingerprint matches Mobile `encodeDefaults` + retained
    `type:"series"` with only `mediaType` flipped — not a missing-source
    problem. Native vs materialized split is permanent evidence in
    `reports/list-tv-mediatype-audit-2026-08-11.json`.
  - Executable probes live in `src/nuvio-list-compat.mjs` and
    `dist/nuvio-list-tv-mediaType-probe.json`. The probe is test-profile-only:
    importing it into the active profile would leave a temporary 13th
    collection because Nuvio imports merge by ID. Never “fix” this by
    converting materialized TV lists into inaccurate native Discover sources,
    and never recreate TMDB lists just to change mediaType. Do not claim the UI
    label is fixed until a fresh export audits to `mediaTypeMismatches: 0`.
- Post-import verification is mandatory: export from Nuvio and run
  `npm run profile:audit -- --profile=<export.json>`. Accept only
  `mediaTypeMismatches: 0`, `missing: 0`, `extra: 0`, and 13/13 collections.
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

## World folder order

- `collections.world` folders are ordered by Greek display title with
  `localeCompare(..., "el")`, not ASCII/English sorting.
- `Λατινοαμερικανικές` sits in the Greek **Λ** block (after Κορεάτικες, before
  Μεξικάνικες). `Πορτογαλικές` sits in the Greek **Π** block (after Πολωνικές,
  before Ρωσικές). Folder IDs, titles, sources, list IDs and artwork are
  unchanged; only array order inside the World collection may change.

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
- The 396 native sources are resolved directly by Nuvio 0.8.3 and Nuvio exposes
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

Each runtime rail is a deterministic daily rotation, not a static popularity
page. The materializer fetches up to 500 candidates, details-verifies the exact
bucket, requires at least 100 TMDB votes, keeps the 240 strongest recognition
candidates and deterministically selects up to 100 using Athens date plus the
stable rail key. Same-day retries are identical; the next date rotates both
membership and order when the eligible pool is larger than the list.

Regression: same-day stability, next-day rotation, vote floor and exact bounds.

## Discover popularity and Top

- Discover Popular preserves its configured quorum: 1,000 movie votes, 500 TV
  votes, and 200 for current-year rails. The generator must never delete these
  filters. Same-title regional clones are reduced to the most recognized work.
- `Κορυφαίες πρόσφατες` is a rolling 24-month materialized rail with quorum
  500 movies / 300 TV.
- `Κορυφαίες ... όλων των εποχών` covers all released dates with quorum 5,000
  movies / 3,000 TV. The previous pre-2000 native classic cutoff is removed.
- Top ordering is Bayesian and vote-aware. TMDB supplies community ratings,
  not a trustworthy critics-only score, so the repository does not claim an
  unsupported critics data source.

## v5.0.1 catalog additions

- Genres/Reality and its four lists were removed with explicit user approval.
  The exact list IDs remain tombstoned with reason
  `USER_APPROVED_REALITY_REMOVAL`; no unrelated folder or rail was removed.
- Genres adds Greek-locale-sorted `Κορεατικά δράματα (K-Drama)` and
  `Ρομαντική κομεντί`, eight homogeneous rails each. K-Drama requires Korean
  origin plus Drama. Romantic-comedy movies require both Comedy and Romance;
  TV uses the reviewed romantic-comedy keyword because TMDB TV has no Romance
  genre.
- `✨ Διάθεση & Ατμόσφαιρα` is a new collection after Film Series and before
  Studios. All ten folders, sixty translated rails and Kaptain artworks come
  from the pinned live database v47 SHA-256 recorded in
  `scripts/build-v5.0.1-catalog.mjs`. English-language restrictions are removed;
  thematic genres/keywords, quorums, rolling dates, poster gate and released
  cap remain enforced by our materializer.
- World adds 18 individual origin countries, never overlapping regional
  super-folders. Thirty-one exact predicates with no TMDB result were retired
  from the active artifact after the live evidence scan; the 18 country folders
  remain and contain only their non-empty truthful rails.
- `reports/v5.0.1-additions.json` must show 189 active additions, zero empty and
  zero failed before release.

## Film Series ordering

- All 186 Film Series rails remain native official TMDB `COLLECTION` sources.
- Every source is compiled with `sortBy: primary_release_date.desc`, which
  Nuvio 0.8.3 implements locally for collection parts. Newest films therefore
  appear on the left and oldest films on the right.
- A sequel newly added to the official TMDB collection is picked up directly by
  Nuvio and moves to the left automatically. These rails need no duplicate
  public list IDs and no nightly TMDB writes.
- Bootstrap and compiled-artifact regressions require the same sort on all 186
  sources; `original` or popularity sorting is forbidden for Film Series.

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
- World folder order is Greek-locale title sort; Portuguese and Latin American
  folders keep their locked IDs and occupy the Π and Λ alphabetic slots.
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
- full live dry-run considers all 2,279 materialized rails with zero failures;
- production updates pass exact read-back and leave zero active empty rails;
- compiled `dist/nuvio-collections-v5.0.1.json` contains 2,677 sources;
- the reviewed Nuvio profile repair report records 987 managed media-type mismatches
  (all materialized LIST TV rails; 121 native TV rails stayed correct),
  and the post-import export must record zero;
- secret scan finds no credentials in tracked files.
