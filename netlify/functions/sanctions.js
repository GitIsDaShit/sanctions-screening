// netlify/functions/sanctions.js
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function rpc(name, params) {
  const PAGE_SIZE = 1000;
  let allRows = [];
  let offset  = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ ...params, p_offset: offset, p_limit: PAGE_SIZE }),
    });
    if (!res.ok) throw new Error(`Supabase RPC ${name} fel: ${res.status} – ${await res.text()}`);
    const rows = await res.json();
    allRows = allRows.concat(rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows;
}

export default async (req) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase miljövariabler saknas");

    const url        = new URL(req.url);
    const action     = url.searchParams.get("action") || "entries";
    const snapshotId = url.searchParams.get("snapshot_id") || null;

    // Hämta snapshots för dropdown - direkt från tabellen, ingen RPC behövs
    if (action === "snapshots") {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/list_snapshot?select=id,source,snapshot_date,entity_count&order=snapshot_date.desc,source.asc`,
        {
          headers: {
            "apikey":        SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (!res.ok) throw new Error(`Supabase snapshots fel: ${res.status}`);
      const snapshots = await res.json();
      return new Response(JSON.stringify({ snapshots }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }

    // Beräkna delta mellan senaste och föregående snapshot per källa
    if (action === "delta") {
      // Hämta alla snapshots sorterade per källa och datum
      const snapRes = await fetch(
        `${SUPABASE_URL}/rest/v1/list_snapshot?select=id,source,snapshot_date,entity_count,fetched_at&order=fetched_at.desc`,
        { headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      if (!snapRes.ok) throw new Error("Kunde inte hämta snapshots");
      const allSnaps = await snapRes.json();

      // Per källa: hitta senaste snapshot, sedan senaste med ANNAT datum som "föregående"
      const bySource = {};
      for (const s of allSnaps) {
        if (!bySource[s.source]) bySource[s.source] = { newest: null, previous: null };
        const entry = bySource[s.source];
        if (!entry.newest) {
          entry.newest = s;
        } else if (!entry.previous && s.snapshot_date !== entry.newest.snapshot_date) {
          entry.previous = s;
        }
      }

      const results = {};
      for (const [src, { newest, previous }] of Object.entries(bySource)) {
        if (!newest) continue;
        if (!previous) {
          results[src] = { newest, previous: null, added: [], removed: [], modified: [] };
          continue;
        }

        // Hämta delta_log för senaste snapshot
        const deltaRes = await fetch(
          `${SUPABASE_URL}/rest/v1/delta_log?select=id,entity_id,change_type,field_changed,old_value,new_value,logged_at&snapshot_id=eq.${newest.id}&order=change_type.asc,logged_at.desc`,
          { headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` } }
        );
        if (!deltaRes.ok) throw new Error("Kunde inte hämta delta_log för " + src);
        const deltaRows = await deltaRes.json();

        // Hämta entitetsnamn för berörda entity_ids
        const entityIds = [...new Set(deltaRows.map(d => d.entity_id))].slice(0, 500);
        let entityNames = {};
        if (entityIds.length > 0) {
          const entRes = await fetch(
            `${SUPABASE_URL}/rest/v1/entity?select=id,primary_name&id=in.(${entityIds.join(",")})`,
            { headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` } }
          );
          if (entRes.ok) {
            const ents = await entRes.json();
            for (const e of ents) entityNames[e.id] = e.primary_name;
          }
        }

        const enrich = rows => rows.map(d => ({ ...d, name: entityNames[d.entity_id] || d.entity_id }));

        results[src] = {
          newest,
          previous,
          added:    enrich(deltaRows.filter(d => d.change_type === "added")),
          removed:  enrich(deltaRows.filter(d => d.change_type === "removed")),
          modified: enrich(deltaRows.filter(d => d.change_type === "modified")),
        };
      }

      return new Response(JSON.stringify({ delta: results }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }


    const params = snapshotId ? { p_snapshot_id: snapshotId } : {};
    const rows = await rpc("get_sanctions_entries", params);

    const entries = rows.map(r => ({
      id:           r.canonical_id,
      name:         r.primary_name,
      type:         r.entity_type,
      program:      r.program,
      nationality:  r.nationality,
      dob:          r.dob,
      pob:          r.pob,
      gender:       r.gender,
      title:        r.title,
      source:       r.source,
      aliases:      r.aliases      || [],
      addresses:    r.addresses    || [],
      passports:    r.passports    || [],
      national_ids: r.national_ids || [],
    }));

    return new Response(JSON.stringify({
      meta: { count: entries.length, snapshot_id: snapshotId },
      entries,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });

  } catch (err) {
    console.error("Sanctions function error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
