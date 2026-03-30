"""
load_un.py
----------
Laddar FN:s konsoliderade sanktionslista (XML) i Supabase.

Kör med:
    python load_un.py

Kräver:
    pip install psycopg2-binary lxml
"""

import sys
import uuid
import hashlib
import time
import urllib.request
from datetime import datetime, timezone

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2
    from psycopg2.extras import execute_values

try:
    from lxml import etree
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "lxml"])
    from lxml import etree

# ── KONFIGURATION ─────────────────────────────────────────────────────────────
DB_HOST     = "aws-1-eu-west-2.pooler.supabase.com"
DB_PORT     = 5432
DB_NAME     = "postgres"
DB_USER     = "postgres.byfyjwhzixtgbwxhpbql"
DB_PASSWORD = "Tamburin253314"
XML_FILE    = "un_sanctions.xml"
UN_URL      = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
# ─────────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
        connect_timeout=30,
        options="-c statement_timeout=0"
    )

def download_un(url, path):
    print(f"Laddar ner FN-listan...")
    headers = {"User-Agent": "Mozilla/5.0 (sanctions-screening-tool)"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp, open(path, "wb") as f:
        f.write(resp.read())
    print(f"  Sparad till {path}")

def compute_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def clean(val):
    if not val or str(val).strip().lower() in ("", "na", "n/a", "unknown"):
        return None
    return str(val).strip()

def get_text(el, tag):
    child = el.find(tag)
    if child is not None and child.text:
        return clean(child.text)
    return None

def parse_xml(path):
    print(f"Parsar {path}...")
    tree = etree.parse(path)
    root = tree.getroot()
    return root

def build_individual(el, snapshot_id, now):
    ref_num   = clean(el.findtext("REFERENCE_NUMBER") or el.findtext("DATAID") or "")
    first     = clean(el.findtext("FIRST_NAME") or "")
    second    = clean(el.findtext("SECOND_NAME") or "")
    third     = clean(el.findtext("THIRD_NAME") or "")
    fourth    = clean(el.findtext("FOURTH_NAME") or "")
    name_parts = [p for p in [first, second, third, fourth] if p]
    primary_name = " ".join(name_parts) if name_parts else None
    if not primary_name:
        return None, None, [], [], [], []

    canonical_id = ref_num or f"UN-IND-{uuid.uuid4().hex[:8]}"
    listed_on    = clean(el.findtext("LISTED_ON") or "")
    comments     = clean(el.findtext("COMMENTS1") or "")
    un_list_type = clean(el.findtext("UN_LIST_TYPE") or "")

    # DOB
    dob_str = None
    for dob_el in el.findall(".//INDIVIDUAL_DATE_OF_BIRTH"):
        year  = clean(dob_el.findtext("YEAR") or "")
        date  = clean(dob_el.findtext("DATE") or "")
        dob_str = date or year
        if dob_str:
            break

    # POB
    pob_str = None
    for pob_el in el.findall(".//INDIVIDUAL_PLACE_OF_BIRTH"):
        city    = clean(pob_el.findtext("CITY") or "")
        country = clean(pob_el.findtext("COUNTRY") or "")
        pob_str = ", ".join(p for p in [city, country] if p) or None
        if pob_str:
            break

    # Nationalitet
    nat_str = None
    for nat_el in el.findall(".//NATIONALITY/VALUE"):
        nat_str = clean(nat_el.text or "")
        if nat_str:
            break

    eid = str(uuid.uuid4())
    vid = str(uuid.uuid4())

    entity_row = (eid, canonical_id, 'UN', 'individual', primary_name, now, now, True)
    ev_row     = (vid, eid, str(snapshot_id), un_list_type, None, None, dob_str, pob_str, nat_str, now, None)

    # Namn
    name_rows = [(str(uuid.uuid4()), vid, 'primary', primary_name, None)]
    for aka_el in el.findall(".//INDIVIDUAL_ALIAS"):
        quality   = clean(aka_el.findtext("QUALITY") or "")
        alias_name = clean(aka_el.findtext("ALIAS_NAME") or "")
        if alias_name:
            name_type = "aka_good" if quality == "Good" else "aka_low"
            name_rows.append((str(uuid.uuid4()), vid, name_type, alias_name, None))

    # Adresser
    address_rows = []
    for addr_el in el.findall(".//INDIVIDUAL_ADDRESS"):
        parts = [
            clean(addr_el.findtext("STREET") or ""),
            clean(addr_el.findtext("CITY") or ""),
            clean(addr_el.findtext("STATE_PROVINCE") or ""),
            clean(addr_el.findtext("COUNTRY") or ""),
        ]
        full_addr = ", ".join(p for p in parts if p)
        if full_addr:
            address_rows.append((str(uuid.uuid4()), vid, full_addr))

    # Dokument
    doc_rows = []
    for doc_el in el.findall(".//INDIVIDUAL_DOCUMENT"):
        doc_type_raw = (clean(doc_el.findtext("TYPE_OF_DOCUMENT") or "") or "").lower()
        doc_type = "passport" if "passport" in doc_type_raw else \
                   "national_id" if "id" in doc_type_raw else "other"
        doc_num  = clean(doc_el.findtext("NUMBER") or "")
        country  = clean(doc_el.findtext("COUNTRY_OF_ISSUE") or "")
        if doc_num:
            doc_rows.append((str(uuid.uuid4()), vid, doc_type, doc_num, country))

    return entity_row, ev_row, name_rows, address_rows, doc_rows

def build_entity(el, snapshot_id, now):
    ref_num      = clean(el.findtext("REFERENCE_NUMBER") or el.findtext("DATAID") or "")
    name         = clean(el.findtext("FIRST_NAME") or "")
    if not name:
        return None, None, [], [], [], []

    canonical_id = ref_num or f"UN-ENT-{uuid.uuid4().hex[:8]}"
    un_list_type = clean(el.findtext("UN_LIST_TYPE") or "")
    comments     = clean(el.findtext("COMMENTS1") or "")

    eid = str(uuid.uuid4())
    vid = str(uuid.uuid4())

    entity_row = (eid, canonical_id, 'UN', 'organization', name, now, now, True)
    ev_row     = (vid, eid, str(snapshot_id), un_list_type, None, None, None, None, None, now, None)

    name_rows = [(str(uuid.uuid4()), vid, 'primary', name, None)]
    for aka_el in el.findall(".//ENTITY_ALIAS"):
        quality    = clean(aka_el.findtext("QUALITY") or "")
        alias_name = clean(aka_el.findtext("ALIAS_NAME") or "")
        if alias_name:
            name_type = "aka_good" if quality == "Good" else "aka_low"
            name_rows.append((str(uuid.uuid4()), vid, name_type, alias_name, None))

    address_rows = []
    for addr_el in el.findall(".//ENTITY_ADDRESS"):
        parts = [
            clean(addr_el.findtext("STREET") or ""),
            clean(addr_el.findtext("CITY") or ""),
            clean(addr_el.findtext("STATE_PROVINCE") or ""),
            clean(addr_el.findtext("COUNTRY") or ""),
        ]
        full_addr = ", ".join(p for p in parts if p)
        if full_addr:
            address_rows.append((str(uuid.uuid4()), vid, full_addr))

    return entity_row, ev_row, name_rows, address_rows, []

def main():
    download_un(UN_URL, XML_FILE)
    version_hash = compute_hash(XML_FILE)

    print("\nAnsluter till databasen...")
    conn = get_conn()
    cur  = conn.cursor()

    # Rensa ofullständiga körningar
    cur.execute("DELETE FROM list_snapshot WHERE source = 'UN' AND entity_count = 0")
    conn.commit()

    # Kolla om redan inläst
    cur.execute("SELECT id, entity_count FROM list_snapshot WHERE source = 'UN' AND version_hash = %s", (version_hash,))
    row = cur.fetchone()
    if row and row[1] > 0:
        print(f"Redan inläst ({row[1]} entiteter). Avslutar.")
        conn.close()
        return

    root = parse_xml(XML_FILE)

    # Generationsdatum från root-attribut eller idag
    gen_date = root.get("dateGenerated", root.get("date", ""))
    try:
        snapshot_date = datetime.fromisoformat(gen_date[:10]).date()
    except Exception:
        snapshot_date = datetime.now(timezone.utc).date()

    # Skapa snapshot
    cur.execute("""
        INSERT INTO list_snapshot (source, snapshot_date, version_hash, entity_count, download_url)
        VALUES (%s, %s, %s, 0, %s) RETURNING id
    """, ('UN', snapshot_date, version_hash, UN_URL))
    snapshot_id = cur.fetchone()[0]
    conn.commit()
    print(f"Snapshot skapad: {snapshot_id} (datum: {snapshot_date})")

    # ── Bygg rader i minnet ───────────────────────────────────────────────────
    print("Bygger datarader i minnet...")
    now = datetime.now(timezone.utc)

    entity_rows  = []
    ev_rows      = []
    name_rows    = []
    address_rows = []
    doc_rows     = []
    skipped      = 0

    # Individer
    individuals = root.findall(".//INDIVIDUAL")
    print(f"  {len(individuals)} individer hittade")
    for el in individuals:
        er, evr, nr, ar, dr = build_individual(el, snapshot_id, now)
        if er is None:
            skipped += 1
            continue
        entity_rows.append(er)
        ev_rows.append(evr)
        name_rows.extend(nr)
        address_rows.extend(ar)
        doc_rows.extend(dr)

    # Entiteter/organisationer
    entities = root.findall(".//ENTITY")
    print(f"  {len(entities)} entiteter hittade")
    for el in entities:
        er, evr, nr, ar, _ = build_entity(el, snapshot_id, now)
        if er is None:
            skipped += 1
            continue
        entity_rows.append(er)
        ev_rows.append(evr)
        name_rows.extend(nr)
        address_rows.extend(ar)

    print(f"  Totalt: {len(entity_rows)} entiteter")
    print(f"  {len(name_rows)} namn, {len(address_rows)} adresser, {len(doc_rows)} dokument")

    # ── Bulk-insert ───────────────────────────────────────────────────────────
    print("\nSkickar till databasen...")
    t0 = time.time()

    print("  Infogar entiteter...")
    execute_values(cur,
        "INSERT INTO entity (id,canonical_id,source,entity_type,primary_name,first_seen_at,last_seen_at,is_active) VALUES %s ON CONFLICT DO NOTHING",
        entity_rows, page_size=500)
    conn.commit()
    print(f"    {len(entity_rows)} rader ({time.time()-t0:.1f}s)")

    print("  Infogar versioner...")
    execute_values(cur,
        "INSERT INTO entity_version (id,entity_id,snapshot_id,program,title,gender,dob,pob,nationality,valid_from,valid_to) VALUES %s ON CONFLICT DO NOTHING",
        ev_rows, page_size=500)
    conn.commit()
    print(f"    {len(ev_rows)} rader ({time.time()-t0:.1f}s)")

    print("  Infogar namn...")
    execute_values(cur,
        "INSERT INTO name (id,entity_version_id,name_type,full_name,language) VALUES %s ON CONFLICT DO NOTHING",
        name_rows, page_size=500)
    conn.commit()
    print(f"    {len(name_rows)} rader ({time.time()-t0:.1f}s)")

    if address_rows:
        print("  Infogar adresser...")
        execute_values(cur,
            "INSERT INTO address (id,entity_version_id,full_address) VALUES %s ON CONFLICT DO NOTHING",
            address_rows, page_size=500)
        conn.commit()

    if doc_rows:
        print("  Infogar dokument...")
        execute_values(cur,
            "INSERT INTO document (id,entity_version_id,doc_type,doc_number,issuing_country) VALUES %s ON CONFLICT DO NOTHING",
            doc_rows, page_size=500)
        conn.commit()

    cur.execute("UPDATE list_snapshot SET entity_count = %s WHERE id = %s", (len(entity_rows), snapshot_id))
    conn.commit()
    cur.close()
    conn.close()

    print(f"\nKlart! Total tid: {time.time()-t0:.1f}s")
    print(f"  Inlästa:  {len(entity_rows)}")
    print(f"  Skippade: {skipped}")

if __name__ == "__main__":
    main()
