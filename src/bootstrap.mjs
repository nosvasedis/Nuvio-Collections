import { INPUT_FILE, RAILS_FILE, PROVIDERS_FILE, AWARDS_FILE, CURATED_STUDIO_FEATURES_FILE, LOCK_FILE, STATE_FILE, RECOMMENDED_FOLDER_ID, EXPECTED, COUNTRY_BY_FOLDER, PERSON_ID_BY_FOLDER, RETIRED_RAIL_REASONS, CATALOG_REMOVED_RAIL_REASONS, PROVIDER_SEEDS, AWARD_SEEDS, AWARD_CATEGORY_SEEDS, CANNES_CATEGORY_SEEDS, OSCAR_CATEGORY_SEEDS, NON_WORK_AWARD_WINNERS } from "./constants.mjs";
import { readJson, writeJson, fingerprint, invariant, railKey, normalizeText } from "./utils.mjs";

const MATERIALIZED_COLLECTIONS = new Set(["collections.streaming", "collections.genres", "collections.moods", "collections.studios", "collections.actors", "collections.directors", "collections.awards", "collections.world", "collections.runtime"]);

function strategy(collection, folder, source, index) {
  if (MATERIALIZED_COLLECTIONS.has(collection.id)) return "materialized";
  if (collection.id === "collections.film-series") return "native";
  if (collection.id === "collections.networks") return index === 0 ? "native" : "materialized";
  if (collection.id === "collections.discover") return "materialized";
  if (collection.id === "collections.decades") return folder.id === "collections.decades.2020s" && /2026/.test(source.title ?? "") ? "materialized" : "native";
  throw new Error(`Unclassified source: ${collection.id}/${folder.id}/${index}`);
}

const DISCOVER_TOP_POLICIES = Object.freeze({
  0: Object.freeze({ title: "Κορυφαίες πρόσφατες ταινίες", kind: "top_recent", voteCountGte: 500 }),
  1: Object.freeze({ title: "Κορυφαίες πρόσφατες σειρές", kind: "top_recent", voteCountGte: 300 }),
  2: Object.freeze({ title: "Κορυφαίες ταινίες όλων των εποχών", kind: "top_all_time", voteCountGte: 5000 }),
  3: Object.freeze({ title: "Κορυφαίες σειρές όλων των εποχών", kind: "top_all_time", voteCountGte: 3000 }),
});

function materializer(collectionId) {
  return ({
    "collections.streaming": "streaming", "collections.genres": "discover", "collections.moods": "discover",
    "collections.studios": "company", "collections.networks": "network_recent",
    "collections.actors": "person_cast", "collections.directors": "person_director",
    "collections.awards": "award", "collections.world": "origin_country",
    "collections.decades": "discover", "collections.runtime": "runtime",
    "collections.discover": "discover",
  })[collectionId];
}

function nativeOverride(collectionId, source, index) {
  const value = structuredClone(source);
  // Nuvio 0.8.3 resolves COLLECTION parts locally and supports an explicit
  // descending release-date sort. Use it for every film-series rail so newly
  // added sequels automatically appear on the left without materializing 186
  // duplicate TMDB lists.
  if (collectionId === "collections.film-series") value.sortBy = "primary_release_date.desc";
  if (collectionId === "collections.networks" && index === 0) value.sortBy = "popularity.desc";
  return value;
}

function paramsFor(collection, folder, source) {
  const canonicalPersonId = ["collections.actors", "collections.directors"].includes(collection.id) ? PERSON_ID_BY_FOLDER[folder.id] : null;
  const params = { legacy: { tmdbSourceType: source.tmdbSourceType, tmdbId: canonicalPersonId ?? source.tmdbId, traktListId: source.traktListId, filters: source.filters, sortBy: source.sortBy } };
  if (collection.id === "collections.streaming") params.providerFolder = folder.id;
  if (source.discoverPolicy) params.discoverPolicy = structuredClone(source.discoverPolicy);
  if (source.explicitSemantic) params.explicitSemantic = true;
  if (collection.id === "collections.world") params.originCountry = COUNTRY_BY_FOLDER[folder.id];
  if (collection.id === "collections.awards") {
    params.award = AWARD_SEEDS[folder.id] ?? null;
    const years = [...String(source.title ?? folder.title ?? "").matchAll(/(19|20)\d{2}/g)].map((match) => Number(match[0]));
    params.awardStartYear = years[0] ?? null; params.awardEndYear = years[1] ?? null;
  }
  return params;
}

