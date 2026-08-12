import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const BASE_INPUT_FILE = path.join(ROOT, "nuvio collections v4.5.13 - static-studio-lists-released.json");
export const INPUT_FILE = path.join(ROOT, "data", "nuvio-collections-v5.0.1-source.json");
export const RAILS_FILE = path.join(ROOT, "config", "rails.yml");
export const PROVIDERS_FILE = path.join(ROOT, "config", "providers.yml");
export const AWARDS_FILE = path.join(ROOT, "config", "awards.yml");
export const ACADEMY_AWARDS_SNAPSHOT_FILE = path.join(ROOT, "data", "academy-awards-winners-2026.json");
export const ACADEMY_AWARDS_HONORARY_FILE = path.join(ROOT, "data", "academy-awards-honorary-international.json");
export const CANNES_AWARDS_SNAPSHOT_FILE = path.join(ROOT, "data", "cannes-awards-winners-2026.json");
export const CURATED_STUDIO_FEATURES_FILE = path.join(ROOT, "data", "curated-studio-features.json");
export const FOLDER_SORT_KEYS_FILE = path.join(ROOT, "data", "folder-sort-keys.json");
export const LOCK_FILE = path.join(ROOT, "config", "folders.lock.json");
export const STATE_FILE = path.join(ROOT, "state", "sync-state.json");
export const OUTPUT_FILE = path.join(ROOT, "dist", "nuvio-collections-v5.0.1.json");
export const REPORT_FILE = path.join(ROOT, "reports", "latest.json");
export const PROFILE_AUDIT_REPORT_FILE = path.join(ROOT, "reports", "profile-audit-2026-08-10.json");
export const PROFILE_REPAIR_FILE = path.join(ROOT, "dist", "nuvio-collections-v5.0.1-profile-repair.json");
export const RECOMMENDED_FOLDER_ID = "collections.discover.recommended";
export const RECOMMENDED_CATALOGS = Object.freeze([
  Object.freeze({ type: "movie", genre: "None", addonId: "aio-metadata", catalogId: "movielens.explore.toppicks.msly9zlu" }),
  Object.freeze({ type: "series", genre: "None", addonId: "aio-metadata", catalogId: "simkl.recipe.marathon.shows" }),
]);
export const ALLOWED_MONETIZATION = ["flatrate", "free", "ads"];
export const MATERIALIZED_LIMIT = 200;
export const PERSON_ID_BY_FOLDER = Object.freeze({
  "folder-6VLQPAQY": 1056121, // Ryan Coogler
  "folder-JNAONKLX": 510,     // Tim Burton
  "folder-P3TT53P3": 1,       // George Lucas
});
const EMPTY_EXACT_TMDB_PREDICATE_RAIL_KEYS = [
  "collections.world:folder-1DLH4Q3B:6", "collections.world:folder-1DLH4Q3B:7",
  "collections.world:folder-2DT7DVAT:6", "collections.world:folder-34G8YHUB:6",
  "collections.world:folder-34G8YHUB:7", "collections.world:folder-AK9ECCMJ:3",
  "collections.world:folder-AK9ECCMJ:5", "collections.world:folder-AK9ECCMJ:6",
  "collections.world:folder-AK9ECCMJ:7", "collections.world:folder-BPH7ACF1:6",
  "collections.world:folder-BPH7ACF1:7", "collections.world:folder-D1NICV2Z:6",
  "collections.world:folder-D1NICV2Z:7", "collections.world:folder-DWVPX66N:6",
  "collections.world:folder-F5XQ4UP6:7", "collections.world:folder-KFJI7SS7:6",
  "collections.world:folder-KFJI7SS7:7", "collections.world:folder-MH8C4JIK:3",
  "collections.world:folder-MH8C4JIK:5", "collections.world:folder-MH8C4JIK:6",
  "collections.world:folder-MH8C4JIK:7", "collections.world:folder-OBIM1CC7:6",
  "collections.world:folder-OBIM1CC7:7", "collections.world:folder-U4QLYE75:6",
  "collections.world:folder-U4QLYE75:7", "collections.world:folder-W2F9SBO8:1",
  "collections.world:folder-W2F9SBO8:3", "collections.world:folder-W2F9SBO8:5",
  "collections.world:folder-W2F9SBO8:6", "collections.world:folder-W2F9SBO8:7",
  "collections.world:folder-ZFQ2TA63:7",
  "collections.directors:folder-1VPO8OYE:1", "collections.directors:folder-1VPO8OYE:3",
  "collections.directors:folder-C34MCJNY:1", "collections.directors:folder-C34MCJNY:3",
  "collections.genres:folder-8B3PEI1Y:1", "collections.genres:folder-8B3PEI1Y:7",
  "collections.networks:folder-869XK12L:1",
  "collections.streaming:collections.streaming.apple-tv:29", "collections.streaming:collections.streaming.apple-tv:36",
  "collections.streaming:collections.streaming.paramount-plus:31", "collections.streaming:collections.streaming.peacock:41",
  "collections.streaming:folder-6S0KR2JH:30", "collections.streaming:folder-6S0KR2JH:34",
  "collections.streaming:folder-OKRSGYYC:1", "collections.streaming:folder-OKRSGYYC:13",
  "collections.studios:folder-10146STUDIO:1", "collections.studios:folder-127929STUDIO:1",
  "collections.studios:folder-127929STUDIO:3", "collections.studios:folder-127929STUDIO:5",
  "collections.studios:folder-2KA1KP6V:5", "collections.studios:folder-34STUDIO:1",
  "collections.studios:folder-4OZG50Y4:2", "collections.studios:folder-5VIHLY7Y:1",
  "collections.studios:folder-79DVGTP9:2", "collections.studios:folder-9ZZK6A6C:1",
  "collections.studios:folder-A59XSVAT:1", "collections.studios:folder-BNC84SJ4:1",
  "collections.studios:folder-IAL16XW3:1", "collections.studios:folder-KIRXHA4A:2",
  "collections.studios:folder-KIRXHA4A:6", "collections.studios:folder-V0MRWXHJ:0",
  "collections.studios:folder-V0MRWXHJ:1",
  "collections.world:folder-0J1SF1P8:6", "collections.world:folder-0J1SF1P8:7",
  "collections.world:folder-10NNKWPU:6", "collections.world:folder-10NNKWPU:7",
  "collections.world:folder-U58KOK24:6", "collections.world:folder-U58KOK24:7",
  "collections.world:folder-Z4R165P4:7", "collections.world:folder-Z55EA73B:7",
];
const NO_SUBSTANTIVE_TV_CAST_CREDIT_RAIL_KEYS = [
  "collections.actors:folder-D8PPUHIE:1", "collections.actors:folder-D8PPUHIE:3", "collections.actors:folder-D8PPUHIE:5",
  "collections.actors:folder-ZISLC5VJ:1", "collections.actors:folder-ZISLC5VJ:3", "collections.actors:folder-ZISLC5VJ:5",
];
export const RETIRED_RAIL_REASONS = Object.freeze(new Map([
  ...EMPTY_EXACT_TMDB_PREDICATE_RAIL_KEYS.map((key) => [key, "EMPTY_EXACT_TMDB_PREDICATE"]),
  ...NO_SUBSTANTIVE_TV_CAST_CREDIT_RAIL_KEYS.map((key) => [key, "NO_SUBSTANTIVE_TV_CAST_CREDITS"]),
]));
const APPROVED_STREAMING_REMOVED_RAIL_KEYS = Object.freeze([
  ...Array.from({ length: 45 }, (_, index) => `collections.streaming:collections.streaming.hulu:${index}`),
  ...Array.from({ length: 11 }, (_, index) => `collections.streaming:collections.streaming.discovery-plus:${index}`),
  ...Array.from({ length: 38 }, (_, index) => `collections.streaming:folder-9B3VK7AU:${index}`),
]);
export const CATALOG_REMOVED_RAIL_REASONS = Object.freeze(new Map([
  ["collections.genres:folder-KQEZGAMF:0", "USER_APPROVED_REALITY_REMOVAL"],
  ["collections.genres:folder-KQEZGAMF:1", "USER_APPROVED_REALITY_REMOVAL"],
  ["collections.genres:folder-KQEZGAMF:2", "USER_APPROVED_REALITY_REMOVAL"],
  ["collections.genres:folder-KQEZGAMF:3", "USER_APPROVED_REALITY_REMOVAL"],
  ...APPROVED_STREAMING_REMOVED_RAIL_KEYS.map((key) => [key, "USER_APPROVED_STREAMING_REPLACEMENT_2026_08_12"]),
]));
export const EXPECTED = Object.freeze({
  collections: 13, folders: 548, inputSources: 2745, managedInputSources: 2743,
  finalSources: 2677, managedFinalSources: 2675, recommendedSources: 2,
  native: 396, materialized: 2279, retiredRails: 77, catalogRemovedRails: 98,
});
export const EXPECTED_MAPPING = Object.freeze({
  "collections.discover": [0, 12], "collections.streaming": [0, 455],
  "collections.genres": [0, 192], "collections.film-series": [186, 0],
  "collections.moods": [0, 60],
  "collections.studios": [0, 107], "collections.networks": [30, 29],
  "collections.actors": [0, 744], "collections.directors": [0, 186],
  "collections.awards": [0, 60], "collections.world": [0, 424],
  "collections.decades": [180, 6], "collections.runtime": [0, 4],
});

