# bpd_agent/routes.py — BPD Agent API routes
# Catalog-grounded approach: L1/L2/L3/L4 come from scope-catalog-f2s.json (real SAP data).
# AI is used only for swimlane layout, L5 enrichment, FTS, and narrative — not structure.
from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routes.deps import spawn_claude as _spawn_claude
from agents_py.shared import CLAUDE_TIMEOUT_S

router = APIRouter(prefix="/api/bpd")
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent

# ── LOB / file mappings ────────────────────────────────────────────────────────

# Maps BPD module selector → l1 values in scope-catalog-f2s.json
MODULE_L1_MAP: dict[str, list[str]] = {
    "Sales & Distribution":  ["Sales & Distribution"],
    "Finance & Controlling": ["Finance & Controlling"],
    "Sourcing & Procurement":["Sourcing & Procurement"],
    "Manufacturing":         ["Manufacturing"],
    "Asset Management":      ["Asset Management"],
    "Supply Chain":          ["Supply Chain"],
    "Human Resources":       ["Human Resources"],
    "Professional Services": ["Professional Services"],
    "Customer Service":      ["Customer Service"],
    "R&D & Engineering":     ["R&D & Engineering"],
    "Cross-Functional":      ["Cross-Functional"],
}

# Maps l1 values → f2s markdown file (richer content: L5 steps, benefits)
LOB_F2S_FILES: dict[str, str] = {
    "Sales & Distribution":  "f2s-sales-and-distribution.md",
    "Sales":                 "f2s-sales-and-distribution.md",
    "Finance & Controlling": "f2s-finance-and-controlling.md",
    "Finance":               "f2s-finance-and-controlling.md",
    "Sourcing & Procurement":"f2s-sourcing-and-procurement.md",
    "Procurement":           "f2s-sourcing-and-procurement.md",
    "Manufacturing":         "f2s-manufacturing.md",
    "Asset Management":      "f2s-asset-management.md",
    "Supply Chain":          "f2s-supply-chain.md",
    "Human Resources":       "f2s-human-resources.md",
    "Professional Services": "f2s-professional-services.md",
    "Customer Service":      "f2s-customer-service.md",
    "Cross-Functional":      "f2s-cross-functional.md",
    "R&D & Engineering":     "f2s-randd-and-engineering.md",
}

# Maps l1 values → KDD knowledge base file (design questions, Fiori IDs)
LOB_KDD_FILES: dict[str, str] = {
    "Sales & Distribution":  "kdd-lob-sales.md",
    "Sales":                 "kdd-lob-sales.md",
    "Finance & Controlling": "kdd-lob-finance.md",
    "Finance":               "kdd-lob-finance.md",
    "Sourcing & Procurement":"kdd-lob-sourcing-and-procurement.md",
    "Procurement":           "kdd-lob-sourcing-and-procurement.md",
    "Manufacturing":         "kdd-lob-manufacturing.md",
    "Asset Management":      "kdd-lob-asset-management.md",
    "Supply Chain":          "kdd-lob-supply-chain.md",
    "Human Resources":       "kdd-lob-human-resources.md",
    "Professional Services": "kdd-lob-professional-services.md",
    "Customer Service":      "kdd-lob-service.md",
    "Cross-Functional":      "kdd-lob-database-and-data-management.md",
    "R&D & Engineering":     "kdd-lob-randd-and-engineering.md",
}

# ── Pydantic models ────────────────────────────────────────────────────────────

class ProxyRequest(BaseModel):
    prompt:     str
    max_tokens: int = 4096

class MatchRequest(BaseModel):
    module:      str = "SD - Sales"
    description: str = ""
    keywords:    list[str] = []

class ContextRequest(BaseModel):
    process_ids: list[str]
    module:      str = "SD - Sales"

# ── Helpers ────────────────────────────────────────────────────────────────────

STOP_WORDS = {
    "that", "with", "this", "from", "have", "will", "your", "their",
    "which", "when", "where", "process", "system", "data", "cloud",
    "public", "edition", "using", "into", "also", "need", "want",
    "implement", "implementation", "customer", "based", "used",
}


def _extract_relevant_sections(content: str, process_ids: list[str], max_chars: int = 4000) -> str:
    """Extract markdown sections that reference any of the given process IDs."""
    sections = re.split(r'\n(?=###? )', content)
    relevant = []
    for section in sections:
        for pid in process_ids:
            if pid in section:
                relevant.append(section.strip())
                break
    if not relevant:
        return content[:max_chars]
    combined = "\n\n".join(relevant)
    return combined[:max_chars]


async def _call_claude(prompt: str, max_tokens: int = 4096) -> dict:
    try:
        text = await _spawn_claude(prompt, timeout=CLAUDE_TIMEOUT_S)
        return {"content": [{"type": "text", "text": text}]}
    except TimeoutError:
        log.error("BPD proxy: Claude timed out after %ds", CLAUDE_TIMEOUT_S)
        return {"error": "Generation timed out — Claude took too long to respond"}
    except Exception as exc:
        msg = str(exc)[:300]
        log.error("BPD proxy error: %s", exc)
        return {"error": f"Generation failed: {msg}"}


_catalog_cache: tuple[list[dict], dict[str, dict]] | None = None
_catalog_mtime: float = 0.0


def _load_catalog() -> tuple[list[dict], dict[str, dict]]:
    """Load scope-catalog-f2s.json; mtime-invalidated cache avoids stale data after re-upload."""
    global _catalog_cache, _catalog_mtime
    path = ROOT / "scope-catalog-f2s.json"
    try:
        mtime = path.stat().st_mtime if path.exists() else 0.0
    except OSError:
        mtime = 0.0
    if _catalog_cache is not None and mtime == _catalog_mtime:
        return _catalog_cache
    if not path.exists():
        return [], {}
    try:
        data  = json.loads(path.read_text("utf-8"))
        procs = data.get("processes", [])
        _catalog_cache = (procs, {p["id"]: p for p in procs})
        _catalog_mtime = mtime
        return _catalog_cache
    except Exception:
        return [], {}

