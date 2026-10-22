# f2s_agent/routes.py — FastAPI router for /api/f2s/* endpoints
import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from kdd_generator.helpers import current_sap_release

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/f2s", tags=["f2s"])

ROOT = Path(__file__).resolve().parent.parent


# ── helpers ───────────────────────────────────────────────────────────────────

_catalog_cache: dict = {}
_catalog_mtime: float = 0.0


def _load_catalog() -> dict:
    global _catalog_cache, _catalog_mtime
    path = ROOT / "scope-catalog.json"
    try:
        mtime = path.stat().st_mtime if path.exists() else 0.0
    except OSError:
        mtime = 0.0
    if mtime and mtime == _catalog_mtime and _catalog_cache:
        return _catalog_cache
    if not path.exists():
        return {}
    try:
        raw   = json.loads(path.read_text("utf-8"))
        items = raw if isinstance(raw, list) else raw.get("items") or raw.get("processes") or []
        _catalog_cache = {i.get("id", ""): i for i in items}
        _catalog_mtime = mtime
        return _catalog_cache
    except Exception:
        return {}


_f2s_index_cache: dict = {}
_f2s_index_mtime: float = 0.0


def _load_f2s_index() -> dict:
    global _f2s_index_cache, _f2s_index_mtime
    path = ROOT / "f2s" / "f2s-index.json"
    try:
        mtime = path.stat().st_mtime if path.exists() else 0.0
    except OSError:
        mtime = 0.0
    if mtime and mtime == _f2s_index_mtime and _f2s_index_cache:
        return _f2s_index_cache
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
        _f2s_index_cache = {p["id"]: p for p in data.get("processes", []) if "id" in p}
        _f2s_index_mtime = mtime
        return _f2s_index_cache
    except Exception:
        return {}


_bdcq_indexes_cache: tuple | None = None
_bdcq_indexes_mtime: float = 0.0


def _load_bdcq_indexes() -> tuple:
    """Returns (scope_idx, lob_idx, domain_idx) matching the deck builder's three-pattern logic."""
    global _bdcq_indexes_cache, _bdcq_indexes_mtime
    import re as _re
    path = ROOT / "bdcq" / "bdcq-questions.json"
    try:
        mtime = path.stat().st_mtime if path.exists() else 0.0
    except OSError:
        mtime = 0.0
    if mtime and mtime == _bdcq_indexes_mtime and _bdcq_indexes_cache is not None:
        return _bdcq_indexes_cache
    if not path.exists():
        return {}, {}, {}
    try:
        data = json.loads(path.read_text("utf-8"))
    except Exception:
        return {}, {}, {}

    scope_idx:  dict = {}
    lob_idx:    dict = {}
    domain_idx: dict = {}  # all rows per domain (Pattern C fallback)

    for domain in data.get("domains", []):
        domain_name = domain.get("domain", "")
        for sheet in domain.get("sheets", []):
            for row in sheet.get("rows", []):
                q = (row.get("Question") or "").strip()
                if not q:
                    continue
                scope_ref = (row.get("Scope Ref.") or row.get("Scope Ref") or "").strip()
                lv = str(row.get("Level") or "L2").upper()
                # Pattern C — count every question at domain level
                domain_idx.setdefault(domain_name, {"l1": 0, "l2": 0, "l3": 0, "total": 0})
                if lv == "L1":   domain_idx[domain_name]["l1"] += 1
                elif lv == "L2": domain_idx[domain_name]["l2"] += 1
                else:            domain_idx[domain_name]["l3"] += 1
                domain_idx[domain_name]["total"] += 1

                if scope_ref:
                    for sid in _re.split(r"[,\s]+", scope_ref):
                        sid = sid.strip()
                        if sid:
                            scope_idx.setdefault(sid, {"l1": 0, "l2": 0, "l3": 0})
                            if lv == "L1":   scope_idx[sid]["l1"] += 1
                            elif lv == "L2": scope_idx[sid]["l2"] += 1
                            else:            scope_idx[sid]["l3"] += 1
                else:
                    lob_idx.setdefault(domain_name, {"l1": 0, "l2": 0, "l3": 0, "total": 0})
                    if lv == "L1":   lob_idx[domain_name]["l1"] += 1
                    elif lv == "L2": lob_idx[domain_name]["l2"] += 1
                    else:            lob_idx[domain_name]["l3"] += 1
                    lob_idx[domain_name]["total"] += 1
    _bdcq_indexes_cache = (scope_idx, lob_idx, domain_idx)
    _bdcq_indexes_mtime = mtime
    return _bdcq_indexes_cache


