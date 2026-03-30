// netlify/functions/sanctions.js
// Hämtar alla entiteter med namn och alias från Supabase

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Supabase miljövariabler saknas");
    }

    const PAGE_SIZE = 1000;
    let allRows = [];
    let offset  = 0;

    while (true) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_sanctions_entries`, {
        method: "POST",
        headers: {
          "apikey":        SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ p_offset: offset, p_limit: PAGE_SIZE }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase RPC fel: ${res.status} – ${text}`);
      }

      const rows = await res.json();
      allRows = allRows.concat(rows);

      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const entries = allRows.map(r => ({
      id:          r.canonical_id,
      name:        r.primary_name,
      type:        r.entity_type,
      program:     r.program,
      nationality: r.nationality,
      dob:         r.dob,
      source:      r.source,
      aliases:     r.aliases || [],
    }));

    return new Response(JSON.stringify({
      meta: { count: entries.length, sources: ["OFAC", "EU", "UN"] },
      entries,
    }), {
      status: 200,
      headers: {
        "Content-Type":  "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });

  } catch (err) {
    console.error("Sanctions function error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
