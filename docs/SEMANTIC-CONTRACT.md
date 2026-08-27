# Semantic contract and regression ledger

This file is the durable hand-off for maintainers and agents. The executable
counterpart is `tests/pipeline.test.mjs`; when a bug is fixed here, add or update
a test so bootstrap cannot silently reintroduce it.

## Protected structure

- 13 collections and 548 active folders are immutable except for reviewed,
  user-approved migrations with complete tombstones. Approved exceptions are
  Genres/Reality (`folder-KQEZGAMF`) and the 2026-08-12 streaming replacement:
  Hulu, Discovery+ and Starz were replaced by MUBI, Criterion and AMC+. All 94
  old sources are tombstoned; 92 truthful active rails replace them because two
  Starz rails were already empty/retired. The migration preserves 13 streaming
  folders and all global active-source counts.
- `collections.discover.recommended` is manually curated and fingerprint-locked.
- Rails may be retired only after evidence and explicit approval. Retired list
  IDs remain in `state.retiredRails`; nightly sync never deletes remote lists.
- Active release: 2,677 sources = 2,675 managed materialized lists + 2
  protected recommended addon sources. There are zero managed native sources.

## Media identity and Greek presentation

- Every emitted TMDB source has explicit Nuvio `type`: `movie` for MOVIE and
  `series` for TV. This prevents Nuvio from labeling TV rails as movies.
- `type` and `mediaType` are a single enforced pair: `movie/MOVIE` or
  `series/TV`. The reviewed 2026-08-10 Nuvio export contained **987** corrupted
  `series/MOVIE` pairs across ten collections (was 980 before the Portuguese and
  Latin American World TV rails). All 987 are materialized `tmdbSourceType:LIST`
  rails. This is historical evidence from that profile: the current canonical
  artifact contains 1,153 TV LIST sources and zero managed native sources.
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
  - Executable source-level compatibility checks live in
    `src/nuvio-list-compat.mjs`. The old standalone test-profile probe artifact
    was deliberately retired to prevent accidental import. Never “fix” this by
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

## Folder order

- Genres, Film Series, Moods & Vibes, Actors, Directors and World are ordered
  by canonical English folder title with `localeCompare(..., "en")`.
- Greek display titles remain unchanged. Stable folder IDs map to their pinned
  Kaptain English titles in `data/folder-sort-keys.json`; the 13 older custom
  World IDs have explicit reviewed English keys.
- Folder IDs, sources, list IDs and artwork never change during reordering.
- Bootstrap tests and strict audit reject a missing key, an extra target
  collection or any order that differs from the English-key manifest.

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
- All 2,675 managed rails are materialized, so the repository enforces the
  poster gate, release eligibility and explicit media identity everywhere.
  Only the two protected recommended addon sources remain outside this system.

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
- Genres adds English-key-sorted `Κορεατικά δράματα (K-Drama)` and
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
- Every World tile has an explicit country/region emoji, a visible Greek title
  (`hideTitle: false`) and a canonical English-only sort key. This prevents new
  Kaptain artwork metadata from hiding the translated title.
- `reports/v5.0.1-additions.json` must show 189 active additions, zero empty and
  zero failed before release.

## Film Series ordering

- All 186 Film Series rails are materialized from official TMDB `COLLECTION`
  parts into stable movie-only public lists.
- Released, non-adult, non-video parts with posters are ordered by release date
  descending. Newest films therefore appear on the left and oldest on the right.
- A newly added official sequel is picked up by nightly sync and written into
  the same stable list ID. Nuvio receives `sortBy: original`, preserving the
  materialized order across pages.
- Bootstrap and compiled-artifact regressions require all 186 rails to remain
  materialized and homogeneous.

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
- Warner Bros. uses media-specific official TMDB companies: movie rails remain
  `Warner Bros. Entertainment` (company 17), while TV rails use `Warner Bros.
  Television` (company 1957). TMDB removed the last erroneous company-17 TV
  association on 2026-08-15, which correctly made the old Recent TV predicate
  empty and caused scheduled run 31858771232 to fail closed. Never point Warner
  TV rails back to company 17 or use the unrelated result as filler.

Regressions: exact four-rail bootstrap mapping, feature rejection boundaries,
dynamic curated merge/order tests, and the Warner media-specific company split.

## Streaming and other semantics

- Streaming evaluates GR first with only `flatrate|free|ads`. A successful empty
  GR result may fall back to a Worldwide union for that rail only. Results never
  mix, and an API error never triggers fallback.
