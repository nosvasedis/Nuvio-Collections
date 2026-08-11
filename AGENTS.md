# Nuvio Collections contributor contract

Read `docs/SEMANTIC-CONTRACT.md` before changing rail generation, sync logic,
counts, or the generated JSON.

Non-negotiable rules:

- Never delete, merge, or rename any of the 548 active folders. The sole
  approved historical deletion is Genres/Reality (`folder-KQEZGAMF`), removed
  for v5.0.1 with four list tombstones. The remaining original 516, the earlier
  Portuguese/Latin-American additions, and the 30 v5.0.1 additions are
  fingerprint-locked.
- Never edit the two sources in `collections.discover.recommended`; they are
  user-curated and protected by a fingerprint test.
- Do not retire a source without an evidence report and explicit user approval.
  Preserve its list ID and metadata in `state.retiredRails` as a tombstone.
- Materialized lists must be homogeneous, non-empty, released-only where the
  rail says so, ordered as advertised, and contain only titles with a TMDB
  poster.
- Movie studio rails must pass the feature-film details predicate. Preserve the
  four reviewed Disney/Pixar/Illumination/Ghibli baselines and Trakt provenance
  in `data/curated-studio-features.json`; never replace them with a generic
  COMPANY result or admit shorts, documentaries, specials, future releases, or
  unreviewed TV movies.
- Exact v3 read-back must contain an explicit `media_type` for every item. Never
  default a missing type to movie or TV during verification.
- Actor rails use substantive cast credits only. Director rails use only
  case-insensitive `job=Director` credits.
- Preserve stable list IDs. Creation and updates must remain resumable and
  duplicate-safe; never retry an ambiguous create blindly.
- Never commit `.env`, access tokens, API keys, or secret-bearing output.

Before release run, in order:

1. `npm run bootstrap`
2. `npm test`
3. `npm run audit`
4. `npm run sync:dry`
5. production `npm run sync` only with the explicit write guard
6. `npm run compile`
7. `npm run audit`

For releases that repair an already imported profile, also run
`npm run profile:audit -- --profile=<export.json> --write-repair`, import the
generated repair artifact, export the Nuvio profile again, and require zero
media-type mismatches (`mediaTypeMismatches: 0`, `missing: 0`, `extra: 0`,
  13/13 collections). A folder-order-only or import-compatibility change does not
require production TMDB sync.

Do not claim success unless the live dry-run has zero failures and zero empty
candidates and every changed production list passes exact v3 read-back. For
media-type repairs, also require a fresh Nuvio export with zero
`series/MOVIE` LIST drifts.
