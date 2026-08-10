import { ALLOWED_MONETIZATION, MATERIALIZED_LIMIT } from "./constants.mjs";
import { dateFor, normalizeText, uniqueItems, shiftYears, mapLimit } from "./utils.mjs";

export function runtimeBucket(minutes) { if (minutes < 90) return "short"; if (minutes < 150) return "standard"; if (minutes < 180) return "long"; return "epic"; }

export function chooseAvailability(gr, worldwideFactory) {
  if (!Array.isArray(gr)) throw new Error("GR availability was not a successful result");
  if (gr.length) return { scope: "GR", items: gr };
  return Promise.resolve().then(worldwideFactory).then((items) => ({ scope: "WORLDWIDE", items }));
}

function apiSort(value = "popularity.desc") { return (value ?? "popularity.desc").replace("first_air_date", "first_air_date").replace("primary_release_date", "primary_release_date"); }
function isNewRail(title) { return /(?:^|\s)νε(?:ες|α|οι)?(?:\s|$)/u.test(title); }
function isTrendingRail(title) { return /(?:^|\s)τασεις?(?:\s|$)/u.test(title); }
export function discoverParams(rail, media, today) {
  const f = rail.params.legacy?.filters ?? {}, title = normalizeText(rail.title ?? ""), p = { include_adult: false, include_video: false, sort_by: apiSort(rail.params.sortBy ?? rail.params.legacy?.sortBy) };
  const datePrefix = media === "movie" ? "primary_release_date" : "first_air_date";
  if (f.voteCountGte != null) p["vote_count.gte"] = f.voteCountGte;
  if (f.voteAverageGte != null) p["vote_average.gte"] = f.voteAverageGte;
  if (f.withGenres) p.with_genres = Array.isArray(f.withGenres) ? f.withGenres.join(",") : f.withGenres;
  if (f.withoutGenres) p.without_genres = Array.isArray(f.withoutGenres) ? f.withoutGenres.join(",") : f.withoutGenres;
  if (f.withKeywords) p.with_keywords = Array.isArray(f.withKeywords) ? f.withKeywords.join("|") : f.withKeywords;
  if (f.withoutKeywords) p.without_keywords = Array.isArray(f.withoutKeywords) ? f.withoutKeywords.join("|") : f.withoutKeywords;
  if (f.withoutCompanies) p.without_companies = Array.isArray(f.withoutCompanies) ? f.withoutCompanies.join(",") : f.withoutCompanies;
  if (f.withoutWatchProviders) p.without_watch_providers = Array.isArray(f.withoutWatchProviders) ? f.withoutWatchProviders.join("|") : f.withoutWatchProviders;
  if (f.withOriginCountry) p.with_origin_country = f.withOriginCountry;
  if (rail.params.originCountry) p.with_origin_country = rail.params.originCountry;
  if (f.releaseDateGte) p[`${datePrefix}.gte`] = f.releaseDateGte;
  if (f.releaseDateLte) p[`${datePrefix}.lte`] = f.releaseDateLte > today ? today : f.releaseDateLte;
  if (f.year) { p[`${datePrefix}.gte`] = `${f.year}-01-01`; p[`${datePrefix}.lte`] = String(f.year) === today.slice(0, 4) ? today : `${f.year}-12-31`; }
  if (rail.params.summary) { p[`${datePrefix}.gte`] = rail.params.startDate; p[`${datePrefix}.lte`] = today; if (p.sort_by === "vote_average.desc") p["vote_count.gte"] = media === "movie" ? 500 : 200; }
  if (title.includes("κορυφ")) { p.sort_by = "vote_average.desc"; p["vote_count.gte"] ??= media === "movie" ? 500 : 200; }
  else if (title.includes("προσφα")) { delete p["vote_count.gte"]; delete p["vote_average.gte"]; p.sort_by = `${datePrefix}.desc`; p[`${datePrefix}.gte`] = shiftYears(today, -2); }
  else if (isNewRail(title) || title.includes("της χρονιας")) { delete p["vote_count.gte"]; delete p["vote_average.gte"]; p.sort_by = `${datePrefix}.desc`; p[`${datePrefix}.gte`] = `${today.slice(0, 4)}-01-01`; }
  else if (title.includes("δημοφιλ")) { delete p["vote_count.gte"]; delete p["vote_average.gte"]; p.sort_by = "popularity.desc"; }
  if (!p[`${datePrefix}.lte`]) p[`${datePrefix}.lte`] = today;
  return p;
}

