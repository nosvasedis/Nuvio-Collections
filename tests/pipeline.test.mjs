import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "../src/bootstrap.mjs";
import { auditRepository } from "../src/validate.mjs";
import { compile } from "../src/compiler.mjs";
import { runtimeBucket, dailyRuntimeSelection, chooseAvailability, materializeRail, applySemanticPredicates, discoverParams, isSubstantiveCastCredit, isFeatureFilm, requireUsablePosters } from "../src/materialize.mjs";
import { TmdbClient } from "../src/tmdb.mjs";
import { confirmationCompatible, normalizeCandidateItems, semanticRefreshDue } from "../src/sync.mjs";
import { INPUT_FILE, OUTPUT_FILE, RECOMMENDED_FOLDER_ID, RECOMMENDED_CATALOGS, EXPECTED, RETIRED_RAIL_REASONS, COUNTRY_BY_FOLDER } from "../src/constants.mjs";
import { readJson, fingerprint, dedupeLikelyDuplicateWorks } from "../src/utils.mjs";
import { assertNuvioMediaTypeContract, emulateNuvio083MediaType } from "../src/media-contract.mjs";
import { compareProfile } from "../src/profile-audit.mjs";

test("bootstrap creates the final immutable mapping", async () => {
  const result = await bootstrap();
  assert.deepEqual(result, { collections: 13, folders: 548, inputSources: 2747, managedRails: 2675, native: 396, materialized: 2279 });
  const audit = await auditRepository(); assert.equal(audit.finalSources, EXPECTED.finalSources);
  const manifest = await readJson(new URL("../config/rails.yml", import.meta.url));
  const companions = manifest.rails.filter((rail) => rail.key.endsWith(":movie-companion"));
  assert.equal(companions.length, 5); assert.ok(companions.every((rail) => rail.mediaType === "MOVIE" && /(?:1970|1971|1981)/.test(rail.title)));
  assert.ok(manifest.rails.filter((rail) => ["collections.actors", "collections.directors"].includes(rail.collectionId)).every((rail) => !rail.title.startsWith("Νέες ")));
  const retired = await readJson(new URL("../state/sync-state.json", import.meta.url));
  const approved = ["collections.actors:folder-D8PPUHIE:1", "collections.actors:folder-D8PPUHIE:3", "collections.actors:folder-D8PPUHIE:5", "collections.actors:folder-ZISLC5VJ:1", "collections.actors:folder-ZISLC5VJ:3", "collections.actors:folder-ZISLC5VJ:5"];
  assert.ok(approved.every((key) => !manifest.rails.some((rail) => rail.key === key)));
  assert.ok(approved.every((key) => RETIRED_RAIL_REASONS.get(key) === "NO_SUBSTANTIVE_TV_CAST_CREDITS" && retired.retiredRails[key]?.reason === "NO_SUBSTANTIVE_TV_CAST_CREDITS"));
  const curated = manifest.rails.filter((rail) => rail.materializer === "curated_studio_features");
  assert.deepEqual(curated.map((rail) => [rail.folderId, rail.params.legacy.traktListId, rail.mediaType]), [
    ["folder-2XGVUWET", 801240, "MOVIE"], ["folder-4OZG50Y4", 28495261, "MOVIE"],
    ["folder-79DVGTP9", 23223808, "MOVIE"], ["folder-KIRXHA4A", 801239, "MOVIE"],
  ]);
  const portugal = manifest.rails.filter((rail) => rail.folderId === "collections.world.portuguese");
  const latin = manifest.rails.filter((rail) => rail.folderId === "collections.world.latin-american");
  const spanish = manifest.rails.filter((rail) => rail.folderId === "collections.world.spanish");
  assert.equal(portugal.length, 7); assert.ok(portugal.every((rail) => rail.params.originCountry === "PT"));
  assert.equal(latin.length, 8); assert.ok(latin.every((rail) => rail.params.originCountry === COUNTRY_BY_FOLDER["collections.world.latin-american"] && !rail.params.originCountry.split("|").includes("ES")));
  assert.equal(spanish.length, 8); assert.ok(spanish.every((rail) => rail.params.originCountry === "ES"));
  assert.ok([...portugal, ...latin].every((rail) => rail.params.legacy.filters.withOriginalLanguage == null));
  const input = await readJson(INPUT_FILE);
  assert.equal(input[4].id, "collections.moods"); assert.equal(input[4].title, "✨ Διάθεση & Ατμόσφαιρα");
  assert.equal(input[4].folders.length, 10); assert.ok(input[4].folders.every((folder) => folder.sources.length === 6));
  const genres = input.find((collection) => collection.id === "collections.genres");
  assert.ok(!genres.folders.some((folder) => folder.id === "folder-KQEZGAMF"));
  assert.ok(genres.folders.some((folder) => folder.title === "Κορεατικά δράματα (K-Drama)"));
  assert.ok(genres.folders.some((folder) => folder.title === "Ρομαντική κομεντί"));
  assert.deepEqual(genres.folders.map((folder) => folder.title), genres.folders.map((folder) => folder.title).toSorted((a, b) => a.localeCompare(b, "el")));
  const removedReality = ["collections.genres:folder-KQEZGAMF:0", "collections.genres:folder-KQEZGAMF:1", "collections.genres:folder-KQEZGAMF:2", "collections.genres:folder-KQEZGAMF:3"];
  assert.ok(removedReality.every((key) => retired.retiredRails[key]?.reason === "USER_APPROVED_REALITY_REMOVAL" && !retired.rails[key]));
  const discoverTop = manifest.rails.filter((rail) => rail.folderId === "collections.discover.top-rated-2");
  assert.deepEqual(discoverTop.map((rail) => rail.title), ["Κορυφαίες πρόσφατες ταινίες", "Κορυφαίες πρόσφατες σειρές", "Κορυφαίες ταινίες όλων των εποχών", "Κορυφαίες σειρές όλων των εποχών"]);
  assert.ok(discoverTop.every((rail) => rail.strategy === "materialized"));
  const filmSeries = manifest.rails.filter((rail) => rail.collectionId === "collections.film-series");
  assert.equal(filmSeries.length, 186);
  assert.ok(filmSeries.every((rail) => rail.strategy === "native" && rail.originalSource.tmdbSourceType === "COLLECTION" && rail.originalSource.sortBy === "primary_release_date.desc"));
});

