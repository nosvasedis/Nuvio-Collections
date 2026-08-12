import { CATALOG_REMOVED_RAIL_REASONS, STATE_FILE, ROOT } from "../src/constants.mjs";
import { readJson, writeJson, invariant } from "../src/utils.mjs";
import { TmdbClient } from "../src/tmdb.mjs";
import path from "node:path";

const reason = "USER_APPROVED_STREAMING_REPLACEMENT_2026_08_12";
const confirmation = "DELETE-HULU-DISCOVERY-STARZ-94";
invariant(process.env.CONFIRM_TMDB_LIST_DELETES === confirmation, "Explicit streaming-list delete confirmation missing");
const targetKeys = [...CATALOG_REMOVED_RAIL_REASONS].filter(([, value]) => value === reason).map(([key]) => key).sort();
invariant(targetKeys.length === 94, `Streaming deletion target count drifted: ${targetKeys.length}`);

const state = await readJson(STATE_FILE), client = new TmdbClient();
const accountLists = await client.accountListsAll();
const accountById = new Map(accountLists.map((list) => [Number(list.id), list]));
const managedKey = (description) => String(description ?? "").match(/(?:^| • )key ([^•]+)$/)?.[1]?.trim() ?? null;
const deleted = [], recovered = [], alreadyVerified = [];

for (const key of targetKeys) {
  const tombstone = state.retiredRails?.[key];
  invariant(tombstone?.reason === reason && Number.isInteger(Number(tombstone.listId)), `Streaming tombstone mismatch: ${key}`);
  const listId = Number(tombstone.listId), remote = accountById.get(listId);
  if (remote) {
    invariant(managedKey(remote.description) === key, `Refusing to delete list ${listId}: ownership key mismatch`);
    try { await client.deleteList(listId); } catch (error) {
      // A lost DELETE response is resolved by authoritative read-back below.
      tombstone.remoteDeleteResponseError = error.message;
    }
  } else if (tombstone.remoteDeleteVerified) {
    alreadyVerified.push(listId); continue;
  }
  let absent = false;
  try { await client.listV4(listId); } catch (error) { absent = /\b404\b/.test(error.message); }
  invariant(absent, `Retired streaming list remains readable: ${listId}`);
  tombstone.remoteDeletedAt ??= new Date().toISOString();
  tombstone.remoteDeleteVerified = true;
  tombstone.remoteDeleteRecovered = !remote;
  await writeJson(STATE_FILE, state);
  (remote ? deleted : recovered).push(listId);
}

const report = { version: 1, reason, confirmation, expected: 94, deleted, recovered, alreadyVerified, verifiedAbsent: deleted.length + recovered.length + alreadyVerified.length, completedAt: new Date().toISOString() };
invariant(report.verifiedAbsent === 94, `Streaming deletion verification incomplete: ${report.verifiedAbsent}/94`);
await writeJson(path.join(ROOT, "reports", "streaming-retirement-2026-08-12.json"), report);
console.log(JSON.stringify(report, null, 2));
