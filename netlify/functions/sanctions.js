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

    // Hämta entiteter - filtrera på snapshot_id om angivet
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
