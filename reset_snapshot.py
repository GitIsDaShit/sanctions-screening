"""
reset_snapshot.py
-----------------
Rensar list_snapshot-tabellen och återskapar unique-indexet.

Kör med:
    python reset_snapshot.py
"""

import sys

try:
    import psycopg2
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2

DB_HOST     = "aws-1-eu-west-2.pooler.supabase.com"
DB_PORT     = 5432
DB_NAME     = "postgres"
DB_USER     = "postgres.byfyjwhzixtgbwxhpbql"
DB_PASSWORD = "Tamburin253314"

print("Ansluter...")
conn = psycopg2.connect(
    host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
    user=DB_USER, password=DB_PASSWORD,
    options="-c statement_timeout=0"
)
cur = conn.cursor()

print("Rensar list_snapshot...")
cur.execute("DELETE FROM list_snapshot")

print("Återskapar unique-index...")
cur.execute("ALTER TABLE list_snapshot DROP CONSTRAINT IF EXISTS list_snapshot_source_version_hash_key")
cur.execute("ALTER TABLE list_snapshot ADD CONSTRAINT list_snapshot_source_version_hash_key UNIQUE (source, version_hash)")

conn.commit()
cur.close()
conn.close()
print("Klart!")
