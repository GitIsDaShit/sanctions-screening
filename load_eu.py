"""
load_eu.py
----------
Laddar EU:s konsoliderade sanktionslista (XML) i Supabase.

Kör med:
    python load_eu.py

Kräver:
    pip install psycopg2-binary
"""

import sys
import uuid
import hashlib
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
XML_FILE    = "eu_sanctions.xml"
EU_URL      = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
# ─────────────────────────────────────────────────────────────────────────────

NS = "http://eu.europa.ec/fpi/fsd/export"

def tag(name):
    return f"{{{NS}}}{name}"

def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
        connect_timeout=30,
        options="-c statement_timeout=0"
    )

def download_eu(url, path):
    import urllib.request
    print(f"Laddar ner EU-listan...")
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

def parse_xml(path):
    print(f"Parsar {path}...")
    tree = etree.parse(path)
    root = tree.getroot()
    entities = root.findall(tag("sanctionEntity"))
    print(f"  {len(entities)} entiteter hittade")
    return root, entities

def map_subject_type(code):
    mapping = {"P": "individual", "E": "organization", "V": "vessel"}
    return mapping.get(code, "unknown")

def main():
    download_eu(EU_URL, XML_FILE)
    version_hash = compute_hash(XML_FILE)

    print("\nAnsluter till databasen...")
    conn = get_conn()
    cur = conn.cursor()

    # Rensa ofullständiga körningar
    cur.execute("DELETE FROM list_snapshot WHERE source = 'EU' AND entity_count = 0")
    conn.commit()

    # Kolla om redan inläst
    cur.execute("SELECT id, entity_count FROM list_snapshot WHERE source = 'EU' AND version_hash = %s", (version_hash,))
    row = cur.fetchone()
    if row and row[1] > 0:
        print(f"Redan inläst ({row[1]} entiteter). Avslutar.")
        conn.close()
        return

    root, entities = parse_xml(XML_FILE)

    # Hämta generationsdatum från XML
    gen_date_str = root.get("generationDate", "")
    try:
        snapshot_date = datetime.fromisoformat(gen_date_str[:10]).date()
    except Exception:
        snapshot_date = datetime.now(timezone.utc).date()

    # Skapa snapshot
    cur.execute("""
        INSERT INTO list_snapshot (source, snapshot_date, version_hash, entity_count, download_url)
        VALUES (%s, %s, %s, 0, %s) RETURNING id
    """, ('EU', snapshot_date, version_hash, EU_URL))
    snapshot_id = cur.fetchone()[0]
    conn.commit()
    print(f"Snapshot skapad: {snapshot_id} (datum: {snapshot_date})")

    # ── Bygg rader i minnet ───────────────────────────────────────────────────
    print("Bygger datarader i minnet...")

    entity_rows  = []
    ev_rows      = []
    name_rows    = []
    address_rows = []
    doc_rows     = []
    measure_rows = []

    skipped = 0
    now = datetime.now(timezone.utc)

    for entity_el in entities:
        logical_id   = entity_el.get("logicalId", "")
        eu_ref       = entity_el.get("euReferenceNumber", "")
        un_id        = entity_el.get("unitedNationId", "")
        designation  = entity_el.get("designationDetails", "")
        remark_el    = entity_el.find(tag("remark"))
        remark       = remark_el.text.strip() if remark_el is not None and remark_el.text else None

        # Typ
        subtype_el = entity_el.find(tag("subjectType"))
        class_code = subtype_el.get("classificationCode", "") if subtype_el is not None else ""
        entity_type = map_subject_type(class_code)

        # Sanktionsprogram
        reg_el  = entity_el.find(tag("regulation"))
        program = reg_el.get("programme", "") if reg_el is not None else ""
        legal_basis = reg_el.get("numberTitle", "") if reg_el is not None else ""

        # Namn – första strong=true alias som primärt namn
        name_aliases = entity_el.findall(tag("nameAlias"))
        if not name_aliases:
            skipped += 1
            continue

        primary_name = None
        for na in name_aliases:
            whole = na.get("wholeName", "").strip()
            if whole and na.get("strong", "false").lower() == "true":
                primary_name = whole
                break
        if not primary_name:
            primary_name = name_aliases[0].get("wholeName", "").strip()
        if not primary_name:
            skipped += 1
            continue

        # Gender från första alias med gender-attribut
        gender = None
        for na in name_aliases:
            g = na.get("gender", "").strip()
            if g in ("M", "F"):
                gender = "Male" if g == "M" else "Female"
                break

        # Födelsedatum – ta första
        dob_str = None
        pob_str = None
        for bd in entity_el.findall(tag("birthdate")):
            if not dob_str:
                d = bd.get("birthdate", "")
                y = bd.get("year", "")
                dob_str = d if d else y
            if not pob_str:
                city = bd.get("city", "").strip()
                country = bd.get("countryDescription", "").strip()
                if city and country and country != "UNKNOWN":
                    pob_str = f"{city}, {country}"
                elif city:
                    pob_str = city

        # Nationalitet/medborgarskap
        nat_str = None
        cit_el = entity_el.find(tag("citizenship"))
        if cit_el is not None:
            nat_str = cit_el.get("countryDescription", "").strip() or None

        canonical_id = eu_ref if eu_ref else f"EU-{logical_id}"
        eid = str(uuid.uuid4())
        vid = str(uuid.uuid4())

        entity_rows.append((
            eid, canonical_id, 'EU', entity_type, primary_name, now, now, True
        ))

        ev_rows.append((
            vid, eid, str(snapshot_id),
            program, None, gender, dob_str, pob_str, nat_str, now, None
        ))

        # Namn och alias
        seen_names = set()
        for na in name_aliases:
            whole = na.get("wholeName", "").strip()
            if not whole or whole in seen_names:
                continue
            seen_names.add(whole)
            is_primary = (whole == primary_name)
            name_type = "primary" if is_primary else "alias"
            lang = na.get("nameLanguage", "").strip() or None
            name_rows.append((str(uuid.uuid4()), vid, name_type, whole, lang))

        # Adresser
        for addr_el in entity_el.findall(tag("address")):
            parts = [
                addr_el.get("street", "").strip(),
                addr_el.get("city", "").strip(),
                addr_el.get("zipCode", "").strip(),
                addr_el.get("countryDescription", "").strip(),
            ]
            full_addr = ", ".join(p for p in parts if p and p != "UNKNOWN")
            if full_addr:
                address_rows.append((str(uuid.uuid4()), vid, full_addr))

        # Pass / ID-dokument
        for id_el in entity_el.findall(tag("identification")):
            doc_type_raw = id_el.get("identificationTypeCode", "").lower()
            doc_type = "passport" if "passport" in doc_type_raw else \
                       "national_id" if "id" in doc_type_raw else "other"
            doc_number = id_el.get("number", "").strip() or None
            country = id_el.get("countryDescription", "").strip() or None
            if doc_number:
                doc_rows.append((str(uuid.uuid4()), vid, doc_type, doc_number, country))

        # Sanktionsåtgärder
        if program:
            measure_rows.append((str(uuid.uuid4()), vid, "asset_freeze", None, None, legal_basis, remark))

    print(f"  {len(entity_rows)} entiteter")
    print(f"  {len(name_rows)} namn")
    print(f"  {len(address_rows)} adresser")
    print(f"  {len(doc_rows)} dokument")

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
        print(f"    {len(address_rows)} rader ({time.time()-t0:.1f}s)")

    if doc_rows:
        print("  Infogar dokument...")
        execute_values(cur,
            "INSERT INTO document (id,entity_version_id,doc_type,doc_number,issuing_country) VALUES %s ON CONFLICT DO NOTHING",
            doc_rows, page_size=500)
        conn.commit()

    if measure_rows:
        print("  Infogar sanktionsåtgärder...")
        execute_values(cur,
            "INSERT INTO sanction_measure (id,entity_version_id,measure_type,start_date,end_date,legal_basis,remarks) VALUES %s ON CONFLICT DO NOTHING",
            measure_rows, page_size=500)
        conn.commit()

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
