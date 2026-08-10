import { INPUT_FILE, RAILS_FILE, CURATED_STUDIO_FEATURES_FILE, LOCK_FILE, STATE_FILE, RECOMMENDED_FOLDER_ID, RECOMMENDED_CATALOGS, EXPECTED, EXPECTED_MAPPING } from "./constants.mjs";
import { readJson, fingerprint, invariant } from "./utils.mjs";

export async function auditRepository({ requireListIds = false } = {}) {
  const [input, manifest, curatedStudios, lock, state] = await Promise.all([readJson(INPUT_FILE), readJson(RAILS_FILE), readJson(CURATED_STUDIO_FEATURES_FILE), readJson(LOCK_FILE), readJson(STATE_FILE)]);
  const folders = input.flatMap((c) => c.folders);
  const recommended = folders.find((f) => f.id === RECOMMENDED_FOLDER_ID);
  const folderIds = new Set(folders.map((f) => f.id));
  invariant(input.length === EXPECTED.collections, "Collection lock failed");
  invariant(folders.length === EXPECTED.folders && folderIds.size === EXPECTED.folders, "Folder lock failed");
  invariant(lock.folders.length === EXPECTED.folders, "Folder lock manifest count failed");
  invariant(fingerprint(recommended) === lock.recommendedFingerprint, "recommended changed");
  const recommendedCatalogs = recommended.sources.map(({ type, genre, addonId, catalogId }) => ({ type, genre, addonId, catalogId }));
  invariant(JSON.stringify(recommendedCatalogs) === JSON.stringify(RECOMMENDED_CATALOGS), "Recommended catalog links changed");
  invariant(JSON.stringify(recommended.catalogSources) === JSON.stringify(RECOMMENDED_CATALOGS), "Recommended catalogSources changed");
  for (const item of lock.folders) {
    const folder = folders.find((f) => f.id === item.id);
    invariant(folder && fingerprint(Object.fromEntries(Object.entries(folder).filter(([k]) => k !== "sources"))) === item.metadataFingerprint, `Folder metadata changed: ${item.id}`);
  }
  const rails = manifest.rails;
  const native = rails.filter((r) => r.strategy === "native");
  const materialized = rails.filter((r) => r.strategy === "materialized");
  invariant(rails.length === EXPECTED.managedFinalSources && native.length === EXPECTED.native && materialized.length === EXPECTED.materialized, "Rail totals failed");
  invariant(new Set(rails.map((r) => r.key)).size === rails.length, "Duplicate rail key");
  invariant(rails.every((r) => ["MOVIE", "TV"].includes(r.mediaType)), "Every managed rail must declare an explicit media type");
  invariant(materialized.every((r) => ["MOVIE", "TV"].includes(r.mediaType)), "Materialized list must be homogeneous");
  const curatedRails = materialized.filter((r) => r.materializer === "curated_studio_features");
  invariant(curatedRails.length === 4 && curatedRails.every((rail) => rail.mediaType === "MOVIE"), "Curated studio rail mapping failed");
  invariant(curatedRails.every((rail) => {
    const entry = curatedStudios.entries[rail.folderId];
    return entry && entry.pinnedIds.length === entry.expectedBaselineCount && new Set(entry.pinnedIds).size === entry.pinnedIds.length && entry.traktListId === rail.params.legacy.traktListId;
  }), "Curated studio provenance/baseline failed");
  for (const [collectionId, [nativeCount, materializedCount]] of Object.entries(EXPECTED_MAPPING)) {
    invariant(native.filter((r) => r.collectionId === collectionId).length === nativeCount, `Native mapping mismatch: ${collectionId}`);
    invariant(materialized.filter((r) => r.collectionId === collectionId).length === materializedCount, `Materialized mapping mismatch: ${collectionId}`);
  }
  invariant(native.every((r) => ["DISCOVER", "COLLECTION", "NETWORK"].includes(r.originalSource.tmdbSourceType)), "Unsupported native source type");
  const nuvio083Filters = new Set(["withGenres", "withoutGenres", "releaseDateGte", "releaseDateLte", "voteAverageGte", "voteCountGte", "withOriginalLanguage", "withOriginCountry", "withKeywords", "withoutKeywords", "withCompanies", "withoutCompanies", "withNetworks", "year", "watchRegion", "withWatchProviders", "withoutWatchProviders"]);
  invariant(native.every((rail) => Object.keys(rail.originalSource.filters ?? {}).every((key) => nuvio083Filters.has(key))), "Unsupported Nuvio 0.8.3 native filter");
  invariant(native.every((rail) => !Object.keys(rail.originalSource.filters ?? {}).length || ["DISCOVER", "COMPANY", "NETWORK"].includes(rail.originalSource.tmdbSourceType)), "Nuvio filters attached to a source type that ignores them");
  invariant(native.every((rail) => rail.originalSource.mediaType === rail.mediaType), "Native Nuvio media type drift");
  invariant(Object.keys(state.retiredRails ?? {}).length === EXPECTED.retiredRails, "Retired rail audit failed");
  if (requireListIds) for (const rail of materialized) invariant(state.rails[rail.key]?.listId, `Missing managed list ID: ${rail.key}`);
  const world = input.find((collection) => collection.id === "collections.world");
  invariant(world, "collections.world missing");
  const worldTitles = world.folders.map((folder) => folder.title);
  const sortedWorldTitles = [...worldTitles].sort((a, b) => a.localeCompare(b, "el"));
  invariant(JSON.stringify(worldTitles) === JSON.stringify(sortedWorldTitles), "collections.world is not Greek-locale sorted by title");
  invariant(worldTitles.includes("Λατινοαμερικανικές") && worldTitles.includes("Πορτογαλικές"), "World Portuguese/Latin American folders missing");
  const latinIndex = worldTitles.indexOf("Λατινοαμερικανικές");
  const portugalIndex = worldTitles.indexOf("Πορτογαλικές");
  invariant(latinIndex > worldTitles.indexOf("Κορεάτικες") && latinIndex < worldTitles.indexOf("Μεξικάνικες"), "Λατινοαμερικανικές is not in Greek Λ position");
  invariant(portugalIndex > worldTitles.indexOf("Πολωνικές") && portugalIndex < worldTitles.indexOf("Ρωσικές"), "Πορτογαλικές is not in Greek Π position");
  return { collections: input.length, folders: folders.length, finalSources: rails.length + recommended.sources.length, managed: rails.length, native: native.length, materialized: materialized.length, recommendedFingerprint: lock.recommendedFingerprint, unresolvedLists: materialized.filter((r) => !state.rails[r.key]?.listId).length };
}