- Streaming and Genre popularity require recognition floors instead of trusting
  raw TMDB popularity. Premium streaming uses 50 movie / 35 TV votes, niche
  services 25 / 15; premium Top uses 1,000 / 500 and niche Top 250 / 150.
  Generic Genre Popular uses 75 / 40 and all-time Top 1,000 / 500. New,
  Trending and provider-specific thematic rails retain their established
  semantics and do not inherit a generic provider quorum.
- Romance, romantic-comedy and Anime candidates exclude the reviewed explicit
  TMDB keyword set even when TMDB reports `adult=false`: softcore, erotic,
  erotica, adult video, porn, hentai, animated porn, ecchi, uncensored and
  unsimulated sex variants. Narrative themes such as rape, prostitution and
  generic sexual content are deliberately not classification exclusions; this
  keeps legitimate works such as `Perfect Blue` eligible.
- Rails explicitly labelled live-action exclude Animation and Documentary.
  Generic Popular, Top and Mood rails do not silently become live-action-only.
- Provider Trending prefers the official TMDB day window. If that provider has
  no day result in either GR or Worldwide, it widens to the official week window;
  it never relabels generic popularity as trending.
- Streaming folder order is exactly Netflix, Disney+, Apple TV+, HBO Max,
  Prime Video, Crunchyroll, MUBI, Criterion, Paramount+, AMC+, Peacock, MGM+,
  Shudder. All artwork fields come from the pinned Kaptain v0.90 beta export
  checksum; predicates and list ownership remain local and authoritative.
- Disney+ GR resolves official provider 337, which TMDB reports as the
  flatrate home of reviewed Hulu-origin titles in Greece. Standalone Hulu is not
  unioned. AMC+ unions only direct AMC+, Sundance Now and Acorn TV providers;
  Amazon/Apple/Roku channel add-ons are excluded.
- MUBI and Criterion are movie-only. Unsupported Kaptain Top 10 lists are not
  copied. MUBI's empty official trending predicate is replaced by an exact
  pre-2000 Classics rail; no rail is filled with mislabeled popularity data.
- A Trending ID that receives TMDB's definitive resource-not-found
  (`404/status_code 34`) during watch-provider verification is discarded as a
  deleted candidate. Network, rate-limit and 5xx failures still fail closed and
  never masquerade as empty regional availability.
- World rails use origin-country semantics. Awards contain winner works, not
  people. Released-only rails cap dates at the current Athens date.
- Ambiguous official award titles fail closed unless a reviewed TMDB identity
  is recorded in `config/awards.yml` and revalidated through the details
  endpoint. Cannes 1967 Grand Prix winner `ACCIDENT` is pinned to Joseph
  Losey's released feature `movie:74544`; this prevents generic title search
  drift from failing the weekly authoritative refresh or selecting a namesake.
- Spain is exactly `ES`. Latin America is the reviewed origin union
  `MX|GT|HN|SV|NI|CR|PA|CU|DO|PR|CO|VE|EC|PE|BO|PY|UY|AR|CL|BR` and excludes
  Spain. Portugal is exactly `PT`. None uses an original-language restriction.
- World folder order uses the canonical English cinema names. Portuguese and
  Latin American folders keep their locked IDs and sort as `Portuguese Cinema`
  and `Latin American Cinema` while retaining their Greek display titles.
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
- Ordered typed IDs are authoritative over a stale hash or descriptive scope.
  If the IDs are identical, sync refreshes only the local checkpoint and never
  clears/re-adds the remote list. This applies to schema migrations and ordinary
  fingerprint drift alike.
- Interrupted-run recovery also compares the generated ordered IDs with the
  existing remote list before any clear/add. If TMDB already contains the exact
  candidate, exact v3 read-back restores the checkpoint without another write.
- TMDB list clearing is asynchronous even after its read edge reports zero
  items. If that background clear removes part of a newly accepted write, sync
  performs one bounded rebuild of that list after a longer quiescence window
  and again requires exact v3 ordered read-back. A second mismatch still fails
  closed; partial membership or broad order drift is never accepted.
- The hosted workflow checkpoints per-rail sync progress even when another rail
  fails later in the run. A retry therefore resumes verified writes in place
  and touches only failed/pending rails. The checkpoint is pushed before the
  independent remote audit, so a later audit failure cannot leave the
  repository one day behind already-committed TMDB writes.
- Remote audit retries only its failed subset with a fresh client and bounded
  settling. A repeated mismatch still fails closed; valid rails are never read
  again during retry passes.