from kdd_generator.f2s_shared import F2S_TO_BDCQ_DOMAIN as _F2S_TO_BDCQ_DOMAIN

_kdd_cache_cache: dict = {}
_kdd_cache_mtime: float = 0.0


def _load_kdd_cache() -> dict:
    global _kdd_cache_cache, _kdd_cache_mtime
    path = ROOT / "kdd-cache.json"
    try:
        mtime = path.stat().st_mtime if path.exists() else 0.0
    except OSError:
        mtime = 0.0
    if mtime and mtime == _kdd_cache_mtime and _kdd_cache_cache:
        return _kdd_cache_cache
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
        _kdd_cache_cache = {sid: len(v.get("rows", [])) for sid, v in data.get("items", {}).items()}
        _kdd_cache_mtime = mtime
        return _kdd_cache_cache
    except Exception:
        return {}


# ── /api/f2s/current-release ─────────────────────────────────────────────────

@router.get("/current-release")
async def get_current_release():
    """Return the current SAP release code and label, computed from today's date."""
    code, label = current_sap_release()
    return JSONResponse({"code": code, "label": label})


# ── /api/f2s/preview ─────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_scopes(request: Request):
    """
    Return a per-scope data summary so the UI can show a preview table
    before the user generates the deck.

    Body: { "scopeIds": ["BD6", "J59", ...] }
    Response:
      {
        "ok": true,
        "hasCatalog": true,
        "hasBDCQ": true,
        "hasKDDCache": true,
        "scopes": [
          { "id": "BD6", "name": "...", "lob": "Finance",
            "inCatalog": true,
            "bdcq": { "l1": 2, "l2": 5, "l3": 0, "total": 7 },
            "kddCached": 15 }
        ]
      }
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    scope_ids = body.get("scopeIds") or []

    catalog              = _load_catalog()
    f2s_idx              = _load_f2s_index()
    scope_bdcq, lob_bdcq, domain_bdcq = _load_bdcq_indexes()
    kdd_counts           = _load_kdd_cache()

    scopes = []
    for raw_id in scope_ids:
        sid  = raw_id.strip().upper()
        item = catalog.get(sid) or catalog.get(raw_id.strip())
        if not item:
            f2s_entry = f2s_idx.get(sid)
            if f2s_entry:
                item = {
                    "id":   sid,
                    "name": f2s_entry.get("name", sid),
                    "lob":  f2s_entry.get("l1", ""),
                }

        if item:
            # Pattern A: scope ID match
            bdcq = scope_bdcq.get(sid)
            bdcq_source = "scope-id"
            if not bdcq:
                # Pattern B: LOB domain match (no-Scope-Ref rows only)
                lob      = item.get("lob", "")
                domain   = _F2S_TO_BDCQ_DOMAIN.get(lob)
                bdcq     = lob_bdcq.get(domain) if domain else None
                bdcq_source = "lob-domain" if bdcq else "none"
            if not bdcq:
                # Pattern C: full domain fallback (all rows including Scope-Ref ones)
                lob    = item.get("lob", "")
                domain = _F2S_TO_BDCQ_DOMAIN.get(lob)
                bdcq   = domain_bdcq.get(domain) if domain else None
                bdcq_source = "domain-fallback" if bdcq else "none"
            if not bdcq:
                bdcq = {"l1": 0, "l2": 0, "l3": 0}
            total_bdcq = bdcq.get("l1", 0) + bdcq.get("l2", 0) + bdcq.get("l3", 0)
            in_catalog = sid in catalog or raw_id.strip() in catalog
            scopes.append({
                "id":         item.get("id", sid),
                "name":       item.get("name", ""),
                "lob":        item.get("lob", ""),
                "inCatalog":  in_catalog,
                "inF2S":      sid in f2s_idx,
                "bdcq":       {**bdcq, "total": total_bdcq},
                "bdcqSource": bdcq_source,
                "kddCached":  kdd_counts.get(sid, 0),
            })
        else:
            scopes.append({
                "id": raw_id.strip(), "name": "Not found", "lob": "",
                "inCatalog": False, "inF2S": False,
                "bdcq": {"l1": 0, "l2": 0, "l3": 0, "total": 0},
                "bdcqSource": "none",
                "kddCached": 0,
            })

    return JSONResponse({
        "ok":          True,
        "hasCatalog":  bool(catalog),
        "hasF2S":      bool(f2s_idx),
        "hasBDCQ":     bool(scope_bdcq) or bool(lob_bdcq) or bool(domain_bdcq),
        "hasKDDCache": bool(kdd_counts),
        "scopes":      scopes,
    })


# ── /api/f2s/generate-deck ───────────────────────────────────────────────────

@router.post("/generate-deck")
async def generate_deck(request: Request):
    """
    Generate an enriched F2S workshop PPTX deck.

    Body (JSON):
      workshopTitle        str   — cover slide title
      clientName           str
      facilitator          str
      workshopDate         str   — e.g. "15 October 2026"
      brandColor           str   — hex, default #A100FF (Accenture purple)
      customerProcessOwner str
      release              str   — SAP release, defaults to current SAP release (computed from today's date)
      scopeIds             list  — e.g. ["BD6", "J59"]
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    scope_ids = body.get("scopeIds") or []
    if not scope_ids or not isinstance(scope_ids, list):
        raise HTTPException(400, "scopeIds must be a non-empty list")

    def _smart_title(s: str) -> str:
        """Title-case if entirely lower OR entirely upper (e.g. 'JANE DOE' → 'Jane Doe').
        Mixed-case strings (e.g. 'McGregor') are left as-is."""
        s = (s or "").strip()
        if not s:
            return s
        return s.title() if (s == s.lower() or s == s.upper()) else s

    # Accept countries as an array (new) or single country string (backwards compat)
    _raw_countries = body.get("countries") or []
    if not _raw_countries and body.get("country"):
        _raw_countries = [body.get("country")]

    meta = {
        "workshopTitle":        body.get("workshopTitle") or "Fit-to-Standard Workshop",
        "clientName":           _smart_title(body.get("clientName") or "[Client Name]"),
        "facilitator":          _smart_title(body.get("facilitator") or ""),
        "workshopDate":         body.get("workshopDate") or "",
        "brandColor":           body.get("brandColor")   or "#A100FF",
        "customerProcessOwner": _smart_title(body.get("customerProcessOwner") or ""),
        "countries":            [c.strip() for c in _raw_countries if c and c.strip()],
        "release":              body.get("release") or current_sap_release()[0],
    }

    try:
        from kdd_generator.f2s_deck_builder import build_async
        out_path, slide_count, omissions, elapsed, tokens = await build_async(meta, scope_ids)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("F2S deck build failed")
        raise HTTPException(500, f"Deck generation failed: {e}")

    total_tokens = tokens.get("prompt", 0) + tokens.get("completion", 0)
    return JSONResponse({
        "ok":              True,
        "filename":        out_path.name,
        "downloadUrl":     f"/api/output/download/{out_path.name}",
        "slideCount":      slide_count,
        "omissions":       omissions,
        "elapsedSeconds":  elapsed,
        "tokensEstimated": total_tokens,
        "tokensPrompt":    tokens.get("prompt", 0),
        "tokensCompletion": tokens.get("completion", 0),
    })