test("studio feature policy rejects shorts, documentaries, TV movies, and future releases", () => {
  const policy = { minRuntime: 40, requiredGenreIds: [16], excludedGenreIds: [99, 10770] };
  assert.equal(isFeatureFilm({ runtime: 90, genres: [{ id: 16 }], release_date: "2026-01-01" }, policy, "2026-08-10"), true);
  assert.equal(isFeatureFilm({ runtime: 39, genres: [{ id: 16 }], release_date: "2026-01-01" }, policy, "2026-08-10"), false);
  assert.equal(isFeatureFilm({ runtime: 90, genres: [{ id: 16 }, { id: 99 }], release_date: "2026-01-01" }, policy, "2026-08-10"), false);
  assert.equal(isFeatureFilm({ runtime: 90, genres: [{ id: 16 }, { id: 10770 }], release_date: "2026-01-01" }, policy, "2026-08-10"), false);
  assert.equal(isFeatureFilm({ runtime: 90, genres: [{ id: 16 }], release_date: "2027-01-01" }, policy, "2026-08-10"), false);
});

test("curated studio baseline is preserved, dynamically extended, verified, and newest-first", async () => {
  const policy = { traktListId: 801240, expectedBaselineCount: 2, companyIds: [3], pinnedIds: [10, 11], requiredGenreIds: [16], excludedGenreIds: [99, 10770], minRuntime: 40 };
  const details = new Map([
    [10, { id: 10, runtime: 90, genres: [{ id: 16 }], release_date: "2020-01-01" }],
    [11, { id: 11, runtime: 95, genres: [{ id: 16 }], release_date: "2022-01-01" }],
    [12, { id: 12, runtime: 100, genres: [{ id: 16 }], release_date: "2026-01-01" }],
    [13, { id: 13, runtime: 10, genres: [{ id: 16 }], release_date: "2026-02-01" }],
  ]);
  const client = { discover: async () => [{ id: 12 }, { id: 13 }], details: async (_media, id) => details.get(id) };
  const result = await materializeRail(client, { key: "pixar", mediaType: "MOVIE", materializer: "curated_studio_features" }, { today: "2026-08-10", curatedStudio: policy });
  assert.equal(result.scope, "CURATED_FEATURES:TRAKT=801240:DYNAMIC_TMDB");
  assert.deepEqual(result.items.map((item) => item.id), [12, 11, 10]);
});

test("empty studio 24-month Recent widens to latest verified features without accepting noise", async () => {
  const calls = [];
  const client = {
    discover: async (_media, params) => { calls.push(params); return calls.length === 1 ? [{ id: 1 }] : [{ id: 2 }, { id: 3 }]; },
    details: async (_media, id) => id === 1
      ? { id, runtime: 53, genres: [{ id: 99 }], release_date: "2026-06-02" }
      : id === 2 ? { id, runtime: 120, genres: [{ id: 18 }], release_date: "2023-01-01" }
        : { id, runtime: 14, genres: [{ id: 16 }], release_date: "2026-07-08" },
  };
  const result = await materializeRail(client, { key: "studio", collectionId: "collections.studios", title: "Πρόσφατες ταινίες", mediaType: "MOVIE", materializer: "company", params: { legacy: { filters: {}, tmdbId: 17 } } }, { today: "2026-08-10", folderTitle: "Studio" });
  assert.equal(calls.length, 2); assert.equal(calls[0]["primary_release_date.gte"], "2024-08-10"); assert.equal(calls[1]["primary_release_date.gte"], undefined);
  assert.equal(result.scope, "GLOBAL:LATEST_AVAILABLE_FEATURE_FILMS_VERIFIED"); assert.deepEqual(result.items.map((item) => item.id), [2]);
});

test("poster gate excludes blank cards and automatically restores a title once TMDB adds a poster", async () => {
  let posterAvailable = false; let detailCalls = 0;
  const client = { details: async (_media, id) => { detailCalls++; return { id, poster_path: posterAvailable ? "/later.jpg" : null }; } };
  const input = [{ id: 1, media_type: "tv", poster_path: "/ready.jpg" }, { id: 2, media_type: "tv", poster_path: null }];
  assert.deepEqual((await requireUsablePosters(client, input, "tv")).map((item) => item.id), [1]);
  posterAvailable = true;
  assert.deepEqual((await requireUsablePosters(client, input, "tv")).map((item) => item.id), [1, 2]);
  assert.equal(detailCalls, 2);
});

test("runtime boundaries are exact and non-overlapping", () => {
  assert.deepEqual([89, 90, 149, 150, 179, 180].map(runtimeBucket), ["short", "standard", "standard", "long", "long", "epic"]);
});

