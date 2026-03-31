"""
update_sanctions.py
-------------------
Uppdaterar sanctions-databasen med komplett versionshantering och deltalogik.
Historiserar namn, adresser, dokument och alias.
Använder bulk-inserts för hög prestanda.

Kör med:
    python update_sanctions.py --source OFAC
    python update_sanctions.py --source EU
    python update_sanctions.py --source UN
    python update_sanctions.py --source ALL

Kräver:
    pip install psycopg2-binary lxml
"""

import sys, uuid, hashlib, json, time, argparse, urllib.request
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

OFAC_JSON   = "public/sanctions.json"
EU_XML      = "eu_sanctions.xml"
UN_XML      = "un_sanctions.xml"
EU_URL      = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
UN_URL      = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
NS_EU       = "http://eu.europa.ec/fpi/fsd/export"
# ─────────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD, connect_timeout=30,
        options="-c statement_timeout=0")

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

def tag(n): return f"{{{NS_EU}}}{n}"

# ── Entry = dict med alla fält inkl sub-data ──────────────────────────────────
# Struktur: { id, name, type, program, gender, dob, pob, nationality,
#             aliases: [...], addresses: [...], documents: [{type,number,country}] }

def fingerprint(e):
    """Beräknar hash på alla fält som ska historiseras."""
    return sha256(json.dumps({
        "name":        e.get("name"),
        "program":     e.get("program"),
        "dob":         e.get("dob"),
        "nationality": e.get("nationality"),
        "aliases":     sorted(e.get("aliases", [])),
        "addresses":   sorted(e.get("addresses", [])),
        "documents":   sorted([f"{d['type']}:{d['number']}:{d['country']}" for d in e.get("documents", [])]),
    }, sort_keys=True))

# ── OFAC parser ───────────────────────────────────────────────────────────────
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
        entry = {
            "id":          cid,
            "name":        name,
            "type":        e.get("type", "unknown"),
            "program":     e.get("program"),
            "gender":      e.get("gender"),
            "dob":         e.get("dob"),
            "pob":         e.get("pob"),
            "nationality": e.get("nationality"),
            "aliases":     [a for a in e.get("aliases", []) if a],
            "addresses":   [a for a in e.get("addresses", []) if a],
            "documents":   [{"type": "passport",    "number": p.get("number"), "country": p.get("country") or ""} for p in e.get("passports", []) if p.get("number")]
                         + [{"type": "national_id", "number": n.get("number"), "country": n.get("country") or ""} for n in e.get("national_ids", []) if n.get("number")],
        }
        entry["_fingerprint"] = fingerprint(entry)
        result[cid] = entry

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, "https://www.treasury.gov/ofac/downloads/sdn.csv"

# ── EU parser ─────────────────────────────────────────────────────────────────
def load_eu_entries():
    download_file(EU_URL, EU_XML)
    print(f"Parsar {EU_XML}...")
    tree = etree.parse(EU_XML)
    root = tree.getroot()

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

        gender = None
        for na in name_aliases:
            g = na.get("gender", "").strip()
            if g in ("M", "F"):
                gender = "Male" if g == "M" else "Female"
                break

        dob_str = pob_str = None
        for bd in el.findall(tag("birthdate")):
            if not dob_str:
                dob_str = bd.get("birthdate", "") or bd.get("year", "") or None
            if not pob_str:
                city = bd.get("city", "").strip()
                country = bd.get("countryDescription", "").strip()
                if city or country:
                    pob_str = ", ".join(p for p in [city, country] if p and p != "UNKNOWN") or None

        nat_str = None
        cit = el.find(tag("citizenship"))
        if cit is not None:
            nat_str = cit.get("countryDescription", "").strip() or None

        addresses = []
        for addr_el in el.findall(tag("address")):
            parts = [addr_el.get("street","").strip(), addr_el.get("city","").strip(),
                     addr_el.get("zipCode","").strip(), addr_el.get("countryDescription","").strip()]
            full = ", ".join(p for p in parts if p and p != "UNKNOWN")
            if full: addresses.append(full)

        documents = []
        for id_el in el.findall(tag("identification")):
            dt_raw = id_el.get("identificationTypeCode", "").lower()
            dt = "passport" if "passport" in dt_raw else "national_id" if "id" in dt_raw else "other"
            num = id_el.get("number", "").strip()
            country = id_el.get("countryDescription", "").strip() or ""
            if num: documents.append({"type": dt, "number": num, "country": country})

        entry = {"id": cid, "name": primary_name, "type": etype, "program": program,
                 "gender": gender, "dob": dob_str, "pob": pob_str, "nationality": nat_str,
                 "aliases": aliases, "addresses": addresses, "documents": documents}
        entry["_fingerprint"] = fingerprint(entry)
        result[cid] = entry

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, EU_URL

