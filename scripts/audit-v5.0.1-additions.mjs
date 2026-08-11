import path from "node:path";
import { BASE_INPUT_FILE, INPUT_FILE, RAILS_FILE, ROOT } from "../src/constants.mjs";
import { readJson, writeJson, athensDate, mapLimit } from "../src/utils.mjs";
import { TmdbClient } from "../src/tmdb.mjs";
import { materializeRail, requireUsablePosters } from "../src/materialize.mjs";

const [base, input, manifest] = await Promise.all([readJson(BASE_INPUT_FILE), readJson(INPUT_FILE), readJson(RAILS_FILE)]);
const oldFolderIds = new Set(base.flatMap((collection) => collection.folders).map((folder) => folder.id));
const newFolders = input.flatMap((collection) => collection.folders).filter((folder) => !oldFolderIds.has(folder.id));
const newFolderIds = new Set(newFolders.map((folder) => folder.id));
const folderById = new Map(newFolders.map((folder) => [folder.id, folder]));
const rails = manifest.rails.filter((rail) => newFolderIds.has(rail.folderId));
const client = new TmdbClient();
const today = athensDate();

const results = await mapLimit(rails, 4, async (rail) => {
  const started = performance.now();
  try {
    const media = rail.mediaType === "TV" ? "tv" : "movie";
    const materialized = await materializeRail(client, rail, { today, folderTitle: folderById.get(rail.folderId)?.title ?? "" });
    const items = await requireUsablePosters(client, materialized.items, media);
    return { key: rail.key, folder: folderById.get(rail.folderId)?.title, title: rail.title, media: rail.mediaType, scope: materialized.scope, count: items.length, status: items.length ? "ok" : "empty", durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { key: rail.key, folder: folderById.get(rail.folderId)?.title, title: rail.title, media: rail.mediaType, status: "failed", error: error.message, durationMs: Math.round(performance.now() - started) };
  }
});

const report = {
  date: today, folders: newFolders.length, rails: rails.length,
  totals: { ok: results.filter((item) => item.status === "ok").length, empty: results.filter((item) => item.status === "empty").length, failed: results.filter((item) => item.status === "failed").length },
  problems: results.filter((item) => item.status !== "ok"), results,
};
const reportPath = path.join(ROOT, "reports", "v5.0.1-additions.json");
await writeJson(reportPath, report);
console.log(JSON.stringify({ report: reportPath, date: report.date, folders: report.folders, rails: report.rails, totals: report.totals, problems: report.problems }, null, 2));
if (report.totals.empty || report.totals.failed) process.exitCode = 1;
