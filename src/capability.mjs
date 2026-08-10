import { TmdbClient } from "./tmdb.mjs";
import { invariant } from "./utils.mjs";

const PROBE_ITEM = { id: 550, media_type: "movie" };

export async function capabilityProbe({ client = new TmdbClient() } = {}) {
  let listId;
  let deleted = false;
  try {
    const created = await client.createList(
      `Nuvio capability probe ${new Date().toISOString()}`,
      "Temporary automated create/add/read/clear/delete verification. Safe to delete.",
      "movie",
    );
    listId = created.id;
    invariant(listId, "TMDB list creation returned no list ID");

    await client.addItems(listId, [PROBE_ITEM]);
    const v4 = await client.listV4All(listId);
    invariant(v4.results?.some((item) => item.id === PROBE_ITEM.id && item.media_type === "movie"), "TMDB v4 list read-back failed");

    const v3 = await client.listV3All(listId);
    invariant(v3.items?.some((item) => item.id === PROBE_ITEM.id), "TMDB v3/Nuvio list read-back failed");

    await client.clearList(listId);
    const cleared = await client.listV4All(listId);
    invariant((cleared.results ?? []).length === 0, "TMDB list clear read-back failed");

    await client.deleteList(listId);
    deleted = true;
    return { success: true, operations: ["create", "add", "read-v4", "read-v3", "clear", "delete"], cleanup: "complete" };
  } finally {
    if (listId && !deleted) {
      try { await client.deleteList(listId); }
      catch (cleanupError) { throw new Error(`Capability probe cleanup failed for temporary list ${listId}: ${cleanupError.message}`); }
    }
  }
}