function summaryRails() {
  return [
    ["Δημοφιλείς ταινίες της δεκαετίας του 2020", "MOVIE", "popularity.desc"],
    ["Δημοφιλείς σειρές της δεκαετίας του 2020", "TV", "popularity.desc"],
    ["Κορυφαίες ταινίες της δεκαετίας του 2020", "MOVIE", "vote_average.desc"],
    ["Κορυφαίες σειρές της δεκαετίας του 2020", "TV", "vote_average.desc"],
  ].map(([title, mediaType, sortBy], index) => ({
    key: railKey("collections.decades", "collections.decades.2020s", index, ":summary"),
    collectionId: "collections.decades", folderId: "collections.decades.2020s", position: index,
    title, mediaType, strategy: "materialized", materializer: "discover", listId: null,
    params: { summary: true, startDate: "2020-01-01", sortBy }, originalSource: null,
  }));
}

const GOLDEN_MIXED_CATEGORY_COMPANIONS = Object.freeze([
  [20, "Καλύτερη μίνι σειρά ή τηλεταινία — Νικητές από το 1971 — Έργα ταξινομημένα ως Movies στο TMDB"],
  [21, "Καλύτερος ηθοποιός σε μίνι σειρά ή τηλεταινία — Νικητές από το 1981 — Έργα ταξινομημένα ως Movies στο TMDB"],
  [22, "Καλύτερη ηθοποιός σε μίνι σειρά ή τηλεταινία — Νικητές από το 1981 — Έργα ταξινομημένα ως Movies στο TMDB"],
  [23, "Καλύτερος ηθοποιός Β΄ ρόλου σε σειρά, μίνι σειρά ή τηλεταινία — Νικητές από το 1970 — Έργα ταξινομημένα ως Movies στο TMDB"],
  [24, "Καλύτερη ηθοποιός Β΄ ρόλου σε σειρά, μίνι σειρά ή τηλεταινία — Νικητές από το 1970 — Έργα ταξινομημένα ως Movies στο TMDB"],
]);
const GOLDEN_EVOLUTION_TITLES = Object.freeze({
  1: "Καλύτερη τηλεοπτική σειρά — Γενική κατηγορία 1961–1968 · Δράμα από το 1969",
  2: "Καλύτερος ηθοποιός σε τηλεοπτική σειρά — Γενική κατηγορία 1961–1968 · Δράμα από το 1969",
  3: "Καλύτερη ηθοποιός σε τηλεοπτική σειρά — Γενική κατηγορία 1961–1968 · Δράμα από το 1969",
  7: "Καλύτερη τηλεοπτική σειρά μιούζικαλ ή κωμωδία — Νικητές από το 1962",
  8: "Καλύτερος ηθοποιός σε τηλεοπτική σειρά μιούζικαλ ή κωμωδία — Νικητές από το 1969",
  9: "Καλύτερη ηθοποιός σε τηλεοπτική σειρά μιούζικαλ ή κωμωδία — Νικητές από το 1969",
});
const GOLDEN_EVOLUTION_START_YEARS = Object.freeze({ 7: 1962, 8: 1969, 9: 1969 });
const CANNES_EVOLUTION_TITLES = Object.freeze({
  1: "Κορυφαίο βραβείο ταινίας μικρού μήκους — Grand Prix 1952–1954 · Χρυσός Φοίνικας από το 1955",
});
const CANNES_EVOLUTION_START_YEARS = Object.freeze({ 1: 1952 });

function addGoldenMixedCategoryCompanions(rails) {
  for (const [sourceIndex, movieTitle] of GOLDEN_MIXED_CATEGORY_COMPANIONS) {
    const original = rails.find((rail) => rail.key === railKey("collections.awards", "folder-47ec917f", sourceIndex));
    invariant(original?.mediaType === "TV" && original.materializer === "award", `Golden Globes mixed-category source missing: ${sourceIndex}`);
    original.title = `${original.title} — Έργα ταξινομημένα ως TV στο TMDB`;
    original.params.awardCategorySeedIndex = sourceIndex;
    original.params.awardPartition = "tv";
    rails.push({
      ...structuredClone(original),
      key: `${original.key}:movie-companion`,
      position: 25 + (sourceIndex - 20),
      title: movieTitle,
      mediaType: "MOVIE",
      listId: null,
      params: { ...structuredClone(original.params), awardPartition: "movie" },
      originalSource: null,
    });
  }
}

