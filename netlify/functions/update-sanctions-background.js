// netlify/functions/update-sanctions.js
// Background Function — runs up to 15 minutes asynchronously
// Body: { "source": "OFAC" | "EU" | "UN" | "ALL", "jobId": "uuid" }

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const EU_URL = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";
const UN_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function sb(method, path, body = null, prefer = "return=representation") {
  const opts = {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": prefer,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${txt}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function updateJob(jobId, status, message) {
  if (!jobId) return;
  try {
    await sb("PATCH", `update_job?id=eq.${jobId}`, {
      status,
      message,
      completed_at: status !== "running" ? new Date().toISOString() : null,
    });
  } catch (e) {
    console.error("Could not update job status:", e.message);
  }
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function clean(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (["", "na", "n/a", "unknown", "-0-"].includes(s.toLowerCase())) return null;
  return s;
}

function getAttr(str, attr) {
  const re = new RegExp(`${attr}="([^"]*)"`, "i");
  const m = str.match(re);
  return m ? m[1] : null;
}

function getTagContent(xml, tag) {
  const re = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const matches = [];
  let m;
  while ((m = re.exec(xml)) !== null) matches.push(m[1]);
  return matches;
}

function parseXmlText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

// ── OFAC parser ───────────────────────────────────────────────────────────────
async function loadOfac() {
  console.log("Fetching OFAC...");
  // Use official OFAC SDN XML feed
  const res = await fetch("https://www.treasury.gov/ofac/downloads/sdn.xml", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Infotrek-Sanctions/1.0)" }
  });
  if (!res.ok) throw new Error(`OFAC fetch failed: ${res.status}`);
  const xml = await res.text();
  if (xml.trim().startsWith("<html") || xml.trim().startsWith("<!DOCTYPE")) {
    throw new Error("OFAC returned HTML instead of XML — may be rate limited");
  }

  const today = new Date().toISOString().slice(0, 10);
  const entries = {};

  // Parse SDN entries from XML
  const sdnBlocks = getTagContent(xml, "sdnEntry");
  for (const block of sdnBlocks) {
    const uid = parseXmlText(block, "uid");
    if (!uid) continue;
    const lastName  = clean(parseXmlText(block, "lastName")  || "");
    const firstName = clean(parseXmlText(block, "firstName") || "");
    const name = firstName ? firstName + " " + lastName : lastName;
    if (!name.trim()) continue;

    const sdnType = parseXmlText(block, "sdnType") || "";
    const type = sdnType === "Individual" ? "individual"
               : sdnType === "Entity"     ? "organization"
               : sdnType === "Vessel"     ? "vessel"
               : sdnType === "Aircraft"   ? "aircraft" : "unknown";

    // Programs
    const progBlocks = getTagContent(block, "program");
    const program = progBlocks.join("] [");

    // Aliases (akas)
    const akaBlocks = getTagContent(block, "aka");
    const aliases = akaBlocks.map(a => {
      const aLast  = clean(parseXmlText(a, "lastName")  || "");
      const aFirst = clean(parseXmlText(a, "firstName") || "");
      return aFirst ? aFirst + " " + aLast : aLast;
    }).filter(Boolean);

    // DOB
    const dob = clean(parseXmlText(block, "dateOfBirthItem") || parseXmlText(block, "dateOfBirth") || "");

    // Nationality
    const nationality = clean(parseXmlText(block, "nationality") || "");

    const fp = sha256(JSON.stringify({ name, program, type, dob, nationality, aliases: [...aliases].sort() }));
    entries[uid] = { id: uid, name, type, program, dob, nationality, aliases, _fingerprint: fp };
  }

  console.log(`  OFAC: ${Object.keys(entries).length} entries, date: ${today}`);
  return { entries, sourceDate: today, downloadUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml" };
}

// ── EU parser ─────────────────────────────────────────────────────────────────
async function loadEu() {
  console.log("Fetching EU...");
  const res = await fetch(EU_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Infotrek-Sanctions/1.0)" } });
  if (!res.ok) throw new Error(`EU fetch failed: ${res.status}`);
  const xml = await res.text();

  if (xml.trim().startsWith("<html") || xml.trim().startsWith("<!DOCTYPE")) {
    throw new Error("EU returned HTML instead of XML");
  }

  console.log("  EU XML first 200 chars:", xml.slice(0, 200));

  const genDateMatch = xml.match(/generationDate="([^"]+)"/);
  const sourceDate = genDateMatch ? genDateMatch[1].slice(0, 10) : new Date().toISOString().slice(0, 10);

  // EU XML uses namespaces — strip all namespace prefixes for simpler parsing
  const stripped = xml.replace(/<([\/]?)[\w]+:/g, "<$1");

  const entityBlocks = getTagContent(stripped, "sanctionEntity");
  console.log(`  Found ${entityBlocks.length} sanctionEntity blocks`);

  const entries = {};

  for (const block of entityBlocks) {
    const euRef = getAttr(block, "euReferenceNumber");
    const logId = getAttr(block, "logicalId");
    const id = euRef || ("EU-" + logId);

    const nameAliasBlocks = getTagContent(block, "nameAlias");
    let primaryName = null;
    const aliases = [];
    for (const na of nameAliasBlocks) {
      const whole = getAttr(na, "wholeName");
      const strong = getAttr(na, "strong");
      if (!whole) continue;
      if (strong === "true" && !primaryName) primaryName = whole.trim();
      else aliases.push(whole.trim());
    }
    if (!primaryName && nameAliasBlocks.length > 0) primaryName = getAttr(nameAliasBlocks[0], "wholeName")?.trim();
    if (!primaryName) continue;

    const subtypeBlock = block.match(/<subjectType[^>]*/)?.[0] || "";
    const cc = getAttr(subtypeBlock, "classificationCode") || "";
    const type = { P: "individual", E: "organization", V: "vessel" }[cc] || "unknown";

    const regBlock = block.match(/<regulation[^>]*/)?.[0] || "";
    const program = getAttr(regBlock, "programme") || null;

    let dob = null;
    const bdBlocks = block.match(/<birthdate[^>]*/g) || [];
    for (const bd of bdBlocks) {
      const d = getAttr(bd, "birthdate") || getAttr(bd, "year");
      if (d) { dob = d; break; }
    }

    const citBlock = block.match(/<citizenship[^>]*/)?.[0] || "";
    const nationality = getAttr(citBlock, "countryDescription") || null;

    const fp = sha256(JSON.stringify({ name: primaryName, program, type, dob, nationality, aliases: [...aliases].sort() }));
    entries[id] = { id, name: primaryName, type, program, dob, nationality, aliases, _fingerprint: fp };
  }

  console.log(`  EU: ${Object.keys(entries).length} entries, date: ${sourceDate}`);
  return { entries, sourceDate, downloadUrl: EU_URL };
}

