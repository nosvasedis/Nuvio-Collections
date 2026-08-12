import { ACADEMY_AWARDS_HONORARY_FILE, ACADEMY_AWARDS_SNAPSHOT_FILE, CANNES_AWARDS_SNAPSHOT_FILE } from "./constants.mjs";
import { normalizeText, mapLimit, readJson, invariant } from "./utils.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanHtml = (value) => value.replace(/<[^>]+>/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&(?:#39|apos);/gi, "'").replace(/&quot;/gi, '"')
  .replace(/\s+/g, " ").trim();
const titleVariants = (value) => {
  const clean = cleanHtml(value)
    .replace(/\s*\((?:uk|tv(?: show| mini-series)?(?:\s*-?\s*\d{4})?|\d{4}\s*-\s*tv|a work in progress|parts?\s+[ivxlcdm]+(?:\s*-\s*[ivxlcdm]+)?|\d{4}(?:-\d{4})?)\)\s*$/i, "")
    .replace(/\s*-\s*tv show\s*$/i, "").trim();
  const variants = new Set([clean]);
  const inverted = clean.match(/^(.+),\s*(The|A|An)$/i); if (inverted) variants.add(`${inverted[2]} ${inverted[1]}`);
  const subtitle = clean.match(/^([^:]{4,}):\s*.+$/); if (subtitle) variants.add(subtitle[1]);
  const archiveSuffix = clean.match(/^(.{6,}?)\s+[–-]\s+(?:chapitr|parts?|a work in progress).+$/i); if (archiveSuffix) variants.add(archiveSuffix[1]);
  const possessiveWork = clean.match(/^.+?'s\s+(.{4,})$/); if (possessiveWork) variants.add(possessiveWork[1]);
  for (const title of [...variants]) {
    if (/\band\b/i.test(title)) variants.add(title.replace(/\band\b/gi, "&"));
    if (title.includes("&")) variants.add(title.replace(/&/g, "and"));
  }
  for (const title of [...variants]) variants.add(title.replace(/^(?:The|A|An)\s+/i, ""));
  return [...variants].filter(Boolean);
};

export class TmdbClient {
  constructor({ readToken = process.env.TMDB_API_READ_TOKEN, userToken = process.env.TMDB_USER_ACCESS_TOKEN, language = process.env.TMDB_LANGUAGE ?? "el", fetchImpl = fetch } = {}) {
    if (!readToken) throw new Error("TMDB_API_READ_TOKEN is required");
    this.readToken = readToken; this.userToken = userToken; this.language = language; this.fetchImpl = fetchImpl; this.memo = new Map();
    this.httpLimit = Math.max(1, Math.min(Number(process.env.TMDB_HTTP_CONCURRENCY ?? 8), 16));
    this.httpActive = 0; this.httpQueue = []; this.blockedUntil = 0;
    this.createChain = Promise.resolve(); this.nextCreateAt = 0;
  }
  async withHttpSlot(loader) {
    if (this.httpActive >= this.httpLimit) await new Promise((resolve) => this.httpQueue.push(resolve));
    this.httpActive++;
    try { return await loader(); }
    finally { this.httpActive--; this.httpQueue.shift()?.(); }
  }
  retryDelay(response, attempt) {
    const header = response?.headers?.get("retry-after");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
      const date = Date.parse(header);
      if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
    }
    return Math.min(60000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
  }
  async cached(key, loader) {
    if (this.memo.has(key)) return structuredClone(await this.memo.get(key));
    const pending = loader(); this.memo.set(key, pending);
    try { const value = await pending; this.memo.set(key, value); return structuredClone(value); }
    catch (error) { this.memo.delete(key); throw error; }
  }
  async request(path, { version = 3, method = "GET", params = {}, body, user = false, retry = true } = {}) {
    const token = user ? this.userToken : this.readToken;
    if (!token) throw new Error("TMDB_USER_ACCESS_TOKEN is required for list writes");
    const url = new URL(`https://api.themoviedb.org/${version}${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    const attempts = retry ? 9 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const cooldown = this.blockedUntil - Date.now(); if (cooldown > 0) await sleep(cooldown);
      let response;
      try { response = await this.withHttpSlot(() => this.fetchImpl(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })); }
      catch (error) { if (attempt === attempts - 1) throw error; await sleep(this.retryDelay(null, attempt)); continue; }
      if (response.ok) return response.status === 204 ? {} : response.json();
      if (retry && (response.status === 429 || response.status >= 500)) {
        const delay = this.retryDelay(response, attempt);
        if (response.status === 429) this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
        else await sleep(delay);
        continue;
      }
      throw new Error(`TMDB ${method} ${url.pathname}: ${response.status} ${await response.text()}`);
    }
    throw new Error(`TMDB retry budget exhausted after ${attempts} attempts: ${method} ${url.pathname}`);
  }
  v3(path, params) { return this.request(path, { params }); }
  v4(path, options = {}) { return this.request(path, { ...options, version: 4, user: true }); }
  async pages(path, params, limit = 200) {
    const key = JSON.stringify([path, params, limit]); return this.cached(key, async () => {
      const items = [];
      for (let page = 1; items.length < limit; page++) { const result = await this.v3(path, { ...params, page }); items.push(...(result.results ?? [])); if (page >= Math.min(result.total_pages ?? 1, 500)) break; }
      return items.slice(0, limit);
    });
  }
  discover(media, params, limit = 200) { return this.pages(`/discover/${media}`, { language: this.language, ...params }, limit); }
  trending(media, window = "day") {
    invariant(["day", "week"].includes(window), `Unsupported TMDB trending window: ${window}`);
    return this.pages(`/trending/${media}/${window}`, { language: this.language }, 200);
  }
  async watchRegions() { return this.cached("watch-regions", async () => (await this.v3("/watch/providers/regions")).results ?? []); }
  async providers(media) { return this.cached(`providers:${media}`, async () => (await this.v3(`/watch/providers/${media}`)).results ?? []); }
  async watchProviders(media, id) {
    return this.cached(`watch:${media}:${id}`, async () => {
      try { return (await this.v3(`/${media}/${id}/watch/providers`)).results ?? {}; }
      catch (error) {
        // Trending can briefly advertise an ID that TMDB deletes before its
        // watch-provider lookup. A definitive resource-not-found response means
        // this candidate is unavailable everywhere; every other error remains
        // fail-closed so outages never masquerade as an empty GR result.
        if (/\b404\b/.test(error.message) && /status_code["']?\s*:\s*34|resource you requested could not be found/i.test(error.message)) return {};
        throw error;
      }
    });
  }
  async details(media, id) { return this.cached(`details:${media}:${id}:${this.language}`, () => this.v3(`/${media}/${id}`, { language: this.language })); }
  async credits(personId, media) { return this.cached(`credits:${personId}:${media}:${this.language}`, () => this.v3(`/person/${personId}/${media}_credits`, { language: this.language })); }
  async changedIds(media, startDate, endDate) { const values = await this.pages(`/${media}/changes`, { start_date: startDate, end_date: endDate }, 10000); return values.map((x) => x.id); }
  async keywordIds(names) {
    const normalized = [...names].map((name) => name.toLowerCase()).sort();
    return this.cached(`keywords:${normalized.join("|")}`, async () => {
      const ids = [];
      for (const name of names) { const result = await this.v3("/search/keyword", { query: name, page: 1 }); const exact = (result.results ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? result.results?.[0]; if (exact) ids.push(exact.id); }
      return ids;
    });
  }
  async companyId(name) { return this.cached(`company:${normalizeText(name)}`, async () => { const result = await this.v3("/search/company", { query: name, page: 1 }); return result.results?.[0]?.id ?? null; }); }
  async awardWinners({ awardId, slug, categoryId, categorySlug }) {
    if (!awardId || !categoryId || !categorySlug) throw new Error("Official TMDB award category route is unresolved");
    const url = `https://www.themoviedb.org/award/${awardId}-${slug}/category/${categoryId}-${categorySlug}?language=en-US`;
    const response = await this.fetchImpl(url, { headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" } });
    if (!response.ok) throw new Error(`TMDB Awards page failed: ${response.status}`);
    const html = await response.text(), headings = [...html.matchAll(/<h4[^>]*>[\s\S]*?\((\d{4})\)[\s\S]*?<\/h4>/gi)];
    const winners = [];
    for (let index = 0; index < headings.length; index++) {
      const year = Number(headings[index][1]), section = html.slice(headings[index].index + headings[index][0].length, headings[index + 1]?.index ?? html.length);
      for (const card of section.split(/class="status/gi).slice(1)) {
        if (!/<bdi>\s*Winner\s*<\/bdi>/i.test(card.slice(0, 800))) continue;
        const media = card.match(/href="\/(movie|tv)\/(\d+)(?:-[^"?]+)?(?:\?[^\"]*)?"/i);
        if (media) winners.push({ id: Number(media[2]), media_type: media[1].toLowerCase(), award_year: year });
      }
    }
    if (!winners.length) throw new Error(`No winner work parsed from official TMDB category: ${url}`);
    return winners;
  }
  async publicHtml(url) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cooldown = this.blockedUntil - Date.now(); if (cooldown > 0) await sleep(cooldown);
      const response = await this.withHttpSlot(() => this.fetchImpl(url, { headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (compatible; NuvioCollectionsAudit/1.0; +https://github.com/nosvasedis/Nuvio-Collections)" } }));
      if (response.ok) return response.text();
      if (response.status === 404) return null;
      if (response.status === 403 || response.status === 429 || response.status >= 500) { const delay = this.retryDelay(response, attempt); this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay); continue; }
      throw new Error(`Public authority page failed: ${response.status} ${url}`);
    }
    throw new Error(`Public authority retry budget exhausted: ${url}`);
  }
  async cannesYear(year) {
    return this.cached(`cannes:${year}`, async () => {
    const html = await this.publicHtml(`https://www.festival-cannes.com/en/retrospective/${year}/awards/`);
    if (!html) return [];
    const records = [];
    for (const card of html.split(/<div class="list_item\s+flex\b/gi).slice(1)) {
      const titleLink = card.match(/<a href="([^"]+)"[^>]*class="[^"]*list_item__content__title[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/a>/i);
      const relationMatch = card.match(/<span class="[^"]*\bblock\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const awardMatch = card.match(/<div class="[^"]*list_item__award[^"]*">[\s\S]*?<span>([\s\S]*?)<\/span>/i);
      if (!titleLink || !awardMatch) continue;
      const href = titleLink[1], headline = cleanHtml(titleLink[2]), relation = cleanHtml(relationMatch?.[1] ?? ""), award = cleanHtml(awardMatch[1]);
      const isFilmLink = /\/en\/f\//.test(href); const workTitle = isFilmLink ? headline : relation.replace(/^\s*(?:for|in)\s+/i, "");
      const contributor = isFilmLink ? relation.replace(/^\s*by\s+/i, "") : headline;
      if (workTitle && award) records.push({ year, workTitle, contributor, award, authorityUrl: `https://www.festival-cannes.com/en/retrospective/${year}/awards/` });
    }
    if (!records.length && ![1948, 1950, 1968, 2020].includes(year)) throw new Error(`Cannes parser contract failed for ${year}`);
    return records;
    });
  }
  async oscarsYear(year) {
    return this.cached(`oscars:${year}`, async () => {
    const html = await this.publicHtml(`https://www.oscars.org/oscars/ceremonies/${year}`); if (!html) throw new Error(`Official Oscars ceremony missing: ${year}`);
    const starts = [...html.matchAll(/<div[^>]*class="[^"]*paragraph--type--award-category\b[^"]*"/gi)], records = [];
    for (let index = 0; index < starts.length; index++) {
      const block = html.slice(starts[index].index, starts[index + 1]?.index ?? html.length);
      const category = cleanHtml(block.match(/field--name-field-award-category-oscars[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
      for (const entry of block.split(/paragraph--type--award-honoree/gi).slice(1)) {
        if (!/field--name-field-honoree-type winner[^>]*>\s*Winner\s*<\/div>/i.test(entry.slice(0, 1200))) continue;
        const workTitle = cleanHtml(entry.match(/field--name-field-award-film[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
        const contributor = cleanHtml(entry.match(/field--name-field-award-entities[\s\S]*?<div class="field__item">([\s\S]*?)<\/div>/i)?.[1] ?? "");
        if (category && workTitle) records.push({ year, category, workTitle, contributor, authorityUrl: `https://www.oscars.org/oscars/ceremonies/${year}` });
      }
    }
    if (!records.length) throw new Error(`Oscars parser contract failed for ${year}`); return records;
    });
  }
  oscarCategoryMatches(key, label) {
    const value = normalizeText(label);
    if (key === "score") {
      if (/adaptation|original song score|musical picture/.test(value)) return false;
      return /^music (?:music score|original .*score|scoring$)/.test(value);
    }
    const rules = {
      picture: /best picture|outstanding (?:motion )?picture|outstanding production|best motion picture/,
      adapted_screenplay: /writing adaptation|adapted screenplay|screenplay.*adapted|screenplay.*based on|story and screenplay.*based on/,
      animated_feature: /animated feature/,
      animated_short: /animated short|short film animated|short subject (animated|cartoon)/,
      cinematography: /cinematography/, documentary_feature: /documentary.*feature/,
      documentary_short: /documentary.*short/, editing: /film editing/,
      international: /international feature|foreign language film/,
      live_action_short: /live action short|short film.*live action|short subject (live action|one reel|two reel|comedy|novelty|color)/,
      original_screenplay: /original screenplay|writing.*original|screenplay written directly|story and screenplay.*written directly/,
      song: /music (?:original song|song(?: original for the picture)?)/,
      actor: /^actor$|actor in a leading role/, supporting_actor: /actor in a supporting role/,
      actress: /^actress$|actress in a leading role/, supporting_actress: /actress in a supporting role/,
      production_design: /production design|art direction/,
      sound_editing: /sound editing|sound effects(?: editing)?|special achievement award sound effects?(?: editing)?/,
      sound: /^sound$|sound mixing|sound recording/,
      special_effects: /^special effects$|engineering effects/,
      visual_effects: /visual effects|special visual effects|special achievement award visual effects/,
    };
    return rules[key]?.test(value) ?? false;
  }

  academyPresentationYear(record) {
    const early = { 1: 1929, 2: 1930, 3: 1930, 4: 1931, 5: 1932, 6: 1934 };
    if (early[record.ceremonyNumber]) return early[record.ceremonyNumber];
    const eligibilityYear = Number(String(record.awardYearLabel).match(/\d{4}/)?.[0]);
    if (!Number.isInteger(eligibilityYear)) throw new Error(`Invalid Academy award year label: ${record.awardYearLabel}`);
    return eligibilityYear + 1;
  }

  async academyAwardsSnapshot() {
    return this.cached("academy-awards-snapshot", async () => {
      const [snapshot, honorary] = await Promise.all([readJson(ACADEMY_AWARDS_SNAPSHOT_FILE), readJson(ACADEMY_AWARDS_HONORARY_FILE)]);
      if (snapshot.version !== 1 || snapshot.authority !== "https://awardsdatabase.oscars.org/") throw new Error("Academy Awards snapshot authority contract failed");
      if (snapshot.completeThrough?.ceremonyNumber !== 98 || snapshot.completeThrough?.awardYear !== 2025) throw new Error("Academy Awards snapshot completeness metadata failed");
      if (!Array.isArray(snapshot.records) || snapshot.records.length !== 2224) throw new Error("Academy Awards snapshot record-count contract failed");
      const ceremonies = new Set(snapshot.records.map((record) => record.ceremonyNumber));
      if (ceremonies.size !== 98 || Math.min(...ceremonies) !== 1 || Math.max(...ceremonies) !== 98) throw new Error("Academy Awards snapshot ceremony coverage failed");
      if (honorary.version !== 1 || honorary.authority !== snapshot.authority || !Array.isArray(honorary.records) || honorary.records.length !== 8) throw new Error("Academy honorary foreign-film supplement contract failed");
      return { ...snapshot, records: [...snapshot.records, ...honorary.records] };
    });
  }

  async resolveAcademyWork(record, category, overrides = {}) {
    const legacyOverrideKey = `${record.year}:oscars:${category}:${normalizeText(record.workTitle)}`;
    const academyOverrideKey = `academy-film:${record.filmId}`;
    const forcedId = overrides[academyOverrideKey] ?? overrides[legacyOverrideKey];
    if (forcedId) {
      const item = await this.v3(`/movie/${Number(forcedId)}`);
      return { id: item.id, media_type: "movie", award_year: record.year, authority_url: record.authorityUrl, _release_year: Number(String(item.release_date ?? "").slice(0, 4)), _vote_count: item.vote_count ?? 0, _person_match: false, _override_key: overrides[academyOverrideKey] ? academyOverrideKey : legacyOverrideKey };
    }
    const variants = titleVariants(record.workTitle);
    const parenthetical = String(record.workTitle).match(/^(.+?)\s*\((?:'|")?(.+?)(?:'|")?\)\s*$/);
    if (parenthetical) variants.push(parenthetical[1].trim(), parenthetical[2].trim());
    const academyCanonical = (value) => normalizeText(value ?? "").replace(/\bblvd\b/g, "boulevard").replace(/\b(the|a|an|in|and|of)\b/g, "").replace(/\s+/g, "");
    const targetCanonical = [...new Set(variants.map(academyCanonical).filter(Boolean))];
    const titleMatches = (item) => [item.title, item.original_title].filter(Boolean).map(academyCanonical).some((title) => targetCanonical.some((target) => title === target || (target.length >= 6 && title.startsWith(target))));
    const expectedYear = record.year - 1;
    let searches = [];
    searchLoop: for (const query of [...new Set(variants)].slice(0, 3)) {
      for (const year of [expectedYear, record.year, undefined]) {
        const results = (await this.v3("/search/movie", { query, include_adult: false, year })).results ?? [];
        searches.push(...results);
        if (results.some((item) => titleMatches(item) && Math.abs(Number(String(item.release_date ?? "").slice(0, 4)) - expectedYear) <= 1)) break searchLoop;
      }
    }
    searches = [...new Map(searches.map((item) => [item.id, item])).values()];
    const candidates = searches.map((item) => {
      const titleExact = titleMatches(item);
      const releaseYear = Number(String(item.release_date ?? "").slice(0, 4));
      const yearDistance = Math.abs(releaseYear - expectedYear);
      return { item, titleExact, releaseYear, yearDistance, score: (titleExact ? 10 : 0) + (yearDistance === 0 ? 4 : yearDistance === 1 ? 2 : yearDistance === 2 ? 1 : 0) };
    }).filter((candidate) => candidate.titleExact && candidate.releaseYear >= record.year - 3 && candidate.releaseYear <= record.year)
      .sort((a, b) => b.score - a.score || (b.item.vote_count ?? 0) - (a.item.vote_count ?? 0) || (b.item.popularity ?? 0) - (a.item.popularity ?? 0) || a.item.id - b.item.id);
    if (!candidates.length) return null;
    let best = candidates[0];
    const tied = candidates.filter((candidate) => candidate.score === best.score);
    const topVotes = tied[0]?.item.vote_count ?? 0, secondVotes = tied[1]?.item.vote_count ?? 0;
    const dominantIdentity = tied.length > 1 && topVotes >= 20 && topVotes >= Math.max(1, secondVotes) * 5;
    if (tied.length > 1 && !dominantIdentity && record.contributor) {
      const contributor = normalizeText(record.contributor), surname = contributor.split(" ").at(-1);
      const inspected = await mapLimit(tied.slice(0, 3), 3, async (candidate) => {
        const details = await this.v3(`/movie/${candidate.item.id}`, { append_to_response: "credits" });
        const people = [...(details.credits?.cast ?? []), ...(details.credits?.crew ?? [])].map((person) => normalizeText(person.name ?? ""));
        return { ...candidate, personMatch: surname.length > 2 && people.some((name) => name === contributor || name.split(" ").at(-1) === surname) };
      });
      inspected.sort((a, b) => Number(b.personMatch) - Number(a.personMatch) || (b.item.vote_count ?? 0) - (a.item.vote_count ?? 0) || a.item.id - b.item.id);
      if (!inspected[0].personMatch && inspected.length > 1 && inspected[0].score === inspected[1].score) return null;
      best = inspected[0];
    }
    return { id: best.item.id, media_type: "movie", award_year: record.year, authority_url: record.authorityUrl, _release_year: best.releaseYear, _vote_count: best.item.vote_count ?? 0, _person_match: Boolean(best.personMatch) };
  }
  async globesYear(year) {
    return this.cached(`globes:${year}`, async () => {
    const html = await this.publicHtml(`https://goldenglobes.com/nominations/${year}`); if (!html) throw new Error(`Official Golden Globes ceremony missing: ${year}`);
    const starts = [...html.matchAll(/<div[^>]*class="[^"]*c-nominations-category\b[^"]*"/gi)], records = [];
    for (let index = 0; index < starts.length; index++) {
      const block = html.slice(starts[index].index, starts[index + 1]?.index ?? html.length);
      const category = cleanHtml(block.match(/c-nominations-category__heading[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
      const winners = [...block.matchAll(/c-nomination-category-winner__details[\s\S]*?<div class="c-nomination-details">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)];
      for (const winnerMatch of winners) {
        const winner = winnerMatch[1];
        const title = cleanHtml(winner.match(/c-nomination-details__title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
        const show = cleanHtml(winner.match(/c-nomination-details__show[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
        if (category && (show || title)) records.push({ year, category, workTitle: show || title, contributor: show ? title : "", authorityUrl: `https://goldenglobes.com/nominations/${year}` });
      }
    }
    if (!records.length) throw new Error(`Golden Globes parser contract failed for ${year}`); return records;
    });
  }
  goldenCategoryMatches(id, label, year = 9999) {
    const v = normalizeText(label), male = /actor/.test(v) && !/actress|female/.test(v), female = /actress|female actor/.test(v);
    const has = (...terms) => terms.every((term) => v.includes(term));
    const rules = {
      7: (has("motion picture", "drama") || (year <= 1951 && /^picture$/.test(v))) && !male && !female,
      42: (has("television series", "drama") || (year < 1970 && /^(best )?television series$/.test(v))) && !male && !female,
      46: male && ((year < 1970 && /^actor in a television series$/.test(v)) || (year >= 1970 && has("television series", "drama"))),
      45: female && ((year < 1970 && /^actress in a television series$/.test(v)) || (year >= 1970 && has("television series", "drama"))),
      15: female && ((has("motion picture") && /musical|comedy/.test(v)) || /^actress in a leading role musical or comedy$/.test(v)),
      13: male && ((has("motion picture") && /musical|comedy/.test(v)) || /^actor in a leading role musical or comedy$/.test(v)),
      8: !male && !female && ((has("motion picture") && /musical|comedy/.test(v)) || /^picture (musical|comedy)$/.test(v)),
      43: has("television series") && /musical|comedy/.test(v) && !male && !female,
      49: year >= 1970 && has("television series") && /musical|comedy/.test(v) && male,
      47: year >= 1970 && has("television series") && /musical|comedy/.test(v) && female,
      20: /original song/.test(v), 19: /original score/.test(v), 16: /screenplay/.test(v),
      5: /supporting/.test(v) && /motion picture/.test(v) && !/television|series/.test(v) && female,
      4: /supporting/.test(v) && /motion picture/.test(v) && !/television|series/.test(v) && male,
      14: female && (has("motion picture", "drama") || (year <= 1950 && /^actress in a leading role$/.test(v))),
      12: male && (has("motion picture", "drama") || (year <= 1950 && /^actor in a leading role$/.test(v))),
      6: /director/.test(v) && /motion picture/.test(v) && !/television/.test(v),
      9: /foreign language|non english/.test(v), 10: /animated/.test(v), 44: /limited series|miniseries|motion picture made for television/.test(v) && !male && !female,
      51: /limited series|miniseries|motion picture made for television/.test(v) && male, 48: /limited series|miniseries|motion picture made for television/.test(v) && female,
      60: /supporting/.test(v) && /television|series/.test(v) && male, 61: /supporting/.test(v) && /television|series/.test(v) && female,
    };
    return Boolean(rules[id]);
  }
  cannesCategoryMatches(category, record) {
    const label = normalizeText(record.award), short = /short film|court metrage/.test(label);
    if (category === "palme_short") return short && /palme d or|grand prix/.test(label);
    if (category === "palme_feature") {
      if (!short && /palme d or/.test(label)) return true;
      if (record.year === 1946) return /^grand prix$/.test(label);
      if (record.year === 1947) return /^grand prix (comedies musicales|dessin anime|documentaires|films d aventures et policiers|films psychologiques et d amour|films sociaux)$/.test(label);
      if (record.year >= 1949 && record.year <= 1954) return /^grand prix(?: ex aequo)?$/.test(label);
      return record.year >= 1964 && record.year <= 1974 && !short && /^grand prix international du festival/.test(label);
    }
    if (category === "grand_prix") return record.year >= 1967 && !short && (/^grand prix(?: ex aequo)?$/.test(label) || /jury s special grand prix|grand prix special du jury/.test(label));
    if (category === "jury_prize") return !short && /jury prize|prix du jury|special jury prize/.test(label) && !/grand prix/.test(label);
    if (category === "director") return /best director|mise en scene/.test(label);
    if (category === "actor") return (/best (performance by an )?actor|best actor|meilleure interpretation masculine/.test(label)) && !/actress/.test(label);
    if (category === "actress") return /best (performance by an )?actress|best actress|meilleure interpretation feminine/.test(label);
    if (category === "screenplay") return /best screenplay|screenplay prize|scenario/.test(label);
    return false;
  }
  async resolveCannesWork(record, category, overrides = {}, media = "movie") {
    const overrideKey = `${record.year}:${category}:${normalizeText(record.workTitle)}`, forcedId = overrides[overrideKey];
    const dateKey = media === "movie" ? "release_date" : "first_air_date";
    if (forcedId) {
      const item = await this.v3(`/${media}/${Number(forcedId)}`);
      return { id: item.id, media_type: media, award_year: record.year, authority_url: record.authorityUrl, _release_year: Number(String(item[dateKey] ?? "").slice(0, 4)), _vote_count: item.vote_count ?? 0, _person_match: false, _override_key: overrideKey };
    }
    const variants = titleVariants(record.workTitle);
    let searches = [];
    for (const query of variants.slice(0, 3)) {
      const yearOptions = media === "movie" ? [record.year, record.year - 1, undefined] : [undefined];
      for (const year of yearOptions) searches.push(...((await this.v3(`/search/${media}`, { query, include_adult: false, year })).results ?? []));
    }
    if (media === "movie" && record.contributor) {
      const people = (await this.v3("/search/person", { query: record.contributor, include_adult: false })).results ?? [];
      const targetPerson = normalizeText(record.contributor), targetPersonSurname = targetPerson.split(" ").at(-1);
      const personMatches = people.filter((person) => { const name = normalizeText(person.name ?? ""); return name === targetPerson || (targetPersonSurname.length > 2 && name.split(" ").at(-1) === targetPersonSurname); }).slice(0, 3);
      for (const person of personMatches) {
        const credits = await this.credits(person.id, "movie");
        for (const item of [...(credits.cast ?? []), ...(credits.crew ?? [])]) {
          const creditYear = Number(String(item.release_date ?? "").slice(0, 4));
          if (Math.abs(creditYear - record.year) <= 2) searches.push(item);
        }
      }
    }
    const canonicalSearchTitle = (title) => normalizeText(title ?? "").replace(/^(the|a|an) /, "").replace(/\band\b/g, "").replace(/\s+/g, "");
    const targetSearchTitles = variants.map(canonicalSearchTitle);
    searches = [...new Map(searches.map((item) => [item.id, item])).values()].sort((a, b) => {
      const aExact = targetSearchTitles.includes(canonicalSearchTitle(a.title ?? a.name));
      const bExact = targetSearchTitles.includes(canonicalSearchTitle(b.title ?? b.name));
      const aYear = Number(String(a[dateKey] ?? "").slice(0, 4)), bYear = Number(String(b[dateKey] ?? "").slice(0, 4));
      return Number(bExact) - Number(aExact) || Math.abs(aYear - record.year) - Math.abs(bYear - record.year) || (b.vote_count ?? 0) - (a.vote_count ?? 0) || (b.popularity ?? 0) - (a.popularity ?? 0) || a.id - b.id;
    });
    const candidates = (await mapLimit(searches.slice(0, 12), 4, async (item) => {
      try { return await this.v3(`/${media}/${item.id}`, { append_to_response: "credits,alternative_titles" }); }
      catch (error) { if (/\b404\b/.test(error.message)) return null; throw error; }
    })).filter(Boolean);
    const targetTitles = variants.map(normalizeText), targetContributor = normalizeText(record.contributor), targetSurname = targetContributor.split(" ").at(-1);
    const scored = candidates.map((item) => {
      const titles = [item.title, item.original_title, item.name, item.original_name, ...(item.alternative_titles?.titles ?? item.alternative_titles?.results ?? []).map((x) => x.title)].filter(Boolean).map(normalizeText);
      const releaseYear = Number(String(item[dateKey] ?? "").slice(0, 4));
      const people = [...(item.credits?.cast ?? []), ...(item.credits?.crew ?? [])].map((x) => normalizeText(x.name ?? ""));
      const canonical = (title) => title.replace(/^(the|a|an) /, "").replace(/\band\b/g, "").replace(/\s+/g, "");
      const titleExact = titles.some((title) => targetTitles.includes(title) || targetTitles.some((target) => {
        const left = canonical(title), right = canonical(target);
        return left === right || (Math.min(left.length, right.length) >= 8 && (left.startsWith(right) || right.startsWith(left)));
      })), yearDistance = Math.abs(releaseYear - record.year);
      const personMatch = targetSurname.length > 2 && people.some((name) => name === targetContributor || name.split(" ").at(-1) === targetSurname);
      const eligibleYear = media === "tv" ? releaseYear <= record.year + 1 : yearDistance <= 2;
      const yearScore = media === "tv" ? (eligibleYear ? 1 : 0) : (yearDistance <= 1 ? 3 : yearDistance <= 2 ? 1 : 0);
      return { item, score: (titleExact ? 5 : 0) + yearScore + (personMatch ? 3 : 0), titleExact, yearDistance, eligibleYear, personMatch };
    }).filter((candidate) => candidate.eligibleYear && (candidate.titleExact || (candidate.personMatch && candidate.yearDistance <= 1)))
      .sort((a, b) => b.score - a.score || (b.personMatch ? 1 : 0) - (a.personMatch ? 1 : 0) || (b.item.vote_count ?? 0) - (a.item.vote_count ?? 0) || (b.item.popularity ?? 0) - (a.item.popularity ?? 0) || a.item.id - b.item.id);
    const best = scored[0];
    const minimumScore = media === "tv" ? 5 : 6;
    if (!best || best.score < minimumScore) return null;
    return { id: best.item.id, media_type: media, award_year: record.year, authority_url: record.authorityUrl, _release_year: Number(String(best.item[dateKey] ?? "").slice(0, 4)), _vote_count: best.item.vote_count ?? 0, _person_match: best.personMatch };
  }
  async cannesWinners({ category, startYear, endYear, overrides = {} }) {
    const snapshot = await this.cached("cannes-awards-snapshot", async () => {
      const value = await readJson(CANNES_AWARDS_SNAPSHOT_FILE);
      if (value.version !== 1 || value.authority !== "https://www.festival-cannes.com/en/retrospective/") throw new Error("Cannes snapshot authority contract failed");
      if (value.completeThroughYear !== 2026 || !Array.isArray(value.records) || value.records.length !== 1324) throw new Error("Cannes snapshot completeness contract failed");
      if (Math.min(...value.records.map((record) => record.year)) !== 1946 || Math.max(...value.records.map((record) => record.year)) !== 2026) throw new Error("Cannes snapshot year coverage failed");
      return value;
    });
    if (endYear > snapshot.completeThroughYear) throw new Error(`Cannes snapshot is stale: requested through ${endYear}, complete through ${snapshot.completeThroughYear}`);
    const records = snapshot.records.filter((record) => record.year >= startYear && record.year <= endYear && this.cannesCategoryMatches(category, record));
    const resolved = await mapLimit(records, 5, (record) => this.resolveCannesWork(record, category, overrides));
    const unresolved = records.filter((_, index) => !resolved[index]);
    if (unresolved.length) throw new Error(`Cannes TMDB resolution failed for ${unresolved.length} official winners: ${unresolved.slice(0, 5).map((x) => `${x.year} ${x.workTitle}`).join("; ")}`);
    return resolved.filter(Boolean);
  }
  async oscarsWinners({ category, startYear, endYear, overrides = {} }) {
    const snapshot = await this.academyAwardsSnapshot();
    const snapshotPresentationYear = Number(snapshot.completeThrough.awardYear) + 1;
    if (endYear > snapshotPresentationYear) throw new Error(`Academy Awards snapshot is stale: requested through ${endYear}, complete through presentation year ${snapshotPresentationYear}`);
    const records = snapshot.records.map((record) => ({ ...record, year: this.academyPresentationYear(record) }))
      .filter((record) => record.year >= startYear && record.year <= endYear && this.oscarCategoryMatches(category, record.category));
    if (!records.length) throw new Error(`Academy Awards snapshot has no records for ${category} in ${startYear}-${endYear}`);
    const resolved = await mapLimit(records, 8, (record) => this.cached(`academy-tmdb:${record.filmId}`, () => this.resolveAcademyWork(record, category, overrides)));
    const unresolved = records.filter((_, i) => !resolved[i]); if (unresolved.length) throw new Error(`Oscars TMDB resolution failed for ${unresolved.length} official winners: ${unresolved.slice(0, 5).map((x) => `${x.year} ${x.workTitle}`).join("; ")}`);
    return resolved.filter(Boolean);
  }
  async globesWinners({ categoryId, startYear, endYear, overrides = {}, media, partition = null, nonWorkWinners = [] }) {
    const excluded = new Set(nonWorkWinners);
    const records = []; for (let year = Math.max(1944, startYear); year <= endYear; year++) records.push(...(await this.globesYear(year)).filter((x) => this.goldenCategoryMatches(categoryId, x.category, year) && !excluded.has(`${x.year}:globes:${categoryId}:${normalizeText(x.workTitle)}`)));
    const mixedCategory = [44, 48, 51, 60, 61].includes(categoryId);
    const resolved = await mapLimit(records, 5, async (record) => {
      if (!mixedCategory) return this.resolveCannesWork(record, `globes:${categoryId}`, overrides, media);
      const key = `globes-identity:${categoryId}:${record.year}:${normalizeText(record.workTitle)}:${normalizeText(record.contributor)}`;
      return this.cached(key, async () => {
        const [tv, movie] = await Promise.all([
          this.resolveCannesWork(record, `globes:${categoryId}:tv`, overrides, "tv"),
          this.resolveCannesWork(record, `globes:${categoryId}:movie`, overrides, "movie"),
        ]);
        if (tv && movie) {
          const ranked = [tv, movie].sort((a, b) => Number(Boolean(b._override_key)) - Number(Boolean(a._override_key)) || Number(b._person_match) - Number(a._person_match) || Math.abs(a._release_year - record.year) - Math.abs(b._release_year - record.year) || b._vote_count - a._vote_count || a.id - b.id);
          return ranked[0];
        }
        return tv ?? movie;
      });
    });
    const unresolved = records.filter((_, i) => !resolved[i]); if (unresolved.length) throw new Error(`Golden Globes TMDB resolution failed for ${unresolved.length} official winners: ${unresolved.slice(0, 5).map((x) => `${x.year} ${x.workTitle}`).join("; ")}`);
    return resolved.filter((item) => item && (!partition || item.media_type === partition));
  }
  async accountListsAll(accountId = process.env.TMDB_ACCOUNT_OBJECT_ID) {
    if (!accountId) throw new Error("TMDB_ACCOUNT_OBJECT_ID is required");
    const results = [];
    for (let page = 1; ; page++) {
      const response = await this.v4(`/account/${accountId}/lists`, { params: { page } });
      results.push(...(response.results ?? []));
      if (page >= (response.total_pages ?? 0)) break;
    }
    return results;
  }
  // List creation is non-idempotent. Never retry an ambiguous POST response;
  // sync recovery discovers the deterministic rail key from the description.
  async createList(name, description, media) {
    const operation = this.createChain.then(async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const delay = this.nextCreateAt - Date.now(); if (delay > 0) await sleep(delay);
        try { return await this.v4("/list", { method: "POST", retry: false, body: { name, description, iso_639_1: "el", public: true, iso_3166_1: "GR" } }); }
        catch (error) {
          // A definitive HTTP 400 spam rejection cannot have committed a list,
          // so a delayed retry is safe. Network/5xx ambiguity is never retried.
          if (!/\b400\b/.test(error.message) || !/suspected to be spam/i.test(error.message) || attempt === 5) throw error;
          await sleep(Math.min(300000, Number(process.env.TMDB_SPAM_COOLDOWN_MS ?? 60000) * 2 ** attempt));
        } finally { this.nextCreateAt = Date.now() + Math.max(1000, Number(process.env.TMDB_CREATE_INTERVAL_MS ?? 2500)); }
      }
      throw new Error("TMDB spam retry budget exhausted");
    });
    this.createChain = operation.catch(() => {});
    return operation;
  }
  async deleteList(id) { return this.v4(`/list/${id}`, { method: "DELETE" }); }
  listV3(id) { return this.v3(`/list/${id}`, { language: this.language }); }
  listV4(id) { return this.v4(`/list/${id}`); }
  async listV3All(id) { const items = []; let first; for (let page = 1; ; page++) { const result = await this.v3(`/list/${id}`, { language: this.language, page }); first ??= result; items.push(...(result.items ?? [])); if (page >= (result.total_pages ?? 1)) break; } return { ...first, items }; }
  async listV4All(id) { const items = []; let first; for (let page = 1; ; page++) { const result = await this.v4(`/list/${id}`, { params: { page } }); first ??= result; items.push(...(result.results ?? [])); if (page >= (result.total_pages ?? 1)) break; } return { ...first, results: items }; }
  async clearList(id) { return this.v4(`/list/${id}/clear`, { method: "GET" }); }
  async addItems(id, items) {
    if (!items.length) return;
    // TMDB v4 explicitly supports unlimited items in one request. A single
    // ordered batch avoids cross-batch original_order permutations.
    const result = await this.v4(`/list/${id}/items`, { method: "POST", body: { items: items.map((x) => ({ media_type: x.media_type, media_id: x.id })) } });
    const errors = [...(result.error_results ?? []), ...(result.results ?? []).filter((item) => item.success !== true)];
    const unexpected = errors.filter((item) => !(item.error ?? []).every((message) => /Media has already been taken/i.test(message)));
    if ((result.results ?? []).length !== items.length || unexpected.length) {
      const error = new Error(`TMDB list ${id} accepted ${(result.results ?? []).filter((item) => item.success === true).length}/${items.length} items: ${JSON.stringify(errors.slice(0, 3))}`);
      error.invalidItems = unexpected.filter((item) => (item.error ?? []).some((message) => /Media is (?:invalid|required)/i.test(message))).map((item) => ({
        media_type: item.media_type, id: Number(item.media_id), reason: (item.error ?? []).some((message) => /Media is required/i.test(message)) ? "TMDB_LIST_MEDIA_REQUIRED" : "TMDB_LIST_MEDIA_INVALID",
      })).filter((item) => item.media_type && Number.isInteger(item.id));
      throw error;
    }
  }
}
