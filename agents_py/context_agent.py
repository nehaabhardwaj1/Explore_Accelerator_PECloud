# agents_py/context_agent.py — Stage 3: parse SAP catalog description into sections
import logging
import re

log = logging.getLogger(__name__)

_STOP = {"Solution Capabilities", "Industry Relevance", "Diagrams", "Accelerators"}


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode common entities."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">") \
               .replace("&nbsp;", " ").replace("&#160;", " ").replace("&quot;", '"')
    return re.sub(r"\s+", " ", text).strip()


async def run(state: dict) -> dict:
    item = state["item"]
    raw  = item.get("description") or ""

    # Strip HTML whenever any tag appears anywhere in the description (not just at the start)
    if re.search(r"<[a-zA-Z/!]", raw):
        raw = _strip_html(raw)

    lines = [l.strip() for l in raw.split("\n") if l.strip()]

    sec: dict[str, list] = {"overview": [], "flow": [], "benefits": []}
    cur = None

    for line in lines:
        if line == "Overview":          cur = "overview";  continue
        if line == "Key Process Flow":  cur = "flow";      continue
        if line == "Business Benefits": cur = "benefits";  continue
        if line in _STOP:               cur = None;        continue
        if cur:                         sec[cur].append(line)

    overview_text = " ".join(sec["overview"])[:200]

    # Fallback: use full stripped plain text when section markers weren't found
    if not overview_text and raw:
        overview_text = raw[:200]

    context = {
        "overview": overview_text,
        "flow":     "\n".join(f"{i+1}. {s}" for i, s in enumerate(sec["flow"][:6])),
        "benefits": "; ".join(sec["benefits"][:3]),
    }

    log.info("%s — overview %dc, %d flow steps", item["id"], len(context["overview"]), len(sec["flow"]))
    return {**state, "context": context}
