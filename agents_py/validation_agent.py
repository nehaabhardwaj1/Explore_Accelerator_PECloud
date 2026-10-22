# agents_py/validation_agent.py — Stage 5: Cloud PE compliance check + auto-fix
import re
import logging
from .shared import KDD_REQUIRED_FIELDS, FORBIDDEN_TERMS, AUTO_REPLACEMENTS

log = logging.getLogger(__name__)

SCANNABLE_FIELDS = [
    "designQuestion", "rationale", "impactActions", "notes", "l1", "l2",
    "ricefTitle", "extensibilityType",
]
VALID_FIT_GAP    = {"Fit", "Partial Fit", "Gap"}
VALID_COMPLEXITY = {"Low", "Medium", "High"}
VALID_PHASE      = {"Explore", "Realize", "Deploy"}

# "ABAP Cloud" / "Developer ABAP Cloud" are valid Cloud PE extensibility terms
ALLOWED_PATTERNS = ["abap cloud", "developer abap cloud"]


def _is_forbidden_in_context(val: str, term: str) -> bool:
    lower    = val.lower()
    term_low = term.lower()
    if term_low not in lower:
        return False
    idx = 0
    while (pos := lower.find(term_low, idx)) != -1:
        ctx = lower[max(0, pos - 5): pos + len(term_low) + 10]
        if not any(p in ctx for p in ALLOWED_PATTERNS):
            return True
        idx = pos + len(term_low)
    return False


def _scan_forbidden(rows: list) -> list:
    violations = []
    for i, row in enumerate(rows):
        for field in SCANNABLE_FIELDS:
            val = row.get(field, "") or ""
            for term in FORBIDDEN_TERMS:
                if _is_forbidden_in_context(val, term):
                    violations.append({
                        "row":   i + 1,
                        "kddId": row.get("kddId", f"row-{i+1}"),
                        "field": field,
                        "term":  term,
                        "sample": val[:80],
                    })
    return violations


# Module-level compiled regex for _auto_fix — built once, reused on every call.
# Single alternation so each text position is matched at most once, preventing
# a replacement value from being re-processed by a later rule.
_AUTO_FIX_RE = re.compile(
    "|".join(f"(?P<t{i}>{re.escape(t)})" for i, t in enumerate(AUTO_REPLACEMENTS)),
    re.IGNORECASE,
)
_AUTO_FIX_KEYS = list(AUTO_REPLACEMENTS.keys())


def _auto_fix_replace(m: re.Match) -> str:
    for i, key in enumerate(_AUTO_FIX_KEYS):
        if m.group(f"t{i}") is not None:
            return AUTO_REPLACEMENTS[key]
    return m.group()


def _auto_fix(rows: list) -> list:

    fixed = []
    for row in rows:
        r = dict(row)
        for field in SCANNABLE_FIELDS:
            val = r.get(field) or ""
            if val:
                r[field] = _AUTO_FIX_RE.sub(_auto_fix_replace, val)
        fixed.append(r)
    return fixed


def _schema_errors(rows: list) -> list:
    errors = []
    if not isinstance(rows, list):
        errors.append(f"Expected list of rows, got {type(rows)}")
        return errors
    if len(rows) != 15:
        errors.append(f"Expected 15 rows, got {len(rows)}")
        # Continue checking per-row fields even on count mismatch — more actionable detail
    for i, row in enumerate(rows):
        label   = row.get("kddId", f"row {i+1}")
        missing = [f for f in KDD_REQUIRED_FIELDS if not row.get(f)]
        if missing:
            errors.append(f"{label} missing fields: {', '.join(missing)}")
        if row.get("fitGap")           and row["fitGap"]           not in VALID_FIT_GAP:
            errors.append(f"{label} invalid fitGap: \"{row['fitGap']}\"")
        if row.get("complexity")       and row["complexity"]       not in VALID_COMPLEXITY:
            errors.append(f"{label} invalid complexity: \"{row['complexity']}\"")
        if row.get("sapActivatePhase") and row["sapActivatePhase"] not in VALID_PHASE:
            errors.append(f"{label} invalid phase: \"{row['sapActivatePhase']}\"")
    return errors


async def run(state: dict) -> dict:
    rows = state.get("rows", [])
    item = state.get("item", {})
    id_  = item.get("id", "?") if item else "?"

    if not rows:
        return {
            **state,
            "validation_passed":    False,
            "validation_errors":    ["No rows to validate"],
            "validation_auto_fixed": False,
            "forbidden_found":      0,
        }

    schema_errs = _schema_errors(rows)
    before      = _scan_forbidden(rows)
    fixed_rows  = _auto_fix(rows) if before else rows
    after       = _scan_forbidden(fixed_rows) if before else []

    all_errors = schema_errs + [
        f"{v['kddId']}.{v['field']} still contains \"{v['term']}\" — manual review needed"
        for v in after
    ]
    auto_fixed = bool(before) and not after

    if before:
        fixed_count = len(before) - len(after)
        log.info("%s — %d forbidden terms found, %d auto-fixed, %d remaining",
                 id_, len(before), fixed_count, len(after))
    if schema_errs:
        log.warning("%s — %d schema error(s): %s", id_, len(schema_errs), schema_errs[0])
    if not all_errors:
        log.info("%s — ✅ passed (%d rows)", id_, len(fixed_rows))

    return {
        **state,
        "rows":                  fixed_rows,
        "validation_passed":     not all_errors,
        "validation_errors":     all_errors,
        "validation_auto_fixed": auto_fixed,
        "forbidden_found":       len(before),
    }
