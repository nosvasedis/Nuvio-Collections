import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const inputPath = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node scripts/extract-kaptain-streaming-snapshot.mjs <kaptain-export.json>");
const raw = await fs.readFile(inputPath, "utf8");
const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
const collections = Array.isArray(parsed) ? parsed : Object.values(parsed);
const streaming = collections.find((collection) => collection.title === "Streaming Services");
if (!streaming) throw new Error("Kaptain Streaming Services collection missing");
const targetTitles = ["Netflix", "Disney+", "Apple TV+", "HBO Max", "Prime Video", "Crunchyroll", "Mubi", "Criterion", "Paramount+", "AMC+", "Peacock", "MGM+", "Shudder"];
const artworkFields = ["hideTitle", "tileShape", "coverEmoji", "focusGifUrl", "heroVideoUrl", "titleLogoUrl", "coverImageUrl", "focusGifEnabled", "heroBackdropUrl"];
const folders = {};
for (const title of targetTitles) {
  const folder = streaming.folders.find((candidate) => candidate.title === title);
  if (!folder) throw new Error(`Kaptain streaming folder missing: ${title}`);
  folders[title] = Object.fromEntries([["sourceFolderId", folder.id], ...artworkFields.map((field) => [field, folder[field] ?? (field.endsWith("Url") ? "" : null)])]);
}
const output = { version: 1, source: path.basename(inputPath), sourceSha256: sha256, capturedAt: "2026-08-12", collectionId: streaming.id, collectionTitle: streaming.title, folders };
await fs.writeFile(path.join(root, "data", "kaptain-streaming-v0.90-beta.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ sha256, folders: Object.keys(folders).length }, null, 2));
