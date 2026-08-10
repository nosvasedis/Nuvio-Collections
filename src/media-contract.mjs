import { invariant } from "./utils.mjs";
import { emulateNuvio083DataStoreMediaType, emulateNuvio083ListEditorMediaType } from "./nuvio-list-compat.mjs";

export function expectedNuvioType(mediaType) {
  if (mediaType === "MOVIE") return "movie";
  if (mediaType === "TV") return "series";
  return null;
}

export function assertNuvioMediaTypeContract(collections, { managedOnly = false } = {}) {
  const errors = [];
  for (const collection of collections) for (const folder of collection.folders ?? []) for (const source of folder.sources ?? []) {
    if (managedOnly && source.provider !== "tmdb" && source.provider !== "trakt") continue;
    if (source.provider !== "tmdb" && source.provider !== "trakt") continue;
    const expectedType = expectedNuvioType(source.mediaType);
    if (!expectedType || source.type !== expectedType) {
      errors.push({ collectionId: collection.id, folderId: folder.id, title: source.title, tmdbId: source.tmdbId ?? null, type: source.type ?? null, mediaType: source.mediaType ?? null, expectedType });
    }
  }
  invariant(!errors.length, `Nuvio media type contract failed: ${JSON.stringify(errors.slice(0, 10))}`);
  return true;
}

// Mirrors NuvioTV 0.8.3 CollectionsDataStore.SerializableSource.toDomainSource:
// an absent or invalid mediaType becomes MOVIE. LIST+TV is preserved here.
export function emulateNuvio083MediaType(source) {
  return emulateNuvio083DataStoreMediaType(source);
}

export { emulateNuvio083DataStoreMediaType, emulateNuvio083ListEditorMediaType };