test("all four materialized runtime folders send distinct exact TMDB bounds", async () => {
  const calls = [];
  const client = { discover: async (_media, params, limit) => { calls.push({ ...params, limit }); return [{ id: calls.length, vote_count: 500, popularity: 50, release_date: "2020-01-01" }]; }, details: async (_media, id) => ({ id, runtime: [null, 80, 100, 160, 200][id], release_date: "2020-01-01" }) };
  const folders = ["short", "standard", "long", "epic"];
  for (const name of folders) await materializeRail(client, { folderId: `collections.runtime.${name}`, collectionId: "collections.runtime", title: name, mediaType: "MOVIE", materializer: "runtime", params: { legacy: { filters: {} } } }, { today: "2026-08-10", folderTitle: name });
  assert.deepEqual(calls.map(({ "with_runtime.gte": gte, "with_runtime.lte": lte }) => [gte, lte]), [[undefined, 89], [90, 149], [150, 179], [180, undefined]]);
  assert.ok(calls.every((call) => call["vote_count.gte"] === 100 && call.sort_by === "popularity.desc" && call.limit === 500));
});

test("runtime daily rotation is deterministic, changes by Athens date, and admits only familiar titles", () => {
  const items = Array.from({ length: 180 }, (_, index) => ({ id: index + 1, vote_count: index < 5 ? 10 : 500 + index, popularity: 200 - index }));
  const first = dailyRuntimeSelection(items, "runtime:long", "2026-08-10");
  const repeat = dailyRuntimeSelection(items, "runtime:long", "2026-08-10");
  const next = dailyRuntimeSelection(items, "runtime:long", "2026-08-11");
  assert.deepEqual(first, repeat); assert.notDeepEqual(first.map((item) => item.id), next.map((item) => item.id));
  assert.equal(first.length, 100); assert.ok(first.every((item) => item.vote_count >= 100));
});

test("person rails reject self, archive, and uncredited noise and use vote-aware Top ranking", async () => {
  assert.equal(isSubstantiveCastCredit({ character: "Self (uncredited)" }), false);
  assert.equal(isSubstantiveCastCredit({ character: "Self (archive footage)" }), false);
  assert.equal(isSubstantiveCastCredit({ character: "Michael Corleone" }), true);
  const movieClient = { credits: async () => ({ cast: [
    { id: 516853, character: "Self (uncredited)", vote_average: 10, vote_count: 2, popularity: 1, release_date: "1998-07-03" },
    { id: 1213643, character: "Robert Maheu", vote_average: 10, vote_count: 1, popularity: 1, release_date: "2026-06-09" },
    { id: 238, character: "Michael Corleone", vote_average: 8.686, vote_count: 23307, popularity: 48, release_date: "1972-03-14" },
  ] }) };
  const top = await materializeRail(movieClient, { title: "Κορυφαίες ταινίες", mediaType: "MOVIE", materializer: "person_cast", params: { legacy: { tmdbId: 1158 } } }, { today: "2026-08-10" });
  assert.deepEqual(top.items.map((item) => item.id), [238, 1213643]);
  const tvClient = { credits: async () => ({ cast: [
    { id: 59941, character: "Self", episode_count: 1, popularity: 168, first_air_date: "2014-02-17" },
    { id: 79622, character: "Meyer Offerman", episode_count: 18, popularity: 24, first_air_date: "2020-02-20" },
  ] }) };
  const popular = await materializeRail(tvClient, { title: "Δημοφιλείς σειρές", mediaType: "TV", materializer: "person_cast", params: { legacy: { tmdbId: 1158 } } }, { today: "2026-08-10" });
  assert.deepEqual(popular.items.map((item) => item.id), [79622]);
});

test("same-poster transliterated TMDB duplicates collapse to the Greek canonical record", () => {
  const items = dedupeLikelyDuplicateWorks([
    { id: 324334, name: "From Sunrise to Sunset", original_name: "Apo ilio se ilio", original_language: "el", origin_country: ["GR"], first_air_date: "2026-03-03", poster_path: "/same.jpg", backdrop_path: "/backdrop.jpg" },
    { id: 315644, name: "Από Ήλιο σε Ήλιο", original_name: "Από Ήλιο σε Ήλιο", original_language: "el", origin_country: ["GR"], first_air_date: "2026-03-02", poster_path: "/same.jpg" },
  ], "tv");
  assert.deepEqual(items.map((item) => item.id), [315644]);
});

test("streaming fallback never mixes GR and Worldwide", async () => {
  const gr = [{ id: 1 }], world = [{ id: 2 }];
  assert.deepEqual(await chooseAvailability(gr, async () => world), { scope: "GR", items: gr });
  assert.deepEqual(await chooseAvailability([], async () => world), { scope: "WORLDWIDE", items: world });
  assert.throws(() => chooseAvailability(null, async () => world), /successful result/);
});

test("candidate normalization assigns media type and preserves first ordered identity", () => {
  const items = normalizeCandidateItems([{ id: 7 }, { id: 7 }, { id: 7, media_type: "movie" }, { id: 8 }], "tv");
  assert.deepEqual(items.map((item) => `${item.media_type}:${item.id}`), ["tv:7", "movie:7", "tv:8"]);
});

test("large-change confirmation tolerates tiny live churn but rejects semantic drift", () => {
  assert.equal(confirmationCompatible(["tv:1", "tv:2", "tv:3", "tv:4"], ["tv:1", "tv:2", "tv:3"]), true);
  assert.equal(confirmationCompatible(Array.from({ length: 100 }, (_, i) => `tv:${i}`), Array.from({ length: 95 }, (_, i) => `tv:${i}`)), true);
  assert.equal(confirmationCompatible(["tv:1", "tv:2", "tv:3", "tv:4"], ["tv:7"]), false);
});

test("verified award snapshots refresh weekly, while force remains available", () => {
  const now = new Date("2026-08-10T04:07:00Z");
  assert.equal(semanticRefreshDue({ lastVerified: "2026-08-09T04:07:00Z" }, now, 7), false);
  assert.equal(semanticRefreshDue({ lastSemanticRefresh: "2026-08-03T04:06:59Z" }, now, 7), true);
  assert.equal(semanticRefreshDue({}, now, 7), true);
});

