# agents_py/context_agent.py — Stage 3: parse SAP catalog description into sections
import logging

log = logging.getLogger(__name__)

_STOP = {"Solution Capabilities", "Industry Relevance", "Diagrams", "Accelerators"}


async def run(state: dict) -> dict:
    item  = state["item"]
    lines = [l.strip() for l in (item.get("description") or "").split("\n") if l.strip()]

    sec: dict[str, list] = {"overview": [], "flow": [], "benefits": []}
    cur = None

    for line in lines:
        if line == "Overview":          cur = "overview";  continue
        if line == "Key Process Flow":  cur = "flow";      continue
        if line == "Business Benefits": cur = "benefits";  continue
        if line in _STOP:               cur = None;        continue
        if cur:                         sec[cur].append(line)

    context = {
        "overview": " ".join(sec["overview"])[:300],
        "flow":     "\n".join(f"{i+1}. {s}" for i, s in enumerate(sec["flow"][:10])),
        "benefits": "; ".join(sec["benefits"][:5]),
    }

    log.info("%s — overview %dc, %d flow steps", item["id"], len(context["overview"]), len(sec["flow"]))
    return {**state, "context": context}
