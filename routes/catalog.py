# routes/catalog.py — /api/catalog endpoints
import json
from collections import Counter

from fastapi import APIRouter, HTTPException, Request

from .deps import CATALOG_PATH, load_catalog
from kdd_generator.helpers import expected_release, is_catalog_outdated

router = APIRouter(prefix="/api/catalog")


@router.get("")
async def get_catalog():
    cat = load_catalog()
    if not cat.get("items"):
        raise HTTPException(404, "scope-catalog.json not found. Run the Chrome extension to generate it.")
    outdated = is_catalog_outdated(str(cat.get("version", "")))
    return {
        "ok":       True,
        "version":  cat.get("version", ""),
        "count":    len(cat["items"]),
        "outdated": outdated,
        "expected": expected_release(),
        "items":    cat["items"],
    }


@router.get("/search")
async def search_catalog(q: str = "", lob: str = "", limit: int = 20):
    cat   = load_catalog()
    items = cat.get("items", [])
    ql    = q.lower()
    if ql:
        items = [i for i in items if ql in (i.get("name") or "").lower()
                 or ql in (i.get("lob") or "").lower()
                 or ql in (i.get("description") or "").lower()]
    if lob:
        items = [i for i in items if (i.get("lob") or "").lower() == lob.lower()]
    return {"ok": True, "count": len(items[:limit]), "items": items[:limit]}


@router.get("/lobs")
async def get_lobs():
    cat   = load_catalog()
    items = cat.get("items", [])
    counts = Counter(i.get("lob") or "Unknown" for i in items)
    return sorted(
        [{"name": name, "count": cnt} for name, cnt in counts.items()],
        key=lambda x: -x["count"],
    )


@router.get("/lob/{lob}")
async def get_items_by_lob(lob: str):
    cat   = load_catalog()
    items = cat.get("items", [])
    matched = [i for i in items if (i.get("lob") or "").lower() == lob.lower()]
    return matched


@router.get("/info")
async def catalog_info():
    exists  = CATALOG_PATH.exists()
    cat     = load_catalog() if exists else {}
    items   = cat.get("items", [])
    lobs    = {i.get("lob") for i in items if i.get("lob")}
    version = str(cat.get("version", ""))
    file_size = CATALOG_PATH.stat().st_size if exists else 0
    return {
        "ok":          True,
        "exists":      exists,
        "version":     version,
        "processes":   len(items),
        "lobs":        len(lobs),
        "extractedAt": cat.get("extractedAt"),
        "country":     cat.get("country"),
        "fileSize":    file_size,
    }


@router.post("/save")
async def save_catalog(request: Request):
    body = await request.json()
    CATALOG_PATH.write_text(json.dumps(body, indent=2, ensure_ascii=False), "utf-8")
    items = body if isinstance(body, list) else body.get("items", [])
    return {"ok": True, "count": len(items)}
