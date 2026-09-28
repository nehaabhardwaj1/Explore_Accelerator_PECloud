# agents_py/shared.py — constants shared across all pipeline agents
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

CLAUDE_MODEL      = os.environ.get("CLAUDE_MODEL", "claude-opus-4-5")
CLAUDE_TIMEOUT_S  = int(os.environ.get("CLAUDE_TIMEOUT_S", "240"))  # env-driven; complex processes can take 100-150s

# Increment when any generation prompt changes so KDD rows carry the version
# that produced them — enables quality audits across prompt iterations.
PROMPT_VERSION = "1.1"  # 1.0 → 1.1: added refusal rules to all 3 prompts

KDD_REQUIRED_FIELDS = [
    "kddId", "scopeItemId", "scopeItemName", "designQuestion",
    "fitGap", "complexity", "status", "module",
    "decisionOwner", "sapActivatePhase", "rationale", "impactActions", "notes",
]

# Cloud PE forbidden terms — single source of truth used by validation_agent and helpers
# Must never appear in generated KDD output
FORBIDDEN_TERMS = [
    "ABAP", "ECC", "R/3", "SE16", "SM30", "SE38", "SE80",
    "user exit", "BAdI", "CMOD", "SMOD",
    "on-premise", "on premise",
    "private cloud",
    "SAP GUI", "SAPGUI",
    "SM31", "SM34", "OBYC",
    "backend custom", "LSMW", "BDC", "batch input",
    "table maintenance",
]

# Alias used by helpers.py detect_on_prem() — same list, one source of truth
ONPREM_TERMS = FORBIDDEN_TERMS

# Cloud PE equivalents — used by validation agent to auto-fix output
AUTO_REPLACEMENTS = {
    "SAP GUI":        "SAP Fiori",
    "SAPGUI":         "SAP Fiori",
    "on-premise":     "Cloud PE",
    "on premise":     "Cloud PE",
    "private cloud":  "Cloud PE",
    "user exit":      "Key User Extension",
    "BAdI":           "BTP Extension",
    "SM30":           "SAP Fiori customizing app",
    "SM31":           "SAP Fiori customizing app",
    "SM34":           "SAP Fiori customizing app",
    "SE16":           "SAP Fiori Display app",
    "SE38":           "ABAP Cloud development",
    "SE80":           "ABAP Cloud development",
    "LSMW":           "SAP S/4HANA Migration Cockpit",
    "BDC":            "SAP S/4HANA Migration Cockpit",
    "batch input":    "SAP S/4HANA Migration Cockpit",
    "ABAP":           "ABAP Cloud",
    "backend custom": "Key User Extension or BTP Side-by-Side",
    "ECC":            "source system",
    "R/3":            "source system",
}

LOB_MODULE = {
    "Finance":                                 "FIN",
    "FAC Finance and Controlling":             "FIN",
    "Sales":                                   "SD",
    "Sourcing and Procurement":                "MM",
    "Procurement":                             "MM",
    "Manufacturing":                           "PP",
    "Human Resources":                         "HCM",
    "Supply Chain":                            "SCM",
    "Asset Management":                        "PM",
    "Service":                                 "CS",
    "IT Management":                           "IT",
    "Professional Services":                   "PS",
    "R&D and Engineering":                     "RE",
    "Data Management":                         "DM",
    "Database and Data Management":            "DM",
    "Application Platform and Infrastructure": "IT",
    "Integration":                             "IT",
    "Solutions for Specific Industries":       "Cross",
    "VEV Vendor Evaluation":                   "MM",
    "Other":                                   "Cross",
}
