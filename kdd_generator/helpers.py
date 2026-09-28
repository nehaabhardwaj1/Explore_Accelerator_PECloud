# kdd_generator/helpers.py — RAG status, decision owner, phase, integration flags, effort, dedup
from datetime import date
from agents_py.shared import ONPREM_TERMS  # single source of truth


def detect_on_prem(row: dict) -> list:
    text = " ".join(str(row.get(f) or "") for f in
                    ["designQuestion", "rationale", "impactActions", "notes"]).lower()
    return [t for t in ONPREM_TERMS if t.lower() in text]


def get_rag_status(row: dict) -> str:
    fg = row.get("fitGap", "")
    cx = row.get("complexity", "")
    if fg == "Gap"         and cx == "High":   return "Red"
    if fg == "Gap"         and cx == "Medium": return "Amber"
    if fg == "Partial Fit" and cx == "High":   return "Amber"
    if fg == "Gap"         and cx == "Low":    return "Amber"
    return "Green"


def get_decision_owner(row: dict) -> str:
    mod = (row.get("module") or "").upper()
    q   = (row.get("designQuestion") or "").lower()
    if mod == "FIN" or "finance" in q or "accounting" in q:  return "Finance Lead / CFO"
    if mod == "SD"  or "sales"   in q or "customer"   in q:  return "Sales Lead / CCO"
    if mod == "MM"  or "procurement" in q or "purchase" in q: return "Procurement Lead"
    if mod == "PP"  or "production" in q or "manufacturing" in q: return "Operations Lead"
    if mod == "HCM" or "payroll" in q or "employee" in q:    return "HR Lead / CHRO"
    if "authoriz" in q or "role" in q or "access" in q:       return "IT Security Lead"
    if "integrat" in q or "interface" in q:                   return "Integration Lead"
    if "migration" in q or "data load" in q:                  return "Data Migration Lead"
    return "Business Process Owner"


def get_sap_activate_phase(row: dict) -> str:
    q = (row.get("designQuestion") or "").lower()
    if any(k in q for k in ("org structure", "chart of accounts", "company code")): return "Explore"
    if any(k in q for k in ("master data", "number range", "output", "form")):      return "Explore"
    if any(k in q for k in ("configur", "setting", "parameter")):                   return "Realize"
    if any(k in q for k in ("workflow", "approval", "notification")):                return "Realize"
    if any(k in q for k in ("integrat", "interface", "api")):                        return "Realize"
    if any(k in q for k in ("migration", "data load", "cutover")):                  return "Deploy"
    if any(k in q for k in ("authoriz", "role", "user")):                           return "Deploy"
    if row.get("fitGap") == "Gap":                                                   return "Realize"
    return "Explore"


def get_integration_flags(row: dict) -> str:
    text = " ".join(str(row.get(f) or "") for f in
                    ["designQuestion", "impactActions", "rationale"]).lower()
    flags = []
    if "ariba"         in text or "sourcing"          in text: flags.append("SAP Ariba")
    if "successfactor" in text or "payroll"           in text: flags.append("SuccessFactors")
    if "concur"        in text:                                 flags.append("SAP Concur")
    if "fieldglass"    in text:                                 flags.append("SAP Fieldglass")
    if "btp"           in text or "business technology" in text: flags.append("SAP BTP")
    if "analytics"     in text or " sac " in text or "datasphere" in text: flags.append("SAP Analytics Cloud")
    if "third party"   in text or "3rd party" in text or "external system" in text: flags.append("3rd Party")
    mods = []
    mod = row.get("module", "")
    if mod in ("SD", "MM") and "financ" in text:              mods.append("SD-FIN")
    if mod == "MM" and ("product" in text or "mrp" in text):  mods.append("MM-PP")
    if mod == "SD" and ("warehouse" in text or "delivery" in text): mods.append("SD-WM")
    return ", ".join(flags + mods)


def get_config_effort(row: dict) -> str:
    fg = row.get("fitGap", "")
    cx = row.get("complexity", "")
    if fg == "Gap"         and cx == "High":   return "High (5+ days)"
    if fg == "Gap"         and cx == "Medium": return "Medium (2-5 days)"
    if fg == "Gap"         and cx == "Low":    return "Low (1-2 days)"
    if fg == "Partial Fit" and cx == "High":   return "Medium (2-5 days)"
    if fg == "Partial Fit":                    return "Low (1-2 days)"
    return "Minimal (<1 day)"


def dedup(rows: list) -> list:
    seen = set()
    out  = []
    for r in rows:
        k = (r.get("designQuestion") or "").lower()[:60].strip()
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def expected_release() -> str:
    today = date.today()
    yy    = today.year % 100
    return f"{yy}08" if today.month >= 8 else f"{yy}02"


def is_catalog_outdated(catalog_version: str) -> bool:
    try:
        return int(catalog_version) < int(expected_release())
    except (ValueError, TypeError):
        return False
