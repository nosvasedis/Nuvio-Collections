import { INPUT_FILE, RAILS_FILE, PROVIDERS_FILE, AWARDS_FILE, STATE_FILE, REPORT_FILE, EXPECTED } from "./constants.mjs";
import { readJson, writeJson, fingerprint, athensDate, invariant, normalizeText, mapLimit } from "./utils.mjs";
import { TmdbClient } from "./tmdb.mjs";
import { materializeRail } from "./materialize.mjs";

function itemIds(items, media) { return items.map((x) => `${x.media_type ?? media}:${x.id}`); }
const WRITE_SCHEMA_VERSION = 2;
export function normalizeCandidateItems(items, media) {
  const seen = new Set();
  return items.map((item) => ({ ...item, media_type: item.media_type ?? media })).filter((item) => {
    const identity = `${item.media_type}:${item.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}
function changeRatio(before, after) { const a = new Set(before), b = new Set(after); if (!a.size) return b.size ? 1 : 0; let changed = 0; for (const x of a) if (!b.has(x)) changed++; for (const x of b) if (!a.has(x)) changed++; return changed / Math.max(a.size, b.size, 1); }
function description(rail, folderTitle, scope, date) {
  const suffix = ` • key ${rail.key}`;
  const prefix = `Συλλογή Nuvio «${folderTitle} — ${rail.title}» • ${rail.mediaType} • ${scope} • επαληθεύτηκε ${date}`;
  return `${prefix.slice(0, Math.max(0, 300 - suffix.length))}${suffix}`;
}
function managedKey(value) { return String(value ?? "").match(/(?:^| • )key ([^•]+)$/)?.[1]?.trim() ?? null; }
function publicListName(rail, folderTitle) { return `${folderTitle} — ${rail.title}`.slice(0, 100); }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reconcile(client, listId, items, oldItems, { knownEmpty = false } = {}) {
  const clearAndConfirm = async () => {
    await client.clearList(listId);
    for (let attempt = 0; attempt < 8; attempt++) {
      if ((await client.listV4All(listId)).results.length === 0) {
        // The read edge can report empty before the list-write backend releases
        // old item identities/order slots. Allow the clear to settle before add.
        await wait(Math.max(1000, Number(process.env.TMDB_CLEAR_SETTLE_MS ?? 10000)));
        return;
      }
      if (attempt < 7) await wait(Math.min(30000, 1000 * 2 ** attempt));
    }
    throw new Error(`Clear did not converge for list ${listId}`);
  };
  try { if (!knownEmpty) await clearAndConfirm(); await client.addItems(listId, items); }
  catch (error) { try { await clearAndConfirm(); await client.addItems(listId, oldItems); } catch (rollback) { error.message += `; ROLLBACK FAILED: ${rollback.message}`; } throw error; }
  const expected = itemIds(items);
  for (let attempt = 0; attempt < 8; attempt++) {
    const readback = await client.listV3All(listId), actual = itemIds(readback.items ?? []);
    if (expected.length === actual.length && expected.every((identity, i) => identity === actual[i])) return;
    if (attempt < 7) await wait(Math.min(30000, 1000 * 2 ** attempt));
  }
  throw new Error(`Read-back mismatch after eventual-consistency polling for list ${listId}`);
}

export async function sync({ execute = false, force = false, client = new TmdbClient() } = {}) {
  if (execute) invariant(process.env.CONFIRM_TMDB_LIST_WRITES === "NUVIO-TMDB-LISTS", "Explicit TMDB write confirmation missing");
  const [input, manifest, providers, awards, state] = await Promise.all([readJson(INPUT_FILE), readJson(RAILS_FILE), readJson(PROVIDERS_FILE), readJson(AWARDS_FILE), readJson(STATE_FILE)]);
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
  if (!fullDue && state.lastSuccessfulSync) {
    const start = state.lastSuccessfulSync.slice(0, 10);
    for (const media of ["movie", "tv"]) for (const id of await client.changedIds(media, start, today)) client.memo.delete(`watch:${media}:${id}`);
  }
  const report = { version: 1, date: today, mode: execute ? "execute" : "dry-run", totals: { considered: 0, changed: 0, skipped: 0, failed: 0, created: 0 }, rails: [] };
  const managedRails = manifest.rails.filter((x) => x.strategy === "materialized");
  const concurrency = Math.max(1, Math.min(Number(process.env.NUVIO_SYNC_CONCURRENCY ?? 6), 12));
  let prepared = await mapLimit(managedRails, concurrency, async (rail) => {
    const prior = state.rails[rail.key] ?? {};
    try {
      const folderTitle = folderMap.get(rail.folderId)?.title ?? "";
      const provider = providers.providers.find((p) => { const target = normalizeText(folderTitle); return [p.name, p.slug, ...p.aliases].some((name) => target.includes(normalizeText(name)) || normalizeText(name).includes(target)); });
      const context = { today, folderTitle, providerAliases: provider ? [provider.name, ...provider.aliases] : [], award: awardMap.get(rail.key), authorityOverrides: awards.authorityOverrides ?? {}, nonWorkWinners: awards.nonWorkWinners ?? [] };
      let candidate = await materializeRail(client, rail, context); const media = rail.mediaType === "MOVIE" ? "movie" : "tv";
      candidate = { ...candidate, items: normalizeCandidateItems(candidate.items, media) };
      invariant(candidate.items.every((item) => item.media_type === media), `Mixed media candidate: ${rail.key}`);
      const ids = itemIds(candidate.items, media), hash = fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids }), ratio = changeRatio(prior.orderedIds ?? [], ids);
      if (ratio > 0.4 && prior.orderedIds?.length) { const independent = new TmdbClient({ readToken: client.readToken, userToken: client.userToken, fetchImpl: client.fetchImpl }); let confirm = await materializeRail(independent, rail, context); confirm = { ...confirm, items: normalizeCandidateItems(confirm.items, media) }; invariant(fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids: itemIds(confirm.items, media) }) === hash, `Large-change confirmation differed: ${rail.key}`); candidate = confirm; }
      if (!force && prior.syncStatus === "verified" && prior.fingerprint === hash) return { key: rail.key, status: "unchanged", count: ids.length, scope: candidate.scope };
      return { key: rail.key, status: "would-update", listId: prior.listId, count: ids.length, scope: candidate.scope, changeRatio: ratio, _rail: rail, _folderTitle: folderTitle, _candidate: candidate, _media: media, _ids: ids, _hash: hash };
    } catch (error) { return { key: rail.key, status: "failed", error: error.message }; }
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
        await reconcile(client, entry.listId, entry._candidate.items, oldItems, { knownEmpty: Boolean(entry.createdList) });
        state.rails[entry.key] = { listId: entry.listId, fingerprint: entry._hash, orderedIds: entry._ids, count: entry.count, scope: entry.scope, syncStatus: "verified", lastVerified: new Date().toISOString() };
        await checkpointState();
        verifiedProgress++;
        if (verifiedProgress === 1 || verifiedProgress % 25 === 0 || verifiedProgress === updateTotal) console.error(`[sync] verified ${verifiedProgress}/${updateTotal} rails; latest=${entry.key}; items=${entry.count}`);
        return { ...entry, status: "updated" };
      } catch (error) {
        state.rails[entry.key] = { ...(state.rails[entry.key] ?? {}), listId: entry.listId, syncStatus: "failed", lastError: error.message, lastAttempt: new Date().toISOString() };
        await checkpointState();
        console.error(`[sync] FAILED ${entry.key}: ${error.message}`);
        return { key: entry.key, listId: entry.listId, status: "failed", error: error.message };
      }
    });
  }
  if (execute && preparationFailures.length) prepared = prepared.map((entry) => entry.status === "would-update" ? { ...entry, status: "validated-no-write" } : entry);
  report.rails = prepared.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("_"))));
  report.rails.sort((a, b) => a.key.localeCompare(b.key));
  report.totals.considered = report.rails.length;
  report.totals.failed = report.rails.filter((x) => x.status === "failed").length;
  report.totals.skipped = report.rails.filter((x) => x.status === "unchanged").length;
  report.totals.changed = report.rails.filter((x) => execute ? x.status === "updated" : x.status === "would-update").length;
  report.totals.created = report.rails.filter((x) => x.createdList).length;
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
