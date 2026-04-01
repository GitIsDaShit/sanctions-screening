"""
analyze.py
----------
Kör ANALYZE på alla relevanta tabeller för att uppdatera
statistik och säkerställa snabba queries.

Kör med:
    python analyze.py
"""

import sys
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

    tables = ["entity", "entity_version", "name", "address", "document", "list_snapshot", "delta_log"]
    for table in tables:
        print(f"  ANALYZE {table}...")
        cur.execute(f"ANALYZE {table}")

    print("Skapar index om de saknas...")
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_entity_version_entity 
        ON entity_version(entity_id) WHERE valid_to IS NULL;
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_entity_active_source 
        ON entity(source, is_active) WHERE is_active = true;
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_name_version ON name(entity_version_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_address_version ON address(entity_version_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_document_version ON document(entity_version_id);")

    cur.close()
    conn.close()
    print("Klart!")

if __name__ == "__main__":
    main()
