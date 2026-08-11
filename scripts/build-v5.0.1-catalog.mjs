import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const basePath = path.join(root, "nuvio collections v4.5.13 - static-studio-lists-released.json");
const outputPath = path.join(root, "data", "nuvio-collections-v5.0.1-source.json");
const kaptainUrl = "https://imkaptain.github.io/Kaptain-Collection/collections/database.js?v=47";
const kaptainSha256 = "d9368757d26b8febfb973ca75746ce5cf35a35e62f897fa9b60e78a343014765";

const response = await fetch(kaptainUrl, { headers: { "User-Agent": "Nuvio-Collections-v5.0.1" } });
if (!response.ok) throw new Error(`Kaptain database fetch failed: ${response.status}`);
const script = await response.text();
const actualSha256 = crypto.createHash("sha256").update(script).digest("hex");
if (actualSha256 !== kaptainSha256) throw new Error(`Kaptain v47 snapshot drifted: expected ${kaptainSha256}, got ${actualSha256}`);
const live = JSON.parse(script.replace(/^window\.NUVIO_DATABASE\s*=\s*/, "").replace(/;\s*$/, ""));
const base = JSON.parse(await fs.readFile(basePath, "utf8"));
const byTitle = new Map(live.map((collection) => [collection.title, collection]));
for (const title of ["Genres", "Moods & Vibes", "International Cinema"]) if (!byTitle.has(title)) throw new Error(`Kaptain collection missing: ${title}`);

function source(title, mediaType, sortBy, filters = {}, discoverPolicy = null) {
  return {
    type: mediaType === "TV" ? "series" : "movie", genre: title, title, sortBy,
    tmdbId: null, addonId: null, filters, sortHow: null, provider: "tmdb",
    catalogId: null, mediaType, traktListId: null, tmdbSourceType: "DISCOVER",
    explicitSemantic: true, ...(discoverPolicy ? { discoverPolicy } : {}),
  };
}

function standardEight({ originCountry = null, withGenres = null, withKeywords = null, moviePopularVotes = 200, tvPopularVotes = 100, allowQuorumFallback = false }) {
  const filters = (extra = {}) => ({ ...(originCountry ? { withOriginCountry: originCountry } : {}), ...(withGenres ? { withGenres } : {}), ...(withKeywords ? { withKeywords } : {}), ...extra });
  return [
    source("Νέες ταινίες", "MOVIE", "primary_release_date.desc", filters({ voteCountGte: 10 })),
    source("Νέες σειρές", "TV", "first_air_date.desc", filters({ voteCountGte: 10 })),
    source("Δημοφιλείς ταινίες", "MOVIE", "popularity.desc", filters({ voteCountGte: moviePopularVotes }), { kind: "popular", allowQuorumFallback }),
    source("Δημοφιλείς σειρές", "TV", "popularity.desc", filters({ voteCountGte: tvPopularVotes }), { kind: "popular", allowQuorumFallback }),
    source("Κορυφαίες ταινίες όλων των εποχών", "MOVIE", "vote_average.desc", filters({ voteCountGte: Math.max(100, moviePopularVotes) }), { kind: "top_all_time", voteCountGte: Math.max(100, moviePopularVotes), allowQuorumFallback }),
    source("Κορυφαίες σειρές όλων των εποχών", "TV", "vote_average.desc", filters({ voteCountGte: Math.max(50, tvPopularVotes) }), { kind: "top_all_time", voteCountGte: Math.max(50, tvPopularVotes), allowQuorumFallback }),
    source("Κορυφαίες ταινίες της χρονιάς", "MOVIE", "vote_average.desc", filters({ voteCountGte: 10 }), { kind: "top_year", voteCountGte: 10, allowQuorumFallback }),
    source("Κορυφαίες σειρές της χρονιάς", "TV", "vote_average.desc", filters({ voteCountGte: 10 }), { kind: "top_year", voteCountGte: 10, allowQuorumFallback }),
  ];
}

const genreCollection = base.find((collection) => collection.id === "collections.genres");
if (!genreCollection) throw new Error("Canonical Genres collection missing");
const reality = genreCollection.folders.find((folder) => folder.id === "folder-KQEZGAMF");
if (!reality || reality.sources.length !== 4) throw new Error("Reviewed Reality folder drifted");
genreCollection.folders = genreCollection.folders.filter((folder) => folder.id !== reality.id);

