import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function readJson(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temporary, file); break; }
    catch (error) {
      if (!new Set(["EPERM", "EBUSY", "EACCES"]).has(error.code) || attempt >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 50 * 2 ** attempt)));
    }
  }
}
export function clone(value) { return structuredClone(value); }
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
export function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function railKey(collectionId, folderId, sourceIndex, suffix = "") {
  return `${collectionId}:${folderId}:${sourceIndex}${suffix}`.replace(/[^a-zA-Z0-9._:-]/g, "-");
}
export function mediaValue(mediaType) {
  if (mediaType === "MOVIE") return "movie";
  if (mediaType === "TV") return "tv";
  throw new Error(`Unsupported media type: ${mediaType}`);
}
export function dateFor(item, mediaType) {
  return mediaType === "movie" ? item.release_date : item.first_air_date;
}
export function uniqueItems(items, mediaType) {
  const seen = new Set();
  return items.filter((item) => {
    const type = item.media_type === "tv" ? "tv" : item.media_type === "movie" ? "movie" : mediaType;
    const key = `${type}:${item.id}`;
    if (!Number.isInteger(item.id) || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
export function normalizeText(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("el")
    .replace(/[ł]/g, "l").replace(/[đð]/g, "d").replace(/[þ]/g, "th").replace(/[æ]/g, "ae")
    .replace(/[œ]/g, "oe").replace(/[ø]/g, "o").replace(/[ß]/g, "ss")
    .replace(/—.*$/u, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function athensDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
export function shiftYears(isoDate, years) {
  const date = new Date(`${isoDate}T12:00:00Z`); date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}
export function invariant(condition, message) { if (!condition) throw new Error(message); }
export async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length); let cursor = 0;
  async function worker() {
    while (true) { const index = cursor++; if (index >= values.length) return; results[index] = await mapper(values[index], index); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}
