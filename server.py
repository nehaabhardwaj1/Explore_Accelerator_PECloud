#!/usr/bin/env python
# server.py — Explore Accelerator FastAPI application entry point
# Routers: routes/kdd.py, routes/catalog.py, bdcq_agent/routes.py, a2a/router.py
import json
import logging
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# ── Bootstrap ─────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("accelerator")

# ── Shared deps ───────────────────────────────────────────────────────────────

from routes.deps import (
    CATALOG_PATH, CLAUDE_EXE, OUTPUT_DIR, PORT,
    append_run_log, load_cache, load_catalog, load_decisions, load_projects,
    save_decisions, save_projects, spawn_claude, sse,
)

# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="Explore Accelerator — SAP S/4HANA Cloud PE KDD Generator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

from routes.kdd import router as kdd_router
from routes.catalog import router as catalog_router
from a2a.router import router as a2a_router, AGENT_CARD
from bdcq_agent.routes import router as bdcq_router

app.include_router(kdd_router)
app.include_router(catalog_router)
app.include_router(a2a_router, prefix="/a2a")
app.include_router(bdcq_router)

# ── Well-known agent card ─────────────────────────────────────────────────────

@app.get("/.well-known/agent.json")
async def agent_card():
    return JSONResponse(AGENT_CARD)


# ── Health endpoint ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    cat = load_catalog()
    return {
        "ok":            True,
        "catalogLoaded": bool(cat.get("items")),
        "cacheLoaded":   bool(load_cache()),
    }


# ── Status endpoint ───────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    from kdd_generator.helpers import expected_release, is_catalog_outdated
    cat        = load_catalog()
    items      = cat.get("items", [])
    version    = str(cat.get("version", ""))
    outdated   = is_catalog_outdated(version)
    cache      = load_cache()
    cache_ready = bool(cache and cache.get("items"))
    return {
        "ok":              True,
        "catalogVersion":  version or "—",
        "totalProcesses":  len(items),
        "catalogOutdated": outdated,
        "expectedRelease": expected_release(),
        "cacheReady":      cache_ready,
        "catalogChanged":  False,
    }


@app.get("/api/decisions/clients")
async def decisions_clients():
    decisions = load_decisions()
    clients = {}
    for d in decisions:
        slug = re.sub(r"[^\w]", "-", (d.get("client") or "").lower()).strip("-") or "unknown"
        if slug not in clients:
            clients[slug] = {"slug": slug, "name": d.get("client") or "Unknown", "count": 0}
        clients[slug]["count"] += 1
    return {"ok": True, "clients": sorted(clients.values(), key=lambda c: -c["count"])}


@app.get("/api/decisions/summary")
async def decisions_summary(clientSlug: str = ""):
    decisions = load_decisions()
    if clientSlug:
        decisions = [d for d in decisions
                     if re.sub(r"[^\w]", "-", (d.get("client") or "").lower()).strip("-") == clientSlug]
    scope_items = len({d.get("scopeItemId") for d in decisions if d.get("scopeItemId")})
    projects    = len({d.get("project") for d in decisions if d.get("project")})
    by_fit_gap  = {
        "Fit":         sum(1 for d in decisions if d.get("fitGap") == "Fit"),
        "Partial Fit": sum(1 for d in decisions if d.get("fitGap") == "Partial Fit"),
        "Gap":         sum(1 for d in decisions if d.get("fitGap") == "Gap"),
    }
    return {"ok": True, "total": len(decisions), "scopeItems": scope_items,
            "projects": projects, "byFitGap": by_fit_gap, "scopeBreakdown": []}


# ── Decisions library CRUD ────────────────────────────────────────────────────

@app.get("/api/decisions")
async def get_decisions(scopeItemId: str = "", clientSlug: str = ""):
    decisions = load_decisions()
    if scopeItemId:
        decisions = [d for d in decisions if d.get("scopeItemId") == scopeItemId]
    if clientSlug:
        decisions = [d for d in decisions
                     if re.sub(r"[^\w]", "-", (d.get("client") or "").lower()).strip("-") == clientSlug]
    return {"ok": True, "count": len(decisions), "decisions": decisions}


@app.post("/api/decisions")
async def save_decision(request: Request):
    body      = await request.json()
    decisions = load_decisions()
    body["savedAt"] = datetime.utcnow().isoformat() + "Z"
    decisions.insert(0, body)
    save_decisions(decisions[:500])
    return {"ok": True, "count": len(decisions)}


@app.delete("/api/decisions/{decision_id}")
async def delete_decision(decision_id: str):
    save_decisions([d for d in load_decisions() if d.get("id") != decision_id])
    return {"ok": True}


# ── Projects store ────────────────────────────────────────────────────────────

@app.get("/api/projects")
async def get_projects():
    return {"ok": True, "projects": load_projects()}


@app.post("/api/projects")
async def save_project(request: Request):
    body     = await request.json()
    projects = load_projects()
    body["savedAt"] = datetime.utcnow().isoformat() + "Z"
    projects.insert(0, body)
    save_projects(projects[:100])
    return {"ok": True}


# ── Output file serving ───────────────────────────────────────────────────────

