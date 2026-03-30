// netlify/functions/sanctions.js
// Hämtar alla aktiva entiteter från Supabase via RPC-funktion

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Supabase miljövariabler saknas");
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_sanctions_entries`, {
      method: "POST",
      headers: {
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase RPC fel: ${res.status} – ${text}`);
    }

    const rows = await res.json();

    const entries = rows.map(r => ({
      id:          r.canonical_id,
      name:        r.primary_name,
      type:        r.entity_type,
      program:     r.program,
      nationality: r.nationality,
      dob:         r.dob,
      source:      r.source,
      aliases:     r.aliases || [],
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type":  "application/json",
        "Cache-Control": "public, max-age=3600",
      },
      body: JSON.stringify({
        meta: {
          count:   entries.length,
          sources: ["OFAC", "EU", "UN"],
        },
        entries,
      }),
    };
  } catch (err) {
    console.error("Sanctions function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
