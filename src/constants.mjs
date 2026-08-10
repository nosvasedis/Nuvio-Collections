import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const INPUT_FILE = path.join(ROOT, "nuvio collections v4.5.13 - static-studio-lists-released.json");
export const RAILS_FILE = path.join(ROOT, "config", "rails.yml");
export const PROVIDERS_FILE = path.join(ROOT, "config", "providers.yml");
export const AWARDS_FILE = path.join(ROOT, "config", "awards.yml");
export const ACADEMY_AWARDS_SNAPSHOT_FILE = path.join(ROOT, "data", "academy-awards-winners-2026.json");
export const ACADEMY_AWARDS_HONORARY_FILE = path.join(ROOT, "data", "academy-awards-honorary-international.json");
export const CANNES_AWARDS_SNAPSHOT_FILE = path.join(ROOT, "data", "cannes-awards-winners-2026.json");
export const LOCK_FILE = path.join(ROOT, "config", "folders.lock.json");
export const STATE_FILE = path.join(ROOT, "state", "sync-state.json");
export const OUTPUT_FILE = path.join(ROOT, "dist", "nuvio-collections.json");
export const REPORT_FILE = path.join(ROOT, "reports", "latest.json");
export const RECOMMENDED_FOLDER_ID = "collections.discover.recommended";
export const ALLOWED_MONETIZATION = ["flatrate", "free", "ads"];
export const MATERIALIZED_LIMIT = 200;
export const PERSON_ID_BY_FOLDER = Object.freeze({
  "folder-6VLQPAQY": 1056121, // Ryan Coogler
  "folder-JNAONKLX": 510,     // Tim Burton
  "folder-P3TT53P3": 1,       // George Lucas
});
export const EXPECTED = Object.freeze({
  collections: 12, folders: 517, inputSources: 2516, managedInputSources: 2514,
  finalSources: 2525, managedFinalSources: 2523, recommendedSources: 2,
  native: 398, materialized: 2125,
});
export const EXPECTED_MAPPING = Object.freeze({
  "collections.discover": [2, 10], "collections.streaming": [0, 465],
  "collections.genres": [0, 182], "collections.film-series": [186, 0],
  "collections.studios": [0, 124], "collections.networks": [30, 30],
  "collections.actors": [0, 750], "collections.directors": [0, 190],
  "collections.awards": [0, 60], "collections.world": [0, 304],
  "collections.decades": [180, 6], "collections.runtime": [0, 4],
});

export const COUNTRY_BY_FOLDER = Object.freeze({
  "folder-0ZI700NE": "EG", "folder-5IS5EIVV": "AR", "folder-TRWE0E34": "AU",
  "folder-2YV5HI8I": "BE", "folder-10NNKWPU": "VN", "folder-VLTMKACY": "BR",
  "folder-BICUTNJY": "GB", "collections.world.french": "FR",
  "collections.world.german": "DE", "folder-XJ6HNL6G": "DK",
  "collections.world.greek": "GR", "collections.world.japanese": "JP",
  "collections.world.indian": "IN", "folder-UJU5PHHC": "ID",
  "folder-9EYEPU66": "IE", "folder-U58KOK24": "IS",
  "collections.world.spanish": "ES", "collections.world.italian": "IT",
  "collections.world.chinese": "CN", "folder-5069W7D9": "CO",
  "collections.world.korean": "KR", "folder-F4SMGZBV": "MX",
  "folder-Z55EA73B": "BD", "folder-0J1SF1P8": "NG", "folder-TT3MZNJE": "NO",
  "folder-8XVOQGAJ": "ZA", "folder-V9HNQAV1": "NL", "folder-Z4R165P4": "IR",
  "folder-RESMLEJZ": "PL", "collections.world.russian": "RU",
  "folder-MV0AT0KN": "SE", "folder-CNVEC5EE": "TW", "folder-Y0KO0JXK": "TH",
  "collections.world.turkish": "TR", "folder-FVCF354Y": "PH",
  "folder-5U334FWO": "FI", "folder-FI6BJN1Z": "CL", "folder-369A49J9": "HK",
});