# ── UN parser ─────────────────────────────────────────────────────────────────
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

    def process_individual(el):
        ref = clean(el.findtext("REFERENCE_NUMBER") or el.findtext("DATAID") or "")
        first = clean(el.findtext("FIRST_NAME") or "")
        if not first: return
        parts = [first] + [clean(el.findtext(f) or "") for f in ["SECOND_NAME","THIRD_NAME","FOURTH_NAME"]]
        name = " ".join(p for p in parts if p)
        name_hash = sha256(name)
        cid = ref or f"UN-IND-{name_hash[:12]}"
        program = clean(el.findtext("UN_LIST_TYPE") or "")

        dob_str = pob_str = nat_str = None
        for dob_el in el.findall(".//INDIVIDUAL_DATE_OF_BIRTH"):
            d = clean(dob_el.findtext("DATE") or dob_el.findtext("YEAR") or "")
            if d: dob_str = d; break
        for pob_el in el.findall(".//INDIVIDUAL_PLACE_OF_BIRTH"):
            city = clean(pob_el.findtext("CITY") or "")
            country = clean(pob_el.findtext("COUNTRY") or "")
            pob_str = ", ".join(p for p in [city, country] if p) or None
            if pob_str: break
        for nat_el in el.findall(".//NATIONALITY/VALUE"):
            nat_str = clean(nat_el.text or "")
            if nat_str: break

        aliases = [clean(a.findtext("ALIAS_NAME") or "") for a in el.findall(".//INDIVIDUAL_ALIAS") if clean(a.findtext("ALIAS_NAME") or "")]
        addresses = []
        for addr_el in el.findall(".//INDIVIDUAL_ADDRESS"):
            parts = [clean(addr_el.findtext(t) or "") for t in ["STREET","CITY","STATE_PROVINCE","COUNTRY"]]
            full = ", ".join(p for p in parts if p)
            if full: addresses.append(full)
        documents = []
        for doc_el in el.findall(".//INDIVIDUAL_DOCUMENT"):
            dt_raw = (clean(doc_el.findtext("TYPE_OF_DOCUMENT") or "") or "").lower()
            dt = "passport" if "passport" in dt_raw else "national_id" if "id" in dt_raw else "other"
            num = clean(doc_el.findtext("NUMBER") or "")
            country = clean(doc_el.findtext("COUNTRY_OF_ISSUE") or "") or ""
            if num: documents.append({"type": dt, "number": num, "country": country})

        entry = {"id": cid, "name": name, "type": "individual", "program": program,
                 "gender": None, "dob": dob_str, "pob": pob_str, "nationality": nat_str,
                 "aliases": aliases, "addresses": addresses, "documents": documents}
        entry["_fingerprint"] = fingerprint(entry)
        result[cid] = entry

    def process_entity(el):
        ref = clean(el.findtext("REFERENCE_NUMBER") or el.findtext("DATAID") or "")
        name = clean(el.findtext("FIRST_NAME") or "")
        if not name: return
        name_hash = sha256(name)
        cid = ref or f"UN-ORG-{name_hash[:12]}"
        program = clean(el.findtext("UN_LIST_TYPE") or "")
        aliases = [clean(a.findtext("ALIAS_NAME") or "") for a in el.findall(".//ENTITY_ALIAS") if clean(a.findtext("ALIAS_NAME") or "")]
        addresses = []
        for addr_el in el.findall(".//ENTITY_ADDRESS"):
            parts = [clean(addr_el.findtext(t) or "") for t in ["STREET","CITY","STATE_PROVINCE","COUNTRY"]]
            full = ", ".join(p for p in parts if p)
            if full: addresses.append(full)

        entry = {"id": cid, "name": name, "type": "organization", "program": program,
                 "gender": None, "dob": None, "pob": None, "nationality": None,
                 "aliases": aliases, "addresses": addresses, "documents": []}
        entry["_fingerprint"] = fingerprint(entry)
        result[cid] = entry

    for el in root.findall(".//INDIVIDUAL"): process_individual(el)
    for el in root.findall(".//ENTITY"):     process_entity(el)

    print(f"  {len(result)} entiteter (listdatum: {source_date})")
    return result, source_date, UN_URL