test("streaming requests only allowed monetization and prefers successful GR", async () => {
  const calls = [];
  const client = { providers: async () => [{ provider_id: 8, provider_name: "Netflix", display_priorities: { GR: 1, US: 1 } }], watchRegions: async () => [{ iso_3166_1: "GR" }, { iso_3166_1: "US" }], discover: async (_media, params) => { calls.push(params); return params.watch_region === "GR" ? [{ id: 1, popularity: 2, release_date: "2026-01-01" }] : [{ id: 2 }]; } };
  const rail = { key: "x", collectionId: "collections.streaming", title: "Δημοφιλείς ταινίες", mediaType: "MOVIE", materializer: "streaming", params: { legacy: { filters: {}, sortBy: "popularity.desc" } } };
  const result = await materializeRail(client, rail, { folderTitle: "Netflix", providerAliases: ["Netflix"], today: "2026-08-09" });
  assert.equal(result.scope, "GR"); assert.deepEqual(result.items.map((x) => x.id), [1]); assert.equal(calls.length, 1); assert.equal(calls[0].with_watch_monetization_types, "flatrate|free|ads");
});

test("provider trending widens from official day to week only when day is empty everywhere", async () => {
  const windows = [];
  const client = {
    providers: async () => [{ provider_id: 350, provider_name: "Apple TV", display_priorities: { GR: 1 } }],
    trending: async (_media, window) => { windows.push(window); return window === "day" ? [{ id: 1 }] : [{ id: 2, poster_path: "/week.jpg" }]; },
    watchProviders: async (_media, id) => id === 2 ? { GR: { flatrate: [{ provider_id: 350 }] } } : {},
  };
  const rail = { title: "Τάσεις ταινιών", mediaType: "MOVIE", materializer: "streaming", params: { legacy: { filters: {} } } };
  const result = await materializeRail(client, rail, { folderTitle: "Apple TV", providerAliases: [], today: "2026-08-10" });
  assert.deepEqual(windows, ["day", "week"]); assert.equal(result.scope, "GR"); assert.deepEqual(result.items.map((item) => item.id), [2]);
});

test("TV-only semantic genres use keywords without invalid movie genre IDs", async () => {
  const client = { keywordIds: async (names) => names.map((_, index) => index + 1) };
  for (const title of ["Σειρές τρόμου", "Ρομαντικές σειρές", "Σειρές θρίλερ", "Μουσικές σειρές", "Ιστορικές σειρές"]) {
    const params = { with_genres: "999" };
    await applySemanticPredicates(client, { title }, "tv", params, "");
    assert.equal(params.with_genres, undefined, title);
    assert.ok(params.with_keywords, title);
  }
  const war = {};
  await applySemanticPredicates(client, { title: "Πολεμικές σειρές" }, "tv", war, "");
  assert.equal(war.with_genres, "10768"); assert.ok(war.with_keywords);
});

test("nature documentaries tolerate TMDB keyword sparsity while remaining documentaries", async () => {
  const names = []; const params = {};
  const client = { keywordIds: async (values) => { names.push(...values); return values.map((_, index) => index + 1); } };
  await applySemanticPredicates(client, { title: "Ντοκιμαντέρ φύσης" }, "movie", params, "Paramount+");
  assert.equal(params.with_genres, "99");
  assert.deepEqual(names, ["nature", "wildlife", "natural history", "environment", "ecology"]);
  assert.equal(params.with_keywords, "1|2|3|4|5");
});

test("Greek semantic labels do not confuse family with new or martial arts with war", async () => {
  const family = discoverParams({ title: "Οικογενειακές ταινίες", params: { legacy: { filters: {}, sortBy: "popularity.desc" } } }, "movie", "2026-08-10");
  assert.equal(family["primary_release_date.gte"], undefined); assert.equal(family.sort_by, "popularity.desc");
  const fresh = discoverParams({ title: "Νέες ταινίες", params: { legacy: { filters: {}, sortBy: "popularity.desc" } } }, "movie", "2026-08-10");
  assert.equal(fresh["primary_release_date.gte"], "2026-01-01");
  const params = {}; const client = { keywordIds: async () => [ martialArtsKeywordId ] }; const martialArtsKeywordId = 779;
  await applySemanticPredicates(client, { title: "Ταινίες πολεμικών τεχνών" }, "movie", params, "Πολεμικές τέχνες");
  assert.equal(params.with_genres, "28"); assert.equal(params.with_keywords, String(martialArtsKeywordId));
});

test("Discover Popular keeps its vote quorum while generic New and Recent retain their established semantics", () => {
  const legacy = { filters: { voteCountGte: 10, voteAverageGte: 6 }, sortBy: "vote_average.desc" };
  for (const title of ["Νέες σειρές", "Πρόσφατες σειρές"]) {
    const params = discoverParams({ title, params: { legacy } }, "tv", "2026-08-10");
    assert.equal(params["vote_count.gte"], undefined, title); assert.equal(params["vote_average.gte"], undefined, title);
  }
  const popular = discoverParams({ title: "Δημοφιλείς σειρές", params: { legacy, discoverPolicy: { kind: "popular" } } }, "tv", "2026-08-10");
  assert.equal(popular["vote_count.gte"], 10); assert.equal(popular["vote_average.gte"], undefined); assert.equal(popular.sort_by, "popularity.desc");
  const year = discoverParams({ title: "Δημοφιλείς σειρές της χρονιάς", params: { legacy, discoverPolicy: { kind: "popular_year" } } }, "tv", "2026-08-10");
  assert.equal(year["vote_count.gte"], 10); assert.equal(year["first_air_date.gte"], "2026-01-01"); assert.equal(year["first_air_date.lte"], "2026-08-10");
  const genreNew = discoverParams({ collectionId: "collections.genres", title: "Νέες σειρές", params: { legacy } }, "tv", "2026-08-10");
  assert.equal(genreNew["vote_count.gte"], 10); assert.equal(genreNew["vote_average.gte"], undefined);
  const top = discoverParams({ title: "Κορυφαίες σειρές", params: { legacy } }, "tv", "2026-08-10");
  assert.equal(top["vote_count.gte"], 10); assert.equal(top["vote_average.gte"], 6);
});

