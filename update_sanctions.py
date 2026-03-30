"""
update_sanctions.py
-------------------
Uppdaterar sanctions-databasen med versionshantering och deltalogik.
Stänger borttagna poster (valid_to), skapar nya versioner för ändringar,
och loggar allt i delta_log.

Kör med:
    python update_sanctions.py --source OFAC
    python update_sanctions.py --source EU
    python update_sanctions.py --source UN
    python update_sanctions.py --source ALL

Kräver:
    pip install psycopg2-binary lxml requests
"""

import sys
import uuid
import hashlib
import json
import time
import argparse
import urllib.request
from datetime import datetime, timezone
from collections import defaultdict

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

OFAC_JSON   = "public/sanctions.json"
EU_XML      = "eu_sanctions.xml"
UN_XML      = "un_sanctions.xml"

EU_URL      = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
UN_URL      = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
# ─────────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
        connect_timeout=30,
        options="-c statement_timeout=0"
    )

def compute_hash_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def compute_hash_str(s):
    return hashlib.sha256(s.encode()).hexdigest()

def download_file(url, path):
    print(f"  Laddar ner {path}...")
    headers = {"User-Agent": "Mozilla/5.0 (sanctions-screening-tool)"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp, open(path, "wb") as f:
        f.write(resp.read())

def clean(val):
    if not val or str(val).strip().lower() in ("", "na", "n/a", "unknown", "-0-"):
        return None
    return str(val).strip()

# ── Parsers ────────────────────────────────────────────────────────────────────

def load_ofac_entries():
    """Returnerar dict: canonical_id -> {name, type, program, aliases, ...}"""
    print(f"Läser {OFAC_JSON}...")
    with open(OFAC_JSON, encoding="utf-8") as f:
        data = json.load(f)
    entries = data.get("entries", data)
    source_date_str = data.get("meta", {}).get("source_date")
    try:
        source_date = datetime.fromisoformat(source_date_str).date() if source_date_str else datetime.now(timezone.utc).date()
    except Exception:
        source_date = datetime.now(timezone.utc).date()

    result = {}
    for e in entries:
        cid = str(e.get("id", "")).strip()
        name = e.get("name", "").strip()
        if not cid or not name:
            continue
        # Fingerprint av fältens innehåll för ändringsdetektering
        fingerprint = compute_hash_str(json.dumps({
            "name": name,
            "program": e.get("program"),
            "type": e.get("type"),
            "dob": e.get("dob"),
            "nationality": e.get("nationality"),
            "aliases": sorted(e.get("aliases", [])),
        }, sort_keys=True))
        result[cid] = {**e, "_fingerprint": fingerprint}

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, 'https://www.treasury.gov/ofac/downloads/sdn.csv'

def load_eu_entries():
    download_file(EU_URL, EU_XML)
    print(f"Parsar {EU_XML}...")
    tree = etree.parse(EU_XML)
    root = tree.getroot()
    NS = "http://eu.europa.ec/fpi/fsd/export"
    def tag(n): return f"{{{NS}}}{n}"

    gen_date = root.get("generationDate", "")
    try:
        source_date = datetime.fromisoformat(gen_date[:10]).date()
    except Exception:
        source_date = datetime.now(timezone.utc).date()

    result = {}
    for el in root.findall(tag("sanctionEntity")):
        eu_ref = el.get("euReferenceNumber", "")
        lid    = el.get("logicalId", "")
        cid    = eu_ref if eu_ref else f"EU-{lid}"

        name_aliases = el.findall(tag("nameAlias"))
        primary_name = None
        for na in name_aliases:
            w = na.get("wholeName", "").strip()
            if w and na.get("strong", "false").lower() == "true":
                primary_name = w
                break
        if not primary_name and name_aliases:
            primary_name = name_aliases[0].get("wholeName", "").strip()
        if not primary_name:
            continue

        subtype = el.find(tag("subjectType"))
        cc = subtype.get("classificationCode", "") if subtype is not None else ""
        etype = {"P": "individual", "E": "organization", "V": "vessel"}.get(cc, "unknown")

        reg = el.find(tag("regulation"))
        program = reg.get("programme", "") if reg is not None else ""

        aliases = [na.get("wholeName", "").strip() for na in name_aliases
                   if na.get("wholeName", "").strip() and na.get("wholeName", "").strip() != primary_name]

        dob_str = None
        for bd in el.findall(tag("birthdate")):
            d = bd.get("birthdate", "") or bd.get("year", "")
            if d:
                dob_str = d
                break

        nat_str = None
        cit = el.find(tag("citizenship"))
        if cit is not None:
            nat_str = cit.get("countryDescription", "").strip() or None

        fingerprint = compute_hash_str(json.dumps({
            "name": primary_name, "program": program, "type": etype,
            "dob": dob_str, "nationality": nat_str,
            "aliases": sorted(aliases),
        }, sort_keys=True))

        result[cid] = {
            "id": cid, "name": primary_name, "type": etype,
            "program": program, "dob": dob_str, "nationality": nat_str,
            "aliases": aliases, "_fingerprint": fingerprint,
        }

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, EU_URL

def load_un_entries():
    download_file(UN_URL, UN_XML)
    print(f"Parsar {UN_XML}...")
    tree = etree.parse(UN_XML)
    root = tree.getroot()

    gen_date = root.get("dateGenerated", root.get("date", ""))
    try:
        source_date = datetime.fromisoformat(gen_date[:10]).date()
    except Exception:
        source_date = datetime.now(timezone.utc).date()

    result = {}

    def process(el, etype):
        ref = clean(el.findtext("REFERENCE_NUMBER") or el.findtext("DATAID") or "")
        first = clean(el.findtext("FIRST_NAME") or "")
        if not first:
            return
        cid = ref or f"UN-{etype[:3].upper()}-{uuid.uuid4().hex[:8]}"
        parts = [first] + [clean(el.findtext(f) or "") for f in ["SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"]]
        primary_name = " ".join(p for p in parts if p)
        program = clean(el.findtext("UN_LIST_TYPE") or "")
        aliases = [clean(a.findtext("ALIAS_NAME") or "") for a in el.findall(f".//{etype.upper()}_ALIAS") if clean(a.findtext("ALIAS_NAME") or "")]
        dob_str = None
        for dob_el in el.findall(f".//{etype.upper()}_DATE_OF_BIRTH"):
            d = clean(dob_el.findtext("DATE") or dob_el.findtext("YEAR") or "")
            if d:
                dob_str = d
                break
        nat_str = clean(el.findtext(".//NATIONALITY/VALUE") or "")
        fingerprint = compute_hash_str(json.dumps({
            "name": primary_name, "program": program, "type": etype,
            "dob": dob_str, "nationality": nat_str,
            "aliases": sorted(aliases),
        }, sort_keys=True))
        result[cid] = {
            "id": cid, "name": primary_name, "type": etype,
            "program": program, "dob": dob_str, "nationality": nat_str,
            "aliases": aliases, "_fingerprint": fingerprint,
        }

    for el in root.findall(".//INDIVIDUAL"):
        process(el, "individual")
    for el in root.findall(".//ENTITY"):
        process(el, "organization")

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, UN_URL

# ── Versionshantering ─────────────────────────────────────────────────────────

def update_source(source, new_entries, source_date, download_url):
    print(f"\n=== Uppdaterar {source} ===")
    now = datetime.now(timezone.utc)
    conn = get_conn()
    cur  = conn.cursor()

    # Beräkna hash av nya data
    version_hash = compute_hash_str(json.dumps(
        {k: v["_fingerprint"] for k, v in new_entries.items()}, sort_keys=True
    ))

    # Kolla om redan inläst
    cur.execute("SELECT id FROM list_snapshot WHERE source = %s AND version_hash = %s", (source, version_hash))
    if cur.fetchone():
        print("  Ingen förändring sedan senaste inläsning. Avslutar.")
        conn.close()
        return

    # Hämta aktiva entiteter från databasen
    cur.execute("""
        SELECT e.canonical_id, e.id, ev.id, ev.program, ev.dob, ev.nationality
        FROM entity e
        JOIN entity_version ev ON ev.entity_id = e.id
        WHERE e.source = %s AND e.is_active = true AND ev.valid_to IS NULL
    """, (source,))
    existing = {row[0]: {"entity_id": row[1], "version_id": row[2],
                          "program": row[3], "dob": row[4], "nationality": row[5]}
                for row in cur.fetchall()}

    # Hämta fingerprints för befintliga versioner
    cur.execute("""
        SELECT e.canonical_id, ev.id
        FROM entity e
        JOIN entity_version ev ON ev.entity_id = e.id
        WHERE e.source = %s AND e.is_active = true AND ev.valid_to IS NULL
    """, (source,))

    existing_ids = set(existing.keys())
    new_ids      = set(new_entries.keys())

    added_ids    = new_ids - existing_ids
    removed_ids  = existing_ids - new_ids
    common_ids   = existing_ids & new_ids

    print(f"  Tillagda:   {len(added_ids)}")
    print(f"  Borttagna:  {len(removed_ids)}")
    print(f"  Gemensamma: {len(common_ids)}")

    # Skapa snapshot
    cur.execute("""
        INSERT INTO list_snapshot (source, snapshot_date, version_hash, entity_count, download_url)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
    """, (source, source_date, version_hash, len(new_entries), download_url))
    snapshot_id = cur.fetchone()[0]
    conn.commit()
    print(f"  Snapshot skapad: {snapshot_id}")

    delta_rows   = []
    entity_rows  = []
    ev_rows      = []
    name_rows    = []

    # ── BORTTAGNA: stäng valid_to och sätt is_active=false ───────────────────
    if removed_ids:
        for cid in removed_ids:
            cur.execute("UPDATE entity_version SET valid_to = %s WHERE id = %s", (now, existing[cid]["version_id"]))
            cur.execute("UPDATE entity SET is_active = false, last_seen_at = %s WHERE id = %s", (now, existing[cid]["entity_id"]))
            delta_rows.append((str(uuid.uuid4()), str(snapshot_id), existing[cid]["entity_id"], 'removed', None, None, None, now))

        conn.commit()
        print(f"  Stängde {len(removed_ids)} borttagna entiteter")

    # ── TILLAGDA: skapa ny entity + version ───────────────────────────────────
    for cid in added_ids:
        e   = new_entries[cid]
        eid = str(uuid.uuid4())
        vid = str(uuid.uuid4())
        entity_rows.append((eid, cid, source, e.get("type", "unknown"), e.get("name", ""), now, now, True))
        ev_rows.append((vid, eid, str(snapshot_id), e.get("program"), None, e.get("gender"), e.get("dob"), e.get("pob"), e.get("nationality"), now, None))
        name_rows.append((str(uuid.uuid4()), vid, 'primary', e.get("name", ""), None))
        for alias in e.get("aliases", []):
            if alias:
                name_rows.append((str(uuid.uuid4()), vid, 'alias', alias, None))
        delta_rows.append((str(uuid.uuid4()), str(snapshot_id), eid, 'added', None, None, None, now))

    if entity_rows:
        execute_values(cur, "INSERT INTO entity (id,canonical_id,source,entity_type,primary_name,first_seen_at,last_seen_at,is_active) VALUES %s ON CONFLICT DO NOTHING", entity_rows)
        execute_values(cur, "INSERT INTO entity_version (id,entity_id,snapshot_id,program,title,gender,dob,pob,nationality,valid_from,valid_to) VALUES %s ON CONFLICT DO NOTHING", ev_rows)
        execute_values(cur, "INSERT INTO name (id,entity_version_id,name_type,full_name,language) VALUES %s ON CONFLICT DO NOTHING", name_rows)
        conn.commit()
        print(f"  Lade till {len(entity_rows)} nya entiteter")

    # ── ÄNDRADE och OFÖRÄNDRADE ───────────────────────────────────────────────
    modified_count = 0
    mod_name_rows  = []
    mod_ev_rows    = []
    unchanged_ids  = []

    for cid in common_ids:
        e    = new_entries[cid]
        exst = existing[cid]

        changed = (
            e.get("program")     != exst.get("program") or
            e.get("dob")         != exst.get("dob") or
            e.get("nationality") != exst.get("nationality")
        )

        if changed:
            cur.execute("UPDATE entity_version SET valid_to = %s WHERE id = %s", (now, exst["version_id"]))
            cur.execute("UPDATE entity SET last_seen_at = %s, primary_name = %s WHERE id = %s",
                        (now, e.get("name"), exst["entity_id"]))

            vid = str(uuid.uuid4())
            mod_ev_rows.append((vid, exst["entity_id"], str(snapshot_id),
                                 e.get("program"), None, e.get("gender"),
                                 e.get("dob"), e.get("pob"), e.get("nationality"), now, None))
            mod_name_rows.append((str(uuid.uuid4()), vid, 'primary', e.get("name", ""), None))
            for alias in e.get("aliases", []):
                if alias:
                    mod_name_rows.append((str(uuid.uuid4()), vid, 'alias', alias, None))

            delta_rows.append((str(uuid.uuid4()), str(snapshot_id), exst["entity_id"], 'modified', None, None, None, now))
            modified_count += 1
        else:
            unchanged_ids.append(exst["entity_id"])

    # Batch-uppdatera last_seen_at för oförändrade (en SQL istället för 18000)
    if unchanged_ids:
        cur.execute("UPDATE entity SET last_seen_at = %s WHERE id = ANY(%s::uuid[])",
                    (now, unchanged_ids))

    conn.commit()

    if mod_ev_rows:
        execute_values(cur, "INSERT INTO entity_version (id,entity_id,snapshot_id,program,title,gender,dob,pob,nationality,valid_from,valid_to) VALUES %s", mod_ev_rows)
        execute_values(cur, "INSERT INTO name (id,entity_version_id,name_type,full_name,language) VALUES %s", mod_name_rows)
        conn.commit()

    print(f"  Modifierade: {modified_count}")

    # ── DELTA LOG ────────────────────────────────────────────────────────────
    if delta_rows:
        execute_values(cur,
            "INSERT INTO delta_log (id,snapshot_id,entity_id,change_type,field_changed,old_value,new_value,logged_at) VALUES %s",
            delta_rows)
        conn.commit()
        print(f"  Delta-poster loggade: {len(delta_rows)}")

    cur.close()
    conn.close()
    print(f"  Klar!")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["OFAC", "EU", "UN", "ALL"], default="ALL")
    args = parser.parse_args()

    sources = ["OFAC", "EU", "UN"] if args.source == "ALL" else [args.source]

    for source in sources:
        t0 = time.time()
        if source == "OFAC":
            entries, date, url = load_ofac_entries()
        elif source == "EU":
            entries, date, url = load_eu_entries()
        elif source == "UN":
            entries, date, url = load_un_entries()
        update_source(source, entries, date, url)
        print(f"  Tid: {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