export async function bootstrap() {
  const [input, curatedStudioFeatures] = await Promise.all([readJson(INPUT_FILE), readJson(CURATED_STUDIO_FEATURES_FILE)]);
  let existingAwards = null; try { existingAwards = await readJson(AWARDS_FILE); } catch {}
  invariant(Array.isArray(input) && input.length === EXPECTED.collections, "Unexpected collection count");
  const folders = input.flatMap((collection) => collection.folders);
  const sources = folders.flatMap((folder) => folder.sources);
  invariant(folders.length === EXPECTED.folders, "Unexpected folder count");
  invariant(sources.length === EXPECTED.inputSources, "Unexpected source count");
  const recommended = folders.find((folder) => folder.id === RECOMMENDED_FOLDER_ID);
  invariant(recommended?.sources.length === EXPECTED.recommendedSources, "Recommended folder mismatch");

  const rails = [];
  for (const collection of input) for (const folder of collection.folders) {
    if (folder.id === RECOMMENDED_FOLDER_ID) continue;
    const offset = folder.id === "collections.decades.2020s" ? 4 : 0;
    folder.sources.forEach((source, index) => {
      const mode = strategy(collection, folder, source, index);
      rails.push({
        key: railKey(collection.id, folder.id, index), collectionId: collection.id, folderId: folder.id,
        position: index + offset, title: ["collections.actors", "collections.directors"].includes(collection.id) && source.title?.startsWith("Νέες ") ? source.title.replace(/^Νέες /, "Νεότερες ") : source.title ?? folder.title, mediaType: source.mediaType ?? (source.type === "movie" ? "MOVIE" : source.type === "series" ? "TV" : null),
        strategy: mode, materializer: mode === "materialized" ? (collection.id === "collections.studios" && curatedStudioFeatures.entries[folder.id]?.traktListId === source.traktListId ? "curated_studio_features" : materializer(collection.id)) : null,
        listId: mode === "materialized" && source.tmdbSourceType === "LIST" ? source.tmdbId : null,
        params: paramsFor(collection, folder, source), originalSource: mode === "native" ? nativeOverride(collection.id, source, index) : source,
      });
      if (collection.id === "collections.discover" && folder.id === "collections.discover.popular-2") {
        rails.at(-1).params.discoverPolicy = { kind: index >= 2 ? "popular_year" : "popular", dedupeCanonicalTitle: true };
      }
      if (collection.id === "collections.discover" && folder.id === "collections.discover.top-rated-2") {
        const policy = DISCOVER_TOP_POLICIES[index];
        invariant(policy, `Unknown Discover Top rail: ${index}`);
        rails.at(-1).title = policy.title;
        rails.at(-1).params.discoverPolicy = { kind: policy.kind, voteCountGte: policy.voteCountGte };
      }
      if (rails.at(-1).materializer === "curated_studio_features") {
        rails.at(-1).title = `Ταινίες ${curatedStudioFeatures.entries[folder.id].name}`;
        rails.at(-1).params.curatedStudioFolderId = folder.id;
      }
      if (collection.id === "collections.awards" && folder.id === "folder-47ec917f" && GOLDEN_EVOLUTION_TITLES[index]) {
        rails.at(-1).title = GOLDEN_EVOLUTION_TITLES[index];
        if (GOLDEN_EVOLUTION_START_YEARS[index]) rails.at(-1).params.awardStartYear = GOLDEN_EVOLUTION_START_YEARS[index];
      }
      if (collection.id === "collections.awards" && folder.id === "folder-4ee02f67" && CANNES_EVOLUTION_TITLES[index]) {
        rails.at(-1).title = CANNES_EVOLUTION_TITLES[index];
        rails.at(-1).params.awardStartYear = CANNES_EVOLUTION_START_YEARS[index];
      }
    });
  }
  rails.push(...summaryRails());
  addGoldenMixedCategoryCompanions(rails);
  const retiredRails = rails.filter((rail) => RETIRED_RAIL_REASONS.has(rail.key));
  invariant(retiredRails.length === EXPECTED.retiredRails, "Retired rail mapping mismatch");
  for (let index = rails.length - 1; index >= 0; index--) if (RETIRED_RAIL_REASONS.has(rails[index].key)) rails.splice(index, 1);
  rails.sort((a, b) => a.collectionId.localeCompare(b.collectionId) || a.folderId.localeCompare(b.folderId) || a.position - b.position);
  invariant(rails.length === EXPECTED.managedFinalSources, "Managed rail count mismatch");
  invariant(rails.filter((x) => x.strategy === "native").length === EXPECTED.native, "Native rail count mismatch");
  invariant(rails.filter((x) => x.strategy === "materialized").length === EXPECTED.materialized, "Materialized rail count mismatch");
  invariant(rails.every((x) => x.collectionId !== "collections.world" || x.params.originCountry), "Missing origin country mapping");
  const curatedRails = rails.filter((x) => x.materializer === "curated_studio_features");
  invariant(curatedRails.length === 4, "Curated studio feature mapping mismatch");
  invariant(curatedRails.every((rail) => curatedStudioFeatures.entries[rail.folderId]?.pinnedIds.length === curatedStudioFeatures.entries[rail.folderId]?.expectedBaselineCount), "Curated studio baseline count mismatch");
  invariant(folders.filter((folder) => folder.id !== RECOMMENDED_FOLDER_ID).every((folder) => rails.some((rail) => rail.folderId === folder.id)), "Retirement left an empty folder");

  const lock = { version: 1, inputFingerprint: fingerprint(input), recommendedFingerprint: fingerprint(recommended), folders: input.flatMap((c) => c.folders.map((f) => ({ collectionId: c.id, id: f.id, title: f.title, metadataFingerprint: fingerprint(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "sources"))) }))) };
  const providers = { version: 1, regionPriority: "GR", worldwideFallback: "only-after-successful-empty-GR", allowedMonetization: ["flatrate", "free", "ads"], providers: PROVIDER_SEEDS.map(([slug, name, aliases]) => ({ slug, name, aliases, movieProviderIds: [], tvProviderIds: [] })) };
  const awardCursors = {};
  const awards = { version: 1, source: "Official award archives with TMDB Awards winner-ID cross-check", policy: "winners-only-fail-closed", authorityOverrides: existingAwards?.authorityOverrides ?? existingAwards?.cannesOverrides ?? {}, nonWorkWinners: existingAwards?.nonWorkWinners ?? NON_WORK_AWARD_WINNERS, rails: rails.filter((x) => x.materializer === "award").map((x) => {
    const cursor = awardCursors[x.folderId] ?? 0;
    const categoryIndex = Number.isInteger(x.params.awardCategorySeedIndex) ? x.params.awardCategorySeedIndex : cursor;
    if (!Number.isInteger(x.params.awardCategorySeedIndex)) awardCursors[x.folderId] = cursor + 1;
    const category = AWARD_CATEGORY_SEEDS[x.folderId]?.[categoryIndex] ?? [];
    const cannesCategory = x.folderId === "folder-4ee02f67" ? CANNES_CATEGORY_SEEDS[categoryIndex] : null;
    const oscarCategory = x.folderId === "folder-13a3da42" ? OSCAR_CATEGORY_SEEDS[categoryIndex] : null;
    const authority = cannesCategory ? "festival-cannes.com" : "themoviedb.org/award";
    return { key: x.key, title: x.title, mediaType: x.mediaType, authority, ...x.params.award, categoryId: category[0] ?? null, categorySlug: category[1] ?? null, cannesCategory, oscarCategory, partition: x.params.awardPartition ?? null, startYear: x.params.awardStartYear, endYear: x.params.awardEndYear };
  }) };
  await writeJson(RAILS_FILE, { version: 1, generatedFrom: INPUT_FILE.split(/[\\/]/).at(-1), rails });
  await writeJson(PROVIDERS_FILE, providers); await writeJson(AWARDS_FILE, awards); await writeJson(LOCK_FILE, lock);
  let state;
  try { state = await readJson(STATE_FILE); } catch { state = { version: 1, rails: {}, providerIndex: {}, lastSuccessfulSync: null }; }
  state.retiredRails ??= {};
  for (const rail of retiredRails) {
    const prior = state.rails?.[rail.key] ?? state.retiredRails[rail.key] ?? {};
    state.retiredRails[rail.key] = { ...prior, key: rail.key, collectionId: rail.collectionId, folderId: rail.folderId, title: rail.title, reason: RETIRED_RAIL_REASONS.get(rail.key), retiredForNuvio: "0.8.3", retiredAt: state.retiredRails[rail.key]?.retiredAt ?? new Date().toISOString() };
    delete state.rails?.[rail.key];
  }
  invariant(CATALOG_REMOVED_RAIL_REASONS.size === EXPECTED.catalogRemovedRails, "Catalog-removed rail mapping mismatch");
  for (const [key, reason] of CATALOG_REMOVED_RAIL_REASONS) {
    const prior = state.rails?.[key] ?? state.retiredRails[key] ?? {};
    invariant(prior.listId, `Catalog-removed rail lost its list tombstone: ${key}`);
    state.retiredRails[key] = { ...prior, key, reason, retiredForNuvio: "0.8.3", retiredAt: state.retiredRails[key]?.retiredAt ?? new Date().toISOString() };
    delete state.rails?.[key];
  }
  await writeJson(STATE_FILE, state);
  return { collections: input.length, folders: folders.length, inputSources: sources.length, managedRails: rails.length, native: rails.filter((x) => x.strategy === "native").length, materialized: rails.filter((x) => x.strategy === "materialized").length };
}