function rank(items, rail, media, today, full = false) {
  const title = normalizeText(rail.title ?? ""), filtered = uniqueItems(items, media).filter((x) => { const d = dateFor(x, media); return !d || d <= today; });
  const comparator = title.includes("κορυφ") || title.includes("top") ? (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.vote_count ?? 0) - (a.vote_count ?? 0) || a.id - b.id : isNewRail(title) || title.includes("προσφα") ? (a, b) => String(dateFor(b, media) ?? "").localeCompare(String(dateFor(a, media) ?? "")) || a.id - b.id : (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id - b.id;
  return filtered.sort(comparator).slice(0, full ? filtered.length : MATERIALIZED_LIMIT).map((x) => ({ ...x, media_type: media }));
}

export async function applySemanticPredicates(client, rail, media, params, folderTitle = "") {
  const text = normalizeText(`${folderTitle} ${rail.title ?? ""}`), isTv = media === "tv";
  const genreRules = [
    [/πολεμικες τεχνες/, isTv ? 10759 : 28],
    [/δρασ|περιπετ/, isTv ? 10759 : /περιπετ/.test(text) ? 12 : 28], [/κινουμεν|ανιμε/, 16], [/κωμ/, 35],
    [/αστυνομ|εγκλημ/, 80], [/ντοκιμαντερ/, 99], [/δραμα/, 18], [/οικογεν/, 10751],
    [/φαντασι|επιστημονικη φαντασια/, isTv ? 10765 : /επιστημονικη/.test(text) ? 878 : 14],
    [/ιστορ/, isTv ? null : 36], [/τρομ/, isTv ? null : 27], [/μουσικ|μιουζικαλ/, isTv ? null : 10402], [/μυστηρ/, 9648],
    [/ριαλιτι/, 10764], [/ρομαντ/, isTv ? null : 10749], [/θριλερ/, isTv ? null : 53], [/πολεμ/, isTv ? 10768 : 10752], [/γουεστερν/, 37],
  ];
  const matched = genreRules.find(([pattern]) => pattern.test(text));
  if (matched?.[1] != null) params.with_genres = String(matched[1]);
  else if (matched) delete params.with_genres;
  const keywordNames = [];
  if (/ανιμε/.test(text)) keywordNames.push("anime");
  if (/πολεμικες τεχνες/.test(text)) keywordNames.push("martial arts");
  if (/φυσης/.test(text)) keywordNames.push("nature");
  if (/αθλητ/.test(text)) keywordNames.push("sport");
  if (/κωμικες παραστασεις/.test(text)) keywordNames.push("stand-up comedy");
  if (/υπερηρω/.test(text)) keywordNames.push("superhero");
  if (isTv && /θριλερ/.test(text)) keywordNames.push("thriller", "suspense", "psychological thriller", "crime thriller");
  if (isTv && /τρομ/.test(text)) keywordNames.push("horror", "supernatural horror", "psychological horror");
  if (isTv && /ρομαντ/.test(text)) keywordNames.push("romance", "love", "romantic relationship");
  if (isTv && /μουσικ|μιουζικαλ/.test(text)) keywordNames.push("music", "musical");
  if (isTv && /ιστορ/.test(text)) keywordNames.push("history", "historical");
  if (isTv && /φαντασι/.test(text)) keywordNames.push("fantasy", "magic", "supernatural");
  if (isTv && /πολεμ/.test(text)) keywordNames.push("war", "warfare", "military");
  if (keywordNames.length) { const ids = await client.keywordIds(keywordNames); if (!ids.length) throw new Error(`Semantic keywords unresolved: ${keywordNames.join(", ")}`); params.with_keywords = ids.join("|"); }
  return params;
}

async function resolveProvider(client, media, folderTitle, aliases = []) {
  const names = [folderTitle, ...aliases].map(normalizeText); const providers = await client.providers(media);
  return providers.filter((p) => names.includes(normalizeText(p.provider_name)));
}

async function streaming(client, rail, context) {
  const media = rail.mediaType === "MOVIE" ? "movie" : "tv";
  const providerMatches = await resolveProvider(client, media, context.folderTitle, context.providerAliases);
  const ids = providerMatches.map((provider) => provider.provider_id);
  if (!ids.length) return { scope: "UNAVAILABLE", items: [] };
  const base = await applySemanticPredicates(client, rail, media, discoverParams(rail, media, context.today), context.folderTitle), providerIds = ids.join("|");
  if (isTrendingRail(normalizeText(rail.title ?? ""))) {
    const candidates = await client.trending(media);
    const checked = await mapLimit(candidates, 8, async (item) => ({ item, regions: await client.watchProviders(media, item.id) }));
    const qualifies = (offer) => ALLOWED_MONETIZATION.some((type) => (offer?.[type] ?? []).some((p) => ids.includes(p.provider_id)));
    const gr = checked.filter((x) => qualifies(x.regions.GR)).map((x) => ({ ...x.item, media_type: media }));
    return chooseAvailability(gr, async () => checked.filter((x) => Object.values(x.regions).some(qualifies)).map((x) => ({ ...x.item, media_type: media })));
  }
  const queryRegion = async (region) => rank(await client.discover(media, { ...base, watch_region: region, with_watch_providers: providerIds, with_watch_monetization_types: ALLOWED_MONETIZATION.join("|") }), rail, media, context.today);
  const gr = await queryRegion("GR");
  return chooseAvailability(gr, async () => {
    const official = new Set((await client.watchRegions()).map((region) => region.iso_3166_1));
    const advertised = new Set(providerMatches.flatMap((provider) => Object.keys(provider.display_priorities ?? {})));
    const regions = [...advertised].filter((region) => region !== "GR" && official.has(region)).sort();
    const candidates = await mapLimit(regions, Math.max(1, Math.min(Number(process.env.TMDB_WORLDWIDE_REGION_CONCURRENCY ?? 8), 16)), queryRegion);
    return rank(candidates.flat(), rail, media, context.today);
  });
}

export async function materializeRail(client, rail, context) {
  const media = rail.mediaType === "MOVIE" ? "movie" : "tv";
  if (rail.materializer === "streaming") return streaming(client, rail, context);
  if (rail.materializer === "award") {
    const route = context.award; if (!route?.categoryId && !route?.cannesCategory && !route?.oscarCategory) throw new Error(`Award mapping unresolved/fail-closed: ${rail.key}`);
    const startYear = route.startYear ?? [...String(rail.title).matchAll(/(19|20)\d{2}/g)].map((x) => Number(x[0]))[0];
    const endYear = route.endYear ?? Number(context.today.slice(0, 4));
    let items;
    if (route.cannesCategory) items = await client.cannesWinners({ category: route.cannesCategory, startYear, endYear, overrides: context.authorityOverrides });
    else if (route.oscarCategory) items = await client.oscarsWinners({ category: route.oscarCategory, startYear, endYear, overrides: context.authorityOverrides });
    else if (route.categoryId && route.categorySlug) items = await client.globesWinners({ categoryId: route.categoryId, startYear, endYear, overrides: context.authorityOverrides, media, partition: route.partition, nonWorkWinners: context.nonWorkWinners });
    else throw new Error(`TMDB Awards category route is unresolved: ${rail.key}`);
    items = items.filter((x) => (!startYear || x.award_year >= startYear) && (!route.endYear || x.award_year <= route.endYear));
    items = uniqueItems(items.filter((x) => x.media_type === media), media).sort((a, b) => b.award_year - a.award_year || a.id - b.id);
    if (!items.length) throw new Error(`Award history is empty after authoritative year/media validation: ${rail.key}`);
    const oldest = Math.min(...items.map((x) => x.award_year));
    if (startYear && !route.partition && oldest > startYear + 2) throw new Error(`Official award history is incomplete for ${rail.key}: requested ${startYear}, oldest resolved ${oldest}`);
    if (route.categoryId && route.categorySlug) {
      const tmdb = (await client.awardWinners(route)).filter((x) => x.media_type === media && (!startYear || x.award_year >= startYear) && (!route.endYear || x.award_year <= route.endYear));
      items = uniqueItems([...items, ...tmdb], media).sort((a, b) => b.award_year - a.award_year || a.id - b.id);
    }
    return { scope: route.categoryId ? "OFFICIAL_PLUS_TMDB_AWARDS" : "AUTHORITATIVE_CANNES", items };
  }
  if (rail.materializer === "person_cast" || rail.materializer === "person_director") {
    const personId = rail.params.legacy.tmdbId; const credits = await client.credits(personId, media); let items = credits.cast ?? [];
    if (rail.materializer === "person_director") items = (credits.crew ?? []).filter((x) => x.job === "Director");
    return { scope: "GLOBAL", items: rank(items, rail, media, context.today, true) };
  }
  const params = discoverParams(rail, media, context.today);
  if (rail.collectionId === "collections.genres") await applySemanticPredicates(client, rail, media, params, context.folderTitle);
  const legacyType = rail.params.legacy?.tmdbSourceType, id = rail.params.legacy?.tmdbId;
  if (rail.materializer === "company") {
    params.with_companies = id ?? await client.companyId(context.folderTitle);
    if (normalizeText(rail.title ?? "").includes("κλασικ")) { params.with_genres = "16"; params["primary_release_date.lte"] = context.today; }
    if (!params.with_companies) throw new Error(`Company unresolved: ${context.folderTitle}`);
  }
  if (rail.materializer === "network_recent") { params.with_networks = id; params.sort_by = media === "tv" ? "first_air_date.desc" : "primary_release_date.desc"; params[`${media === "tv" ? "first_air_date" : "primary_release_date"}.gte`] = shiftYears(context.today, -2); }
  if (rail.materializer === "runtime") {
    const name = normalizeText(context.folderTitle); if (name.includes("short")) params["with_runtime.lte"] = 89; else if (name.includes("standard")) { params["with_runtime.gte"] = 90; params["with_runtime.lte"] = 149; } else if (name.includes("long")) { params["with_runtime.gte"] = 150; params["with_runtime.lte"] = 179; } else params["with_runtime.gte"] = 180;
  }
  if (legacyType === "COMPANY") params.with_companies = id;
  if (legacyType === "NETWORK") params.with_networks = id;
  if (isTrendingRail(normalizeText(rail.title ?? "")) && rail.collectionId === "collections.discover") return { scope: "GLOBAL", items: rank(await client.trending(media), rail, media, context.today) };
  let items = await client.discover(media, params), quorum = params["vote_count.gte"];
  if (!items.length && quorum != null) {
    const tiers = media === "movie" ? [100, 25, 5] : [50, 10, 3];
    for (const tier of tiers.filter((value) => value < quorum)) {
      items = await client.discover(media, { ...params, "vote_count.gte": tier });
      quorum = tier;
      if (items.length) break;
    }
  }
  return { scope: quorum == null ? "GLOBAL" : `GLOBAL:VOTE_QUORUM=${quorum}`, items: rank(items, rail, media, context.today) };
}
