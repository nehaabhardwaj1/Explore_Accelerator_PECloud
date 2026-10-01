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

    # Detect HTML and strip tags before line parsing
    if "<html" in raw.lower() or "<!doctype" in raw.lower() or raw.strip().startswith("<"):
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

    overview_text = " ".join(sec["overview"])[:300]

    # Fallback: use full stripped plain text when section markers weren't found
    if not overview_text and raw:
        # Take the first 400 chars of the stripped text as overview
        overview_text = raw[:400]

    context = {
        "overview": overview_text,
        "flow":     "\n".join(f"{i+1}. {s}" for i, s in enumerate(sec["flow"][:10])),
        "benefits": "; ".join(sec["benefits"][:5]),
    }

    log.info("%s — overview %dc, %d flow steps", item["id"], len(context["overview"]), len(sec["flow"]))
    return {**state, "context": context}
