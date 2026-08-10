# Nuvio Collections Sync

Deterministic compiler and TMDB-list synchronizer for the Nuvio 0.8.2+
collections JSON. The repository treats Nuvio as the runtime consumer: fields
that Nuvio does not actually forward to TMDB are never emitted as native
filters. Those rails are materialized as public, homogeneous TMDB lists with
`sortBy: original`.

## Safety invariants

- All 12 collections and all 517 folders are preserved.
- `collections.discover.recommended` is deep-equal to the input snapshot.
- No existing rail is deleted; four 2020s summary rails and five homogeneous
  Golden Globes Movie companions are added.
- Remote writes require both `--execute` and
  `CONFIRM_TMDB_LIST_WRITES=NUVIO-TMDB-LISTS`.
- A failed TMDB request never means “zero results” and never triggers the
  Worldwide fallback.
- Production lists are never cleared until a complete candidate has passed
  semantic validation and the large-change guard.

## Commands

```powershell
npm run bootstrap
npm test
npm run audit
npm run capability-probe # temporary list; always cleaned up
npm run validate:awards  # read-only live validation of all 60 award rails
npm run validate:awards:oscars
npm run sync:dry
npm run sync       # remote writes; requires repository secrets
npm run compile    # requires every materialized rail to have a TMDB list ID
```

`bootstrap` mechanically derives `config/rails.yml`, `config/awards.yml`, the
folder lock and the initial state from the released JSON. The `.yml` files use
JSON syntax, which is valid YAML 1.2 and lets the tooling remain dependency-free.

Oscar rails use a versioned winners-only snapshot of the official Academy
Awards Database (`data/academy-awards-winners-2026.json`, SHA-256
`87d3175b6ed03489bd2bb8063ea22f136584f23ab68be19cb7234c2d83a21873`) covering
all 98 ceremonies through award year 2025. The eight official special/honorary
foreign-language-film predecessors are stored separately with their stable
Academy nomination IDs. The runtime fails closed after presentation year 2026
until the official snapshot is reviewed and refreshed; an Academy/WAF failure
can never silently truncate the history.

Golden Globes rails use the official Golden Globes archive plus the mapped
TMDB Awards category histories. Cannes rails use the versioned official
Festival de Cannes retrospective snapshot in
`data/cannes-awards-winners-2026.json`; this avoids hosted-run failures when the
Festival site blocks GitHub runner IPs. The snapshot is complete through 2026
and must be explicitly refreshed and reviewed for later award years. All three authorities resolve to TMDB work IDs under strict
year/title/contributor rules. Ambiguous matches fail closed and require an
explicit, reviewed `authorityOverrides` entry; an override still reads and
verifies the target TMDB endpoint.

The first production run requires `npm run capability-probe` to verify TMDB v4
create/add/read/clear/delete and the same v3 list read path used by Nuvio. The
temporary probe list is deleted even when an intermediate assertion fails.
It also requires a successful live validation of all 2,125 materialized rails.
`ALLOW_TMDB_LIST_BOOTSTRAP` is the explicitly approved maximum number of managed
lists; the ownership preflight refuses a run when recovered plus missing lists
would exceed that cap. Candidate generation completes before any remote write.

Production synchronization is resumable per rail. Every list description ends
with a deterministic rail key. On restart, the account inventory recovers that
list ID before any create call; duplicate keys fail closed. Each rail then runs
as create/recover, durable checkpoint, populate, exact v3 read-back, verified
fingerprint, durable checkpoint. Non-idempotent create requests are never
blindly retried after ambiguous network/server responses. Definitive TMDB spam
validation responses use a serialized cooldown and bounded safe retry.

All candidates are normalized to an explicit homogeneous `movie` or `tv` type
and ordered-deduplicated by `(media_type, TMDB ID)` before fingerprinting. The
write response and the same v3 pagination path used by Nuvio are checked for an
exact typed order match. A failed status is always retried even when a previous
last-known-good fingerprint exists. Atomic state checkpoints retry transient
Windows file locks.

TMDB occasionally returns an item from Discover that its own v4 List API then
rejects as `Media is invalid`. Only that typed error is quarantined; all other
write errors still fail closed. The exact media identity and timestamp are
stored per rail and retried after 30 days, preventing a permanently bad TMDB
record from breaking every nightly run without suppressing future recovery.

`npm run compile` refuses unresolved list IDs. Structural review can use
`node src/cli.mjs compile --allow-placeholders`, which writes an ignored
`*.preview.json` artifact and never overwrites the production JSON.

## Streaming region policy

Each streaming rail is evaluated for Greece first. If and only if the complete,
successful GR candidate is empty, the same predicate is evaluated against the
union of all official TMDB watch regions. Only `flatrate`, `free`, and `ads`
qualify; `rent`/`buy`-only availability never qualifies. GR and Worldwide items
are never mixed in one candidate.

Worldwide materialization queries the provider-filtered Discover endpoint for
every official region advertised by that canonical provider, unions the
results, deduplicates by typed TMDB ID, and ranks only after the union. It never
uses a capped global-title sample. The production concurrency remains bounded
by the TMDB client and honors `Retry-After`; the measured cold calculation of
all 2,125 rails is approximately 2.5 minutes on the current GitHub/local Node 24
configuration. Actual list-write time additionally depends on how many ordered
fingerprints changed because TMDB v4 does not support item reordering.

Watch-provider data is supplied by JustWatch through TMDB. JustWatch and TMDB
attribution is required in the consuming product; repository-only attribution
does not remove that product-level obligation.
