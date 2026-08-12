import { ALLOWED_MONETIZATION, MATERIALIZED_LIMIT } from "./constants.mjs";
import { dateFor, normalizeText, uniqueItems, dedupeLikelyDuplicateWorks, canonicalWorkTitle, fingerprint, shiftYears, mapLimit } from "./utils.mjs";

// TMDB's adult flag is incomplete: many erotic/softcore works are catalogued
// with adult=false. Keep the narrow explicit-content taxonomy separate from
// narrative themes (rape, prostitution, sexual content), which can describe
// legitimate mainstream works such as Perfect Blue.
export const EXPLICIT_CONTENT_KEYWORD_IDS = Object.freeze([
  155477, // softcore
  256466, // erotic
  190370, // erotic movie
  298666, // erotic romance
  325693, // erotica
  360629, // adult
  284535, // adult video
  356759, // porn
  198385, // hentai
  378816, // animated porn
  195669, // ecchi
  337946, // uncensored
  282903, // unsimulated sex
]);

function mergePipeValues(current, additions) {
  return [...new Set([...(String(current ?? "").split("|").filter(Boolean)), ...additions.map(String)])].join("|");
}

function mergeCommaValues(current, additions) {
  return [...new Set([...(String(current ?? "").split(",").filter(Boolean)), ...additions.map(String)])].join(",");
}

export function applyContentSafetyPredicates(params, label, media) {
  const text = normalizeText(label ?? "");
  if (/ρομαντ|romance|romantic/.test(text) || /ανιμε|anime/.test(text)) {
    params.without_keywords = mergePipeValues(params.without_keywords, EXPLICIT_CONTENT_KEYWORD_IDS);
  }
  if (media === "movie" && /ζωντανης δρασης|live action/.test(text)) {
    params.without_genres = mergeCommaValues(params.without_genres, [16, 99]);
  }
  return params;
}

function applyRecognitionFloor(params, floor) {
  if (floor != null) params["vote_count.gte"] = Math.max(Number(params["vote_count.gte"] ?? 0), floor);
  return params;
}

function genreRecognitionFloor(title, media) {
  if (title.includes("δημοφιλ")) return media === "movie" ? 75 : 40;
  if (title.includes("κορυφ") && title.includes("ολων των εποχων")) return media === "movie" ? 1000 : 500;
  return null;
}

export function streamingRecognitionFloor(folderTitle, railTitle, media) {
  const folder = normalizeText(folderTitle ?? ""), title = normalizeText(railTitle ?? "");
  const premium = /netflix|disney|prime video|apple tv|hbo max|paramount|hulu|peacock/.test(folder);
  const popular = premium ? (media === "movie" ? 50 : 35) : (media === "movie" ? 25 : 15);
  if (title.includes("κορυφ") || title.includes("top rated")) return premium ? (media === "movie" ? 1000 : 500) : (media === "movie" ? 250 : 150);
  if (title.includes("δημοφιλ") || title.includes("popular")) return popular;
  return null;
}

export function runtimeBucket(minutes) { if (minutes < 90) return "short"; if (minutes < 150) return "standard"; if (minutes < 180) return "long"; return "epic"; }

function genreIds(item) {
  return new Set([...(item.genre_ids ?? []), ...(item.genres ?? []).map((genre) => genre.id)].map(Number));
}

export function isFeatureFilm(item, policy = {}, today) {
  const runtime = Number(item.runtime), releaseDate = item.release_date;
  if (!Number.isFinite(runtime) || runtime < Number(policy.minRuntime ?? 40)) return false;
  if (releaseDate && today && releaseDate > today) return false;
  if (item.adult === true || item.video === true) return false;
  const genres = genreIds(item);
  if ((policy.requiredGenreIds ?? []).some((id) => !genres.has(Number(id)))) return false;
  if ((policy.excludedGenreIds ?? [99, 10770]).some((id) => genres.has(Number(id)))) return false;
  return true;
}

async function verifiedFeatureFilms(client, items, policy, today) {
  const checked = await mapLimit(uniqueItems(items, "movie"), 16, async (item) => {
    const details = await client.details("movie", item.id);
    return isFeatureFilm(details, policy, today) ? { ...item, ...details, media_type: "movie" } : null;
  });
  return checked.filter(Boolean);
}

