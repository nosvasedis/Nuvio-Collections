import path from "node:path";
import { OUTPUT_FILE, PROFILE_AUDIT_REPORT_FILE, PROFILE_REPAIR_FILE } from "./constants.mjs";
import { readJson, writeJson, invariant } from "./utils.mjs";
import { emulateNuvio083MediaType, expectedNuvioType } from "./media-contract.mjs";

function sourceIdentity(source) {
  const provider = source.provider ?? "addon";
  if (provider === "tmdb") return [provider, source.tmdbSourceType, source.tmdbId ?? "", source.title ?? ""].join("|");
  if (provider === "trakt") return [provider, source.traktListId ?? "", source.title ?? ""].join("|");
  return [provider, source.addonId ?? "", source.type ?? "", source.catalogId ?? "", source.genre ?? ""].join("|");
}

function indexCollections(collections) {
  return new Map(collections.map((collection) => [collection.id, collection]));
}

export function compareProfile(profile, canonical) {
  invariant(Array.isArray(profile) && Array.isArray(canonical), "Profile and canonical artifacts must be JSON arrays");
  const profileCollections = indexCollections(profile), mismatches = [], missing = [], extra = [];
  const affectedCollectionIds = new Set();
  for (const collection of canonical) {
    const storedCollection = profileCollections.get(collection.id);
    if (!storedCollection) {
      missing.push({ collectionId: collection.id, kind: "collection" });
      affectedCollectionIds.add(collection.id);
      continue;
    }
    const storedFolders = new Map((storedCollection.folders ?? []).map((folder) => [folder.id, folder]));
    for (const folder of collection.folders ?? []) {
      const storedFolder = storedFolders.get(folder.id);
      if (!storedFolder) {
        missing.push({ collectionId: collection.id, folderId: folder.id, kind: "folder" });
        affectedCollectionIds.add(collection.id);
        continue;
      }
      const storedSources = new Map((storedFolder.sources ?? []).map((source) => [sourceIdentity(source), source]));
      for (const source of folder.sources ?? []) {
        const identity = sourceIdentity(source), stored = storedSources.get(identity);
        if (!stored) {
          missing.push({ collectionId: collection.id, folderId: folder.id, kind: "source", identity, title: source.title ?? null });
          affectedCollectionIds.add(collection.id);
          continue;
        }
        const managed = source.provider === "tmdb" || source.provider === "trakt";
        if (managed) {
          const expectedType = expectedNuvioType(source.mediaType), storedMediaType = emulateNuvio083MediaType(stored);
          if (stored.type !== expectedType || storedMediaType !== source.mediaType) {
            mismatches.push({ collectionId: collection.id, folderId: folder.id, identity, title: source.title ?? null, tmdbId: source.tmdbId ?? null, canonical: { type: expectedType, mediaType: source.mediaType }, profile: { type: stored.type ?? null, mediaType: stored.mediaType ?? null } });
            affectedCollectionIds.add(collection.id);
          }
        }
        storedSources.delete(identity);
      }
      for (const [identity, source] of storedSources) extra.push({ collectionId: collection.id, folderId: folder.id, kind: "source", identity, title: source.title ?? null });
      storedFolders.delete(folder.id);
    }
    for (const folder of storedFolders.values()) extra.push({ collectionId: collection.id, folderId: folder.id, kind: "folder" });
    profileCollections.delete(collection.id);
  }
  for (const collection of profileCollections.values()) extra.push({ collectionId: collection.id, kind: "collection" });
  const collectionIds = new Set([...mismatches, ...missing, ...extra].map((item) => item.collectionId));
  const byCollection = Object.fromEntries([...collectionIds].sort().map((collectionId) => [collectionId, {
    mediaTypeMismatches: mismatches.filter((item) => item.collectionId === collectionId).length,
    missing: missing.filter((item) => item.collectionId === collectionId).length,
    extra: extra.filter((item) => item.collectionId === collectionId).length,
    repairRequired: affectedCollectionIds.has(collectionId),
  }]));
  return {
    version: 1,
    totals: { canonicalCollections: canonical.length, profileCollections: profile.length, mediaTypeMismatches: mismatches.length, missing: missing.length, extra: extra.length, repairCollections: affectedCollectionIds.size },
    affectedCollectionIds: [...affectedCollectionIds], byCollection, mismatches, missing, extra,
  };
}

export async function auditProfile({ profileFile, artifactFile = OUTPUT_FILE, writeArtifacts = false } = {}) {
  invariant(profileFile, "profile-audit requires --profile=<Nuvio export JSON>");
  const [profile, canonical] = await Promise.all([readJson(path.resolve(profileFile)), readJson(path.resolve(artifactFile))]);
  const report = compareProfile(profile, canonical);
  if (writeArtifacts) {
    const affected = new Set(report.affectedCollectionIds);
    const repair = canonical.filter((collection) => affected.has(collection.id));
    await writeJson(PROFILE_AUDIT_REPORT_FILE, report);
    await writeJson(PROFILE_REPAIR_FILE, repair);
  }
  return { ...report.totals, report: writeArtifacts ? PROFILE_AUDIT_REPORT_FILE : null, repair: writeArtifacts ? PROFILE_REPAIR_FILE : null };
}
