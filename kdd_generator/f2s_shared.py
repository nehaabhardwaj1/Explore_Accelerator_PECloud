# kdd_generator/f2s_shared.py — lightweight constants shared by f2s_deck_builder and f2s_agent.
# No pptx dependency — safe to import from any FastAPI route.

# BDCQ source data vocabulary fixes — applied to question/topic/topic_def at index-build time.
# Extend this list when additional source data errors are found in any LOB.
# Format: (regex_pattern, replacement) — all applied case-insensitively.
BDCQ_SOURCE_FIXES: tuple = (
    # Typos found in AM BDCQ source data (from deck review across 16+ decks)
    (r"\bmainenance\b",       "maintenance"),
    (r"\btechncian\b",        "technician"),
    (r"\bschedled\b",         "scheduled"),
    (r"\bactivites\b",        "activities"),
    (r"\bconffirmation\b",    "confirmation"),
    (r"\bayutomatic\b",       "automatic"),
    (r"\bmaxium\b",           "maximum"),
    (r"\badminstrative\b",    "administrative"),
    (r"\bgenearl\b",          "general"),
    (r"\borganziat\b",        "organisation"),
    (r"\bfunctionalites\b",   "functionalities"),
    # On-premise / legacy terminology must not appear in Cloud PE workshop content
    (r"\bPlant Maintenance\b",     "Asset Management"),
    (r"\bPerform this activity\b", "Configure via Manage Your Solution"),
    (r"\blegacy PM\b",             "legacy EAM / Asset Management system"),
    # Procurement source data typos
    (r"\bdiscuounts\b",            "discounts"),
    (r"\bsupplir\b",               "supplier"),
    (r"\bporg\b",                  "purchasing organisation"),
    (r"\bMM area\b",               "Sourcing and Procurement"),
    # Generic punctuation noise
    (r"\?{2,}",                    "?"),
    # Cloud PE compliance — source data occasionally says "Private Edition" in error
    (r"\bS/4HANA Cloud Private Edition\b", "SAP S/4HANA Cloud Public Edition"),
    (r"\bCloud Private Edition\b",          "Cloud Public Edition"),
    (r"\bPrivate Cloud Edition\b",          "Cloud Public Edition"),
)

# F2S l1 domain → BDCQ domain name (for Pattern B LOB matching)
F2S_TO_BDCQ_DOMAIN: dict = {
    "Manufacturing":          "Manufacturing",
    "Supply Chain":           "Supply Chain",
    "Asset Management":       "Asset Management",
    "Finance & Controlling":  "Finance",
    "Sales & Distribution":   "Sales",
    "Sourcing & Procurement": "Sourcing & Procurement",
    "Human Resources":        "Human Resources",
    "Customer Service":       "Service",
    "R&D & Engineering":      "R&D Engineering",
    "Professional Services":  "Professional Services",
}
