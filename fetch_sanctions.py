"""
fetch_sanctions.py
------------------
Laddar ner OFAC SDN-listan (sdn.csv, add.csv, alt.csv)
och konverterar till sanctions.json för Vite public/-mappen.

Kör: python fetch_sanctions.py
Kräver: pip install requests
"""

import csv
import json
import re
import sys
from io import StringIO
from collections import defaultdict

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests

BASE_URL   = "https://www.treasury.gov/ofac/downloads/"
SDN_URL    = BASE_URL + "sdn.csv"
ADD_URL    = BASE_URL + "add.csv"
ALT_URL    = BASE_URL + "alt.csv"
OUTPUT     = "sanctions.json"

def download(url):
    print(f"  Laddar ner {url.split('/')[-1]}...")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    last_modified = r.headers.get("Last-Modified", "")
    return r.content.decode("latin-1"), last_modified

def clean(val):
    if not val or val.strip() in ("-0-", ""):
        return ""
    return val.strip()

def parse_remarks(remarks):
    """Extrahera strukturerad info från remarks-fältet."""
    if not remarks:
        return {}
    result = {}

    dob = re.findall(r'DOB\s+([\d]{1,2}\s+\w+\s+\d{4}|\d{4})', remarks)
    if dob:
        result["dob"] = "; ".join(dob)

    pob = re.search(r'POB\s+([^;]+)', remarks)
    if pob:
        result["pob"] = pob.group(1).strip().rstrip(".")

    nat = re.findall(r'nationality\s+([A-Za-z ]+?)(?:;|,|\.|$)', remarks, re.IGNORECASE)
    if nat:
        result["nationality"] = "; ".join(n.strip() for n in nat)

    gender = re.search(r'Gender\s+(Male|Female)', remarks, re.IGNORECASE)
    if gender:
        result["gender"] = gender.group(1)

    passports = re.findall(r'Passport\s+([A-Z0-9]+)\s*\(([^)]+)\)', remarks)
    if passports:
        result["passports"] = [{"number": p[0], "country": p[1]} for p in passports]

    ids = re.findall(r'(?:National ID|ID No\.?)\s+([A-Z0-9\-]+)\s*(?:\(([^)]+)\))?', remarks)
    if ids:
        result["national_ids"] = [{"number": i[0], "country": i[1]} for i in ids if i[0]]

    return result

def format_name(raw):
    if "," not in raw:
        return raw.title()
    parts = raw.split(",", 1)
    return f"{parts[1].strip().title()} {parts[0].strip().title()}".strip()

def main():
    print("Laddar ner OFAC SDN-data...")

    try:
        sdn_content, last_modified = download(SDN_URL)
        add_content, _ = download(ADD_URL)
        alt_content, _ = download(ALT_URL)
    except requests.RequestException as e:
        print(f"Fel: {e}")
        sys.exit(1)

    # Försök parsa Last-Modified till ett datum
    source_date = None
    if last_modified:
        try:
            from email.utils import parsedate_to_datetime
            source_date = parsedate_to_datetime(last_modified).date().isoformat()
            print(f"  OFAC listdatum (Last-Modified): {source_date}")
        except Exception:
            pass

    # ── Parsa adresser (add.csv) ──────────────────────────────────────────────
    # Kolumner: ent_num, add_num, address, city, state, zip, country, add_remarks
    addresses = defaultdict(list)
    for row in csv.reader(StringIO(add_content)):
        if len(row) < 3:
            continue
        ent_id = clean(row[0])
        addr_parts = [clean(row[i]) for i in range(2, min(7, len(row)))]
        addr_str = ", ".join(p for p in addr_parts if p)
        if ent_id and addr_str:
            addresses[ent_id].append(addr_str)

    # ── Parsa alias (alt.csv) ─────────────────────────────────────────────────
    # Kolumner: ent_num, alt_num, alt_type, alt_name, alt_remarks
    aliases_map = defaultdict(list)
    for row in csv.reader(StringIO(alt_content)):
        if len(row) < 4:
            continue
        ent_id = clean(row[0])
        alt_name = clean(row[3])
        if ent_id and alt_name and alt_name != "-0-":
            aliases_map[ent_id].append(format_name(alt_name))

    # ── Parsa SDN-huvudfilen ──────────────────────────────────────────────────
    entries = []
    skipped = 0

    for row in csv.reader(StringIO(sdn_content)):
        if len(row) < 12:
            skipped += 1
            continue

        entry_type = clean(row[2]).lower()
        if entry_type == "-0-" or not entry_type:
            entry_type = "organization"

        raw_name = clean(row[1])
        if not raw_name:
            skipped += 1
            continue

        ent_id   = clean(row[0])
        name     = format_name(raw_name)
        program  = clean(row[3])
        title    = clean(row[4])
        remarks  = clean(row[11])

        parsed   = parse_remarks(remarks)

        entry = {
            "id":          ent_id,
            "name":        name,
            "type":        entry_type,
            "program":     program,
            "aliases":     aliases_map.get(ent_id, []),
            "addresses":   addresses.get(ent_id, []),
        }

        if title:                          entry["title"]        = title
        if parsed.get("dob"):              entry["dob"]          = parsed["dob"]
        if parsed.get("pob"):              entry["pob"]          = parsed["pob"]
        if parsed.get("nationality"):      entry["nationality"]  = parsed["nationality"]
        if parsed.get("gender"):           entry["gender"]       = parsed["gender"]
        if parsed.get("passports"):        entry["passports"]    = parsed["passports"]
        if parsed.get("national_ids"):     entry["national_ids"] = parsed["national_ids"]

        entries.append(entry)

    entries.sort(key=lambda x: x["name"])
    from collections import Counter
    type_counts = Counter(e["type"] for e in entries)
    print(f"\nResultat: {len(entries)} entiteter totalt ({skipped} rader skippade)")
    for t, count in type_counts.most_common():
        print(f"  {t}: {count}")

    output = {
        "meta": {
            "source": "OFAC Specially Designated Nationals List",
            "sdn_url": SDN_URL,
            "source_date": source_date,
            "count": len(entries),
        },
        "entries": entries
    }

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    size_kb = len(json.dumps(output, ensure_ascii=False).encode()) / 1024
    print(f"Sparad: {OUTPUT} ({size_kb:.0f} KB)")
    print(f"\nKopiera {OUTPUT} till public/ i ditt Vite-projekt och kör npm run build.")

if __name__ == "__main__":
    main()