const liveGenres = byTitle.get("Genres");
const genreAdditions = [
  {
    liveId: "folder-KDRAMA01", title: "Κορεατικά δράματα (K-Drama)",
    sources: standardEight({ originCountry: "KR", withGenres: "18", moviePopularVotes: 200, tvPopularVotes: 200 }),
  },
  {
    liveId: "folder-d1d8a13d", title: "Ρομαντική κομεντί",
    sources: standardEight({ withGenres: "10749,35", moviePopularVotes: 500, tvPopularVotes: 200 }).map((item) => item.mediaType === "TV"
      ? { ...item, filters: { ...item.filters, withGenres: undefined, withKeywords: "9799" } }
      : item),
  },
];
for (const addition of genreAdditions) {
  const liveFolder = liveGenres.folders.find((folder) => folder.id === addition.liveId);
  if (!liveFolder) throw new Error(`Kaptain genre missing: ${addition.liveId}`);
  genreCollection.folders.push({ ...structuredClone(liveFolder), title: addition.title, sources: addition.sources, catalogSources: [] });
}
genreCollection.folders.sort((a, b) => a.title.localeCompare(b.title, "el"));

const moodTitles = {
  "folder-W52X6SMF": ["Ζεστά & παρηγορητικά", ["Ρομαντικές κομεντί ζωντανής δράσης", "Ζεστές κωμικές και δραματικές σειρές", "Τρυφερές ρομαντικές ιστορίες", "Κορυφαία feel-good κλασικά", "Αγαπημένα ζεστά κινούμενα σχέδια", "Πρόσφατες ζεστές ταινίες"]],
  "folder-7TSDBZYI": ["Παιχνίδια του μυαλού", ["Ανατρεπτικά θρίλερ επιστημονικής φαντασίας", "Ψυχολογικές σειρές μυστηρίου", "Απρόβλεπτες ταινίες με ανατροπές", "Χρονικοί βρόχοι & εναλλακτικές πραγματικότητες", "Κορυφαία ψυχολογικά θρίλερ", "Πρόσφατες ανατρεπτικές ταινίες"]],
  "folder-S21P049B": ["Έκρηξη αδρεναλίνης", ["Καταιγιστικά action blockbusters", "Ταινίες επιβίωσης & ληστειών", "Σειρές δράσης & θρίλερ", "Πολεμικές τέχνες & μάχες", "Κορυφαίες επιτυχίες δράσης", "Πρόσφατες καταιγιστικές ταινίες"]],
  "folder-070BQVHR": ["Επικά & μεγαλειώδη", ["Ιστορικά & πολεμικά έπη", "Μεγαλειώδη έπη φαντασίας", "Τηλεοπτικά έπη μεγάλης κλίμακας", "Διαστημικές όπερες & κοσμικά ταξίδια", "Κορυφαία επικά αριστουργήματα", "Πρόσφατες επικές ταινίες"]],
  "folder-7AXTM9QX": ["Ανεβαστικά & αισιόδοξα", ["Ανεβαστικές & εμπνευσμένες ταινίες", "Χαρούμενες κωμικές σειρές", "Εμπνευσμένες αληθινές ιστορίες", "Road trips & κωμωδίες φίλων", "Κορυφαία feel-good κλασικά", "Πρόσφατες feel-good ταινίες"]],
  "folder-RSVZ5OM5": ["Αργής καύσης", ["Ατμοσφαιρικά μυστήρια αργής καύσης", "Στοιχειωτικές σειρές αργής καύσης", "Neo-noir & σκοτεινό έγκλημα", "Βαθιά δράματα χαρακτήρων", "Κορυφαία ατμοσφαιρικά αριστουργήματα", "Πρόσφατες ταινίες αργής καύσης"]],
  "folder-SJGV86EH": ["Δακρύβρεχτα", ["Καταξιωμένες συγκινητικές ταινίες", "Συναισθηματικές σειρές", "Ρομαντικές ιστορίες ραγισμένης καρδιάς", "Ιστορίες οικογένειας & απώλειας", "Κορυφαία συναισθηματικά αριστουργήματα", "Πρόσφατες συγκινητικές ταινίες"]],
  "folder-VRAANHHD": ["Ατμόσφαιρα '80s & '90s", ["Εμβληματικά blockbusters των '80s", "Εμβληματικά blockbusters των '90s", "Popcorn δράση των '80s & '90s", "Κλασικές κωμωδίες των '80s & '90s", "Ρετρό σειρές επιστημονικής φαντασίας & μυστηρίου", "Cult & indie επιτυχίες των '90s"]],
  "folder-M50463BF": ["Σκοτεινά & σκληρά", ["Σκληρό έγκλημα & υπόκοσμος", "Έντονες σκοτεινές σειρές", "Αντιήρωες & ιστορίες εκδίκησης", "Δυστοπικά & μεταποκαλυπτικά", "Κορυφαίο σκληρό έγκλημα", "Πρόσφατες σκοτεινές & σκληρές ταινίες"]],
  "folder-79A8YOOM": ["Ανατριχιαστικά & απόκοσμα", ["Στοιχειωμένα σπίτια & φαντάσματα", "Απόκοσμες παραφυσικές σειρές", "Ψυχολογικός τρόμος & αγωνία", "Τέρατα & πλάσματα", "Κορυφαία αριστουργήματα τρόμου", "Πρόσφατες ανατριχιαστικές ταινίες"]],
};

