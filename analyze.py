"""
analyze.py
----------
Kör ANALYZE, skapar index och uppdaterar RPC-funktionen.
Kör alltid efter TRUNCATE eller ny dataladdning.

Kör med:
    python analyze.py
"""

import psycopg2

DB_HOST     = "aws-1-eu-west-2.pooler.supabase.com"
DB_PORT     = 5432
DB_NAME     = "postgres"
DB_USER     = "postgres.byfyjwhzixtgbwxhpbql"
DB_PASSWORD = "Tamburin253314"

def main():
    print("Ansluter till databasen...")
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
        connect_timeout=30, options="-c statement_timeout=0"
    )
    conn.autocommit = True
    cur = conn.cursor()

    # ANALYZE
    tables = ["entity", "entity_version", "name", "address", "document", "list_snapshot", "delta_log"]
    for table in tables:
        print(f"  ANALYZE {table}...")
        cur.execute(f"ANALYZE {table}")

    # Index
    print("Skapar index...")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_entity_version_entity ON entity_version(entity_id) WHERE valid_to IS NULL;")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_entity_active_source ON entity(source, is_active) WHERE is_active = true;")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_entity_primary_name ON entity(primary_name) WHERE is_active = true;")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_name_version ON name(entity_version_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_name_version_alias ON name(entity_version_id) WHERE name_type != 'primary';")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_name_version_type ON name(entity_version_id, name_type, full_name);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_address_version ON address(entity_version_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_document_version ON document(entity_version_id);")

    # RPC-funktion
    print("Uppdaterar get_sanctions_entries...")
    cur.execute("DROP FUNCTION IF EXISTS public.get_sanctions_entries();")
    cur.execute("DROP FUNCTION IF EXISTS public.get_sanctions_entries(integer, integer, text);")
    cur.execute("""
        CREATE OR REPLACE FUNCTION public.get_sanctions_entries(
          p_offset integer DEFAULT 0,
          p_limit integer DEFAULT 50000,
          p_snapshot_id text DEFAULT NULL
        )
        RETURNS TABLE(
          id uuid, canonical_id text, primary_name text, entity_type text,
          program text, nationality text, dob text, pob text, gender text,
          title text, source text, aliases text[]
        )
        LANGUAGE sql STABLE AS $$
          SELECT
            e.id,
            e.canonical_id,
            e.primary_name,
            e.entity_type,
            ev.program,
            ev.nationality,
            ev.dob,
            ev.pob,
            ev.gender,
            ev.title,
            e.source,
            al.aliases
          FROM entity e
          JOIN entity_version ev ON ev.entity_id = e.id AND ev.valid_to IS NULL
          LEFT JOIN LATERAL (
            SELECT ARRAY_AGG(n.full_name) AS aliases
            FROM name n
            WHERE n.entity_version_id = ev.id
              AND n.name_type != 'primary'
          ) al ON true
          WHERE e.is_active = true
            AND (p_snapshot_id IS NULL OR EXISTS (
              SELECT 1 FROM entity_version ev2
              WHERE ev2.entity_id = e.id
                AND ev2.snapshot_id::text = p_snapshot_id
            ))
          ORDER BY e.primary_name
          LIMIT p_limit OFFSET p_offset;
        $$;
    """)

    cur.execute("GRANT EXECUTE ON FUNCTION public.get_sanctions_entries(integer, integer, text) TO anon;")

    cur.close()
    conn.close()
    print("Klart!")

if __name__ == "__main__":
    main()
