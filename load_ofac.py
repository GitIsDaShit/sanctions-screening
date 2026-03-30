"""
load_ofac.py
------------
Laddar OFAC-data från sanctions.json i Supabase med bulk-inserts.
Samlar all data i minnet och skickar i stora batchar – 20x snabbare.

Kör med:
    python load_ofac.py

Kräver:
    pip install psycopg2-binary
"""

import json
import hashlib
import sys
import uuid
import time
from datetime import datetime, timezone

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2
    from psycopg2.extras import execute_values

# ── KONFIGURATION ─────────────────────────────────────────────────────────────
DB_HOST     = "aws-1-eu-west-2.pooler.supabase.com"
DB_PORT     = 5432
DB_NAME     = "postgres"
DB_USER     = "postgres.byfyjwhzixtgbwxhpbql"
DB_PASSWORD = "Tamburin253314"
JSON_FILE   = "public/sanctions.json"
# ─────────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
        connect_timeout=30,
        options="-c statement_timeout=0"
    )

def load_json(path):
    print(f"Läser {path}...")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    entries = data.get("entries", data)
    source_date_str = data.get("meta", {}).get("source_date")
    try:
        source_date = datetime.fromisoformat(source_date_str).date() if source_date_str else datetime.now(timezone.utc).date()
    except Exception:
        source_date = datetime.now(timezone.utc).date()
    print(f"  {len(entries)} entiteter hittade (listdatum: {source_date})")
    return entries, source_date

def compute_hash(entries):
    raw = json.dumps(entries, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()

def bulk_insert(cur, table, columns, rows, page_size=500):
    if not rows:
        return
    sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES %s ON CONFLICT DO NOTHING"
    execute_values(cur, sql, rows, page_size=page_size)

def main():
    entries, snapshot_date = load_json(JSON_FILE)
    version_hash = compute_hash(entries)

    print("\nAnsluter till databasen...")
    conn = get_conn()
    cur = conn.cursor()

    # Rensa ofullständiga tidigare körningar
    cur.execute("DELETE FROM list_snapshot WHERE source = 'OFAC' AND entity_count = 0")
    conn.commit()

    # Kolla om redan inläst
    cur.execute("SELECT id, entity_count FROM list_snapshot WHERE source = 'OFAC' AND version_hash = %s", (version_hash,))
    row = cur.fetchone()
    if row and row[1] > 0:
        print(f"Redan inläst ({row[1]} entiteter). Avslutar.")
        conn.close()
        return

    # Skapa snapshot
    cur.execute("""
        INSERT INTO list_snapshot (source, snapshot_date, version_hash, entity_count, download_url)
        VALUES (%s, %s, %s, 0, %s) RETURNING id
    """, ('OFAC', snapshot_date, version_hash, 'https://www.treasury.gov/ofac/downloads/sdn.csv'))
    snapshot_id = cur.fetchone()[0]
    conn.commit()
    print(f"Snapshot skapad: {snapshot_id}")

    # ── Bygg alla rader i minnet ──────────────────────────────────────────────
    print("Bygger datarader i minnet...")

    entity_rows     = []
    ev_rows         = []
    name_rows       = []
    address_rows    = []
    document_rows   = []

    skipped = 0
    entity_id_map = {}  # canonical_id -> entity_uuid

    for entry in entries:
        canonical_id = str(entry.get("id", "")).strip()
        primary_name = entry.get("name", "").strip()
        if not canonical_id or not primary_name:
            skipped += 1
            continue

        eid = str(uuid.uuid4())
        entity_id_map[canonical_id] = eid
        now = datetime.now(timezone.utc)

        entity_rows.append((
            eid, canonical_id, 'OFAC',
            entry.get("type", "unknown"),
            primary_name, now, now, True
        ))

        vid = str(uuid.uuid4())
        ev_rows.append((
            vid, eid, str(snapshot_id),
            entry.get("program"), entry.get("title"),
            entry.get("gender"), entry.get("dob"),
            entry.get("pob"), entry.get("nationality"),
            now, None
        ))

        name_rows.append((str(uuid.uuid4()), vid, 'primary', primary_name))
        for alias in entry.get("aliases", []):
            if alias and alias.strip():
                name_rows.append((str(uuid.uuid4()), vid, 'alias', alias.strip()))

        for addr in entry.get("addresses", []):
            if addr and addr.strip():
                address_rows.append((str(uuid.uuid4()), vid, addr.strip()))

        for p in entry.get("passports", []):
            document_rows.append((str(uuid.uuid4()), vid, 'passport', p.get("number"), p.get("country")))

        for nid in entry.get("national_ids", []):
            document_rows.append((str(uuid.uuid4()), vid, 'national_id', nid.get("number"), nid.get("country")))

    print(f"  {len(entity_rows)} entiteter")
    print(f"  {len(name_rows)} namn")
    print(f"  {len(address_rows)} adresser")
    print(f"  {len(document_rows)} dokument")

    # ── Bulk-insert ───────────────────────────────────────────────────────────
    print("\nSkickar till databasen...")

    t0 = time.time()

    print("  Infogar entiteter...")
    bulk_insert(cur, "entity",
        ["id", "canonical_id", "source", "entity_type", "primary_name", "first_seen_at", "last_seen_at", "is_active"],
        entity_rows)
    conn.commit()
    print(f"    {len(entity_rows)} rader ({time.time()-t0:.1f}s)")

    print("  Infogar versioner...")
    bulk_insert(cur, "entity_version",
        ["id", "entity_id", "snapshot_id", "program", "title", "gender", "dob", "pob", "nationality", "valid_from", "valid_to"],
        ev_rows)
    conn.commit()
    print(f"    {len(ev_rows)} rader ({time.time()-t0:.1f}s)")

    print("  Infogar namn...")
    bulk_insert(cur, "name",
        ["id", "entity_version_id", "name_type", "full_name"],
        name_rows)
    conn.commit()
    print(f"    {len(name_rows)} rader ({time.time()-t0:.1f}s)")

    print("  Infogar adresser...")
    bulk_insert(cur, "address",
        ["id", "entity_version_id", "full_address"],
        address_rows)
    conn.commit()
    print(f"    {len(address_rows)} rader ({time.time()-t0:.1f}s)")

    print("  Infogar dokument...")
    bulk_insert(cur, "document",
        ["id", "entity_version_id", "doc_type", "doc_number", "issuing_country"],
        document_rows)
    conn.commit()
    print(f"    {len(document_rows)} rader ({time.time()-t0:.1f}s)")

    # Uppdatera räknare
    cur.execute("UPDATE list_snapshot SET entity_count = %s WHERE id = %s", (len(entity_rows), snapshot_id))
    conn.commit()

    cur.close()
    conn.close()

    print(f"\nKlart! Total tid: {time.time()-t0:.1f}s")
    print(f"  Inlästa:  {len(entity_rows)}")
    print(f"  Skippade: {skipped}")

if __name__ == "__main__":
    main()