const liveMoods = byTitle.get("Moods & Vibes");
const moodFolders = liveMoods.folders.map((folder) => {
  const translation = moodTitles[folder.id];
  if (!translation || folder.sources.length !== 6) throw new Error(`Unreviewed Mood folder: ${folder.id}`);
  const sources = folder.sources.map((item, index) => {
    const filters = { ...(item.filters ?? {}) };
    delete filters.withOriginalLanguage; delete filters["vote_count.gte"];
    filters.voteCountGte ??= item.mediaType === "TV" ? 50 : 100;
    if (folder.id !== "folder-VRAANHHD") { delete filters.releaseDateGte; delete filters.releaseDateLte; }
    const title = translation[1][index];
    const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("el");
    const policy = normalized.includes("κορυφ") ? { kind: "top_all_time", voteCountGte: filters.voteCountGte }
      : normalized.includes("προσφα") ? { kind: "recent", preserveVoteQuorum: true }
        : normalized.includes("εμβληματικ") || normalized.includes("popcorn") || normalized.includes("κλασικ") || normalized.includes("ρετρο") || normalized.includes("cult") ? { kind: "fixed_period", preserveVoteQuorum: true }
          : { kind: "thematic", preserveVoteQuorum: true };
    return source(title, item.mediaType, item.sortBy === "original" ? "popularity.desc" : item.sortBy, filters, policy);
  });
  return { ...structuredClone(folder), title: translation[0], sources, catalogSources: [] };
}).sort((a, b) => a.title.localeCompare(b.title, "el"));

const moodCollection = {
  ...structuredClone(liveMoods), id: "collections.moods", title: "✨ Διάθεση & Ατμόσφαιρα",
  folders: moodFolders, pinToTop: false, showAllTab: true, focusGlowEnabled: true,
};
const filmSeriesIndex = base.findIndex((collection) => collection.id === "collections.film-series");
if (filmSeriesIndex < 0 || base.some((collection) => collection.id === moodCollection.id)) throw new Error("Mood insertion point invalid");
base.splice(filmSeriesIndex + 1, 0, moodCollection);

const countryAdditions = {
  "folder-1DLH4Q3B": ["Αλγερινές", "DZ"], "folder-WCOQJ028": ["Καναδικές", "CA"],
  "folder-D1NICV2Z": ["Εμιρατινές", "AE"], "folder-W2F9SBO8": ["Αιθιοπικές", "ET"],
  "folder-AK9ECCMJ": ["Γκανέζικες", "GH"], "folder-VBBN438M": ["Ιρακινές", "IQ"],
  "folder-2DT7DVAT": ["Ισραηλινές", "IL"], "folder-BPH7ACF1": ["Ιορδανικές", "JO"],
  "folder-U4QLYE75": ["Κενυάτικες", "KE"], "folder-DWVPX66N": ["Λιβανέζικες", "LB"],
  "folder-F5XQ4UP6": ["Μαροκινές", "MA"], "folder-MH8C4JIK": ["Νεπαλέζικες", "NP"],
  "folder-OBIM1CC7": ["Πακιστανικές", "PK"], "folder-ZP0ZUNHA": ["Σαουδαραβικές", "SA"],
  "folder-34G8YHUB": ["Σενεγαλέζικες", "SN"], "folder-KFJI7SS7": ["Σριλανκέζικες", "LK"],
  "folder-ZFQ2TA63": ["Τυνησιακές", "TN"], "folder-CHLCSAJ1": ["Αμερικανικές (ΗΠΑ)", "US"],
};
const liveWorld = byTitle.get("International Cinema");
const world = base.find((collection) => collection.id === "collections.world");
if (!world) throw new Error("Canonical World collection missing");
for (const [id, [title, country]] of Object.entries(countryAdditions)) {
  const liveFolder = liveWorld.folders.find((folder) => folder.id === id);
  if (!liveFolder) throw new Error(`Kaptain country missing: ${id}`);
  world.folders.push({ ...structuredClone(liveFolder), title, sources: standardEight({ originCountry: country, moviePopularVotes: 25, tvPopularVotes: 10, allowQuorumFallback: true }), catalogSources: [] });
}
world.folders.sort((a, b) => a.title.localeCompare(b.title, "el"));

await fs.writeFile(outputPath, `${JSON.stringify(base, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputPath, collections: base.length, folders: base.flatMap((c) => c.folders).length, sources: base.flatMap((c) => c.folders).flatMap((f) => f.sources).length, removedRealityListIds: [8681927, 8681928, 8681929, 8681930], kaptainUrl }, null, 2));