test("Discover Popular collapses same-title regional clones and keeps the recognized work", async () => {
  const client = { discover: async () => [
    { id: 1, name: "Paradise Hotel", original_name: "Paradise Hotel", vote_count: 10, popularity: 90, first_air_date: "2024-01-01" },
    { id: 2, name: "Paradise Hotel", original_name: "Paradise Hotel", vote_count: 900, popularity: 50, first_air_date: "2025-01-01" },
    { id: 3, name: "Recognized Series", original_name: "Recognized Series", vote_count: 700, popularity: 80, first_air_date: "2025-01-01" },
  ] };
  const rail = { collectionId: "collections.discover", title: "Δημοφιλείς σειρές", mediaType: "TV", materializer: "discover", params: { legacy: { filters: { voteCountGte: 500 } }, discoverPolicy: { kind: "popular", dedupeCanonicalTitle: true } } };
  const result = await materializeRail(client, rail, { today: "2026-08-10" });
  assert.deepEqual(result.items.map((item) => item.id), [3, 2]);
});

test("recent Top is rolling 24 months while all-time Top removes the old classic cutoff", () => {
  const legacy = { filters: { releaseDateLte: "1999-12-31", voteCountGte: 1000 }, sortBy: "vote_average.desc" };
  const recent = discoverParams({ title: "Κορυφαίες πρόσφατες ταινίες", params: { legacy, discoverPolicy: { kind: "top_recent", voteCountGte: 500 } } }, "movie", "2026-08-10");
  assert.equal(recent["primary_release_date.gte"], "2024-08-10"); assert.equal(recent["primary_release_date.lte"], "2026-08-10"); assert.equal(recent["vote_count.gte"], 500);
  const allTime = discoverParams({ title: "Κορυφαίες ταινίες όλων των εποχών", params: { legacy, discoverPolicy: { kind: "top_all_time", voteCountGte: 5000 } } }, "movie", "2026-08-10");
  assert.equal(allTime["primary_release_date.gte"], undefined); assert.equal(allTime["primary_release_date.lte"], "2026-08-10"); assert.equal(allTime["vote_count.gte"], 5000);
});

test("all genre New rails carry their manifest vote floor into TMDB Discover", async () => {
  const manifest = await readJson(new URL("../config/rails.yml", import.meta.url));
  const fresh = manifest.rails.filter((rail) => rail.collectionId === "collections.genres" && /^Νέ/.test(rail.title));
  assert.equal(fresh.length, 47);
  for (const rail of fresh) {
    const media = rail.mediaType === "TV" ? "tv" : "movie";
    assert.equal(discoverParams(rail, media, "2026-08-10")["vote_count.gte"], rail.params.legacy.filters.voteCountGte, rail.key);
  }
});

test("Nuvio 0.8.3 media contract catches the reviewed series-as-movie profile corruption", () => {
  const canonical = [{ id: "collections.actors", folders: [{ id: "actor", sources: [{ provider: "tmdb", tmdbSourceType: "LIST", tmdbId: 1, title: "Δημοφιλείς σειρές", type: "series", mediaType: "TV" }] }] }];
  const profile = structuredClone(canonical); profile[0].folders[0].sources[0].mediaType = "MOVIE";
  assert.equal(emulateNuvio083MediaType({ mediaType: null }), "MOVIE");
  assert.throws(() => assertNuvioMediaTypeContract(profile, { managedOnly: true }), /media type contract failed/);
  const report = compareProfile(profile, canonical);
  assert.equal(report.totals.mediaTypeMismatches, 1); assert.deepEqual(report.affectedCollectionIds, ["collections.actors"]);
  assert.deepEqual(report.byCollection["collections.actors"], { mediaTypeMismatches: 1, missing: 0, extra: 0, repairRequired: true });
  assert.deepEqual(report.mismatches[0].canonical, { type: "series", mediaType: "TV" });
  assert.deepEqual(report.mismatches[0].profile, { type: "series", mediaType: "MOVIE" });
});

