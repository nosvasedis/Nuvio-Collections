import { ALLOWED_MONETIZATION, MATERIALIZED_LIMIT } from "./constants.mjs";
import { dateFor, normalizeText, uniqueItems, shiftYears, mapLimit } from "./utils.mjs";

export function runtimeBucket(minutes) { if (minutes < 90) return "short"; if (minutes < 150) return "standard"; if (minutes < 180) return "long"; return "epic"; }

export function chooseAvailability(gr, worldwideFactory) {
  if (!Array.isArray(gr)) throw new Error("GR availability was not a successful result");
  if (gr.length) return { scope: "GR", items: gr };
  return Promise.resolve().then(worldwideFactory).then((items) => ({ scope: "WORLDWIDE", items }));
}

function apiSort(value = "popularity.desc") { return (value ?? "popularity.desc").replace("first_air_date", "first_air_date").replace("primary_release_date", "primary_release_date"); }
function discoverParams(rail, media, today) {
  const f = rail.params.legacy?.filters ?? {}, title = normalizeText(rail.title ?? ""), p = { include_adult: false, include_video: false, sort_by: apiSort(rail.params.sortBy ?? rail.params.legacy?.sortBy) };
  const datePrefix = media === "movie" ? "primary_release_date" : "first_air_date";
  if (f.voteCountGte != null) p["vote_count.gte"] = f.voteCountGte;
  if (f.voteAverageGte != null) p["vote_average.gte"] = f.voteAverageGte;
  if (f.withGenres) p.with_genres = Array.isArray(f.withGenres) ? f.withGenres.join(",") : f.withGenres;
  if (f.withKeywords) p.with_keywords = Array.isArray(f.withKeywords) ? f.withKeywords.join("|") : f.withKeywords;
  if (f.withOriginCountry) p.with_origin_country = f.withOriginCountry;
  if (rail.params.originCountry) p.with_origin_country = rail.params.originCountry;
  if (f.releaseDateGte) p[`${datePrefix}.gte`] = f.releaseDateGte;
  if (f.releaseDateLte) p[`${datePrefix}.lte`] = f.releaseDateLte > today ? today : f.releaseDateLte;
  if (f.year) { p[`${datePrefix}.gte`] = `${f.year}-01-01`; p[`${datePrefix}.lte`] = String(f.year) === today.slice(0, 4) ? today : `${f.year}-12-31`; }
  if (rail.params.summary) { p[`${datePrefix}.gte`] = rail.params.startDate; p[`${datePrefix}.lte`] = today; if (p.sort_by === "vote_average.desc") p["vote_count.gte"] = media === "movie" ? 500 : 200; }
  if (title.includes("κορυφ")) { p.sort_by = "vote_average.desc"; p["vote_count.gte"] ??= media === "movie" ? 500 : 200; }
  else if (title.includes("προσφα")) { p.sort_by = `${datePrefix}.desc`; p[`${datePrefix}.gte`] = shiftYears(today, -2); }
  else if (title.includes("νε") || title.includes("της χρονιας")) { p.sort_by = `${datePrefix}.desc`; p[`${datePrefix}.gte`] = `${today.slice(0, 4)}-01-01`; }
  else if (title.includes("δημοφιλ")) p.sort_by = "popularity.desc";
  if (!p[`${datePrefix}.lte`]) p[`${datePrefix}.lte`] = today;
  return p;
}

