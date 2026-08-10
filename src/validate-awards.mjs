import { INPUT_FILE, RAILS_FILE, AWARDS_FILE } from "./constants.mjs";
import { readJson, athensDate, normalizeText, mapLimit } from "./utils.mjs";
import { materializeRail } from "./materialize.mjs";
import { TmdbClient } from "./tmdb.mjs";

export async function validateAwards({ client = new TmdbClient(), group = "all" } = {}) {
  const [input, manifest, awards] = await Promise.all([readJson(INPUT_FILE), readJson(RAILS_FILE), readJson(AWARDS_FILE)]);
  const folderMap = new Map(input.flatMap((collection) => collection.folders).map((folder) => [folder.id, folder]));
  const awardMap = new Map(awards.rails.map((route) => [route.key, route]));
  const rails = manifest.rails.filter((rail) => {
    if (rail.materializer !== "award") return false;
    const route = awardMap.get(rail.key);
    return group === "all" || (group === "oscars" && route?.oscarCategory) || (group === "cannes" && route?.cannesCategory) || (group === "globes" && !route?.oscarCategory && !route?.cannesCategory);
  });
  const today = athensDate();
  const results = await mapLimit(rails, 4, async (rail) => {
    try {
      const folderTitle = folderMap.get(rail.folderId)?.title ?? "";
      const candidate = await materializeRail(client, rail, { today, folderTitle, award: awardMap.get(rail.key), authorityOverrides: awards.authorityOverrides ?? {}, nonWorkWinners: awards.nonWorkWinners ?? [] });
      return { key: rail.key, status: "valid", count: candidate.items.length, scope: candidate.scope };
    } catch (error) { return { key: rail.key, status: "failed", error: normalizeText(error.message) ? error.message : String(error) }; }
  });
  const failed = results.filter((result) => result.status === "failed");
  const report = { considered: results.length, valid: results.length - failed.length, failed: failed.length, failures: failed };
  if (failed.length) throw new Error(`Award validation failed for ${failed.length} rails\n${JSON.stringify(report, null, 2)}`);
  return report;
}