test("Nuvio 0.8.3 LIST editor hardcodes MOVIE while DataStore preserves TV", async () => {
  const {
    emulateNuvio083DataStoreMediaType,
    emulateNuvio083ListEditorMediaType,
    emulateNuvio083DataStoreRoundTrip,
    emulateMobileListTvCorruption,
    analyzeListTvCompat,
    minimalListTvProbeSource,
    minimalListTvProbeCollection,
  } = await import("../src/nuvio-list-compat.mjs");
  const probe = minimalListTvProbeSource();
  const probeCollection = minimalListTvProbeCollection(probe)[0];
  const probeArtifact = await readJson(new URL("../dist/nuvio-list-tv-mediaType-probe.json", import.meta.url));
  assert.deepEqual(probeArtifact, [probeCollection]);
  assert.match(probeCollection.title, /^TEST PROFILE ONLY/);
  assert.equal(probeCollection.folders.length, 1);
  assert.equal(emulateNuvio083DataStoreMediaType(probe), "TV");
  assert.equal(emulateNuvio083ListEditorMediaType(probe), "MOVIE");
  assert.equal(emulateNuvio083ListEditorMediaType({ tmdbSourceType: "DISCOVER", mediaType: "TV" }), "TV");
  const roundTrip = emulateNuvio083DataStoreRoundTrip(probe);
  assert.equal(roundTrip.mediaType, "TV");
  assert.equal(roundTrip.type, null);
  assert.equal(roundTrip.tmdbId, probe.tmdbId);
  assert.deepEqual(emulateMobileListTvCorruption(probe), { ...probe, mediaType: "MOVIE" });
  const compiled = await compile({ allowPlaceholders: true });
  const artifact = await readJson(compiled.output);
  const sources = artifact.flatMap((c) => c.folders ?? []).flatMap((f) => f.sources ?? []);
  const listTv = sources.filter((s) => s.provider === "tmdb" && s.tmdbSourceType === "LIST" && s.mediaType === "TV");
  const nativeTv = sources.filter((s) => s.provider === "tmdb" && s.tmdbSourceType !== "LIST" && s.mediaType === "TV");
  assert.equal(listTv.length, 1055);
  assert.equal(nativeTv.length, 120);
  assert.ok(listTv.every((s) => s.type === "series" && s.sortBy === "original"));
  assert.ok(listTv.every((s) => emulateNuvio083DataStoreRoundTrip(s).mediaType === "TV"));
  const corrupted = listTv.map(emulateMobileListTvCorruption);
  const analysis = analyzeListTvCompat(sources, [...corrupted, ...nativeTv]);
  assert.equal(analysis.canonicalListTv, 1055);
  assert.equal(analysis.profileSeriesMovieList, 1055);
  assert.equal(analysis.profileSeriesTvList, 0);
  assert.equal(analysis.profileNativeSeriesTv, 120);
  assert.equal(analysis.editorWouldForceMovie, true);
  assert.equal(analysis.dataStoreWouldPreserveTv, true);
});

test("collections.world folders are Greek-locale sorted with Λ and Π in place", async () => {
  const input = await readJson(INPUT_FILE);
  const world = input.find((collection) => collection.id === "collections.world");
  const titles = world.folders.map((folder) => folder.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, "el")));
  assert.ok(titles.indexOf("Λατινοαμερικανικές") > titles.indexOf("Κορεάτικες") && titles.indexOf("Λατινοαμερικανικές") < titles.indexOf("Μεξικάνικες"));
  assert.ok(titles.indexOf("Πορτογαλικές") > titles.indexOf("Πολωνικές") && titles.indexOf("Πορτογαλικές") < titles.indexOf("Ρωσικές"));
  assert.equal(world.folders.length, 58);
  assert.equal(world.folders.filter((folder) => folder.id === "collections.world.portuguese" || folder.id === "collections.world.latin-american").length, 2);
});

test("Timothée Chalamet uses the reviewed corrected asset set", async () => {
  const input = await readJson(INPUT_FILE), folder = input.flatMap((collection) => collection.folders).find((item) => item.id === "folder-I2BO9LZU");
  assert.deepEqual([folder.focusGifUrl, folder.titleLogoUrl, folder.coverImageUrl, folder.heroBackdropUrl], [
    "https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/Actors/Timoth_e_Chalamet/Timoth_e_Chalamet_Hover.gif",
    "https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/TitleLogos/Timoth_e_Chalamet_TitleLogo.png",
    "https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/Actors/Timoth_e_Chalamet/Timoth_e_Chalamet_Base.png",
    "https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main/Actors/Timoth_e_Chalamet/Timoth_e_Chalamet_Background.jpg",
  ]);
});

test("Nuvio 0.8.3 exclusions map to the exact TMDB Discover parameters", () => {
  const params = discoverParams({ title: "Δημοφιλείς ταινίες", params: { legacy: { filters: { withoutGenres: "16", withoutKeywords: "818|9715", withoutCompanies: "2", withoutWatchProviders: "8|337" }, sortBy: "popularity.desc" } } }, "movie", "2026-08-10");
  assert.equal(params.without_genres, "16"); assert.equal(params.without_keywords, "818|9715");
  assert.equal(params.without_companies, "2"); assert.equal(params.without_watch_providers, "8|337");
});

test("Worldwide streaming unions every advertised official provider region", async () => {
  const calls = [];
  const client = {
    providers: async () => [{ provider_id: 15, provider_name: "Hulu", display_priorities: { GR: 1, US: 2, JP: 3, ZZ: 4 } }],
    watchRegions: async () => [{ iso_3166_1: "GR" }, { iso_3166_1: "US" }, { iso_3166_1: "JP" }],
    discover: async (_media, params) => { calls.push(params); if (params.watch_region === "US") return [{ id: 2, popularity: 20, release_date: "2026-02-01" }]; if (params.watch_region === "JP") return [{ id: 3, popularity: 10, release_date: "2026-01-01" }]; return []; },
  };
  const rail = { key: "x", collectionId: "collections.streaming", title: "Δημοφιλείς ταινίες", mediaType: "MOVIE", materializer: "streaming", params: { legacy: { filters: {}, sortBy: "popularity.desc" } } };
  const result = await materializeRail(client, rail, { folderTitle: "Hulu", providerAliases: ["Hulu"], today: "2026-08-10" });
  assert.equal(result.scope, "WORLDWIDE"); assert.deepEqual(result.items.map((item) => item.id), [2, 3]);
  assert.deepEqual(calls.map((call) => call.watch_region), ["GR", "JP", "US"]);
  assert.ok(calls.every((call) => call.with_watch_monetization_types === "flatrate|free|ads"));
});

test("TMDB award extractor returns winner works, including acting work", async () => {
  const html = `<h4>97th Awards (2025)</h4><div><p class="status"><bdi>Winner</bdi></p><a data-media-type="person" href="/person/1-a">A</a><p><a href="/movie/99-work">Work</a></p></div>`;
  const client = new TmdbClient({ readToken: "test", fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }) });
  assert.deepEqual(await client.awardWinners({ awardId: 1, slug: "academy-awards", categoryId: 3, categorySlug: "best-actor" }), [{ id: 99, media_type: "movie", award_year: 2025 }]);
});

