# agents_py/orchestrator.py — KDD pipeline coordinator
# 5-stage pipeline: Cache → Library → Context → Generation → Validation
# Runs items in parallel batches (default concurrency=3)
import asyncio
import logging
from datetime import datetime

from . import cache_agent, library_agent, context_agent, generation_agent, validation_agent
from .shared import LOB_MODULE

log = logging.getLogger(__name__)

_STOP_SECTIONS = {"Solution Capabilities", "Industry Relevance", "Diagrams", "Accelerators"}


def _build_overview(item: dict, version: str) -> dict:
    from .context_agent import _strip_html
    import re as _re
    raw = item.get("description") or ""
    if _re.search(r"<[a-zA-Z/!]", raw):
        raw = _strip_html(raw)
    lines = [l.strip() for l in raw.split("\n") if l.strip()]
    sec   = {"overview": [], "flow": [], "benefits": []}
    cur   = None
    for line in lines:
        if line == "Overview":           cur = "overview";  continue
        if line == "Key Process Flow":   cur = "flow";      continue
        if line == "Business Benefits":  cur = "benefits";  continue
        if line in _STOP_SECTIONS:       cur = None;        continue
        if cur and len(line) > 3:        sec[cur].append(line)
    overview_text = " ".join(sec["overview"])
    if not overview_text and raw:
        overview_text = raw[:400]
    return {
        "id":               item["id"],
        "name":             item["name"],
        "module":           LOB_MODULE.get(item.get("lob", ""), "Cross"),
        "lob":              item.get("lob", ""),
        "version":          version,
        "overview":         overview_text,
        "keyProcessFlow":   "\n".join(f"{i+1}. {s}" for i, s in enumerate(sec["flow"])),
        "businessBenefits": "\n".join(f"{i+1}. {s}" for i, s in enumerate(sec["benefits"])),
        "source":           "SAP for Me",
    }


def _overlay_decisions(rows: list, past_decisions: list) -> list:
    by_id = {d["kddId"]: d for d in past_decisions if d.get("kddId")}
    if not by_id:
        return rows
    result = []
    for row in rows:
        past = by_id.get(row.get("kddId"))
        if not past:
            result.append(row)
            continue
        when = ""
        if past.get("savedAt"):
            try:
                dt   = datetime.fromisoformat(past["savedAt"].replace("Z", "+00:00"))
                when = dt.strftime("%b %Y")
            except Exception:
                pass
        parts   = [p for p in [past.get("client") or past.get("project"), when] if p]
        note_tag = f" [Previously: {' · '.join(parts)}]" if parts else ""
        result.append({
            **row,
            "decisionMade": past.get("decision")  or row.get("decisionMade", ""),
            "rationale":    past.get("rationale") or row.get("rationale", ""),
            "notes":        (row.get("notes") or "") + note_tag,
        })
    return result


