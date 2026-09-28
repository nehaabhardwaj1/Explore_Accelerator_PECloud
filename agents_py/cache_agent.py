# agents_py/cache_agent.py — Stage 1: check kdd-cache.json for pre-built rows
import logging

log = logging.getLogger(__name__)


async def run(state: dict) -> dict:
    item      = state["item"]
    cache_data = state.get("cache_data")
    id_       = item["id"]

    if cache_data and "items" in cache_data and id_ in cache_data["items"]:
        cached = cache_data["items"][id_]
        all_rows   = cached.get("rows", [])
        clean_rows = [r for r in all_rows if not r.get("needsRegeneration")]
        dirty_count = len(all_rows) - len(clean_rows)

        if dirty_count:
            log.info("cache HIT %s — %d clean rows (%d flagged for regeneration)", id_, len(clean_rows), dirty_count)
        else:
            log.info("cache HIT %s — %d rows", id_, len(clean_rows))

        if clean_rows:
            return {
                **state,
                "cache_hit":    True,
                "source":       "cache",
                "rows":         clean_rows,
                "dirty_skipped": dirty_count,
                "overview":     cached.get("overview"),
                "input_tokens":  0,
                "output_tokens": 0,
            }

    log.info("cache MISS %s — proceeding to generation", id_)
    return {**state, "cache_hit": False}