test("official Cannes parser distinguishes work and acting cards", async () => {
  const html = `<div class="list_item flex"><div class="list_item__content x"><a href="https://www.festival-cannes.com/en/f/work/" class="list_item__content__title"><p>WORK</p></a><span class="block">by DIRECTOR</span><div class="list_item__award"><span>Palme d'or</span></div></div></div><div class="list_item flex"><div class="list_item__content x"><a href="https://www.festival-cannes.com/en/p/actor/" class="list_item__content__title"><p>ACTOR</p></a><span class="block">for SECOND WORK</span><div class="list_item__award"><span>Award for Best Actor</span></div></div></div>`;
  const client = new TmdbClient({ readToken: "test", fetchImpl: async () => new Response(html, { status: 200 }) });
  const records = await client.cannesYear(2000);
  assert.deepEqual(records.map((x) => [x.workTitle, x.contributor, x.award]), [["WORK", "DIRECTOR", "Palme d'or"], ["SECOND WORK", "ACTOR", "Award for Best Actor"]]);
  assert.equal(client.cannesCategoryMatches("palme_feature", records[0]), true);
  assert.equal(client.cannesCategoryMatches("actor", records[1]), true);
  assert.equal(client.cannesCategoryMatches("palme_feature", { year: 1969, award: "Grand Prix International du Festival" }), true);
  assert.equal(client.cannesCategoryMatches("grand_prix", { year: 1969, award: "Jury's Special Grand Prix" }), true);
  assert.equal(client.cannesCategoryMatches("actress", { year: 1946, award: "Grand Prix International de la meilleure interprétation féminine" }), true);
});

test("Cannes short top-prize rail starts with the official 1952 Grand Prix lineage", async () => {
  await bootstrap();
  const awards = await readJson(new URL("../config/awards.yml", import.meta.url));
  const rail = awards.rails.find((item) => item.key === "collections.awards:folder-4ee02f67:1");
  assert.equal(rail.startYear, 1952);
  assert.match(rail.title, /Grand Prix 1952–1954/);
  assert.match(rail.title, /Χρυσός Φοίνικας από το 1955/);
});

test("reviewed award overrides bypass fuzzy year matching but verify the TMDB endpoint", async () => {
  const client = new TmdbClient({ readToken: "test", fetchImpl: async () => new Response(JSON.stringify({ id: 675171, title: "Dangerous Curves", release_date: "1950-10-11", vote_count: 3 }), { status: 200 }) });
  const item = await client.resolveCannesWork({ year: 1956, workTitle: "Dangerous Curves (UK)", contributor: "" }, "globes:9", { "1956:globes:9:dangerous curves uk": 675171 }, "movie");
  assert.equal(item.id, 675171); assert.equal(item._override_key, "1956:globes:9:dangerous curves uk");
});

test("concurrent TMDB cache coalesces identical reads", async () => {
  let calls = 0; const client = new TmdbClient({ readToken: "test", fetchImpl: async () => { calls++; return new Response(JSON.stringify({ results: [{ id: 8, provider_name: "Netflix" }] }), { status: 200 }); } });
  const [a, b, c] = await Promise.all([client.providers("movie"), client.providers("movie"), client.providers("movie")]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.deepEqual(b, c);
});

test("TMDB list invalid-media responses expose typed quarantine identities", async () => {
  const body = { results: [{ media_id: 1, media_type: "movie", success: true }, { media_id: 2, media_type: "movie", success: false, error: ["Media is invalid"] }, { media_id: 3, media_type: "movie", success: false, error: ["Media is required"] }] };
  const client = new TmdbClient({ readToken: "test", userToken: "user", fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }) });
  await assert.rejects(client.addItems(99, [{ id: 1, media_type: "movie" }, { id: 2, media_type: "movie" }, { id: 3, media_type: "movie" }]), (error) => {
    assert.deepEqual(error.invalidItems, [{ id: 2, media_type: "movie", reason: "TMDB_LIST_MEDIA_INVALID" }, { id: 3, media_type: "movie", reason: "TMDB_LIST_MEDIA_REQUIRED" }]); return true;
  });
});

test("person credits are coalesced across sibling rails", async () => {
  let calls = 0; const client = new TmdbClient({ readToken: "test", fetchImpl: async () => { calls++; return new Response(JSON.stringify({ cast: [{ id: 1 }], crew: [] }), { status: 200 }); } });
  const [a, b] = await Promise.all([client.credits(42, "movie"), client.credits(42, "movie")]);
  assert.equal(calls, 1); assert.deepEqual(a, b);
});

test("official Oscars and Golden Globes parsers extract winner works", async () => {
  const oscars = `<div class="paragraph paragraph--type--award-category"><div class="field--name-field-award-category-oscars">Best Picture</div><div class="paragraph--type--award-honoree"><div class="field--name-field-honoree-type winner">Winner</div><div class="field--name-field-award-entities"><div class="field__item">Producer</div></div><div class="field--name-field-award-film">Film A</div></div></div>`;
  const globes = `<div class="c-nominations-category"><h3 class="c-nominations-category__heading">Best Performance by an Actor in a Motion Picture - Drama</h3><div class="c-nomination-category-winner__details"><div class="c-nomination-details"><div class="c-nomination-details__status">Winner</div><div class="c-nomination-details__title"><a>Actor A</a></div><div class="c-nomination-details__show"><a>Film B</a></div></div></div></div></div>`;
  const client = new TmdbClient({ readToken: "test", fetchImpl: async (url) => new Response(String(url).includes("oscars.org") ? oscars : globes, { status: 200 }) });
  assert.deepEqual((await client.oscarsYear(2020)).map((x) => [x.category, x.workTitle]), [["Best Picture", "Film A"]]);
  assert.deepEqual((await client.globesYear(2020)).map((x) => [x.category, x.workTitle, x.contributor]), [["Best Performance by an Actor in a Motion Picture - Drama", "Film B", "Actor A"]]);
  assert.equal(client.oscarCategoryMatches("picture", "Outstanding Production"), true);
  assert.equal(client.goldenCategoryMatches(12, "Best Performance by an Actor in a Motion Picture - Drama"), true);
  assert.equal(client.goldenCategoryMatches(7, "Picture", 1944), true);
  assert.equal(client.goldenCategoryMatches(46, "Actor In A Television Series", 1962), true);
  assert.equal(client.goldenCategoryMatches(49, "Actor In A Television Series", 1962), false);
  assert.equal(client.goldenCategoryMatches(6, "Television Producer/Director", 1963), false);
});

