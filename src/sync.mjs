import { INPUT_FILE, RAILS_FILE, PROVIDERS_FILE, AWARDS_FILE, CURATED_STUDIO_FEATURES_FILE, STATE_FILE, REPORT_FILE, EXPECTED } from "./constants.mjs";
import { readJson, writeJson, fingerprint, athensDate, invariant, normalizeText, mapLimit } from "./utils.mjs";
import { TmdbClient } from "./tmdb.mjs";
import { materializeRail, requireEligibleReleasedItems, requireUsablePosters } from "./materialize.mjs";

function itemIds(items, media) { return items.map((x) => `${x.media_type ?? media}:${x.id}`); }
export const WRITE_SCHEMA_VERSION = 5;
export function normalizeCandidateItems(items, media) {
  const seen = new Set();
  return items.map((item) => ({ ...item, media_type: item.media_type ?? media })).filter((item) => {
    const identity = `${item.media_type}:${item.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}
export function orderedIdsEqual(before, after) {
  return Array.isArray(before) && before.length === after.length && before.every((identity, index) => identity === after[index]);
}
export function adjacentOrderEquivalent(before, after) {
  if (!Array.isArray(before) || before.length !== after.length || new Set(before).size !== before.length || new Set(after).size !== after.length) return false;
  const positions = new Map(after.map((identity, index) => [identity, index]));
  return before.every((identity, index) => positions.has(identity) && Math.abs(positions.get(identity) - index) <= 1);
}
export function permitsTmdbAdjacentOrderNormalization(rail) {
  return ["person_cast", "person_director"].includes(rail.materializer)
    && rail.params?.legacy?.sortBy === "vote_average.desc";
}
function changeRatio(before, after) { const a = new Set(before), b = new Set(after); if (!a.size) return b.size ? 1 : 0; let changed = 0; for (const x of a) if (!b.has(x)) changed++; for (const x of b) if (!a.has(x)) changed++; return changed / Math.max(a.size, b.size, 1); }
export function confirmationCompatible(before, after) {
  const a = new Set(before), b = new Set(after);
  let changed = 0; for (const value of a) if (!b.has(value)) changed++; for (const value of b) if (!a.has(value)) changed++;
  return changed <= 2 || changed / Math.max(a.size, b.size, 1) <= 0.1;
}
export function semanticRefreshDue(prior, now = new Date(), days = Number(process.env.NUVIO_AWARD_REFRESH_DAYS ?? 7)) {
  const refreshedAt = prior.lastSemanticRefresh ?? prior.lastVerified;
  const timestamp = Date.parse(refreshedAt);
  return !refreshedAt || !Number.isFinite(timestamp) || now.getTime() - timestamp >= Math.max(1, days) * 86400000;
}
function description(rail, folderTitle, scope, date) {
  const suffix = ` • key ${rail.key}`;
  const prefix = `Συλλογή Nuvio «${folderTitle} — ${rail.title}» • ${rail.mediaType} • ${scope} • επαληθεύτηκε ${date}`;
  return `${prefix.slice(0, Math.max(0, 300 - suffix.length))}${suffix}`;
}
function managedKey(value) { return String(value ?? "").match(/(?:^| • )key ([^•]+)$/)?.[1]?.trim() ?? null; }
function publicListName(rail, folderTitle) { return `${folderTitle} — ${rail.title}`.slice(0, 100); }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ReadbackMismatchError extends Error {
  constructor(listId, expected, actual) {
    let firstDifference = 0;
    while (firstDifference < expected.length && firstDifference < actual.length && expected[firstDifference] === actual[firstDifference]) firstDifference++;
    super(`Read-back mismatch after eventual-consistency polling for list ${listId}: expected ${expected.length}, received ${actual.length}, first difference ${firstDifference}`);
    this.name = "ReadbackMismatchError";
    this.code = "TMDB_READBACK_MISMATCH";
    this.listId = listId;
    this.expectedCount = expected.length;
    this.actualCount = actual.length;
    this.firstDifference = firstDifference;
  }
}

export async function verifyReadback(client, listId, expected, { attempts = 8, waitImpl = wait } = {}) {
  let actual = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const readback = await client.listV3All(listId);
    const readbackItems = readback.items ?? [];
    if (readbackItems.some((item) => !["movie", "tv"].includes(item.media_type))) throw new Error(`Typed v3 read-back missing media_type for list ${listId}`);
    actual = readbackItems.map((item) => `${item.media_type}:${item.id}`);
    if (orderedIdsEqual(expected, actual)) return;
    if (attempt < attempts - 1) await waitImpl(Math.min(30000, 1000 * 2 ** attempt));
  }
  throw new ReadbackMismatchError(listId, expected, actual);
}

async function reconcile(client, listId, items, oldItems, { knownEmpty = false, clearSettleMs = Number(process.env.TMDB_CLEAR_SETTLE_MS ?? 10000), readbackAttempts = 8, waitImpl = wait } = {}) {
  const clearAndConfirm = async () => {
    await client.clearList(listId);
    for (let attempt = 0; attempt < 8; attempt++) {
      if ((await client.listV4All(listId)).results.length === 0) {
        // The read edge can report empty before the list-write backend releases
        // old item identities/order slots. Allow the clear to settle before add.
        await waitImpl(Math.max(1000, clearSettleMs));
        return;
      }
      if (attempt < 7) await waitImpl(Math.min(30000, 1000 * 2 ** attempt));
    }
    throw new Error(`Clear did not converge for list ${listId}`);
  };
  try { if (!knownEmpty) await clearAndConfirm(); await client.addItems(listId, items); }
  catch (error) { try { await clearAndConfirm(); await client.addItems(listId, oldItems); } catch (rollback) { error.message += `; ROLLBACK FAILED: ${rollback.message}`; } throw error; }
  await verifyReadback(client, listId, itemIds(items), { attempts: readbackAttempts, waitImpl });
}

export async function reconcileWithReadbackRecovery(client, listId, items, oldItems, { knownEmpty = false, waitImpl = wait } = {}) {
  try {
    // Most writes settle promptly. Keep the fast path short so a background
    // clear cannot consume 90 seconds of identical partial read-backs.
    await reconcile(client, listId, items, oldItems, {
      knownEmpty,
      readbackAttempts: Math.max(1, Number(process.env.NUVIO_INITIAL_READBACK_ATTEMPTS ?? 4)),
      waitImpl,
    });
  } catch (error) {
    if (error.code !== "TMDB_READBACK_MISMATCH") throw error;
    // TMDB's clear endpoint can report an empty list before its asynchronous
    // deletion has finished. In that race, the still-running clear removes
    // some or all of the newly accepted items. Rebuild only the affected list
    // after a longer quiescence window, then require the same exact v3 order.
    console.error(`[sync] list ${listId} remained partial after its first write (${error.actualCount}/${error.expectedCount}); rebuilding after clear quiescence`);
    await reconcile(client, listId, items, oldItems, {
      knownEmpty: false,
      clearSettleMs: Math.max(1000, Number(process.env.TMDB_CLEAR_RECOVERY_SETTLE_MS ?? 45000)),
      readbackAttempts: Math.max(1, Number(process.env.NUVIO_RECOVERY_READBACK_ATTEMPTS ?? 8)),
      waitImpl,
    });
  }
}

export async function sync({ execute = false, force = false, client = new TmdbClient() } = {}) {
  const syncStartedAt = performance.now();
  if (execute) invariant(process.env.CONFIRM_TMDB_LIST_WRITES === "NUVIO-TMDB-LISTS", "Explicit TMDB write confirmation missing");
  const [input, manifest, providers, awards, curatedStudios, state] = await Promise.all([readJson(INPUT_FILE), readJson(RAILS_FILE), readJson(PROVIDERS_FILE), readJson(AWARDS_FILE), readJson(CURATED_STUDIO_FEATURES_FILE), readJson(STATE_FILE)]);
  const today = athensDate(), folderMap = new Map(input.flatMap((c) => c.folders).map((f) => [f.id, f]));
  const awardMap = new Map(awards.rails.map((x) => [x.key, x]));
  state.rails ??= {};
  let checkpointChain = Promise.resolve();
  const checkpointState = () => (checkpointChain = checkpointChain.then(() => writeJson(STATE_FILE, state)));
  if (execute) {
    // Recover lists created by an interrupted run from their deterministic key.
    // This happens before any creation, so restart never blindly duplicates them.
    const managedRails = manifest.rails.filter((rail) => rail.strategy === "materialized");
    const allowedKeys = new Set(managedRails.map((rail) => rail.key));
    const accountLists = await client.accountListsAll();
    const keyedLists = accountLists.filter((list) => allowedKeys.has(managedKey(list.description)));
    const grouped = Map.groupBy(keyedLists, (list) => managedKey(list.description));
    const duplicates = [...grouped].filter(([, lists]) => lists.length !== 1);
    invariant(!duplicates.length, `Managed-list ownership preflight found duplicate keys: ${duplicates.slice(0, 5).map(([key, lists]) => `${key}=${lists.length}`).join(", ")}`);
    let recovered = false;
    for (const rail of managedRails) {
      const found = grouped.get(rail.key)?.[0];
      const prior = state.rails[rail.key] ?? {};
      if (found && prior.listId !== found.id) {
        state.rails[rail.key] = { ...prior, listId: found.id, syncStatus: prior.fingerprint ? "verified" : "discovered", discoveredAt: new Date().toISOString() };
        recovered = true;
      } else if (!found && prior.listId) {
        state.rails[rail.key] = { syncStatus: "missing", missingAt: new Date().toISOString() };
        recovered = true;
      }
    }
    if (recovered) await checkpointState();
    console.error(`[sync] ownership recovery: ${keyedLists.length}/${managedRails.length} managed lists discovered, 0 duplicate keys`);
  }
  // Only list IDs recorded after a successful authenticated sync are writable.
  // Manifest IDs may point at public lists owned by third parties and are input
  // references, never production write targets.
  const unresolved = manifest.rails.filter((r) => r.strategy === "materialized" && !state.rails[r.key]?.listId);
  if (execute && unresolved.length) {
    const approvedMaximum = Number(process.env.ALLOW_TMDB_LIST_BOOTSTRAP);
    const recoveredCount = manifest.rails.filter((r) => r.strategy === "materialized" && state.rails[r.key]?.listId).length;
    invariant(Number.isInteger(approvedMaximum) && unresolved.length <= approvedMaximum && recoveredCount + unresolved.length <= approvedMaximum, `Bootstrap guard: ${unresolved.length} missing plus ${recoveredCount} recovered exceeds approved maximum ${approvedMaximum}`);
  }
  if (execute) invariant(awards.rails.every((x) => x.cannesCategory || x.oscarCategory || (x.categoryId && x.categorySlug)), "Awards preflight failed: all 60 authoritative category mappings must be resolved before any remote write");
  state.providerIndex ??= { availability: {}, lastFullReconciliation: null };
  const lastFull = state.providerIndex.lastFullReconciliation, fullDue = !lastFull || Date.now() - Date.parse(lastFull) >= 7 * 86400000;
  if (!fullDue) for (const [key, value] of Object.entries(state.providerIndex.availability ?? {})) client.memo.set(key, value);
  const changedIdentities = new Set();
  if (state.lastSuccessfulSync) {
    const start = state.lastSuccessfulSync.slice(0, 10);
    for (const media of ["movie", "tv"]) for (const id of await client.changedIds(media, start, today)) {
      changedIdentities.add(`${media}:${id}`);
      client.memo.delete(`watch:${media}:${id}`);
    }
  }
  const report = { version: 1, date: today, mode: execute ? "execute" : "dry-run", totals: { considered: 0, changed: 0, skipped: 0, failed: 0, created: 0 }, rails: [] };
  const managedRails = manifest.rails.filter((x) => x.strategy === "materialized");
  const concurrency = Math.max(1, Math.min(Number(process.env.NUVIO_SYNC_CONCURRENCY ?? 6), 12));
  // A distinct client preserves independent-fetch confirmation while sharing
  // that second snapshot across sibling rails (for example six rails/person).
  // Creating one client per rail defeats coalescing and turns a global semantic
  // migration into thousands of duplicate TMDB requests.
  const confirmationClient = new TmdbClient({ readToken: client.readToken, userToken: client.userToken, language: client.language, fetchImpl: client.fetchImpl });
  let prepared = await mapLimit(managedRails, concurrency, async (rail) => {
    const startedAt = performance.now();
    const prior = state.rails[rail.key] ?? {};
    try {
      const deferredAward = !force && rail.materializer === "award" && prior.syncStatus === "verified" && !semanticRefreshDue(prior);
      if (deferredAward && prior.writeSchema === WRITE_SCHEMA_VERSION) {
        return { key: rail.key, status: "unchanged", count: prior.count, scope: prior.scope, refreshDeferred: "verified-award-snapshot", _durationMs: Math.round(performance.now() - startedAt) };
      }
      const folderTitle = folderMap.get(rail.folderId)?.title ?? "";
      const provider = providers.providers.find((p) => { const target = normalizeText(folderTitle); return [p.name, p.slug, ...p.aliases].some((name) => target.includes(normalizeText(name)) || normalizeText(name).includes(target)); });
      const context = { today, folderTitle, providerAliases: provider ? [provider.name, ...provider.aliases] : [], award: awardMap.get(rail.key), curatedStudio: curatedStudios.entries[rail.params.curatedStudioFolderId], authorityOverrides: awards.authorityOverrides ?? {}, nonWorkWinners: awards.nonWorkWinners ?? [] };
      const media = rail.mediaType === "MOVIE" ? "movie" : "tv";
      // A write-schema migration must not force a fresh fuzzy title resolution
      // of immutable award history. Reuse the already verified typed IDs, run
      // the new item-level invariants, and keep the authoritative weekly refresh.
      let candidate = deferredAward
        ? { scope: prior.scope, items: (prior.orderedIds ?? []).map((identity) => { const [type, id] = identity.split(":"); return { id: Number(id), media_type: type }; }) }
        : await materializeRail(client, rail, context);
      invariant(!deferredAward || candidate.items.length === prior.count, `Verified award state is incomplete: ${rail.key}`);
      candidate = { ...candidate, items: normalizeCandidateItems(candidate.items, media) };
      const knownIdentities = new Set(prior.orderedIds ?? []);
      const candidateBeforeEligibilityGate = candidate.items.length;
      candidate.items = await requireEligibleReleasedItems(client, candidate.items, media, today, { verifyIdentities: changedIdentities, knownIdentities });
      let ineligibleExcluded = candidateBeforeEligibilityGate - candidate.items.length;
      const candidateBeforePosterGate = candidate.items.length;
      candidate.items = await requireUsablePosters(client, candidate.items, media);
      let posterlessExcluded = candidateBeforePosterGate - candidate.items.length;
      const invalidItems = (prior.invalidItems ?? []).filter((item) => Date.now() - Date.parse(item.excludedAt) < 30 * 86400000);
      const invalidIdentities = new Set(invalidItems.map((item) => `${item.media_type}:${item.id}`));
      candidate.items = candidate.items.filter((item) => !invalidIdentities.has(`${item.media_type}:${item.id}`));
      invariant(candidate.items.every((item) => item.media_type === media), `Mixed media candidate: ${rail.key}`);
      invariant(candidate.items.length > 0, `Empty candidate after semantic and poster validation: ${rail.key}`);
      let ids = itemIds(candidate.items, media), hash = fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids }), ratio = changeRatio(prior.orderedIds ?? [], ids);
      if (ratio > 0.4 && prior.orderedIds?.length) {
        let confirm = await materializeRail(confirmationClient, rail, context);
        confirm = { ...confirm, items: normalizeCandidateItems(confirm.items, media) };
        const confirmBeforeEligibilityGate = confirm.items.length;
        confirm.items = await requireEligibleReleasedItems(confirmationClient, confirm.items, media, today, { verifyIdentities: changedIdentities, knownIdentities });
        ineligibleExcluded = confirmBeforeEligibilityGate - confirm.items.length;
        const confirmBeforePosterGate = confirm.items.length;
        confirm.items = await requireUsablePosters(confirmationClient, confirm.items, media);
        posterlessExcluded = confirmBeforePosterGate - confirm.items.length;
        confirm.items = confirm.items.filter((item) => !invalidIdentities.has(`${item.media_type}:${item.id}`));
        invariant(confirm.items.length > 0, `Empty confirmation after semantic and poster validation: ${rail.key}`);
        const confirmIds = itemIds(confirm.items, media), confirmationRatio = changeRatio(ids, confirmIds);
        invariant(confirm.scope === candidate.scope && confirmationCompatible(ids, confirmIds), `Large-change confirmation differed semantically: ${rail.key} (${candidate.scope}/${confirm.scope}, ratio ${confirmationRatio})`);
        candidate = confirm; ids = confirmIds; hash = fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids }); ratio = changeRatio(prior.orderedIds ?? [], ids);
      }
      const _durationMs = Math.round(performance.now() - startedAt);
      const semanticRefreshedAt = rail.materializer === "award" ? new Date().toISOString() : prior.lastSemanticRefresh;
      if (execute && rail.materializer === "award" && prior.fingerprint === hash) {
        state.rails[rail.key] = { ...prior, lastSemanticRefresh: semanticRefreshedAt };
        await checkpointState();
      }
      const sameOrderedIds = orderedIdsEqual(prior.orderedIds, ids);
      const serverOrderEquivalent = permitsTmdbAdjacentOrderNormalization(rail) && adjacentOrderEquivalent(prior.orderedIds, ids);
      // Ordered typed IDs are the write contract. A stale fingerprint, scope
      // description, or schema checkpoint must never clear/re-add an identical
      // remote list. Refresh the checkpoint locally and skip every TMDB write.
      if (prior.syncStatus === "verified" && (sameOrderedIds || serverOrderEquivalent)) {
        const checkpointDrift = prior.fingerprint !== hash || prior.writeSchema !== WRITE_SCHEMA_VERSION || prior.scope !== candidate.scope || prior.ineligibleExcluded !== ineligibleExcluded || prior.posterlessExcluded !== posterlessExcluded;
        if (execute && checkpointDrift) {
          state.rails[rail.key] = { ...prior, fingerprint: hash, count: ids.length, scope: candidate.scope, writeSchema: WRITE_SCHEMA_VERSION, ineligibleExcluded, posterlessExcluded, lastVerified: new Date().toISOString(), ...(semanticRefreshedAt ? { lastSemanticRefresh: semanticRefreshedAt } : {}) };
          await checkpointState();
        }
        return { key: rail.key, status: "unchanged", count: ids.length, scope: candidate.scope, ineligibleExcluded, posterlessExcluded, ...(checkpointDrift ? { checkpointRefresh: true } : {}), ...(serverOrderEquivalent && !sameOrderedIds ? { serverOrderEquivalent: true } : {}), _durationMs };
      }
      if (!force && prior.syncStatus === "verified" && prior.fingerprint === hash) return { key: rail.key, status: "unchanged", count: ids.length, scope: candidate.scope, ineligibleExcluded, posterlessExcluded, _durationMs };
      return { key: rail.key, status: "would-update", listId: prior.listId, count: ids.length, scope: candidate.scope, ineligibleExcluded, posterlessExcluded, changeRatio: ratio, _durationMs, _rail: rail, _folderTitle: folderTitle, _candidate: candidate, _media: media, _ids: ids, _hash: hash, _invalidItems: invalidItems, _semanticRefreshedAt: semanticRefreshedAt };
    } catch (error) { return { key: rail.key, status: "failed", error: error.message, _durationMs: Math.round(performance.now() - startedAt) }; }
  });
  const preparationFailures = prepared.filter((x) => x.status === "failed");
  for (const failure of preparationFailures) console.error(`[sync] PREPARATION FAILED ${failure.key}: ${failure.error}`);
  if (execute && !preparationFailures.length) {
    // Each rail is a durable mini-transaction: recover/create, checkpoint,
    // populate, exact read-back, checkpoint. Interrupted runs resume in place.
    // Workers often wait for TMDB edge visibility; HTTP concurrency remains
    // independently capped by TmdbClient, so extra workers improve pipelining
    // without increasing simultaneous API requests beyond that cap.
    const writeConcurrency = Math.max(1, Math.min(Number(process.env.NUVIO_SYNC_WRITE_CONCURRENCY ?? 16), 24));
    const updateTotal = prepared.filter((entry) => entry.status === "would-update").length;
    let verifiedProgress = 0;
    prepared = await mapLimit(prepared, writeConcurrency, async (entry) => {
      if (entry.status !== "would-update") return entry;
      try {
        if (!entry.listId) {
          try {
            const created = await client.createList(publicListName(entry._rail, entry._folderTitle), description(entry._rail, entry._folderTitle, entry.scope, today), entry._media);
            entry.listId = created.id;
            entry.createdList = true;
          } catch (createError) {
            // A response may be lost after TMDB committed the POST. Discover by
            // deterministic key instead of issuing a second create request.
            const matches = (await client.accountListsAll()).filter((list) => managedKey(list.description) === entry.key);
            invariant(matches.length === 1, `Ambiguous create for ${entry.key}: ${createError.message}; discovered ${matches.length} lists`);
            entry.listId = matches[0].id;
            entry.recoveredCreate = true;
          }
          state.rails[entry.key] = { ...(state.rails[entry.key] ?? {}), listId: entry.listId, syncStatus: "created", createdAt: new Date().toISOString() };
          await checkpointState();
          // TMDB can return a committed list ID before the list is readable on
          // the v4 edge. Never issue clear/add until ownership is observable.
          if (entry.createdList) {
            let visible = false;
            for (let attempt = 0; attempt < 8; attempt++) {
              try { await client.listV4(entry.listId); visible = true; break; }
              catch (error) {
                if (!/\b404\b/.test(error.message) || attempt === 7) throw error;
                await wait(Math.min(30000, 1000 * 2 ** attempt));
              }
            }
            invariant(visible, `Created list did not become visible: ${entry.listId}`);
          }
        }
        let oldItems = [];
        if (!entry.createdList) {
          try { const old = await client.listV4All(entry.listId); oldItems = (old.results ?? []).map((x) => ({ id: x.id, media_type: x.media_type ?? entry._media })); }
          catch { const old = await client.listV3All(entry.listId); oldItems = (old.items ?? []).map((x) => ({ id: x.id, media_type: x.media_type ?? entry._media })); }
        }
        // A previous runner may have completed and exact-read-backed the TMDB
        // write but exited before its local checkpoint was pushed. Recover that
        // already-correct remote list instead of clearing and rewriting it.
        if (!entry.createdList && orderedIdsEqual(itemIds(oldItems, entry._media), entry._ids)) {
          await verifyReadback(client, entry.listId, entry._ids);
          state.rails[entry.key] = { listId: entry.listId, fingerprint: entry._hash, orderedIds: entry._ids, count: entry.count, scope: entry.scope, writeSchema: WRITE_SCHEMA_VERSION, ineligibleExcluded: entry.ineligibleExcluded, posterlessExcluded: entry.posterlessExcluded, syncStatus: "verified", lastVerified: new Date().toISOString(), invalidItems: entry._invalidItems ?? [], ...(entry._semanticRefreshedAt ? { lastSemanticRefresh: entry._semanticRefreshedAt } : {}) };
          await checkpointState();
          return { ...entry, status: "unchanged", checkpointRefresh: true, remoteResume: true };
        }
        try { await reconcileWithReadbackRecovery(client, entry.listId, entry._candidate.items, oldItems, { knownEmpty: Boolean(entry.createdList) }); }
        catch (error) {
          if (!error.invalidItems?.length) throw error;
          const invalidAt = new Date().toISOString();
          const rejected = new Set(error.invalidItems.map((item) => `${item.media_type}:${item.id}`));
          entry._invalidItems = [...(entry._invalidItems ?? []), ...error.invalidItems.map((item) => ({ ...item, excludedAt: invalidAt }))]
            .filter((item, index, values) => values.findIndex((candidate) => candidate.media_type === item.media_type && candidate.id === item.id) === index);
          entry._candidate.items = entry._candidate.items.filter((item) => !rejected.has(`${item.media_type}:${item.id}`));
          entry._ids = itemIds(entry._candidate.items, entry._media); entry.count = entry._ids.length;
          entry._hash = fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids: entry._ids });
          await reconcileWithReadbackRecovery(client, entry.listId, entry._candidate.items, oldItems);
        }
        state.rails[entry.key] = { listId: entry.listId, fingerprint: entry._hash, orderedIds: entry._ids, count: entry.count, scope: entry.scope, writeSchema: WRITE_SCHEMA_VERSION, ineligibleExcluded: entry.ineligibleExcluded, posterlessExcluded: entry.posterlessExcluded, syncStatus: "verified", lastVerified: new Date().toISOString(), invalidItems: entry._invalidItems ?? [], ...(entry._semanticRefreshedAt ? { lastSemanticRefresh: entry._semanticRefreshedAt } : {}) };
        await checkpointState();
        verifiedProgress++;
        if (verifiedProgress === 1 || verifiedProgress % 25 === 0 || verifiedProgress === updateTotal) console.error(`[sync] verified ${verifiedProgress}/${updateTotal} rails; latest=${entry.key}; items=${entry.count}`);
        return { ...entry, status: "updated" };
      } catch (error) {
        state.rails[entry.key] = { ...(state.rails[entry.key] ?? {}), listId: entry.listId, syncStatus: "failed", lastError: error.message, lastAttempt: new Date().toISOString() };
        await checkpointState();
        console.error(`[sync] FAILED ${entry.key}: ${error.message}`);
        return { key: entry.key, listId: entry.listId, status: "failed", error: error.message, ...(error.code === "TMDB_READBACK_MISMATCH" ? { expectedCount: error.expectedCount, actualCount: error.actualCount, firstDifference: error.firstDifference } : {}) };
      }
    });
  }
  if (execute && preparationFailures.length) prepared = prepared.map((entry) => entry.status === "would-update" ? { ...entry, status: "validated-no-write" } : entry);
  report.performance = {
    totalMs: Math.round(performance.now() - syncStartedAt),
    slowestRails: [...prepared].sort((a, b) => b._durationMs - a._durationMs).slice(0, 20).map((entry) => ({ key: entry.key, durationMs: entry._durationMs })),
  };
  report.rails = prepared.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("_"))));
  report.rails.sort((a, b) => a.key.localeCompare(b.key));
  report.totals.considered = report.rails.length;
  report.totals.failed = report.rails.filter((x) => x.status === "failed").length;
  report.totals.skipped = report.rails.filter((x) => x.status === "unchanged").length;
  report.totals.changed = report.rails.filter((x) => execute ? x.status === "updated" : x.status === "would-update").length;
  report.totals.created = report.rails.filter((x) => x.createdList).length;
  report.totals.ineligibleExcluded = report.rails.reduce((sum, rail) => sum + Number(rail.ineligibleExcluded ?? 0), 0);
  report.totals.posterlessExcluded = report.rails.reduce((sum, rail) => sum + Number(rail.posterlessExcluded ?? 0), 0);
  invariant(report.totals.considered === EXPECTED.materialized, "Sync did not consider every materialized rail");
  if (execute) {
    // The worldwide watch memo can exceed V8's maximum JSON string size. Keep
    // only bounded reconciliation metadata in sync-state; the availability
    // cache is rebuilt safely until it is moved to a streaming store.
    state.providerIndex.availability = {};
    state.providerIndex.observedWatchEntries = [...client.memo.keys()].filter((key) => key.startsWith("watch:")).length;
    if (fullDue) state.providerIndex.lastFullReconciliation = new Date().toISOString();
    state.lastSuccessfulSync = report.totals.failed ? state.lastSuccessfulSync : new Date().toISOString(); await writeJson(STATE_FILE, state);
  }
  await writeJson(REPORT_FILE, report);
  if (report.totals.failed) throw new Error(`Sync failed closed: ${report.totals.failed} rails failed; see ${REPORT_FILE}`);
  return report;
}