// ── UN parser ─────────────────────────────────────────────────────────────────
async function loadUn() {
  console.log("Fetching UN...");
  const res = await fetch(UN_URL, { headers: { "User-Agent": "Infotrek-Sanctions-Screening/1.0" } });
  if (!res.ok) throw new Error(`UN fetch failed: ${res.status}`);
  const xml = await res.text();

  const genMatch = xml.match(/dateGenerated="([^"]+)"/) || xml.match(/date="([^"]+)"/);
  const sourceDate = genMatch ? genMatch[1].slice(0, 10) : new Date().toISOString().slice(0, 10);

  const entries = {};

  function processBlock(block, etype) {
    const ref = clean(parseXmlText(block, "REFERENCE_NUMBER") || parseXmlText(block, "DATAID") || "");
    const first = clean(parseXmlText(block, "FIRST_NAME") || "");
    if (!first) return;
    const id = ref || ("UN-" + etype.slice(0, 3).toUpperCase() + "-" + Math.random().toString(36).slice(2, 10));
    const parts = [first, clean(parseXmlText(block, "SECOND_NAME")), clean(parseXmlText(block, "THIRD_NAME")), clean(parseXmlText(block, "FOURTH_NAME"))].filter(Boolean);
    const name = parts.join(" ");
    const program = clean(parseXmlText(block, "UN_LIST_TYPE"));
    const nat = clean(parseXmlText(block, "VALUE"));
    let dob = null;
    const dobBlocks = getTagContent(block, etype.toUpperCase() + "_DATE_OF_BIRTH");
    for (const db of dobBlocks) {
      const d = clean(parseXmlText(db, "DATE") || parseXmlText(db, "YEAR") || "");
      if (d) { dob = d; break; }
    }
    const fp = sha256(JSON.stringify({ name, program, type: etype, dob, nationality: nat, aliases: [] }));
    entries[id] = { id, name, type: etype, program, dob, nationality: nat, aliases: [], _fingerprint: fp };
  }

  for (const b of getTagContent(xml, "INDIVIDUAL")) processBlock(b, "individual");
  for (const b of getTagContent(xml, "ENTITY"))     processBlock(b, "organization");

  console.log(`  UN: ${Object.keys(entries).length} entries, date: ${sourceDate}`);
  return { entries, sourceDate, downloadUrl: UN_URL };
}

