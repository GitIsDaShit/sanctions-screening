"""
Import customers from Kundlista 2024.xlsx into Supabase.
Tables: customers, customer_divisions, contacts, customer_contacts
Uses batch inserts: 4 total requests instead of ~1000.
"""

import re
import sys
import requests
import pandas as pd
from datetime import datetime

# ── Load .env.local ──────────────────────────────────────────────────────────
def load_env(path=".env.local"):
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except FileNotFoundError:
        sys.exit(f"Could not find {path}")
    return env

env = load_env()
SUPABASE_URL = env.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = env.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env.local")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# ── Supabase REST helper ─────────────────────────────────────────────────────
def sb_batch_insert(table, rows):
    if not rows:
        return []
    payload = list(rows)
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=HEADERS, json=payload)
    if not r.ok:
        sys.exit(f"[ERROR] {table}: {r.status_code} — {r.text[:400]}")
    return r.json()

# ── Helpers ──────────────────────────────────────────────────────────────────
STATUS_KEYWORDS = {
    "avvecklas": "avvecklas",
    "avveckling": "avvecklas",
    "churnat": "avvecklas",
    "churn": "avvecklas",
    "inaktiv": "inaktiv",
    "potentiell": "potentiell",
    "aktiv": "aktiv",
}

def detect_status(text):
    if not text or _is_blank(text):
        return "aktiv"
    lower = str(text).lower()
    for keyword, status in STATUS_KEYWORDS.items():
        if keyword in lower:
            return status
    return "aktiv"

def parse_name_role(entry: str) -> tuple[str, str | None]:
    """Split 'Mattias Ullsten - verksamhet' into ('Mattias Ullsten', 'Verksamhet')."""
    parts = entry.split(" - ", 1)
    name = parts[0].strip()
    role = parts[1].strip().capitalize() if len(parts) == 2 and parts[1].strip() else None
    return name, role

def parse_names_with_roles(cell) -> list[tuple[str, str | None]]:
    """Return list of (name, role) tuples parsed from a cell."""
    if _is_blank(cell):
        return []
    entries = [e.strip() for e in re.split(r"[,;\n/]+", str(cell)) if e.strip()]
    return [parse_name_role(e) for e in entries]

def parse_year(val):
    if _is_blank(val):
        return None
    try:
        return int(float(str(val)))
    except (ValueError, TypeError):
        return None

def parse_date(val):
    if _is_blank(val):
        return None
    if isinstance(val, datetime):
        return val.date().isoformat()
    try:
        return pd.to_datetime(str(val)).date().isoformat()
    except Exception:
        return None

def clean(val):
    if _is_blank(val):
        return None
    s = str(val).strip()
    return s if s else None

def _is_blank(val):
    if val is None:
        return True
    try:
        return pd.isna(val)
    except (TypeError, ValueError):
        return False

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    xl_path = "Kundlista 2024.xlsx"
    print(f"Reading {xl_path} ...")
    df = pd.read_excel(xl_path, dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    print(f"Columns: {list(df.columns)}")
    print(f"Rows   : {len(df)}\n")

    # ── 1. Build customer payload ────────────────────────────────────────────
    customer_rows = []
    valid_df_rows = []
    for _, row in df.iterrows():
        name = clean(row.get("Kund"))
        if not name:
            continue
        status_text = clean(row.get("Status och kontakt"))
        customer_rows.append({
            "name": name,
            "industry": clean(row.get("Industri")),
            "sas_direct_sales_nr": clean(row.get("SAS Direct Sales nr")),
            "status": detect_status(status_text),
            "notes": status_text,
            "action_needed": clean(row.get("AP")),
            "latest_contract_year": parse_year(row.get("Senaste avtalsår")),
            "last_updated": parse_date(row.get("Uppdaterad")),
        })
        valid_df_rows.append(row)

    print(f"Inserting {len(customer_rows)} customers ...")
    inserted_customers = sb_batch_insert("customers", customer_rows)
    print(f"  -> {len(inserted_customers)} inserted\n")

    # ── 2. Build divisions & contacts payloads ───────────────────────────────
    division_rows = []
    contact_key_to_idx: dict[tuple, int] = {}
    unique_contacts: list[dict] = []

    contact_cols = [
        ("Kundkontakt - Roll", "kund"),
        ("Infotrekkontakt",    "infotrek"),
        ("SAS kontakt",        "sas"),
    ]

    # (cust_id, contact_key, role)
    customer_contact_links: list[tuple[str, tuple, str | None]] = []

    for cust_record, df_row in zip(inserted_customers, valid_df_rows):
        cust_id = cust_record["id"]

        division = clean(df_row.get("Underavdelning"))
        if division:
            division_rows.append({"customer_id": cust_id, "name": division})

        for col, ctype in contact_cols:
            for cname, role in parse_names_with_roles(df_row.get(col)):
                key = (cname.lower(), ctype)
                if key not in contact_key_to_idx:
                    contact_key_to_idx[key] = len(unique_contacts)
                    unique_contacts.append({"full_name": cname, "contact_type": ctype})
                customer_contact_links.append((cust_id, key, role))

    # ── 3. Batch insert divisions ────────────────────────────────────────────
    if division_rows:
        print(f"Inserting {len(division_rows)} divisions ...")
        sb_batch_insert("customer_divisions", division_rows)
        print(f"  -> done\n")

    # ── 4. Batch insert contacts ─────────────────────────────────────────────
    if unique_contacts:
        print(f"Inserting {len(unique_contacts)} unique contacts ...")
        inserted_contacts = sb_batch_insert("contacts", unique_contacts)
        contact_id_map: dict[tuple, str] = {
            (c["full_name"].lower(), c["contact_type"]): rec["id"]
            for rec, c in zip(inserted_contacts, unique_contacts)
        }
        print(f"  -> done\n")
    else:
        contact_id_map = {}

    # ── 5. Batch insert customer_contacts ────────────────────────────────────
    cc_rows = [
        {"customer_id": cust_id, "contact_id": contact_id_map[key], "role_at_customer": role}
        for cust_id, key, role in customer_contact_links
        if key in contact_id_map
    ]
    if cc_rows:
        print(f"Inserting {len(cc_rows)} customer-contact links ...")
        sb_batch_insert("customer_contacts", cc_rows)
        print(f"  -> done\n")

    print(
        f"Done -- {len(inserted_customers)} customers, {len(division_rows)} divisions, "
        f"{len(unique_contacts)} contacts, {len(cc_rows)} links."
    )

if __name__ == "__main__":
    main()