function rank(items, rail, media, today, full = false) {
  const title = normalizeText(rail.title ?? ""), filtered = uniqueItems(items, media).filter((x) => { const d = dateFor(x, media); return !d || d <= today; });
  const comparator = title.includes("κορυφ") || title.includes("top") ? (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.vote_count ?? 0) - (a.vote_count ?? 0) || a.id - b.id : title.includes("νε") || title.includes("προσφα") ? (a, b) => String(dateFor(b, media) ?? "").localeCompare(String(dateFor(a, media) ?? "")) || a.id - b.id : (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id - b.id;
  return filtered.sort(comparator).slice(0, full ? filtered.length : MATERIALIZED_LIMIT).map((x) => ({ ...x, media_type: media }));
}

async function applySemanticPredicates(client, rail, media, params, folderTitle = "") {
  const text = normalizeText(`${folderTitle} ${rail.title ?? ""}`), isTv = media === "tv";
  const genreRules = [
    [/δρασ|περιπετ/, isTv ? 10759 : /περιπετ/.test(text) ? 12 : 28], [/κινουμεν|ανιμε/, 16], [/κωμ/, 35],
    [/αστυνομ|εγκλημ/, 80], [/ντοκιμαντερ/, 99], [/δραμα/, 18], [/οικογεν/, 10751],
    [/φαντασι|επιστημονικη φαντασια/, isTv ? 10765 : /επιστημονικη/.test(text) ? 878 : 14],
    [/ιστορ/, 36], [/τρομ/, 27], [/μουσικ|μιουζικαλ/, 10402], [/μυστηρ/, 9648],
    [/ριαλιτι/, 10764], [/ρομαντ/, 10749], [/θριλερ/, 53], [/πολεμ/, isTv ? 10768 : 10752], [/γουεστερν/, 37],
  ];
  const matched = genreRules.find(([pattern]) => pattern.test(text)); if (matched) params.with_genres = String(matched[1]);
  const keywordNames = [];
  if (/ανιμε/.test(text)) keywordNames.push("anime");
  if (/πολεμικες τεχνες/.test(text)) keywordNames.push("martial arts");
  if (/φυσης/.test(text)) keywordNames.push("nature");
  if (/αθλητ/.test(text)) keywordNames.push("sport");
  if (/κωμικες παραστασεις/.test(text)) keywordNames.push("stand-up comedy");
  if (/υπερηρω/.test(text)) keywordNames.push("superhero");
  if (isTv && /θριλερ/.test(text)) keywordNames.push("thriller", "suspense", "psychological thriller", "crime thriller");
  if (isTv && /φαντασι/.test(text)) keywordNames.push("fantasy", "magic", "supernatural");
  if (isTv && /πολεμ/.test(text)) keywordNames.push("war", "warfare", "military");
  if (keywordNames.length) { const ids = await client.keywordIds(keywordNames); if (!ids.length) throw new Error(`Semantic keywords unresolved: ${keywordNames.join(", ")}`); params.with_keywords = ids.join("|"); }
  return params;
}

async function resolveProvider(client, media, folderTitle, aliases = []) {
  const names = [folderTitle, ...aliases].map(normalizeText); const providers = await client.providers(media);
  return providers.filter((p) => names.includes(normalizeText(p.provider_name))).map((p) => p.provider_id);
}

async function streaming(client, rail, context) {
  const media = rail.mediaType === "MOVIE" ? "movie" : "tv";
  const ids = await resolveProvider(client, media, context.folderTitle, context.providerAliases);
  if (!ids.length) return { scope: "UNAVAILABLE", items: [] };
  const base = await applySemanticPredicates(client, rail, media, discoverParams(rail, media, context.today), context.folderTitle), providerIds = ids.join("|");
  if (normalizeText(rail.title ?? "").includes("τασ")) {
    const candidates = await client.trending(media);
    const checked = await mapLimit(candidates, 8, async (item) => ({ item, regions: await client.watchProviders(media, item.id) }));
    const qualifies = (offer) => ALLOWED_MONETIZATION.some((type) => (offer?.[type] ?? []).some((p) => ids.includes(p.provider_id)));
    const gr = checked.filter((x) => qualifies(x.regions.GR)).map((x) => ({ ...x.item, media_type: media }));
    return chooseAvailability(gr, async () => checked.filter((x) => Object.values(x.regions).some(qualifies)).map((x) => ({ ...x.item, media_type: media })));
  }
  const queryRegion = async (region) => rank(await client.discover(media, { ...base, watch_region: region, with_watch_providers: providerIds, with_watch_monetization_types: ALLOWED_MONETIZATION.join("|") }), rail, media, context.today);
  const gr = await queryRegion("GR");
  return chooseAvailability(gr, async () => {
    const globalCandidates = await client.discover(media, base, 1000);
    const checked = await mapLimit(globalCandidates, 12, async (item) => ({ item, regions: await client.watchProviders(media, item.id) }));
    const qualifies = (offer) => ALLOWED_MONETIZATION.some((type) => (offer?.[type] ?? []).some((p) => ids.includes(p.provider_id)));
    const available = checked.filter((x) => Object.values(x.regions).some(qualifies)).map((x) => x.item);
    return rank(available, rail, media, context.today);
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
  const items = normalizeText(rail.title ?? "").includes("τασ") && rail.collectionId === "collections.discover" ? await client.trending(media) : await client.discover(media, params);
  return { scope: "GLOBAL", items: rank(items, rail, media, context.today) };
}
