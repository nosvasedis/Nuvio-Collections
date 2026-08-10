/**
 * Nuvio 0.8.3 LIST / mediaType compatibility probes.
 *
 * Stable 0.8.3 facts (NuvioMedia/NuvioTV @ 0.8.3-beta):
 *
 * 1. Real import path: CollectionManagementViewModel / AddonConfigServer →
 *    CollectionsDataStore.importFromJson → SerializableSource.toDomainSource.
 *    toDomainSource **reads** mediaType and only defaults absent/invalid values
 *    to MOVIE. A clean DataStore round-trip therefore preserves LIST + TV.
 *    Gson re-serialize drops the advisory `type` field for TMDB sources but
 *    keeps mediaType.
 *
 * 2. Create / web-editor paths hard-code LIST|COLLECTION → MOVIE:
 *    - CollectionEditorViewModel selectedMediaTypes / buildTmdbSources
 *    - AddonWebPage addTmdbSource (`if (type === 'LIST' || type === 'COLLECTION')
 *      mediaType = 'MOVIE'`) and hidden media inputs default non-NETWORK to MOVIE
 *    - Mobile CollectionEditorRepository.selectedMediaTypes
 *    These paths explain mass series/MOVIE drift if sources are re-created or
 *    re-saved through the editor after a correct import. Do not assume a blind
 *    re-import always heals an already-corrupted live profile without export
 *    verification.
 *
 * 3. Catalog labels use source.mediaType (CatalogRow.rawType /
 *    toCollectionRawType → localized «Ταινία»/«Σειρά»). LIST item posters on TV
 *    use each item's media_type; Mobile resolveList uses item media_type for
 *    list rows (collection parts still force MOVIE).
 *
 * 4. Reviewed 2026-08-10 Mobile-shaped export (encodeDefaults nulls + retained
 *    type:"series") flipped only mediaType TV→MOVIE on all 987 materialized
 *    LIST TV rails. Native DISCOVER/NETWORK TV (121) stayed series/TV.
 *
 * Production stance: keep stable TMDB list IDs and series/TV in the artifact.
 * Never convert these rails into inaccurate native DISCOVER sources. Never
 * recreate TMDB lists solely for mediaType. Require a fresh Nuvio import →
 * export → profile:audit with mediaTypeMismatches:0 before claiming success.
 */

export function emulateNuvio083DataStoreMediaType(source) {
  const raw = String(source.mediaType ?? "").toUpperCase();
  return raw === "TV" || raw === "MOVIE" ? raw : "MOVIE";
}

/** Editor / web-editor create path for TMDB LIST|COLLECTION. */
export function emulateNuvio083ListEditorMediaType(source) {
  const sourceType = String(source.tmdbSourceType ?? "").toUpperCase();
  if (sourceType === "LIST" || sourceType === "COLLECTION") return "MOVIE";
  return emulateNuvio083DataStoreMediaType(source);
}

/**
 * TV DataStore Gson round-trip: TMDB sources lose advisory `type` but keep a
 * valid mediaType. Invalid/absent mediaType becomes MOVIE.
 */
export function emulateNuvio083DataStoreRoundTrip(source) {
  if (source.provider !== "tmdb") return { ...source };
  const { type: _dropped, ...rest } = source;
  return {
    ...rest,
    type: null,
    mediaType: emulateNuvio083DataStoreMediaType(source),
    tmdbSourceType: source.tmdbSourceType,
  };
}

/**
 * Mobile CollectionJsonPreserver-style merge fingerprint:
 * domain mediaType overwritten to MOVIE while type:"series" from the imported
 * CollectionSource is retained.
 */
export function emulateMobileListTvCorruption(source) {
  if (source.tmdbSourceType !== "LIST" || source.mediaType !== "TV") return { ...source };
  return { ...source, type: source.type ?? "series", mediaType: "MOVIE" };
}

export function analyzeListTvCompat(canonicalSources, profileSources) {
  const canonListTv = canonicalSources.filter((s) => s.provider === "tmdb" && s.tmdbSourceType === "LIST" && s.mediaType === "TV");
  const profileById = new Map(profileSources.filter((s) => s.provider === "tmdb" && s.tmdbId != null).map((s) => [s.tmdbId, s]));
  const corrupted = [];
  const preserved = [];
  for (const source of canonListTv) {
    const stored = profileById.get(source.tmdbId);
    if (!stored) continue;
    if (stored.type === "series" && stored.mediaType === "MOVIE") corrupted.push(source.tmdbId);
    else if (stored.type === "series" && stored.mediaType === "TV") preserved.push(source.tmdbId);
  }
  const nativeTvOk = profileSources.filter((s) => s.provider === "tmdb" && s.tmdbSourceType !== "LIST" && s.type === "series" && s.mediaType === "TV").length;
  return {
    canonicalListTv: canonListTv.length,
    profileSeriesMovieList: corrupted.length,
    profileSeriesTvList: preserved.length,
    profileNativeSeriesTv: nativeTvOk,
    editorWouldForceMovie: canonListTv.every((s) => emulateNuvio083ListEditorMediaType(s) === "MOVIE"),
    dataStoreWouldPreserveTv: canonListTv.every((s) => emulateNuvio083DataStoreMediaType(s) === "TV"),
  };
}

export function minimalListTvProbeSource({ tmdbId = 8681816, title = "Δημοφιλείς σειρές" } = {}) {
  return {
    type: "series",
    genre: null,
    title,
    sortBy: "original",
    tmdbId,
    addonId: null,
    filters: {},
    sortHow: null,
    provider: "tmdb",
    catalogId: null,
    mediaType: "TV",
    traktListId: null,
    tmdbSourceType: "LIST",
  };
}

export function minimalListTvProbeCollection(source = minimalListTvProbeSource()) {
  return [{
    id: "nuvio.compat.list-tv-probe",
    title: "TEST PROFILE ONLY — Nuvio LIST TV probe",
    backdropImageUrl: null,
    pinToTop: false,
    focusGlowEnabled: true,
    viewMode: "TABBED_GRID",
    showAllTab: true,
    folders: [{
      id: "nuvio.compat.list-tv-probe.folder",
      title: "TEST PROFILE ONLY — Probe",
      coverImageUrl: null,
      focusGifUrl: null,
      focusGifEnabled: true,
      coverEmoji: null,
      tileShape: "POSTER",
      hideTitle: false,
      heroBackdropUrl: null,
      heroVideoUrl: null,
      titleLogoUrl: null,
      sources: [source],
      catalogSources: [],
    }],
  }];
}
