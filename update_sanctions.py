"""
update_sanctions.py
-------------------
Uppdaterar sanctions-databasen med versionshantering och deltalogik.
Använder bulk-inserts för hög prestanda.

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

# ── KONFIGURATION ──────────────────────────────────────────────────────────────
DB_HOST     = "aws-1-eu-west-2.pooler.supabase.com"
DB_PORT     = 5432
DB_NAME     = "postgres"
DB_USER     = "postgres.byfyjwhzixtgbwxhpbql"
DB_PASSWORD = "Tamburin253314"

OFAC_JSON   = "public/sanctions.json"
EU_XML      = "eu_sanctions.xml"
UN_XML      = "un_sanctions.xml"

EU_URL = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
UN_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
# ──────────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
        connect_timeout=30, options="-c statement_timeout=0"
    )

def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()

def clean(val):
    if not val or str(val).strip().lower() in ("", "na", "n/a", "unknown", "-0-"):
        return None
    return str(val).strip()

def download_file(url, path):
    print(f"  Laddar ner {path}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(path, "wb") as f:
        f.write(resp.read())

# ── Parsers ───────────────────────────────────────────────────────────────────

def load_ofac_entries():
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
        fp = sha256(json.dumps({"name": name, "program": e.get("program"), "type": e.get("type"), "dob": e.get("dob"), "nationality": e.get("nationality"), "aliases": sorted(e.get("aliases", []))}, sort_keys=True))
        result[cid] = {**e, "_fingerprint": fp}

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, "https://www.treasury.gov/ofac/downloads/sdn.csv"

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
        aliases = []
        for na in name_aliases:
            w = na.get("wholeName", "").strip()
            if not w: continue
            if na.get("strong", "false").lower() == "true" and not primary_name:
                primary_name = w
            else:
                aliases.append(w)
        if not primary_name and name_aliases:
            primary_name = name_aliases[0].get("wholeName", "").strip()
        if not primary_name:
            continue

        subtype = el.find(tag("subjectType"))
        cc = subtype.get("classificationCode", "") if subtype is not None else ""
        etype = {"P": "individual", "E": "organization", "V": "vessel"}.get(cc, "unknown")

        reg = el.find(tag("regulation"))
        program = reg.get("programme", "") if reg is not None else ""

        dob_str = None
        for bd in el.findall(tag("birthdate")):
            d = bd.get("birthdate", "") or bd.get("year", "")
            if d: dob_str = d; break

        nat_str = None
        cit = el.find(tag("citizenship"))
        if cit is not None:
            nat_str = cit.get("countryDescription", "").strip() or None

        fp = sha256(json.dumps({"name": primary_name, "program": program, "type": etype, "dob": dob_str, "nationality": nat_str, "aliases": sorted(aliases)}, sort_keys=True))
        result[cid] = {"id": cid, "name": primary_name, "type": etype, "program": program, "dob": dob_str, "nationality": nat_str, "aliases": aliases, "_fingerprint": fp}

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
        ref   = clean(el.findtext("REFERENCE_NUMBER") or el.findtext("DATAID") or "")
        first = clean(el.findtext("FIRST_NAME") or "")
        if not first: return
        name_hash = sha256(first + (el.findtext("SECOND_NAME") or "") + (el.findtext("THIRD_NAME") or ""))
        cid = ref or f"UN-{etype[:3].upper()}-{name_hash[:12]}"
        parts = [first] + [clean(el.findtext(f) or "") for f in ["SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"]]
        primary_name = " ".join(p for p in parts if p)
        program = clean(el.findtext("UN_LIST_TYPE") or "")
        aliases = [clean(a.findtext("ALIAS_NAME") or "") for a in el.findall(f".//{etype.upper()}_ALIAS") if clean(a.findtext("ALIAS_NAME") or "")]
        dob_str = None
        for dob_el in el.findall(f".//{etype.upper()}_DATE_OF_BIRTH"):
            d = clean(dob_el.findtext("DATE") or dob_el.findtext("YEAR") or "")
            if d: dob_str = d; break
        nat_el = el.find(".//NATIONALITY")
        nat_str = clean(nat_el.findtext("VALUE") or "") if nat_el is not None else None
        fp = sha256(json.dumps({"name": primary_name, "program": program, "type": etype, "dob": dob_str, "nationality": nat_str, "aliases": sorted(aliases)}, sort_keys=True))
        result[cid] = {"id": cid, "name": primary_name, "type": etype, "program": program, "dob": dob_str, "nationality": nat_str, "aliases": aliases, "_fingerprint": fp}

    for el in root.findall(".//INDIVIDUAL"): process(el, "individual")
    for el in root.findall(".//ENTITY"):     process(el, "organization")

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, UN_URL

# ── Versionshantering med bulk-inserts ────────────────────────────────────────

def update_source(source, new_entries, source_date, download_url):
    print(f"\n=== Uppdaterar {source} ===")
    now = datetime.now(timezone.utc)
    conn = get_conn()
    cur  = conn.cursor()

    # Hämta befintliga aktiva entiteter i ett anrop
    fp_hash = sha256(json.dumps({k: v["_fingerprint"] for k, v in new_entries.items()}, sort_keys=True))
    cur.execute("SELECT id FROM list_snapshot WHERE source = %s AND version_hash = %s", (source, fp_hash))
    if cur.fetchone():
        print("  Ingen förändring sedan senaste inläsning. Avslutar.")
        conn.close()
        return
    version_hash = fp_hash
    cur.execute("""
        SELECT e.canonical_id, e.id, ev.id, ev.program, ev.dob, ev.nationality, e.primary_name
        FROM entity e
        JOIN entity_version ev ON ev.entity_id = e.id
        WHERE e.source = %s AND e.is_active = true AND ev.valid_to IS NULL
    """, (source,))
    existing = {r[0]: {"entity_id": r[1], "version_id": r[2], "program": r[3], "dob": r[4], "nationality": r[5], "name": r[6]} for r in cur.fetchall()}

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
        INSERT INTO list_snapshot (source, snapshot_date, version_hash, entity_count, download_url, fetched_at)
        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
    """, (source, source_date, version_hash, len(new_entries), download_url, now))
    snapshot_id = cur.fetchone()[0]
    conn.commit()
    print(f"  Snapshot skapad: {snapshot_id}")

    delta_rows = []

    # ── BORTTAGNA — bulk UPDATE ───────────────────────────────────────────────
    if removed_ids:
        t0 = time.time()
        removed_version_ids = [existing[cid]["version_id"] for cid in removed_ids]
        removed_entity_ids  = [existing[cid]["entity_id"]  for cid in removed_ids]
        cur.execute("UPDATE entity_version SET valid_to = %s WHERE id = ANY(%s::uuid[])", (now, removed_version_ids))
        cur.execute("UPDATE entity SET is_active = false WHERE id = ANY(%s::uuid[])", (removed_entity_ids,))
        conn.commit()
        for cid in removed_ids:
            delta_rows.append((str(uuid.uuid4()), str(snapshot_id), existing[cid]["entity_id"], "removed", None, existing[cid]["name"], None, now))
        print(f"  Borttagna stängda: {len(removed_ids)} ({time.time()-t0:.1f}s)")

    # ── TILLAGDA — bulk INSERT ────────────────────────────────────────────────
    if added_ids:
        t0 = time.time()
        # Kolla inaktiva som kan återaktiveras
        cur.execute("SELECT canonical_id, id FROM entity WHERE source = %s AND canonical_id = ANY(%s) AND is_active = false",
                    (source, list(added_ids)))
        reactivate_map = {r[0]: r[1] for r in cur.fetchall()}

        new_entity_rows = []
        reactivate_ids  = []
        eid_map = {}  # canonical_id -> entity_id

        for cid in added_ids:
            if cid in reactivate_map:
                eid_map[cid] = reactivate_map[cid]
                reactivate_ids.append(reactivate_map[cid])
            else:
                eid = str(uuid.uuid4())
                eid_map[cid] = eid
                e = new_entries[cid]
                new_entity_rows.append((eid, cid, source, e.get("type", "unknown"), e.get("name", ""), now, now, True))

        # Bulk insert nya entiteter
        if new_entity_rows:
            execute_values(cur,
                "INSERT INTO entity (id,canonical_id,source,entity_type,primary_name,first_seen_at,last_seen_at,is_active) VALUES %s ON CONFLICT (canonical_id,source) DO UPDATE SET is_active=true, last_seen_at=EXCLUDED.last_seen_at",
                new_entity_rows)

        # Bulk återaktivera inaktiva
        if reactivate_ids:
            cur.execute("UPDATE entity SET is_active = true WHERE id = ANY(%s::uuid[])", (reactivate_ids,))

        conn.commit()

        # Hämta faktiska id:n från DB för alla added_ids (hanterar ON CONFLICT korrekt)
        cur.execute("SELECT canonical_id, id FROM entity WHERE source = %s AND canonical_id = ANY(%s)",
                    (source, list(added_ids)))
        eid_map = {r[0]: str(r[1]) for r in cur.fetchall()}

        # Bulk insert entity_version och namn
        ev_rows   = []
        name_rows = []
        for cid in added_ids:
            e   = new_entries[cid]
            eid = eid_map[cid]
            vid = str(uuid.uuid4())
            ev_rows.append((vid, eid, str(snapshot_id), e.get("program"), None, e.get("gender"), e.get("dob"), e.get("pob"), e.get("nationality"), now, None))
            name_rows.append((str(uuid.uuid4()), vid, "primary", e.get("name", ""), None))
            for alias in (e.get("aliases") or []):
                if alias: name_rows.append((str(uuid.uuid4()), vid, "alias", alias, None))
            delta_rows.append((str(uuid.uuid4()), str(snapshot_id), eid, "added", None, None, e.get("name", ""), now))

        execute_values(cur, "INSERT INTO entity_version (id,entity_id,snapshot_id,program,title,gender,dob,pob,nationality,valid_from,valid_to) VALUES %s ON CONFLICT DO NOTHING", ev_rows)
        execute_values(cur, "INSERT INTO name (id,entity_version_id,name_type,full_name,language) VALUES %s ON CONFLICT DO NOTHING", name_rows)
        conn.commit()
        print(f"  Tillagda insatta: {len(added_ids)} ({time.time()-t0:.1f}s)")

    # ── ÄNDRADE — beräkna i minnet, bulk UPDATE + INSERT ─────────────────────
    WATCH = [("name","name","name"), ("program","program","program"), ("dob","dob","dob"), ("nationality","nationality","nationality")]

    changed_version_ids  = []
    changed_entity_ids   = []
    changed_entity_names = []
    mod_ev_rows          = []
    mod_name_rows        = []
    modified_count       = 0

    t0 = time.time()
    for cid in common_ids:
        e    = new_entries[cid]
        exst = existing[cid]
        changed_fields = [(label, exst.get(ok), e.get(nk)) for label, ok, nk in WATCH if exst.get(ok) != e.get(nk)]

        if changed_fields:
            changed_version_ids.append(exst["version_id"])
            changed_entity_ids.append(exst["entity_id"])
            changed_entity_names.append((e.get("name"), exst["entity_id"]))

            vid = str(uuid.uuid4())
            mod_ev_rows.append((vid, exst["entity_id"], str(snapshot_id), e.get("program"), None, e.get("gender"), e.get("dob"), e.get("pob"), e.get("nationality"), now, None))
            mod_name_rows.append((str(uuid.uuid4()), vid, "primary", e.get("name", ""), None))
            for alias in (e.get("aliases") or []):
                if alias: mod_name_rows.append((str(uuid.uuid4()), vid, "alias", alias, None))
            for label, old_val, new_val in changed_fields:
                delta_rows.append((str(uuid.uuid4()), str(snapshot_id), exst["entity_id"], "modified", label,
                                   str(old_val) if old_val is not None else None,
                                   str(new_val) if new_val is not None else None, now))
            modified_count += 1

    # Bulk stäng gamla versioner
    if changed_version_ids:
        cur.execute("UPDATE entity_version SET valid_to = %s WHERE id = ANY(%s::uuid[])", (now, changed_version_ids))
    # Bulk uppdatera entitetsnamn
    if changed_entity_names:
        execute_values(cur, "UPDATE entity SET primary_name = data.name FROM (VALUES %s) AS data(name, id) WHERE entity.id = data.id::uuid",
                       changed_entity_names)
    if mod_ev_rows:
        execute_values(cur, "INSERT INTO entity_version (id,entity_id,snapshot_id,program,title,gender,dob,pob,nationality,valid_from,valid_to) VALUES %s", mod_ev_rows)
        execute_values(cur, "INSERT INTO name (id,entity_version_id,name_type,full_name,language) VALUES %s", mod_name_rows)

    conn.commit()
    print(f"  Modifierade: {modified_count} ({time.time()-t0:.1f}s)")

    # ── DELTA LOG — bulk INSERT ───────────────────────────────────────────────
    if delta_rows:
        t0 = time.time()
        execute_values(cur,
            "INSERT INTO delta_log (id,snapshot_id,entity_id,change_type,field_changed,old_value,new_value,logged_at) VALUES %s",
            delta_rows)
        conn.commit()
        print(f"  Delta-poster loggade: {len(delta_rows)} ({time.time()-t0:.1f}s)")

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
        if source == "OFAC":   entries, date, url = load_ofac_entries()
        elif source == "EU":   entries, date, url = load_eu_entries()
        elif source == "UN":   entries, date, url = load_un_entries()
        update_source(source, entries, date, url)
        print(f"  Total tid: {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
