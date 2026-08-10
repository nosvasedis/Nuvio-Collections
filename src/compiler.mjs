import { INPUT_FILE, RAILS_FILE, STATE_FILE, OUTPUT_FILE, RECOMMENDED_FOLDER_ID, EXPECTED } from "./constants.mjs";
import { readJson, writeJson, clone, invariant } from "./utils.mjs";
import { auditRepository } from "./validate.mjs";

export function listSource(rail, listId) {
  return { type: rail.mediaType === "TV" ? "series" : "movie", genre: null, title: rail.title, sortBy: "original", tmdbId: Number(listId), addonId: null, filters: {}, sortHow: null, provider: "tmdb", catalogId: null, mediaType: rail.mediaType, traktListId: null, tmdbSourceType: "LIST" };
}

export async function compile({ allowPlaceholders = false } = {}) {
  await auditRepository({ requireListIds: !allowPlaceholders });
  const [input, manifest, state] = await Promise.all([readJson(INPUT_FILE), readJson(RAILS_FILE), readJson(STATE_FILE)]);
  const output = clone(input);
  const grouped = Map.groupBy(manifest.rails, (rail) => rail.folderId);
  for (const collection of output) for (const folder of collection.folders) {
    if (folder.id === RECOMMENDED_FOLDER_ID) continue;
    const rails = grouped.get(folder.id).toSorted((a, b) => a.position - b.position);
    invariant(rails, `No manifest rails for ${folder.id}`);
    folder.sources = rails.map((rail) => {
      if (rail.strategy === "native") {
        const source = clone(rail.originalSource);
        if (source.provider === "tmdb") source.type = rail.mediaType === "TV" ? "series" : "movie";
        return source;
      }
      // Production output must only use an authenticated, successfully synced
      // list from state; manifest list IDs can be third-party legacy inputs.
      const id = state.rails[rail.key]?.listId;
      if (!id && allowPlaceholders) return listSource(rail, 0);
      invariant(id, `Missing list ID: ${rail.key}`);
      return listSource(rail, id);
    });
    if (Array.isArray(folder.catalogSources)) folder.catalogSources = [];
  }
  invariant(output.flatMap((c) => c.folders).length === EXPECTED.folders, "Compiler changed folder count");
  invariant(output.flatMap((c) => c.folders).flatMap((f) => f.sources).length === EXPECTED.finalSources, "Compiler source count failed");
  const target = allowPlaceholders ? OUTPUT_FILE.replace(/\.json$/, ".preview.json") : OUTPUT_FILE;
  await writeJson(target, output);
  return { output: target, sources: EXPECTED.finalSources };
}
