import { useState, useEffect } from "react";

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// ── Levenshtein ───────────────────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// ── Jaro-Winkler ──────────────────────────────────────────────────────────────
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  const l1 = s1.length, l2 = s2.length;
  const matchDist = Math.floor(Math.max(l1, l2) / 2) - 1;
  if (matchDist < 0) return 0;
  const s1m = new Array(l1).fill(false), s2m = new Array(l2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < l1; i++) {
    const start = Math.max(0, i - matchDist), end = Math.min(i + matchDist + 1, l2);
    for (let j = start; j < end; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  for (let i = 0; i < l1; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches/l1 + matches/l2 + (matches - transpositions/2)/matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(l1, l2)); i++) { if (s1[i] !== s2[i]) break; prefix++; }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ── Token-sort ────────────────────────────────────────────────────────────────
function tokenSort(a, b) {
  const ta = normalize(a).split(" ").sort().join(" ");
  const tb = normalize(b).split(" ").sort().join(" ");
  return jaroWinkler(ta, tb);
}

// ── N-gram similarity (trigrams) ──────────────────────────────────────────────
function ngrams(s, n = 3) {
  const padded = " ".repeat(n - 1) + s + " ".repeat(n - 1);
  const result = new Set();
  for (let i = 0; i <= padded.length - n; i++) result.add(padded.slice(i, i + n));
  return result;
}

function ngramSimilarity(a, b, n = 3) {
  if (!a || !b) return 0;
  const ga = ngrams(a, n), gb = ngrams(b, n);
  let intersection = 0;
  for (const g of ga) if (gb.has(g)) intersection++;
  return (2 * intersection) / (ga.size + gb.size);
}

// ── Double Metaphone (förenklad implementation) ───────────────────────────────
// Fonetisk kodning – "Mohammed" och "Muhammad" får samma/liknande kod
function doubleMetaphone(str) {
  if (!str) return ["", ""];
  const s = normalize(str).toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return ["", ""];

  let primary = "", secondary = "";
  let i = 0;
  const len = s.length;
  const at = (idx) => (idx >= 0 && idx < len) ? s[idx] : "";
  const substr = (start, length) => s.slice(start, start + length);
  const add = (p, sec = null) => { primary += p; secondary += (sec !== null ? sec : p); };
  const isVowel = (c) => "AEIOU".includes(c);

  // Hoppa över initiala icke-bokstäver
  if ("GN KN PN AE WR".split(" ").some(v => substr(0, 2) === v)) i = 1;
  if (at(0) === "X") { add("S"); i = 1; }

  while (i < len) {
    const c = at(i);

    if (isVowel(c)) {
      if (i === 0) add("A");
      i++; continue;
    }

    switch (c) {
      case "B": add("P"); i += (at(i+1) === "B") ? 2 : 1; break;
      case "C":
        if (substr(i, 4) === "CHIA") { add("K"); i += 2; break; }
        if (substr(i, 2) === "CH") {
          add("X", "K"); i += 2; break;
        }
        if ("EIY".includes(at(i+1))) { add("S"); i += 2; break; }
        add("K"); i++; break;
      case "D":
        if (substr(i, 2) === "DG" && "IEY".includes(at(i+2))) { add("J"); i += 3; break; }
        add("T"); i += (substr(i, 2) === "DD") ? 2 : 1; break;
      case "F": add("F"); i += (at(i+1) === "F") ? 2 : 1; break;
      case "G":
        if (at(i+1) === "H" && !isVowel(at(i+2))) { i += 2; break; }
        if ("EIY".includes(at(i+1))) { add("K", "J"); i += 2; break; }
        add("K"); i += (at(i+1) === "G") ? 2 : 1; break;
      case "H":
        if (isVowel(at(i+1)) && (i === 0 || !isVowel(at(i-1)))) add("H");
        i++; break;
      case "J": add("J", "H"); i++; break;
      case "K": add("K"); i += (at(i+1) === "K") ? 2 : 1; break;
      case "L": add("L"); i += (at(i+1) === "L") ? 2 : 1; break;
      case "M": add("M"); i += (at(i+1) === "M") ? 2 : 1; break;
      case "N": add("N"); i += (at(i+1) === "N") ? 2 : 1; break;
      case "P":
        if (at(i+1) === "H") { add("F"); i += 2; break; }
        add("P"); i += (at(i+1) === "P") ? 2 : 1; break;
      case "Q": add("K"); i += (at(i+1) === "Q") ? 2 : 1; break;
      case "R": add("R"); i += (at(i+1) === "R") ? 2 : 1; break;
      case "S":
        if (substr(i, 2) === "SH" || substr(i, 3) === "SIO" || substr(i, 3) === "SIA") { add("X"); i += 2; break; }
        add("S"); i += (at(i+1) === "S") ? 2 : 1; break;
      case "T":
        if (substr(i, 2) === "TH") { add("0", "T"); i += 2; break; }
        if (substr(i, 3) === "TIA" || substr(i, 3) === "TIO") { add("X"); i += 2; break; }
        add("T"); i += (substr(i, 2) === "TT") ? 2 : 1; break;
      case "V": add("F"); i++; break;
      case "W": if (isVowel(at(i+1))) { add("A"); } i++; break;
      case "X": add("KS"); i++; break;
      case "Y": if (isVowel(at(i+1))) { add("Y"); } i++; break;
      case "Z": add("S"); i += (at(i+1) === "Z") ? 2 : 1; break;
      default: i++; break;
    }
  }

  return [primary.slice(0, 6), secondary.slice(0, 6)];
}

function metaphoneSimilarity(a, b) {
  const [ap, as_] = doubleMetaphone(a);
  const [bp, bs] = doubleMetaphone(b);
  if (!ap && !bp) return 0;
  const scores = [
    ap && bp ? jaroWinkler(ap, bp) : 0,
    ap && bs ? jaroWinkler(ap, bs) : 0,
    as_ && bp ? jaroWinkler(as_, bp) : 0,
    as_ && bs ? jaroWinkler(as_, bs) : 0,
  ];
  return Math.max(...scores);
}

// ── Kombinerad scoring med konfigurerbar viktning ─────────────────────────────
function scoreMatch(query, candidate, weights) {
  const q = normalize(query), c = normalize(candidate);
  const jw  = jaroWinkler(q, c);
  const ts  = tokenSort(query, candidate);
  const maxLen = Math.max(q.length, c.length);
  const lev = maxLen > 0 ? 1 - levenshtein(q, c) / maxLen : 0;
  const ngr = ngramSimilarity(q, c, 3);
  const mph = metaphoneSimilarity(q, c);

  const totalWeight =
    (weights.jw  ? weights.jwVal  : 0) +
    (weights.ts  ? weights.tsVal  : 0) +
    (weights.lev ? weights.levVal : 0) +
    (weights.ngr ? weights.ngrVal : 0) +
    (weights.mph ? weights.mphVal : 0);

  const weighted = totalWeight === 0 ? 0 : (
    (weights.jw  ? jw  * weights.jwVal  : 0) +
    (weights.ts  ? ts  * weights.tsVal  : 0) +
    (weights.lev ? lev * weights.levVal : 0) +
    (weights.ngr ? ngr * weights.ngrVal : 0) +
    (weights.mph ? mph * weights.mphVal : 0)
  ) / totalWeight;

  const combined = Math.max(weighted, weights.jw ? jw : 0, weights.ts ? ts : 0);

  return {
    jaroWinkler: Math.round(jw  * 100),
    tokenSort:   Math.round(ts  * 100),
    levenshtein: Math.round(lev * 100),
    ngram:       Math.round(ngr * 100),
    metaphone:   Math.round(mph * 100),
    combined:    Math.round(combined * 100),
  };
}

function screenName(query, list, weights) {
  const results = [];
  for (const entry of list) {
    const namesToCheck = [entry.name, ...(entry.aliases || [])];
    let best = null, bestName = "";
    for (const n of namesToCheck) {
      const s = scoreMatch(query, n, weights);
      if (!best || s.combined > best.combined) { best = s; bestName = n; }
    }
    results.push({ ...entry, scores: best, matchedName: bestName });
  }
  return results.sort((a, b) => b.scores.combined - a.scores.combined);
}

const getRisk = (score) => {
  if (score >= 90) return { label: "TRÄFF",    bg: "#fef2f2", border: "#fca5a5", badge: "#dc2626", scoreColor: "#dc2626" };
  if (score >= 70) return { label: "GRANSKAS", bg: "#fffbeb", border: "#fcd34d", badge: "#d97706", scoreColor: "#d97706" };
  if (score >= 50) return { label: "SVAG",     bg: "#f9fafb", border: "#d1d5db", badge: "#6b7280", scoreColor: "#6b7280" };
  return             { label: "OK",          bg: "#f9fafb", border: "#e5e7eb", badge: "#9ca3af", scoreColor: "#9ca3af" };
};

const flagEmoji = (c) => ({ RU:"🇷🇺",KP:"🇰🇵",BY:"🇧🇾",SY:"🇸🇾",IR:"🇮🇷",IQ:"🇮🇶",CO:"🇨🇴",LY:"🇱🇾",SD:"🇸🇩" }[c] || "🌐");

const PROGRAM_NAMES = {
  "BALKANS":             "Västra Balkan – Sanktionsprogram",
  "BALKANS-EO14033":     "Västra Balkan – Executivorder 14033",
  "BELARUS":             "Belarus – Sanktionsprogram",
  "BELARUS-EO14038":     "Belarus – Executivorder 14038",
  "BURMA-EO14014":       "Burma/Myanmar – Executivorder 14014",
  "CAATSA - IRAN":       "CAATSA – Sanctions mot Iran",
  "CAATSA - RUSSIA":     "CAATSA – Countering America's Adversaries Through Sanctions Act (Ryssland)",
  "CAR":                 "Centralafrikanska republiken – Sanktionsprogram",
  "CUBA":                "Kuba – Sanktionsprogram",
  "CYBER2":              "Cyberoperationer – Executivorder 13694",
  "CYBER3":              "Cyberoperationer – Executivorder 13757",
  "CYBER4":              "Cyberoperationer – Executivorder 13983",
  "DARFUR":              "Darfur/Sudan – Sanktionsprogram",
  "DPRK":                "Nordkorea – Sanktionsprogram",
  "DPRK2":               "Nordkorea – Executivorder 13722",
  "DPRK3":               "Nordkorea – Executivorder 13810",
  "DPRK4":               "Nordkorea – Executivorder 13882",
  "DRCONGO":             "Demokratiska republiken Kongo – Sanktionsprogram",
  "ELECTION-EO13848":    "Valintegritet – Executivorder 13848",
  "ETHIOPIA-EO14046":    "Etiopien – Executivorder 14046",
  "GLOMAG":              "Global Magnitsky – Mänskliga rättigheter och korruption",
  "HK-EO13936":          "Hongkong – Executivorder 13936",
  "HOSTAGES-EO14078":    "Gisslantagning – Executivorder 14078",
  "HRIT-IR":             "Iran – Human Rights and Terrorism",
  "HRIT-SY":             "Syrien – Human Rights and Terrorism",
  "ICC-EO14203":         "Internationella brottmålsdomstolen – Executivorder 14203",
  "IFCA":                "Iran – Freedom and Counter-Proliferation Act",
  "IFSR":                "Iran – Financial Sanctions Regulations",
  "ILLICIT-DRUGS-EO14059": "Narkotikahandel – Executivorder 14059",
  "IRAN":                "Iran – Sanktionsprogram",
  "IRAN-CON-ARMS-EO":    "Iran – Vapenembargo",
  "IRAN-EO13846":        "Iran – Executivorder 13846",
  "IRAN-EO13876":        "Iran – Executivorder 13876 (järn, stål, aluminium)",
  "IRAN-EO13902":        "Iran – Executivorder 13902 (tillverkningssektorn)",
  "IRAN-HR":             "Iran – Mänskliga rättigheter",
  "IRAN-TRA":            "Iran – Threat Reduction and Syria Human Rights Act",
  "IRAQ2":               "Irak – Sanktionsprogram",
  "IRAQ3":               "Irak – Executivorder 13438",
  "IRGC":                "Islamiska revolutionsgardet (Iran)",
  "LEBANON":             "Libanon – Sanktionsprogram",
  "LIBYA2":              "Libyen – Executivorder 13726",
  "LIBYA3":              "Libyen – Executivorder 13566",
  "MAGNIT":              "Magnitsky Act – Ryssland",
  "MALI-EO13882":        "Mali – Executivorder 13882",
  "NICARAGUA":           "Nicaragua – Sanktionsprogram",
  "NICARAGUA-NHRAA":     "Nicaragua – Human Rights and Anticorruption Act",
  "NPWMD":               "Spridning av massförstörelsevapen",
  "PAARSSR-EO13894":     "Syrien – Executivorder 13894",
  "RUSSIA-EO14024":      "Ryssland – Executivorder 14024 (invasion av Ukraina)",
  "RUSSIA-EO14065":      "Ryssland – Executivorder 14065 (Donetsk/Luhansk)",
  "SDGT":                "Globalt utsedda terrorister",
  "SDNT":                "Narkotikahandlare",
  "SDNTK":               "Narkotikahandlare – Kingpin Act",
  "SOMALIA":             "Somalia – Sanktionsprogram",
  "SOUTH SUDAN":         "Sydsudan – Sanktionsprogram",
  "SSIDES":              "Sydsudan – Executivorder 13664",
  "SUDAN-EO14098":       "Sudan – Executivorder 14098",
  "TCO":                 "Transnationella kriminella organisationer",
  "UKRAINE-EO13660":     "Ukraina – Executivorder 13660",
  "UKRAINE-EO13661":     "Ukraina – Executivorder 13661",
  "UKRAINE-EO13662":     "Ukraina – Executivorder 13662",
  "UKRAINE-EO13685":     "Ukraina/Krim – Executivorder 13685",
  "VENEZUELA":           "Venezuela – Sanktionsprogram",
  "VENEZUELA-EO13850":   "Venezuela – Executivorder 13850",
  "VENEZUELA-EO13884":   "Venezuela – Executivorder 13884",
  "YEMEN":               "Jemen – Sanktionsprogram",
  "UHRPA":               "Uyghur Human Rights Policy Act",
  "NS-PLC":              "Palestinska myndigheten – National Security",
  "PEESA-EO14039":       "Ryssland – Protecting Europe's Energy Security Act",
};

// OFAC kombinerar ibland flera program: "SDGT] [IRGC] [IFSR"
// Parsa ut alla delkoder och slå upp var och en
const parseProgramCodes = (program) => {
  if (!program) return [];
  // Splitta på "] [" och rensa bort hakparenteser
  return program.split(/\]\s*\[/).map(s => s.replace(/[\[\]]/g, "").trim()).filter(Boolean);
};

const getProgramLabel = (program) => {
  if (!program) return null;
  const codes = parseProgramCodes(program);
  const descriptions = codes
    .map(code => PROGRAM_NAMES[code] || null)
    .filter(Boolean);
  return descriptions.length > 0 ? descriptions.join("\n") : null;
};

const ScoreBar = ({ label, value, color }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600, color: "#111827" }}>{value}</span>
    </div>
    <div style={{ height: 7, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
    </div>
  </div>
);

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const [expanded, setExpanded] = useState(null);
  const [sanctionsList, setSanctionsList] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [showConfig, setShowConfig] = useState(true);
  const [entityFilter, setEntityFilter] = useState("all");
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState("latest");
  const [showDelta, setShowDelta] = useState(false);
  const [deltaData, setDeltaData] = useState(null);
  const [deltaLoading, setDeltaLoading] = useState(false);
  const [deltaError, setDeltaError] = useState(null);
  const [deltaTab, setDeltaTab] = useState("OFAC");
  const [deltaSection, setDeltaSection] = useState("added");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [weights, setWeights] = useState({
    jw: true,  jwVal: 25,
    ts: true,  tsVal: 25,
    lev: true, levVal: 15,
    ngr: true, ngrVal: 20,
    mph: true, mphVal: 15,
  });

  const setWeight = (key, val) => setWeights(w => ({ ...w, [key]: val }));
  const activeCount = [weights.jw, weights.ts, weights.lev, weights.ngr, weights.mph].filter(Boolean).length;
  const filteredList = entityFilter === "all" ? sanctionsList : sanctionsList.filter(e => e.type === entityFilter);

  const loadList = (snapshotId) => {
    setListLoading(true);
    setListError(null);
    const url = snapshotId && snapshotId !== "latest"
      ? `/.netlify/functions/sanctions?snapshot_id=${snapshotId}`
      : "/.netlify/functions/sanctions";
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setSanctionsList(data.entries || data); setListLoading(false); })
      .catch(err => { setListError(err.message); setListLoading(false); });
  };

  useEffect(() => {
    // Hämta snapshots för dropdown
    fetch("/.netlify/functions/sanctions?action=snapshots")
      .then(r => r.json())
      .then(data => setSnapshots(data.snapshots || []))
      .catch(() => {});
    // Hämta senaste listan
    loadList(null);
  }, []);

  useEffect(() => {
    if (!hasSearched || !query.trim() || sanctionsList.length === 0) return;
    const list = entityFilter === "all" ? sanctionsList : sanctionsList.filter(e => e.type === entityFilter);
    setResults(screenName(query.trim(), list, weights));
    setExpanded(null);
  }, [entityFilter]);

  useEffect(() => {
    if (!hasSearched || !query.trim() || sanctionsList.length === 0) return;
    const list = entityFilter === "all" ? sanctionsList : sanctionsList.filter(e => e.type === entityFilter);
    const timer = setTimeout(() => {
      setResults(screenName(query.trim(), list, weights));
      setExpanded(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [weights]);

  const runScreen = () => {
    if (!query.trim() || sanctionsList.length === 0) return;
    setResults(screenName(query.trim(), filteredList, weights));
    setHasSearched(true);
    setAiAnalysis(null);
    setExpanded(null);
  };

  const openDelta = () => {
    setShowDelta(true);
    if (deltaData) return; // redan laddat
    setDeltaLoading(true);
    setDeltaError(null);
    fetch("/.netlify/functions/sanctions?action=delta")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(data => {
        setDeltaData(data.delta);
        // Sätt första tillgängliga källa som aktiv tab
        const firstSrc = Object.keys(data.delta)[0];
        if (firstSrc) setDeltaTab(firstSrc);
        setDeltaLoading(false);
      })
      .catch(err => { setDeltaError(err.message); setDeltaLoading(false); });
  };

  const runAiAnalysis = async () => {
    setAiLoading(true);
    setAiAnalysis(null);
    const topHits = results.filter(r => r.scores.combined >= 50).slice(0, 5);
    const hitLines = topHits.map(r =>
      "- " + r.name + " (" + (r.nationality || r.country || "okänt land") + ", " + r.program + ") — score: " + r.scores.combined + "/100, matchad mot: \"" + r.matchedName + "\""
    ).join("\n");
    const srcLabel = sourceFilter === "all" ? "OFAC, EU och FN" : sourceFilter === "UN" ? "FN" : sourceFilter;
    const prompt =
      "Du är en expert på sanktionsscreening för en europeisk bank.\n\n" +
      "En kund med namnet \"" + query + "\" har screenats mot sanktionslistor (" + srcLabel + ").\n\n" +
      "ALGORITMISKA RESULTAT:\n" + hitLines + "\n\n" +
      "Gör en professionell bedömning:\n" +
      "1. Är \"" + query + "\" sannolikt samma person som någon på listan?\n" +
      "2. Ta hänsyn till namnvarianter, kulturella konventioner, translitterering.\n" +
      "3. Rekommendera: BLOCKERA / MANUELL GRANSKNING / GODKÄNN\n" +
      "4. Kort motivering.\n\n" +
      "Svara på svenska, koncist.";

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      setAiAnalysis(data.content?.[0]?.text || "Kunde inte analysera.");
    } catch (e) {
      setAiAnalysis("Fel: " + e.message);
    }
    setAiLoading(false);
  };

  const [activeSource, setActiveSource] = useState({});  // groupKey -> source

  const filtered = results.filter(r =>
    r.scores.combined >= threshold &&
    (entityFilter === "all" || r.type === entityFilter) &&
    (sourceFilter === "all" || r.source === sourceFilter)
  );

  // Gruppera träffar med samma namn
  const groupedMap = new Map();
  for (const r of filtered) {
    const key = normalize(r.name);
    if (!groupedMap.has(key)) groupedMap.set(key, { name: r.name, bySource: {} });
    const group = groupedMap.get(key);
    // Behåll bara bästa träff per källa
    if (!group.bySource[r.source] || r.scores.combined > group.bySource[r.source].scores.combined) {
      group.bySource[r.source] = r;
    }
  }
  const grouped = Array.from(groupedMap.entries()).map(([key, { name, bySource }]) => {
    const hits = Object.values(bySource);
    return {
      key,
      name,
      bestScore: Math.max(...hits.map(h => h.scores.combined)),
      hits,
    };
  }).sort((a, b) => b.bestScore - a.bestScore);

  const topScore = grouped[0]?.bestScore ?? 0;
  const EXAMPLES = ["Abdifatah Abubakar Abdi", "Vlademir Poutine", "Kim Jong Un", "Ivan Wolkow", "Banco Nacional de Cuba", "Nord Stream"];

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .row-enter { animation: fadeIn 0.25s ease forwards; }
        input:focus { outline: 2px solid #1e3a5f; outline-offset: 1px; }
        @media (max-width: 520px) {
          .threshold-row { flex-wrap: wrap; }
          .threshold-row span:last-child { display: none; }
          .result-grid { grid-template-columns: 1fr !important; }
          .search-row { flex-direction: column; }
          .search-row button { width: 100%; }
        }
      `}</style>

      {/* Header */}
      <div style={{ background: "#1e3a5f", padding: "14px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 20 }}>🛡</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>Sanctions Screening</div>
          <div style={{ color: "#93c5fd", fontSize: 12 }}>
            {listLoading
              ? "Laddar sanktionslistor..."
              : listError
              ? `⚠ Fel vid laddning: ${listError}`
              : (() => {
                  const ofac = sanctionsList.filter(e => e.source === "OFAC").length;
                  const eu   = sanctionsList.filter(e => e.source === "EU").length;
                  const un   = sanctionsList.filter(e => e.source === "UN").length;
                  return `${sanctionsList.length.toLocaleString("sv-SE")} entiteter · OFAC ${ofac.toLocaleString("sv-SE")} · EU ${eu.toLocaleString("sv-SE")} · FN ${un.toLocaleString("sv-SE")} · 5 algoritmer · Infotrek AI`;
                })()
            }
          </div>
        </div>
        <button onClick={openDelta} style={{
          background: "rgba(255,255,255,0.1)", border: "1.5px solid rgba(255,255,255,0.25)",
          color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
          whiteSpace: "nowrap"
        }}>
          📊 Listförändringar
        </button>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px" }}>

        {/* Search card */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runScreen()}
              placeholder="Ange namn att screena..."
              style={{
                flex: 1, padding: "11px 14px", fontSize: 15, border: "1.5px solid #d1d5db",
                borderRadius: 8, color: "#111827", background: "#fff", fontFamily: "inherit"
              }}
            />
            <button onClick={runScreen} disabled={listLoading} style={{
              padding: "11px 24px", background: listLoading ? "#9ca3af" : "#1e3a5f", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: listLoading ? "not-allowed" : "pointer", fontFamily: "inherit"
            }}>Screena</button>
          </div>

          {/* Example chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
            <span style={{ fontSize: 12, color: "#9ca3af", alignSelf: "center", marginRight: 2 }}>Prova:</span>
            {EXAMPLES.map(name => (
              <button key={name} onClick={() => {
                setQuery(name);
                setResults(screenName(name, filteredList, weights));
                setHasSearched(true);
                setAiAnalysis(null);
                setExpanded(null);
              }} style={{
                padding: "4px 12px", background: "#f3f4f6", border: "1px solid #e5e7eb",
                borderRadius: 20, fontSize: 12, color: "#374151", cursor: "pointer", fontFamily: "inherit"
              }}>{name}</button>
            ))}
          </div>

          {/* ── Konfigurationspanel ─────────────────────────────────────── */}
          <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 12, marginBottom: 20, overflow: "hidden" }}>

            {/* Panel header */}
            <div style={{ padding: "12px 18px", background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: 0.8 }}>⚙ SCREENINGKONFIGURATION</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Inställningarna påverkar alla sökningar</span>
            </div>

            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Rad 1: Källa + Entitet */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

                {/* Källa */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>KÄLLA</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {[
                      { value: "all",  label: "Alla",  count: sanctionsList.length },
                      { value: "OFAC", label: "OFAC",  count: sanctionsList.filter(e => e.source === "OFAC").length },
                      { value: "EU",   label: "EU",    count: sanctionsList.filter(e => e.source === "EU").length },
                      { value: "UN",   label: "FN",    count: sanctionsList.filter(e => e.source === "UN").length },
                    ].map(({ value, label, count }) => (
                      <button key={value} onClick={() => setSourceFilter(value)} style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                        fontWeight: sourceFilter === value ? 700 : 400,
                        background: sourceFilter === value ? "#1e3a5f" : "#fff",
                        border: `1.5px solid ${sourceFilter === value ? "#1e3a5f" : "#cbd5e1"}`,
                        color: sourceFilter === value ? "#fff" : "#475569",
                        display: "flex", alignItems: "center", gap: 4
                      }}>
                        {label}
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 8,
                          background: sourceFilter === value ? "rgba(255,255,255,0.2)" : "#f1f5f9",
                          color: sourceFilter === value ? "#fff" : "#94a3b8",
                        }}>{count.toLocaleString("sv-SE")}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Entitet */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>ENTITETSTYP</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {[
                      { value: "all",          label: "Alla",        count: sanctionsList.length },
                      { value: "individual",   label: "Individer",   count: sanctionsList.filter(e => e.type === "individual").length },
                      { value: "organization", label: "Org",         count: sanctionsList.filter(e => e.type === "organization").length },
                      { value: "vessel",       label: "Fartyg",      count: sanctionsList.filter(e => e.type === "vessel").length },
                      { value: "aircraft",     label: "Flyg",        count: sanctionsList.filter(e => e.type === "aircraft").length },
                    ].map(({ value, label, count }) => (
                      <button key={value} onClick={() => setEntityFilter(value)} style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                        fontWeight: entityFilter === value ? 700 : 400,
                        background: entityFilter === value ? "#1e3a5f" : "#fff",
                        border: `1.5px solid ${entityFilter === value ? "#1e3a5f" : "#cbd5e1"}`,
                        color: entityFilter === value ? "#fff" : "#475569",
                        display: "flex", alignItems: "center", gap: 4
                      }}>
                        {label}
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 8,
                          background: entityFilter === value ? "rgba(255,255,255,0.2)" : "#f1f5f9",
                          color: entityFilter === value ? "#fff" : "#94a3b8",
                        }}>{count.toLocaleString("sv-SE")}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Rad 2: Tröskel + Snapshot */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

                {/* Tröskel */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>MATCHNINGSTRÖSKEL</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="range" min={30} max={95} value={threshold}
                      onChange={e => setThreshold(+e.target.value)}
                      style={{ flex: 1, accentColor: "#1e3a5f" }} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#1e3a5f", minWidth: 38 }}>{threshold}%</span>
                    <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 80 }}>
                      {threshold >= 85 ? "Strikt" : threshold >= 70 ? "Balanserad" : "Känslig"}
                    </span>
                  </div>
                </div>

                {/* Snapshot */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>LISTVERSION (DATUM)</div>
                  <select
                    value={selectedSnapshot}
                    onChange={e => {
                      setSelectedSnapshot(e.target.value);
                      loadList(e.target.value === "latest" ? null : e.target.value);
                      setHasSearched(false);
                      setResults([]);
                    }}
                    style={{
                      width: "100%", padding: "6px 10px", borderRadius: 6, fontSize: 12,
                      border: "1.5px solid #cbd5e1", background: "#fff", color: "#374151",
                      fontFamily: "inherit", cursor: "pointer"
                    }}
                  >
                    <option value="latest">Senaste (aktuell)</option>
                    {snapshots.length > 0 && (
                      <>
                        <option disabled>──────────────</option>
                        {snapshots.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.source} – {s.snapshot_date} ({s.entity_count.toLocaleString("sv-SE")} entiteter)
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  {selectedSnapshot !== "latest" && (() => {
                    const snap = snapshots.find(s => s.id === selectedSnapshot);
                    return snap ? (
                      <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 4 }}>
                        ⚠ Screenar mot {snap.source}-lista från {snap.snapshot_date}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Rad 3: Algoritmer (kollapsbar) */}
              <div>
                <button onClick={() => setShowConfig(v => !v)} style={{
                  background: "none", border: "1.5px solid #e2e8f0", borderRadius: 6,
                  padding: "6px 12px", fontSize: 11, color: "#64748b", cursor: "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, fontWeight: 600
                }}>
                  ALGORITMER & VIKTER
                  <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>({activeCount}/5 aktiva)</span>
                  <span style={{ fontSize: 10 }}>{showConfig ? "▲" : "▼"}</span>
                </button>

                {showConfig && (
                  <div style={{ marginTop: 10, padding: "14px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <style>{`
                    .algo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
                    .algo-label { width: 130px; flex-shrink: 0; }
                    .algo-slider { flex: 1; max-width: 160px; }
                    .algo-raw { width: 36px; height: 28px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0; }
                    .algo-pct { width: 44px; height: 28px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
                  `}</style>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 12 }}>
                    VÄLJ ALGORITMER OCH VIKTER — vikterna normaliseras automatiskt
                  </div>
                  {(() => {
                    const algos = [
                      { key: "jw",  valKey: "jwVal",  label: "Jaro-Winkler",     desc: "Teckenbaserad likhet",         color: "#3b82f6",
                        tooltip: "Mäter likhet baserat på gemensamma tecken och transpositioner. Ger extra poäng för matchande prefix. Bra för stavvarianter som 'Erik' vs 'Eric'." },
                      { key: "ts",  valKey: "tsVal",  label: "Token-sort",        desc: "Ordningsokänslig jämförelse",  color: "#10b981",
                        tooltip: "Delar upp namnet i tokens (ord), sorterar dem alfabetiskt och jämför sedan. Gör att 'Ali Hassan' och 'Hassan Ali' får högt score oavsett ordning." },
                      { key: "lev", valKey: "levVal", label: "Levenshtein",       desc: "Edit-avstånd",                 color: "#f59e0b",
                        tooltip: "Räknar minimalt antal insättningar, borttagningar och ersättningar för att omvandla ett namn till ett annat. 'Mohammed' vs 'Mohammad' = avstånd 2." },
                      { key: "ngr", valKey: "ngrVal", label: "N-gram (trigram)",  desc: "Delsträcksöverlapp",           color: "#8b5cf6",
                        tooltip: "Delar upp namn i överlappande 3-teckensblock (trigrams) och mäter andelen gemensamma block. Robust mot längre namnvarianter och translitterering." },
                      { key: "mph", valKey: "mphVal", label: "Double Metaphone",  desc: "Fonetisk likhet",              color: "#ec4899",
                        tooltip: "Kodar namnet fonetiskt – hur det låter snarare än hur det stavas. 'Vladimir' och 'Wladimir' får samma kod. Speciellt bra för arabiska och slaviska namn." },
                    ];
                    const totalWeight = algos.reduce((sum, a) => sum + (weights[a.key] ? weights[a.valKey] : 0), 0);
                    return algos.map(({ key, valKey, label, desc, color, tooltip }) => {
                      const normPct = totalWeight > 0 && weights[key]
                        ? Math.round((weights[valKey] / totalWeight) * 100)
                        : 0;
                      return (
                        <div key={key} className="algo-row">
                          <input type="checkbox" checked={weights[key]} onChange={e => setWeight(key, e.target.checked)}
                            style={{ width: 16, height: 16, accentColor: color, cursor: "pointer", flexShrink: 0 }} />
                          <div className="algo-label">
                            <div style={{ fontSize: 13, fontWeight: 600, color: weights[key] ? "#111827" : "#9ca3af", display: "flex", alignItems: "center", gap: 5 }}>
                              {label}
                              <span title={tooltip} style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 15, height: 15, borderRadius: "50%",
                                background: "#e5e7eb", color: "#6b7280",
                                fontSize: 10, fontWeight: 700, cursor: "help", flexShrink: 0
                              }}>?</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#9ca3af" }}>{desc}</div>
                          </div>
                          <input type="range" min={1} max={100} value={weights[valKey]}
                            disabled={!weights[key]}
                            onChange={e => setWeight(valKey, +e.target.value)}
                            className="algo-slider"
                            style={{ accentColor: color, opacity: weights[key] ? 1 : 0.3 }} />
                          <div className="algo-raw" style={{ background: weights[key] ? color : "#e5e7eb" }}>
                            {weights[valKey]}
                          </div>
                          <div className="algo-pct" style={{
                            background: weights[key] ? "#f0f7ff" : "#f9fafb",
                            border: `1px solid ${weights[key] ? "#bfdbfe" : "#e5e7eb"}`,
                            color: weights[key] ? "#1e3a5f" : "#9ca3af"
                          }}>
                            {normPct}%
                          </div>
                        </div>
                      );
                    });
                  })()}
                    <div style={{ marginTop: 10, fontSize: 12, color: "#9ca3af", borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
                      Kombinerat score = viktat medelvärde av aktiva algoritmer (normaliserat till 100%)
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        {hasSearched && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, color: "#6b7280" }}>
                <span style={{ fontWeight: 600, color: "#111827" }}>{grouped.length}</span> träffar över {threshold}%
                {grouped.length !== filtered.length && <span style={{ color: "#9ca3af", fontSize: 12 }}> ({filtered.length} totalt inkl. dubbletter)</span>}
                {topScore >= 90 && <span style={{ marginLeft: 14, color: "#dc2626", fontWeight: 600 }}>⚠ Möjlig match hittad</span>}
                {topScore < 70 && grouped.length > 0 && <span style={{ marginLeft: 14, color: "#16a34a", fontWeight: 500 }}>✓ Inga starka träffar</span>}
              </div>
              {filtered.some(r => r.scores.combined >= 50) && (
                <button onClick={runAiAnalysis} disabled={aiLoading} style={{
                  padding: "9px 18px", background: aiLoading ? "#f3f4f6" : "#1e3a5f",
                  color: aiLoading ? "#9ca3af" : "#fff",
                  border: "1.5px solid " + (aiLoading ? "#e5e7eb" : "#1e3a5f"),
                  borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: aiLoading ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8
                }}>
                  {aiLoading
                    ? <><span style={{ width: 13, height: 13, border: "2px solid #d1d5db", borderTop: "2px solid #6b7280", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} /> Analyserar...</>
                    : "✦ AI-bedömning"}
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {filtered.length === 0 && (
                <div style={{ background: "#fff", borderRadius: 10, padding: "48px", textAlign: "center", color: "#6b7280", fontSize: 14, border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                  Inga träffar över {threshold}% — kunden finns inte på {sourceFilter === "all" ? "någon sanktionslista" : sourceFilter === "UN" ? "FN:s sanktionslista" : `${sourceFilter}:s sanktionslista`}
                </div>
              )}
              {grouped.map((group, i) => {
                const r = group.hits.find(h => h.source === (activeSource[group.key] || group.hits[0].source)) || group.hits[0];
                const risk = getRisk(group.bestScore);
                const isOpen = expanded === group.key;
                const programDesc = getProgramLabel(r.program);
                return (
                  <div key={group.key} className="row-enter" style={{ animationDelay: `${i * 30}ms`, background: risk.bg, border: `1.5px solid ${risk.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <div onClick={() => setExpanded(isOpen ? null : group.key)}
                      style={{ padding: "15px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>

                      {/* Score circle */}
                      <div style={{
                        width: 54, height: 54, borderRadius: "50%", background: "#fff",
                        border: `2px solid ${risk.border}`, display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", flexShrink: 0
                      }}>
                        <span style={{ fontSize: 17, fontWeight: 700, color: risk.scoreColor, lineHeight: 1 }}>{group.bestScore}</span>
                        <span style={{ fontSize: 9, color: "#9ca3af" }}>/ 100</span>
                      </div>

                      {/* Name & source badges */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {r.name}
                          {r.type && r.type !== "individual" && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                              background: r.type === "vessel" ? "#eff6ff" : r.type === "aircraft" ? "#f0fdf4" : r.type === "organization" ? "#fef9ec" : "#f5f3ff",
                              color: r.type === "vessel" ? "#1e40af" : r.type === "aircraft" ? "#14532d" : r.type === "organization" ? "#7c4a0a" : "#5b21b6",
                              border: `1px solid ${r.type === "vessel" ? "#bfdbfe" : r.type === "aircraft" ? "#bbf7d0" : r.type === "organization" ? "#fcd34d" : "#ddd6fe"}`,
                              textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0
                            }}>{r.type === "organization" ? "org" : r.type}</span>
                          )}
                        </div>
                        {/* Klickbara källbadges */}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {group.hits.map(h => {
                            const isActive = h.source === (activeSource[group.key] || group.hits[0].source);
                            const sourceLabel = h.source === "UN" ? "FN" : h.source;
                            const srcColors = {
                              OFAC: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe", activeBg: "#1e40af" },
                              EU:   { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0", activeBg: "#166534" },
                              UN:   { bg: "#fef9ec", color: "#92400e", border: "#fcd34d", activeBg: "#92400e" },
                            }[h.source] || { bg: "#f3f4f6", color: "#374151", border: "#d1d5db", activeBg: "#374151" };
                            return (
                              <span key={h.source}
                                onClick={e => { e.stopPropagation(); setActiveSource(prev => ({ ...prev, [group.key]: h.source })); if (!isOpen) setExpanded(group.key); }}
                                style={{
                                  fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 10,
                                  background: isActive ? srcColors.activeBg : srcColors.bg,
                                  color: isActive ? "#fff" : srcColors.color,
                                  border: `1.5px solid ${isActive ? srcColors.activeBg : srcColors.border}`,
                                  textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer",
                                  transition: "all 0.15s"
                                }}
                                title={`Visa detaljer från ${sourceLabel}`}
                              >{sourceLabel} {h.scores.combined}</span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Flag */}
                      <div style={{ textAlign: "center", flexShrink: 0, minWidth: 36 }}>
                        <div style={{ fontSize: 22 }}>{flagEmoji(r.nationality || r.country)}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>{r.nationality || r.country || "—"}</div>
                      </div>

                      {/* Risk badge */}
                      <span style={{
                        padding: "5px 13px", borderRadius: 20, background: risk.badge,
                        color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0
                      }}>{risk.label}</span>

                      {/* Chevron */}
                      <span style={{ color: "#9ca3af", fontSize: 16, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>▼</span>
                    </div>

                    {isOpen && (
                      <div style={{ padding: "16px 18px 20px", borderTop: `1px solid ${risk.border}`, background: "#fff" }}>

                        {/* Källindikator */}
                        <div style={{ marginBottom: 14, fontSize: 12, color: "#6b7280" }}>
                          Visar data från: <strong style={{ color: "#1e3a5f" }}>{r.source === "UN" ? "FN" : r.source}</strong>
                          {group.hits.length > 1 && <span style={{ marginLeft: 6, color: "#9ca3af" }}>— klicka på källbadge ovan för att byta</span>}
                        </div>

                        {/* Program description */}
                        {programDesc && (
                          <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0f7ff", borderRadius: 6, fontSize: 13, color: "#1e3a5f" }}>
                            <strong>{r.program}</strong><br />
                            <span style={{ color: "#374151" }}>{programDesc}</span>
                          </div>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 20 }}>
                          {/* Personuppgifter */}
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 10 }}>PERSONUPPGIFTER</div>
                            {[
                              ["Fullständigt namn", r.name],
                              ["Typ", r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : null],
                              ["Titel", r.title],
                              ["Kön", r.gender === "Male" ? "Man" : r.gender === "Female" ? "Kvinna" : null],
                              ["Födelsedatum", r.dob],
                              ["Födelseort", r.pob],
                              ["Nationalitet", r.nationality],
                              ["Matchad mot", `"${r.matchedName}"`],
                              [r.source === "OFAC" ? "OFAC ID" : r.source === "EU" ? "EU Ref" : "FN Ref", r.id],
                            ].filter(([, v]) => v).map(([label, value]) => (
                              <div key={label} style={{ marginBottom: 6 }}>
                                <span style={{ fontSize: 11, color: "#9ca3af" }}>{label}</span>
                                <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{value}</div>
                              </div>
                            ))}
                          </div>

                          {/* Alias + adresser */}
                          <div>
                            {r.aliases?.length > 0 && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>ALIAS / AKA</div>
                                {r.aliases.map((a, i) => (
                                  <div key={i} style={{ fontSize: 13, color: "#374151", padding: "3px 0", borderBottom: "1px solid #f3f4f6" }}>{a}</div>
                                ))}
                              </div>
                            )}
                            {r.addresses?.length > 0 && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>ADRESSER</div>
                                {r.addresses.map((a, i) => (
                                  <div key={i} style={{ fontSize: 13, color: "#374151", padding: "3px 0", borderBottom: "1px solid #f3f4f6" }}>📍 {a}</div>
                                ))}
                              </div>
                            )}
                            {r.passports?.length > 0 && (
                              <div style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>PASS</div>
                                {r.passports.map((p, i) => (
                                  <div key={i} style={{ fontSize: 13, color: "#374151" }}>🛂 {p.number} ({p.country})</div>
                                ))}
                              </div>
                            )}
                            {r.national_ids?.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>ID-NUMMER</div>
                                {r.national_ids.map((n, i) => (
                                  <div key={i} style={{ fontSize: 13, color: "#374151" }}>🪪 {n.number}{n.country ? ` (${n.country})` : ""}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Score bars */}
                        <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 12 }}>MATCHNINGSSCORES</div>
                          <ScoreBar label="Jaro-Winkler  –  teckenbaserad likhet" value={r.scores.jaroWinkler} color="#3b82f6" />
                          <ScoreBar label="Token-sort  –  ordningsokänslig jämförelse" value={r.scores.tokenSort} color="#10b981" />
                          <ScoreBar label="Levenshtein  –  edit-avstånd" value={r.scores.levenshtein} color="#f59e0b" />
                          <ScoreBar label="N-gram (trigram)  –  delsträcksöverlapp" value={r.scores.ngram} color="#8b5cf6" />
                          <ScoreBar label="Double Metaphone  –  fonetisk likhet" value={r.scores.metaphone} color="#ec4899" />
                          <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
                            {(() => {
                              const algos = [
                                { key: "jw",  valKey: "jwVal",  label: "JW" },
                                { key: "ts",  valKey: "tsVal",  label: "TS" },
                                { key: "lev", valKey: "levVal", label: "Lev" },
                                { key: "ngr", valKey: "ngrVal", label: "NGram" },
                                { key: "mph", valKey: "mphVal", label: "Metaphone" },
                              ];
                              const active = algos.filter(a => weights[a.key]);
                              const total = active.reduce((s, a) => s + weights[a.valKey], 0);
                              if (active.length === 0) return "Inga algoritmer aktiva";
                              const parts = active.map(a => {
                                const pct = Math.round((weights[a.valKey] / total) * 100);
                                return `${a.label}×${pct}%`;
                              }).join(" + ");
                              return `Kombinerat = ${parts}`;
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* AI panel */}
            {aiAnalysis && (
              <div style={{ background: "#fff", border: "1.5px solid #bfdbfe", borderRadius: 10, padding: "22px 24px", animation: "fadeIn 0.3s ease" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1e3a5f", marginBottom: 12 }}>✦ AI-bedömning — Infotrek AI</div>
                <div style={{ fontSize: 14, lineHeight: 1.8, color: "#374151", whiteSpace: "pre-wrap" }}>{aiAnalysis}</div>
              </div>
            )}
          </div>
        )}

        {!hasSearched && (
          <div style={{ background: "#fff", borderRadius: 12, padding: "56px", textAlign: "center", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🛡</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Ange ett namn för att screena</div>
            <div style={{ fontSize: 13, color: "#9ca3af" }}>
              {listLoading
                ? "Laddar sanktionslistor..."
                : (() => {
                    const ofac = sanctionsList.filter(e => e.source === "OFAC").length;
                    const eu   = sanctionsList.filter(e => e.source === "EU").length;
                    const un   = sanctionsList.filter(e => e.source === "UN").length;
                    return `Jämförs mot ${sanctionsList.length.toLocaleString("sv-SE")} entiteter · OFAC ${ofac.toLocaleString("sv-SE")} · EU ${eu.toLocaleString("sv-SE")} · FN ${un.toLocaleString("sv-SE")} · 5 matchningsalgoritmer + Infotrek AI`;
                  })()}
            </div>
          </div>
        )}

        {/* Footer logga */}
        <div style={{ marginTop: 40, borderRadius: 12, overflow: "hidden" }}>
          <svg width="100%" viewBox="0 0 680 180" xmlns="http://www.w3.org/2000/svg">
            <rect width="680" height="180" fill="#0a1628" rx="12"/>
            <line x1="0" y1="90" x2="680" y2="90" stroke="#1a2d50" strokeWidth="0.5"/>
            <line x1="340" y1="0" x2="340" y2="180" stroke="#1a2d50" strokeWidth="0.5"/>
            <circle cx="90" cy="90" r="62" fill="none" stroke="#1e3d7a" strokeWidth="1"/>
            <circle cx="90" cy="90" r="48" fill="none" stroke="#2a5298" strokeWidth="1"/>
            <circle cx="90" cy="90" r="34" fill="none" stroke="#1e3d7a" strokeWidth="1" strokeDasharray="4 4"/>
            <circle cx="90" cy="28" r="2.5" fill="#4a9eff"/>
            <circle cx="148" cy="58" r="2" fill="#2a5298"/>
            <circle cx="152" cy="114" r="2.5" fill="#4a9eff"/>
            <circle cx="90" cy="152" r="2" fill="#2a5298"/>
            <circle cx="30" cy="116" r="2.5" fill="#4a9eff"/>
            <line x1="90" y1="90" x2="90" y2="31" stroke="#4a9eff" strokeWidth="1" fill="none" opacity="0.8"/>
            <line x1="90" y1="90" x2="147" y2="60" stroke="#4a9eff" strokeWidth="1" fill="none" opacity="0.5"/>
            <line x1="90" y1="90" x2="149" y2="112" stroke="#7bbfff" strokeWidth="1.5" fill="none" opacity="0.9"/>
            <line x1="90" y1="90" x2="32" y2="115" stroke="#4a9eff" strokeWidth="1" fill="none" opacity="0.5"/>
            <path d="M90 46 L128 63 L128 98 Q128 120 90 132 Q52 120 52 98 L52 63 Z" fill="#162d54" stroke="#2a5298" strokeWidth="1.5"/>
            <path d="M90 53 L122 68 L122 98 Q122 116 90 126 Q58 116 58 98 L58 68 Z" fill="none" stroke="#1e4080" strokeWidth="1"/>
            <polyline points="76,92 88,104 108,78" fill="none" stroke="#4a9eff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="90" cy="90" r="3" fill="#4a9eff"/>
            <circle cx="90" cy="90" r="1.5" fill="#7bbfff"/>
            <text x="185" y="82" fontFamily="system-ui, sans-serif" fontSize="28" fontWeight="700" fill="#ffffff" letterSpacing="1">INFOTREK <tspan fill="#4a9eff">ANALYTICS</tspan></text>
            <line x1="185" y1="108" x2="620" y2="108" stroke="#2a5298" strokeWidth="1"/>
            <text x="186" y="124" fontFamily="system-ui, sans-serif" fontSize="11" fill="#4a7ab5" letterSpacing="3">INTELLIGENT NAME MATCHING</text>
            <rect x="185" y="138" width="100" height="4" rx="2" fill="#1a3560"/>
            <rect x="185" y="138" width="90" height="4" rx="2" fill="#4a9eff"/>
            <rect x="185" y="147" width="100" height="4" rx="2" fill="#1a3560"/>
            <rect x="185" y="147" width="72" height="4" rx="2" fill="#2a7acc"/>
            <rect x="185" y="156" width="100" height="4" rx="2" fill="#1a3560"/>
            <rect x="185" y="156" width="55" height="4" rx="2" fill="#1a5a9a"/>
          </svg>
        </div>
      </div>

      {/* Delta modal */}
      {showDelta && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowDelta(false); }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 780, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>

            {/* Modal header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>📊 Listförändringar</div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Senaste vs föregående uppdatering per källa</div>
              </div>
              <button onClick={() => setShowDelta(false)} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>

            {/* Modal body */}
            <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px" }}>
              {deltaLoading && (
                <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
                  <div style={{ width: 32, height: 32, border: "3px solid #e5e7eb", borderTop: "3px solid #1e3a5f", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                  Hämtar förändringar...
                </div>
              )}
              {deltaError && (
                <div style={{ padding: 24, background: "#fef2f2", borderRadius: 10, color: "#dc2626", fontSize: 14 }}>⚠ {deltaError}</div>
              )}
              {deltaData && !deltaLoading && (() => {
                const sources = Object.keys(deltaData);
                const cur = deltaData[deltaTab] || deltaData[sources[0]];
                if (!cur) return null;

                const sectionCfg = [
                  { key: "added",   label: "Tillagda",  color: "#16a34a", bg: "#f0fdf4", icon: "+" },
                  { key: "removed", label: "Borttagna", color: "#dc2626", bg: "#fef2f2", icon: "−" },
                  { key: "changed", label: "Ändrade",   color: "#d97706", bg: "#fffbeb", icon: "~" },
                ];

                return (
                  <div>
                    {/* Källtabs */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                      {sources.map(src => (
                        <button key={src} onClick={() => setDeltaTab(src)} style={{
                          padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                          cursor: "pointer", fontFamily: "inherit",
                          background: deltaTab === src ? "#1e3a5f" : "#f3f4f6",
                          color: deltaTab === src ? "#fff" : "#374151",
                          border: "none"
                        }}>{src === "UN" ? "FN" : src}</button>
                      ))}
                    </div>

                    {/* Snapshots-info */}
                    {cur.previous ? (
                      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                        <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "12px 16px", border: "1px solid #e2e8f0" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 4 }}>FÖREGÅENDE</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>{cur.previous.snapshot_date}</div>
                          <div style={{ fontSize: 12, color: "#9ca3af" }}>{cur.previous.entity_count.toLocaleString("sv-SE")} entiteter</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", color: "#9ca3af", fontSize: 20 }}>→</div>
                        <div style={{ flex: 1, background: "#f0f7ff", borderRadius: 8, padding: "12px 16px", border: "1px solid #bfdbfe" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", letterSpacing: 1, marginBottom: 4 }}>SENASTE</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#1e3a5f" }}>{cur.newest.snapshot_date}</div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>{cur.newest.entity_count.toLocaleString("sv-SE")} entiteter</div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: 16, background: "#f8fafc", borderRadius: 8, color: "#9ca3af", fontSize: 13, marginBottom: 20 }}>
                        Ingen föregående snapshot — detta är första inläsningen.
                      </div>
                    )}

                    {/* Statistik-kort */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                      {sectionCfg.map(({ key, label, color, bg, icon }) => (
                        <button key={key} onClick={() => setDeltaSection(key)} style={{
                          padding: "14px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                          background: deltaSection === key ? bg : "#f9fafb",
                          border: "2px solid " + (deltaSection === key ? color : "#e5e7eb"),
                          textAlign: "left"
                        }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color }}>{icon} {cur[key].length}</div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{label} entiteter</div>
                        </button>
                      ))}
                    </div>

                    {/* Entitetslista */}
                    {cur[deltaSection].length === 0 ? (
                      <div style={{ textAlign: "center", padding: 32, color: "#9ca3af", fontSize: 14 }}>
                        Inga {sectionCfg.find(s => s.key === deltaSection)?.label.toLowerCase()} entiteter
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {cur[deltaSection].slice(0, 200).map((row, i) => {
                          const cfg = sectionCfg.find(s => s.key === deltaSection);
                          return (
                            <div key={i} style={{ padding: "10px 14px", borderRadius: 8, background: cfg.bg, border: "1px solid " + (deltaSection === "added" ? "#bbf7d0" : deltaSection === "removed" ? "#fca5a5" : "#fcd34d"), display: "flex", alignItems: "flex-start", gap: 10 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: cfg.color, borderRadius: 4, padding: "2px 6px", flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{row.name || row.entity_id}</div>
                                {deltaSection === "changed" && row.field_changed && (
                                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
                                    <span style={{ fontWeight: 600 }}>{row.field_changed}:</span>{" "}
                                    <span style={{ textDecoration: "line-through", color: "#9ca3af" }}>{row.old_value}</span>
                                    {" → "}
                                    <span style={{ color: "#111827" }}>{row.new_value}</span>
                                  </div>
                                )}
                                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                                  {row.logged_at ? new Date(row.logged_at).toLocaleDateString("sv-SE") : ""}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {cur[deltaSection].length > 200 && (
                          <div style={{ textAlign: "center", padding: 12, color: "#9ca3af", fontSize: 12 }}>
                            + {(cur[deltaSection].length - 200).toLocaleString("sv-SE")} till...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
