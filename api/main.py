"""
api/main.py
-----------
FastAPI-server för Infotrek Sanctions Screening.
Triggar uppdateringar av sanktionslistor via update_sanctions.py.

Endpoints:
  POST /update?source=OFAC&api_key=xxx  — Startar uppdatering
  GET  /status/{job_id}                 — Hämtar jobbstatus
  GET  /health                          — Hälsokontroll
"""

import os
import sys
import uuid
import threading
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

# Lägg till parent-dir i path så update_sanctions kan importeras
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_sanctions as us

app = FastAPI(title="Infotrek Sanctions API", version="1.0.0")

# CORS — tillåt anrop från Netlify-appen
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://real-sanctions-screening.netlify.app", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

API_KEY = os.environ.get("API_KEY", "infotrek-sanctions-2026")

def check_api_key(api_key: str):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

# Jobbstatus i minnet (räcker för ett enkelt verktyg)
jobs: dict = {}

def run_update(job_id: str, source: str):
    """Körs i bakgrundstråd."""
    jobs[job_id]["status"] = "running"
    sources = ["OFAC", "EU", "UN"] if source == "ALL" else [source]
    results = []

    for src in sources:
        try:
            jobs[job_id]["message"] = f"Loading {src} from source..."
            if src == "OFAC":
                entries, date, url = us.load_ofac_entries()
            elif src == "EU":
                entries, date, url = us.load_eu_entries()
            elif src == "UN":
                entries, date, url = us.load_un_entries()

            jobs[job_id]["message"] = f"Updating {src} database..."
            us.update_source(src, entries, date, url)
            results.append(f"{src}: done")
        except Exception as e:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["message"] = f"{src} failed: {str(e)}"
            jobs[job_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
            return

    # Kolla om det var no_change för alla
    all_no_change = all("no_change" in r or "Ingen förändring" in r for r in results)

    jobs[job_id]["status"] = "no_change" if all_no_change else "done"
    jobs[job_id]["message"] = " | ".join(results)
    jobs[job_id]["completed_at"] = datetime.now(timezone.utc).isoformat()


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.post("/update")
def trigger_update(
    source: str = Query("ALL", description="OFAC, EU, UN or ALL"),
    api_key: str = Query(..., description="API key"),
):
    check_api_key(api_key)
    if source not in ("OFAC", "EU", "UN", "ALL"):
        raise HTTPException(status_code=400, detail="Invalid source")

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "id":           job_id,
        "source":       source,
        "status":       "running",
        "message":      f"Starting update for {source}...",
        "started_at":   datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
    }

    # Kör i bakgrundstråd så HTTP-svaret returneras direkt
    thread = threading.Thread(target=run_update, args=(job_id, source), daemon=True)
    thread.start()

    return {"job_id": job_id, "status": "running", "source": source}


@app.get("/status/{job_id}")
def get_status(job_id: str, api_key: str = Query(...)):
    check_api_key(api_key)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/jobs")
def list_jobs(api_key: str = Query(...)):
    check_api_key(api_key)
    return list(jobs.values())