# ── Existing proxy endpoints ───────────────────────────────────────────────────

@router.post("/proxy")
async def bpd_proxy(req: ProxyRequest):
    """Proxy a Claude CLI call for BPD enrichment/swimlane phases."""
    if not req.prompt or not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    result = await _call_claude(req.prompt, req.max_tokens)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result


@router.post("/autofill")
async def bpd_autofill(req: ProxyRequest):
    """Fast metadata extraction via Claude CLI."""
    if not req.prompt or not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    result = await _call_claude(req.prompt, req.max_tokens)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result

# ── New catalog-grounded endpoints ────────────────────────────────────────────

@router.post("/match")
async def bpd_match(req: MatchRequest):
    """
    Search scope-catalog-f2s.json for processes matching the given module + description.
    Returns up to 10 lightweight matches for the scope picker UI.
    """
    procs, _ = await asyncio.to_thread(_load_catalog)
    if not procs:
        raise HTTPException(404, "scope-catalog-f2s.json not found or empty")

    # Build target l1 values from module
    l1_targets = {v.lower() for v in MODULE_L1_MAP.get(req.module, [])}

    # Build search word set — desc uses 3+ chars to catch IDs like BD9, J11
    desc_words = set(re.findall(r'\b\w{3,}\b', req.description.lower()))
    kw_words   = {w.strip().lower() for w in req.keywords if w.strip()}
    search_words = (desc_words | kw_words) - STOP_WORDS

    # Explicit keyword search (user typed in search box) vs auto-match from description
    has_explicit_kw = bool(kw_words)

    scored: list[tuple[float, dict]] = []
    for p in procs:
        p_id      = (p.get("id") or "").upper()
        p_l1      = (p.get("l1") or "").lower()
        p_l2      = (p.get("l2") or "").lower()
        p_name    = (p.get("name") or "").lower()
        p_overview = (p.get("overview") or "").lower()

        kw_score = 0.0   # score from ID / keyword hits
        l1_score = 0.0   # score from module match

        # Exact / prefix ID match — highest priority (works across all LoB)
        for w in kw_words | desc_words:
            wu = w.upper()
            if wu == p_id or p_id.startswith(wu):
                kw_score += 50.0
                break

        # Keyword hits in name
        for w in search_words:
            if w in p_name:
                kw_score += 4.0

        # Keyword hits in overview
        for w in search_words:
            if w in p_overview:
                kw_score += 1.0

        # L1 / L2 module match — only boosts in auto-match mode (description-based)
        # When user types in the search box, L1 alone should NOT qualify a result
        if not has_explicit_kw:
            for t in l1_targets:
                if t in p_l1 or t in p_l2:
                    l1_score += 12.0
                    break

        score = kw_score + l1_score

        # For explicit keyword searches: must have a keyword/ID hit, not just L1
        if has_explicit_kw and kw_score == 0:
            continue

        if score > 2.0:
            scored.append((score, p))

    scored.sort(key=lambda x: -x[0])
    top = [p for _, p in scored[:15]]

    return {
        "matches": [
            {
                "id":   p["id"],
                "name": p["name"],
                "l1":   p["l1"],
                "l2":   p["l2"],
                "hint": (p.get("overview") or "")[:160],
            }
            for p in top
        ],
        "total": len(scored),
    }


@router.post("/catalog-context")
async def bpd_catalog_context(req: ContextRequest):
    """
    For selected scope item IDs, return:
    - Full L1/L2/L3/L4 structured data from scope-catalog-f2s.json
    - F2S context (L5 config steps, benefits) from f2s/*.md
    - KDD context (design questions, Fiori IDs) from kdd/*.md
    This data drives the grounded BPD generation — no AI needed for L1-L4 structure.
    """
    _, proc_map = await asyncio.to_thread(_load_catalog)

    processes = [proc_map[pid] for pid in req.process_ids if pid in proc_map]
    if not processes:
        raise HTTPException(404, "None of the requested process IDs found in scope catalog")

    # Unique l1 values to find the right support files
    l1_values = list({p["l1"] for p in processes})
    l2_values = list({p["l2"] for p in processes})

    # Load F2S context (sections relevant to matched IDs)
    f2s_context = ""
    for l1 in l1_values:
        fname = LOB_F2S_FILES.get(l1)
        if fname:
            fpath = ROOT / "f2s" / fname
            if fpath.exists():
                f2s_context = _extract_relevant_sections(
                    fpath.read_text("utf-8"), req.process_ids, max_chars=4000
                )
                break

    # Load KDD context (sections relevant to matched IDs)
    kdd_context = ""
    for l1 in l1_values:
        fname = LOB_KDD_FILES.get(l1)
        if fname:
            kpath = ROOT / "kdd" / fname
            if kpath.exists():
                kdd_context = _extract_relevant_sections(
                    kpath.read_text("utf-8"), req.process_ids, max_chars=3000
                )
                break

    return {
        "processes": [
            {
                "id":               p["id"],
                "name":             p["name"],
                "l1":               p["l1"],
                "l2":               p["l2"],
                "l3":               p.get("l3") or p["name"],
                "l4":               p.get("l4") or [],
                "overview":         p.get("overview") or "",
                "businessBenefits": p.get("businessBenefits") or [],
                "keyFeatures":      p.get("keyFeatures") or [],
            }
            for p in processes
        ],
        "f2sContext": f2s_context,
        "kddContext":  kdd_context,
        "l1Values":    l1_values,
        "l2Values":    l2_values,
    }