async function curatedStudioFeatures(client, rail, context) {
  const policy = context.curatedStudio;
  if (!policy || rail.mediaType !== "MOVIE") throw new Error(`Curated studio policy missing or non-movie: ${rail.key}`);
  if (policy.pinnedIds.length !== policy.expectedBaselineCount) throw new Error(`Curated studio baseline is incomplete: ${rail.key}`);
  const params = {
    include_adult: false, include_video: false, sort_by: "primary_release_date.desc",
    with_companies: policy.companyIds.join("|"), with_genres: policy.requiredGenreIds.join("|"),
    without_genres: policy.excludedGenreIds.join("|"), "with_runtime.gte": policy.minRuntime,
    "primary_release_date.lte": context.today,
  };
  const discovered = await client.discover("movie", params);
  const pinned = policy.pinnedIds.map((id) => ({ id, media_type: "movie", _curatedBaseline: true }));
  const verified = await verifiedFeatureFilms(client, [...pinned, ...discovered], policy, context.today);
  const verifiedIds = new Set(verified.map((item) => item.id));
  const missing = policy.pinnedIds.filter((id) => !verifiedIds.has(id));
  if (missing.length) throw new Error(`Curated studio baseline failed feature validation: ${rail.key}: ${missing.join(",")}`);
  verified.sort((a, b) => String(b.release_date ?? "").localeCompare(String(a.release_date ?? "")) || a.id - b.id);
  return { scope: `CURATED_FEATURES:TRAKT=${policy.traktListId}:DYNAMIC_TMDB`, items: verified };
}

export function chooseAvailability(gr, worldwideFactory) {
  if (!Array.isArray(gr)) throw new Error("GR availability was not a successful result");
  if (gr.length) return { scope: "GR", items: gr };
  return Promise.resolve().then(worldwideFactory).then((items) => ({ scope: "WORLDWIDE", items }));
}

function apiSort(value = "popularity.desc") { return (value ?? "popularity.desc").replace("first_air_date", "first_air_date").replace("primary_release_date", "primary_release_date"); }
function isNewRail(title) { return /(?:^|\s)νε(?:ες|α|οι)?(?:\s|$)/u.test(title); }
function isTrendingRail(title) { return /(?:^|\s)τασεις?(?:\s|$)/u.test(title); }
export function discoverParams(rail, media, today) {
  const f = rail.params.legacy?.filters ?? {}, title = normalizeText(rail.title ?? ""), policy = rail.params.discoverPolicy, p = { include_adult: false, include_video: false, sort_by: apiSort(rail.params.sortBy ?? rail.params.legacy?.sortBy) };
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
  if (policy?.kind === "popular" || policy?.kind === "popular_year") {
    delete p["vote_average.gte"];
    p.sort_by = "popularity.desc";
    if (policy.kind === "popular_year") { p[`${datePrefix}.gte`] = `${today.slice(0, 4)}-01-01`; p[`${datePrefix}.lte`] = today; }
  }
  else if (policy?.kind === "top_recent" || policy?.kind === "top_all_time" || policy?.kind === "top_year") {
    delete p[`${datePrefix}.gte`]; delete p[`${datePrefix}.lte`]; delete p["vote_average.gte"];
    p.sort_by = "vote_average.desc"; p["vote_count.gte"] = policy.voteCountGte;
    if (policy.kind === "top_recent") p[`${datePrefix}.gte`] = shiftYears(today, -2);
    if (policy.kind === "top_year") p[`${datePrefix}.gte`] = `${today.slice(0, 4)}-01-01`;
  }
  else if (policy?.kind === "recent") {
    if (!policy.preserveVoteQuorum) delete p["vote_count.gte"];
    delete p["vote_average.gte"]; p.sort_by = `${datePrefix}.desc`; p[`${datePrefix}.gte`] = shiftYears(today, -2);
  }
  else if (["thematic", "fixed_period"].includes(policy?.kind)) {
    if (!policy.preserveVoteQuorum) delete p["vote_count.gte"];
  }
  else if (title.includes("κορυφ")) { p.sort_by = "vote_average.desc"; p["vote_count.gte"] ??= media === "movie" ? 500 : 200; }
  else if (title.includes("προσφα")) { delete p["vote_count.gte"]; delete p["vote_average.gte"]; p.sort_by = `${datePrefix}.desc`; p[`${datePrefix}.gte`] = shiftYears(today, -2); }
  else if (isNewRail(title) || title.includes("της χρονιας")) {
    const preserveGenreNewQuorum = rail.collectionId === "collections.genres" && isNewRail(title);
    if (!preserveGenreNewQuorum) delete p["vote_count.gte"];
    delete p["vote_average.gte"];
    p.sort_by = `${datePrefix}.desc`; p[`${datePrefix}.gte`] = `${today.slice(0, 4)}-01-01`;
  }
  else if (title.includes("δημοφιλ")) { delete p["vote_count.gte"]; delete p["vote_average.gte"]; p.sort_by = "popularity.desc"; }
  if (rail.collectionId === "collections.genres") applyRecognitionFloor(p, genreRecognitionFloor(title, media));
  if (!p[`${datePrefix}.lte`]) p[`${datePrefix}.lte`] = today;
  return p;
}