export const PROVIDER_SEEDS = Object.freeze([
  ["netflix", "Netflix", ["Netflix"]], ["disney-plus", "Disney+", ["Disney Plus"]],
  ["prime-video", "Prime Video", ["Amazon Prime Video"]],
  ["apple-tv", "Apple TV", ["Apple TV Plus"]], ["hbo-max", "HBO Max", ["Max", "HBO Max"]],
  ["hulu", "Hulu", ["Hulu"]], ["paramount-plus", "Paramount+", ["Paramount Plus"]],
  ["peacock", "Peacock", ["Peacock Premium", "Peacock Premium Plus"]],
  ["crunchyroll", "Crunchyroll", ["Crunchyroll"]],
  ["discovery-plus", "Discovery+", ["Discovery+"]], ["mgm-plus", "MGM+", ["MGM Plus"]],
  ["shudder", "Shudder", ["Shudder"]], ["starz", "Starz", ["Starz"]],
]);

export const AWARD_SEEDS = Object.freeze({
  "folder-13a3da42": { awardId: 1, slug: "academy-awards" },
  "folder-47ec917f": { awardId: 4, slug: "the-golden-globe-awards" },
  "folder-4ee02f67": { awardId: 59, slug: "festival-de-cannes" },
});

export const AWARD_CATEGORY_SEEDS = Object.freeze({
  "folder-13a3da42": [[1,"best-picture"],[8,"best-adapted-screenplay"],[9,"best-animated-feature"],[14,"best-animated-short-film"],[19,"best-cinematography"],[11,"best-documentary-feature-film"],[12,"best-documentary-short-film"],[22,"best-film-editing"],[10,"best-international-feature"],[13,"best-live-action-short-film"],[15,"best-original-score"],[7,"best-original-screenplay"],[16,"best-original-song"],[3,"best-actor"],[5,"best-supporting-actor"],[4,"best-actress"],[6,"best-supporting-actress"],[18,"best-production-design"],[25,"best-sound-editing"],[17,"best-sound"],[23,"best-visual-effects"],[23,"best-visual-effects"]],
  "folder-47ec917f": [[7,"best-motion-picture-drama"],[42,"best-television-series-drama"],[46,"best-performance-by-a-male-actor-in-a-television-series-drama"],[45,"best-performance-by-a-female-actor-in-a-television-series-drama"],[15,"best-actress-in-a-motion-picture-musical-or-comedy"],[13,"best-actor-in-a-motion-picture-musical-or-comedy"],[8,"best-motion-picture-musical-or-comedy"],[43,"best-television-series-musical-or-comedy"],[49,"best-performance-by-a-male-actor-in-a-television-series-musical-or-comedy"],[47,"best-performance-by-a-female-actor-in-a-television-series-musical-or-comedy"],[20,"best-song-motion-picture"],[19,"best-score-motion-picture"],[16,"best-screenplay-motion-picture"],[5,"best-performance-by-an-actress-in-a-supporting-role-in-a-motion-picture"],[4,"best-performance-by-an-actor-in-a-supporting-role-in-a-motion-picture"],[14,"best-actress-in-a-motion-picture-drama"],[12,"best-actor-in-a-motion-picture-drama"],[6,"best-director-motion-picture"],[9,"best-motion-picture-foreign-language"],[10,"best-motion-picture-animated"],[44,"best-television-limited-series-anthology-series-or-motion-picture-made-for-television"],[51,"best-performance-by-a-male-actor-in-a-limited-series-anthology-series-or-motion-picture-made-for-television"],[48,"best-performance-by-a-female-actor-in-a-limited-series-anthology-series-or-motion-picture-made-for-television"],[60,"best-performance-by-an-actor-in-a-supporting-role-in-a-series-limited-series-or-motion-picture-made-for-television"],[61,"best-performance-by-an-actress-in-a-supporting-role-in-a-series-limited-series-or-motion-picture-made-for-television"]],
  "folder-4ee02f67": [],
});

export const CANNES_CATEGORY_SEEDS = Object.freeze([
  "palme_feature", "palme_short", "grand_prix", "jury_prize",
  "director", "actor", "actress", "screenplay",
]);
export const OSCAR_CATEGORY_SEEDS = Object.freeze([
  "picture", "adapted_screenplay", "animated_feature", "animated_short", "cinematography",
  "documentary_feature", "documentary_short", "editing", "international", "live_action_short",
  "score", "original_screenplay", "song", "actor", "supporting_actor", "actress",
  "supporting_actress", "production_design", "sound_editing", "sound", "special_effects", "visual_effects",
]);
export const NON_WORK_AWARD_WINNERS = Object.freeze([
  "1962:globes:46:bob newhart",
  "1962:globes:45:pauline fredericks",
]);