- A twice-confirmed same-membership order drift is not silently accepted. The
  guarded repair audit clears only that list after a long quiescence window,
  performs one ordered bulk insertion, and checks both immediate and delayed
  v3 read-back. Because TMDB exposes no position API and reorders even strictly
  sequential inserts, only a settled same-membership displacement of at most
  three places may become the checkpoint; larger drift remains a hard failure.
- The v3 list payload consumed by Nuvio is authoritative for final poster,
  adult/video and release-date eligibility. If it contradicts TMDB details,
  the guarded audit removes and quarantines only the offending typed identity,
  exact-read-backs the remaining order, and checkpoints the filtered list.
- Successful per-list audit repairs are checkpointed even if a different list
  fails later, so a retry never loses an already verified quarantine or order
  repair.
- TMDB may asynchronously swap adjacent `original_order` entries after an exact
  write/read-back, and its v4 item-update endpoint does not support positions.
  Only actor/director Top rails may normalize a twice-confirmed, same-membership
  drift where every item moved at most one adjacent position. Any addition,
  removal, larger displacement, other rail type or non-Top ordering still fails
  closed. The settled remote order becomes the checkpoint so nightly sync does
  not rewrite an equivalent ranking forever.
- A write-schema migration whose verified ordered IDs are unchanged upgrades the
  checkpoint without clearing/re-adding the same remote list.
- TMDB v4 item-level `Media is invalid` and `Media is required` rejections are
  quarantined as typed IDs for 30 days; the rest of the rail is retried and
  exact-read back instead of failing permanently.
- More than 40% change requires a distinct confirmation client. Its cache is
  shared across sibling rails to avoid redundant requests without weakening the
  independent-fetch check.

## Nightly resilience and completion states

- Every rail is an independent mini-transaction. Preparation or reconciliation
  failure in one rail never prevents already-safe candidates for other rails
  from being processed and exactly verified.
- `held-last-known-good` is a safe degraded state, not a successful refresh. It
  is allowed only for a non-empty checkpoint with `syncStatus=verified`, unique
  typed ordered IDs, an unchanged rail-definition fingerprint, and a new exact
  v3 read-back matching that checkpoint. A legacy write-schema-5 checkpoint may
  use this once during the definition-fingerprint migration; the same run
  checkpoints the explicit fingerprint for every successfully evaluated rail.
- A definition fingerprint covers the complete rail registration, relevant
  provider/curated-studio data, award route and the materialization contract
  version. A changed predicate must materialize successfully; it may not
  silently retain content generated under the old predicate. Versioned award
  source revisions are tracked separately, so a newly published snapshot that
  cannot yet resolve may safely retain the previously verified history while
  surfacing a degraded refresh.
- A failed clear/add/rebuild may become `held-last-known-good` only after an
  exact typed rollback to the previous ordered IDs and an independent fresh v3
  confirmation. Missing, empty, reordered, mixed or untyped rollback data is a
  hard failure.
- Hard failures remain hard failures and keep the workflow red. The independent
  remote audit still runs, records bounded initial-failure samples, retries only
  the failed subset with fresh clients and checkpoints any verified repairs.
- Reports distinguish `failed` from `preservedLastKnownGood`. State records
  `lastCompletedSync`, `lastSuccessfulSync`, and `lastFullyFreshSync`; only a
  run with neither hard failures nor preserved rails advances the last value.
- Versioned Academy/Cannes inputs refresh their rails only when their snapshot,
  route or reviewed overrides change. Live TMDB award authorities retain the
  periodic refresh window. A failed static refresh is backed off for the same
  source fingerprint, while a changed source bypasses the backoff immediately.
- Nightly execution never retries an ambiguous list creation, never invents
  filler, never treats an API failure as empty, and never reports a remote write
  as verified before exact v3 typed read-back.

## Release evidence checklist

Record current evidence in `reports/latest.json` and README, never only in chat:

- bootstrap counts match constants and every non-recommended folder is non-empty;
- all 65 tests pass, including exact rollback, definition-matched
  last-known-good preservation and versioned award refresh behavior;
- audit passes folder/recommended locks, source counts and compatibility rules;
- full live dry-run considers all 2,675 materialized rails with zero failures
  and zero empty candidates;
- production updates pass exact read-back and leave zero active empty rails;
- `npm run audit:remote` validates all 2,675 remote lists with zero failures;
- compiled `dist/nuvio-collections-v5.0.1.json` contains 2,677 sources;
- the reviewed historical Nuvio profile report records 987 managed media-type
  mismatches; the current artifact contains 1,153 TV LIST sources and the
  post-import export must record zero mismatches;
- secret scan finds no credentials in tracked files.