export const COUNTRY_BY_FOLDER = Object.freeze({
  "folder-1DLH4Q3B": "DZ", "folder-WCOQJ028": "CA", "folder-D1NICV2Z": "AE",
  "folder-W2F9SBO8": "ET", "folder-AK9ECCMJ": "GH", "folder-VBBN438M": "IQ",
  "folder-2DT7DVAT": "IL", "folder-BPH7ACF1": "JO", "folder-U4QLYE75": "KE",
  "folder-DWVPX66N": "LB", "folder-F5XQ4UP6": "MA", "folder-MH8C4JIK": "NP",
  "folder-OBIM1CC7": "PK", "folder-ZP0ZUNHA": "SA", "folder-34G8YHUB": "SN",
  "folder-KFJI7SS7": "LK", "folder-ZFQ2TA63": "TN", "folder-CHLCSAJ1": "US",
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
  "collections.world.portuguese": "PT",
  "collections.world.latin-american": "MX|GT|HN|SV|NI|CR|PA|CU|DO|PR|CO|VE|EC|PE|BO|PY|UY|AR|CL|BR",
});

export const PROVIDER_SEEDS = Object.freeze([
  ["netflix", "Netflix", ["Netflix"]], ["disney-plus", "Disney+", ["Disney Plus"]],
  ["apple-tv", "Apple TV+", ["Apple TV Plus"]], ["hbo-max", "HBO Max", ["Max", "HBO Max"]],
  ["prime-video", "Prime Video", ["Amazon Prime Video"]],
  ["crunchyroll", "Crunchyroll", ["Crunchyroll"]],
  ["mubi", "MUBI", ["MUBI"]], ["criterion", "Criterion", ["Criterion Channel"]],
  ["paramount-plus", "Paramount+", ["Paramount Plus"]],
  ["amc-plus", "AMC+", ["AMC+", "Sundance Now", "Acorn TV"]],
  ["peacock", "Peacock", ["Peacock Premium", "Peacock Premium Plus"]],
  ["mgm-plus", "MGM+", ["MGM Plus"]], ["shudder", "Shudder", ["Shudder"]],
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