// ── Update logic ──────────────────────────────────────────────────────────────
async function updateSource(source, entries, sourceDate, downloadUrl) {
  console.log(`\n=== Updating ${source} ===`);
  const now = new Date().toISOString();

  // Compute version hash
  const fingerprints = {};
  for (const [k, v] of Object.entries(entries)) fingerprints[k] = v._fingerprint;
  const versionHash = sha256(JSON.stringify(fingerprints, Object.keys(fingerprints).sort()));

  // Check if already imported
  const existing = await sb("GET", `list_snapshot?select=id&source=eq.${source}&version_hash=eq.${versionHash}`);
  if (existing && existing.length > 0) {
    console.log(`  No changes since last import.`);
    return { skipped: true, source };
  }

  // Get active entities
  const activeRows = await sb("GET", `entity?select=id,canonical_id,primary_name&source=eq.${source}&is_active=eq.true`);
  const activeMap = {};
  const nameMap = {};
  for (const r of activeRows || []) { activeMap[r.canonical_id] = r.id; nameMap[r.id] = r.primary_name; }

  // Get current versions (batch — max 500 at a time)
  const activeIds = Object.values(activeMap);
  const versionMap = {};
  for (let i = 0; i < activeIds.length; i += 400) {
    const batch = activeIds.slice(i, i + 400);
    const vRows = await sb("GET", `entity_version?select=id,entity_id,program,dob,nationality&entity_id=in.(${batch.join(",")})&valid_to=is.null`);
    for (const r of vRows || []) versionMap[r.entity_id] = r;
  }

  const existingIds = new Set(Object.keys(activeMap));
  const newIds = new Set(Object.keys(entries));
  const addedIds   = [...newIds].filter(id => !existingIds.has(id));
  const removedIds = [...existingIds].filter(id => !newIds.has(id));
  const commonIds  = [...newIds].filter(id => existingIds.has(id));

  console.log(`  Added: ${addedIds.length}, Removed: ${removedIds.length}, Common: ${commonIds.length}`);

  // Create snapshot
  const snapResult = await sb("POST", "list_snapshot", {
    source, snapshot_date: sourceDate, version_hash: versionHash,
    entity_count: Object.keys(entries).length, download_url: downloadUrl,
    fetched_at: now,
  });
  const snapshotId = snapResult[0].id;

  const deltaRows = [];

  // REMOVED
  for (const cid of removedIds) {
    const entityId = activeMap[cid];
    const ver = versionMap[entityId];
    if (ver) await sb("PATCH", `entity_version?id=eq.${ver.id}`, { valid_to: now });
    await sb("PATCH", `entity?id=eq.${entityId}`, { is_active: false, last_seen_at: now });
    deltaRows.push({ snapshot_id: snapshotId, entity_id: entityId, change_type: "removed", field_changed: null, old_value: nameMap[entityId] || null, new_value: null, logged_at: now });
  }

  // ADDED
  for (const cid of addedIds) {
    const e = entries[cid];
    const existingInactive = await sb("GET", `entity?select=id&canonical_id=eq.${encodeURIComponent(cid)}&source=eq.${source}&is_active=eq.false`);
    let entityId;
    if (existingInactive && existingInactive.length > 0) {
      entityId = existingInactive[0].id;
      await sb("PATCH", `entity?id=eq.${entityId}`, { is_active: true, last_seen_at: now, primary_name: e.name });
    } else {
      const newEnt = await sb("POST", "entity", { canonical_id: cid, source, entity_type: e.type || "unknown", primary_name: e.name, first_seen_at: now, last_seen_at: now, is_active: true }, "resolution=ignore-duplicates");
      entityId = newEnt?.[0]?.id;
      if (!entityId) {
        // Already exists — fetch it
        const found = await sb("GET", `entity?select=id&canonical_id=eq.${encodeURIComponent(cid)}&source=eq.${source}`);
        entityId = found?.[0]?.id;
      }
    }
    const newVer = await sb("POST", "entity_version", { entity_id: entityId, snapshot_id: snapshotId, program: e.program, dob: e.dob || null, nationality: e.nationality || null, valid_from: now, valid_to: null });
    const versionId = newVer[0].id;
    await sb("POST", "name", { entity_version_id: versionId, name_type: "primary", full_name: e.name, language: null });
    for (const alias of (e.aliases || [])) {
      if (alias) await sb("POST", "name", { entity_version_id: versionId, name_type: "alias", full_name: alias, language: null });
    }
    deltaRows.push({ snapshot_id: snapshotId, entity_id: entityId, change_type: "added", field_changed: null, old_value: null, new_value: e.name, logged_at: now });
  }

  // MODIFIED & UNCHANGED
  let modifiedCount = 0;
  const WATCH = [["name", "primary_name", "name"], ["program", "program", "program"], ["dob", "dob", "dob"], ["nationality", "nationality", "nationality"]];

  for (const cid of commonIds) {
    const e = entries[cid];
    const entityId = activeMap[cid];
    const ver = versionMap[entityId];
    const changedFields = [];
    for (const [label, oldKey, newKey] of WATCH) {
      const oldVal = oldKey === "primary_name" ? nameMap[entityId] : ver?.[oldKey];
      const newVal = e[newKey];
      if (oldVal !== newVal) changedFields.push([label, oldVal, newVal]);
    }
    if (changedFields.length > 0) {
      if (ver) await sb("PATCH", `entity_version?id=eq.${ver.id}`, { valid_to: now });
      await sb("PATCH", `entity?id=eq.${entityId}`, { last_seen_at: now, primary_name: e.name });
      const newVer = await sb("POST", "entity_version", { entity_id: entityId, snapshot_id: snapshotId, program: e.program, dob: e.dob || null, nationality: e.nationality || null, valid_from: now, valid_to: null });
      const newVerId = newVer[0].id;
      await sb("POST", "name", { entity_version_id: newVerId, name_type: "primary", full_name: e.name, language: null });
      for (const alias of (e.aliases || [])) {
        if (alias) await sb("POST", "name", { entity_version_id: newVerId, name_type: "alias", full_name: alias, language: null });
      }
      for (const [label, oldVal, newVal] of changedFields) {
        deltaRows.push({ snapshot_id: snapshotId, entity_id: entityId, change_type: "modified", field_changed: label, old_value: oldVal != null ? String(oldVal) : null, new_value: newVal != null ? String(newVal) : null, logged_at: now });
      }
      modifiedCount++;
    } else {
      await sb("PATCH", `entity?id=eq.${entityId}`, { last_seen_at: now });
    }
  }

  // DELTA LOG — batch insert
  for (let i = 0; i < deltaRows.length; i += 100) {
    await sb("POST", "delta_log", deltaRows.slice(i, i + 100));
  }

  console.log(`  Modified: ${modifiedCount}, Delta rows: ${deltaRows.length}`);
  return { skipped: false, source, added: addedIds.length, removed: removedIds.length, modified: modifiedCount };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async (req) => {
  console.log("update-sanctions started");

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing env vars");
    return;
  }

  let source = "ALL";
  let jobId = null;
  try {
    const body = await req.json();
    source = body.source || "ALL";
    jobId  = body.jobId  || null;
  } catch (e) {}

  const sources = source === "ALL" ? ["OFAC", "EU", "UN"] : [source];
  const results = [];

  for (const src of sources) {
    try {
      await updateJob(jobId, "running", "Loading " + src + " from source...");
      let data;
      if (src === "OFAC") data = await loadOfac();
      else if (src === "EU")  data = await loadEu();
      else if (src === "UN")  data = await loadUn();
      await updateJob(jobId, "running", "Updating " + src + " database...");
      const result = await updateSource(src, data.entries, data.sourceDate, data.downloadUrl);
      results.push(result);
    } catch (err) {
      console.error(`Error updating ${src}:`, err.message);
      results.push({ source: src, error: err.message });
      await updateJob(jobId, "error", src + " failed: " + err.message);
      return;
    }
  }

  // Build final status message
  const msg = results.map(r => {
    if (r.error)   return r.source + ": Error — " + r.error;
    if (r.skipped) return r.source + ": No new data available";
    return r.source + ": +" + r.added + " added, -" + r.removed + " removed, ~" + r.modified + " modified";
  }).join(" | ");

  const allSkipped = results.every(r => r.skipped);
  await updateJob(jobId, allSkipped ? "no_change" : "done", msg);
  console.log("Completed:", msg);
};

export const config = { type: "async" };
