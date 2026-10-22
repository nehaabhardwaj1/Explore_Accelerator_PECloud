# agents_py/library_agent.py — Stage 2: load past approved decisions
import asyncio
import json
import logging
from .shared import ROOT

log = logging.getLogger(__name__)

DECISIONS_PATH = ROOT / "decisions.json"


async def run(state: dict) -> dict:
    item = state["item"]
    all_decisions = []
    try:
        if DECISIONS_PATH.exists():
            text = await asyncio.to_thread(DECISIONS_PATH.read_text, "utf-8")
            all_decisions = json.loads(text)
    except Exception as e:
        log.warning("Could not read decisions.json: %s", e)

    past = [d for d in all_decisions if d.get("scopeItemId") == item["id"]][:5]
    log.info("%s — %d past decision(s) found", item["id"], len(past))

    return {
        **state,
        "past_decisions": past,
        "library_hit":    len(past) >= 3,
    }
