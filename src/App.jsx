import { useState, useEffect, useRef } from "react";

// ── Matching algorithms ───────────────────────────────────────────────────────
function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
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
function tokenSort(a, b) {
  const ta = normalize(a).split(" ").sort().join(" ");
  const tb = normalize(b).split(" ").sort().join(" ");
  return jaroWinkler(ta, tb);
}
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
  if ("GN KN PN AE WR".split(" ").some(v => substr(0, 2) === v)) i = 1;
  if (at(0) === "X") { add("S"); i = 1; }
  while (i < len) {
    const c = at(i);
    if (isVowel(c)) { if (i === 0) add("A"); i++; continue; }
    switch (c) {
      case "B": add("P"); i += (at(i+1) === "B") ? 2 : 1; break;
      case "C":
        if (substr(i, 4) === "CHIA") { add("K"); i += 2; break; }
        if (substr(i, 2) === "CH") { add("X", "K"); i += 2; break; }
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
      case "H": if (isVowel(at(i+1)) && (i === 0 || !isVowel(at(i-1)))) add("H"); i++; break;
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
  return Math.max(
    ap && bp ? jaroWinkler(ap, bp) : 0,
    ap && bs ? jaroWinkler(ap, bs) : 0,
    as_ && bp ? jaroWinkler(as_, bp) : 0,
    as_ && bs ? jaroWinkler(as_, bs) : 0,
  );
}
function scoreMatch(query, candidate, weights) {
  const q = normalize(query), c = normalize(candidate);
  const jw  = jaroWinkler(q, c);
  const ts  = tokenSort(query, candidate);
  const maxLen = Math.max(q.length, c.length);
  const lev = maxLen > 0 ? 1 - levenshtein(q, c) / maxLen : 0;
  const ngr = ngramSimilarity(q, c, 3);
  const mph = metaphoneSimilarity(q, c);
  const totalWeight =
    (weights.jw  ? weights.jwVal  : 0) + (weights.ts  ? weights.tsVal  : 0) +
    (weights.lev ? weights.levVal : 0) + (weights.ngr ? weights.ngrVal : 0) +
    (weights.mph ? weights.mphVal : 0);
  const weighted = totalWeight === 0 ? 0 : (
    (weights.jw  ? jw  * weights.jwVal  : 0) + (weights.ts  ? ts  * weights.tsVal  : 0) +
    (weights.lev ? lev * weights.levVal : 0) + (weights.ngr ? ngr * weights.ngrVal : 0) +
    (weights.mph ? mph * weights.mphVal : 0)
  ) / totalWeight;
  const combined = Math.max(weighted, weights.jw ? jw : 0, weights.ts ? ts : 0);
  return {
    jaroWinkler: Math.round(jw * 100), tokenSort: Math.round(ts * 100),
    levenshtein: Math.round(lev * 100), ngram: Math.round(ngr * 100),
    metaphone: Math.round(mph * 100), combined: Math.round(combined * 100),
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

// ── UI Helpers ────────────────────────────────────────────────────────────────
const getRisk = (score) => {
  if (score >= 90) return { label: "HIT",     bg: "#fef2f2", border: "#fca5a5", badge: "#dc2626", scoreColor: "#dc2626" };
  if (score >= 70) return { label: "REVIEW",  bg: "#fffbeb", border: "#fcd34d", badge: "#d97706", scoreColor: "#d97706" };
  if (score >= 50) return { label: "WEAK",    bg: "#f9fafb", border: "#d1d5db", badge: "#6b7280", scoreColor: "#6b7280" };
  return             { label: "OK",         bg: "#f9fafb", border: "#e5e7eb", badge: "#9ca3af", scoreColor: "#9ca3af" };
};
const flagEmoji = (c) => ({ RU:"🇷🇺",KP:"🇰🇵",BY:"🇧🇾",SY:"🇸🇾",IR:"🇮🇷",IQ:"🇮🇶",CO:"🇨🇴",LY:"🇱🇾",SD:"🇸🇩" }[c] || "🌍");

const PROGRAM_NAMES = {
  "BALKANS":"Western Balkans","BALKANS-EO14033":"Western Balkans EO14033","BELARUS":"Belarus",
  "BELARUS-EO14038":"Belarus EO14038","BURMA-EO14014":"Burma/Myanmar EO14014",
  "CAATSA - IRAN":"CAATSA Iran","CAATSA - RUSSIA":"CAATSA Russia","CAR":"Central African Republic",
  "CUBA":"Cuba","CYBER2":"Cyber EO13694","CYBER3":"Cyber EO13757","CYBER4":"Cyber EO13983",
  "DARFUR":"Darfur/Sudan","DPRK":"North Korea","DPRK2":"North Korea EO13722",
  "DPRK3":"North Korea EO13810","DPRK4":"North Korea EO13882","DRCONGO":"DR Congo",
  "ELECTION-EO13848":"Election Integrity EO13848","ETHIOPIA-EO14046":"Ethiopia EO14046",
  "GLOMAG":"Global Magnitsky","HK-EO13936":"Hong Kong EO13936","HOSTAGES-EO14078":"Hostage-Taking EO14078",
  "HRIT-IR":"Iran Human Rights","HRIT-SY":"Syria Human Rights","ICC-EO14203":"ICC EO14203",
  "IFCA":"Iran IFCA","IFSR":"Iran Financial Sanctions","ILLICIT-DRUGS-EO14059":"Narcotics EO14059",
  "IRAN":"Iran","IRAN-CON-ARMS-EO":"Iran Arms Embargo","IRAN-EO13846":"Iran EO13846",
  "IRAN-EO13876":"Iran EO13876 (metals)","IRAN-EO13902":"Iran EO13902 (manufacturing)",
  "IRAN-HR":"Iran Human Rights","IRAN-TRA":"Iran TRA","IRAQ2":"Iraq","IRAQ3":"Iraq EO13438",
  "IRGC":"IRGC","LEBANON":"Lebanon","LIBYA2":"Libya EO13726","LIBYA3":"Libya EO13566",
  "MAGNIT":"Magnitsky","MALI-EO13882":"Mali EO13882","NICARAGUA":"Nicaragua",
  "NICARAGUA-NHRAA":"Nicaragua NHRAA","NPWMD":"WMD Proliferation","PAARSSR-EO13894":"Syria EO13894",
  "RUSSIA-EO14024":"Russia EO14024 (Ukraine)","RUSSIA-EO14065":"Russia EO14065 (Donbas)",
  "SDGT":"Global Terrorists","SDNT":"Drug Traffickers","SDNTK":"Kingpin Act",
  "SOMALIA":"Somalia","SOUTH SUDAN":"South Sudan","SSIDES":"South Sudan EO13664",
  "SUDAN-EO14098":"Sudan EO14098","TCO":"Transnational Criminal Orgs",
  "UKRAINE-EO13660":"Ukraine EO13660","UKRAINE-EO13661":"Ukraine EO13661",
  "UKRAINE-EO13662":"Ukraine EO13662","UKRAINE-EO13685":"Ukraine/Crimea EO13685",
  "VENEZUELA":"Venezuela","VENEZUELA-EO13850":"Venezuela EO13850","VENEZUELA-EO13884":"Venezuela EO13884",
  "YEMEN":"Yemen","UHRPA":"Uyghur Human Rights","NS-PLC":"Palestinian Authority",
  "PEESA-EO14039":"Russia PEESA EO14039",
};
const parseProgramCodes = (p) => p ? p.split(/\]\s*\[/).map(s => s.replace(/[\[\]]/g, "").trim()).filter(Boolean) : [];
const getProgramLabel = (p) => {
  const codes = parseProgramCodes(p);
  const d = codes.map(c => PROGRAM_NAMES[c]).filter(Boolean);
  return d.length > 0 ? d.join(", ") : null;
};

const ScoreBar = ({ label, value, color }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
      <span>{label}</span><span style={{ fontWeight: 600, color: "#111827" }}>{value}</span>
    </div>
    <div style={{ height: 7, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
    </div>
  </div>
);

const Spinner = ({ size = 20, color = "#1e3a5f" }) => (
  <div style={{ width: size, height: size, border: `2px solid #e5e7eb`, borderTop: `2px solid ${color}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
);

// ── List Management View ──────────────────────────────────────────────────────
function ListManagement({ reloadList }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deltaData, setDeltaData] = useState(null);
  const [deltaLoading, setDeltaLoading] = useState(false);
  const [deltaTab, setDeltaTab] = useState("OFAC");
  const [deltaSection, setDeltaSection] = useState("added");

  useEffect(() => {
    fetch("/.netlify/functions/sanctions?action=snapshots&_=" + Date.now())
      .then(r => r.json())
      .then(d => { setSnapshots(d.snapshots || []); setLoading(false); })
      .catch(() => setLoading(false));
    loadDelta();
  }, []);

  const [updateStatus, setUpdateStatus] = useState({}); // source -> status
  const [updateMsg, setUpdateMsg] = useState("");

  const triggerUpdate = async (source) => {
    setUpdateStatus(prev => ({ ...prev, [source]: "running" }));
    setUpdateMsg("Starting update for " + source + "...");
    try {
      // Create job record
      const createRes = await fetch("/.netlify/functions/sanctions?action=create-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!createRes.ok) throw new Error("Could not create job: " + createRes.status);
      const { jobId } = await createRes.json();

      setUpdateMsg("Fetching " + source + " from source...");

      // Trigger background function
      await fetch("/.netlify/functions/update-sanctions-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, jobId }),
      });

      // Poll for status every 5 seconds
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch("/.netlify/functions/sanctions?action=job-status&job_id=" + jobId);
          const { job } = await statusRes.json();
          if (!job) return;
          setUpdateMsg(job.message || "Running...");
          if (["done", "no_change", "error"].includes(job.status)) {
            setUpdateStatus(prev => ({ ...prev, [source]: job.status }));
            clearInterval(poll);
            if (job.status === "done") {
              fetch("/.netlify/functions/sanctions?action=snapshots&_=" + Date.now())
                .then(r => r.json())
                .then(d => setSnapshots(d.snapshots || []));
              if (reloadList) reloadList();
            }
          }
        } catch (e) {}
      }, 5000);

      setTimeout(() => clearInterval(poll), 900000);

    } catch (err) {
      setUpdateStatus(prev => ({ ...prev, [source]: "error" }));
      setUpdateMsg("Failed to start update for " + source + ": " + err.message);
    }
  };

  const loadDelta = () => {
    setDeltaLoading(true);
    fetch("/.netlify/functions/sanctions?action=delta")
      .then(r => r.json())
      .then(d => { setDeltaData(d.delta); setDeltaLoading(false); })
      .catch(() => setDeltaLoading(false));
  };

  // Group snapshots by source, latest first
  const bySource = {};
  for (const s of snapshots) {
    if (!bySource[s.source]) bySource[s.source] = [];
    bySource[s.source].push(s);
  }

  const sourceColors = {
    OFAC: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", dot: "#3b82f6" },
    EU:   { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", dot: "#22c55e" },
    UN:   { bg: "#fef9ec", border: "#fcd34d", text: "#92400e", dot: "#f59e0b" },
  };

  const totalEntities = snapshots.length > 0
    ? Object.entries(bySource).reduce((sum, [, snaps]) => sum + (snaps[0]?.entity_count || 0), 0)
    : 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        {["OFAC", "EU", "UN"].map(src => {
          const snaps = bySource[src] || [];
          const latest = snaps[0];
          const prev = snaps[1];
          const col = sourceColors[src] || sourceColors.OFAC;
          const diff = latest && prev ? latest.entity_count - prev.entity_count : null;
          return (
            <div key={src} style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1.5px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: col.text, background: col.bg, border: "1px solid " + col.border, borderRadius: 6, padding: "3px 10px" }}>{src}</span>
                {loading ? <Spinner size={16} /> : null}
              </div>
              {latest ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#111827", marginBottom: 2 }}>{latest.entity_count.toLocaleString("en-US")}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>entities</div>
                  <div style={{ fontSize: 12, color: "#374151" }}>
                    <span style={{ color: "#9ca3af" }}>Published date: </span>
                    <strong>{latest.snapshot_date}</strong>
                  </div>
                  {latest.fetched_at && (
                    <div style={{ fontSize: 12, color: "#374151", marginTop: 3 }}>
                      <span style={{ color: "#9ca3af" }}>Loaded: </span>
                      {new Date(latest.fetched_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  )}
                  {diff !== null && (
                    <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: diff > 0 ? "#16a34a" : diff < 0 ? "#dc2626" : "#9ca3af" }}>
                      {diff > 0 ? "+" : ""}{diff} since {prev.snapshot_date}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, color: "#9ca3af" }}>No data</div>
              )}
              <button onClick={() => triggerUpdate(src)} disabled={updateStatus[src] === "running"} style={{
                marginTop: 14, width: "100%", padding: "7px 0", borderRadius: 7, fontSize: 12, fontWeight: 600,
                cursor: updateStatus[src] === "running" ? "not-allowed" : "pointer", fontFamily: "inherit",
                background: updateStatus[src] === "running" ? "#f3f4f6" : updateStatus[src] === "done" ? "#f0fdf4" : updateStatus[src] === "no_change" ? "#fffbeb" : col.bg,
                border: "1.5px solid " + (updateStatus[src] === "running" ? "#e5e7eb" : updateStatus[src] === "done" ? "#bbf7d0" : updateStatus[src] === "no_change" ? "#fcd34d" : col.border),
                color: updateStatus[src] === "running" ? "#9ca3af" : updateStatus[src] === "done" ? "#166534" : updateStatus[src] === "no_change" ? "#92400e" : col.text,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                {updateStatus[src] === "running" ? <><Spinner size={12} color="#9ca3af" /> Updating...</>
                 : updateStatus[src] === "done" ? "✓ Updated"
                 : updateStatus[src] === "no_change" ? "— No new data"
                 : updateStatus[src] === "error" ? "⚠ Error — retry?"
                 : "↻ Update " + src}
              </button>
            </div>
          );
        })}
      </div>

      {/* Update status message */}
      {updateMsg && Object.values(updateStatus).some(s => s) && (
        <div style={{
          marginBottom: 24, padding: "12px 18px", borderRadius: 10, fontSize: 13,
          background: Object.values(updateStatus).includes("error") ? "#fef2f2"
            : Object.values(updateStatus).includes("running") ? "#f0f7ff"
            : Object.values(updateStatus).includes("done") ? "#f0fdf4"
            : "#fffbeb",
          border: "1px solid " + (Object.values(updateStatus).includes("error") ? "#fca5a5"
            : Object.values(updateStatus).includes("running") ? "#bfdbfe"
            : Object.values(updateStatus).includes("done") ? "#bbf7d0"
            : "#fcd34d"),
          color: Object.values(updateStatus).includes("error") ? "#dc2626"
            : Object.values(updateStatus).includes("running") ? "#1e3a5f"
            : Object.values(updateStatus).includes("done") ? "#166534"
            : "#92400e",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          {Object.values(updateStatus).includes("running") && <Spinner size={16} color="#1e3a5f" />}
          {!Object.values(updateStatus).includes("running") && Object.values(updateStatus).includes("done") && "✓ "}
          {!Object.values(updateStatus).includes("running") && !Object.values(updateStatus).includes("done") && Object.values(updateStatus).includes("no_change") && "— "}
          {Object.values(updateStatus).includes("error") && "⚠ "}
          {updateMsg}
          {!Object.values(updateStatus).includes("running") && (
            <button onClick={() => { setUpdateStatus({}); setUpdateMsg(""); }} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af" }}>✕</button>
          )}
        </div>
      )}

      {/* Snapshot history table */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #e5e7eb", marginBottom: 32, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Snapshot History</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>{snapshots.length} snapshots</div>
        </div>
        {loading ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner /></div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Source", "Published date", "Loaded date", "Entities", "Version hash"].map(h => (
                  <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: 0.8, borderBottom: "1px solid #e5e7eb" }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s, i) => {
                const col = sourceColors[s.source] || sourceColors.OFAC;
                const prev = snapshots.find((p, pi) => pi > i && p.source === s.source);
                const diff = prev ? s.entity_count - prev.entity_count : null;
                const fetchedAt = s.fetched_at
                  ? new Date(s.fetched_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
                  : "—";
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "12px 20px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: col.text, background: col.bg, border: "1px solid " + col.border, borderRadius: 5, padding: "2px 8px" }}>{s.source}</span>
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <div style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{s.snapshot_date}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Published by source</div>
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <div style={{ fontSize: 13, color: "#374151" }}>{fetchedAt}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Loaded into DB</div>
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <span style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{s.entity_count.toLocaleString("en-US")}</span>
                      {diff !== null && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: diff > 0 ? "#16a34a" : diff < 0 ? "#dc2626" : "#9ca3af" }}>
                          {diff > 0 ? "+" : ""}{diff}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 20px", fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{s.version_hash ? s.version_hash.slice(0, 12) + "..." : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* List Deltas */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1.5px solid #e5e7eb", overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>List Deltas</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Latest vs previous update per source</div>
          </div>
          <button onClick={loadDelta} style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {deltaLoading ? <Spinner size={14} /> : "↻"} Refresh
          </button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          {deltaLoading && !deltaData && (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
          )}
          {deltaData && (() => {
            const sources = Object.keys(deltaData);
            const cur = deltaData[deltaTab] || deltaData[sources[0]];
            if (!cur) return null;
            const sectionCfg = [
              { key: "added",    label: "Added",    color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", icon: "+" },
              { key: "removed",  label: "Removed",  color: "#dc2626", bg: "#fef2f2", border: "#fca5a5", icon: "−" },
              { key: "modified", label: "Modified", color: "#d97706", bg: "#fffbeb", border: "#fcd34d", icon: "~" },
            ];
            return (
              <div>
                {/* Source tabs */}
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  {sources.map(src => (
                    <button key={src} onClick={() => setDeltaTab(src)} style={{
                      padding: "6px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit", border: "none",
                      background: deltaTab === src ? "#1e3a5f" : "#f3f4f6",
                      color: deltaTab === src ? "#fff" : "#374151",
                    }}>{src}</button>
                  ))}
                </div>
                {/* Snapshot comparison */}
                {cur.previous ? (
                  <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                    <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "12px 16px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 4 }}>PREVIOUS</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>{cur.previous.snapshot_date}</div>
                      <div style={{ fontSize: 12, color: "#9ca3af" }}>{cur.previous.entity_count.toLocaleString("en-US")} entities</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", color: "#9ca3af", fontSize: 20 }}>→</div>
                    <div style={{ flex: 1, background: "#f0f7ff", borderRadius: 8, padding: "12px 16px", border: "1px solid #bfdbfe" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", letterSpacing: 1, marginBottom: 4 }}>LATEST</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#1e3a5f" }}>{cur.newest.snapshot_date}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{cur.newest.entity_count.toLocaleString("en-US")} entities</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "12px 16px", background: "#f8fafc", borderRadius: 8, color: "#9ca3af", fontSize: 13, marginBottom: 20 }}>
                    No previous snapshot — this is the first import.
                  </div>
                )}
                {/* Stat cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                  {sectionCfg.map(cfg => (
                    <button key={cfg.key} onClick={() => setDeltaSection(cfg.key)} style={{
                      padding: "14px 16px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                      background: deltaSection === cfg.key ? cfg.bg : "#f9fafb",
                      border: "2px solid " + (deltaSection === cfg.key ? cfg.color : "#e5e7eb"),
                    }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: cfg.color }}>{cfg.icon} {(cur[cfg.key] || []).length}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{cfg.label} entities</div>
                    </button>
                  ))}
                </div>
                {/* Entity list */}
                {(cur[deltaSection] || []).length === 0 ? (
                  <div style={{ textAlign: "center", padding: 32, color: "#9ca3af", fontSize: 14 }}>No {deltaSection} entities</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflowY: "auto" }}>
                    {(cur[deltaSection] || []).slice(0, 200).map((row, i) => {
                      const cfg = sectionCfg.find(s => s.key === deltaSection);
                      return (
                        <div key={i} style={{ padding: "10px 14px", borderRadius: 8, background: cfg.bg, border: "1px solid " + cfg.border, display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: cfg.color, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>{cfg.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{row.name || row.entity_id}</div>
                            {deltaSection === "modified" && row.field_changed && (
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                                <span style={{ fontWeight: 600 }}>{row.field_changed}:</span>{" "}
                                <span style={{ textDecoration: "line-through", color: "#9ca3af" }}>{row.old_value}</span>
                                {" → "}
                                <span style={{ color: "#111827" }}>{row.new_value}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {(cur[deltaSection] || []).length > 200 && (
                      <div style={{ textAlign: "center", padding: 12, color: "#9ca3af", fontSize: 12 }}>
                        + {((cur[deltaSection] || []).length - 200).toLocaleString("en-US")} more...
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
  );
}

// ── Sanctions Screening View ──────────────────────────────────────────────────
function SanctionsScreening({ sanctionsList, listLoading, listError, reloadList }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const [expanded, setExpanded] = useState(null);
  const [showConfig, setShowConfig] = useState(true);
  const [entityFilter, setEntityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [activeSource, setActiveSource] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState("latest");
  const [weights, setWeights] = useState({
    jw: true,  jwVal: 25, ts: true,  tsVal: 25,
    lev: true, levVal: 15, ngr: true, ngrVal: 20, mph: true, mphVal: 15,
  });

  const setWeight = (key, val) => setWeights(w => ({ ...w, [key]: val }));
  const activeCount = [weights.jw, weights.ts, weights.lev, weights.ngr, weights.mph].filter(Boolean).length;
  const filteredList = entityFilter === "all" ? sanctionsList : sanctionsList.filter(e => e.type === entityFilter);

  useEffect(() => {
    fetch("/.netlify/functions/sanctions?action=snapshots&_=" + Date.now())
      .then(r => r.json())
      .then(data => setSnapshots(data.snapshots || []))
      .catch(() => {});
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
    const timer = setTimeout(() => { setResults(screenName(query.trim(), list, weights)); setExpanded(null); }, 300);
    return () => clearTimeout(timer);
  }, [weights]);

  const runScreen = () => {
    if (!query.trim() || sanctionsList.length === 0) return;
    setResults(screenName(query.trim(), filteredList, weights));
    setHasSearched(true);
    setAiAnalysis(null);
    setExpanded(null);
  };

  const runAiAnalysis = async () => {
    setAiLoading(true);
    setAiAnalysis(null);
    const topHits = results.filter(r => r.scores.combined >= 50).slice(0, 5);
    const hitLines = topHits.map(r =>
      "- " + r.name + " (" + (r.nationality || r.country || "unknown") + ", " + r.program + ") score: " + r.scores.combined + "/100"
    ).join("\n");
    const srcLabel = sourceFilter === "all" ? "OFAC, EU and UN" : sourceFilter === "UN" ? "UN" : sourceFilter;
    const prompt =
      "You are a sanctions screening expert at a European bank.\n\n" +
      "Customer name: \"" + query + "\" screened against: " + srcLabel + "\n\n" +
      "RESULTS:\n" + hitLines + "\n\n" +
      "Provide a professional assessment:\n" +
      "1. Is \"" + query + "\" likely the same person as anyone on the list?\n" +
      "2. Consider name variants, cultural conventions, transliteration.\n" +
      "3. Recommend: BLOCK / MANUAL REVIEW / APPROVE\n" +
      "4. Brief justification.\n\nRespond in English, concisely.";
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] })
      });
      const data = await res.json();
      setAiAnalysis(data.content?.[0]?.text || "Could not analyze.");
    } catch (e) {
      setAiAnalysis("Error: " + e.message);
    }
    setAiLoading(false);
  };

  const filtered = results.filter(r =>
    r.scores.combined >= threshold &&
    (entityFilter === "all" || r.type === entityFilter) &&
    (sourceFilter === "all" || r.source === sourceFilter)
  );

  const groupedMap = new Map();
  for (const r of filtered) {
    const key = normalize(r.name);
    if (!groupedMap.has(key)) groupedMap.set(key, { name: r.name, bySource: {} });
    const group = groupedMap.get(key);
    if (!group.bySource[r.source] || r.scores.combined > group.bySource[r.source].scores.combined) group.bySource[r.source] = r;
  }
  const grouped = Array.from(groupedMap.entries()).map(([key, { name, bySource }]) => {
    const hits = Object.values(bySource);
    return { key, name, bestScore: Math.max(...hits.map(h => h.scores.combined)), hits };
  }).sort((a, b) => b.bestScore - a.bestScore);

  const topScore = grouped[0]?.bestScore ?? 0;
  const EXAMPLES = ["Vladimir Putin", "Kim Jong Un", "Ivan Volkov", "Banco Nacional de Cuba", "Nord Stream", "Abdifatah Abdi"];

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "28px 20px" }}>

      {/* Empty state warning */}
      {sanctionsList.length === 0 && !listLoading && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#92400e" }}>
          ⚠ Sanctions list not loaded.
          <button onClick={reloadList} style={{ marginLeft: "auto", padding: "5px 14px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            ↻ Reload
          </button>
        </div>
      )}
      <div style={{ background: "#fff", borderRadius: 12, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && runScreen()}
            placeholder="Enter name to screen..."
            style={{ flex: 1, padding: "11px 14px", fontSize: 15, border: "1.5px solid #d1d5db", borderRadius: 8, color: "#111827", background: "#fff", fontFamily: "inherit" }} />
          <button onClick={runScreen} disabled={listLoading} style={{
            padding: "11px 24px", background: listLoading ? "#9ca3af" : "#1e3a5f", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
            cursor: listLoading ? "not-allowed" : "pointer", fontFamily: "inherit"
          }}>Screen</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", alignSelf: "center", marginRight: 2 }}>Try:</span>
          {EXAMPLES.map(name => (
            <button key={name} onClick={() => {
              setQuery(name);
              setResults(screenName(name, filteredList, weights));
              setHasSearched(true); setAiAnalysis(null); setExpanded(null);
            }} style={{ padding: "4px 12px", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 20, fontSize: 12, color: "#374151", cursor: "pointer", fontFamily: "inherit" }}>{name}</button>
          ))}
        </div>

        {/* Config panel */}
        <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: 0.8 }}>⚙ SCREENING CONFIGURATION</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Settings apply to all searches</span>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Source filter */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>SOURCE</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {[
                    { value: "all", label: "All", count: sanctionsList.length },
                    { value: "OFAC", label: "OFAC", count: sanctionsList.filter(e => e.source === "OFAC").length },
                    { value: "EU", label: "EU", count: sanctionsList.filter(e => e.source === "EU").length },
                    { value: "UN", label: "UN", count: sanctionsList.filter(e => e.source === "UN").length },
                  ].map(({ value, label, count }) => (
                    <button key={value} onClick={() => setSourceFilter(value)} style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                      fontWeight: sourceFilter === value ? 700 : 400,
                      background: sourceFilter === value ? "#1e3a5f" : "#fff",
                      border: "1.5px solid " + (sourceFilter === value ? "#1e3a5f" : "#cbd5e1"),
                      color: sourceFilter === value ? "#fff" : "#475569",
                      display: "flex", alignItems: "center", gap: 4
                    }}>
                      {label}
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 8, background: sourceFilter === value ? "rgba(255,255,255,0.2)" : "#f1f5f9", color: sourceFilter === value ? "#fff" : "#94a3b8" }}>{count.toLocaleString("en-US")}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Entity type filter */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>ENTITY TYPE</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {[
                    { value: "all", label: "All", count: sanctionsList.length },
                    { value: "individual", label: "Individuals", count: sanctionsList.filter(e => e.type === "individual").length },
                    { value: "organization", label: "Orgs", count: sanctionsList.filter(e => e.type === "organization").length },
                    { value: "vessel", label: "Vessels", count: sanctionsList.filter(e => e.type === "vessel").length },
                    { value: "aircraft", label: "Aircraft", count: sanctionsList.filter(e => e.type === "aircraft").length },
                  ].map(({ value, label, count }) => (
                    <button key={value} onClick={() => setEntityFilter(value)} style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                      fontWeight: entityFilter === value ? 700 : 400,
                      background: entityFilter === value ? "#1e3a5f" : "#fff",
                      border: "1.5px solid " + (entityFilter === value ? "#1e3a5f" : "#cbd5e1"),
                      color: entityFilter === value ? "#fff" : "#475569",
                      display: "flex", alignItems: "center", gap: 4
                    }}>
                      {label}
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 8, background: entityFilter === value ? "rgba(255,255,255,0.2)" : "#f1f5f9", color: entityFilter === value ? "#fff" : "#94a3b8" }}>{count.toLocaleString("en-US")}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Threshold */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>MATCH THRESHOLD</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="range" min={30} max={95} value={threshold} onChange={e => setThreshold(+e.target.value)} style={{ flex: 1, accentColor: "#1e3a5f" }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#1e3a5f", minWidth: 38 }}>{threshold}%</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 80 }}>{threshold >= 85 ? "Strict" : threshold >= 70 ? "Balanced" : "Sensitive"}</span>
                </div>
              </div>
              {/* Snapshot */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 0.8, marginBottom: 8 }}>LIST VERSION</div>
                <select value={selectedSnapshot} onChange={e => {
                  setSelectedSnapshot(e.target.value);
                  loadList(e.target.value === "latest" ? null : e.target.value);
                  setHasSearched(false); setResults([]);
                }} style={{ width: "100%", padding: "6px 10px", borderRadius: 6, fontSize: 12, border: "1.5px solid #cbd5e1", background: "#fff", color: "#374151", fontFamily: "inherit", cursor: "pointer" }}>
                  <option value="latest">Latest (current)</option>
                  {snapshots.length > 0 && (
                    <>
                      <option disabled>──────────────</option>
                      {snapshots.map(s => <option key={s.id} value={s.id}>{s.source} — {s.snapshot_date} ({s.entity_count.toLocaleString("en-US")} entities)</option>)}
                    </>
                  )}
                </select>
                {selectedSnapshot !== "latest" && (() => {
                  const snap = snapshots.find(s => s.id === selectedSnapshot);
                  return snap ? <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 4 }}>⚠ Screening against {snap.source} list from {snap.snapshot_date}</div> : null;
                })()}
              </div>
            </div>

            {/* Algorithms */}
            <div>
              <button onClick={() => setShowConfig(v => !v)} style={{ background: "none", border: "1.5px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", fontSize: 11, color: "#64748b", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                ALGORITHMS &amp; WEIGHTS
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>({activeCount}/5 active)</span>
                <span style={{ fontSize: 10 }}>{showConfig ? "▲" : "▼"}</span>
              </button>
              {showConfig && (
                <div style={{ marginTop: 10, padding: 14, background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <style>{`
                    .algo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
                    .algo-label { width: 130px; flex-shrink: 0; }
                    .algo-slider { flex: 1; max-width: 160px; }
                    .algo-raw { width: 36px; height: 28px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0; }
                    .algo-pct { width: 44px; height: 28px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
                  `}</style>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 12 }}>SELECT ALGORITHMS AND WEIGHTS — normalized automatically</div>
                  {(() => {
                    const algos = [
                      { key: "jw",  valKey: "jwVal",  label: "Jaro-Winkler",    desc: "Character similarity",     color: "#3b82f6" },
                      { key: "ts",  valKey: "tsVal",  label: "Token-sort",       desc: "Order-insensitive",        color: "#10b981" },
                      { key: "lev", valKey: "levVal", label: "Levenshtein",      desc: "Edit distance",            color: "#f59e0b" },
                      { key: "ngr", valKey: "ngrVal", label: "N-gram (trigram)", desc: "Substring overlap",        color: "#8b5cf6" },
                      { key: "mph", valKey: "mphVal", label: "Double Metaphone", desc: "Phonetic similarity",      color: "#ec4899" },
                    ];
                    const totalWeight = algos.reduce((sum, a) => sum + (weights[a.key] ? weights[a.valKey] : 0), 0);
                    return algos.map(({ key, valKey, label, desc, color }) => {
                      const normPct = totalWeight > 0 && weights[key] ? Math.round((weights[valKey] / totalWeight) * 100) : 0;
                      return (
                        <div key={key} className="algo-row">
                          <input type="checkbox" checked={weights[key]} onChange={e => setWeight(key, e.target.checked)} style={{ width: 16, height: 16, accentColor: color, cursor: "pointer", flexShrink: 0 }} />
                          <div className="algo-label">
                            <div style={{ fontSize: 13, fontWeight: 600, color: weights[key] ? "#111827" : "#9ca3af" }}>{label}</div>
                            <div style={{ fontSize: 11, color: "#9ca3af" }}>{desc}</div>
                          </div>
                          <input type="range" min={1} max={100} value={weights[valKey]} disabled={!weights[key]} onChange={e => setWeight(valKey, +e.target.value)} className="algo-slider" style={{ accentColor: color, opacity: weights[key] ? 1 : 0.3 }} />
                          <div className="algo-raw" style={{ background: weights[key] ? color : "#e5e7eb" }}>{weights[valKey]}</div>
                          <div className="algo-pct" style={{ background: weights[key] ? "#f0f7ff" : "#f9fafb", border: "1px solid " + (weights[key] ? "#bfdbfe" : "#e5e7eb"), color: weights[key] ? "#1e3a5f" : "#9ca3af" }}>{normPct}%</div>
                        </div>
                      );
                    });
                  })()}
                  <div style={{ marginTop: 10, fontSize: 12, color: "#9ca3af", borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>Combined score = weighted average of active algorithms (normalized to 100%)</div>
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
              <span style={{ fontWeight: 600, color: "#111827" }}>{grouped.length}</span> hits above {threshold}%
              {topScore >= 90 && <span style={{ marginLeft: 14, color: "#dc2626", fontWeight: 600 }}>⚠ Possible match found</span>}
              {topScore < 70 && grouped.length > 0 && <span style={{ marginLeft: 14, color: "#16a34a", fontWeight: 500 }}>✓ No strong hits</span>}
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
                {aiLoading ? <><Spinner size={13} color="#6b7280" /> Analyzing...</> : "✦ AI Assessment"}
              </button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {filtered.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 10, padding: "48px", textAlign: "center", color: "#6b7280", fontSize: 14, border: "1px solid #e5e7eb" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                No hits above {threshold}% — not found on {sourceFilter === "all" ? "any sanctions list" : sourceFilter + " sanctions list"}
              </div>
            )}
            {grouped.map((group, i) => {
              const r = group.hits.find(h => h.source === (activeSource[group.key] || group.hits[0].source)) || group.hits[0];
              const risk = getRisk(group.bestScore);
              const isOpen = expanded === group.key;
              const programDesc = getProgramLabel(r.program);
              return (
                <div key={group.key} style={{ animationDelay: i * 30 + "ms", background: risk.bg, border: "1.5px solid " + risk.border, borderRadius: 10, overflow: "hidden" }}>
                  <div onClick={() => setExpanded(isOpen ? null : group.key)} style={{ padding: "15px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                    <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#fff", border: "2px solid " + risk.border, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 17, fontWeight: 700, color: risk.scoreColor, lineHeight: 1 }}>{group.bestScore}</span>
                      <span style={{ fontSize: 9, color: "#9ca3af" }}>/ 100</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {r.name}
                        {r.type && r.type !== "individual" && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "#f5f3ff", color: "#5b21b6", border: "1px solid #ddd6fe", textTransform: "uppercase", letterSpacing: 0.5 }}>{r.type}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {group.hits.map(h => {
                          const isActive = h.source === (activeSource[group.key] || group.hits[0].source);
                          const srcC = { OFAC: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe", activeBg: "#1e40af" }, EU: { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0", activeBg: "#166534" }, UN: { bg: "#fef9ec", color: "#92400e", border: "#fcd34d", activeBg: "#92400e" } }[h.source] || { bg: "#f3f4f6", color: "#374151", border: "#d1d5db", activeBg: "#374151" };
                          return (
                            <span key={h.source} onClick={e => { e.stopPropagation(); setActiveSource(prev => ({ ...prev, [group.key]: h.source })); if (!isOpen) setExpanded(group.key); }}
                              style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 10, background: isActive ? srcC.activeBg : srcC.bg, color: isActive ? "#fff" : srcC.color, border: "1.5px solid " + (isActive ? srcC.activeBg : srcC.border), textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer" }}>
                              {h.source} {h.scores.combined}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ textAlign: "center", flexShrink: 0, minWidth: 36 }}>
                      <div style={{ fontSize: 22 }}>{flagEmoji(r.nationality || r.country)}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{r.nationality || r.country || "—"}</div>
                    </div>
                    <span style={{ padding: "5px 13px", borderRadius: 20, background: risk.badge, color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{risk.label}</span>
                    <span style={{ color: "#9ca3af", fontSize: 16, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>▼</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "16px 18px 20px", borderTop: "1px solid " + risk.border, background: "#fff" }}>
                      <div style={{ marginBottom: 14, fontSize: 12, color: "#6b7280" }}>
                        Showing data from: <strong style={{ color: "#1e3a5f" }}>{r.source}</strong>
                        {group.hits.length > 1 && <span style={{ marginLeft: 6, color: "#9ca3af" }}>— click source badge above to switch</span>}
                      </div>
                      {programDesc && (
                        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0f7ff", borderRadius: 6, fontSize: 13, color: "#1e3a5f" }}>
                          <strong>{r.program}</strong><br /><span style={{ color: "#374151" }}>{programDesc}</span>
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 20 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 10 }}>PERSONAL DETAILS</div>
                          {[
                            ["Full name", r.name], ["Type", r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : null],
                            ["Title", r.title], ["Gender", r.gender === "Male" ? "Male" : r.gender === "Female" ? "Female" : null],
                            ["Date of birth", r.dob], ["Place of birth", r.pob], ["Nationality", r.nationality],
                            ["Matched on", '"' + r.matchedName + '"'],
                            [r.source === "OFAC" ? "OFAC ID" : r.source === "EU" ? "EU Ref" : "UN Ref", r.id],
                          ].filter(([, v]) => v).map(([label, value]) => (
                            <div key={label} style={{ marginBottom: 6 }}>
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>{label}</span>
                              <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{value}</div>
                            </div>
                          ))}
                        </div>
                        <div>
                          {r.aliases?.length > 0 && (
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>ALIASES / AKA</div>
                              {r.aliases.map((a, i) => <div key={i} style={{ fontSize: 13, color: "#374151", padding: "3px 0", borderBottom: "1px solid #f3f4f6" }}>{a}</div>)}
                            </div>
                          )}
                          {r.addresses?.length > 0 && (
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>ADDRESSES</div>
                              {r.addresses.map((a, i) => <div key={i} style={{ fontSize: 13, color: "#374151", padding: "3px 0", borderBottom: "1px solid #f3f4f6" }}>📍 {a}</div>)}
                            </div>
                          )}
                          {r.passports?.length > 0 && (
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>PASSPORTS</div>
                              {r.passports.map((p, i) => <div key={i} style={{ fontSize: 13, color: "#374151" }}>🛂 {p.number} ({p.country})</div>)}
                            </div>
                          )}
                          {r.national_ids?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 8 }}>ID NUMBERS</div>
                              {r.national_ids.map((n, i) => <div key={i} style={{ fontSize: 13, color: "#374151" }}>🪲 {n.number}{n.country ? " (" + n.country + ")" : ""}</div>)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 12 }}>MATCH SCORES</div>
                        <ScoreBar label="Jaro-Winkler — character similarity" value={r.scores.jaroWinkler} color="#3b82f6" />
                        <ScoreBar label="Token-sort — order-insensitive" value={r.scores.tokenSort} color="#10b981" />
                        <ScoreBar label="Levenshtein — edit distance" value={r.scores.levenshtein} color="#f59e0b" />
                        <ScoreBar label="N-gram (trigram) — substring overlap" value={r.scores.ngram} color="#8b5cf6" />
                        <ScoreBar label="Double Metaphone — phonetic" value={r.scores.metaphone} color="#ec4899" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {aiAnalysis && (
            <div style={{ background: "#fff", border: "1.5px solid #bfdbfe", borderRadius: 10, padding: "22px 24px", animation: "fadeIn 0.3s ease" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e3a5f", marginBottom: 12 }}>✦ AI Assessment — Infotrek AI</div>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: "#374151", whiteSpace: "pre-wrap" }}>{aiAnalysis}</div>
            </div>
          )}
        </div>
      )}

      {!hasSearched && (
        <div style={{ background: "#fff", borderRadius: 12, padding: "56px", textAlign: "center", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🛡</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Enter a name to screen</div>
          <div style={{ fontSize: 13, color: "#9ca3af" }}>
            {listLoading ? "Loading sanctions lists..." : (() => {
              const ofac = sanctionsList.filter(e => e.source === "OFAC").length;
              const eu = sanctionsList.filter(e => e.source === "EU").length;
              const un = sanctionsList.filter(e => e.source === "UN").length;
              return "Screening against " + sanctionsList.length.toLocaleString("en-US") + " entities · OFAC " + ofac.toLocaleString("en-US") + " · EU " + eu.toLocaleString("en-US") + " · UN " + un.toLocaleString("en-US") + " · 5 algorithms + Infotrek AI";
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("screening");
  const [sanctionsList, setSanctionsList] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // Ladda sanctions-data en gång på App-nivå
  useEffect(() => {
    fetch("/.netlify/functions/sanctions")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(data => {
        const entries = data.entries || data;
        if (Array.isArray(entries) && entries.length > 0) {
          setSanctionsList(entries);
          setListLoading(false);
        } else {
          // Cachat svar var tomt — hämta färskt direkt
          return fetch("/.netlify/functions/sanctions?_=" + Date.now())
            .then(r => r.json())
            .then(data2 => {
              const entries2 = data2.entries || data2;
              setSanctionsList(Array.isArray(entries2) ? entries2 : []);
              setListLoading(false);
            });
        }
      })
      .catch(err => { setListError(err.message); setListLoading(false); });
  }, []);

  // Retry med cache-busting om listan är tom
  useEffect(() => {
    if (sanctionsList.length === 0 && !listLoading && !listError) {
      const timer = setTimeout(() => {
        setListLoading(true);
        fetch("/.netlify/functions/sanctions?_=" + Date.now())
          .then(r => r.json())
          .then(data => {
            const entries = data.entries || data;
            setSanctionsList(Array.isArray(entries) ? entries : []);
            setListLoading(false);
          })
          .catch(() => setListLoading(false));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [sanctionsList.length, listLoading, listError]);

  const reloadList = () => {
    setListLoading(true);
    setListError(null);
    fetch("/.netlify/functions/sanctions?_=" + Date.now())
      .then(r => r.json())
      .then(data => {
        const entries = data.entries || data;
        setSanctionsList(Array.isArray(entries) ? entries : []);
        setListLoading(false);
      })
      .catch(err => { setListError(err.message); setListLoading(false); });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        input:focus { outline: 2px solid #1e3a5f; outline-offset: 1px; }
      `}</style>

      {/* Header + Navbar */}
      <div style={{ background: "#1e3a5f", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0" }}>
            <span style={{ fontSize: 22 }}>🛡</span>
            <div>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: 0.3 }}>Infotrek Sanctions Screening</div>
              <div style={{ color: "#93c5fd", fontSize: 11 }}>Powered by Infotrek AI</div>
            </div>
          </div>
          {/* Nav tabs */}
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { key: "screening",   label: "Sanctions Screening", icon: "🔍" },
              { key: "management",  label: "List Management",     icon: "📊" },
            ].map(({ key, label, icon }) => (
              <button key={key} onClick={() => setPage(key)} style={{
                padding: "16px 20px", background: page === key ? "rgba(255,255,255,0.12)" : "transparent",
                border: "none", borderBottom: page === key ? "3px solid #60a5fa" : "3px solid transparent",
                color: page === key ? "#fff" : "#93c5fd", fontSize: 13, fontWeight: page === key ? 700 : 500,
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7,
                transition: "all 0.15s"
              }}>{icon} {label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Page content */}
      {page === "screening"  && <SanctionsScreening sanctionsList={sanctionsList} listLoading={listLoading} listError={listError} reloadList={reloadList} />}
      {page === "management" && <ListManagement sanctionsList={sanctionsList} reloadList={reloadList} />}

      {/* Footer */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 20px 40px" }}>
        <div style={{ borderRadius: 12, overflow: "hidden" }}>
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
            <line x1="90" y1="90" x2="90" y2="31" stroke="#4a9eff" strokeWidth="1" opacity="0.8"/>
            <line x1="90" y1="90" x2="147" y2="60" stroke="#4a9eff" strokeWidth="1" opacity="0.5"/>
            <line x1="90" y1="90" x2="149" y2="112" stroke="#7bbfff" strokeWidth="1.5" opacity="0.9"/>
            <line x1="90" y1="90" x2="32" y2="115" stroke="#4a9eff" strokeWidth="1" opacity="0.5"/>
            <path d="M90 46 L128 63 L128 98 Q128 120 90 132 Q52 120 52 98 L52 63 Z" fill="#162d54" stroke="#2a5298" strokeWidth="1.5"/>
            <polyline points="76,92 88,104 108,78" fill="none" stroke="#4a9eff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="90" cy="90" r="3" fill="#4a9eff"/>
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
    </div>
  );
}
