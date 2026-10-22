# routes/catalog.py — /api/catalog endpoints
import asyncio
import json
import shutil
from collections import Counter
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from .deps import CATALOG_PATH, load_catalog, load_cache, sse
from kdd_generator.helpers import expected_release, is_catalog_outdated
from bdcq_agent.routes import reset_catalog_cache as _reset_bdcq_catalog_cache

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


@router.get("/item/{item_id}")
async def get_catalog_item(item_id: str):
    cat   = load_catalog()
    items = cat.get("items", [])
    item  = next((i for i in items if (i.get("id") or "").upper() == item_id.upper()), None)
    if not item:
        # Return 200 with error key so the frontend's `if (item.error)` check works.
        # api.get() throws on non-2xx, so a 404 would break the caller's loop.
        return {"error": f"'{item_id.upper()}' not found in catalog"}
    return item


@router.get("/lobs")
async def get_lobs(country: str = "", region: str = ""):
    cat   = load_catalog()
    items = cat.get("items", [])
    if country:
        items = [i for i in items
                 if any(country in arr for arr in (i.get("countries") or {}).values())]
    elif region:
        items = [i for i in items if region in (i.get("countries") or {})]
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


@router.get("/country-map")
async def country_map():
    """Region → sorted country list, built from per-item countries fields."""
    cat   = load_catalog()
    items = cat.get("items", [])
    region_set: dict = {}
    for item in items:
        for region, country_list in (item.get("countries") or {}).items():
            if region not in region_set:
                region_set[region] = set()
            region_set[region].update(country_list)
    order  = ["Americas", "Europe", "Middle East and Africa", "Asia Pacific"]
    result = {r: sorted(region_set[r]) for r in order if r in region_set}
    for r in region_set:
        if r not in result:
            result[r] = sorted(region_set[r])
    return result


@router.get("/country-stats")
async def country_stats(country: str = "", region: str = ""):
    """Count of scope items available for a given country or region."""
    cat   = load_catalog()
    items = cat.get("items", [])
    total = len(items)
    if not country and not region:
        return {"total": total, "available": total}
    count = 0
    for item in items:
        c = item.get("countries") or {}
        if country:
            if any(country in arr for arr in c.values()):
                count += 1
        elif region:
            if region in c:
                count += 1
    return {"total": total, "available": count, "country": country, "region": region}


_CATALOG_MAX_BYTES = 50 * 1024 * 1024  # 50 MB — catalog is typically 1–5 MB

@router.post("/save")
async def save_catalog(request: Request):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _CATALOG_MAX_BYTES:
        raise HTTPException(413, "Catalog payload too large (max 50 MB)")
    body = await request.body()
    if len(body) > _CATALOG_MAX_BYTES:
        raise HTTPException(413, "Catalog payload too large (max 50 MB)")
    parsed = json.loads(body)
    CATALOG_PATH.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), "utf-8")
    _reset_bdcq_catalog_cache()
    items = parsed if isinstance(parsed, list) else parsed.get("items", [])
    return {"ok": True, "count": len(items)}


@router.post("/reload")
async def reload_catalog():
    async def generate():
        try:
            yield sse({"type": "progress", "message": "Reading scope-catalog.json from disk…"})
            await asyncio.sleep(0)

            if not CATALOG_PATH.exists():
                yield sse({"type": "error", "message": "scope-catalog.json not found. Run the Chrome extension first."})
                return

            yield sse({"type": "progress", "message": "Parsing catalog…"})
            await asyncio.sleep(0)

            cat     = load_catalog()
            items   = cat.get("items", [])
            version = str(cat.get("version", "unknown"))

            yield sse({"type": "progress", "message": f"Loaded {len(items):,} processes · version {version}"})
            await asyncio.sleep(0)

            total_kdds = 0
            cache = load_cache()
            if cache and isinstance(cache, dict):
                for scope_data in cache.values():
                    if isinstance(scope_data, dict):
                        qs = scope_data.get("questions", scope_data.get("rows", []))
                        if isinstance(qs, list):
                            total_kdds += len(qs)

            yield sse({"type": "progress", "message": f"Cache check complete · {total_kdds:,} KDDs cached"})
            await asyncio.sleep(0)

            yield sse({
                "type":      "complete",
                "version":   version,
                "processes": len(items),
                "totalKDDs": total_kdds,
            })
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/clear")
async def clear_catalog():
    try:
        if not CATALOG_PATH.exists():
            return {"ok": False, "error": "scope-catalog.json not found"}

        ts          = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        backup_name = f"scope-catalog.backup-{ts}.json"
        backup_path = CATALOG_PATH.parent / backup_name
        shutil.copy2(str(CATALOG_PATH), str(backup_path))
        CATALOG_PATH.unlink()
        _reset_bdcq_catalog_cache()

        return {"ok": True, "backup": backup_name}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/upload")
async def upload_catalog(request: Request):
    try:
        body = await request.json()

        if not isinstance(body, dict) or "processes" not in body:
            return {"ok": False, "error": "Not a valid scope-catalog.json — missing processes array"}

        if CATALOG_PATH.exists():
            ts          = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            backup_path = CATALOG_PATH.parent / f"scope-catalog.backup-{ts}.json"
            shutil.copy2(str(CATALOG_PATH), str(backup_path))

        CATALOG_PATH.write_text(json.dumps(body, indent=2, ensure_ascii=False), "utf-8")
        _reset_bdcq_catalog_cache()

        processes = body.get("processes", [])
        version   = str(body.get("version", ""))

        return {"ok": True, "processes": len(processes), "version": version}
    except Exception as e:
        return {"ok": False, "error": str(e)}
