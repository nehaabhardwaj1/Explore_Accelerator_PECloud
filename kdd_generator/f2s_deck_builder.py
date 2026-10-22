# kdd_generator/f2s_deck_builder.py
# Fit-to-Standard workshop PPTX — Accenture purple/white brand theme
# Sources: scope-catalog.json · bdcq-questions.json · kdd-cache.json · Claude (Haiku)
import asyncio
import contextvars
import json
import logging
import os
import re
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt
from kdd_generator.helpers import current_sap_release

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent.parent

# Per-build token accumulator — ContextVar so concurrent requests don't race.
# Estimates only (CLI does not expose real token counts): chars / 4 ≈ tokens.
_build_tokens_var: contextvars.ContextVar[dict] = contextvars.ContextVar(
    "_build_tokens", default=None
)

# Limit concurrent Claude CLI processes — prevents timeouts when many scope items
# each trigger 3 parallel Claude calls (brief + day-in-life + top decisions).
# Initialized lazily inside an async context so the semaphore is bound to the
# correct running event loop rather than the import-time loop.
_CLAUDE_SEM: asyncio.Semaphore | None = None


def _get_sem() -> asyncio.Semaphore:
    global _CLAUDE_SEM
    if _CLAUDE_SEM is None:
        _CLAUDE_SEM = asyncio.Semaphore(5)
    return _CLAUDE_SEM

# ── Accenture brand palette ───────────────────────────────────────────────────
_AC_PURPLE   = RGBColor(0xA1, 0x00, 0xFF)   # Accenture primary purple
_AC_DARK     = RGBColor(0x46, 0x00, 0x73)   # dark purple (cover bg, headers)
_AC_MID      = RGBColor(0x7B, 0x00, 0xD4)   # mid purple accent
_AC_LIGHT    = RGBColor(0xF0, 0xE6, 0xFF)   # very light purple tint
_AC_ALT      = RGBColor(0xF8, 0xF4, 0xFF)   # table alternate row
_RULE_COLOR  = RGBColor(0xD9, 0xBA, 0xFF)   # divider line
_WHITE       = RGBColor(0xFF, 0xFF, 0xFF)
_INK         = RGBColor(0x1A, 0x1A, 0x2E)   # near-black body text
_MUTED       = RGBColor(0x6B, 0x6B, 0x8A)   # footer / secondary text

# Status colours
_GREEN       = RGBColor(0x1E, 0x7B, 0x4D)
_AMBER       = RGBColor(0xC0, 0x7C, 0x00)
_RED         = RGBColor(0xC0, 0x39, 0x2B)

# BDCQ level fills
_L1_FILL     = RGBColor(0xFF, 0xF0, 0xF0)   # red-tinted — critical
_L2_FILL     = RGBColor(0xF0, 0xF8, 0xF0)   # green-tinted — important

def _hex_rgb(h: str) -> RGBColor:
    """Convert hex colour string to RGBColor — falls back to Accenture purple."""
    h = (h or "").lstrip("#")
    try:
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)) if len(h) == 6 else _AC_PURPLE
    except Exception:
        return _AC_PURPLE


# ── Low-level shape helpers ───────────────────────────────────────────────────

def _blank(prs: Presentation):
    return prs.slides.add_slide(prs.slide_layouts[6])


def _tx(slide, l, t, w, h, text, size=11, bold=False, italic=False,
        color=_INK, align=PP_ALIGN.LEFT, wrap=True):
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.text = ""
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = str(text or "")
    run.font.name   = "Arial"
    run.font.size   = Pt(size)
    run.font.bold   = bold
    run.font.italic = italic
    run.font.color.rgb = color
    return tb