# ── Versionshantering ─────────────────────────────────────────────────────────
def update_source(source, new_entries, source_date, download_url):
    print(f"\n=== Uppdaterar {source} ===")
    now = datetime.now(timezone.utc)
    conn = get_conn()
    cur  = conn.cursor()

    # Kontrollera om data ändrats via fingerprint-hash
    fp_hash = sha256(json.dumps({k: v["_fingerprint"] for k, v in new_entries.items()}, sort_keys=True))
    cur.execute("SELECT id FROM list_snapshot WHERE source = %s AND version_hash = %s", (source, fp_hash))
    if cur.fetchone():
        print("  Ingen förändring sedan senaste inläsning. Avslutar.")
        print(f"STATUS:no_change:{source}")
        conn.close()
        return

    # Hämta aktiva entiteter + aktuella fingerprints
    cur.execute("""
        SELECT e.canonical_id, e.id, ev.id, e.primary_name,
               ev.program, ev.dob, ev.nationality
        FROM entity e
        JOIN entity_version ev ON ev.entity_id = e.id
        WHERE e.source = %s AND e.is_active = true AND ev.valid_to IS NULL
    """, (source,))
    existing = {r[0]: {"entity_id": r[1], "version_id": r[2], "name": r[3],
                        "program": r[4], "dob": r[5], "nationality": r[6]} for r in cur.fetchall()}

    # Hämta befintliga sub-data per version_id för fingerprint-jämförelse
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
    """, (source, source_date, fp_hash, len(new_entries), download_url, now))
    snapshot_id = cur.fetchone()[0]
    conn.commit()
    print(f"  Snapshot skapad: {snapshot_id}")

    delta_rows = []

    # ── BORTTAGNA ─────────────────────────────────────────────────────────────
    if removed_ids:
        t0 = time.time()
        removed_version_ids = [existing[cid]["version_id"] for cid in removed_ids]
        removed_entity_ids  = [existing[cid]["entity_id"]  for cid in removed_ids]
        cur.execute("UPDATE entity_version SET valid_to = %s WHERE id = ANY(%s::uuid[])", (now, removed_version_ids))
        cur.execute("UPDATE entity SET is_active = false WHERE id = ANY(%s::uuid[])", (removed_entity_ids,))
        conn.commit()
        for cid in removed_ids:
            delta_rows.append((str(uuid.uuid4()), str(snapshot_id), existing[cid]["entity_id"],
                               "removed", None, existing[cid]["name"], None, now))
        print(f"  Borttagna: {len(removed_ids)} ({time.time()-t0:.1f}s)")

    # ── TILLAGDA ──────────────────────────────────────────────────────────────
    if added_ids:
        t0 = time.time()
        cur.execute("SELECT canonical_id, id FROM entity WHERE source = %s AND canonical_id = ANY(%s) AND is_active = false",
                    (source, list(added_ids)))
        reactivate_map = {r[0]: r[1] for r in cur.fetchall()}

        new_entity_rows = []
        reactivate_ids  = []
        eid_map = {}

        for cid in added_ids:
            if cid in reactivate_map:
                eid_map[cid] = reactivate_map[cid]
                reactivate_ids.append(reactivate_map[cid])
            else:
                eid = str(uuid.uuid4())
                eid_map[cid] = eid
                e = new_entries[cid]
                new_entity_rows.append((eid, cid, source, e.get("type","unknown"), e.get("name",""), now, now, True))

        if new_entity_rows:
            execute_values(cur,
                "INSERT INTO entity (id,canonical_id,source,entity_type,primary_name,first_seen_at,last_seen_at,is_active) VALUES %s ON CONFLICT (canonical_id,source) DO UPDATE SET is_active=true",
                new_entity_rows)
        if reactivate_ids:
            cur.execute("UPDATE entity SET is_active = true WHERE id = ANY(%s::uuid[])", (reactivate_ids,))
        conn.commit()

        # Hämta faktiska id:n
        cur.execute("SELECT canonical_id, id FROM entity WHERE source = %s AND canonical_id = ANY(%s)",
                    (source, list(added_ids)))
        eid_map = {r[0]: str(r[1]) for r in cur.fetchall()}

        ev_rows = []; name_rows = []; addr_rows = []; doc_rows = []
        for cid in added_ids:
            e = new_entries[cid]
            eid = eid_map.get(cid)
            if not eid: continue
            vid = str(uuid.uuid4())
            ev_rows.append((vid, eid, str(snapshot_id), e.get("program"), None, e.get("gender"),
                             e.get("dob"), e.get("pob"), e.get("nationality"), now, None))
            name_rows.append((str(uuid.uuid4()), vid, "primary", e.get("name",""), None))
            for alias in (e.get("aliases") or []):
                if alias: name_rows.append((str(uuid.uuid4()), vid, "alias", alias, None))
            for addr in (e.get("addresses") or []):
                if addr: addr_rows.append((str(uuid.uuid4()), vid, addr))
            for doc in (e.get("documents") or []):
                if doc.get("number"): doc_rows.append((str(uuid.uuid4()), vid, doc["type"], doc["number"], doc.get("country")))
            delta_rows.append((str(uuid.uuid4()), str(snapshot_id), eid, "added", None, None, e.get("name",""), now))

        execute_values(cur, "INSERT INTO entity_version (id,entity_id,snapshot_id,program,title,gender,dob,pob,nationality,valid_from,valid_to) VALUES %s ON CONFLICT DO NOTHING", ev_rows)
        if name_rows: execute_values(cur, "INSERT INTO name (id,entity_version_id,name_type,full_name,language) VALUES %s ON CONFLICT DO NOTHING", name_rows)
        if addr_rows: execute_values(cur, "INSERT INTO address (id,entity_version_id,full_address) VALUES %s ON CONFLICT DO NOTHING", addr_rows)
        if doc_rows:  execute_values(cur, "INSERT INTO document (id,entity_version_id,doc_type,doc_number,issuing_country) VALUES %s ON CONFLICT DO NOTHING", doc_rows)
        conn.commit()
        print(f"  Tillagda: {len(added_ids)} ({time.time()-t0:.1f}s)")

    # ── ÄNDRADE ───────────────────────────────────────────────────────────────
    # Hämta befintliga sub-data för fingerprint-jämförelse
    if common_ids:
        existing_version_ids = [existing[cid]["version_id"] for cid in common_ids]
        cur.execute("SELECT entity_version_id, full_name, name_type FROM name WHERE entity_version_id = ANY(%s::uuid[])", (existing_version_ids,))
        existing_aliases = {}
        for r in cur.fetchall():
            vid = str(r[0])
            if r[2] != "primary":
                existing_aliases.setdefault(vid, []).append(r[1])

        cur.execute("SELECT entity_version_id, full_address FROM address WHERE entity_version_id = ANY(%s::uuid[])", (existing_version_ids,))
        existing_addresses = {}
        for r in cur.fetchall():
            existing_addresses.setdefault(str(r[0]), []).append(r[1])

        cur.execute("SELECT entity_version_id, doc_type, doc_number, issuing_country FROM document WHERE entity_version_id = ANY(%s::uuid[])", (existing_version_ids,))
        existing_docs = {}
        for r in cur.fetchall():
            existing_docs.setdefault(str(r[0]), []).append({"type": r[1], "number": r[2], "country": r[3] or ""})

    t0 = time.time()
    changed_version_ids = []; changed_entity_data = []
    mod_ev_rows = []; mod_name_rows = []; mod_addr_rows = []; mod_doc_rows = []
    modified_count = 0

    WATCH = [("name","name","name"), ("program","program","program"),
             ("dob","dob","dob"), ("nationality","nationality","nationality")]

    for cid in common_ids:
        e    = new_entries[cid]
        exst = existing[cid]
        vid_old = exst["version_id"]

        # Bygg befintligt fingerprint från DB-data
        old_entry = {
            "name":        exst["name"],
            "program":     exst["program"],
            "dob":         exst["dob"],
            "nationality": exst["nationality"],
            "aliases":     existing_aliases.get(vid_old, []),
            "addresses":   existing_addresses.get(vid_old, []),
            "documents":   existing_docs.get(vid_old, []),
        }
        old_fp = sha256(json.dumps({
            "name":        old_entry["name"],
            "program":     old_entry["program"],
            "dob":         old_entry["dob"],
            "nationality": old_entry["nationality"],
            "aliases":     sorted(old_entry["aliases"]),
            "addresses":   sorted(old_entry["addresses"]),
            "documents":   sorted([f"{d['type']}:{d['number']}:{d['country']}" for d in old_entry["documents"]]),
        }, sort_keys=True))

        if old_fp == e["_fingerprint"]:
            continue  # Inget ändrat

        # Hitta specifika fält som ändrats för delta_log
        changed_fields = [(label, exst.get(ok), e.get(nk)) for label, ok, nk in WATCH if exst.get(ok) != e.get(nk)]
        if old_entry["aliases"] != sorted(e.get("aliases", [])):
            changed_fields.append(("aliases", str(sorted(old_entry["aliases"])), str(sorted(e.get("aliases", [])))))
        if old_entry["addresses"] != sorted(e.get("addresses", [])):
            changed_fields.append(("addresses", str(sorted(old_entry["addresses"])), str(sorted(e.get("addresses", [])))))

        changed_version_ids.append(vid_old)
        changed_entity_data.append((e.get("name"), exst["entity_id"]))

        vid_new = str(uuid.uuid4())
        mod_ev_rows.append((vid_new, exst["entity_id"], str(snapshot_id), e.get("program"), None,
                             e.get("gender"), e.get("dob"), e.get("pob"), e.get("nationality"), now, None))
        mod_name_rows.append((str(uuid.uuid4()), vid_new, "primary", e.get("name",""), None))
        for alias in (e.get("aliases") or []):
            if alias: mod_name_rows.append((str(uuid.uuid4()), vid_new, "alias", alias, None))
        for addr in (e.get("addresses") or []):
            if addr: mod_addr_rows.append((str(uuid.uuid4()), vid_new, addr))
        for doc in (e.get("documents") or []):
            if doc.get("number"): mod_doc_rows.append((str(uuid.uuid4()), vid_new, doc["type"], doc["number"], doc.get("country")))

        for label, old_val, new_val in changed_fields:
            delta_rows.append((str(uuid.uuid4()), str(snapshot_id), exst["entity_id"], "modified", label,
                               str(old_val) if old_val is not None else None,
                               str(new_val) if new_val is not None else None, now))
        modified_count += 1

    if changed_version_ids:
        cur.execute("UPDATE entity_version SET valid_to = %s WHERE id = ANY(%s::uuid[])", (now, changed_version_ids))
    if changed_entity_data:
        execute_values(cur, "UPDATE entity SET primary_name = data.name FROM (VALUES %s) AS data(name, id) WHERE entity.id = data.id::uuid", changed_entity_data)
    if mod_ev_rows:
        execute_values(cur, "INSERT INTO entity_version (id,entity_id,snapshot_id,program,title,gender,dob,pob,nationality,valid_from,valid_to) VALUES %s", mod_ev_rows)
    if mod_name_rows:
        execute_values(cur, "INSERT INTO name (id,entity_version_id,name_type,full_name,language) VALUES %s", mod_name_rows)
    if mod_addr_rows:
        execute_values(cur, "INSERT INTO address (id,entity_version_id,full_address) VALUES %s", mod_addr_rows)
    if mod_doc_rows:
        execute_values(cur, "INSERT INTO document (id,entity_version_id,doc_type,doc_number,issuing_country) VALUES %s", mod_doc_rows)
    conn.commit()
    print(f"  Ändrade: {modified_count} ({time.time()-t0:.1f}s)")

    # ── DELTA LOG ─────────────────────────────────────────────────────────────
    if delta_rows:
        t0 = time.time()
        execute_values(cur,
            "INSERT INTO delta_log (id,snapshot_id,entity_id,change_type,field_changed,old_value,new_value,logged_at) VALUES %s",
            delta_rows)
        conn.commit()
        print(f"  Delta-poster: {len(delta_rows)} ({time.time()-t0:.1f}s)")

    cur.close()
    conn.close()
    added_count = len([d for d in delta_rows if d[3] == "added"])
    removed_count = len([d for d in delta_rows if d[3] == "removed"])
    print(f"  Klar!")
    print(f"STATUS:done:{source}:added={added_count},removed={removed_count},modified={modified_count}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["OFAC","EU","UN","ALL"], default="ALL")
    args = parser.parse_args()
    sources = ["OFAC","EU","UN"] if args.source == "ALL" else [args.source]

    for source in sources:
        t0 = time.time()
        if source == "OFAC":   entries, date, url = load_ofac_entries()
        elif source == "EU":   entries, date, url = load_eu_entries()
        elif source == "UN":   entries, date, url = load_un_entries()
        update_source(source, entries, date, url)
        print(f"  Total tid: {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