async def run(items: list, cache_data=None, on_event=None, concurrency: int = 3, mode: str = "ai") -> dict:
    src_counts = {"claude": 0, "cache": 0, "error": 0}
    # Pre-allocated by input index so parallel tasks produce deterministic output order.
    _item_results: list[tuple[list, dict | None] | None] = [None] * len(items)

    async def process_item(idx: int, item: dict):
        import time
        t0 = time.monotonic()
        id_ = item["id"]

        def emit(ev: dict):
            if on_event:
                on_event(ev)

        state = {
            "item":               item,
            "cache_data":         cache_data,
            "on_event":           on_event,
            "cache_hit":          False,
            "library_hit":        False,
            "context":            None,
            "past_decisions":     [],
            "rows":               [],
            "source":             None,
            "validation_passed":  True,
            "validation_errors":  [],
            "validation_auto_fixed": False,
            "forbidden_found":    0,
            "input_tokens":       0,
            "output_tokens":      0,
            "retry_count":        0,
            "generation_ms":      0,
        }

        try:
            # ── Stage 1: Cache ─────────────────────────────────────────────────
            emit({"type": "progress", "item": id_, "name": item["name"],
                  "message": "[1/5] Cache check…", "stage": 1})
            state = await cache_agent.run(state)

            if mode == "fast":
                if state.get("cache_hit"):
                    emit({"type": "progress", "item": id_, "name": item["name"],
                          "message": "[2/5] Checking decision library…", "stage": 2})
                    state = await library_agent.run(state)
                    if state.get("past_decisions"):
                        state["rows"] = _overlay_decisions(state["rows"], state["past_decisions"])
                    _item_results[idx] = (state["rows"], None)
                    src_counts["cache"] += 1
                    emit({"type": "item_done", "item": id_, "name": item["name"],
                          "count": len(state["rows"]), "source": "cache",
                          "durationMs": int((time.monotonic() - t0) * 1000),
                          "inputTokens": 0, "outputTokens": 0,
                          "pastDecisionsUsed": len(state.get("past_decisions", []))})
                else:
                    _item_results[idx] = ([], None)
                    src_counts["error"] += 1
                    emit({"type": "error", "item": id_,
                          "message": f"{id_} not in cache — switch to AI Generate mode"})
                return

            # ── Stage 2: Library ───────────────────────────────────────────────
            emit({"type": "progress", "item": id_, "name": item["name"],
                  "message": "[2/5] Checking decision library…", "stage": 2})
            state = await library_agent.run(state)

            # ── Stage 3: Context ───────────────────────────────────────────────
            emit({"type": "progress", "item": id_, "name": item["name"],
                  "message": "[3/5] Parsing SAP process context…", "stage": 3})
            state = await context_agent.run(state)

            # ── Stage 4: Generation ────────────────────────────────────────────
            state = await generation_agent.run(state)

            # ── Stage 5: Validation ────────────────────────────────────────────
            emit({"type": "progress", "item": id_, "name": item["name"],
                  "message": "[5/5] Validating Cloud PE compliance…", "stage": 5})
            state = await validation_agent.run(state)

            # Retry once if validation critically failed (no rows)
            if not state.get("validation_passed") and state.get("retry_count", 0) == 0 and not state.get("rows"):
                log.warning("%s — validation failed, retrying generation", id_)
                state = {**state, "retry_count": 1}
                emit({"type": "progress", "item": id_, "name": item["name"],
                      "message": "[4/5] Retrying generation (first attempt invalid)…", "stage": 4})
                state = await generation_agent.run(state)
                state = await validation_agent.run(state)

            if not state.get("rows"):
                raise RuntimeError("Generation produced no rows after retry")

            ricef_count = sum(1 for r in state["rows"] if r.get("ricefType") and r["ricefType"] != "None")
            duration_ms = int((time.monotonic() - t0) * 1000)
            _item_results[idx] = (state["rows"], _build_overview(item, (cache_data or {}).get("version", "")))
            src_counts["claude"] += 1

            emit({
                "type":                "item_done",
                "item":                id_,
                "name":                item["name"],
                "count":               len(state["rows"]),
                "source":              state.get("source"),
                "ricef":               ricef_count,
                "durationMs":          duration_ms,
                "inputTokens":         state.get("input_tokens", 0),
                "outputTokens":        state.get("output_tokens", 0),
                "validationPassed":    state.get("validation_passed"),
                "validationErrors":    state.get("validation_errors", []),
                "validationAutoFixed": state.get("validation_auto_fixed"),
                "forbiddenFound":      state.get("forbidden_found", 0),
                "pastDecisionsUsed":   len(state.get("past_decisions", [])),
                "retries":             state.get("retry_count", 0),
            })

        except Exception as exc:
            duration_ms = int((time.monotonic() - t0) * 1000)
            log.error("%s pipeline error: %s", id_, exc)
            _item_results[idx] = ([], None)
            src_counts["error"] += 1
            emit({"type": "error", "item": id_, "message": str(exc)[:200]})

    # ── Parallel batches ───────────────────────────────────────────────────────
    for batch_start in range(0, len(items), concurrency):
        batch = items[batch_start: batch_start + concurrency]
        await asyncio.gather(*(process_item(batch_start + i, it) for i, it in enumerate(batch)))

    # ── Collect results in input order ─────────────────────────────────────────
    all_rows: list  = []
    overviews: list = []
    for res in _item_results:
        if res is not None:
            rows, ov = res
            all_rows.extend(rows)
            if ov is not None:
                overviews.append(ov)

    return {"rows": all_rows, "overviews": overviews, "src_counts": src_counts}