def _rect(slide, l, t, w, h, fill: RGBColor, border=False):
    from pptx.util import Inches as I
    shp = slide.shapes.add_shape(1, I(l), I(t), I(w), I(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    shp.line.fill.background() if not border else None
    return shp


def _footer(slide, text: str):
    _tx(slide, 0.3, 7.18, 12.7, 0.28, text,
        size=7.5, italic=True, color=_MUTED)


def _header(slide, kicker: str, title: str, footer_text: str,
            brand: RGBColor = _AC_PURPLE, dark: RGBColor = _AC_DARK):
    """Standard content slide header — purple kicker, dark title, rule, lavender deco."""
    # Corner decoration (light purple rounded rect, top-right)
    deco = slide.shapes.add_shape(5, Inches(10.4), Inches(-0.6), Inches(3.5), Inches(3.5))
    deco.fill.solid(); deco.fill.fore_color.rgb = _AC_LIGHT
    deco.line.fill.background()

    # Kicker (uppercase, brand purple)
    _tx(slide, 0.3, 0.28, 12.0, 0.30, kicker.upper(),
        size=8, bold=True, color=brand)

    # Title (dark purple, bold)
    _tx(slide, 0.3, 0.60, 12.0, 0.82, title,
        size=19, bold=True, color=dark)

    # Rule line
    rule = slide.shapes.add_shape(1, Inches(0.3), Inches(1.53),
                                  Inches(12.73), Inches(0.025))
    rule.fill.solid(); rule.fill.fore_color.rgb = _RULE_COLOR
    rule.line.fill.background()

    _footer(slide, footer_text)


# ── Table helpers ─────────────────────────────────────────────────────────────

def _cell(tbl, ri, ci, text, size=9, bold=False,
          color=_INK, fill: RGBColor = None, align=PP_ALIGN.LEFT):
    cell = tbl.cell(ri, ci)
    if fill is not None:
        cell.fill.solid(); cell.fill.fore_color.rgb = fill
    tf = cell.text_frame
    tf.word_wrap = True; tf.text = ""
    p = tf.paragraphs[0]; p.alignment = align
    run = p.add_run()
    run.text = str(text or "—")
    run.font.name = "Arial"; run.font.size = Pt(size)
    run.font.bold = bold; run.font.color.rgb = color


def _table(slide, top, col_widths, headers, rows,
           brand: RGBColor = _AC_PURPLE, row_h=0.38):
    nc = len(headers); nr = 1 + len(rows)
    tw = sum(col_widths)
    tbl = slide.shapes.add_table(nr, nc,
        Inches(0.3), Inches(top), Inches(tw), Inches(row_h * nr)).table
    for ci, cw in enumerate(col_widths):
        tbl.columns[ci].width = Inches(cw)
    for ci, hdr in enumerate(headers):
        _cell(tbl, 0, ci, hdr, bold=True, color=_WHITE, fill=brand)
    for ri, row in enumerate(rows):
        fill = _AC_ALT if ri % 2 else _WHITE
        for ci, val in enumerate((list(row) + [""] * nc)[:nc]):
            _cell(tbl, ri + 1, ci, val, fill=fill)
    return tbl


def _paginated(prs, kicker, title, footer, headers, col_widths, data,
               brand=_AC_PURPLE, max_rows=12, top=1.75):
    if not data:
        return
    pages = [data[i:i + max_rows] for i in range(0, len(data), max_rows)]
    for pi, page in enumerate(pages):
        pt = title if len(pages) == 1 else f"{title}  ({pi+1}/{len(pages)})"
        sl = _blank(prs)
        _header(sl, kicker, pt, footer, brand)
        _table(sl, top, col_widths, headers, page, brand)


def _bullets(prs, kicker, title, items, footer,
             brand=_AC_PURPLE, top=1.80, size=12, icon="•"):
    sl = _blank(prs)
    _header(sl, kicker, title, footer, brand)
    y = top
    for b in items:
        _tx(sl, 0.55, y, 12.2, 0.52, f"{icon}  {b}", size=size, color=_INK)
        y += 0.53


# ── Data helpers ──────────────────────────────────────────────────────────────

def _sent_case(s: str) -> str:
    """Sentence-case: capitalise first letter, leave the rest unchanged."""
    return s[:1].upper() + s[1:] if s else s


# Matches a common word-ending suffix directly followed (no space) by the start of
# another word — catches HTML-stripping artifacts like "viewingimportant".
# Only splits when the combined token is > 14 chars to avoid false positives on
# real compound words (e.g. "something", "understand" stay intact).
_CONCAT_WORD_RE = re.compile(
    r'([a-z]{3,}(?:ing|tion|ment|ness|ance|ence|ful|less|able|ible|ary|ery|ory|ed|ly))'
    r'([a-z]{4,})',
    re.IGNORECASE,
)


def _fix_concatenated_words(text: str) -> str:
    def _split(m: re.Match) -> str:
        return (m.group(1) + " " + m.group(2)) if len(m.group(0)) > 14 else m.group(0)
    return _CONCAT_WORD_RE.sub(_split, text)


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&[a-zA-Z]+;|&#\d+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_desc(desc: str) -> dict:
    if "<" in desc:
        desc = _strip_html(desc)
    lines = [l.strip() for l in desc.split("\n") if l.strip()]
    STOP = {"Solution Capabilities", "Industry Relevance", "Diagrams", "Accelerators"}
    sec = {"overview": [], "flow": [], "benefits": []}
    cur = None
    for ln in lines:
        if ln == "Overview":          cur = "overview"; continue
        if ln == "Key Process Flow":  cur = "flow";     continue
        if ln == "Business Benefits": cur = "benefits"; continue
        if ln in STOP:                cur = None;       continue
        if cur:                       sec[cur].append(ln)
    # Filter out scope-ID cross-reference lines (e.g. "7WC - SAP Content Management...")
    # SAP scope IDs are 2-5 alphanumeric chars (may start with digit) followed by dash.
    # Catalog uses these as hyperlinks, not actual business outcomes.
    _SCOPE_REF = re.compile(r"^[A-Z0-9][A-Z0-9]{1,4}\s*[-–]")
    real_benefits = [b for b in sec["benefits"] if not _SCOPE_REF.match(b)]
    overview = " ".join(sec["overview"])[:500] or desc[:500]
    return {"overview": overview, "flow_steps": sec["flow"][:12], "benefits": real_benefits[:8]}


from kdd_generator.f2s_shared import F2S_TO_BDCQ_DOMAIN as _F2S_TO_BDCQ_DOMAIN, BDCQ_SOURCE_FIXES as _BDCQ_RAW_FIXES

# Precompile BDCQ source fix patterns once at module load
_BDCQ_SRC_FIXES: tuple = tuple(
    (re.compile(pat, re.IGNORECASE), repl) for pat, repl in _BDCQ_RAW_FIXES
)


def _build_bdcq_indexes(path: Path) -> tuple:
    """Parse bdcq-questions.json into three indexes.

    Pattern A — rows with a 'Scope Ref.' value → indexed by scope item ID.
    Pattern B — rows with no 'Scope Ref.' → indexed by domain name (LOB pool).
    Pattern C — ALL rows per domain regardless of Scope Ref. → domain fallback.
                Used when a scope item's domain has Scope Ref. rows but none match
                the specific scope ID (e.g. HR payroll items 1NL, 3UP).

    Returns: (scope_idx, lob_idx, domain_idx)
      scope_idx:  {scope_id:    [q_dict, ...]}
      lob_idx:    {domain_name: [q_dict, ...]}   ← no-Scope-Ref rows only
      domain_idx: {domain_name: [q_dict, ...]}   ← all rows (superset of lob_idx)
    """
    if not path.exists():
        return {}, {}, {}
    try:
        data = json.loads(path.read_text("utf-8"))
    except Exception:
        return {}, {}, {}

    scope_idx:  dict = {}
    lob_idx:    dict = {}
    domain_idx: dict = {}

    def _clean(s: str) -> str:
        for pat, repl in _BDCQ_SRC_FIXES:
            s = pat.sub(repl, s)
        return s

    for domain in data.get("domains", []):
        domain_name = domain.get("domain", "")
        for sheet in domain.get("sheets", []):
            sheet_name = sheet.get("sheet", "")
            for row in sheet.get("rows", []):
                q = _clean((row.get("Question") or "").strip())
                if not q:
                    continue
                scope_ref = (row.get("Scope Ref.") or row.get("Scope Ref") or "").strip()
                q_obj = {
                    "level":     str(row.get("Level") or "L2"),
                    "area":      _clean(str(row.get("Process Area") or
                                   row.get("Solution Processes") or
                                   row.get("Business Process Configuration Group") or "")),
                    "topic":     _clean(str(row.get("Topic") or "")),
                    "topic_def": _clean(str(row.get("Topic Definition") or ""))[:200],
                    "question":  q,
                    "domain":    domain_name,
                    "sheet":     sheet_name,   # source sheet for country-locale filtering
                }
                # Pattern C — every question goes into domain_idx
                domain_idx.setdefault(domain_name, []).append(q_obj)

                if scope_ref:
                    # Pattern A — one or more comma-separated scope IDs.
                    # Copy q_obj per scope ID so mutations on one entry can't corrupt another.
                    for sid in re.split(r"[,\s]+", scope_ref):
                        sid = sid.strip()
                        if sid:
                            scope_idx.setdefault(sid, []).append(dict(q_obj))
                else:
                    # Pattern B — index by LOB domain (no Scope Ref rows only)
                    lob_idx.setdefault(domain_name, []).append(q_obj)

    return scope_idx, lob_idx, domain_idx


# Locale marker formats found in BDCQ source data:
#   Format A: "(CH specific)" or "CH specific"  →  ISO code + " specific"
#   Format B: "Localized for China"             →  "Localized for " + country name
#   Format C: "only relevant for Germany"        →  prose relevance statement
#   Format D: "country dependent and only relevant for Mexico"
#   Format E: "[Country]-specific" (hyphenated)
#   Format F: country name appears in a tax-authority or regulatory context
#             e.g. "SAT Service de Administration Tributaria" (Mexico), "Philippines" in topic
# Groups: group(1)=ISO code (Format A), group(2)=country name (Formats B–F)
_COUNTRY_NAMES_RE_PART = (
    r"Austria|Switzerland|Germany|India|Argentina|Brazil|Australia|Canada|Mexico|Japan|"
    r"Philippines|South Korea|Korea|South Africa|Singapore|New Zealand|Sweden|Norway|"
    r"Denmark|Finland|USA|United States|Germany|UK|United Kingdom|France|Netherlands|"
    r"Italy|Spain|Poland|China|Japan"
)
_BDCQ_LOCALE_RE = re.compile(
    r"\b(CH|AT|IN|AR|BR|AU|CA|MX|CN|JP|KR|ZA|SG|NZ|SE|NO|DK|FI|US|GB|DE|FR|NL|IT|ES|PL|PH)\s+specific\b|"
    r"\bLocali[sz]ed for\s+(" + _COUNTRY_NAMES_RE_PART + r")\b|"
    r"\bonly relevant for\s+(" + _COUNTRY_NAMES_RE_PART + r")\b|"
    r"\bcountry dependent.*?relevant for\s+(" + _COUNTRY_NAMES_RE_PART + r")\b|"
    r"\b(" + _COUNTRY_NAMES_RE_PART + r")\s*[–\-]\s*specific\b|"
    r"\brelevant for\s+(" + _COUNTRY_NAMES_RE_PART + r")\s+only\b",
    re.IGNORECASE,
)

# Country name → ISO-2 mapping (both directions needed for the two locale marker formats)
_COUNTRY_ISO: dict = {
    "austria": "AT", "switzerland": "CH", "germany": "DE", "india": "IN", "argentina": "AR",
    "brazil": "BR", "australia": "AU", "canada": "CA", "mexico": "MX",
    "china": "CN", "japan": "JP", "korea": "KR", "south korea": "KR",
    "south africa": "ZA", "singapore": "SG", "new zealand": "NZ",
    "sweden": "SE", "norway": "NO", "denmark": "DK", "finland": "FI",
    "usa": "US", "united states": "US", "uk": "GB", "united kingdom": "GB",
    "france": "FR", "netherlands": "NL", "italy": "IT", "spain": "ES", "poland": "PL",
}
# Country name → ISO for the "Localized for <CountryName>" format
_LOCALIZE_NAME_TO_ISO: dict = {
    "austria": "AT", "china": "CN", "india": "IN", "argentina": "AR", "brazil": "BR",
    "australia": "AU", "canada": "CA", "mexico": "MX", "japan": "JP",
    "south korea": "KR", "korea": "KR", "south africa": "ZA", "singapore": "SG",
    "new zealand": "NZ", "sweden": "SE", "norway": "NO", "denmark": "DK",
    "finland": "FI", "usa": "US", "united states": "US", "germany": "DE",
    "uk": "GB", "united kingdom": "GB", "france": "FR", "netherlands": "NL",
    "italy": "IT", "spain": "ES", "poland": "PL",
}

# LOB cross-contamination exclusions — questions from other LOBs that bleed in via
# shared BDCQ domains. Applied to ALL patterns (A, B, C) before display or Claude selection.
# System-level configuration topics that appear in every BDCQ template regardless of
# process scope (e.g. "Default Tax Code", "Tolerances - Customer/Supplier") — these
# are Finance-domain administration settings and add no value for non-Finance workshops.
# Matched against the question's topic field to avoid false positives on question text.
_BDCQ_SYSTEM_NOISE_RE = re.compile(
    r"^(?:default tax code|tolerance[s]?\s*[-–—]\s*(?:customer|supplier|vendor)|"
    r"number range[s]?\s+for\s+(?:internal|external)|"
    r"default\s+(?:currency|value)\s+(?:setting|type))",
    re.IGNORECASE,
)

# General cross-scope contamination: SAP BDCQ topic_def fields often contain a phrase
# like "Configure X for Contract and Lease Management" or "Activate X in Treasury" —
# the named module after "for"/"in"/"within" identifies which scope item the question
# actually belongs to. If that named module shares no significant content words with the
# current scope item name, the question is cross-contamination from a different scope item.
# Applied to ALL LOBs — no per-domain maintenance required.
# Words in _TOPIC_DEF_STOP are common across many SAP module names and must not count
# as meaningful overlap (e.g. "Management" appears in dozens of SAP module names).
_TOPIC_DEF_MODULE_RE = re.compile(
    r"\b(?:for|in|within|of)\s+([A-Z][A-Za-z ,&–\-]{8,60}?)(?:\s*[\.\,\(\)]|$)",
    re.MULTILINE,
)
_TOPIC_DEF_STOP: frozenset = frozenset({
    "management", "based", "process", "processing", "services", "service",
    "with", "from", "using", "cloud", "edition", "public", "project", "projects",
    "sap", "hana", "accounting", "financial", "business", "standard",
})

# Terminology corrections applied to KDD design question text at render time.
# Catches renamed SAP products and truncation artefacts that arrive via the KDD cache.
# Add entries here as SAP renames products or new truncation patterns are discovered.
_KDD_TERM_FIXES: tuple = (
    (re.compile(r"\bSAP API Business Hub\b"),      "SAP Business Accelerator Hub"),
    (re.compile(r"\bSAP BT\b"),                    "SAP BTP"),
)


def _apply_kdd_fixes(text: str) -> str:
    for pat, rep in _KDD_TERM_FIXES:
        text = pat.sub(rep, text)
    return text


# Detects deprecation language in any scope item description — fires the warning box
# in _identity for any scope item SAP has marked as deprecated or superseded.
_DEPRECATION_RE = re.compile(
    r"deprecat|successor\s+(?:scope\s+item|is\b)|if you have not yet activated|"
    r"activate\s+\S+\s+instead|no\s+longer\s+(?:available|recommended|supported)",
    re.IGNORECASE,
)

_BDCQ_LOB_EXCLUSIONS: dict = {
    "Finance & Controlling": re.compile(
        r"\bSuccessFactors\b|\bEmployee Central\b|\bTime Recording\b|\bLeave Request\b|"
        r"\bPayroll\b.*\bEmployee\b|\bEmployee.*\bPayroll\b|"
        r"\bBill of Material\b|\bProduction Order\b|\bWork Center\b|\bMRP\b|"
        r"\bBillable Items\b|\bConvergent Invoicing\b|\bQR[- ]?Bill\b|\bDGI\b|\bAFIP\b|"
        r"\btaxpayer code\b|\btax payer code\b|\bUtility Billing\b|\bSubscription Billing\b",
        re.IGNORECASE,
    ),
    "Human Resources": re.compile(
        r"\bPurchase Order\b|\bSales Order\b|\bJournal Entry\b|"
        r"\bBank Statement\b|\bPayment Run\b|\bInvoice Verification\b",
        re.IGNORECASE,
    ),
    "Manufacturing": re.compile(
        r"\bSuccessFactors\b|\bEmployee Central\b|\bPayroll\b",
        re.IGNORECASE,
    ),
}


def _filter_bdcq_pool(pool: list, allowed_isos: set, lob_canon: str,
                      item_name: str = "") -> list:
    """Filter BDCQ questions by locale relevance and LOB cross-contamination.

    allowed_isos: set of ISO-2 codes for the workshop countries (e.g. {"IN","DE"}).
                  Empty set = no country set; locale-specific questions are filtered out.
    lob_canon:    Canonical LOB name used to exclude cross-LOB question bleed.
    item_name:    Scope item name — used to gate Finance sub-domain questions so that
                  topics belonging to specific SAP sub-modules (Contract/Lease, Treasury)
                  are only included when the scope item name indicates relevance.
    """
    lob_excl   = _BDCQ_LOB_EXCLUSIONS.get(lob_canon)
    name_lower = item_name.lower()
    result = []
    for q in pool:
        # Sheet-based locale: questions from a 2-letter country sheet (e.g. "AR", "CH")
        # are only relevant when that exact country is in the workshop scope.
        sheet = q.get("sheet", "")
        if re.match(r"^[A-Z]{2}$", sheet) and sheet != "LC":
            if not allowed_isos or sheet not in allowed_isos:
                continue

        # Build check text — include area field so LOB exclusions catch cross-LOB bleed
        # in process area names (e.g. SuccessFactors appearing in area, not question text).
        text = " ".join(filter(None, [
            q.get("question", ""),
            q.get("topic", ""),
            q.get("area", ""),
        ])).strip()

        # Locale-marker check: Formats A–F (see _BDCQ_LOCALE_RE definition).
        # group(1) = ISO code (Format A); groups(2–6) = country name (Formats B–F).
        m = _BDCQ_LOCALE_RE.search(text)
        if m:
            if m.group(1):  # Format A: ISO code directly
                q_iso = m.group(1).upper()
            else:           # Formats B–F: country name in one of the later groups
                country_name = next(
                    (g for g in m.groups()[1:] if g), ""
                ).lower().strip()
                q_iso = _COUNTRY_ISO.get(country_name, "??")
            # If no workshop countries set OR question is for a country not in scope → drop
            if not allowed_isos or q_iso not in allowed_isos:
                continue

        # LOB cross-contamination check
        if lob_excl and lob_excl.search(text):
            continue

        # System-level noise: Finance-admin topics (default tax code, tolerance groups,
        # number ranges) are irrelevant for non-Finance workshops — matched on topic field only
        # to avoid dropping valid questions that mention these terms in their question text.
        if lob_canon != "Finance & Controlling":
            if _BDCQ_SYSTEM_NOISE_RE.match(q.get("topic", "")):
                continue

        # General cross-scope contamination: if topic_def names a SAP module/product
        # (pattern: "for|in|within <Named Module>") that shares no significant content
        # words with the current scope item name, this question belongs to a different
        # scope item. Applies to ALL LOBs — no per-domain list required.
        if name_lower:
            _topic_def_text = q.get("topic_def", "").strip()
            if _topic_def_text:
                _mod_match = _TOPIC_DEF_MODULE_RE.search(_topic_def_text)
                if _mod_match:
                    _mod_words  = frozenset(
                        w for w in re.findall(r"\b[a-z]{4,}\b",
                                              _mod_match.group(1).lower())
                        if w not in _TOPIC_DEF_STOP
                    )
                    _item_words = frozenset(
                        w for w in re.findall(r"\b[a-z]{4,}\b", name_lower)
                        if w not in _TOPIC_DEF_STOP
                    )
                    if _mod_words and not (_mod_words & _item_words):
                        continue  # named module has no content-word overlap with scope item

        result.append(q)
    return result


def _prerank_bdcq_pool(pool: list, item_name: str, overview: str,
                       max_size: int = 35) -> list:
    """Keyword-rank a BDCQ pool and return the top max_size questions.

    Uses word-overlap between the scope item context and each question's topic +
    text. Runs in microseconds (pure Python) and cuts the pool sent to Claude by
    50–75%, reducing both token cost and inference latency.
    Falls back to pool[:max_size] if no keyword signal is found.
    """
    if len(pool) <= max_size:
        return pool
    context = f"{item_name} {overview[:200]}".lower()
    keywords = {
        w for w in re.findall(r"\b[a-z]{4,}\b", context)
        if w not in _TOPIC_DEF_STOP
    }
    if not keywords:
        return pool[:max_size]
    scored = sorted(
        pool,
        key=lambda q: len(keywords & set(re.findall(
            r"\b[a-z]{4,}\b",
            f"{q.get('topic','')} {q.get('question','')}".lower()
        ))),
        reverse=True,
    )
    # Always include high-signal questions; pad with top-ranked if fewer than 10 match
    matched = [q for q in scored if any(
        w in f"{q.get('topic','')} {q.get('question','')}".lower()
        for w in keywords
    )]
    result = matched[:max_size]
    if len(result) < 10:
        result = scored[:max_size]
    return result


async def _claude_select_bdcq(item: dict, parsed: dict,
                               lob_pool: list, max_q: int = 12,
                               exclude_texts: set = None,
                               ws_country_isos: set = frozenset()) -> list:
    """Use Claude to pick the most relevant BDCQ questions from a LOB pool
    for a specific scope item. Returns a filtered subset of lob_pool.

    exclude_texts:    set of question strings already chosen for other scope items
                      in the same LOB — Claude is told to avoid them so each scope
                      item gets differentiated questions.
    ws_country_isos:  set of ISO-2 codes for the workshop countries — used to filter
                      out locale-specific questions that don't apply.
    """
    if not lob_pool:
        return []

    # Apply locale and LOB cross-contamination filter, then keyword-rank to top 35.
    # Reduces Claude prompt from ~3,000 tokens (80 questions) to ~1,300 tokens (35).
    lob_canon_for_filter = _norm_lob(parsed.get("l1") or item.get("lob", ""))
    filtered_pool = _filter_bdcq_pool(lob_pool, ws_country_isos, lob_canon_for_filter,
                                      item_name=item.get("name", ""))
    pre_pool  = filtered_pool or lob_pool
    overview   = parsed.get("overview", "")[:200]
    candidates = _prerank_bdcq_pool(pre_pool, item.get("name", ""), overview, max_size=35)
    q_list = "\n".join(
        f"{i+1}. [L{q['level']}] [{q['topic'][:35]}] {q['question'][:110]}"
        for i, q in enumerate(candidates)
    )
    steps = " → ".join(parsed.get("flow_steps", [])[:5])
    excl_note = ""
    if exclude_texts:
        ex_list = "\n".join(f"  - {t[:90]}" for t in list(exclude_texts)[:15])
        excl_note = (
            f"\n\nIMPORTANT: the following questions have ALREADY been assigned to "
            f"another scope item in this same workshop — do NOT select them again:\n{ex_list}"
        )
    prompt = (
        f"SAP S/4HANA Cloud PE — scope item {item.get('id')} — {item.get('name')}.\n"
        f"Overview: {overview}\nKey process steps: {steps}\n\n"
        f"From the BDCQ question bank below select the {max_q} most relevant questions "
        f"for THIS specific scope item. Prioritise questions unique to {item.get('name')}."
        f"{excl_note}\n\n"
        f"Return ONLY a JSON array of 1-based integers, e.g. [2,5,8,...]. "
        f"No explanation, no markdown.\n\nQUESTION BANK:\n{q_list}"
    )
    try:
        raw = await _claude(prompt, timeout=55)
        m = re.search(r"\[[\d,\s]+\]", raw)
        if m:
            indices = json.loads(m.group())
            selected = [candidates[i - 1] for i in indices
                        if isinstance(i, int) and 1 <= i <= len(candidates)]
            # Deduplicate by question text (BDCQ source data can have duplicate rows)
            seen_q: set = set()
            deduped = []
            for q in selected:
                txt = q.get("question", "")
                if txt not in seen_q:
                    seen_q.add(txt)
                    deduped.append(q)
            if deduped:
                return deduped
    except Exception as exc:
        log.warning("BDCQ Claude selection for %s: %s", item.get("id"), exc)
    # Fallback: skip already-used questions, take first max_q remaining
    used = exclude_texts or set()
    fallback = [q for q in candidates if q.get("question", "") not in used]
    return fallback[:max_q] or candidates[:max_q]


def _load_kdd_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
        return {sid: v.get("rows", []) for sid, v in data.get("items", {}).items()}
    except Exception:
        return {}


def _load_catalog(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text("utf-8"))
        items = raw if isinstance(raw, list) else raw.get("items") or raw.get("processes") or []
        return {i.get("id", ""): i for i in items}
    except Exception:
        return {}


# ── F2S folder — primary content source ──────────────────────────────────────

_L1_TO_FILE = {
    "Asset Management":        "asset-management",
    "Cross-Functional":        "cross-functional",
    "Customer Service":        "customer-service",
    "Finance & Controlling":   "finance-and-controlling",
    "Human Resources":         "human-resources",
    "Manufacturing":           "manufacturing",
    "Professional Services":   "professional-services",
    "R&D & Engineering":       "randd-and-engineering",
    "Sales & Distribution":    "sales-and-distribution",
    "Sourcing & Procurement":  "sourcing-and-procurement",
    "Supply Chain":            "supply-chain",
}


def _load_f2s_index() -> dict:
    """Load f2s/f2s-index.json → {scope_id: {id, name, l1, l2, hint}}"""
    path = ROOT / "f2s" / "f2s-index.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
        return {p["id"]: p for p in data.get("processes", []) if "id" in p}
    except Exception:
        return {}


def _load_f2s_content(scope_id: str, f2s_idx: dict) -> dict:
    """Read description, L5 steps, and benefits from the f2s/ domain .md files.
    Returns {overview, flow_steps[], benefits[], l1, l2}.
    Falls back gracefully to empty strings/lists if the scope isn't found.
    """
    empty = {"overview": "", "flow_steps": [], "benefits": [], "l1": "", "l2": ""}
    entry = f2s_idx.get(scope_id)
    if not entry:
        return empty

    l1 = entry.get("l1", "")
    l2 = entry.get("l2", "")
    suffix = _L1_TO_FILE.get(l1)
    if not suffix:
        return {**empty, "l1": l1, "l2": l2}

    md_path = ROOT / "f2s" / f"f2s-{suffix}.md"
    if not md_path.exists():
        return {**empty, "l1": l1, "l2": l2}

    try:
        text = md_path.read_text("utf-8")
    except Exception:
        return {**empty, "l1": l1, "l2": l2}

    # Find the section header: ### CODE — ...
    m = re.search(rf"^###\s+{re.escape(scope_id)}\s+—", text, re.MULTILINE)
    if not m:
        return {**empty, "l1": l1, "l2": l2}

    # Grab section text until the next --- separator or another ### heading
    start = text.index("\n", m.start()) + 1
    end_m = re.search(r"^(---|###)", text[start:], re.MULTILINE)
    section = text[start: start + end_m.start()].strip() if end_m else text[start:].strip()
    section = _fix_concatenated_words(section)

    # Extract **L5 Steps**: step1 · step2 ...
    flow_steps: list[str] = []
    sm = re.search(r"\*\*L5 Steps\*\*:\s*(.+)", section)
    if sm:
        raw_steps = [s.strip() for s in sm.group(1).split(" · ") if s.strip()]
        # Remove SAP data artifact: compound group headers like
        # "Manufacturing steps: Step1 Step2 Step3" (the sub-steps follow individually)
        flow_steps = [s for s in raw_steps
                      if not re.search(r'\bsteps?:', s, re.IGNORECASE)]

    # Extract **Benefits**: benefit1 · benefit2 ...
    benefits: list[str] = []
    bm = re.search(r"\*\*Benefits\*\*:\s*(.+)", section)
    if bm:
        benefits = [b.strip() for b in bm.group(1).split(" · ") if b.strip()]

    # Description: text before the first ** marker line
    desc = re.split(r"\n\*\*(?:L5 Steps|Benefits)\*\*:", section, maxsplit=1)[0].strip()

    # If description ends with ":" (source data lists sub-processes after colon),
    # complete the sentence using the first 3 L5 steps — more useful than a navigator link.
    if desc.rstrip().endswith(":"):
        if flow_steps:
            step_list = "; ".join(flow_steps[:3])
            suffix = f": {step_list}" + (", and further steps." if len(flow_steps) > 3 else ".")
        else:
            codes = re.findall(r'\(([A-Z0-9]{2,4})\)', desc)
            suffix = (" " + ", ".join(codes) + ".") if codes else \
                     " See L5 Process Steps for the complete subprocess workflow."
        desc = desc.rstrip(":").rstrip() + suffix

    # Cloud PE compliance: source data occasionally contains "Private Edition" in error.
    # Normalise at load time so the fix propagates to every slide and Claude prompt.
    _PE_FIXES = (
        (re.compile(r"\bS/4HANA Cloud Private Edition\b", re.IGNORECASE),
         "SAP S/4HANA Cloud Public Edition"),
        (re.compile(r"\bCloud Private Edition\b", re.IGNORECASE), "Cloud Public Edition"),
        (re.compile(r"\bPrivate Cloud Edition\b",  re.IGNORECASE), "Cloud Public Edition"),
    )
    for _pat, _rep in _PE_FIXES:
        desc     = _pat.sub(_rep, desc)
        benefits = [_pat.sub(_rep, b) for b in benefits]

    return {
        "overview":   desc,
        "flow_steps": flow_steps,
        "benefits":   benefits,
        "l1":         l1,
        "l2":         l2,
    }


# ── Claude intelligence ───────────────────────────────────────────────────────

def _resolve_claude() -> str:
    if sys.platform != "win32":
        return "claude"
    if (p := os.environ.get("CLAUDE_PATH")) and os.path.exists(p):
        return p
    home    = os.environ.get("USERPROFILE") or str(Path.home())
    appdata = os.environ.get("APPDATA") or str(Path(home, "AppData", "Roaming"))
    for c in [
        Path(home, ".local", "bin", "claude.exe"),
        Path(home, "AppData", "Local", "Programs", "claude", "claude.exe"),
        Path(appdata, "npm", "claude.exe"),
        Path(appdata, "npm", "claude.cmd"),
    ]:
        if c.exists():
            return str(c)
    try:
        import subprocess
        out = subprocess.check_output(["where", "claude"], text=True, timeout=5,
                                      stderr=subprocess.DEVNULL)
        for ln in out.splitlines():
            ln = ln.strip()
            if ln and os.path.exists(ln):
                return ln
    except Exception:
        pass
    return "claude"


_CLAUDE_EXE = _resolve_claude()


async def _claude(prompt: str, timeout: int = 90) -> str:
    async with _get_sem():
        return await _claude_raw(prompt, timeout)


async def _claude_raw(prompt: str, timeout: int = 90) -> str:
    home    = str(Path.home())
    appdata = os.environ.get("APPDATA") or str(Path(home, "AppData", "Roaming"))
    sep     = ";" if sys.platform == "win32" else ":"
    env     = {**os.environ, "PATH": sep.join([
        str(Path(home, ".local", "bin")),
        str(Path(home, "AppData", "Local", "Programs", "claude")),
        str(Path(appdata, "npm")),
        os.environ.get("PATH", ""),
    ])}
    is_cmd = sys.platform == "win32" and _CLAUDE_EXE.lower().endswith((".cmd", ".bat"))
    if is_cmd:
        proc = await asyncio.create_subprocess_shell(
            f'"{_CLAUDE_EXE}" --model claude-haiku-4-5-20251001 --print --dangerously-skip-permissions',
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=env, cwd=tempfile.gettempdir())
    else:
        proc = await asyncio.create_subprocess_exec(
            _CLAUDE_EXE, "--model", "claude-haiku-4-5-20251001",
            "--print", "--dangerously-skip-permissions",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=env, cwd=tempfile.gettempdir())
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(prompt.encode("utf-8")), timeout=timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()  # prevent zombie process accumulation
        raise
    if proc.returncode != 0:
        msg = stderr.decode("utf-8", errors="replace")[:200] if stderr else ""
        raise RuntimeError(f"Claude exited {proc.returncode}: {msg}")
    result = stdout.decode("utf-8", errors="replace")
    # Accumulate estimated token counts (chars / 4 ≈ tokens; CLI has no native count)
    _tok = _build_tokens_var.get()
    if _tok is not None:
        _tok["prompt"]     += max(1, len(prompt) // 4)
        _tok["completion"] += max(1, len(result) // 4)
    return result


# LOB-specific domain knowledge hints injected into the brief prompt so Claude
# has concrete facts to reference even when the catalog description is sparse.
_LOB_INTELLIGENCE_HINTS: dict = {
    "Professional Services": (
        "Relevant SAP PS Fiori app codes: Create Project (F-2163), Manage Projects (F-2160), "
        "Time Recording (F-0086), Manage Revenue Contracts (F-3849), Manage Performance "
        "Obligations (F-3850), Release Revenue (F-3852), Manage Intercompany Service Orders. "
        "IFRS 15 / ASC 606 gap watchpoints: bundled contract SSP allocation, variable "
        "consideration for usage-based billing, contract modification requiring reversal. "
        "Intercompany gaps: transfer pricing setup per company-code pair, AP auto-posting "
        "trigger to ordering CC, cross-border VAT treatment on IC invoices. "
        "Integration touchpoints: SuccessFactors Employee Central → resource master data "
        "replication, SAP Concur → expense posting to project WBS via iDoc/API, "
        "SAP Analytics Cloud → project profitability and utilisation reporting."
    ),
    "Finance & Controlling": (
        "Fiori apps: Manage Journal Entries (F-0717), Manage Incoming Payments (F-0754), "
        "Financial Closing Cockpit (F-2212), Manage Tax Accounts, Cash Flow Analyser. "
        "Gap watchpoints: multi-entity consolidation (Group Reporting activation required), "
        "custom approval matrix for payments beyond standard dual-control, complex tax "
        "jurisdictions needing BTP Tax Service. "
        "Integration: SAP Multi-Bank Connectivity for bank statements, SAP Concur for "
        "expense reimbursement, downstream AP/AR to external reporting."
    ),
    "Manufacturing": (
        "Fiori apps: Manage Production Orders (F-1983), Production Scheduling Board (F-1985), "
        "Manage Bills of Materials (F-1540), Manage Work Centers (F-1537). "
        "Gap watchpoints: make-to-order with customer-specific BOMs, batch classification "
        "beyond standard 3 classes, shop-floor execution beyond standard confirmation app. "
        "Integration: SAP IBP for demand-driven MRP signals, QM for quality inspection lots."
    ),
    "Supply Chain": (
        "Fiori apps: Manage Stock (F-1088), Manage Scheduling Agreements (F-1014), "
        "Monitor Stock in Transit (F-0887), Manage Delivery Scheduling. "
        "Gap watchpoints: DDMRP buffer model (requires dedicated activation), advanced ATP "
        "backorder processing (separate scope item), complex route determination. "
        "Integration: SAP Transportation Management for carrier booking, IBP for supply planning."
    ),
    "Sales & Distribution": (
        "Fiori apps: Manage Sales Orders (F-0847), Create Sales Orders (F-0846), "
        "Manage Customer Returns (F-0820), Manage Billing Documents (F-0798). "
        "Gap watchpoints: customer-specific pricing conditions beyond standard condition "
        "technique, advanced available-to-promise requiring aATP scope item, intercompany STO. "
        "Integration: SAP Commerce Cloud for order-to-cash, SAP Ariba for order collaboration."
    ),
    "Human Resources": (
        "Fiori apps: My HR (F-2700), Manage Workforce (F-2702), Time Management (F-2430), "
        "Payroll Control Centre. "
        "Gap watchpoints: country-specific statutory payroll requiring SAP HCM or EC Payroll "
        "activation, complex shift planning beyond standard work schedules, union-specific rules. "
        "Integration: SuccessFactors Employee Central for master data, SAP Concur for T&E."
    ),
    "Asset Management": (
        "Fiori apps: Manage Maintenance Orders (F-2170), Equipment Master (F-2082), "
        "Predictive Maintenance (SAP Asset Intelligence Network), Measuring Points. "
        "Gap watchpoints: IoT-triggered predictive maintenance requires SAP IoT via BTP, "
        "FLOC hierarchy depth beyond 8 levels, complex calibration management. "
        "Integration: OT systems via BTP IoT, SAP Field Service Management for technician scheduling."
    ),
    "Customer Service": (
        "Fiori apps: Manage Service Orders (F-2510), Service Confirmation (F-2512), "
        "Manage Service Contracts (F-2508), SAP Field Service Management integration. "
        "Gap watchpoints: multi-tier SLA escalation beyond standard 3-step, depot repair "
        "via returns management not standard in Cloud PE, complex warranty determination. "
        "Integration: SAP FSM for field technician dispatch, CRM for service ticket creation."
    ),
    "Sourcing & Procurement": (
        "Fiori apps: Manage Purchase Orders (F-0842), Create Purchase Requisitions (F-0843), "
        "Central Purchasing (F-0932), Manage Supplier Evaluations (F-2208). "
        "Gap watchpoints: central purchasing org across company codes not available standard, "
        "complex vendor evaluation beyond 5-criterion model, consignment stock management. "
        "Integration: SAP Ariba / Business Network for supplier collaboration, Fieldglass for services."
    ),
    "R&D & Engineering": (
        "Fiori apps: Manage Engineering Change Orders (F-3208), Manage Bills of Materials (F-1540), "
        "Recipe Management, Document Management (Manage Documents F-3874). "
        "Gap watchpoints: advanced recipe versioning not standard in Cloud PE, multi-level "
        "ECO approval beyond 3 levels, integration with PLM tools. "
        "Integration: SAP Document Management Service via BTP Attachment Service API, "
        "external CAD tools via DMS interface."
    ),
    "IT Management": (
        "Fiori apps: Manage Output (F-5290) for output determination rules per document type; "
        "Manage Form Templates (F-4980) for XFA form customisation and client branding. "
        "Output channels: print, email, fax, EDI, and portal — each requires a separate output "
        "condition record configured in 'Configure Your Solution'. "
        "Sender domain config: Output Management → Default Sender Address — client domain "
        "requires IT/Security sign-off (SPF/DKIM record update). "
        "Gap watchpoints: custom XFA fields beyond standard SAP schema require BTP Forms Service "
        "(Adobe LiveCycle integration); output to non-standard channels (WhatsApp, SMS, external "
        "portal) needs BTP Integration Suite iFlow; high-volume print batches may need external "
        "output management system (OpenText, Ricoh, Readsoft) via scope item 7DJ. "
        "Integration: SAP Cloud Print Manager for direct printer connectivity via IPP protocol; "
        "external OMS connected via SOAP API, REST endpoint, or SAP Cloud Print Manager connector; "
        "certificate and authentication management required per external OMS vendor."
    ),
}


# Second-tier: sub-process specific facts keyed by name fragment (lowercase).
# Activates when a scope item name CONTAINS the key — covers any future item with that pattern.
_SCOPE_NAME_HINTS: dict = {
    "bank guarantee": (
        "Bank Guarantee activates contingent liability accounting. "
        "Fiori: Manage Bank Guarantees in Treasury; config via 'Configure Your Solution' for guarantee type, "
        "valuation area, and number range assignment. "
        "Parallel ledger (Group Ledger US GAAP / IFRS) must be activated before this scope item — "
        "posting rule per transaction type must be configured for each ledger. "
        "Gap: bank-specific guarantee letter format beyond standard SAPscript output; "
        "custom guarantee types not in standard category set need Key User In-App extensibility. "
        "Facilitation focus: confirm whether the client needs one or two parallel ledgers — "
        "that single answer drives whether 2VA and 34F are both required or just one."
    ),
    "general ledger": (
        "General Ledger is the core posting hub for all financial transactions. "
        "Fiori apps: Manage Journal Entries (F-0717), G/L Account Balance (F-0696), "
        "G/L Account Display (F-0697), Post General Journal Entries (F-0719). "
        "Config: chart of accounts assignment, account group, document type, posting period variant, number range. "
        "Gap: legacy GL account structure migration — chart of accounts must match SAP standard grouping; "
        "custom document types beyond standard 3-character key need Key User In-App extensibility. "
        "Facilitate: confirm chart of accounts first — this is the single decision that blocks "
        "all downstream configuration (cost centres, profit centres, tax codes)."
    ),
    "revenue recognition": (
        "Revenue recognition implements IFRS 15 / ASC 606 multi-element contract compliance. "
        "Fiori: Manage Revenue Contracts (F-3849), Manage Performance Obligations (F-3850), "
        "Release Revenue (F-3852), Revenue Accounting Worklist (F-3853). "
        "Config: performance obligation type, standalone selling price methodology (residual / adjusted market), "
        "recognition method (full amount, partial, milestone-based). "
        "Gap: bundled contract SSP allocation requires statistical price model — not standard in Cloud PE; "
        "variable consideration with constraint (usage-based billing) needs BTP calculation service; "
        "contract modification requiring full reversal and re-recognition is a workshop Day 2 item. "
        "Facilitate: open with IFRS 15 five-step model on whiteboard — agreement on which steps "
        "have client-specific interpretations determines the entire gap list."
    ),
    "closing": (
        "Financial closing scope item orchestrates period-end activities. "
        "Fiori: Financial Closing Cockpit (F-2212), Post Period-End Accruals (F-3612), "
        "G/L Balance Carryforward, Manage Reclassifications. "
        "Config: closing cockpit task template, task sequence and dependency, authorization per closing role. "
        "Gap: multi-entity automated closing requires Group Reporting activation (separate scope item); "
        "custom accrual calculation beyond standard periodic posting needs BTP Build Process Automation. "
        "Facilitate: ask how many entities close in parallel — single entity or multi-entity determines "
        "whether Group Reporting is needed and doubles the configuration scope."
    ),
    "intercompany": (
        "Intercompany processes automate billing and reconciliation between company codes. "
        "Fiori: Manage Intercompany Service Orders, Create Intercompany Journal Entries, "
        "Intercompany Reconciliation (F-2216). "
        "Config: company code pair rules, transfer pricing method per pair, AP auto-posting trigger. "
        "Gap: multiple transfer pricing methods across entity pairs — standard supports one method per "
        "document type; cross-border VAT treatment on IC invoices needs tax code per country pair. "
        "Facilitate: map the IC matrix (which entities bill which) before the session — "
        "number of active company code pairs drives configuration volume."
    ),
    "parallel ledger": (
        "Parallel ledger activates multi-GAAP simultaneous posting. "
        "Config: ledger definition (leading local GAAP vs non-leading IFRS/US GAAP), "
        "posting rule assignment per document type, currency type per ledger (company code / group / hard). "
        "Gap: every document type must be explicitly configured for each ledger — "
        "missing assignment causes posting failures; period-end reports must be created per ledger. "
        "Facilitate: confirm which accounting standards are required (local + IFRS, local + US GAAP, or all three) "
        "— each additional standard doubles the parallel accounting configuration scope."
    ),
    "asset": (
        "Asset accounting manages fixed asset lifecycle. "
        "Fiori: Manage Fixed Assets (F-2082), Post Asset Acquisition (F-2086), "
        "Depreciation Simulation (F-2083), Asset Transfer (F-2085). "
        "Config: asset class, depreciation area, depreciation key, useful life, scrap value. "
        "Gap: parallel ledger depreciation requires separate depreciation area per GAAP standard; "
        "asset under construction settlement to final asset needs manual trigger in standard Cloud PE. "
        "Facilitate: ask how many depreciation areas the client currently maintains — "
        "each area maps to one ledger and one depreciation key set."
    ),
    "cash management": (
        "Cash and liquidity management. "
        "Fiori: Cash Position (F-1488), Bank Account Management (F-1484), "
        "Cash Flow Analyser, Manage Payment Runs (F-0760). "
        "Config: bank account hierarchy, house bank assignment, liquidity planning structure. "
        "Gap: Multi-Bank Connectivity activation required for electronic bank statement import "
        "(MT940/CAMT.053) — this is a separate scope item; "
        "real-time cash visibility across subsidiaries requires Group Cash Management activation. "
        "Facilitate: confirm which banks are in scope and whether they support SAP Multi-Bank "
        "Connectivity standard formats — this determines whether manual statement upload is needed."
    ),
    "cost center": (
        "Cost center accounting tracks overhead costs by organisational unit. "
        "Fiori: Manage Cost Centers (F-2036), Cost Center Planning (F-2037), "
        "Actual Cost Line Item (F-2035), Budget Monitoring. "
        "Config: cost center hierarchy (max 10 levels in Cloud PE), allocation cycle definition, "
        "activity type for internal resource charging. "
        "Gap: complex statistical allocation beyond standard percentage split needs BTP calculation; "
        "budget versioning beyond standard 3 versions not supported in standard Cloud PE."
    ),
    "profit center": (
        "Profit center accounting / CO-PA for profitability segment reporting. "
        "Fiori: Manage Profit Centers (F-2037), Profitability Analysis (F-2038). "
        "Config: profit center hierarchy, characteristic derivation rules, account-based vs costing-based CO-PA. "
        "Gap: custom CO-PA characteristics beyond SAP standard set need Key User In-App extensibility; "
        "costing-based CO-PA from legacy ECC not supported in Cloud PE — must migrate to account-based. "
        "Facilitate: ask if client currently uses costing-based CO-PA — "
        "if yes, this is a significant design decision with reporting impact."
    ),
    "accounts payable": (
        "Accounts Payable (AP) manages the full supplier payment cycle. "
        "Fiori apps: Manage Supplier Invoices (F-0776), Create Supplier Invoice (F-0777), "
        "Manage Payment Runs (F-2265), Manage Outgoing Payments (F-0759), "
        "Analyze Outstanding Payables (F-3291), Manage Supplier Line Items (F-0772). "
        "Config: payment terms, tolerance groups per vendor/account group, payment block reasons, "
        "payment medium formats (SEPA/NACHA/SWIFT/DME), house bank assignment, "
        "automatic payment programme (APP) schedule, cash discount grace period. "
        "Gap: payment medium formats beyond standard templates need BTP Document Service; "
        "custom payment block codes beyond standard SAP set need Key User In-App extensibility; "
        "diverse/minority supplier tracking requires BTP extension. "
        "Integration: Multi-Bank Connectivity for electronic bank statement import (MT940/CAMT.053); "
        "SAP Concur for T&E expense reimbursement via invoice posting; "
        "AP → GL automatic posting confirmed per document type configuration. "
        "Facilitate: confirm payment run frequency (weekly/biweekly/daily) first — "
        "this single answer determines whether Multi-Bank Connectivity is mandatory or optional."
    ),
    "accounts receivable": (
        "Accounts Receivable (AR) manages the full customer collection cycle. "
        "Fiori apps: Manage Customer Invoices (F-0798), Manage Incoming Payments (F-0754), "
        "Analyze Outstanding Receivables (F-3290), Manage Dunning (F-0770), "
        "Post Bank Statement (F-0756). "
        "Config: payment terms, tolerance groups per customer, dunning procedure, "
        "account determination for AR postings, credit management rules. "
        "Gap: multi-level dunning beyond standard 4-level procedure needs BTP Process Automation; "
        "credit limit auto-hold across company codes needs Group Reporting + BTP workflow. "
        "Integration: bank statement import via Multi-Bank Connectivity; "
        "SAP Cash Application for automatic payment matching; "
        "downstream FI-GL automatic posting via standard reconciliation account. "
        "Facilitate: ask what percentage of incoming payments are matched automatically today — "
        "this determines whether SAP Cash Application scope item is required."
    ),
    "tax": (
        "Tax management for VAT/GST, withholding tax, and indirect tax compliance. "
        "Fiori apps: Manage Tax Accounts (F-0697), Display Tax Codes (F-0698), "
        "Manage Withholding Tax (F-0699). "
        "Config: tax procedure, tax codes per country, tax jurisdiction, "
        "withholding tax type and code, input/output tax accounts. "
        "Gap: complex multi-state or multi-jurisdiction tax nexus needs BTP Tax Service "
        "(Vertex or Avalara integration); e-invoicing mandates (PEPPOL, CFDI) "
        "need dedicated localisation scope item activation. "
        "Facilitate: confirm which countries are in scope for tax — "
        "each country requires separate localisation activation in Cloud PE."
    ),
    "output management": (
        "Output Management in Cloud PE controls generation and distribution of business documents "
        "(invoices, POs, delivery notes, payment advices) across print, email, EDI, and portal channels. "
        "Fiori apps: Manage Output (F-5290) for output condition rules per document type; "
        "Manage Form Templates (F-4980) for XFA template customisation and client branding. "
        "Config: output condition record per document category, output channel assignment, sender domain "
        "(SPF/DKIM sign-off required from IT/Security for client domain), form template per document type. "
        "BTP extension: SAP Cloud Print Manager for direct printer connectivity via IPP protocol; "
        "BTP Forms Service (Adobe LiveCycle) for custom XFA fields beyond standard SAP schema. "
        "Gap watchpoints: output to non-standard channels (WhatsApp, SMS, external portal) requires "
        "BTP Integration Suite iFlow; high-volume print batches may need external OMS (7DJ scope item). "
        "Facilitate: open with 'Inventory of all business document types and current output channel' — "
        "this one question determines all output condition records and form templates to configure."
    ),
    "document management": (
        "Document Management Service (DMS) provides document attachment and version control "
        "across all business objects in Cloud PE via the BTP Attachment Service API. "
        "Fiori: Manage Documents (F-3874); document types link to object types "
        "(purchase order, maintenance order, engineering change order). "
        "Config: document type definition, status network, classification schema, access control list "
        "per document type; object links per business object type in Configure Your Solution. "
        "Gap watchpoints: advanced version branching beyond standard linear versioning; "
        "external CAD/PDM integration requires custom iFlow for BOM document synchronisation; "
        "document retention enforcement needs BTP Data Management / ILM extension. "
        "Facilitate: confirm which business objects require document attachment — "
        "each object type needs a separate DMS document type and classification configuration."
    ),
    "procurement": (
        "Procurement Fiori apps: Manage Purchase Requisitions (F-1048) — PR creation, "
        "approval workflow, catalogue vs free-text; Manage Purchase Orders (F-0842) — "
        "PO creation, scheduling agreement call-off, vendor selection; "
        "Confirm Service (F-1892) — service entry sheet creation and cost-centre-owner acceptance; "
        "Manage Supplier Invoices (F-0776) — 3-way GR/IR matching, tolerance check, exception handling; "
        "Post Goods Movements (F-0585) — goods receipt and return delivery for project materials. "
        "Config: purchasing organisation, purchasing group, document types, "
        "payment terms, tolerance groups for over/under-delivery, approval hierarchies. "
        "Integration: SAP Ariba Network for supplier collaboration, catalogue punchout, and "
        "e-invoicing via SAP Integration Suite; downstream AP auto-posting on invoice approval. "
        "Gap watchpoints: service entry sheet approval beyond standard 2-level workflow needs "
        "BTP Process Automation; Ariba catalogue punchout requires Ariba Procurement Integration "
        "scope item activation; multi-currency PO where invoice currency differs from PO currency "
        "needs tolerance and exchange-rate-difference config. "
        "Facilitate: open with 'How many purchasing organisations and purchasing groups are needed?' — "
        "this drives org structure, approval workflow, and tolerance configuration scope."
    ),
    "treasury": (
        "Treasury and Cash Management for liquidity and risk management. "
        "Fiori apps: Cash Position (F-1488), Bank Account Management (F-1484), "
        "Manage Bank Accounts (F-1485), Cash Flow Analyser, Manage Hedging. "
        "Config: bank account hierarchy, liquidity planning structure, "
        "exposure category for FX hedging, hedge designation. "
        "Gap: real-time multi-entity cash pooling needs Group Cash Management activation; "
        "complex FX risk management beyond standard hedge accounting needs BTP extension. "
        "Facilitate: confirm the number of active bank accounts and currencies first — "
        "this determines whether Multi-Bank Connectivity is mandatory and which currency types to activate."
    ),
    "fixed assets": (
        "Fixed Assets (AA) manages the full asset lifecycle. "
        "Fiori apps: Manage Fixed Assets (F-2082), Post Asset Acquisition (F-2086), "
        "Depreciation Simulation (F-2083), Asset Transfer (F-2085), Post Disposal (F-2084). "
        "Config: asset class, depreciation area, depreciation key, useful life, chart of depreciation. "
        "Gap: parallel ledger depreciation requires separate depreciation area per GAAP standard; "
        "asset under construction (AuC) settlement to final asset requires manual trigger in Cloud PE. "
        "Facilitate: ask how many depreciation areas the client currently maintains — "
        "each area maps to one ledger and one set of depreciation keys."
    ),
    "group ledger": (
        "Group Ledger activates parallel accounting — multi-GAAP simultaneous posting. "
        "Fiori apps: Manage Journal Entries (F-0717), G/L Account Balance (F-0696), "
        "Post General Journal Entries (F-0719). "
        "Config: non-leading ledger definition for IFRS or US GAAP, currency type per ledger "
        "(company code / group / hard currency), posting rule assignment per document type to each ledger. "
        "Benefits: single posting creates entries in all configured ledgers simultaneously; "
        "separate period-end reports per accounting standard (IFRS / local GAAP / US GAAP); "
        "eliminates manual cross-GAAP reconciliation; supports IFRS 16 lease accounting in parallel. "
        "Gap: every document type needs explicit ledger assignment — missing assignment causes posting "
        "failures; parallel ledger depreciation areas require separate chart of depreciation per standard; "
        "period-end reports per ledger need individual Fiori tile configuration. "
        "Facilitate: confirm how many accounting standards are required — each additional standard "
        "(IFRS, US GAAP, local GAAP) doubles the parallel accounting configuration scope."
    ),
}

# Country-specific LOB hints — {lob_canon: {iso: hint_text}}
# Injected into fact_base when workshop country matches the scope item's LOB.
# Add a new ISO key under the relevant LOB to cover any country/LOB combination.
_COUNTRY_LOB_HINTS: dict = {
    "Finance & Controlling": {
        "IN": (
            "India-specific Finance requirements: "
            "GST mandatory for all B2B and B2C transactions — CGST/SGST/IGST/UTGST tax codes "
            "configured via Manage Tax Codes Fiori app; GST determination rule per tax condition type. "
            "TDS (Tax Deducted at Source) under Income Tax Act: section 194C for contractors, "
            "194J for professionals, 195 for foreign payments — withholding tax type and code per "
            "section configured via Manage Withholding Tax. "
            "E-invoicing via IRP (Invoice Registration Portal): SAP Document Compliance for India "
            "scope item activation required for businesses above INR 10 Crore annual turnover threshold; "
            "IRN generation and QR code stamping handled by standard Cloud PE localisation. "
            "Dual depreciation required: Companies Act 2013 (SLM rates) and Income Tax Act (WDV rates) — "
            "two separate depreciation areas in the chart of depreciation. "
            "Gap watchpoints: complex TDS rate logic by PAN status / threshold may need BTP extension; "
            "GST GSTR-2A reconciliation requires BTP SAP Analytics Cloud reporting add-on."
        ),
        "AU": (
            "Australia-specific Finance requirements: "
            "GST 10% — mandatory for registered businesses on all taxable supplies; tax codes "
            "configured via Manage Tax Codes (tax procedure TAXAU); GST-free and input-taxed "
            "supplies need separate tax codes. "
            "BAS (Business Activity Statement) — quarterly or monthly ATO filing; "
            "SAP Document and Reporting Compliance standard output for BAS; "
            "BAS filing cycle determines period-end closing cutoff dates. "
            "Withholding tax (PAYG) — applies to contractors and foreign payments; "
            "withholding tax type per payment category configured via Manage Withholding Tax. "
            "Superannuation guarantee 11.5% (from 1 July 2024) — employer contribution per "
            "eligible employee; affects payroll cost postings and cost centre planning rates. "
            "Gap watchpoints: state-based payroll tax (NSW 5.45%, VIC 4.85%, QLD 4.75%) must be "
            "tracked per employing entity — no standard Cloud PE report; BTP Analytics Cloud add-on required."
        ),
    },
    "Professional Services": {
        "AU": (
            "Australia-specific Professional Services requirements: "
            "GST 10% on project billing — applies to both time-and-material and fixed-price invoices; "
            "GST tax code on billing document type must be configured per output condition; "
            "GST-free supplies (e.g. export of services) require separate billing condition. "
            "IC invoice GST — intercompany transactions between Australian entities are subject to GST "
            "unless the group has formed a GST group (single representative member); "
            "confirm GST group status before configuring IC billing profiles. "
            "BAS quarterly filing — period-end closing for Professional Services must align with "
            "BAS lodgement dates; project revenue recognition postings must be completed before BAS cutoff. "
            "Superannuation guarantee 11.5% — affects resource cost rates used in project planning "
            "and WBS cost estimation; cost rates in Manage Resource Rates must include super component. "
            "Payroll tax by state — employer cost affecting project profitability; varies by state "
            "(NSW 5.45%, VIC 4.85%, QLD 4.75%); must be included in project rate cards. "
            "Gap watchpoints: project invoices for export-of-services clients need GST-free "
            "billing condition — confirm client's GST registration and supply classification before Realize."
        ),
        "IN": (
            "India-specific Professional Services requirements: "
            "GST on service billing — 18% GST on professional services; SAC code required on "
            "all service invoices; CGST+SGST for intrastate, IGST for interstate billing. "
            "TDS on professional fees — section 194J (10%) on fees paid to professionals; "
            "TCS on project billing may apply for e-commerce operators. "
            "E-invoicing (IRP) — mandatory for PS companies above INR 10 Crore turnover; "
            "IRN on project invoices generated via SAP Document Compliance for India. "
            "Gap watchpoints: SAC code determination per service type needs Key User In-App "
            "extensibility if standard SAP service master classification is insufficient."
        ),
    },
    "Asset Management": {
        "DE": (
            "Germany-specific Asset Management requirements: "
            "GoBD compliance — maintenance and inspection records are commercial documents "
            "requiring retention for 10 years (GoBD §147 AO); records must be machine-readable and "
            "audit-proof — use SAP Document Management Service for structured attachment. "
            "WEEE directive — asset disposal records for electrical/electronic equipment must capture "
            "waste classification and disposal route; configure in Manage Fixed Assets (F-2082). "
            "Gap watchpoints: GoBD-compliant archiving for maintenance order documents needs "
            "SAP Document Access (ILM) or BTP Data Management — confirm with client's tax/legal team."
        ),
        "AU": (
            "Australia-specific Asset Management requirements: "
            "Work Health and Safety (WHS) Act 2011 — maintenance orders for safety-critical equipment "
            "(pressure vessels, lifting equipment, electrical) must include safety inspection records; "
            "WorkSafe compliance checklists should be captured via maintenance order notification. "
            "Superannuation guarantee 11.5% (from 1 July 2024) — technician cost rates used in "
            "maintenance order costing must include superannuation component; validate via Manage "
            "Work Centers (F-1537) cost rate configuration. "
            "Gap watchpoints: state-based WorkSafe certification tracking is not standard in Cloud PE "
            "— use SAP Document Management Service for certificate attachment per equipment."
        ),
        "IN": (
            "India-specific Asset Management requirements: "
            "GST on maintenance services — 18% GST on repair and maintenance contracts; "
            "tax code per vendor invoice type configured via Manage Tax Codes; "
            "input tax credit on maintenance POs recoverable for registered entities. "
            "TDS on maintenance contractors — section 194C (1%/2%) on contractor payments above "
            "INR 30,000 per transaction or INR 1 Lakh annual threshold; withholding tax type "
            "per contractor category configured via Manage Withholding Tax. "
            "Gap watchpoints: HSN code determination on maintenance purchase orders may need "
            "Key User In-App extensibility if standard material group classification is insufficient."
        ),
    },
    "Human Resources": {
        "DE": (
            "Germany-specific Human Resources requirements: "
            "DSGVO (GDPR in Germany) — employee personal data processing requires documented "
            "legal basis per Art. 6 DSGVO; HR data retention schedules vary by record type "
            "(payroll records 10 years, time records 2 years); configure via SAP IAS privacy settings. "
            "Works Council (Betriebsrat) co-determination — structural org changes (cost centre "
            "reassignment, shift model changes) require Betriebsrat approval before Realize config; "
            "confirm consultation timeline with client's HR/Legal team before sprint planning. "
            "German payroll specifics: social insurance contributions (KV/PV/RV/AV), "
            "DEÜV reporting via SAP Document and Reporting Compliance; ELSTER tax filing integration. "
            "Gap watchpoints: complex Betriebsvereinbarung (works agreement) rules for time "
            "recording may exceed standard Cloud PE work schedule variants."
        ),
        "AU": (
            "Australia-specific Human Resources requirements: "
            "Fair Work Act 2009 — termination, redundancy pay, and notice periods must comply; "
            "annual leave loading (17.5%) and public holiday pay vary by award/enterprise agreement; "
            "these affect payroll configuration in SAP SuccessFactors Employee Central Payroll. "
            "Single Touch Payroll Phase 2 (STP2) — ATO mandatory employer reporting of payroll data "
            "per pay event; SAP Document and Reporting Compliance handles STP2 submission; "
            "verify STP2 activation status in the cloud PE tenant before Realize. "
            "Superannuation guarantee 11.5% — employer super contribution per eligible employee; "
            "super fund choice must be implemented; SuperStream standard for contribution payments. "
            "Gap watchpoints: complex Modern Award interpretation for casual/part-time employees "
            "may require BTP Process Automation for leave entitlement calculation."
        ),
        "IN": (
            "India-specific Human Resources requirements: "
            "Provident Fund (PF) — 12% employer contribution on basic salary; monthly ECR filing "
            "with EPFO via SAP Document and Reporting Compliance; PF applicable for all employees "
            "drawing salary ≤ INR 15,000 (mandatory) or above (voluntary). "
            "Employee State Insurance (ESI) — 3.25% employer + 0.75% employee contribution for "
            "employees drawing ≤ INR 21,000/month; ESI challan via SAP payroll integration. "
            "Professional Tax — state-specific (varies from 0 to INR 2,500/year); configure per "
            "employing state via payroll tax code in SAP SuccessFactors Employee Central Payroll. "
            "Gratuity — Payment of Gratuity Act 1972: 15/26 days × years of service for employees "
            "with ≥ 5 years; accrual posting to provision account via standard payroll posting. "
            "Gap watchpoints: complex PF trust management (exempted establishments) not standard "
            "in Cloud PE — requires BTP extension or third-party payroll integration."
        ),
    },
}


# ── COVER SLIDE ───────────────────────────────────────────────────────────────

def _cover(prs, meta: dict, scope_count: int, brand: RGBColor, lob_label: str = ""):
    sl = _blank(prs)

    # Dark purple full background
    bg = sl.background.fill
    bg.solid(); bg.fore_color.rgb = _AC_DARK

    # Bright purple circle — top right decoration
    cir = sl.shapes.add_shape(9, Inches(10.8), Inches(-1.5), Inches(4.5), Inches(4.5))
    cir.fill.solid(); cir.fill.fore_color.rgb = _AC_MID
    cir.line.fill.background()

    # Second smaller circle
    cir2 = sl.shapes.add_shape(9, Inches(11.9), Inches(4.8), Inches(2.2), Inches(2.2))
    cir2.fill.solid(); cir2.fill.fore_color.rgb = brand
    cir2.line.fill.background()

    # Left white accent stripe
    stripe = sl.shapes.add_shape(1, Inches(0), Inches(0), Inches(0.08), Inches(7.5))
    stripe.fill.solid(); stripe.fill.fore_color.rgb = _WHITE
    stripe.line.fill.background()

    # ">" Accenture logo mark
    _tx(sl, 0.25, 0.55, 1.5, 1.2, ">", size=60, bold=True,
        color=brand, align=PP_ALIGN.LEFT)

    client    = meta.get("clientName", "[Client Name]")
    title     = meta.get("workshopTitle", "Fit-to-Standard Workshop")
    facilitator = meta.get("facilitator", "")
    ws_date   = meta.get("workshopDate", date.today().strftime("%d %B %Y"))
    _default_rel, _default_rel_label = current_sap_release()
    release   = meta.get("release", _default_rel)
    _raw_c = meta.get("countries") or ([meta.get("country")] if meta.get("country") else [])
    country_display = " / ".join(c.strip().title() for c in _raw_c if c.strip())

    _tx(sl, 1.4,  0.72, 10.0, 0.42, "ACCENTURE", size=13, bold=True, color=_WHITE)
    _tx(sl, 0.25, 1.55, 10.2, 1.55, title, size=36, bold=True, color=_WHITE)
    subtitle = f"SAP S/4HANA Cloud Public Edition  ·  Release {release}"
    if country_display:
        subtitle += f"  ·  {country_display}"
    _tx(sl, 0.25, 3.2,  10.0, 0.48, subtitle, size=12, color=_AC_LIGHT)
    _tx(sl, 0.25, 3.82, 10.0, 0.52, client, size=18, bold=True, color=_WHITE)

    # Stats row — "N Scope Items · LOB" (or "N Lines of Business" for mixed decks)
    _scope_label = f"{scope_count} Scope Item{'s' if scope_count != 1 else ''}"
    if lob_label:
        _scope_label += f"  ·  {lob_label}"
    _tx(sl, 0.25, 4.5, 6.0, 0.38, _scope_label, size=11, color=_AC_LIGHT)
    if facilitator:
        _tx(sl, 0.25, 4.93, 6.0, 0.38, f"Facilitator:  {facilitator}", size=11, color=_AC_LIGHT)
    _tx(sl, 0.25, 5.36, 6.0, 0.38, ws_date, size=11, color=_AC_LIGHT)

    # Bottom bar
    _rect(sl, 0.0, 7.05, 13.33, 0.45, _AC_PURPLE)
    _tx(sl, 0.3, 7.09, 12.7, 0.36,
        "Accenture · SAP Business Group · Explore Phase Accelerator",
        size=9, color=_WHITE, align=PP_ALIGN.LEFT)


# ── SECTION DIVIDER SLIDE ─────────────────────────────────────────────────────

def _divider(prs, lob: str, scope_id: str, scope_name: str, footer: str, brand: RGBColor):
    """Full-purple section break slide between scope packages."""
    sl = _blank(prs)
    bg = sl.background.fill
    bg.solid(); bg.fore_color.rgb = _AC_DARK

    # Large ">" mark
    _tx(sl, 0.3, 1.5, 4.0, 3.5, ">", size=140, bold=True,
        color=brand, align=PP_ALIGN.LEFT)

    # LOB badge
    _rect(sl, 5.0, 2.4, 2.5, 0.42, brand)
    _tx(sl, 5.05, 2.43, 2.4, 0.36, lob.upper(), size=9, bold=True,
        color=_WHITE, align=PP_ALIGN.CENTER)

    _tx(sl, 5.0, 3.0, 8.0, 0.42, scope_id, size=14, bold=True, color=brand)
    _tx(sl, 5.0, 3.5, 8.0, 1.4, scope_name, size=28, bold=True, color=_WHITE)
    _tx(sl, 5.0, 5.1, 8.0, 0.38,
        "Fit-to-Standard Workshop  ·  Process Walkthrough & Decision Capture",
        size=11, italic=True, color=_AC_LIGHT)

    _footer(sl, footer)


# ── FIXED SLIDES ──────────────────────────────────────────────────────────────

def _agenda(prs, footer: str, scope_count: int, lob_count: int, brand: RGBColor):
    _bullets(prs, "Agenda", "Today's Agenda", [
        f"Scope overview — {scope_count} scope item{'s' if scope_count != 1 else ''} across {lob_count} line{'s' if lob_count != 1 else ''} of business",
        "Fit-to-Standard approach — Cloud PE standard process walkthroughs per scope",
        "BDCQ review — L1 critical & L2 important configuration questions per scope",
        "Decision capture — Fit / Partial Fit / Gap classification with owner & due date",
        "Design Decision Log — KDD entries confirmed and signed off in real time",
        "RICEFW / extensibility register — Gap items prioritised, BTP approach agreed",
        "Next steps, Cloud ALM update, and session close",
    ], footer, brand=brand)


def _pre_workshop(prs, footer: str, scope_items: list, bdcq_idx: dict, brand: RGBColor):
    sl = _blank(prs)
    _header(sl, "Preparation", "Pre-Workshop Activities & Readiness", footer, brand)

    _tx(sl, 0.3, 1.70, 12.7, 0.35,
        "Complete BDCQ pre-answers and confirm process owners before the session.  "
        "L1 questions (critical) must be discussed — come prepared.",
        size=10, italic=True, color=_MUTED)

    rows = []
    for item in scope_items:
        sid  = item.get("id", "")
        qs   = bdcq_idx.get(sid, [])
        l1   = sum(1 for q in qs if q.get("level") == "L1")
        l2   = sum(1 for q in qs if q.get("level") == "L2")
        l3   = sum(1 for q in qs if q.get("level") == "L3")
        total = l1 + l2 + l3
        l1_s  = str(l1)  if total else "—"
        l2_s  = str(l2)  if total else "—"
        l3_s  = str(l3)  if total else "—"
        tot_s = str(total) if total else "—"
        status = "Not started" if total else "BDCQ not loaded"
        nm = item.get("name", "")
        nm_disp = nm if len(nm) <= 55 else nm[:53].rsplit(" ", 1)[0] + "…"
        rows.append([sid, nm_disp, item.get("lob", ""),
                     l1_s, l2_s, l3_s, tot_s, status])

    if rows:
        tbl = _table(sl, 2.15,
               [0.9, 5.2, 2.4, 0.6, 0.6, 0.6, 0.7, 1.7],
               ["ID", "Scope Item", "LOB", "L1 ⚑", "L2", "L3", "Total", "Pre-answer Status"],
               rows, brand)

    # Warning if any scope lacks BDCQ
    bdcq_missing = [item.get("id","") for item in scope_items
                    if not bdcq_idx.get(item.get("id",""))]
    note_y = 2.2 + 0.38 * (len(rows) + 1) + 0.18
    if bdcq_missing:
        _rect(sl, 0.3, note_y, 12.7, 0.34, RGBColor(0xFF, 0xF3, 0xCC))
        _tx(sl, 0.42, note_y + 0.04, 12.4, 0.26,
            f"⚠  BDCQ not yet loaded for: {', '.join(bdcq_missing)}  —  "
            "scan from SAP Roadmap Viewer via the Chrome extension before the workshop",
            size=8.5, color=RGBColor(0x7B, 0x60, 0x00))
        note_y += 0.40

    # Flag when L1 (critical) count is zero across all loaded items — likely a data note
    no_l1_ids = [item.get("id","") for item in scope_items
                 if bdcq_idx.get(item.get("id",""))
                 and not any(q.get("level") == "L1" for q in bdcq_idx.get(item.get("id",""), []))]
    if no_l1_ids:
        _rect(sl, 0.3, note_y, 12.7, 0.34, RGBColor(0xE8, 0xF4, 0xFF))
        _tx(sl, 0.42, note_y + 0.04, 12.4, 0.26,
            f"ℹ  No L1 (critical) BDCQ questions found for: {', '.join(no_l1_ids)}  —  "
            "confirm with SAP whether L1 questions apply; all loaded questions shown as L2/L3.",
            size=8.5, color=RGBColor(0x00, 0x4A, 0x8A))
        note_y += 0.40

    for b in [
        "Review the SAP S/4HANA Cloud standard demo in the trial tenant before the session",
        "Identify and confirm process owners for all scope items — every role must be present",
        "Bring current-state process documentation and any known exception requirements",
    ]:
        _tx(sl, 0.45, note_y, 12.5, 0.40, f"•  {b}", size=10, color=_INK)
        note_y += 0.42


def _participants(prs, footer: str, facilitator: str, process_owner: str, brand: RGBColor):
    sl = _blank(prs)
    _header(sl, "People", "Participant Introduction", footer, brand)
    _tx(sl, 0.3, 1.71, 12.5, 0.28,
        "Confirm names and contacts before the session — all roles should be represented.",
        size=10, italic=True, color=_MUTED)
    _table(sl, 2.05, [3.8, 5.8, 3.2], ["Role", "Name", "Contact / Notes"], [
        ["Facilitator (Accenture)",   facilitator   or "TBC", ""],
        ["Customer Process Owner",    process_owner or "TBC", ""],
        ["IT / Technical Lead",       "TBC", ""],
        ["Business SME",              "TBC", ""],
        ["Data Migration Lead",       "TBC", ""],
        ["Change Management Lead",    "TBC", ""],
    ], brand)


def _guidelines(prs, footer: str, brand: RGBColor):
    _bullets(prs, "Guidelines", "Workshop Guidelines", [
        "SAP S/4HANA Cloud Public Edition is the standard — we configure, not customise",
        "Decisions are Fit / Partial Fit / Gap — each must have a named owner and due date",
        "No ABAP, user exits, or BAdIs — extensions use Key User In-App or BTP side-by-side",
        "Gaps trigger a RICEFW entry — business value must be justified before approval",
        "Parking lot items are reviewed at session close and assigned offline",
        "Decisions are logged in real time in the KDD log and Cloud ALM",
    ], footer, brand=brand)


def _approach(prs, footer: str, brand: RGBColor):
    _bullets(prs, "Approach", "Fit-to-Standard Execution Approach", [
        "Step 1 — Demonstrate: SAP consultant walks the end-to-end standard process in the demo tenant",
        "Step 2 — Explore: Team reviews BDCQ L1 and L2 questions and identifies deviations",
        "Step 3 — Decide: Each question is classified Fit / Partial Fit / Gap with owner and date",
        "Step 4 — Configure: Fit items proceed to Realize phase guided configuration",
        "Step 5 — Extend: Gaps are prioritised — BTP or Key User In-App extensibility evaluated",
        "Step 6 — Validate: KDD log approved by process owner; Cloud ALM updated",
    ], footer, brand=brand)


def _outcomes(prs, footer: str, brand: RGBColor):
    _bullets(prs, "Outcomes", "Expected Workshop Outcomes", [
        "Agreed scope baseline — every process confirmed in-scope or de-scoped with rationale",
        "Complete BDCQ questionnaire — every L1 and L2 question answered with decision and owner",
        "Updated KDD log — Fit / Partial Fit / Gap per design question with rationale",
        "RICEFW register initiated — all Gap items captured with category and BTP flag",
        "Data migration and integration touchpoints confirmed per scope item",
        "Open actions with owners and due dates — Realize phase entry criteria",
        "Cloud ALM task list updated as input to the Realize phase kick-off",
    ], footer, brand=brand)


def _scope_overview(prs, footer: str, scope_items: list, brand: RGBColor):
    def _abbr(name: str, limit: int = 78) -> str:
        if len(name) <= limit:
            return name
        return name[:limit - 1].rstrip(" –-") + "…"
    rows = [[s.get("id",""), _abbr(s.get("name","")), s.get("lob",""), s.get("l2","")]
            for s in scope_items]
    _paginated(prs, "Scope", "Workshop Scope Items", footer,
               ["ID", "Scope Item", "Line of Business", "Sub-Function"],
               [1.0, 6.5, 3.0, 2.3], rows, brand=brand, max_rows=14)


# ── PER-SCOPE SLIDES ──────────────────────────────────────────────────────────

def _identity(prs, footer: str, item: dict, parsed: dict, brand: RGBColor,
              bdcq_count: int = 0, kdd_count: int = 0):
    sl = _blank(prs)
    sid   = item.get("id", "")
    sname = item.get("name", "")
    # Prefer the f2s-index L1 over catalog LOB; normalize so catalog values like
    # "Solutions for Specific Industries" map to the correct canonical LOB name.
    lob   = _norm_lob(parsed.get("l1") or item.get("lob", ""))
    _header(sl, f"{lob}  ·  Scope Item Overview", f"{sid} — {sname}", footer, brand)

    # ── LEFT: overview + benefits (cols 0.3 → 8.8) ───────────────────────────
    overview  = parsed.get("overview", "")
    benefits  = parsed.get("benefits", [])

    # Supplement sparse benefit lists from the overview — only use outcome sentences,
    # not definitional sentences (e.g. "X provides a comprehensive overview of..." is
    # a description, not a business benefit).
    _BENEFIT_WORDS = re.compile(
        r"\b(enables|ensures|reduces|eliminates|automates|improves|accelerates|"
        r"optimis|streamlines|provides visibility|allows|supports compliance|"
        r"lowers|saves|increases|drives|delivers)\b", re.IGNORECASE)
    _DESCRIPTION_START = re.compile(
        r"^(the central tasks|this solution|the \w+ company\b|the affiliate\b|"
        r"[a-z ]+ provides a comprehensive|[a-z ]+ serves as|[a-z ]+ is the central)",
        re.IGNORECASE)

    # Filter benefits that are description sentences reworded — first-8-word prefix match
    # and description-start pattern both indicate a benefit is lifted from the overview.
    # Also drop benefits ending with ellipsis — these are truncated at source and would
    # display as incomplete sentences on the slide (applies to any scope item).
    _ov_words8 = " ".join(overview.lower().split()[:8])
    _orig_benefit_count = len(benefits)
    benefits = [
        b for b in benefits
        if not _DESCRIPTION_START.match(b.strip())
        and " ".join(b.lower().split()[:8]) != _ov_words8
        and not b.rstrip().endswith("…")
        and not b.rstrip().endswith("...")
    ]
    if not benefits and _orig_benefit_count:
        benefits = []  # caller will fall through to supplementation from overview

    if len(benefits) < 2 and overview:
        extra_sentences = [
            s.strip() for s in re.split(r"[.;]", overview)
            if len(s.strip()) > 35
            and s.strip() not in benefits
            and _BENEFIT_WORDS.search(s)
            and not _DESCRIPTION_START.match(s.strip())
        ]
        benefits = benefits + extra_sentences[: max(0, 3 - len(benefits))]
    _tx(sl, 0.3, 1.74, 8.45, 1.30, overview, size=10, color=_INK)

    if benefits:
        _rect(sl, 0.3, 3.12, 8.45, 0.28, brand)
        _tx(sl, 0.38, 3.14, 8.1, 0.24,
            "BUSINESS BENEFITS — SAP S/4HANA CLOUD STANDARD",
            size=7.5, bold=True, color=_WHITE)
        # Scale font to fit all benefits in available space (~3.3" height)
        n       = len(benefits)
        b_size  = max(8.0, min(9.5, 9.5 - (n - 5) * 0.25)) if n > 5 else 9.5
        b_step  = max(0.30, min(0.39, 3.2 / max(n, 1)))
        y = 3.45
        for b in benefits:
            if y > 6.60:
                _tx(sl, 0.42, y, 8.3, 0.30,
                    f"+{len(benefits) - benefits.index(b)} more — see SAP Help Portal",
                    size=8, italic=True, color=_MUTED)
                break
            b_disp = _sent_case(b if len(b) <= 92 else b[:90].rsplit(" ", 1)[0] + "…")
            _tx(sl, 0.42, y, 8.3, b_step + 0.02, f"✓  {b_disp}", size=b_size, color=_INK)
            y += b_step

    # ── RIGHT: AT A GLANCE stats panel (9.05 → 13.03) ────────────────────────
    _rect(sl, 9.05, 1.73, 4.05, 0.30, _AC_DARK)
    _tx(sl, 9.13, 1.75, 3.85, 0.26, "AT A GLANCE", size=8.5, bold=True, color=_WHITE)

    def _stat(l, t, val, label, bg, text_col=_WHITE):
        _rect(sl, l, t, 1.88, 1.08, bg)
        _tx(sl, l, t + 0.06, 1.88, 0.65, str(val),
            size=34, bold=True, color=text_col, align=PP_ALIGN.CENTER)
        _tx(sl, l, t + 0.72, 1.88, 0.30, label,
            size=7.5, bold=True, color=text_col, align=PP_ALIGN.CENTER)

    step_count = len(parsed.get("flow_steps", []))
    _stat(9.05, 2.08, step_count,  "L5 Process Steps",  brand)
    _stat(11.08, 2.08, len(benefits), "Benefits",        _AC_MID)
    _stat(9.05, 3.30, bdcq_count or "—", "BDCQ Questions",
          _GREEN if bdcq_count else _MUTED)
    _stat(11.08, 3.30, kdd_count or "—", "KDD Items Cached",
          RGBColor(0xC0, 0x7C, 0x00) if kdd_count else _MUTED)

    # L2 sub-domain label — only display when it resolves to a canonical LOB AND differs
    # from the primary LOB. Suppresses catch-all values like "Solutions for Specific
    # Industries" that confuse clients when they appear as a LOB-style tag.
    l2_raw  = parsed.get("l2", "")
    l2_norm = _norm_lob(l2_raw) if l2_raw else ""
    l2_disp = l2_norm if (l2_norm in _CANONICAL_LOBS and l2_norm != lob) else ""
    if l2_disp:
        _tx(sl, 9.05, 4.46, 4.05, 0.26, l2_disp, size=8.5, italic=True, color=_MUTED)

    # Deprecation warning — fires for any scope item whose description contains deprecation
    # language (regex _DEPRECATION_RE). Renders in the right panel below the stats so it
    # is impossible to miss. The overview text on the left already contains the specific
    # successor details; this box makes the urgency visually prominent.
    if _DEPRECATION_RE.search(overview):
        _WARN_AMBER = RGBColor(0xC0, 0x50, 0x00)
        _rect(sl, 9.05, 4.60, 4.05, 0.26, _WARN_AMBER)
        _tx(sl, 9.13, 4.63, 3.85, 0.21,
            "⚠  DEPRECATION NOTICE", size=7.5, bold=True, color=_WHITE)
        _rect(sl, 9.05, 4.86, 4.05, 1.50, RGBColor(0xFF, 0xF0, 0xE0))
        _tx(sl, 9.13, 4.90, 3.85, 1.42,
            "SAP has deprecated this scope item. "
            "If it has not yet been activated in your system, "
            "activate the successor scope item instead. "
            "Confirm activation status with your SAP consultant "
            "before this workshop proceeds.",
            size=8.5, color=RGBColor(0x60, 0x20, 0x00))

    # Context note when this scope item has very few L5 steps (activation items)
    flow_steps_count = len(parsed.get("flow_steps", []))
    if flow_steps_count < 2:
        _rect(sl, 0.3, 4.55, 8.45, 0.32, RGBColor(0xE8, 0xF4, 0xFF))
        _tx(sl, 0.42, 4.57, 8.2, 0.26,
            f"ℹ  {sid} is an activation scope item — it enables {sname} capability "
            "alongside primary processes rather than defining its own standalone workflow.",
            size=8, color=RGBColor(0x00, 0x4A, 0x8A))

    # Bottom tag
    _rect(sl, 0.3, 6.85, 2.3, 0.32, brand)
    _tx(sl, 0.38, 6.87, 2.15, 0.26, lob, size=8.5, bold=True, color=_WHITE)
    _tx(sl, 2.75, 6.87, 10.1, 0.26,
        "SAP S/4HANA Cloud Public Edition — configuration via Fiori apps and SAP BTP only",
        size=8, italic=True, color=_MUTED)


def _process_flow(prs, footer: str, item: dict, flow_steps: list, brand: RGBColor):
    sl = _blank(prs)
    sid   = item.get("id", "")
    sname = item.get("name", "")
    _header(sl, sname, f"L5 Process Steps — {sid}", footer, brand)

    if not flow_steps:
        _tx(sl, 0.3, 1.85, 12.5, 0.6,
            "Process steps available in SAP Process Navigator and SAP S/4HANA Cloud Help Portal. "
            "Review with the SAP consultant during the demo walkthrough.",
            size=11, italic=True, color=_MUTED)
        return

    # Detect sub-process boundaries: when a step's normalised text has appeared before,
    # a new sub-process is starting. Track how many sub-processes exist for the footer note.
    _seen_norms: set = set()
    _sp_starts:  set = set()
    for _i, _s in enumerate(flow_steps):
        _norm = re.sub(r"\s+", " ", _s.lower().strip())
        if _norm in _seen_norms:
            _sp_starts.add(_i)
        _seen_norms.add(_norm)
    _sp_count = 1 + len(_sp_starts)

    # Per-step sub-process index (0-based) — drives color assignment per group
    _step_sp_idx: list = []
    _cur_sp = 0
    for _i in range(len(flow_steps)):
        if _i in _sp_starts:
            _cur_sp += 1
        _step_sp_idx.append(_cur_sp)

    # One distinct color per sub-process group (cycles if more than 4)
    _SP_COLORS = [_AC_DARK, brand, RGBColor(0x0D, 0x6E, 0x4A), RGBColor(0x7B, 0x1F, 0x1F)]

    # Visual connected-box layout — 4 boxes per row, up to 3 rows (12 shown)
    overflow = len(flow_steps) - 12
    steps    = flow_steps[:12]
    PER_ROW = 4
    BOX_W   = 2.75
    BOX_H   = 0.95
    ARR_W   = 0.22
    ROW_GAP = 0.28
    START_Y = 1.75

    total_row_w = PER_ROW * BOX_W + (PER_ROW - 1) * ARR_W
    start_x = (13.33 - total_row_w) / 2

    box_rows = [steps[i:i + PER_ROW] for i in range(0, len(steps), PER_ROW)]

    for ri, row in enumerate(box_rows[:3]):
        y = START_Y + ri * (BOX_H + ROW_GAP)

        for ci, step in enumerate(row):
            abs_idx  = ri * PER_ROW + ci
            step_num = abs_idx + 1
            sp_idx   = _step_sp_idx[abs_idx] if abs_idx < len(_step_sp_idx) else 0
            box_col  = _SP_COLORS[sp_idx % len(_SP_COLORS)]
            x = start_x + ci * (BOX_W + ARR_W)

            _rect(sl, x, y, BOX_W, BOX_H, _AC_ALT)               # card bg
            _rect(sl, x, y, BOX_W, 0.07, box_col)                 # top accent stripe
            _rect(sl, x + 0.08, y + 0.13, 0.32, 0.28, box_col)   # step number badge
            _tx(sl, x + 0.08, y + 0.13, 0.32, 0.28,
                str(step_num), size=8, bold=True,
                color=_WHITE, align=PP_ALIGN.CENTER)
            _tx(sl, x + 0.46, y + 0.11, BOX_W - 0.54, BOX_H - 0.18,
                step, size=8.5, color=_INK)
            if ci < len(row) - 1:
                _tx(sl, x + BOX_W + 0.03, y + 0.32, 0.16, 0.35,
                    "▶", size=10, color=box_col, align=PP_ALIGN.CENTER)

        if ri < len(box_rows) - 1:
            end_x = start_x + len(row) * BOX_W + (len(row) - 1) * ARR_W - 0.12
            _tx(sl, end_x, y + BOX_H + 0.02, 0.32, 0.24,
                "↓", size=12, color=_MUTED, align=PP_ALIGN.CENTER)

    sp_note = (f"  ·  {_sp_count} sub-processes detected — colour groups indicate each sub-process"
               if _sp_count > 1 else "")
    overflow_note = (f"  ·  +{overflow} further steps not shown — see SAP Process Navigator"
                     if overflow > 0 else "")
    _tx(sl, 0.3, 7.06, 12.7, 0.22,
        f"Source: SAP S/4HANA Cloud PE Process Catalog  ·  "
        f"Verify sequence with SAP consultant during the demo walkthrough{sp_note}{overflow_note}",
        size=7.5, italic=True, color=_MUTED)


def _workshop_brief(prs, footer: str, item: dict, brief: dict, brand: RGBColor):
    """Claude-generated workshop intelligence — 2-column magazine layout."""
    sl = _blank(prs)
    sid   = item.get("id", "")
    _header(sl, "AI Workshop Intelligence",
            f"Workshop Preparation Guide — {sid}", footer, brand)

    # ── ROW 1: What SAP Delivers (full width, 2-col bullets) ─────────────────
    _rect(sl, 0.3, 1.73, 12.73, 0.27, _AC_DARK)
    _tx(sl, 0.40, 1.74, 12.4, 0.23,
        "▶  WHAT SAP S/4HANA CLOUD PUBLIC EDITION DELIVERS — STANDARD CONFIGURATION",
        size=7.5, bold=True, color=_WHITE)

    delivers = brief.get("standard_delivers", [])[:4]
    for i, d in enumerate(delivers):
        cx = 0.38 + (i % 2) * 6.4
        cy = 2.05 + (i // 2) * 0.42
        _tx(sl, cx, cy, 6.25, 0.39, f"✓  {d}", size=9.5, color=_INK)

    # ── ROW 2: Two-column — Gap Watch-points | Config Areas ──────────────────
    COL_Y = 2.95

    # LEFT — Gap Watchpoints (red header)
    _rect(sl, 0.3,  COL_Y, 6.30, 0.27, RGBColor(0xA0, 0x1C, 0x1C))
    _tx(sl, 0.38, COL_Y + 0.03, 6.0, 0.21,
        "⚠  LIKELY GAP WATCH-POINTS — EXTENSION RISK", size=7.5, bold=True, color=_WHITE)
    gy = COL_Y + 0.32
    for g in brief.get("gap_watchpoints", [])[:3]:
        _rect(sl, 0.30, gy, 0.10, 0.38, RGBColor(0xA0, 0x1C, 0x1C))   # left accent bar
        _tx(sl, 0.46, gy + 0.02, 6.08, 0.38, g, size=9.5, color=_INK)
        gy += 0.43

    # RIGHT — Config Areas (blue header)
    _BLUE = RGBColor(0x1A, 0x6F, 0xB3)
    _rect(sl, 6.75, COL_Y, 6.28, 0.27, _BLUE)
    _tx(sl, 6.83, COL_Y + 0.03, 6.0, 0.21,
        "⚙  CONFIGURATION AREAS — FIORI / SAP BTP", size=7.5, bold=True, color=_WHITE)
    cy = COL_Y + 0.32
    for c in brief.get("config_areas", [])[:3]:
        _rect(sl, 6.75, cy, 0.10, 0.38, _BLUE)
        _tx(sl, 6.91, cy + 0.02, 6.06, 0.38, c, size=9.5, color=_INK)
        cy += 0.43

    # ── ROW 3: Integration Points (full width, green) ─────────────────────────
    INT_Y = max(gy, cy) + 0.08
    _TEAL = RGBColor(0x0D, 0x6E, 0x4A)
    int_items = brief.get("integration_points", [])[:2]
    if int_items and INT_Y < 5.6:
        _rect(sl, 0.3, INT_Y, 12.73, 0.27, _TEAL)
        _tx(sl, 0.40, INT_Y + 0.03, 12.4, 0.21,
            "⇄  INTEGRATION TOUCHPOINTS — CONFIRM IN WORKSHOP",
            size=7.5, bold=True, color=_WHITE)
        iy = INT_Y + 0.32
        for it in int_items:
            _tx(sl, 0.55, iy, 12.4, 0.38, f"→  {it}", size=9.5, color=_INK)
            iy += 0.40
        INT_Y = iy

    # ── BOTTOM STRIP: Facilitator Tips (warm amber band) ─────────────────────
    tips = brief.get("facilitation_tips", [])[:3]
    TIP_Y = max(INT_Y + 0.06, 5.82)
    if TIP_Y < 6.65 and tips:
        _rect(sl, 0.3, TIP_Y, 12.73, 0.27, RGBColor(0xFF, 0xEE, 0xCC))
        _tx(sl, 0.40, TIP_Y + 0.03, 2.0, 0.21,
            "💡 FACILITATOR TIPS", size=7.5, bold=True,
            color=RGBColor(0x7B, 0x60, 0x00))
        _tx(sl, 2.50, TIP_Y + 0.03, 10.4, 0.21,
            "  ·  ".join(tips), size=8.5, color=RGBColor(0x4A, 0x38, 0x00))


def _bdcq_no_data(prs, footer: str, item: dict, brand: RGBColor):
    """Placeholder BDCQ slide shown when no questions were loaded for this scope item."""
    sl = _blank(prs)
    sid   = item.get("id", "")
    sname = item.get("name", "")
    _header(sl, sname, f"BDCQ — {sid} (Not Yet Loaded)", footer, brand)
    _tx(sl, 0.3, 1.71, 12.5, 0.28,
        "BDCQ questions have not been loaded for this scope item — "
        "use the Chrome extension to scan from SAP Roadmap Viewer before the workshop.",
        size=10, italic=True, color=_MUTED)
    _rect(sl, 0.3, 2.15, 12.73, 0.34, RGBColor(0xFF, 0xF3, 0xCC))
    _tx(sl, 0.42, 2.19, 12.40, 0.26,
        f"⚠  BDCQ not loaded for {sid} — open SAP Roadmap Viewer → Explore phase → "
        "Accelerators tab → Chrome extension → Scan → Save BDCQ Files",
        size=9, bold=True, color=RGBColor(0x7B, 0x60, 0x00))
    bullets = [
        "Open SAP Roadmap Viewer and navigate to the Explore phase for your SAP release",
        "Click the Accelerators tab and find the Business Driven Configuration Questionnaire (BDCQ)",
        f"Filter by scope item {sid} — {sname}",
        "Use the Chrome extension: Scan → Save BDCQ Files → save to this project folder",
        "Re-generate the deck to include the full BDCQ question set for this scope item",
    ]
    y = 2.65
    for b in bullets:
        _tx(sl, 0.50, y, 12.5, 0.40, f"•  {b}", size=10, color=_INK)
        y += 0.44


def _bdcq_slide(prs, footer: str, item: dict, questions: list, brand: RGBColor):
    if not questions:
        return
    sid   = item.get("id", "")
    sname = item.get("name", "")

    level_order = {"L1": 0, "L2": 1, "L3": 2}
    sorted_qs = sorted(questions, key=lambda q: level_order.get(q["level"], 9))

    # Detect consecutive runs of the same topic and build a numbering map so clients
    # don't see repeated identical topic labels and mistake them for a data error.
    _topics = [(q["topic"] or "—")[:28] for q in sorted_qs]
    _topic_num = [None] * len(_topics)
    _ti = 0
    while _ti < len(_topics):
        _tj = _ti + 1
        while _tj < len(_topics) and _topics[_tj] == _topics[_ti]:
            _tj += 1
        _run = _tj - _ti
        if _run > 1:
            for _k in range(_run):
                _topic_num[_ti + _k] = (_k + 1, _run)
        _ti = _tj

    data_rows = []
    for qi, q in enumerate(sorted_qs):
        _num = _topic_num[qi]
        if _num:
            _topic_disp = f"{_topics[qi]} ({_num[0]}/{_num[1]})"
        else:
            _topic_disp = (q["topic"] or "—")[:30]
        data_rows.append([
            q["level"],
            _topic_disp,
            (q["question"] or "")[:150],
            (q["topic_def"] or "")[:75],
        ])

    pages = [data_rows[i:i + 9] for i in range(0, len(data_rows), 9)]
    for pi, page in enumerate(pages):
        pt = f"BDCQ — {sid}" if len(pages) == 1 else f"BDCQ — {sid}  ({pi+1}/{len(pages)})"
        sl = _blank(prs)
        _header(sl, sname, pt, footer, brand)

        _tx(sl, 0.3, 1.71, 12.5, 0.28,
            "L1 = Critical — must resolve before Realize  ·  "
            "L2 = Important  ·  L3 = Reference",
            size=8, italic=True, color=_MUTED)

        nc, cw = 4, [0.70, 2.20, 6.20, 3.60]
        nr = 1 + len(page)
        tbl = sl.shapes.add_table(nr, nc,
            Inches(0.3), Inches(2.05), Inches(sum(cw)), Inches(0.42 * nr)).table
        for ci, w in enumerate(cw):
            tbl.columns[ci].width = Inches(w)
        for ci, hdr in enumerate(["Level", "Topic", "Configuration Question", "Topic Context"]):
            _cell(tbl, 0, ci, hdr, bold=True, color=_WHITE, fill=brand)

        for ri, row in enumerate(page):
            lv   = row[0]
            fill = _L1_FILL if lv == "L1" else (_L2_FILL if lv == "L2" else _WHITE)
            lv_col = _RED if lv == "L1" else (_GREEN if lv == "L2" else _MUTED)
            _cell(tbl, ri+1, 0, lv, bold=True, color=lv_col, fill=fill)
            for ci in range(1, 4):
                _cell(tbl, ri+1, ci, row[ci], fill=fill)


def _kdd_decisions(prs, footer: str, item: dict, kdd_rows: list, brand: RGBColor):
    if not kdd_rows:
        return
    sid   = item.get("id", "")
    sname = item.get("name", "")

    data = []
    for r in kdd_rows:
        fg  = r.get("fitGap", "")
        data.append([
            _apply_kdd_fixes(r.get("designQuestion") or "")[:115],
            fg,
            r.get("complexity", ""),
            (r.get("decisionOwner") or "")[:22],
            _apply_kdd_fixes(r.get("notes") or "")[:30],
        ])

    pages = [data[i:i + 10] for i in range(0, len(data), 10)]
    for pi, page in enumerate(pages):
        pt = f"Design Decisions — {sid}" if len(pages) == 1 else f"Design Decisions — {sid}  ({pi+1}/{len(pages)})"
        sl = _blank(prs)
        _header(sl, sname, pt, footer, brand)

        _tx(sl, 0.3, 1.71, 12.5, 0.28,
            "AI-generated KDD questions — confirm classification and assign owner in the workshop",
            size=8, italic=True, color=_MUTED)

        nc, cw = 5, [5.3, 1.2, 1.1, 2.0, 3.1]
        nr = 1 + len(page)
        tbl = sl.shapes.add_table(nr, nc,
            Inches(0.3), Inches(2.05), Inches(sum(cw)), Inches(0.42 * nr)).table
        for ci, w in enumerate(cw):
            tbl.columns[ci].width = Inches(w)
        for ci, hdr in enumerate(["Design Question", "Fit/Gap", "Complexity", "Decision Owner", "Fiori App / BTP"]):
            _cell(tbl, 0, ci, hdr, bold=True, color=_WHITE, fill=brand)

        for ri, row in enumerate(page):
            fill  = _AC_ALT if ri % 2 else _WHITE
            fg    = row[1]
            fg_col = _GREEN if fg == "Fit" else (_RED if fg == "Gap" else _AMBER)
            _cell(tbl, ri+1, 0, row[0], fill=fill)
            _cell(tbl, ri+1, 1, fg, bold=True, color=fg_col, fill=fill)
            for ci in range(2, 5):
                _cell(tbl, ri+1, ci, row[ci], fill=fill)


def _ricefw_slide(prs, footer: str, item: dict, kdd_rows: list, brand: RGBColor):
    gaps = [r for r in kdd_rows if r.get("ricefType") and r["ricefType"] != "None"]
    if not gaps:
        return
    sid   = item.get("id", "")
    sname = item.get("name", "")
    data  = [
        [(r.get("ricefTitle") or r.get("designQuestion") or "")[:60],
         r.get("ricefType", ""),
         (r.get("extensibilityType") or "")[:28],
         r.get("btpRequired", ""),
         r.get("effortEstimate", "")]
        for r in gaps
    ]
    _paginated(prs, sname, f"RICEFW / Extensibility — {sid}", footer,
               ["Requirement", "RICEF", "Extensibility Approach", "BTP?", "Effort"],
               [4.5, 1.1, 3.2, 0.9, 1.0], data, brand=brand, max_rows=10)


# ── CONSOLIDATED SUMMARY ──────────────────────────────────────────────────────

def _kdd_summary(prs, footer: str, all_rows: list, brand: RGBColor,
                 scope_items: list = None):
    if not all_rows and not scope_items:
        return
    sl = _blank(prs)
    _header(sl, "Summary", "Design Decision Summary — All Scope Items", footer, brand)

    total = len(all_rows)
    fit   = sum(1 for r in all_rows if r.get("fitGap") == "Fit")
    part  = sum(1 for r in all_rows if r.get("fitGap") == "Partial Fit")
    gap   = sum(1 for r in all_rows if r.get("fitGap") == "Gap")
    ricef = sum(1 for r in all_rows if r.get("ricefType") and r["ricefType"] != "None")

    def _stat(l, label, val, bg, text_color=_WHITE):
        _rect(sl, l, 1.85, 2.75, 1.5, bg)
        _tx(sl, l + 0.1, 1.88, 2.55, 1.15, str(val),
            size=52, bold=True, color=text_color, align=PP_ALIGN.CENTER)
        _tx(sl, l + 0.1, 2.97, 2.55, 0.38, label,
            size=10, bold=True, color=bg, align=PP_ALIGN.CENTER)

    _stat(0.3,  "Total KDD Items", total, brand)
    _stat(3.35, "Fit",             fit,   _GREEN)
    _stat(6.4,  "Partial Fit",     part,  _AMBER)
    _stat(9.45, "Gap / RICEFW",    gap,   _RED)

    if ricef:
        _tx(sl, 0.3, 3.6, 12.5, 0.38,
            f"  RICEFW items flagged for extensibility review: {ricef}  —  prioritise in Realize phase",
            size=10, italic=True, color=_MUTED)

    # Per-scope breakdown — build from KDD rows, then add any scope items with no cache
    # so every scope item appears in the table (showing TBC for uncached items).
    scope_map: dict = {}
    for r in all_rows:
        sid = r.get("scopeItemId", "?")
        scope_map.setdefault(sid, {"Fit": 0, "Partial Fit": 0, "Gap": 0,
                                   "name": r.get("scopeItemName", "")})
        fg = r.get("fitGap", "")
        if fg in scope_map[sid]:
            scope_map[sid][fg] += 1
    if scope_items:
        for _si in scope_items:
            _sid = _si.get("id", "?")
            if _sid not in scope_map:
                scope_map[_sid] = {"Fit": 0, "Partial Fit": 0, "Gap": 0,
                                   "name": _si.get("name", ""), "_tbc": True}
    tbl_rows = []
    for sid, v in scope_map.items():
        _tbc = v.get("_tbc", False)
        tbl_rows.append([
            sid, v["name"][:42],
            str(v["Fit"])         if not _tbc else "—",
            str(v["Partial Fit"]) if not _tbc else "—",
            str(v["Gap"])         if not _tbc else "TBC",
        ])
    _table(sl, 4.1,
           [1.0, 7.1, 1.0, 1.5, 1.0],
           ["Scope ID", "Scope Item", "Fit", "Partial Fit", "Gap"],
           tbl_rows, brand)


_DEFAULT_PARKING_LOT_ROWS = 12

# Curated alias table — only for genuine abbreviations and SAP-specific single-word
# terms that word-overlap scoring cannot disambiguate unambiguously.
_LOB_ALIASES: dict = {
    "cs":              "Customer Service",
    "service":         "Customer Service",   # SAP: standalone "Service" LOB = Customer Service
    "fin":             "Finance & Controlling",
    "controlling":     "Finance & Controlling",
    "sd":              "Sales & Distribution",
    "mm":              "Sourcing & Procurement",
    "sourcing":        "Sourcing & Procurement",
    "procurement":     "Sourcing & Procurement",
    "pp":              "Manufacturing",
    "production":      "Manufacturing",
    "am":              "Asset Management",
    "pm":              "Asset Management",
    "plant maintenance": "Asset Management",
    "hcm":             "Human Resources",
    "hr":              "Human Resources",
    "human capital":   "Human Resources",   # "Human Capital Management", "Human Capital Mgmt"
    "scm":             "Supply Chain",
    "logistics":       "Supply Chain",
    "ps":              "Professional Services",
    "solutions for specific industries": "Professional Services",
    "industry solutions": "Professional Services",
    "r&d":             "R&D & Engineering",
    "engineering":     "R&D & Engineering",
    "it management":   "IT Management",
    "cross":           "Cross-Functional",
    "general":         "Cross-Functional",
    "other":           "Cross-Functional",   # SAP Roadmap Viewer "Other" category
    "basis":           "Cross-Functional",
    "generic":         "Cross-Functional",
}

# Canonical names used throughout (must match _KDD_LOB_EXAMPLES / _LOB_INTEGRATIONS keys).
_CANONICAL_LOBS: tuple = (
    "Manufacturing",
    "Supply Chain",
    "Finance & Controlling",
    "Sales & Distribution",
    "Sourcing & Procurement",
    "Human Resources",
    "Asset Management",
    "Customer Service",
    "R&D & Engineering",
    "Professional Services",
    "IT Management",
    "Cross-Functional",
)

# Pre-computed word sets for each canonical (& treated as whitespace, lower-cased).
_CANONICAL_WORDS: tuple = tuple(
    set(re.findall(r"\w+", c.lower())) for c in _CANONICAL_LOBS
)


def _norm_lob(lob: str) -> str:
    """Normalise any catalog/f2s LOB string to a canonical key.

    Resolution order:
      1. Empty / missing → "Cross-Functional"
      2. Exact canonical match → return as-is
      3. Case-insensitive alias lookup → canonical
      4. Normalise " and " → " & ", collapse whitespace → re-check exact canonical
      5. Word-overlap scoring — Jaccard similarity using word tokens (& treated as
         whitespace so "R&D Engineering" == "R&D & Engineering" == 1.0 overlap).
         Winner must score > 0.5; ties broken by longest canonical name.
      6. Unknown → return original (never silently mis-maps)
    """
    if not lob:
        return "Cross-Functional"

    # 1. Exact canonical
    if lob in _CANONICAL_LOBS:
        return lob

    # 2. Alias (case-insensitive, strip) — also matches if any alias key is contained in input
    lob_lower = lob.lower().strip()
    alias = _LOB_ALIASES.get(lob_lower)
    if not alias:
        # Substring scan only for phrase-length keys (≥ 5 chars) to avoid
        # false positives from short abbreviations ("hr", "am", "pp" etc.)
        for key, val in _LOB_ALIASES.items():
            if len(key) >= 5 and key in lob_lower:
                alias = val
                break
    if alias:
        return alias

    # 3. Normalise " and " → " & ", collapse whitespace
    normed = re.sub(r"\band\b", "&", lob, flags=re.IGNORECASE)
    normed = re.sub(r"\s+", " ", normed).strip()
    if normed in _CANONICAL_LOBS:
        return normed

    # 4. Word-overlap (Jaccard) — ignores "&" punctuation, case-insensitive
    input_words = set(re.findall(r"\w+", normed.lower()))
    if not input_words:
        return "Cross-Functional"

    best, best_score, best_len = None, 0.5, 0  # threshold > 0.5
    for canonical, c_words in zip(_CANONICAL_LOBS, _CANONICAL_WORDS):
        union = input_words | c_words
        score = len(input_words & c_words) / len(union) if union else 0
        if score > best_score or (score == best_score and len(canonical) > best_len):
            best, best_score, best_len = canonical, score, len(canonical)
    if best:
        return best

    return lob  # unknown — return unchanged; caller handles gracefully


def _parking_lot(prs, footer: str, brand: RGBColor, rows: int = _DEFAULT_PARKING_LOT_ROWS):
    sl = _blank(prs)
    _header(sl, "Workshop", "Parking Lot — Unresolved Items", footer, brand)
    _tx(sl, 0.3, 1.71, 12.5, 0.28,
        "Items below need offline resolution — every row must have an owner and due date before Realize phase.",
        size=10, italic=True, color=_MUTED)
    _table(sl, 2.07,
           [0.55, 4.8, 2.8, 2.1, 2.45],
           ["#", "Item / Open Question", "Scope Item", "Owner", "Due Date"],
           [[str(i), "", "", "", ""] for i in range(1, rows + 1)],
           brand, row_h=0.43)


# LOB-keyed KDD example rows used in the appendix — picked at runtime from actual scope LOBs
_KDD_LOB_EXAMPLES: dict = {
    "Manufacturing": [
        ["KDD-001", "Will standard DD buffer zone thresholds be configurable per material type?",
         "Partial Fit", "Medium", "Enhancement", "Supply Chain Lead",
         "Standard zones exist; material-type differentiation via BTP Key User extension"],
        ["KDD-002", "Is SAP IBP integration required for forecast-driven demand signal input?",
         "Gap", "High", "Interface", "IT Architecture",
         "IBP not bundled in Cloud PE; SAP Integration Suite iFlow required"],
        ["KDD-003", "Will production confirmations update MRP elements in real time?",
         "Fit", "Low", "None", "PP Lead",
         "Standard GI/GR posting in Fiori updates MRP automatically — no delta"],
    ],
    "Supply Chain": [
        ["KDD-001", "Will client use standard safety stock or DDMRP buffer model?",
         "Partial Fit", "Medium", "Enhancement", "Supply Chain Lead",
         "Standard SS supported; DDMRP requires a dedicated scope item activation"],
        ["KDD-002", "Are seasonal stock adjustments manual or automated via demand plan?",
         "Gap", "Medium", "Report", "Demand Planner",
         "Manual via Fiori app; automated adjustment requires IBP integration"],
        ["KDD-003", "Does standard 3-day outbound delivery lead time tolerance fit client SLA?",
         "Fit", "Low", "None", "Logistics Lead",
         "Standard Manage Scheduling Agreements in Fiori covers tolerance — confirmed Fit"],
    ],
    "Sales & Distribution": [
        ["KDD-001", "Will ATP check use standard availability or advanced ATP (aATP)?",
         "Partial Fit", "Medium", "Enhancement", "Sales Lead",
         "Standard availability in Fiori; aATP for backorder processing requires a dedicated activation scope item"],
        ["KDD-002", "Is intercompany billing via standard intercompany STO sufficient?",
         "Fit", "Low", "None", "Finance / Sales",
         "Standard intercompany flow covers requirement — no custom logic needed"],
        ["KDD-003", "Customer-specific pricing conditions beyond standard condition technique?",
         "Gap", "High", "Enhancement", "Pricing Lead",
         "Key User In-App extensibility for additional pricing conditions via BTP"],
    ],
    "Sourcing & Procurement": [
        ["KDD-001", "Can standard SAP Ariba integration cover all purchasing categories?",
         "Partial Fit", "High", "Interface", "Procurement Lead",
         "Standard SAP Business Network covers core categories; custom via API"],
        ["KDD-002", "Will vendor evaluation criteria match standard SAP 5-criterion scoring?",
         "Fit", "Low", "None", "Sourcing Lead",
         "Standard scoring confirmed — no extension required"],
        ["KDD-003", "Is central purchasing organisation needed across company codes?",
         "Gap", "Medium", "Enhancement", "CFO Office",
         "Central purchasing not available in Cloud PE — workaround via purchasing groups"],
    ],
    "Finance & Controlling": [
        ["KDD-001", "Will standard SAP payment terms cover all client payment scenarios?",
         "Fit", "Low", "None", "Finance Lead",
         "Standard config via Fiori — no delta required"],
        ["KDD-002", "Will parallel ledger require separate journal entry approval workflows per accounting standard?",
         "Partial Fit", "Medium", "Enhancement", "Finance Controller",
         "Standard single-ledger approval in Fiori; parallel ledger approval differentiation needs BTP Process Automation"],
        ["KDD-003", "Legacy CO-PA reporting structure compatible with Cloud PE account-based profitability analysis?",
         "Gap", "High", "Report", "Finance Controller",
         "Costing-based CO-PA from legacy not supported — must migrate to account-based; custom BTP analytical app required"],
    ],
    "Asset Management": [
        ["KDD-001", "Do standard corrective maintenance order types cover all breakdown scenarios?",
         "Fit", "Low", "None", "Maintenance Lead",
         "Standard reactive maintenance order type covers requirement — no extension"],
        ["KDD-002", "Is IoT sensor integration needed to trigger predictive maintenance orders?",
         "Gap", "High", "Interface", "IT / OT Lead",
         "SAP IoT via BTP required; standard Cloud PE has no native OT connectivity"],
        ["KDD-003", "Will maintenance work center capacity levelling use standard Fiori scheduling?",
         "Partial Fit", "Medium", "Enhancement", "Plant Manager",
         "Standard capacity levelling in Fiori; complex shift scheduling needs BTP extension"],
    ],
    "Customer Service": [
        ["KDD-001", "Will standard SAP Field Service Management integration cover all service types?",
         "Fit", "Medium", "None", "Service Lead",
         "FSM integration scope item required — confirm service call replication flow"],
        ["KDD-002", "Is SLA tracking via standard service contract and response profile sufficient?",
         "Partial Fit", "Medium", "Enhancement", "CS Manager",
         "Standard SLA monitoring in Fiori; multi-tier escalation needs BTP workflow"],
        ["KDD-003", "Will depot repair orders use standard returns management and RMA process?",
         "Gap", "High", "Report", "Operations Lead",
         "Depot repair via returns not standard in Cloud PE — workaround documented"],
    ],
    "R&D & Engineering": [
        ["KDD-001", "Will standard engineering change management (ECM) cover all ECR/ECO workflows?",
         "Partial Fit", "Medium", "Enhancement", "Engineering Lead",
         "Standard ECM in Fiori covers basic ECR; multi-level change approval needs BTP"],
        ["KDD-002", "Is product structure (BoM) management via standard Fiori app sufficient?",
         "Fit", "Low", "None", "PLM Lead",
         "Manage Bill of Materials in Fiori — standard Cloud PE covers requirement"],
        ["KDD-003", "Will recipe management and formula versioning use standard process manufacturing?",
         "Gap", "High", "Enhancement", "Process Lead",
         "Advanced recipe management not in Cloud PE standard — BTP extension required"],
    ],
    "Human Resources": [
        ["KDD-001", "Will employee self-service run in standard SAP Fiori My HR app?",
         "Fit", "Low", "None", "HR Lead",
         "Standard Fiori launchpad covers ESS — no custom portal required"],
        ["KDD-002", "Is payroll integration via standard SuccessFactors Employee Central Payroll?",
         "Partial Fit", "High", "Interface", "Payroll Lead",
         "EC Payroll integration requires a dedicated activation scope item and SAP Integration Suite iFlow"],
        ["KDD-003", "Will org structure changes replicate to downstream systems automatically?",
         "Gap", "Medium", "Interface", "IT Architecture",
         "Standard replication to SD/MM; custom downstream systems need API integration"],
    ],
    "Professional Services": [
        ["KDD-001", "Will project billing use standard time and expense billing (T&E) in Fiori?",
         "Fit", "Low", "None", "PS Lead",
         "Standard billing in Manage Projects — no extension required for T&E"],
        ["KDD-002", "Is resource capacity planning covered by standard project scheduling?",
         "Partial Fit", "Medium", "Enhancement", "Resource Manager",
         "Standard scheduling in Fiori; advanced resource levelling needs BTP extension"],
        ["KDD-003", "Will revenue recognition use standard POC method or client-specific milestones?",
         "Gap", "High", "Report", "Finance / PS Lead",
         "Custom milestone billing profile required — BTP side-by-side extension (Key User In-App cannot modify billing profile engine)"],
    ],
    "Cross-Functional": [
        ["KDD-001", "Do standard SAP-delivered chart of accounts (YCOA/YIOA) and starter content cover client structure?",
         "Partial Fit", "Medium", "Enhancement", "Finance Lead",
         "SAP delivers banking/insurance YCOA with pre-configured GL accounts; client extensions need account master creation"],
        ["KDD-002", "Are standard industry-specific dimensions (product group, cost centre, profit centre) sufficient?",
         "Partial Fit", "High", "Enhancement", "Finance Controller",
         "SAP delivers standard dimension categories; client-specific hierarchy values require Fiori master data setup"],
        ["KDD-003", "Will standard financial statement versions and SAC stories cover regulatory reporting obligations?",
         "Gap", "High", "Report", "Finance Controller",
         "Custom SAC stories or BTP Data Sphere needed for FINREP/COREP/IFRS 17/Solvency II beyond standard delivery"],
    ],
}


def _kdd_log_format(prs, footer: str, brand: RGBColor, lobs: set = None):
    """Appendix: KDD log format with examples drawn from the actual LOBs in scope."""
    sl = _blank(prs)
    _header(sl, "Appendix", "KDD Log Format — Key Design Decision Log", footer, brand)
    _tx(sl, 0.3, 1.71, 12.5, 0.28,
        "The Explore Accelerator exports this structure to Excel — examples below are specific to this workshop's scope.",
        size=10, italic=True, color=_MUTED)

    # Pick examples from the LOBs present in this workshop
    examples: list = []
    for lob in (sorted(lobs) if lobs else []):
        for row in _KDD_LOB_EXAMPLES.get(lob, []):
            if row not in examples:
                examples.append(row)
            if len(examples) >= 3:
                break
        if len(examples) >= 3:
            break
    if not examples:  # fallback — Cross-Functional examples are universally applicable
        examples = list(_KDD_LOB_EXAMPLES.get("Cross-Functional", []))[:3]
    examples = examples[:3]

    _table(sl, 2.07,
           [0.95, 3.5, 1.1, 1.2, 1.2, 1.55, 3.28],
           ["KDD ID", "Design Question", "Fit/Gap", "Complexity", "RICEF", "Owner", "Rationale"],
           examples, brand, row_h=0.44)
    _tx(sl, 0.3, 5.25, 12.5, 0.32,
        "Fit = standard Cloud PE, no delta  ·  Partial Fit = standard config + Key User In-App extension  ·  "
        "Gap = custom RICEF, BTP side-by-side, or descope",
        size=8.5, italic=True, color=_MUTED)


# ── LOB INTEGRATION / RISK DATA ──────────────────────────────────────────────

_LOB_INTEGRATIONS = {
    "Manufacturing":          [("MES / Shop Floor Systems", "Production order confirmation & GI"),
                               ("SAP IBP (via BTP)", "Forecast-driven demand signal"),
                               ("Quality Mgmt Systems", "Inspection lot & QN replication")],
    "Supply Chain":           [("SAP IBP", "Demand & supply planning"),
                               ("SAP EWM / SAP TM", "Warehouse & transport execution"),
                               ("SAP Business Network", "Supplier collaboration & ASN")],
    "Finance & Controlling":  [("Banking Interfaces", "Electronic bank statement & payment"),
                               ("Tax Engine (Vertex/Avalara)", "Tax determination via BTP"),
                               ("SAP Analytics Cloud", "Financial reporting & planning")],
    "Sales & Distribution":   [("SAP Commerce Cloud", "Online order replication"),
                               ("SAP Sales Cloud (CRM)", "Opportunity-to-quote"),
                               ("EDI / Customer Portals", "Order & invoice exchange")],
    "Sourcing & Procurement": [("SAP Ariba", "Source-to-contract & PO collaboration"),
                               ("SAP Business Network", "Supplier invoice & catalogue"),
                               ("Supplier Portals", "Catalogue & VMI integration")],
    "Human Resources":        [("SAP SuccessFactors", "Employee master replication"),
                               ("SAP EC Payroll", "Payroll posting to FI"),
                               ("Time & Attendance Systems", "Clock data & absence posting")],
    "Asset Management":       [("IoT / Sensor Platforms", "Predictive maintenance triggers via BTP"),
                               ("SAP Asset Intelligence Network", "Equipment master sync"),
                               ("GIS / Mapping Systems", "Functional location geo-tagging")],
    "Customer Service":       [("SAP Field Service Mgmt", "Service order & technician dispatch"),
                               ("SAP Service Cloud", "Ticket-to-order integration"),
                               ("Customer Self-Service Portal", "RMA & depot repair status")],
    "R&D & Engineering":      [("CAD / PDM Systems", "BOM & document management sync"),
                               ("SAP Product Lifecycle Costing", "Cost estimate feed"),
                               ("Lab / LIMS Systems", "Inspection & recipe versioning")],
    "Professional Services":  [("SAP Concur", "Expense posting to project WBS"),
                               ("Time Recording Apps", "Timesheet to project confirmation"),
                               ("SAP Analytics Cloud", "Project profitability dashboard")],
    "Cross-Functional":       [("SAP Master Data Governance", "Central master data workflow"),
                               ("SAP Analytics Cloud", "Enterprise KPI dashboard"),
                               ("SAP Build Process Automation", "Workflow & approval automation")],
    "IT Management":          [("Identity Providers (IdP)", "SSO & user provisioning via SAP IAS"),
                               ("SAP BTP Integration Suite", "API management & event mesh"),
                               ("Output Management Systems", "Form & print routing configuration")],
}

_LOB_RISKS = {
    "Manufacturing": [
        ("DDMRP activation requires dedicated scope item — confirm licence inclusion", "High", "Medium",
         "Verify scope item in contract; plan activation config in Realize sprint 1"),
        ("MES integration requires custom iFlow — build effort underestimated", "High", "High",
         "Start MES API discovery in Explore; assign integration architect immediately"),
        ("Production version & routing migration from legacy — data quality risk", "Medium", "High",
         "Run data quality assessment on routing/BOM data; plan conversion program"),
    ],
    "Supply Chain": [
        ("IBP integration not bundled in Cloud PE — separate licence & project track needed", "High", "Medium",
         "Confirm IBP scope with client now; plan parallel workstream if in scope"),
        ("Warehouse Management migration (IM to EWM): structures may not map 1:1", "High", "Medium",
         "Document current warehouse layout; validate against EWM storage type model"),
        ("Carrier / 3PL EDI integration: non-standard message formats require mapping", "Medium", "High",
         "Inventory all EDI partners and message types; plan mapping effort"),
    ],
    "Finance & Controlling": [
        ("Tax engine integration (Vertex/Avalara) via BTP — not standard config", "High", "Medium",
         "Confirm tax engine vendor; assign BTP integration resource in Realize"),
        ("CO-PA reporting gap: legacy custom profit centre reports not replicable 1:1", "High", "High",
         "Map existing CO-PA reports to SAC stories; agree reporting delta in Explore"),
        ("Parallel ledger setup complexity if multiple accounting standards required", "Medium", "Medium",
         "Document all accounting standards (IFRS/GAAP/local) in Explore phase"),
    ],
    "Sales & Distribution": [
        ("aATP (advanced ATP) requires dedicated activation — backorder processing gap without it", "High", "Medium",
         "Confirm aATP scope item; test ATP check coverage in Realize"),
        ("Customer-specific pricing conditions beyond standard condition technique", "Medium", "High",
         "Document all pricing requirements; assess Key User In-App extensibility limits"),
        ("Intercompany billing complexity if multiple company codes in scope", "Medium", "Medium",
         "Map intercompany flows; confirm legal entity structure before Realize"),
    ],
    "Sourcing & Procurement": [
        ("Ariba integration requires SAP Business Network subscription — licence risk", "High", "Medium",
         "Confirm BN subscription in contract; plan Ariba connectivity workstream"),
        ("Central purchasing org not available in Cloud PE — workaround required", "Medium", "High",
         "Document central purchasing requirements; agree purchasing group workaround"),
        ("Catalogue management: punchout catalogues require Ariba configuration", "Medium", "Medium",
         "Inventory all catalogue types; plan Ariba catalogue setup in Realize"),
    ],
    "Human Resources": [
        ("EC Payroll integration requires dedicated scope item and Integration Suite iFlow", "High", "High",
         "Confirm payroll scope item; assign payroll integration stream lead in Explore"),
        ("Country-specific absence & attendance rules may exceed standard config", "Medium", "High",
         "Document all absence types per country; validate against Cloud PE country version"),
        ("Org structure replication to downstream systems requires API integration", "Medium", "Medium",
         "Map all downstream systems consuming org data; plan API integration"),
    ],
    "Asset Management": [
        ("IoT / predictive maintenance integration via BTP IoT — significant build effort", "High", "High",
         "Scope IoT use cases precisely; consider phased rollout post go-live"),
        ("Equipment master migration from legacy PM: classification data quality risk", "High", "Medium",
         "Run equipment master data assessment; plan classification migration early"),
        ("Maintenance work center capacity planning: complex shift models may need BTP extension", "Medium", "Medium",
         "Document shift models; assess Key User extensibility limits in Explore"),
    ],
    "Customer Service": [
        ("SAP FSM integration requires FSM licence and iFlow — not standard Cloud PE", "High", "Medium",
         "Confirm FSM licence; plan FSM connectivity and technician app rollout"),
        ("Depot repair / returns: not fully standard in Cloud PE — workaround needed", "High", "High",
         "Document repair flows; assess whether standard returns covers requirements"),
        ("SLA multi-tier escalation beyond standard response profile needs BTP workflow", "Medium", "Medium",
         "Map SLA tiers; plan BTP workflow automation in Realize"),
    ],
    "R&D & Engineering": [
        ("Engineering Change Management: multi-level ECR/ECO approval needs BTP workflow", "High", "Medium",
         "Map approval hierarchy; plan BTP Build Process Automation in Realize"),
        ("CAD/PDM integration: document management sync requires custom iFlow", "Medium", "High",
         "Inventory CAD systems; assess SAP DMS vs. external DMS integration approach"),
        ("Advanced recipe management not standard in Cloud PE — BTP extension required", "High", "High",
         "Confirm recipe complexity; assess Key User In-App vs. side-by-side extension"),
    ],
    "Professional Services": [
        ("Revenue recognition: milestone billing profile may require custom config beyond standard POC", "High", "Medium",
         "Document all revenue recognition scenarios; map to standard Cloud PE methods"),
        ("Resource capacity levelling: complex multi-project scheduling may exceed standard Fiori capacity planning", "Medium", "Medium",
         "Assess scheduling requirements in Explore; extend to BTP only if standard capacity planning parameters are insufficient"),
        ("Intercompany project billing across entities — complex intercompany flow", "Medium", "High",
         "Map intercompany project billing flows; confirm legal entity structure"),
    ],
    "Cross-Functional": [
        ("Master data governance: MDG activation complexity if multiple domains in scope", "Medium", "Medium",
         "Scope MDG domains precisely; plan MDG config workstream in Realize"),
        ("SAC embedded analytics: custom stories require SAC modelling effort", "Medium", "Medium",
         "Inventory reporting requirements; assess standard stories vs. custom SAC build"),
        ("Identity & access management: integration with corporate IdP via IAS needed", "High", "Medium",
         "Confirm IdP technology (ADFS/Azure AD); plan IAS federation in Realize"),
    ],
    "IT Management": [
        ("Custom XFA form templates beyond standard schema require BTP Forms Service activation", "High", "Medium",
         "Inventory all document types needing custom branding; plan BTP Forms Service config in Realize"),
        ("External OMS API compatibility (OpenText/Ricoh) — vendor version and certificate management risk", "High", "High",
         "Start vendor API discovery in Explore; assign integration architect; plan certificate management"),
        ("High-volume print batch routing — output channel and Cloud Print Manager capacity risk", "Medium", "Medium",
         "Test output volume in sandbox; validate Cloud Print Manager capacity; plan channel configuration"),
    ],
    "Cross-Functional": [
        ("Corporate IdP federation (ADFS/Azure AD) via SAP IAS — certificate and sign-off risk", "High", "Medium",
         "Start IdP discovery in Explore; assign IT Security to IAS federation config in Realize sprint 1"),
        ("Master data governance: MDG activation complexity if multiple domains in scope", "Medium", "Medium",
         "Define MDG scope by entity type (material/vendor/customer); each domain adds Realize sprint effort"),
        ("Custom SAC analytical stories beyond standard embedded analytics — modelling build effort", "Medium", "Medium",
         "Inventory all reporting requirements; assess standard stories vs. custom SAC build before Realize"),
    ],
}


# ── SLIDE A: BUSINESS VALUE SCORECARD ─────────────────────────────────────────

def _value_scorecard(prs, footer: str, scope_items: list,
                     scope_parseds: dict, brand: RGBColor):
    """Business Value Scorecard — 2-column card grid, one card per scope item."""
    CARD_W      = 6.20
    CARD_H      = 1.62   # taller to fit 3 benefits
    CARD_GAP    = 0.14
    START_X     = [0.30, 6.83]
    CARDS_PER_PAGE = 6   # 3 rows × 2 cols comfortably at taller card height
    total_lobs  = len({it.get("lob", "") for it in scope_items})

    def _wb_trunc(text: str, limit: int = 100) -> str:
        """Truncate at word boundary, append ellipsis."""
        if len(text) <= limit:
            return text
        cut = text[:limit].rsplit(" ", 1)[0]
        return cut.rstrip(".,;:—–-") + "…"

    pages = [scope_items[i:i + CARDS_PER_PAGE]
             for i in range(0, max(len(scope_items), 1), CARDS_PER_PAGE)]

    for pi, page_items in enumerate(pages):
        sl = _blank(prs)
        pt = ("Business Value Scorecard" if len(pages) == 1
              else f"Business Value Scorecard  ({pi+1}/{len(pages)})")
        _header(sl, "Business Case", pt, footer, brand)

        for idx, item in enumerate(page_items):
            sid      = item.get("id", "")
            sname    = item.get("name", "")
            lob      = item.get("lob", "")
            parsed   = scope_parseds.get(sid, {})
            benefits = parsed.get("benefits", [])

            col = idx % 2
            row = idx // 2
            x   = START_X[col]
            y   = 1.72 + row * (CARD_H + CARD_GAP)

            # Shadow
            _rect(sl, x + 0.06, y + 0.06, CARD_W, CARD_H, RGBColor(0xD0, 0xD0, 0xD0))
            # Card background
            _rect(sl, x, y, CARD_W, CARD_H, _WHITE)
            # Left brand border
            _rect(sl, x, y, 0.08, CARD_H, brand)

            # Scope ID badge
            _rect(sl, x + 0.14, y + 0.10, 0.65, 0.25, _AC_DARK)
            _tx(sl, x + 0.14, y + 0.10, 0.65, 0.25, sid,
                size=7.5, bold=True, color=_WHITE, align=PP_ALIGN.CENTER)

            # LOB pill
            _rect(sl, x + 0.85, y + 0.10, 1.70, 0.25, _AC_LIGHT)
            _tx(sl, x + 0.85, y + 0.10, 1.70, 0.25, lob[:26],
                size=7, color=brand, align=PP_ALIGN.CENTER)

            # Scope name
            _tx(sl, x + 0.14, y + 0.40, CARD_W - 0.22, 0.30,
                sname[:80], size=9.5, bold=True, color=_INK)

            # KPI bullets from benefits — up to 3, word-boundary truncated
            if benefits:
                kpi_y = y + 0.74
                for b in benefits[:3]:
                    _tx(sl, x + 0.14, kpi_y, CARD_W - 0.22, 0.28,
                        f"✓  {_sent_case(_wb_trunc(b))}", size=7.5, color=_GREEN)
                    kpi_y += 0.29
            else:
                _tx(sl, x + 0.14, y + 0.74, CARD_W - 0.22, 0.50,
                    "Benefits data not available — see SAP Process Navigator",
                    size=8, italic=True, color=_MUTED)

        # Bottom strip
        _rect(sl, 0.30, 7.00, 12.73, 0.30, _AC_DARK)
        _tx(sl, 0.42, 7.02, 12.40, 0.24,
            f"{len(scope_items)} Scope Item{'s' if len(scope_items) != 1 else ''}  "
            f"·  {total_lobs} Line{'s' if total_lobs != 1 else ''} of Business  "
            "·  All delivered via standard SAP Fiori — no custom ABAP",
            size=8, bold=True, color=_WHITE)


# ── SLIDE B: FIT ASSESSMENT HEAT MAP ──────────────────────────────────────────

def _fit_heat_map(prs, footer: str, scope_items: list,
                  kdd_cache: dict, brand: RGBColor):
    """Fit Assessment Heat Map — colour-coded by dimension."""
    _GREEN_BG = RGBColor(0x00, 0xA6, 0x51)
    _AMBER_BG = RGBColor(0xF0, 0xA5, 0x00)
    _RED_BG   = RGBColor(0xD9, 0x30, 0x25)
    _GREY_BG  = RGBColor(0xCC, 0xCC, 0xCC)

    _DIMS = {
        "config":      (["config", "customis", "fiori", "setting", "parameter"],
                        "Configuration"),
        "master_data": (["master data", "material", "customer", "vendor",
                         "chart of accounts", "cost center"],
                        "Master Data"),
        "integration": (["integrat", "interface", "api", "idoc", "replicat", "connect"],
                        "Integration"),
        "reporting":   (["report", "analytic", "sac", "dashboard", "kpi"],
                        "Reporting"),
        "auth":        (["authoriz", "role", "access", "permission", "segregation"],
                        "Authorisation"),
    }

    def _classify(rows, keywords):
        matched = [r for r in rows
                   if any(k in (r.get("designQuestion") or "").lower() for k in keywords)]
        if not matched:
            return None
        if any(r.get("fitGap") == "Gap" and r.get("complexity") == "High" for r in matched):
            return "Gap"
        if any(r.get("fitGap") in ("Gap", "Partial Fit") for r in matched):
            return "Partial"
        return "Fit"

    def _rating_cell(tbl, ri, ci, rating):
        if rating == "Fit":
            _cell(tbl, ri, ci, "Fit",     bold=True, color=_WHITE,  fill=_GREEN_BG, align=PP_ALIGN.CENTER)
        elif rating == "Partial":
            _cell(tbl, ri, ci, "Partial", bold=True, color=_INK,    fill=_AMBER_BG, align=PP_ALIGN.CENTER)
        elif rating == "Gap":
            _cell(tbl, ri, ci, "Gap",     bold=True, color=_WHITE,  fill=_RED_BG,   align=PP_ALIGN.CENTER)
        else:
            _cell(tbl, ri, ci, "TBC",     bold=False, color=_MUTED, fill=_GREY_BG,  align=PP_ALIGN.CENTER)

    MAX_ROWS = 12
    pages = [scope_items[i:i + MAX_ROWS] for i in range(0, max(len(scope_items), 1), MAX_ROWS)]

    for pi, page_items in enumerate(pages):
        sl = _blank(prs)
        pt = ("Fit Assessment Heat Map" if len(pages) == 1
              else f"Fit Assessment Heat Map  ({pi+1}/{len(pages)})")
        _header(sl, "Executive View", pt, footer, brand)
        _tx(sl, 0.3, 1.68, 12.5, 0.26,
            "Green = Standard Fit  ·  Amber = Config / Extension Required  "
            "·  Red = Gap / Custom Build",
            size=9, italic=True, color=_MUTED)

        dim_keys   = list(_DIMS.keys())
        dim_labels = [_DIMS[k][1] for k in dim_keys]
        headers    = ["Scope Item"] + dim_labels
        cw         = [4.80, 1.60, 1.60, 1.60, 1.60, 1.63]

        nr = 1 + len(page_items)
        nc = len(headers)
        tbl = sl.shapes.add_table(
            nr, nc, Inches(0.3), Inches(1.98),
            Inches(sum(cw)), Inches(0.40 * nr)).table
        for ci, w in enumerate(cw):
            tbl.columns[ci].width = Inches(w)
        for ci, hdr in enumerate(headers):
            _cell(tbl, 0, ci, hdr, bold=True, color=_WHITE, fill=brand)

        for ri, item in enumerate(page_items):
            sid   = item.get("id", "")
            rows  = kdd_cache.get(sid, [])
            fill  = _AC_ALT if ri % 2 else _WHITE
            _cell(tbl, ri + 1, 0,
                  f"{sid}  {item.get('name', '')[:44]}", fill=fill)
            for di, dk in enumerate(dim_keys):
                keywords, _ = _DIMS[dk]
                _rating_cell(tbl, ri + 1, di + 1, _classify(rows, keywords))

        # Legend
        leg_y = 1.98 + 0.40 * nr + 0.14
        if leg_y > 6.85:
            leg_y = 6.85
        _rect(sl, 0.30, leg_y, 0.22, 0.20, _GREEN_BG)
        _tx(sl, 0.58, leg_y, 2.10, 0.22, "Standard Fit", size=8, color=_INK)
        _rect(sl, 2.85, leg_y, 0.22, 0.20, _AMBER_BG)
        _tx(sl, 3.13, leg_y, 2.80, 0.22, "Config / Extension Required", size=8, color=_INK)
        _rect(sl, 6.15, leg_y, 0.22, 0.20, _RED_BG)
        _tx(sl, 6.43, leg_y, 2.10, 0.22, "Gap / Custom Build", size=8, color=_INK)
        _rect(sl, 8.75, leg_y, 0.22, 0.20, _GREY_BG)
        _tx(sl, 9.03, leg_y, 3.00, 0.22, "TBC — no KDD data loaded", size=8, color=_INK)


# ── SLIDE C: INTEGRATION LANDSCAPE ────────────────────────────────────────────

def _integration_landscape(prs, footer: str, lobs, brand: RGBColor):
    """Integration Landscape — S/4HANA at centre, LOB systems in surrounding ring."""
    import math

    sl = _blank(prs)
    _header(sl, "Architecture", "Integration Landscape", footer, brand)

    # Collect LOB-specific integrations (deduplicated)
    seen: set     = set()
    integrations: list = []
    for lob in sorted(lobs):
        for name, desc in _LOB_INTEGRATIONS.get(lob, []):
            if name not in seen:
                seen.add(name)
                integrations.append((name, desc))

    # Always include BTP and Integration Suite
    for fixed in [("SAP BTP (Business Technology Platform)", "Extension & integration platform"),
                  ("SAP Integration Suite / CPI", "Pre-built iFlows for system connectivity")]:
        if fixed[0] not in seen:
            integrations.insert(0, fixed)
            seen.add(fixed[0])

    surrounding = integrations[:10]

    # Central box
    CX, CY   = 5.90, 3.80
    CB_W, CB_H = 3.10, 1.05
    _rect(sl, CX - CB_W / 2, CY - CB_H / 2, CB_W, CB_H, brand)
    _tx(sl, CX - CB_W / 2 + 0.10, CY - CB_H / 2 + 0.08,
        CB_W - 0.20, 0.46,
        "SAP S/4HANA Cloud\nPublic Edition",
        size=11, bold=True, color=_WHITE, align=PP_ALIGN.CENTER)
    _tx(sl, CX - CB_W / 2 + 0.10, CY + 0.04,
        CB_W - 0.20, 0.28,
        "Always-Current  ·  Zero Downtime  ·  Fiori UX",
        size=7.5, italic=True, color=_AC_LIGHT, align=PP_ALIGN.CENTER)

    # Surrounding boxes in ring
    n       = max(len(surrounding), 1)
    BOX_W   = 2.50
    BOX_H   = 0.72
    RADIUS  = 2.85

    for i, (name, desc) in enumerate(surrounding):
        angle = math.radians(-90 + i * (360 / n))
        raw_bx = CX + RADIUS * math.cos(angle) - BOX_W / 2
        raw_by = CY + RADIUS * math.sin(angle) - BOX_H / 2
        bx = max(0.10, min(13.33 - BOX_W - 0.10, raw_bx))
        by = max(1.67, min(7.00 - BOX_H - 0.10, raw_by))

        # Shadow
        _rect(sl, bx + 0.05, by + 0.05, BOX_W, BOX_H, RGBColor(0xD0, 0xD0, 0xD0))
        # Card
        _rect(sl, bx, by, BOX_W, BOX_H, _WHITE)
        # Left brand border
        _rect(sl, bx, by, 0.06, BOX_H, brand)

        _tx(sl, bx + 0.10, by + 0.04, BOX_W - 0.14, 0.30,
            name[:38], size=8, bold=True, color=_INK)
        _tx(sl, bx + 0.10, by + 0.36, BOX_W - 0.14, 0.28,
            desc[:55], size=7, italic=True, color=_MUTED)

    # Bottom note
    _rect(sl, 0.30, 6.92, 12.73, 0.28, _AC_LIGHT)
    _tx(sl, 0.42, 6.94, 12.40, 0.24,
        "All integrations delivered via pre-built SAP Integration Suite iFlows "
        "or SAP APIs — no point-to-point coding",
        size=8, italic=True, color=brand)


# ── SLIDE D: RISK REGISTER ─────────────────────────────────────────────────────

def _risk_register(prs, footer: str, lobs, brand: RGBColor):
    """Pre-populated Risk Register — filtered to LOBs in scope."""
    _R_GREEN = RGBColor(0x00, 0xA6, 0x51)
    _R_AMBER = RGBColor(0xF0, 0xA5, 0x00)
    _R_RED   = RGBColor(0xD9, 0x30, 0x25)

    risks: list = []
    for lob in sorted(lobs):
        for desc, impact, prob, mitigation in _LOB_RISKS.get(lob, []):
            risks.append((desc, lob, impact, prob, mitigation))

    if not risks:
        return

    MAX_ROWS   = 10
    col_widths = [0.40, 4.20, 1.60, 0.90, 0.90, 5.05]
    headers    = ["#", "Risk Description", "LOB", "Impact", "Probability", "Suggested Mitigation"]
    pages      = [risks[i:i + MAX_ROWS] for i in range(0, len(risks), MAX_ROWS)]

    for pi, page_risks in enumerate(pages):
        sl = _blank(prs)
        pt = ("Open Risk Register — Pre-populated" if len(pages) == 1
              else f"Open Risk Register — Pre-populated  ({pi+1}/{len(pages)})")
        _header(sl, "Risk Management", pt, footer, brand)
        _tx(sl, 0.3, 1.68, 12.5, 0.26,
            "Risks identified based on scope — validate and assign owners in workshop",
            size=9, italic=True, color=_MUTED)

        nr = 1 + len(page_risks)
        nc = len(col_widths)
        tbl = sl.shapes.add_table(
            nr, nc, Inches(0.3), Inches(1.98),
            Inches(sum(col_widths)), Inches(0.40 * nr)).table
        for ci, w in enumerate(col_widths):
            tbl.columns[ci].width = Inches(w)
        for ci, hdr in enumerate(headers):
            _cell(tbl, 0, ci, hdr, bold=True, color=_WHITE, fill=brand)

        global_start = pi * MAX_ROWS
        for ri, (desc, lob, impact, prob, mitigation) in enumerate(page_risks):
            fill = _AC_ALT if ri % 2 else _WHITE
            _cell(tbl, ri + 1, 0, str(global_start + ri + 1),
                  fill=fill, align=PP_ALIGN.CENTER)
            _cell(tbl, ri + 1, 1, desc[:115], fill=fill)
            _cell(tbl, ri + 1, 2, lob[:24],   fill=fill)

            imp_bg = _R_RED if impact == "High" else (_R_AMBER if impact == "Medium" else _R_GREEN)
            imp_tc = _WHITE if impact != "Medium" else _INK
            _cell(tbl, ri + 1, 3, impact, bold=True, color=imp_tc, fill=imp_bg, align=PP_ALIGN.CENTER)

            prob_bg = _R_RED if prob == "High" else (_R_AMBER if prob == "Medium" else _R_GREEN)
            prob_tc = _WHITE if prob != "Medium" else _INK
            _cell(tbl, ri + 1, 4, prob, bold=True, color=prob_tc, fill=prob_bg, align=PP_ALIGN.CENTER)

            _cell(tbl, ri + 1, 5, mitigation[:120], fill=fill)

        warn_y = min(1.98 + 0.40 * nr + 0.10, 6.72)
        _rect(sl, 0.30, warn_y, 12.73, 0.30, RGBColor(0xFF, 0xF3, 0xCC))
        _tx(sl, 0.42, warn_y + 0.04, 12.40, 0.22,
            "All risks must have an assigned owner and due date before Explore phase close.",
            size=8.5, bold=True, color=RGBColor(0x7B, 0x60, 0x00))


# ── ASYNC BRIEFS FOR PER-SCOPE SLIDES E & F ───────────────────────────────────

_TOP_DECISIONS_LOB_FALLBACK: dict = {
    "Finance & Controlling": [
        {"question": "Will parallel ledger (IFRS / local GAAP) be activated — how many accounting standards?",
         "why": "Each additional standard doubles parallel accounting config scope in Realize",
         "owner": "Finance Controller"},
        {"question": "Confirm chart of accounts structure and account group assignment",
         "why": "Chart of accounts blocks all downstream FI config — cannot start Realize without it",
         "owner": "Finance Lead"},
        {"question": "Which payment medium formats (SEPA / SWIFT / NACHA) are required?",
         "why": "Non-standard formats need BTP Document Service — build slot in Realize sprint 1",
         "owner": "Treasury / Finance Lead"},
    ],
    "Manufacturing": [
        {"question": "Will DDMRP buffer model be used or standard safety stock?",
         "why": "DDMRP requires dedicated scope item activation — licence and sprint 1 config impact",
         "owner": "Supply Chain Lead"},
        {"question": "Confirm production version, routing, and BOM migration scope",
         "why": "Legacy routing data quality risk is top Manufacturing go-live blocker",
         "owner": "PP / Data Migration Lead"},
        {"question": "Is MES shop-floor integration required — which systems and message format?",
         "why": "MES iFlow build starts Realize sprint 1 — architect must be assigned now",
         "owner": "IT Architecture Lead"},
    ],
    "Sales & Distribution": [
        {"question": "Will ATP use standard availability or advanced ATP (aATP) backorder processing?",
         "why": "aATP requires dedicated scope item activation — cannot be retrofitted in Realize",
         "owner": "Sales Lead"},
        {"question": "Do customer-specific pricing conditions exceed standard condition technique?",
         "why": "Custom pricing conditions need Key User In-App extensibility assessment now",
         "owner": "Pricing Lead"},
        {"question": "Is intercompany billing needed across company codes — how many entity pairs?",
         "why": "Each IC pair needs transfer pricing configuration — drives sprint scope",
         "owner": "Finance / Sales Lead"},
    ],
    "Human Resources": [
        {"question": "Which payroll engine — EC Payroll, SAP HCM, or third-party?",
         "why": "Payroll engine choice drives integration scope and Realize workstream structure",
         "owner": "Payroll Lead"},
        {"question": "Which country versions are required for absence and attendance rules?",
         "why": "Country-specific rules may exceed standard config — need BTP extension assessment",
         "owner": "HR Lead"},
        {"question": "Which downstream systems consume org structure data — how many API integrations?",
         "why": "Each downstream system needs an iFlow — Integration Suite build starts sprint 1",
         "owner": "IT Architecture Lead"},
    ],
    "Supply Chain": [
        {"question": "Will IBP be used for demand planning — is it in scope and licenced?",
         "why": "IBP is not bundled in Cloud PE — separate licence and project track needed",
         "owner": "Supply Chain Lead"},
        {"question": "Which warehouse management system — standard WM or EWM scope item?",
         "why": "EWM is a separate activation — must confirm before Realize sprint 1 planning",
         "owner": "Logistics Lead"},
        {"question": "How many EDI partners and non-standard message formats are in scope?",
         "why": "Each non-standard EDI format needs custom mapping — drives Integration Suite effort",
         "owner": "IT Architecture Lead"},
    ],
    "Sourcing & Procurement": [
        {"question": "Is SAP Ariba / Business Network integration in scope — subscription confirmed?",
         "why": "BN subscription is a licence risk that blocks Ariba connectivity in Realize",
         "owner": "Procurement Lead"},
        {"question": "Does central purchasing org span multiple company codes?",
         "why": "Central purchasing org not available in Cloud PE — workaround must be agreed now",
         "owner": "CFO Office"},
        {"question": "How many punchout catalogue types and EDI suppliers are in scope?",
         "why": "Catalogue setup effort drives Ariba sprint scope in Realize",
         "owner": "Sourcing Lead"},
    ],
    "Asset Management": [
        {"question": "Is IoT or sensor integration required for predictive maintenance?",
         "why": "SAP IoT via BTP has significant build effort — must scope in Explore to size Realize",
         "owner": "IT / OT Lead"},
        {"question": "What is the equipment master hierarchy depth and migration data quality?",
         "why": "FLOC/equipment migration is top AM go-live risk — data assessment starts now",
         "owner": "Maintenance Lead"},
        {"question": "Will maintenance work centre shift models exceed standard Fiori scheduling?",
         "why": "Complex shift models need BTP extension assessment before Realize sprint planning",
         "owner": "Plant Manager"},
    ],
    "Customer Service": [
        {"question": "Is SAP Field Service Management integration required — FSM licenced?",
         "why": "FSM licence and iFlow build are pre-requisites — must confirm before Realize",
         "owner": "Service Lead"},
        {"question": "Does SLA escalation exceed standard 3-step response profile?",
         "why": "Multi-tier SLA needs BTP workflow automation — architecture decision blocks sprint 1",
         "owner": "CS Manager"},
        {"question": "Will depot repair use standard returns management or a custom repair flow?",
         "why": "Depot repair is not fully standard in Cloud PE — workaround scope must be agreed now",
         "owner": "Operations Lead"},
    ],
    "Professional Services": [
        {"question": "Which revenue recognition method — standard POC, milestone, or client-specific?",
         "why": "Custom milestone profiles need Key User In-App extensibility assessment now",
         "owner": "Finance / PS Lead"},
        {"question": "Is SAP Concur integration required — expense posting to project WBS?",
         "why": "Concur iFlow build starts Realize sprint 1 — architect must be assigned in Explore",
         "owner": "IT Architecture Lead"},
        {"question": "Does resource capacity levelling exceed standard Fiori project scheduling?",
         "why": "Advanced scheduling needs BTP extension — drives sprint scope in Realize",
         "owner": "Resource Manager"},
    ],
    "R&D & Engineering": [
        {"question": "Does ECO approval workflow exceed standard 3-level approval in Fiori?",
         "why": "Multi-level ECO approval needs BTP Build Process Automation — architecture decision now",
         "owner": "Engineering Lead"},
        {"question": "Which CAD / PDM systems need BOM and document management sync?",
         "why": "Each CAD integration needs a custom iFlow — Integration Suite effort starts sprint 1",
         "owner": "IT Architecture Lead"},
        {"question": "Will recipe versioning exceed standard process manufacturing in Cloud PE?",
         "why": "Advanced recipe management is not standard — BTP extension scope must be agreed now",
         "owner": "Process Lead"},
    ],
    "IT Management": [
        {"question": "Which document types need custom XFA form templates beyond SAP standard?",
         "why": "Custom XFA requires BTP Forms Service — scope must be confirmed before Realize sprint",
         "owner": "IT / Business Lead"},
        {"question": "Will email output use SAP standard sender or client's own SMTP server?",
         "why": "Client domain setup requires IT Security sign-off (SPF/DKIM) — cannot start in Realize",
         "owner": "IT / Security Lead"},
        {"question": "Is an external output management system (OpenText/Ricoh) already in place?",
         "why": "External OMS scope item 7DJ adds sprint effort — must confirm scope before Realize",
         "owner": "IT Architecture Lead"},
    ],
}


async def _scope_and_decisions_brief(
    item: dict, parsed: dict, questions: list, kdd_rows: list,
    ws_country_isos: set = frozenset(),
) -> tuple[dict, list]:
    """Single Claude call returning (brief_dict, decisions_list).

    Merges the former _scope_brief and _top_decisions_brief — shared context
    (BDCQ questions, fact_base, overview) is sent once instead of twice,
    saving ~44% of token cost and eliminating one Claude call per scope item.
    """
    # ── Shared context ────────────────────────────────────────────────────────
    sid          = item.get("id", "")
    lob_canon    = _norm_lob(parsed.get("l1") or item.get("lob", ""))
    overview_full = parsed.get("overview", "")
    overview     = overview_full[:300] if questions else overview_full[:500]
    flow_steps   = " → ".join(parsed.get("flow_steps", [])[:6])
    step_count   = len(parsed.get("flow_steps", []))
    kdd_sample   = "; ".join(r.get("designQuestion", "")[:60] for r in kdd_rows[:3])
    lob_hint     = _LOB_INTELLIGENCE_HINTS.get(lob_canon, "")
    name_lower   = (item.get("name") or "").lower()
    name_hint    = next((v for k, v in _SCOPE_NAME_HINTS.items() if k in name_lower), "")
    _lob_iso_map = _COUNTRY_LOB_HINTS.get(lob_canon, {})
    country_hint = "\n\n".join(
        _lob_iso_map[iso] for iso in ws_country_isos if iso in _lob_iso_map
    ) if ws_country_isos else ""

    if name_hint:
        fact_base = (name_hint + "\n\n" + country_hint + "\n\n" + lob_hint).strip() if country_hint \
                    else (name_hint + "\n\n" + lob_hint).strip()
    elif country_hint:
        fact_base = (country_hint + "\n\n" + lob_hint).strip()
    else:
        fact_base = lob_hint

    # ── BDCQ section (shared between brief and decisions tasks) ───────────────
    l1_qs    = [q for q in questions if q.get("level") == "L1"]
    l2_qs    = [q for q in questions if q.get("level") == "L2"]
    l3_qs    = [q for q in questions if q.get("level") not in ("L1", "L2")]
    has_bdcq = bool(questions)

    if has_bdcq:
        lines = []
        for q in l1_qs:
            lines.append(f"[L1 CRITICAL] [{q.get('topic','')[:30]}] {q.get('question','')[:110]}")
        for q in l2_qs[:5]:
            lines.append(f"[L2] [{q.get('topic','')[:30]}] {q.get('question','')[:110]}")
        for q in l3_qs[:2]:
            lines.append(f"[L3] [{q.get('topic','')[:30]}] {q.get('question','')[:110]}")
        bdcq_section = (
            f"BDCQ QUESTIONS ({len(questions)} loaded — showing top {len(lines)}):\n"
            + "\n".join(lines)
        )
    else:
        bdcq_section = (
            "NO BDCQ QUESTIONS LOADED for this scope item.\n"
            "Use the scope item name and FULL description as the only scope-specific source.\n"
            "FORBIDDEN: generic phrases like 'confirm organisational structure', "
            "'agree master data migration', 'confirm integration touchpoints'."
        )

    # ── LOB-specific decisions fallback ───────────────────────────────────────
    _DEC_FALLBACK = _TOP_DECISIONS_LOB_FALLBACK.get(lob_canon) or [
        {"question": "Confirm organisational structure assignment for this process",
         "why": "Org units drive config — must be locked before Realize sprint 1",
         "owner": "Business Process Owner"},
        {"question": "Agree master data migration scope and quality threshold",
         "why": "Poor data quality is top go-live risk",
         "owner": "Data Migration Lead"},
        {"question": "Confirm integration touchpoints and interface ownership",
         "why": "Integration build starts in Realize — delay risks go-live",
         "owner": "IT Architecture Lead"},
    ]

    _GENERIC_PHRASES = frozenset({
        "confirm organisational structure",
        "agree master data migration",
        "confirm integration touchpoints",
    })

    def _is_generic(d: dict) -> bool:
        return any(ph in d.get("question", "").lower() for ph in _GENERIC_PHRASES)

    # ── Merged prompt ─────────────────────────────────────────────────────────
    fact_section = (
        f"\nSUPPLEMENTARY LOB FACTS (Fiori app codes F-XXXX, extension paths, integration patterns):\n{fact_base}"
        if fact_base else ""
    )
    kdd_line = f"PRIOR KDD: {kdd_sample}\n" if kdd_rows else ""

    if has_bdcq:
        a_ground = "Ground every bullet in BDCQ questions or LOB facts above."
        d1_rule  = "1. Each decision MUST trace to a BDCQ topic above — do NOT introduce absent topics.\n"
        d4_rule  = "4. PRIORITY: convert L1 CRITICAL BDCQ questions into decision statements.\n"
    else:
        a_ground = "Ground every bullet in the scope item name and description — the description is your only scope-specific source."
        d1_rule  = ("1. Each decision MUST trace to something named in the description above. "
                    "Do NOT introduce topics absent from the description.\n")
        d4_rule  = ("4. PRIORITY: name specific config objects — chart of accounts type, dimension, "
                    "accelerator bundle, regulatory framework, data source system.\n")

    prompt = (
        f"You are a senior SAP S/4HANA Cloud PE consultant preparing a Fit-to-Standard workshop.\n\n"
        f"SCOPE ITEM: {sid} — {item.get('name')}\n"
        f"LOB: {lob_canon}\n"
        f"PROCESS OVERVIEW: {overview}\n"
        f"L5 STEPS ({step_count} total): {flow_steps}\n"
        + kdd_line
        + f"\n{bdcq_section}\n"
        + fact_section
        + "\n\n== TASK A — WORKSHOP BRIEF ==\n"
        "Derive content from BDCQ questions above. Use LOB facts for Fiori app codes (F-XXXX).\n"
        f"Return field \"brief\" with 5 keys (max 130 chars per bullet):\n"
        f"\"standard_delivers\": 4 bullets — specific Fiori app + what it delivers for {sid}\n"
        "\"config_areas\": 3-4 bullets — config area from BDCQ topic + specific decision\n"
        "\"gap_watchpoints\": 2-3 bullets — describe the specific Cloud PE standard limit "
        "(what standard does NOT deliver), not the downstream impact of the gap; "
        "only classify as a gap if the feature is genuinely absent from Cloud PE standard delivery; "
        "if the scope item description mentions deprecation or a successor, make the first "
        "gap watch-point a deprecation risk stating the successor scope item\n"
        "\"integration_points\": 2 bullets — source→target system + SAP API or iFlow\n"
        "\"facilitation_tips\": 3 bullets — (1) L1 BDCQ to open with, (2) topic to timebox, (3) Fiori app to demo first\n"
        f"{a_ground}\n"
        "\n== TASK B — TOP 3 DECISIONS ==\n"
        "Identify exactly 3 decisions this workshop MUST resolve today to avoid blocking Realize.\n"
        "RULES:\n"
        + d1_rule
        + "2. Specific to this scope item and answerable within its session.\n"
        "3. FORBIDDEN programme-level topics: licensing, system selection, EDI partner counts, "
        "rollout country selection, total org unit counts.\n"
        + d4_rule
        + "Return field \"decisions\" as array of 3 objects: "
        "{\"question\":\"max 15 words\",\"why\":\"max 20 words\",\"owner\":\"max 6 words\"}\n"
        "\nTERMINOLOGY: Never use 'on-prem', 'on-premise', 'ABAP', 'ECC', 'SAP GUI'. "
        "Say 'legacy system' when referring to a prior system being replaced.\n"
        "\nFIORI APPS: The LOB facts above list example apps for the broader line of business. "
        "Only include a Fiori app if it directly supports a step or activity in the scope item "
        "overview above. Do not list an app solely because it appears in the LOB facts. "
        "IMPORTANT: if the scope item overview describes an API, interface, or middleware "
        "integration (keywords: SOAP, API, Communication Scenario, Communication Arrangements, "
        "middleware, web service), this scope item has no end-user Fiori apps — state "
        "'Configured via Communication Arrangements — no standalone Fiori apps for this scope "
        "item' in the standard_delivers section instead of listing apps.\n"
        f"\nSCOPE ISOLATION: Every bullet in brief and every decision must relate exclusively "
        f"to {sid} ({item.get('name')}). Do not generate content that belongs to a different "
        "scope item — LOB facts apply to the whole LOB but decisions and gaps must be "
        "specific to this scope item only.\n"
        "\nReturn ONE JSON object only — no markdown fences:\n"
        "{\"brief\":{...},\"decisions\":[...]}"
    )

    # ── Call + fallback ───────────────────────────────────────────────────────
    brief_out: dict = {}
    dec_out:   list = []

    for attempt in range(2):
        try:
            raw  = await _claude(prompt, timeout=95)
            s, e = raw.find("{"), raw.rfind("}")
            if s >= 0 and e > s:
                data = json.loads(raw[s:e + 1])
                b = data.get("brief", {})
                if isinstance(b, dict) and {"standard_delivers", "config_areas", "gap_watchpoints"}.issubset(b):
                    brief_out = b
                d = data.get("decisions", [])
                if isinstance(d, list) and len(d) >= 1:
                    gen_cnt = sum(1 for x in d if _is_generic(x))
                    if gen_cnt >= 2:
                        log.info("Merged %s: %d generic decisions — LOB fallback", sid, gen_cnt)
                        dec_out = _DEC_FALLBACK
                    else:
                        dec_out = (d + _DEC_FALLBACK)[:3]
                if brief_out or dec_out:
                    break
        except Exception as exc:
            log.warning("Merged brief+decisions %s (attempt %d): %s", sid, attempt + 1, exc)

    if not dec_out:
        dec_out = _DEC_FALLBACK

    if not brief_out:
        # Mine fact_base sentences into brief sections — always populated via name/lob hints
        name   = item.get("name", "this process")
        steps  = parsed.get("flow_steps", [])
        step1  = steps[0] if steps else name
        source = (name_hint + "\n\n" + lob_hint).strip() if name_hint else (lob_hint or "")
        facts  = [s.strip() for s in re.split(r"[.!]", source) if len(s.strip()) > 25]
        delivers = [f for f in facts if any(w in f.lower() for w in ("fiori", "f-0", "f-1", "f-2", "f-3", "f-4", "f-5"))][:4]
        configs  = [f for f in facts if any(w in f.lower() for w in ("config", "assign", "define", "activate", "hierarchy", "setup"))][:3]
        gaps     = [f for f in facts if any(w in f.lower() for w in ("gap", "beyond", "not supported", "requires btp", "custom", "parallel ledger"))][:3]
        tips     = [f for f in facts if any(w in f.lower() for w in ("facilitate", "confirm", "ask", "drives", "unlock", "single", "decision"))][:3]
        _pad_d = [
            f"{sid} scope item activated in Cloud PE tenant via 'Manage Your Solution' Fiori app",
            f"Standard output management (PDF/email/EDI) via SAP output framework for {name}",
            f"Standard SAP business roles assigned via 'Maintain Business Roles' (F-2338)",
            f"Approval workflows routed via standard task inbox (My Inbox Fiori app)",
        ]
        _pad_c = [
            f"Activate {sid} via 'Manage Your Solution' — confirm scope item is switched on in tenant",
            f"Configure {lob_canon} org structure (company code, business area) before {sid} go-live",
            f"Assign standard {lob_canon} business roles via 'Maintain Business Roles' (F-2338)",
        ]
        _pad_g = [
            f"Reporting beyond standard {lob_canon} Fiori analytics — evaluate BTP SAP Analytics Cloud",
            f"Client-specific {name} variants outside Cloud PE Best Practice — scope and document deltas",
        ]
        _pad_t = [
            f"Demo {name} in Fiori launchpad first — shows the end-state before gap discussion starts",
            f"Key unlock: 'Does {step1} follow the SAP Best Practice sequence exactly?'",
            f"Timebox gap identification to 20 min — park detailed rules in the KDD parking lot",
        ]

        def _wb(s: str, limit: int = 122) -> str:
            return s if len(s) <= limit else s[:limit].rsplit(" ", 1)[0] + "…"

        def _dedup(lst: list) -> list:
            seen: set = set()
            return [x for x in lst if not (x in seen or seen.add(x))]

        while len(delivers) < 4: delivers.append(_pad_d[len(delivers) % len(_pad_d)])
        while len(configs)  < 3: configs.append(_pad_c[len(configs)  % len(_pad_c)])
        while len(gaps)     < 2: gaps.append(_pad_g[len(gaps)        % len(_pad_g)])
        while len(tips)     < 3: tips.append(_pad_t[len(tips)        % len(_pad_t)])

        brief_out = {
            "standard_delivers": [_wb(b) for b in _dedup(delivers)[:4]],
            "config_areas":      [_wb(b) for b in _dedup(configs)[:3]],
            "gap_watchpoints":   [_wb(b) for b in _dedup(gaps)[:3]],
            "integration_points": [
                _wb(f"{sid} → downstream {lob_canon} processes: confirm document handoff via Cloud PE standard APIs"),
                _wb(f"External system connectivity: confirm iFlow or API artefact via SAP Integration Suite"),
            ],
            "facilitation_tips": [_wb(b) for b in _dedup(tips)[:3]],
        }

    return brief_out, dec_out


_API_SCOPE_RE = re.compile(
    r"\b(SOAP|web service|Communication Scenario|Communication Arrangement|"
    r"middleware|API|REST|OData|iFlow|integration flow)\b",
    re.IGNORECASE,
)


async def _day_in_life_brief(item: dict, parsed: dict) -> dict:
    """Return {before: [5 bullets], after: [5 bullets]}."""
    sid      = item.get("id", "")
    name     = item.get("name", sid)
    overview = parsed.get("overview", "")[:300]
    steps    = ", ".join(parsed.get("flow_steps", [])[:8])
    benefits = "; ".join(parsed.get("benefits", [])[:4])

    _FALLBACK = {
        "before": [
            f"Use fragmented manual tools and workarounds for {name[:28]}",
            "Export data to Excel for manual review and approval",
            "Call colleagues to check inventory or order status",
            "Wait overnight for batch job results",
            "Print reports and distribute by email",
        ],
        "after": [
            f"Open Fiori launchpad — run {name[:28]} in one click",
            "Real-time analytics — no exports, live dashboard in SAC",
            "Instant status visibility via Fiori app — no phone calls",
            "Real-time MRP and availability — no batch wait",
            "Digital approval in My Inbox — any device, any location",
        ],
    }
    prompt = (
        f"Scope item: {name} ({sid})\n"
        f"SAP process: {overview}\n"
        f"Process steps in Cloud PE: {steps}\n"
        f"Benefits: {benefits}\n\n"
        "Write a Day-in-the-Life comparison for business users attending a Fit-to-Standard workshop.\n"
        "Current state: 5 pain-point bullets describing what users do TODAY "
        "(manual steps, Excel workarounds, phone calls, waiting for batch jobs, printing reports). "
        f"Be specific to {sid} — do NOT reference ECC, R/3, or SAPGUI. "
        "Use 'legacy system' or 'previous system' — never 'on-prem' or 'on-premise'.\n"
        "Future state: 5 benefit bullets describing what users do WITH S/4HANA Cloud PE "
        f"for {sid}, naming specific Fiori app names where applicable.\n"
        "API/INTERFACE EXCEPTION: if the scope item is an API, SOAP service, or middleware "
        "integration (no end-user Fiori interface), describe the operational benefit to the "
        "team responsible — do not fabricate Fiori app names that do not exist for this scope item.\n"
        "PAIRING RULE: before[N] and after[N] must describe the SAME task or pain point — "
        "before describes the manual/legacy version, after describes the Cloud PE solution. "
        "Do not mix topics between rows.\n"
        "SCOPE ISOLATION: all bullets must be specific to this scope item — "
        "do not include content from other scope items in this session.\n"
        "Keep each bullet under 12 words.\n"
        'Return JSON only (no markdown):\n'
        '{"before": ["bullet1", "bullet2", "bullet3", "bullet4", "bullet5"], '
        '"after": ["bullet1", "bullet2", "bullet3", "bullet4", "bullet5"]}'
    )
    try:
        raw = await _claude(prompt, timeout=55)
        s, e = raw.find("{"), raw.rfind("}")
        if s >= 0 and e > s:
            data = json.loads(raw[s:e + 1])
            if (isinstance(data, dict) and
                    "before" in data and "after" in data and
                    len(data["before"]) >= 1 and len(data["after"]) >= 1):
                return data
    except Exception as exc:
        log.warning("Day-in-life for %s: %s", sid, exc)
    return _FALLBACK


# ── SLIDE E: TOP 3 DECISIONS ───────────────────────────────────────────────────

def _top_decisions(prs, footer: str, item: dict, decisions: list, brand: RGBColor):
    """Top 3 Decisions Needed Today — large stacked call-out boxes."""
    _CHIP_AMBER = RGBColor(0xFF, 0xA5, 0x00)

    sl = _blank(prs)
    sid   = item.get("id", "")
    sname = item.get("name", "")
    _header(sl, "Focus", "Top 3 Decisions Needed Today", footer, brand)
    _tx(sl, 0.3, 1.68, 12.5, 0.26,
        f"For {sname} — resolve these before the session ends to avoid Realize blockers",
        size=9, italic=True, color=_MUTED)

    BOX_H   = 1.42
    BOX_GAP = 0.18
    START_Y = 1.98

    for i, dec in enumerate((decisions + [{}, {}, {}])[:3]):
        y        = START_Y + i * (BOX_H + BOX_GAP)
        question = dec.get("question", f"Decision {i+1} — to be confirmed in workshop")
        why      = dec.get("why", "Must be resolved before Realize phase begins")
        owner    = dec.get("owner", "Business Process Owner")

        # Card background
        _rect(sl, 0.30, y, 12.73, BOX_H, _AC_ALT)
        # Left brand accent
        _rect(sl, 0.30, y, 0.08,  BOX_H, brand)

        # Number badge (circle approximated by small square with bold text)
        _rect(sl, 0.46, y + 0.40, 0.52, 0.52, brand)
        _tx(sl, 0.46, y + 0.40, 0.52, 0.52, str(i + 1),
            size=16, bold=True, color=_WHITE, align=PP_ALIGN.CENTER)

        # Decision question
        _tx(sl, 1.08, y + 0.10, 9.80, 0.44, question,
            size=13, bold=True, color=_INK)

        # Why critical
        _tx(sl, 1.08, y + 0.58, 9.80, 0.28,
            f"Why critical:  {why}", size=10, italic=True, color=_MUTED)

        # Owner
        _tx(sl, 1.08, y + 0.90, 4.50, 0.28,
            f"Owner:  {owner}", size=10, bold=True, color=brand)

        # OPEN status chip
        _rect(sl, 11.18, y + 0.58, 1.20, 0.30, _CHIP_AMBER)
        _tx(sl, 11.18, y + 0.59, 1.20, 0.28, "OPEN",
            size=9, bold=True, color=_WHITE, align=PP_ALIGN.CENTER)


# ── SLIDE F: DAY-IN-THE-LIFE ───────────────────────────────────────────────────

def _day_in_life(prs, footer: str, item: dict, dil: dict, brand: RGBColor):
    """Day-in-the-Life: Before & After split slide."""
    _DARK_LEFT  = RGBColor(0x4A, 0x4A, 0x4A)
    _DARK_RIGHT = RGBColor(0x00, 0x6B, 0x54)

    sl = _blank(prs)
    sname = item.get("name", "")
    _header(sl, "User Experience", "Day-in-the-Life: Before & After", footer, brand)
    _tx(sl, 0.3, 1.68, 12.5, 0.26,
        f"{sname} — how this process changes for your team",
        size=9, italic=True, color=_MUTED)

    # Column header bars
    _rect(sl, 0.30, 1.97, 6.22, 0.35, _DARK_LEFT)
    _tx(sl, 0.30, 1.97, 6.22, 0.35, "TODAY (Current State)",
        size=10, bold=True, color=_WHITE, align=PP_ALIGN.CENTER)
    _rect(sl, 6.81, 1.97, 6.22, 0.35, _DARK_RIGHT)
    _tx(sl, 6.81, 1.97, 6.22, 0.35, "WITH S/4HANA CLOUD PE",
        size=10, bold=True, color=_WHITE, align=PP_ALIGN.CENTER)

    before_bullets = (dil.get("before") or [])[:5]
    after_bullets  = (dil.get("after")  or [])[:5]

    # LEFT column
    _rect(sl, 0.30, 2.36, 6.22, 4.30, _DARK_LEFT)
    y = 2.44
    for b in before_bullets:
        _tx(sl, 0.46, y, 5.90, 0.72, f"✗  {b}", size=10, color=_WHITE)
        y += 0.80

    # RIGHT column
    _rect(sl, 6.81, 2.36, 6.22, 4.30, _DARK_RIGHT)
    y = 2.44
    for b in after_bullets:
        _tx(sl, 6.96, y, 5.90, 0.72, f"✓  {b}", size=10, color=_WHITE)
        y += 0.80

    # Bottom brand strip
    _rect(sl, 0.30, 6.70, 12.73, 0.36, brand)
    _tx(sl, 0.42, 6.72, 12.40, 0.30,
        "This transformation is delivered standard — no custom development required",
        size=9, bold=True, color=_WHITE, align=PP_ALIGN.CENTER)


# ─────────────────────────────────────────────────────────────────────────────

def _closing(prs, footer: str, brand: RGBColor,
             client: str = "", scope_ids: list = None, lobs: set = None):
    sl = _blank(prs)
    bg = sl.background.fill
    bg.solid(); bg.fore_color.rgb = _AC_DARK

    _tx(sl, 0.4, 1.6, 4.0, 2.0, ">", size=100, bold=True,
        color=brand, align=PP_ALIGN.LEFT)
    _tx(sl, 0.4, 1.6, 12.0, 0.85,
        "Questions & Next Steps", size=32, bold=True, color=_WHITE)

    # Personalised scope summary line
    scope_str = ", ".join((scope_ids or [])[:6])
    lob_str   = " & ".join(sorted(lobs or []))
    if client and scope_str:
        _tx(sl, 0.5, 2.55, 12.2, 0.42,
            f"{client}  ·  Scope: {scope_str}  ·  {lob_str}",
            size=11, italic=True, color=_AC_LIGHT)

    bullets = [
        "Review the parking lot — every open item needs an owner and due date before we close",
        "Confirm all KDD decision owners now — decisions deferred past Explore block Realize",
        "Cloud ALM task list will be updated as agreed with the project team — action items assigned by owner",
        "Next session date and pre-read materials confirmed by facilitator within the agreed timeline",
        "Upload the BDCQ completed workbook to Cloud ALM before the next session",
    ]
    y = 3.10
    for b in bullets:
        _tx(sl, 0.5, y, 12.3, 0.42, f"•  {b}", size=11, color=_AC_LIGHT)
        y += 0.46

    _footer(sl, footer)

    _rect(sl, 0.0, 7.05, 13.33, 0.45, brand)
    _tx(sl, 0.3, 7.09, 12.7, 0.36,
        "Accenture · SAP Business Group · Explore Phase Accelerator",
        size=9, color=_WHITE)


# ── PUBLIC API ────────────────────────────────────────────────────────────────

async def build_async(meta: dict, scope_ids: list) -> tuple:
    """
    Build the enriched F2S workshop deck asynchronously.
    Returns (output_path, slide_count, omissions, elapsed_sec, token_counts).
    Primary content source: f2s/ domain .md files (clean text, L5 steps, benefits).
    Fallback: scope-catalog.json HTML descriptions.
    """
    _tokens: dict = {"prompt": 0, "completion": 0}
    _build_tokens_var.set(_tokens)
    _t0 = time.monotonic()

    catalog              = _load_catalog(ROOT / "scope-catalog.json")
    f2s_idx              = _load_f2s_index()
    scope_bdcq_idx, lob_bdcq_idx, domain_bdcq_idx = _build_bdcq_indexes(
        ROOT / "bdcq" / "bdcq-questions.json")
    kdd_cache            = _load_kdd_cache(ROOT / "kdd-cache.json")

    omissions: list = []
    brand       = _hex_rgb(meta.get("brandColor") or "#A100FF")
    client      = meta.get("clientName") or "[Client]"
    ws_date     = meta.get("workshopDate") or date.today().strftime("%d %B %Y")
    _raw_countries  = meta.get("countries") or ([meta.get("country")] if meta.get("country") else [])
    ws_country_isos = frozenset(
        iso for c in _raw_countries
        for iso in [_COUNTRY_ISO.get(c.lower().strip(), "")] if iso
    )
    _def_rel, _ = current_sap_release()
    release     = meta.get("release", _def_rel)
    deck_ver    = meta.get("deckVersion", "v1")
    base_foot   = (f"{client}  ·  SAP S/4HANA Cloud PE  ·  "
                   f"Release {release}  ·  {ws_date}  ·  {deck_ver}")

    # Facilitator name sanity check — a single initial (e.g. "J") means the field was truncated
    _facilitator = (meta.get("facilitator") or "").strip()
    if _facilitator and len(_facilitator) < 3:
        omissions.append(
            f"WARNING: facilitator name '{_facilitator}' appears incomplete (< 3 chars) "
            "— update in deck settings before distributing to client"
        )

    # ── Pre-phase pass 1 (sync): catalog lookup + f2s content + Pattern A BDCQ ──
    # No Claude calls here — purely CPU/disk work so all items resolve in parallel later.
    scope_items:    list = []
    scope_parseds:  dict = {}
    scope_questions: dict = {}

    # Items that need a Claude call to select BDCQ questions (Pattern A+, B, or C).
    # Shape: (sid, item, parsed, pattern, pool, a_texts_to_exclude)
    _bdcq_pending: list = []

    for raw_sid in scope_ids:
        sid  = raw_sid.strip().upper()
        item = catalog.get(sid) or catalog.get(raw_sid.strip())
        if not item:
            f2s_entry = f2s_idx.get(sid)
            if f2s_entry:
                item = {
                    "id":          sid,
                    "name":        f2s_entry.get("name", sid),
                    "lob":         f2s_entry.get("l1", "Unknown"),
                    "l2":          f2s_entry.get("l2", ""),
                    "description": "",
                }
                omissions.append(f"{sid}: not in scope-catalog.json — content loaded from f2s/ folder")
            else:
                omissions.append(f"{sid}: not found in scope-catalog.json or f2s/ index — skipped")
                continue

        # f2s/ content (primary source)
        parsed = _load_f2s_content(sid, f2s_idx)
        if not parsed["overview"] and not parsed["flow_steps"]:
            parsed_fb = _parse_desc(item.get("description") or "")
            if parsed_fb["overview"] or parsed_fb["flow_steps"]:
                parsed = {**parsed_fb, "l1": parsed.get("l1", ""), "l2": parsed.get("l2", "")}

        # Pattern A — direct scope ID match (no Claude call needed)
        _lob_for_filter = _norm_lob(parsed.get("l1") or item.get("lob", ""))
        _direct_match   = scope_bdcq_idx.get(sid, [])
        questions: list = []
        if _direct_match:
            filtered = _filter_bdcq_pool(_direct_match, ws_country_isos, _lob_for_filter,
                                         item_name=item.get("name", ""))
            working  = filtered if (filtered or ws_country_isos) else _direct_match
            _seen_q: set  = set()
            _deduped: list = []
            for _q in working:
                _qtxt = _q.get("question", "")
                if _qtxt not in _seen_q:
                    _seen_q.add(_qtxt)
                    _deduped.append(_q)
            questions = _deduped

        # Normalize LOB — do this now so item.lob is correct when building pending tasks
        _l1_norm = _norm_lob(parsed.get("l1") or item.get("lob", ""))
        _l2_raw  = item.get("l2", "")
        _l2_norm = _norm_lob(_l2_raw)
        item = {**item,
                "lob": _l1_norm,
                "l2":  _l2_norm if _l2_norm in _CANONICAL_LOBS else _l1_norm}

        scope_items.append(item)
        scope_parseds[sid]   = parsed
        scope_questions[sid] = questions  # may be empty — filled by pass 2

        # Queue Claude BDCQ selection if Pattern A is absent or sparse
        _MIN_DIRECT_BDCQ = 4
        if 0 < len(questions) < _MIN_DIRECT_BDCQ:
            _bdcq_dom_a = _F2S_TO_BDCQ_DOMAIN.get(_lob_for_filter)
            _lob_pool_a = lob_bdcq_idx.get(_bdcq_dom_a, []) if _bdcq_dom_a else []
            if _lob_pool_a:
                _bdcq_pending.append(
                    ("A+", sid, item, parsed, _lob_pool_a,
                     {q.get("question", "") for q in questions},
                     _MIN_DIRECT_BDCQ + 4 - len(questions))
                )
        elif not questions:
            l1          = _l1_norm
            bdcq_domain = _F2S_TO_BDCQ_DOMAIN.get(l1)
            lob_pool    = lob_bdcq_idx.get(bdcq_domain, []) if bdcq_domain else []
            domain_pool = domain_bdcq_idx.get(bdcq_domain, []) if bdcq_domain else []
            pool        = lob_pool or domain_pool
            pattern     = "B" if lob_pool else ("C" if domain_pool else None)
            if pattern:
                _bdcq_pending.append(("B/C", sid, item, parsed, pool, set(), 12))
            else:
                omissions.append(f"{sid}: no BDCQ data for LOB '{l1}' — "
                                 "scan from SAP Roadmap Viewer")

    # ── Pre-phase pass 2 (async parallel): all BDCQ Claude selections at once ──
    # Previously sequential (one await per scope item) — now all run concurrently.
    # Cross-item question deduplication is skipped: pools are large (100–400 questions)
    # and items typically span different LOBs; within-LOB overlap is negligible.
    async def _select_bdcq_for(entry: tuple) -> None:
        pattern, sid, item, parsed, pool, a_texts, max_q = entry
        if pattern == "A+":
            log.info("BDCQ %s: Pattern A sparse — supplementing from LOB pool", sid)
            sup = await _claude_select_bdcq(
                item, parsed, pool, max_q=max_q,
                exclude_texts=a_texts, ws_country_isos=ws_country_isos)
            if sup:
                scope_questions[sid] = scope_questions[sid] + sup
                omissions.append(
                    f"{sid}: BDCQ Pattern A sparse ({len(a_texts)}) — "
                    f"supplemented with {len(sup)} LOB pool questions "
                    f"(total {len(scope_questions[sid])})")
        else:
            lob_label = "LOB domain" if pattern == "B" else "full domain"
            log.info("BDCQ %s: Pattern %s — selecting from %d questions", sid, pattern, len(pool))
            qs = await _claude_select_bdcq(
                item, parsed, pool, max_q=max_q,
                exclude_texts=a_texts, ws_country_isos=ws_country_isos)
            if qs:
                scope_questions[sid] = qs
                omissions.append(
                    f"{sid}: BDCQ matched via {lob_label} (Pattern {pattern}) — "
                    f"{len(qs)} questions selected by Claude")
            else:
                omissions.append(f"{sid}: BDCQ Claude selection returned nothing — "
                                 "load from SAP Roadmap Viewer for exact scope mapping")

    if _bdcq_pending:
        await asyncio.gather(*[_select_bdcq_for(e) for e in _bdcq_pending])

    if not scope_items:
        raise ValueError("None of the requested scope IDs were found in scope-catalog.json or f2s/ index")

    # Enrich l2 from parsed content into every item before _scope_overview uses it.
    # The per-scope loop creates local copies, so we must do this now on the shared list.
    # Use `not it.get("l2")` instead of `"l2" not in it` so empty-string catalog placeholders
    # are also replaced by the richer value from f2s/ markdown.
    scope_items = [
        {**it, "l2": scope_parseds[it["id"]].get("l2", "")}
        if not it.get("l2") and scope_parseds.get(it["id"], {}).get("l2")
        else it
        for it in scope_items
    ]

    lobs = {_norm_lob(item.get("lob", "")) for item in scope_items}

    # ── Batch all per-scope Claude calls (brief + day-in-life + top decisions) ─
    scope_briefs:    dict = {}
    scope_dil:       dict = {}
    scope_decisions: dict = {}

    async def _fetch_all_briefs(item):
        sid       = item.get("id", "")
        parsed    = scope_parseds[sid]
        questions = scope_questions[sid]
        kdd_rows  = kdd_cache.get(sid, [])
        try:
            (brief, decisions), dil = await asyncio.gather(
                _scope_and_decisions_brief(item, parsed, questions, kdd_rows, ws_country_isos),
                _day_in_life_brief(item, parsed),
            )
        except Exception as exc:
            log.warning("Batch briefs for %s: %s", sid, exc)
            brief     = {}
            dil       = {"before": [], "after": []}
            decisions = []
        scope_briefs[sid]    = brief
        scope_dil[sid]       = dil
        scope_decisions[sid] = decisions

    await asyncio.gather(*[_fetch_all_briefs(item) for item in scope_items])

    prs = Presentation()
    prs.slide_width  = Inches(13.33)
    prs.slide_height = Inches(7.5)

    # Fixed slides (use pre-resolved scope_questions for pre_workshop counts)
    _lob_label = next(iter(lobs)) if len(lobs) == 1 else f"{len(lobs)} Lines of Business"
    _cover(prs, meta, len(scope_items), brand, lob_label=_lob_label)
    _agenda(prs, base_foot, len(scope_items), len(lobs), brand)
    _pre_workshop(prs, base_foot, scope_items, scope_questions, brand)
    _participants(prs, base_foot,
                  meta.get("facilitator", ""), meta.get("customerProcessOwner", ""), brand)
    _guidelines(prs, base_foot, brand)
    _approach(prs, base_foot, brand)
    _outcomes(prs, base_foot, brand)
    _scope_overview(prs, base_foot, scope_items, brand)

    # Global executive slides (after scope overview)
    _value_scorecard(prs, base_foot, scope_items, scope_parseds, brand)
    _fit_heat_map(prs, base_foot, scope_items, kdd_cache, brand)
    _integration_landscape(prs, base_foot, lobs, brand)

    # Per-scope packages
    all_kdd_rows = []
    for item in scope_items:
        sid   = item.get("id", "")
        sname = item.get("name", "")
        lob   = _norm_lob(item.get("lob", ""))
        parsed    = scope_parseds[sid]
        questions = scope_questions[sid]

        kdd_rows   = kdd_cache.get(sid, [])
        all_kdd_rows.extend(kdd_rows)
        bdcq_count = len(questions)
        kdd_count  = len(kdd_rows)
        item_foot  = (f"{client}  ·  {sid}  ·  "
                      f"Release {release}  ·  {ws_date}  ·  {deck_ver}")

        brief     = scope_briefs.get(sid, {})
        dil       = scope_dil.get(sid, {"before": [], "after": []})
        decisions = scope_decisions.get(sid, [])

        # Section divider
        _divider(prs, lob, sid, sname, item_foot, brand)

        # Identity (overview + benefits + at-a-glance stats) + process flow boxes
        _identity(prs, item_foot, item, parsed, brand, bdcq_count, kdd_count)
        _process_flow(prs, item_foot, item, parsed.get("flow_steps", []), brand)

        # Day-in-the-Life (after process flow)
        _day_in_life(prs, item_foot, item, dil, brand)

        # Claude workshop intelligence brief
        _workshop_brief(prs, item_foot, item, brief, brand)

        # Top 3 Decisions (after workshop brief)
        _top_decisions(prs, item_foot, item, decisions, brand)

        # BDCQ — placeholder slide when not loaded so the deck structure is always complete
        if questions:
            _bdcq_slide(prs, item_foot, item, questions, brand)
        else:
            _bdcq_no_data(prs, item_foot, item, brand)
            # Only log the placeholder omission if no BDCQ error was already recorded for this ID
            if not any(o.startswith(f"{sid}:") and "BDCQ" in o for o in omissions):
                omissions.append(f"{sid}: BDCQ not loaded — placeholder slide added with extension instructions")

        # KDD decisions + RICEFW
        if kdd_rows:
            _kdd_decisions(prs, item_foot, item, kdd_rows, brand)
            _ricefw_slide(prs, item_foot, item, kdd_rows, brand)

    # Consolidated summary — always render so all scope items appear,
    # even those with no KDD cache (shown as TBC in the table).
    _kdd_summary(prs, base_foot, all_kdd_rows, brand, scope_items=scope_items)

    _parking_lot(prs, base_foot, brand,
                 rows=meta.get("parkingLotRows", _DEFAULT_PARKING_LOT_ROWS))
    _kdd_log_format(prs, base_foot, brand, lobs=lobs)

    # Risk register (before closing)
    _risk_register(prs, base_foot, lobs, brand)

    _closing(prs, base_foot, brand,
             client=client,
             scope_ids=[item.get("id","") for item in scope_items],
             lobs=lobs)

    out_dir  = ROOT / "output"
    out_dir.mkdir(exist_ok=True)
    safe_cli = re.sub(r"[^\w]", "_", client)[:20]
    filename = f"F2S_Workshop_{safe_cli}_{date.today().strftime('%Y%m%d')}.pptx"
    out_path = out_dir / filename
    prs.save(str(out_path))

    elapsed = round(time.monotonic() - _t0, 1)
    return out_path, len(prs.slides), omissions, elapsed, dict(_build_tokens_var.get() or {})


def build(meta: dict, scope_ids: list) -> tuple:
    """Sync wrapper — used by tests and the old route."""
    try:
        asyncio.get_running_loop()
        # Already inside a running event loop (e.g. called from an async context in tests)
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, build_async(meta, scope_ids)).result()
    except RuntimeError:
        # No running loop — safe to use asyncio.run()
        return asyncio.run(build_async(meta, scope_ids))
