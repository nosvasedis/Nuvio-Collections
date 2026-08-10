import { INPUT_FILE, RAILS_FILE, LOCK_FILE, STATE_FILE, RECOMMENDED_FOLDER_ID, EXPECTED, EXPECTED_MAPPING } from "./constants.mjs";
import { readJson, fingerprint, invariant } from "./utils.mjs";

export async function auditRepository({ requireListIds = false } = {}) {
  const [input, manifest, lock, state] = await Promise.all([readJson(INPUT_FILE), readJson(RAILS_FILE), readJson(LOCK_FILE), readJson(STATE_FILE)]);
  const folders = input.flatMap((c) => c.folders);
  const recommended = folders.find((f) => f.id === RECOMMENDED_FOLDER_ID);
  const folderIds = new Set(folders.map((f) => f.id));
  invariant(input.length === EXPECTED.collections, "Collection lock failed");
  invariant(folders.length === EXPECTED.folders && folderIds.size === EXPECTED.folders, "Folder lock failed");
  invariant(lock.folders.length === EXPECTED.folders, "Folder lock manifest count failed");
  invariant(fingerprint(recommended) === lock.recommendedFingerprint, "recommended changed");
  for (const item of lock.folders) {
    const folder = folders.find((f) => f.id === item.id);
    invariant(folder && fingerprint(Object.fromEntries(Object.entries(folder).filter(([k]) => k !== "sources"))) === item.metadataFingerprint, `Folder metadata changed: ${item.id}`);
  }
  const rails = manifest.rails;
  const native = rails.filter((r) => r.strategy === "native");
  const materialized = rails.filter((r) => r.strategy === "materialized");
  invariant(rails.length === EXPECTED.managedFinalSources && native.length === EXPECTED.native && materialized.length === EXPECTED.materialized, "Rail totals failed");
  invariant(new Set(rails.map((r) => r.key)).size === rails.length, "Duplicate rail key");
  invariant(materialized.every((r) => ["MOVIE", "TV"].includes(r.mediaType)), "Materialized list must be homogeneous");
  for (const [collectionId, [nativeCount, materializedCount]] of Object.entries(EXPECTED_MAPPING)) {
    invariant(native.filter((r) => r.collectionId === collectionId).length === nativeCount, `Native mapping mismatch: ${collectionId}`);
    invariant(materialized.filter((r) => r.collectionId === collectionId).length === materializedCount, `Materialized mapping mismatch: ${collectionId}`);
  }
  invariant(native.every((r) => ["DISCOVER", "COLLECTION", "NETWORK"].includes(r.originalSource.tmdbSourceType)), "Unsupported native source type");
  if (requireListIds) for (const rail of materialized) invariant(state.rails[rail.key]?.listId, `Missing managed list ID: ${rail.key}`);
  return { collections: input.length, folders: folders.length, finalSources: rails.length + recommended.sources.length, managed: rails.length, native: native.length, materialized: materialized.length, recommendedFingerprint: lock.recommendedFingerprint, unresolvedLists: materialized.filter((r) => !state.rails[r.key]?.listId).length };
}