test("versioned Academy snapshot covers all 98 ceremonies and historical category names", async () => {
  const client = new TmdbClient({ readToken: "test", fetchImpl: async () => { throw new Error("network must not be used"); } });
  const snapshot = await client.academyAwardsSnapshot();
  assert.equal(snapshot.records.length, 2232);
  assert.deepEqual([Math.min(...snapshot.records.map((x) => x.ceremonyNumber)), Math.max(...snapshot.records.map((x) => x.ceremonyNumber))], [1, 98]);
  assert.equal(snapshot.records.filter((x) => client.oscarCategoryMatches("picture", x.category)).length, 98);
  assert.equal(client.oscarCategoryMatches("animated_short", "SHORT SUBJECT (Cartoon)"), true);
  assert.equal(client.oscarCategoryMatches("live_action_short", "SHORT SUBJECT (Two-reel)"), true);
  assert.equal(client.oscarCategoryMatches("adapted_screenplay", "WRITING (Adaptation)"), true);
  assert.equal(client.oscarCategoryMatches("special_effects", "ENGINEERING EFFECTS"), true);
  assert.equal(client.oscarCategoryMatches("sound_editing", "SPECIAL ACHIEVEMENT AWARD (Sound Effects Editing)"), true);
  assert.equal(client.oscarCategoryMatches("score", "MUSIC (Original Dramatic Score)"), true);
  assert.equal(client.oscarCategoryMatches("score", "MUSIC (Scoring of Music--adaptation or treatment)"), false);
});

test("versioned Cannes snapshot is official and complete through 2026", async () => {
  const snapshot = await readJson(new URL("../data/cannes-awards-winners-2026.json", import.meta.url));
  assert.equal(snapshot.authority, "https://www.festival-cannes.com/en/retrospective/");
  assert.equal(snapshot.completeThroughYear, 2026); assert.equal(snapshot.records.length, 1324);
  assert.equal(Math.min(...snapshot.records.map((record) => record.year)), 1946);
  assert.equal(Math.max(...snapshot.records.map((record) => record.year)), 2026);
});

test("Academy resolver uses the official title and bounded year search", async () => {
  const calls = [];
  const client = new TmdbClient({ readToken: "test", fetchImpl: async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ results: [{ id: 11, title: "Wings", original_title: "Wings", release_date: "1927-08-12", vote_count: 100 }] }), { status: 200 });
  } });
  const item = await client.resolveAcademyWork({ filmId: 966, year: 1929, workTitle: "Wings", contributor: "Paramount Famous Lasky", authorityUrl: "https://awardsdatabase.oscars.org/Search/Nominations?filmId=966" }, "picture");
  assert.equal(item.id, 11);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /search\/movie/);
  assert.match(calls[0], /year=1928/);
});

test("placeholder compilation preserves all folders and recommended byte semantics", async () => {
  await bootstrap(); const compiled = await compile({ allowPlaceholders: true });
  const [before, after] = await Promise.all([readJson(INPUT_FILE), readJson(compiled.output)]);
  const getRecommended = (data) => data.flatMap((c) => c.folders).find((f) => f.id === RECOMMENDED_FOLDER_ID);
  assert.equal(fingerprint(getRecommended(before)), fingerprint(getRecommended(after)));
  assert.deepEqual(getRecommended(after).sources.map(({ type, genre, addonId, catalogId }) => ({ type, genre, addonId, catalogId })), RECOMMENDED_CATALOGS);
  assert.deepEqual(getRecommended(after).catalogSources, RECOMMENDED_CATALOGS);
  assert.equal(after.flatMap((c) => c.folders).length, 548);
  assert.equal(after.flatMap((c) => c.folders).flatMap((f) => f.sources).length, 2677);
  assert.ok(after.flatMap((c) => c.folders).filter((folder) => folder.id !== RECOMMENDED_FOLDER_ID).every((folder) => folder.sources.length > 0));
  const managed = after.flatMap((c) => c.folders).filter((f) => f.id !== RECOMMENDED_FOLDER_ID).flatMap((f) => f.sources);
  assert.equal(managed.filter((s) => s.provider === "trakt" || s.traktListId).length, 0);
  assert.ok(managed.filter((s) => s.tmdbSourceType === "LIST").every((s) => s.sortBy === "original"));
  const filmSeries = after.find((collection) => collection.id === "collections.film-series").folders.flatMap((folder) => folder.sources);
  assert.equal(filmSeries.length, 186);
  assert.ok(filmSeries.every((source) => source.tmdbSourceType === "COLLECTION" && source.sortBy === "primary_release_date.desc"));
  assert.ok(managed.filter((s) => s.provider === "tmdb").every((s) => s.type === (s.mediaType === "TV" ? "series" : "movie")));
  assert.equal(assertNuvioMediaTypeContract(after, { managedOnly: true }), true);
});