function weightedRating(item, media) {
  const votes = Math.max(0, Number(item.vote_count ?? 0)), average = Math.max(0, Number(item.vote_average ?? 0)), priorWeight = media === "movie" ? 250 : 100;
  return (votes * average + priorWeight * 6) / (votes + priorWeight);
}

function recognitionScore(item) {
  return Math.log10(Math.max(0, Number(item.vote_count ?? 0)) + 1) * 100 + Math.max(0, Number(item.popularity ?? 0));
}

function dedupeCanonicalTitles(items, media) {
  const selected = new Map(), untitled = [];
  for (const item of items) {
    const title = canonicalWorkTitle(item);
    if (!title) { untitled.push(item); continue; }
    const key = `${media}:${title}`, prior = selected.get(key);
    if (!prior || recognitionScore(item) > recognitionScore(prior) || (recognitionScore(item) === recognitionScore(prior) && item.id < prior.id)) selected.set(key, item);
  }
  return [...selected.values(), ...untitled];
}

export function dailyRuntimeSelection(items, railKey, today, { poolSize = 240, limit = 100, voteFloor = 100 } = {}) {
  const familiar = items.filter((item) => Number(item.vote_count ?? 0) >= voteFloor)
    // Vote count is the durable familiarity signal. Raw TMDB popularity can
    // move enough within minutes to replace a noticeable part of the pool,
    // defeating same-day stability even though the seeded selector is stable.
    .sort((a, b) => Number(b.vote_count ?? 0) - Number(a.vote_count ?? 0)
      || Number(b.popularity ?? 0) - Number(a.popularity ?? 0)
      || a.id - b.id)
    .slice(0, poolSize);
  // Rank each title independently for the Athens day. Unlike an in-place
  // seeded shuffle, adding or removing one TMDB candidate cannot reshuffle
  // every subsequent title. This keeps nightly writes small while still
  // producing a genuinely different, deterministic selection each day.
  const seed = `${today}:${railKey}`;
  return familiar
    .map((item) => ({ item, score: fingerprint(`${seed}:${item.id}`) }))
    .sort((a, b) => a.score.localeCompare(b.score) || a.item.id - b.item.id)
    .slice(0, limit)
    .map(({ item }) => item);
}
export function isSubstantiveCastCredit(item) {
  const character = normalizeText(item.character ?? "");
  if (!character) return false;
  return !/(?:^|\s)(?:self|himself|herself|themselves|archive footage|uncredited|host|presenter|honoree|interviewee|guest judge|ο ιδιος|η ιδια|αρχειακο υλικο|χωρις αναφορα)(?:\s|$)/u.test(character);
}
function isDefinitiveNotFound(error) {
  return /\b404\b|status_code["':\s]+34\b|resource you requested could not be found/i.test(String(error?.message ?? error));
}

// TMDB lists store identities, not artwork. Nuvio resolves artwork again when
// it reads the list, so a missing TMDB poster becomes a blank/play card. Check
// every candidate on every refresh: an item automatically returns as soon as
// TMDB publishes a poster for it.
export async function requireUsablePosters(client, items, media) {
  const checked = await mapLimit(items, 16, async (item) => {
    if (typeof item.poster_path === "string" && item.poster_path.trim()) return item;
    let details;
    try { details = await client.details(media, item.id); }
    catch (error) { if (isDefinitiveNotFound(error)) return null; throw error; }
    if (typeof details.poster_path !== "string" || !details.poster_path.trim()) return null;
    return { ...item, ...details, media_type: item.media_type ?? media };
  });
  return checked.filter(Boolean);
}

// A poster alone is not sufficient for a released-only catalog. Credits and
// award endpoints can expose direct-to-video releases, adult works, planned or
// cancelled projects, and identities with no release date. Reuse complete
// payloads when possible and resolve details only when a required field is
// absent, so the nightly gate is exact without turning every rail into an
// unnecessary details crawl.
export async function requireEligibleReleasedItems(client, items, media, today, { verifyIdentities = new Set(), knownIdentities = null } = {}) {
  const checked = await mapLimit(items, 16, async (item) => {
    let candidate = item;
    const missingDate = !dateFor(candidate, media);
    const missingAdultFlag = typeof candidate.adult !== "boolean";
    const missingVideoFlag = media === "movie" && typeof candidate.video !== "boolean";
    const identity = `${item.media_type ?? media}:${item.id}`;
    const requiresFreshVerification = verifyIdentities.has(identity) || (knownIdentities && !knownIdentities.has(identity));
    if (missingDate || missingAdultFlag || missingVideoFlag || requiresFreshVerification) {
      let details;
      try { details = await client.details(media, item.id); }
      catch (error) {
        // Credits/trending payloads can briefly retain an identity after TMDB
        // deletes the resource. A definitive not-found means the candidate no
        // longer exists and is safe to drop; transport, rate-limit and 5xx
        // failures remain fatal so outages never masquerade as exclusions.
        if (isDefinitiveNotFound(error)) return null;
        throw error;
      }
      candidate = { ...item, ...details, media_type: item.media_type ?? media };
    }
    const date = dateFor(candidate, media);
    if (!date || date > today || candidate.adult === true || candidate.video === true) return null;
    return candidate;
  });
  return checked.filter(Boolean);
}
function rank(items, rail, media, today, full = false, person = false) {
  const title = normalizeText(rail.title ?? ""), policy = rail.params?.discoverPolicy;
  let filtered = dedupeLikelyDuplicateWorks(items, media).filter((x) => { const d = dateFor(x, media); return !d || d <= today; });
  if (policy?.dedupeCanonicalTitle) filtered = dedupeCanonicalTitles(filtered, media);
  const comparator = title.includes("κορυφ") || title.includes("top") ? person || policy?.kind?.startsWith("top_")
    ? (a, b) => weightedRating(b, media) - weightedRating(a, media) || (b.vote_count ?? 0) - (a.vote_count ?? 0) || a.id - b.id
    : (a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.vote_count ?? 0) - (a.vote_count ?? 0) || a.id - b.id
    : isNewRail(title) || title.includes("προσφα") ? (a, b) => String(dateFor(b, media) ?? "").localeCompare(String(dateFor(a, media) ?? "")) || a.id - b.id : (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id - b.id;
  return filtered.sort(comparator).slice(0, full ? filtered.length : MATERIALIZED_LIMIT).map((x) => ({ ...x, media_type: media }));
}

export async function applySemanticPredicates(client, rail, media, params, folderTitle = "") {
  const text = normalizeText(`${folderTitle} ${rail.title ?? ""}`), isTv = media === "tv";
  const isRomanticComedy = /ρομαντικ(?:η|ες) (?:κομεντι|κωμικ)/.test(text);
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
  if (isRomanticComedy && !isTv) params.with_genres = "10749,35";
  const keywordNames = [];
  if (/ανιμε/.test(text)) keywordNames.push("anime");
  if (/πολεμικες τεχνες/.test(text)) keywordNames.push("martial arts");
  // TMDB tagging is sparse: nature documentaries may use wildlife, natural
  // history, environment, or ecology without the generic `nature` keyword.
  // Discover interprets the pipe-separated IDs as OR while genre 99 remains
  // mandatory, so this broadens metadata coverage without admitting fiction.
  if (/φυσης/.test(text)) keywordNames.push("nature", "wildlife", "natural history", "environment", "ecology");
  if (/αθλητ/.test(text)) keywordNames.push("sport");
  if (/κωμικες παραστασεις/.test(text)) keywordNames.push("stand-up comedy");
  if (/υπερηρω/.test(text)) keywordNames.push("superhero");
  if (isTv && /θριλερ/.test(text)) keywordNames.push("thriller", "suspense", "psychological thriller", "crime thriller");
  if (isTv && /τρομ/.test(text)) keywordNames.push("horror", "supernatural horror", "psychological horror");
  if (isTv && /ρομαντ/.test(text)) keywordNames.push("romance", "love", "romantic relationship");
  if (isTv && isRomanticComedy) keywordNames.push("romantic comedy");
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
  const base = applyContentSafetyPredicates(
    await applySemanticPredicates(client, rail, media, discoverParams(rail, media, context.today), context.folderTitle),
    `${context.folderTitle} ${rail.title ?? ""}`,
    media,
  );
  applyRecognitionFloor(base, streamingRecognitionFloor(context.folderTitle, rail.title, media));
  const providerIds = ids.join("|");
  if (isTrendingRail(normalizeText(rail.title ?? ""))) {
    const qualifies = (offer) => ALLOWED_MONETIZATION.some((type) => (offer?.[type] ?? []).some((p) => ids.includes(p.provider_id)));
    // Provider titles do not necessarily enter TMDB's global daily top 20.
    // Prefer official day trending; only if it is empty for this provider in
    // both GR and Worldwide, widen to the official weekly trending window.
    for (const window of ["day", "week"]) {
      const candidates = await client.trending(media, window);
      const checked = await mapLimit(candidates, 8, async (item) => ({ item, regions: await client.watchProviders(media, item.id) }));
      const gr = checked.filter((x) => qualifies(x.regions.GR)).map((x) => ({ ...x.item, media_type: media }));
      if (gr.length) return { scope: "GR", items: gr };
      const worldwide = checked.filter((x) => Object.values(x.regions).some(qualifies)).map((x) => ({ ...x.item, media_type: media }));
      if (worldwide.length) return { scope: "WORLDWIDE", items: worldwide };
    }
    return { scope: "WORLDWIDE", items: [] };
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
  if (rail.materializer === "curated_studio_features") return curatedStudioFeatures(client, rail, context);
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
    if (rail.materializer === "person_director") items = (credits.crew ?? []).filter((x) => x.job?.toLowerCase() === "director");
    else items = items.filter(isSubstantiveCastCredit);
    return { scope: "GLOBAL:SUBSTANTIVE_CREDITS", items: rank(items, rail, media, context.today, true, true) };
  }
  if (rail.materializer === "collection") {
    const collectionId = rail.params.legacy?.tmdbId;
    if (!collectionId) throw new Error(`TMDB collection unresolved: ${rail.key}`);
    const collection = await client.v3(`/collection/${collectionId}`, { language: client.language });
    const items = uniqueItems(collection.parts ?? [], "movie")
      .sort((a, b) => String(b.release_date ?? "").localeCompare(String(a.release_date ?? "")) || a.id - b.id)
      .map((item) => ({ ...item, media_type: "movie" }));
    if (!items.length) throw new Error(`TMDB collection is empty: ${rail.key}`);
    return { scope: `OFFICIAL_TMDB_COLLECTION:${collectionId}:RELEASE_DATE_DESC`, items };
  }
  const params = discoverParams(rail, media, context.today);
  if (rail.collectionId === "collections.genres" && !rail.params.explicitSemantic) await applySemanticPredicates(client, rail, media, params, context.folderTitle);
  applyContentSafetyPredicates(params, `${context.folderTitle} ${rail.title ?? ""}`, media);
  const legacyType = rail.params.legacy?.tmdbSourceType, id = rail.params.legacy?.tmdbId;
  if (rail.materializer === "company") {
    params.with_companies = id ?? await client.companyId(context.folderTitle);
    if (normalizeText(rail.title ?? "").includes("κλασικ")) { params.with_genres = "16"; params["primary_release_date.lte"] = context.today; }
    if (!params.with_companies) throw new Error(`Company unresolved: ${context.folderTitle}`);
  }
  if (rail.materializer === "network") {
    params.with_networks = id;
    if (normalizeText(rail.title ?? "").includes("προσφα")) {
      params.sort_by = media === "tv" ? "first_air_date.desc" : "primary_release_date.desc";
      params[`${media === "tv" ? "first_air_date" : "primary_release_date"}.gte`] = shiftYears(context.today, -2);
    } else params.sort_by = "popularity.desc";
  }
  if (rail.materializer === "runtime") {
    params.sort_by = "popularity.desc"; params["vote_count.gte"] = 100;
    if (rail.folderId === "collections.runtime.short") params["with_runtime.lte"] = 89;
    else if (rail.folderId === "collections.runtime.standard") { params["with_runtime.gte"] = 90; params["with_runtime.lte"] = 149; }
    else if (rail.folderId === "collections.runtime.long") { params["with_runtime.gte"] = 150; params["with_runtime.lte"] = 179; }
    else if (rail.folderId === "collections.runtime.epic") params["with_runtime.gte"] = 180;
    else throw new Error(`Unknown runtime folder: ${rail.folderId}`);
    const expected = rail.folderId.split(".").at(-1), discovered = await client.discover(media, params, 500);
    const verified = await mapLimit(discovered, 16, async (item) => {
      const details = await client.details(media, item.id), minutes = Number(details.runtime);
      return Number.isFinite(minutes) && minutes > 0 && runtimeBucket(minutes) === expected ? { ...item, ...details } : null;
    });
    const eligible = rank(verified.filter(Boolean), rail, media, context.today, true);
    return { scope: `GLOBAL:RUNTIME_VERIFIED=${expected}:DAILY_ROTATION:VOTES>=100`, items: dailyRuntimeSelection(eligible, rail.key, context.today) };
  }
  if (legacyType === "COMPANY") params.with_companies = id;
  if (legacyType === "NETWORK") params.with_networks = id;
  if (isTrendingRail(normalizeText(rail.title ?? "")) && rail.collectionId === "collections.discover") return { scope: "GLOBAL", items: rank(await client.trending(media), rail, media, context.today) };
  let items = await client.discover(media, params), quorum = params["vote_count.gte"];
  if (!items.length && quorum != null && (!rail.params.discoverPolicy || rail.params.discoverPolicy.allowQuorumFallback)) {
    const tiers = media === "movie" ? [100, 25, 5] : [50, 10, 3];
    for (const tier of tiers.filter((value) => value < quorum)) {
      items = await client.discover(media, { ...params, "vote_count.gte": tier });
      quorum = tier;
      if (items.length) break;
    }
  }
  if (rail.materializer === "company" && media === "movie") {
    items = await verifiedFeatureFilms(client, items, { minRuntime: 40, excludedGenreIds: [99, 10770] }, context.today);
    if (!items.length && normalizeText(rail.title ?? "").includes("προσφα")) {
      const widened = { ...params };
      delete widened["primary_release_date.gte"];
      widened.sort_by = "primary_release_date.desc";
      items = await verifiedFeatureFilms(client, await client.discover(media, widened), { minRuntime: 40, excludedGenreIds: [99, 10770] }, context.today);
      return { scope: "GLOBAL:LATEST_AVAILABLE_FEATURE_FILMS_VERIFIED", items: rank(items, rail, media, context.today) };
    }
  }
  const scope = rail.materializer === "company" && media === "movie" ? "GLOBAL:FEATURE_FILMS_VERIFIED" : quorum == null ? "GLOBAL" : `GLOBAL:VOTE_QUORUM=${quorum}`;
  return { scope, items: rank(items, rail, media, context.today) };
}
