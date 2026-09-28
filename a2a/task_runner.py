# a2a/task_runner.py — bridges A2A tasks to the KDD pipeline
# Detects skill from task message, routes to the right handler
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _get_user_text(task: dict) -> str:
    msg = (task.get("messages") or [{}])[0]
    for part in msg.get("parts", []):
        if part.get("type") == "text":
            return part.get("text", "")
    return ""


def _get_params(task: dict) -> dict:
    msg = (task.get("messages") or [{}])[0]
    for part in msg.get("parts", []):
        if part.get("type") == "data":
            return part.get("data", {})
    return {}


def _detect_skill(text: str, params: dict, metadata: dict = None) -> str:
    skill = params.get("skill") or (metadata or {}).get("skill", "")
    if skill:
        return skill
    low = text.lower()
    if any(k in low for k in ("kdd", "key design", "generate", "scope")):
        return "kdd-generate"
    if any(k in low for k in ("search", "find", "catalog", "list")):
        return "catalog-search"
    if any(k in low for k in ("bdcq", "status", "loaded", "questions")):
        return "bdcq-status"
    return "kdd-generate"


async def _run_kdd_generate(params: dict, text: str, on_progress) -> list:
    from agents_py import orchestrator
    from kdd_generator.excel_builder import build_excel

    # Parse scope IDs from params or text
    scope_ids = params.get("scopeIds") or []
    if not scope_ids:
        # extract from text: BD6, J59, BEI etc.
        scope_ids = [m.group().upper() for m in re.finditer(r"\b[A-Z]{1,4}\d{0,3}\b", text.upper())]

    client  = params.get("client", "")
    project = params.get("project", "")

    catalog_path = ROOT / "scope-catalog.json"
    if not catalog_path.exists():
        raise FileNotFoundError("scope-catalog.json not found")

    raw     = json.loads(catalog_path.read_text("utf-8"))
    catalog = raw if isinstance(raw, list) else raw.get("items", [])
    cat_map = {(i.get("id") or "").upper(): i for i in catalog}

    items = []
    for sid in scope_ids:
        key = sid.upper().strip()
        if key in cat_map:
            items.append(cat_map[key])

    if not items:
        raise ValueError(f"None of the scope IDs found in catalog: {scope_ids}")

    result = await orchestrator.run(
        items=items, cache_data=None, on_event=on_progress, concurrency=2, mode="ai"
    )
    rows = result["rows"]
    if not rows:
        raise ValueError("Pipeline produced no rows")

    meta = {
        "client": client, "project": project,
        "catalogVersion": "", "scopeCount": len(items),
        "overviews": result["overviews"],
    }
    out_path = build_excel(rows, meta)
    return [
        {
            "name":        f"KDD Excel — {out_path.name}",
            "description": f"{len(rows)} KDD rows for {', '.join(scope_ids)}",
            "index":       0,
            "lastChunk":   True,
            "parts":       [{"type": "data", "data": {
                "filename":   out_path.name,
                "path":       str(out_path),
                "totalKDDs":  len(rows),
                "sources":    result["src_counts"],
            }}],
        }
    ]


async def _run_catalog_search(params: dict, text: str) -> list:
    query = params.get("query") or text
    limit = int(params.get("limit") or 10)

    catalog_path = ROOT / "scope-catalog.json"
    if not catalog_path.exists():
        return [{"name": "Error", "parts": [{"type": "text", "text": "scope-catalog.json not found"}]}]

    raw     = json.loads(catalog_path.read_text("utf-8"))
    catalog = raw if isinstance(raw, list) else raw.get("items", [])
    ql      = query.lower()
    matches = [
        i for i in catalog
        if ql in (i.get("name") or "").lower()
        or ql in (i.get("lob") or "").lower()
        or ql in (i.get("description") or "").lower()
    ][:limit]
    return [
        {
            "name":      "Catalog Search Results",
            "index":     0,
            "lastChunk": True,
            "parts":     [{"type": "data", "data": {
                "query": query, "count": len(matches),
                "items": [{"id": m.get("id"), "name": m.get("name"), "lob": m.get("lob")} for m in matches],
            }}],
        }
    ]


async def _run_bdcq_status() -> list:
    bdcq_path = ROOT / "bdcq" / "bdcq-questions.json"
    if not bdcq_path.exists():
        return [{"name": "BDCQ Status", "parts": [{"type": "text", "text": "bdcq-questions.json not found"}]}]
    data    = json.loads(bdcq_path.read_text("utf-8"))
    domains = data.get("domains", [])
    total   = sum(sum(len(s.get("rows", [])) for s in d.get("sheets", [])) for d in domains)
    return [
        {
            "name":      "BDCQ Status",
            "index":     0,
            "lastChunk": True,
            "parts":     [{"type": "data", "data": {
                "loaded": True, "domainCount": len(domains),
                "totalQuestions": total,
                "domains": [d.get("domain") for d in domains],
            }}],
        }
    ]


async def execute(task: dict, on_progress) -> list:
    text     = _get_user_text(task)
    params   = _get_params(task)
    metadata = task.get("metadata") or {}
    skill    = _detect_skill(text, params, metadata)

    if skill == "kdd-generate":
        return await _run_kdd_generate(params, text, on_progress)
    if skill == "catalog-search":
        return await _run_catalog_search(params, text)
    return await _run_bdcq_status()
