import { STATE_FILE } from "../src/constants.mjs";
import { readJson, writeJson, invariant } from "../src/utils.mjs";
import { TmdbClient } from "../src/tmdb.mjs";

const targets = new Map([
  ["collections.genres:folder-KQEZGAMF:0", 8681927],
  ["collections.genres:folder-KQEZGAMF:1", 8681928],
  ["collections.genres:folder-KQEZGAMF:2", 8681929],
  ["collections.genres:folder-KQEZGAMF:3", 8681930],
]);
invariant(process.env.CONFIRM_TMDB_LIST_DELETES === "DELETE-REALITY-8681927-8681930", "Explicit Reality-list delete confirmation missing");
const state = await readJson(STATE_FILE), client = new TmdbClient();
const accountLists = await client.accountListsAll();
const accountById = new Map(accountLists.map((list) => [Number(list.id), list]));
const deleted = [], alreadyAbsent = [];

for (const [key, listId] of targets) {
  const tombstone = state.retiredRails?.[key];
  invariant(tombstone?.reason === "USER_APPROVED_REALITY_REMOVAL" && Number(tombstone.listId) === listId, `Reality tombstone mismatch: ${key}`);
  const remote = accountById.get(listId);
  if (!remote) {
    invariant(tombstone.remoteDeletedAt, `Target list ${listId} is unexpectedly absent without delete evidence`);
    alreadyAbsent.push(listId); continue;
  }
  const managedKey = String(remote.description ?? "").match(/(?:^| • )key ([^•]+)$/)?.[1]?.trim();
  invariant(managedKey === key, `Refusing to delete list ${listId}: ownership key is ${managedKey ?? "missing"}`);
  await client.deleteList(listId);
  let absent = false;
  try { await client.listV4(listId); } catch (error) { absent = /\b404\b/.test(error.message); }
  invariant(absent, `Deleted Reality list remains readable: ${listId}`);
  tombstone.remoteDeletedAt = new Date().toISOString(); tombstone.remoteDeleteVerified = true;
  await writeJson(STATE_FILE, state);
  deleted.push(listId);
}
console.log(JSON.stringify({ deleted, alreadyAbsent, targets: [...targets.values()] }, null, 2));
