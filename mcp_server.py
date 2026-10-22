#!/usr/bin/env python
# mcp_server.py — Explore Accelerator MCP stdio server
# 5 tools exposed to Claude Code via JSON-RPC 2.0 over stdin/stdout
import json
import re
import sys
import asyncio
from pathlib import Path


def _strip_html(text: str) -> str:
    """Strip HTML tags and collapse whitespace for clean text output."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"&[a-z]+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()

ROOT = Path(__file__).resolve().parent

# ── Tool registry ──────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name":        "generate_kdd",
        "description": "Generate Key Design Decisions for SAP S/4HANA Cloud PE scope items. Returns 15 KDD questions per item with RICEF classification.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "scopeIds": {"type": "array", "items": {"type": "string"}, "description": "SAP scope item IDs e.g. ['BD6','J59']"},
                "client":   {"type": "string", "description": "Client name for the output file"},
                "project":  {"type": "string", "description": "Project name for the output file"},
                "mode":     {"type": "string", "enum": ["ai"], "default": "ai"},
            },
            "required": ["scopeIds"],
        },
    },
    {
        "name":        "search_catalog",
        "description": "Search the SAP scope catalog by process name, LOB, or description. Returns matching scope items.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term (process name, LOB, keyword)"},
                "limit": {"type": "integer", "default": 10, "description": "Max results to return"},
            },
            "required": ["query"],
        },
    },
    {
        "name":        "get_scope_item",
        "description": "Get full details for a specific SAP scope item by ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "Scope item ID e.g. 'BD6'"},
            },
            "required": ["id"],
        },
    },
    {
        "name":        "list_scope_items",
        "description": "List all scope items in the catalog, optionally filtered by LOB.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "lob":   {"type": "string", "description": "Line of Business filter e.g. 'Finance'"},
                "limit": {"type": "integer", "default": 50},
            },
        },
    },
    {
        "name":        "bdcq_status",
        "description": "Check whether BDCQ questions have been loaded and return summary statistics.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]

# ── Tool implementations ───────────────────────────────────────────────────────

def _load_catalog() -> list:
    p = ROOT / "scope-catalog.json"
    if not p.exists():
        return []
    data = json.loads(p.read_text("utf-8"))
    if isinstance(data, list):
        return data
    return data.get("items") or data.get("processes", [])


def _load_bdcq():
    p = ROOT / "bdcq" / "bdcq-questions.json"
    if not p.exists():
        return None
    return json.loads(p.read_text("utf-8"))


async def _tool_search_catalog(args: dict) -> dict:
    query  = (args.get("query") or "").lower()
    limit  = int(args.get("limit") or 10)
    items  = _load_catalog()
    if not items:
        return {"error": "scope-catalog.json not found. Run the Chrome extension to generate it."}
    results = [
        i for i in items
        if query in (i.get("name") or "").lower()
        or query in (i.get("lob") or "").lower()
        or query in (i.get("description") or "").lower()
    ][:limit]
    return {"count": len(results), "items": [
        {"id": r.get("id"), "name": r.get("name"), "lob": r.get("lob")}
        for r in results
    ]}


async def _tool_get_scope_item(args: dict) -> dict:
    id_ = (args.get("id") or "").upper().strip()
    items = _load_catalog()
    item  = next((i for i in items if (i.get("id") or "").upper() == id_), None)
    if not item:
        return {"error": f"Scope item '{id_}' not found in catalog"}
    return {
        "id":          item.get("id"),
        "name":        item.get("name"),
        "lob":         item.get("lob"),
        "description": _strip_html(item.get("description", "")),
    }


async def _tool_list_scope_items(args: dict) -> dict:
    lob   = (args.get("lob") or "").strip().lower()
    limit = int(args.get("limit") or 50)
    items = _load_catalog()
    if not items:
        return {"error": "scope-catalog.json not found."}
    if lob:
        items = [i for i in items if (i.get("lob") or "").lower() == lob]
    items = items[:limit]
    return {"count": len(items), "items": [
        {"id": i.get("id"), "name": i.get("name"), "lob": i.get("lob")}
        for i in items
    ]}


async def _tool_bdcq_status(_args: dict) -> dict:
    data = _load_bdcq()
    if not data:
        return {"loaded": False, "message": "bdcq-questions.json not found. Use the Chrome extension to scan and save BDCQ files."}
    domains = data.get("domains", [])
    total   = sum(sum(len(s.get("rows", [])) for s in d.get("sheets", [])) for d in domains)
    return {
        "loaded":        True,
        "domainCount":   len(domains),
        "totalQuestions":total,
        "domains":       [d.get("domain") for d in domains],
    }


async def _tool_generate_kdd(args: dict) -> dict:
    scope_ids = args.get("scopeIds", [])
    client    = args.get("client", "")
    project   = args.get("project", "")
    mode      = "ai"  # cache mode removed

    if not scope_ids:
        return {"error": "scopeIds is required"}

    catalog = _load_catalog()
    if not catalog:
        return {"error": "scope-catalog.json not found"}

    catalog_map = {(i.get("id") or "").upper(): i for i in catalog}
    items = []
    not_found = []
    for sid in scope_ids:
        key = sid.upper().strip()
        if key in catalog_map:
            items.append(catalog_map[key])
        else:
            not_found.append(sid)

    if not_found:
        return {"error": f"Scope IDs not found in catalog: {', '.join(not_found)}"}

    # Import orchestrator and run pipeline
    from agents_py import orchestrator
    from kdd_generator.excel_builder import build_excel

    events = []
    def on_event(e):
        events.append(e)

    result = await orchestrator.run(
        items=items, cache_data=None, on_event=on_event, concurrency=2, mode=mode
    )
    rows = result["rows"]
    if not rows:
        return {"error": "No KDD rows generated", "events": events[-5:]}

    raw_cat = json.loads((ROOT / "scope-catalog.json").read_text("utf-8")) if (ROOT / "scope-catalog.json").exists() else {}
    if not isinstance(raw_cat, dict):
        raw_cat = {}
    meta = {
        "client": client, "project": project,
        "catalogVersion": str(raw_cat.get("version", "")),
        "catalogCountry": raw_cat.get("country", "Global") or "Global",
        "scopeCount": len(items),
        "overviews": result["overviews"],
    }
    out_path = build_excel(rows, meta)
    return {
        "ok":       True,
        "totalKDDs": len(rows),
        "filename": out_path.name,
        "path":     str(out_path),
        "sources":  result["src_counts"],
    }


async def dispatch_tool(name: str, args: dict) -> dict:
    if name == "generate_kdd":    return await _tool_generate_kdd(args)
    if name == "search_catalog":  return await _tool_search_catalog(args)
    if name == "get_scope_item":  return await _tool_get_scope_item(args)
    if name == "list_scope_items":return await _tool_list_scope_items(args)
    if name == "bdcq_status":     return await _tool_bdcq_status(args)
    return {"error": f"Unknown tool: {name}"}


# ── JSON-RPC 2.0 stdio loop ────────────────────────────────────────────────────

def _reply(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    if error:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


async def _read_line() -> str:
    """Read one line from stdin without blocking the event loop."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, sys.stdin.readline)


async def main_loop():
    while True:
        line = await _read_line()
        if not line:  # EOF
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        id_    = req.get("id")
        method = req.get("method", "")
        params = req.get("params", {})

        if method == "initialize":
            _reply(id_, {
                "protocolVersion": "2024-11-05",
                "capabilities":    {"tools": {}},
                "serverInfo":      {"name": "explore-accelerator-mcp", "version": "1.0.0"},
            })
        elif method == "tools/list":
            _reply(id_, {"tools": TOOLS})
        elif method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments", {})
            try:
                result = await dispatch_tool(tool_name, tool_args)
                _reply(id_, {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]})
            except Exception as exc:
                _reply(id_, error={"code": -32000, "message": str(exc)})
        elif method == "notifications/initialized":
            pass  # no reply for notifications
        else:
            _reply(id_, error={"code": -32601, "message": f"Method not found: {method}"})


if __name__ == "__main__":
    asyncio.run(main_loop())
