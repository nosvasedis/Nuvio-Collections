import { RAILS_FILE, REMOTE_AUDIT_REPORT_FILE, STATE_FILE, EXPECTED } from "./constants.mjs";
import { TmdbClient } from "./tmdb.mjs";
import { WRITE_SCHEMA_VERSION, adjacentOrderEquivalent, permitsTmdbAdjacentOrderNormalization, verifyReadback } from "./sync.mjs";
import { athensDate, fingerprint, mapLimit, readJson, writeJson } from "./utils.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function remoteAuditRetryDelay(attempt, baseMs = Number(process.env.NUVIO_REMOTE_AUDIT_RETRY_DELAY_MS ?? 5000)) {
  return Math.min(60000, Math.max(1000, Number(baseMs)) * 2 ** Math.max(0, attempt));
}
export function runAuditPass(rails, limit, auditor, auditClient, { allowRepairs = false } = {}) {
  // mapLimit supplies (value, numericIndex). Never pass an auditor that expects
  // a client as its second argument directly, or every first-pass rail receives
  // the numeric index in place of the TMDB client.
  return mapLimit(rails, limit, (rail) => auditor(rail, auditClient, { allowRepairs }));
}

function definitiveNotFound(error) {
  return /\b404\b|status_code["':\s]+34\b|resource you requested could not be found/i.test(String(error?.message ?? error));
}
function identities(items) { return items.map((item) => `${item.media_type}:${item.id}`); }
function equal(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function typedItems(values) { return values.map((identity) => { const [media_type, rawId] = identity.split(":"); return { media_type, id: Number(rawId) }; }); }
export function boundedOrderEquivalent(expected, actual, maximumDisplacement = 3) {
  if (expected.length !== actual.length || new Set(expected).size !== expected.length || new Set(actual).size !== actual.length) return false;
  const allowedDisplacement = Math.min(maximumDisplacement, Math.max(1, Math.ceil(expected.length * 0.1)));
  const positions = new Map(actual.map((identity, index) => [identity, index]));
  return expected.every((identity, index) => positions.has(identity) && Math.abs(positions.get(identity) - index) <= allowedDisplacement);
}

export function v3EligibilityViolations(items, today) {
  const invalidItems = [];
  for (const item of items) {
    const reasons = [];
    const date = item.media_type === "tv" ? item.first_air_date : item.release_date;
    if (!item.poster_path) reasons.push("TMDB_V3_POSTERLESS");
    if (item.adult === true) reasons.push("TMDB_V3_ADULT");
    if (item.video === true) reasons.push("TMDB_V3_VIDEO");
    if (!date) reasons.push("TMDB_V3_UNDATED");
    else if (date > today) reasons.push("TMDB_V3_FUTURE_DATE");
    if (reasons.length && ["movie", "tv"].includes(item.media_type)) invalidItems.push({ media_type: item.media_type, id: item.id, reason: reasons.join("+") });
  }
  return invalidItems;
}

export async function rewriteExactOrder(client, listId, expected, { waitImpl = wait } = {}) {
  await client.clearList(listId);
  for (let attempt = 0; attempt < 8; attempt++) {
    if ((await client.listV4All(listId)).results.length === 0) break;
    if (attempt === 7) throw new Error(`Order-repair clear did not converge for list ${listId}`);
    await waitImpl(Math.min(30000, 1000 * 2 ** attempt));
  }
  await waitImpl(Math.max(1000, Number(process.env.TMDB_ORDER_REPAIR_CLEAR_SETTLE_MS ?? 60000)));
  // One ordered bulk insertion is the closest operation TMDB exposes to
  // custom positioning. Per-item insertion is also asynchronously reordered
  // by the backend and produced substantially worse drift in production.
  await client.addItems(listId, typedItems(expected));
  await verifyReadback(client, listId, expected, { attempts: 8, waitImpl });
  // TMDB may settle into a slightly different original_order after an exact
  // immediate read-back. Preserve membership strictly and accept only the
  // documented bounded displacement after a long delayed confirmation.
  await waitImpl(Math.max(1000, Number(process.env.TMDB_ORDER_REPAIR_STABILITY_MS ?? 60000)));
  const settledItems = (await client.listV3All(listId)).items ?? [];
  if (settledItems.some((item) => !["movie", "tv"].includes(item.media_type))) throw new Error(`Typed v3 order-repair read-back missing media_type for list ${listId}`);
  const settled = identities(settledItems);
  if (!equal(expected, settled) && !boundedOrderEquivalent(expected, settled)) throw new Error(`Order repair did not settle within bounded displacement for list ${listId}`);
  return settled;
}

export async function auditRemoteLists({ execute = false, client = new TmdbClient() } = {}) {
  const [manifest, state] = await Promise.all([readJson(RAILS_FILE), readJson(STATE_FILE)]);
  const rails = manifest.rails.filter((rail) => rail.strategy === "materialized");
  const today = athensDate();
  const auditRail = async (rail, auditClient = client, { allowRepairs = false } = {}) => {
    const prior = state.rails[rail.key];
    try {
      if (!prior?.listId) throw new Error("missing managed list ID");
      const readback = await auditClient.listV3All(prior.listId);
      const items = readback.items ?? [], media = rail.mediaType === "TV" ? "tv" : "movie", actual = identities(items), expected = prior.orderedIds ?? [];
      const violations = {
        empty: items.length === 0,
        missingMediaType: items.filter((item) => !["movie", "tv"].includes(item.media_type)).length,
        mixedMedia: items.filter((item) => item.media_type !== media).length,
        duplicates: items.length - new Set(actual).size,
        posterless: items.filter((item) => !item.poster_path).length,
        adult: items.filter((item) => item.adult === true).length,
        video: items.filter((item) => item.video === true).length,
        future: items.filter((item) => (item.media_type === "tv" ? item.first_air_date : item.release_date) > today).length,
        undated: items.filter((item) => !(item.media_type === "tv" ? item.first_air_date : item.release_date)).length,
      };
      const hardViolation = violations.empty || violations.missingMediaType || violations.mixedMedia || violations.duplicates;
      if (hardViolation) return { key: rail.key, listId: prior.listId, status: "failed", violations };
      const ineligible = v3EligibilityViolations(items, today);
      if (ineligible.length) {
        if (!allowRepairs) return { key: rail.key, listId: prior.listId, status: "failed", error: "v3 eligibility violation requires independent confirmation", violations };
        if (!equal(expected, actual)) return { key: rail.key, listId: prior.listId, status: "failed", error: "v3 eligibility violation coincided with remote identity/order drift", violations };
        const rejected = new Set(ineligible.map((item) => `${item.media_type}:${item.id}`));
        return { key: rail.key, listId: prior.listId, status: "repairable-ineligible", violations, _actual: actual.filter((identity) => !rejected.has(identity)), _invalid: ineligible };
      }
      if (equal(expected, actual)) return { key: rail.key, listId: prior.listId, status: "valid", count: actual.length };
      const added = actual.filter((identity) => !expected.includes(identity));
      const removed = expected.filter((identity) => !actual.includes(identity));
      const confirmation = identities((await auditClient.listV3All(prior.listId)).items ?? []);
      if (!equal(actual, confirmation)) return { key: rail.key, listId: prior.listId, status: "failed", error: "remote drift did not survive independent confirmation", added, removed };
      if (!added.length && !removed.length) {
        if (allowRepairs && permitsTmdbAdjacentOrderNormalization(rail) && adjacentOrderEquivalent(expected, actual)) {
          return { key: rail.key, listId: prior.listId, status: "repairable-order-normalization", count: actual.length, _actual: actual };
        }
        if (allowRepairs) return { key: rail.key, listId: prior.listId, status: "repairable-order-rewrite", count: actual.length };
        return { key: rail.key, listId: prior.listId, status: "failed", error: "unexpected remote order drift", added, removed };
      }
      if (added.length) return { key: rail.key, listId: prior.listId, status: "failed", error: "unexpected remote addition", added, removed };
      const deleted = [];
      for (const identity of removed) {
        const [type, rawId] = identity.split(":");
        try { await auditClient.details(type, Number(rawId)); return { key: rail.key, listId: prior.listId, status: "failed", error: `remote item disappeared but TMDB details still exists: ${identity}`, added, removed }; }
        catch (error) { if (!definitiveNotFound(error)) throw error; deleted.push(identity); }
      }
      return { key: rail.key, listId: prior.listId, status: "repairable-deleted", count: actual.length, _actual: actual, deleted };
    } catch (error) { return { key: rail.key, listId: prior?.listId, status: "failed", error: String(error?.message ?? error) }; }
  };
  let results = await runAuditPass(rails, 16, auditRail, client);
  const initialFailed = results.filter((item) => item.status === "failed").length;
  const initialFailureSamples = results.filter((item) => item.status === "failed").slice(0, 12)
    .map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith("_"))));
  const maxRetries = Math.max(0, Math.min(Number(process.env.NUVIO_REMOTE_AUDIT_RETRIES ?? 3), 4));
  let retryPasses = 0;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const failedIndexes = results.map((item, index) => item.status === "failed" ? index : -1).filter((index) => index >= 0);
    if (!failedIndexes.length) break;
    retryPasses++;
    console.error(`[remote-audit] retry ${retryPasses}/${maxRetries}: rechecking only ${failedIndexes.length} failed rails with a fresh client`);
    await wait(remoteAuditRetryDelay(attempt));
    const retryClient = new TmdbClient({ readToken: client.readToken, userToken: client.userToken, language: client.language, fetchImpl: client.fetchImpl });
    const retried = await runAuditPass(failedIndexes.map((index) => rails[index]), Math.min(8, failedIndexes.length), auditRail, retryClient, { allowRepairs: attempt === maxRetries - 1 });
    for (let i = 0; i < failedIndexes.length; i++) results[failedIndexes[i]] = retried[i];
  }
  let failed = results.filter((item) => item.status === "failed");
  const repairableDeleted = results.filter((item) => item.status === "repairable-deleted");
  const repairableOrder = results.filter((item) => item.status === "repairable-order-normalization");
  const repairableIneligible = results.filter((item) => item.status === "repairable-ineligible");
  const repairableOrderRewrite = results.filter((item) => item.status === "repairable-order-rewrite");
  const orderRewriteAttempts = repairableOrderRewrite.length;
  if (execute && !failed.length && repairableIneligible.length) {
    const repaired = await mapLimit(repairableIneligible, 4, async (item) => {
      try {
        await client.removeItems(item.listId, item._invalid);
        await verifyReadback(client, item.listId, item._actual);
        return { key: item.key, listId: item.listId, status: "valid", count: item._actual.length, _repairedIneligible: item };
      } catch (error) { return { key: item.key, listId: item.listId, status: "failed", error: `v3 eligibility repair failed: ${error.message}` }; }
    });
    for (const repairedItem of repaired) results[results.findIndex((item) => item.key === repairedItem.key)] = repairedItem;
    failed = results.filter((item) => item.status === "failed");
  }
  if (execute && !failed.length && repairableOrderRewrite.length) {
    const rewritten = await mapLimit(repairableOrderRewrite, 3, async (item) => {
      try {
        const settled = await rewriteExactOrder(client, item.listId, state.rails[item.key].orderedIds);
        return { key: item.key, listId: item.listId, status: "valid", count: settled.length, _actual: settled, _orderRewritten: true };
      } catch (error) { return { key: item.key, listId: item.listId, status: "failed", error: `exact order rewrite failed: ${error.message}` }; }
    });
    for (const rewrittenItem of rewritten) results[results.findIndex((item) => item.key === rewrittenItem.key)] = rewrittenItem;
    failed = results.filter((item) => item.status === "failed");
  }
  const repairable = [...repairableDeleted, ...repairableOrder];
  if (execute) {
    const excludedAt = new Date().toISOString();
    for (const item of results.filter((value) => value._repairedIneligible)) {
      const repair = item._repairedIneligible, prior = state.rails[item.key];
      const quarantined = repair._invalid.map((invalid) => ({ ...invalid, excludedAt }));
      const invalidItems = [...(prior.invalidItems ?? []), ...quarantined].filter((value, index, all) => all.findIndex((candidate) => candidate.media_type === value.media_type && candidate.id === value.id) === index);
      state.rails[item.key] = { ...prior, orderedIds: repair._actual, count: repair._actual.length, fingerprint: fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids: repair._actual }), invalidItems, syncStatus: "verified", lastVerified: excludedAt, tmdbV3EligibilityRepairedAt: excludedAt };
    }
    for (const item of results.filter((value) => value._orderRewritten)) {
      const prior = state.rails[item.key], normalized = !equal(prior.orderedIds, item._actual);
      state.rails[item.key] = { ...prior, orderedIds: item._actual, count: item._actual.length, fingerprint: fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids: item._actual }), syncStatus: "verified", lastVerified: excludedAt, tmdbOrderRewrittenAt: excludedAt, ...(normalized ? { tmdbOrderNormalizedAt: excludedAt } : {}) };
    }
    for (const item of repairable) {
      const prior = state.rails[item.key];
      if (item.status === "repairable-order-normalization") {
        state.rails[item.key] = { ...prior, orderedIds: item._actual, count: item._actual.length, syncStatus: "verified", lastVerified: excludedAt, tmdbOrderNormalizedAt: excludedAt };
        continue;
      }
      const quarantined = item.deleted.map((identity) => { const [media_type, id] = identity.split(":"); return { media_type, id: Number(id), reason: "TMDB_DELETED_RESOURCE", excludedAt }; });
      const invalidItems = [...(prior.invalidItems ?? []), ...quarantined].filter((value, index, all) => all.findIndex((candidate) => candidate.media_type === value.media_type && candidate.id === value.id) === index);
      state.rails[item.key] = { ...prior, orderedIds: item._actual, count: item._actual.length, fingerprint: fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids: item._actual }), writeSchema: WRITE_SCHEMA_VERSION, invalidItems, syncStatus: "verified", lastVerified: excludedAt };
    }
    if (repairable.length || repairableIneligible.length || orderRewriteAttempts) await writeJson(STATE_FILE, state);
  }
  const reportResults = results.filter((item) => item.status !== "valid").map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith("_"))));
  const report = { version: 1, date: today, mode: execute ? "execute" : "dry-run", totals: { considered: results.length, valid: results.filter((item) => item.status === "valid").length, initialFailed, recoveredAfterRetry: initialFailed - failed.length - repairable.length - (execute ? 0 : repairableIneligible.length + repairableOrderRewrite.length), retryPasses, repairedDeleted: execute ? repairableDeleted.length : 0, repairableDeleted: repairableDeleted.length, repairedIneligible: execute ? results.filter((item) => item._repairedIneligible).length : 0, repairableIneligible: repairableIneligible.length, repairedOrderRewrites: execute ? results.filter((item) => item._orderRewritten).length : 0, repairableOrderRewrites: orderRewriteAttempts, repairedOrderNormalizations: execute ? repairableOrder.length : 0, repairableOrderNormalizations: repairableOrder.length, failed: failed.length }, initialFailureSamples, results: reportResults };
  await writeJson(REMOTE_AUDIT_REPORT_FILE, report);
  if (results.length !== EXPECTED.materialized || failed.length) throw new Error(`Remote audit failed closed: considered=${results.length}, failed=${failed.length}; see ${REMOTE_AUDIT_REPORT_FILE}`);
  return report;
}