@app.get("/api/output")
async def list_output():
    files = sorted(
        (f for f in OUTPUT_DIR.iterdir() if f.suffix in (".xlsx", ".pptx")),
        key=lambda f: f.stat().st_mtime, reverse=True,
    )
    return {"ok": True, "files": [
        {"name": f.name, "size": f.stat().st_size,
         "modified": datetime.utcfromtimestamp(f.stat().st_mtime).isoformat() + "Z"}
        for f in files[:20]
    ]}


@app.get("/api/output/download/{filename}")
async def download_output(filename: str):
    safe = re.sub(r"[^\w.\-]", "_", filename)
    fp   = OUTPUT_DIR / safe
    if not fp.exists() or not fp.is_file():
        raise HTTPException(404, "File not found")
    media = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if safe.endswith(".xlsx") else
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        if safe.endswith(".pptx") else
        "application/octet-stream"
    )
    return FileResponse(str(fp), filename=safe, media_type=media)


@app.get("/api/output/{filename}")
async def get_output_file(filename: str):
    """Alias — same as /api/output/download/{filename}."""
    return await download_output(filename)


@app.delete("/api/output/{filename}")
async def delete_output_file(filename: str):
    safe = re.sub(r"[^\w.\-]", "_", filename)
    fp   = OUTPUT_DIR / safe
    if not fp.exists() or not fp.is_file():
        raise HTTPException(404, "File not found")
    fp.unlink()
    return {"ok": True}


# ── MCP config visibility ─────────────────────────────────────────────────────

_MCP_TOOLS = [
    {"name": "generate_kdd",    "icon": "◈", "hint": "scopeIds, client, project, mode",
     "desc": "Generate 15 KDD questions per scope item with RICEF classification. Runs the full 5-stage AI pipeline."},
    {"name": "search_catalog",  "icon": "⊞", "hint": "query, limit",
     "desc": "Search the SAP scope catalog by process name, LOB, or description."},
    {"name": "get_scope_item",  "icon": "🔍", "hint": "id",
     "desc": "Get full details for a specific SAP scope item by ID (e.g. 'BD6')."},
    {"name": "list_scope_items","icon": "☰", "hint": "lob, limit",
     "desc": "List all scope items, optionally filtered by Line of Business."},
    {"name": "bdcq_status",     "icon": "📋", "hint": "(no args)",
     "desc": "Check whether BDCQ questions are loaded and return domain/question counts."},
]

@app.get("/api/mcp/config")
async def mcp_config():
    settings_path = ROOT / ".claude" / "settings.json"
    mcp_script    = ROOT / "mcp_server.py"
    settings_found = settings_path.exists()
    mcp_found      = mcp_script.exists()

    registered_servers = []
    if settings_found:
        try:
            cfg = json.loads(settings_path.read_text("utf-8"))
            for name, srv in (cfg.get("mcpServers") or {}).items():
                registered_servers.append({
                    "name":    name,
                    "command": f"{srv.get('command', '')} {' '.join(srv.get('args', []))}".strip(),
                })
        except Exception:
            pass

    cat       = load_catalog()
    decisions = load_decisions()
    return {
        "ok":              True,
        "settingsFound":   settings_found,
        "mcpServerFound":  mcp_found,
        "tools":           _MCP_TOOLS,
        "registeredServers": registered_servers,
        "dataSnapshot": {
            "catalogItems":    len(cat.get("items", [])),
            "savedDecisions":  len(decisions),
        },
    }


# ── DDA (Detailed Design Accelerator) extract ─────────────────────────────────

@app.post("/api/dda/extract")
async def dda_extract(request: Request):
    body   = await request.json()
    source = body.get("source", "")
    if not source:
        raise HTTPException(400, "source required")

    async def extract_stream() -> AsyncGenerator[str, None]:
        prompt = f"""Extract all key design decision questions from this SAP content.
For each question, identify:
- designQuestion: the specific configuration or design question (max 150 chars, Cloud PE only)
- fitGap: Fit | Partial Fit | Gap (guess from context)
- complexity: Low | Medium | High
- l1: top-level area (Finance, Procurement, etc.)
- l2: sub-area

Source content:
{source[:3000]}

Return ONLY a JSON array. No markdown."""
        yield sse({"type": "progress", "message": "Extracting design questions…"})
        try:
            out = await spawn_claude(prompt, timeout=90)
            s, e = out.find("["), out.rfind("]")
            if s < 0 or e < 0:
                raise ValueError("No JSON array in response")
            extracted = json.loads(out[s:e+1])
            yield sse({"type": "complete", "rows": extracted})
        except Exception as exc:
            yield sse({"type": "error", "message": str(exc)})

    return StreamingResponse(extract_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Static frontend ────────────────────────────────────────────────────────────

_FRONTEND = ROOT / "public"
if _FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="static")
else:
    @app.get("/")
    async def root():
        return JSONResponse({"status": "Explore Accelerator API running", "version": "2.0.0-python",
                             "endpoints": ["/api/catalog", "/api/kdd/generate", "/api/bdcq/status",
                                           "/.well-known/agent.json", "/a2a"]})


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    log.info("Explore Accelerator starting on port %d", PORT)
    log.info("Claude CLI: %s", CLAUDE_EXE)
    if CATALOG_PATH.exists():
        cat = load_catalog()
        log.info("Catalog loaded: %d items", len(cat.get("items", [])))
    else:
        log.warning("scope-catalog.json not found — run Chrome extension to generate it")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False, log_level="info")
