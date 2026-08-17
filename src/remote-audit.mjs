import { RAILS_FILE, REMOTE_AUDIT_REPORT_FILE, STATE_FILE, EXPECTED } from "./constants.mjs";
import { TmdbClient } from "./tmdb.mjs";
import { WRITE_SCHEMA_VERSION } from "./sync.mjs";
import { athensDate, fingerprint, mapLimit, readJson, writeJson } from "./utils.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function definitiveNotFound(error) {
  return /\b404\b|status_code["':\s]+34\b|resource you requested could not be found/i.test(String(error?.message ?? error));
}
function identities(items) { return items.map((item) => `${item.media_type}:${item.id}`); }
function equal(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }

export async function auditRemoteLists({ execute = false, client = new TmdbClient() } = {}) {
  const [manifest, state] = await Promise.all([readJson(RAILS_FILE), readJson(STATE_FILE)]);
  const rails = manifest.rails.filter((rail) => rail.strategy === "materialized");
  const today = athensDate();
  const auditRail = async (rail, auditClient = client) => {
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
      if (Object.values(violations).some(Boolean)) return { key: rail.key, listId: prior.listId, status: "failed", violations };
      if (equal(expected, actual)) return { key: rail.key, listId: prior.listId, status: "valid", count: actual.length };
      const added = actual.filter((identity) => !expected.includes(identity));
      const removed = expected.filter((identity) => !actual.includes(identity));
      if (added.length || !removed.length) return { key: rail.key, listId: prior.listId, status: "failed", error: "unexpected remote addition or order drift", added, removed };
      const confirmation = identities((await auditClient.listV3All(prior.listId)).items ?? []);
      if (!equal(actual, confirmation)) return { key: rail.key, listId: prior.listId, status: "failed", error: "remote drift did not survive independent confirmation", added, removed };
      const deleted = [];
      for (const identity of removed) {
        const [type, rawId] = identity.split(":");
        try { await auditClient.details(type, Number(rawId)); return { key: rail.key, listId: prior.listId, status: "failed", error: `remote item disappeared but TMDB details still exists: ${identity}`, added, removed }; }
        catch (error) { if (!definitiveNotFound(error)) throw error; deleted.push(identity); }
      }
      return { key: rail.key, listId: prior.listId, status: "repairable-deleted", count: actual.length, _actual: actual, deleted };
    } catch (error) { return { key: rail.key, listId: prior?.listId, status: "failed", error: String(error?.message ?? error) }; }
  };
  let results = await mapLimit(rails, 16, auditRail);
  const initialFailed = results.filter((item) => item.status === "failed").length;
  const maxRetries = Math.max(0, Math.min(Number(process.env.NUVIO_REMOTE_AUDIT_RETRIES ?? 2), 3));
  let retryPasses = 0;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const failedIndexes = results.map((item, index) => item.status === "failed" ? index : -1).filter((index) => index >= 0);
    if (!failedIndexes.length) break;
    retryPasses++;
    await wait(Math.max(1000, Number(process.env.NUVIO_REMOTE_AUDIT_RETRY_DELAY_MS ?? 5000)));
    const retryClient = new TmdbClient({ readToken: client.readToken, userToken: client.userToken, language: client.language, fetchImpl: client.fetchImpl });
    const retried = await mapLimit(failedIndexes, Math.min(8, failedIndexes.length), (index) => auditRail(rails[index], retryClient));
    for (let i = 0; i < failedIndexes.length; i++) results[failedIndexes[i]] = retried[i];
  }
  const failed = results.filter((item) => item.status === "failed");
  const repairable = results.filter((item) => item.status === "repairable-deleted");
  if (execute && !failed.length) {
    const excludedAt = new Date().toISOString();
    for (const item of repairable) {
      const prior = state.rails[item.key];
      const quarantined = item.deleted.map((identity) => { const [media_type, id] = identity.split(":"); return { media_type, id: Number(id), reason: "TMDB_DELETED_RESOURCE", excludedAt }; });
      const invalidItems = [...(prior.invalidItems ?? []), ...quarantined].filter((value, index, all) => all.findIndex((candidate) => candidate.media_type === value.media_type && candidate.id === value.id) === index);
      state.rails[item.key] = { ...prior, orderedIds: item._actual, count: item._actual.length, fingerprint: fingerprint({ writeSchema: WRITE_SCHEMA_VERSION, ids: item._actual }), writeSchema: WRITE_SCHEMA_VERSION, invalidItems, syncStatus: "verified", lastVerified: excludedAt };
    }
    if (repairable.length) await writeJson(STATE_FILE, state);
  }
  const reportResults = results.filter((item) => item.status !== "valid").map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith("_"))));
  const report = { version: 1, date: today, mode: execute ? "execute" : "dry-run", totals: { considered: results.length, valid: results.filter((item) => item.status === "valid").length, initialFailed, recoveredAfterRetry: initialFailed - failed.length, retryPasses, repairedDeleted: execute && !failed.length ? repairable.length : 0, repairableDeleted: repairable.length, failed: failed.length }, results: reportResults };
  await writeJson(REMOTE_AUDIT_REPORT_FILE, report);
  if (results.length !== EXPECTED.materialized || failed.length) throw new Error(`Remote audit failed closed: considered=${results.length}, failed=${failed.length}; see ${REMOTE_AUDIT_REPORT_FILE}`);
  return report;
}
