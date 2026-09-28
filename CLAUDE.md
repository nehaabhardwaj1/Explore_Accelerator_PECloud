# Explore Accelerator — SAP S/4HANA Cloud Public Edition

## What This Is
A Claude Code cartridge for the SAP Activate **Explore phase**, covering BDCQ enrichment and KDD generation for S/4HANA Cloud Public Edition projects.
Backend: **Python / FastAPI** with Google A2A and MCP protocol support.

## Cartridge Structure
```
explore-accelerator/
├── .claude/agents/
│   ├── s4pc-bdcq-enricher.md   ← BDCQ Enricher skill (localization + industry)
│   └── s4pc-kdd-generator.md   ← KDD Generator skill
├── agents_py/                   ← 5-stage KDD pipeline agents
│   ├── shared.py                ← Constants (model, forbidden terms, LOB map)
│   ├── cache_agent.py           ← Stage 1: cache lookup
│   ├── library_agent.py         ← Stage 2: past decisions
│   ├── context_agent.py         ← Stage 3: SAP description parser
│   ├── generation_agent.py      ← Stage 4: 3-call Claude CLI pipeline
│   ├── validation_agent.py      ← Stage 5: Cloud PE compliance + auto-fix
│   └── orchestrator.py          ← Parallel batch pipeline coordinator
├── kdd_generator/               ← Output builders
│   ├── helpers.py               ← RAG, phase, owner, effort, on-prem detection
│   ├── excel_builder.py         ← 5-sheet XLSX (openpyxl)
│   └── ppt_builder.py           ← PowerPoint export (python-pptx)
├── bdcq_agent/
│   └── routes.py                ← FastAPI router for all /api/bdcq/* endpoints
├── bdcq_enricher/
│   └── localization.py          ← COUNTRY_RULES, INDUSTRY_RULES, CLOUDPE_CONSTRAINTS
├── a2a/
│   ├── router.py                ← Google A2A protocol (agent card, JSON-RPC, SSE)
│   └── task_runner.py           ← Routes A2A tasks to KDD pipeline
├── server.py                    ← Main FastAPI server (port 3000)
├── mcp_server.py                ← MCP stdio server (5 tools for Claude Code)
├── requirements.txt             ← Python dependencies
├── START.bat                    ← Launch server (creates .venv, installs deps)
├── SETUP.bat                    ← First-time setup
├── public/                      ← Frontend (static HTML/CSS/JS)
├── bdcq/                        ← BDCQ data files + bdcq-questions.json
├── output/                      ← Generated Excel/PPT files land here
├── scope-catalog.json           ← Saved from extension (update every 6 months)
└── cartridge.json
```

## Skills Available
| Skill | Invoke | What it does |
|---|---|---|
| BDCQ Enricher | `/s4pc-bdcq-enricher` | Enriches SAP BDCQ questions with country localisation, industry context, and Cloud PE constraints — produces a workshop-ready brief |
| KDD Generator | `/s4pc-kdd-generator` | Generates KDD log from scope catalog for given scope items — exports 5-sheet Excel |

## Setup (One Time)
1. Install Chrome extension: Chrome → `chrome://extensions` → Load unpacked → pick `SAPDeckAgent_v27/` (or extract from `SAPDeckAgent-ChromeExtension.zip`)
2. Run `SETUP.bat` to create the Python virtual environment and install dependencies
3. **For BDCQ enrichment**: Open SAP Roadmap Viewer → Explore phase → Accelerators tab → extension → Scan → Save BDCQ Files → pick this folder → creates `bdcq/bdcq-questions.json`
4. **For KDD generation**: Open SAP for Me Process Navigator → extension → Load Full Catalog → Save to Cartridge → creates `scope-catalog.json`

## Starting the Server
```
START.bat
```
Opens `http://localhost:3000` — the full KDD generator UI.

## Running the BDCQ Enricher
```
/s4pc-bdcq-enricher
```
The agent reads `bdcq/bdcq-questions.json`, asks for client country and industry, then produces enriched workshop questions with mandatory localisation flags and Cloud PE constraints.

## Running the KDD Generator
```
/s4pc-kdd-generator
```
Or with scope IDs and project details upfront:
```
/s4pc-kdd-generator BD6, J59, BEI — Client: Acme Corp, Project: S4H Rollout
```

## Interoperability
- **A2A** (Google Agent-to-Agent): agent card at `/.well-known/agent.json`, JSON-RPC at `/a2a`
- **MCP**: run `python mcp_server.py` — exposes 5 tools over stdio JSON-RPC 2.0

## Data Files
| File | What | How often |
|---|---|---|
| `bdcq/bdcq-questions.json` | Parsed BDCQ Excel files — all domains, all questions | Per project (download from Roadmap Viewer) |
| `scope-catalog.json` | 657 SAP processes with descriptions, LOB, benefits | Every 6 months (new SAP release) |

## Output
Files are written to the `output/` folder:
```
output/Accenture_KDD_<Client>_<Project>_<Date>.xlsx
output/Accenture_KDD_<Client>_<Project>_<Date>.pptx
```
5 Excel sheets: Cover · Instructions · Scope Overview · KDD Master Log · Summary

## SAP Release Check
The skill automatically checks if `scope-catalog.json` matches the expected current SAP release.
SAP releases every 6 months — February (XX02) and August (XX08).
A warning is shown if your catalog is outdated.

## Rules — Cloud PE Only
This cartridge strictly enforces SAP S/4HANA **Cloud Public Edition** standards.
Never reference: ABAP, ECC, R/3, SE16, SM30, SE38, SE80, user exit, BAdI, SAP GUI, SAPGUI,
CMOD, SMOD, on-premise, private cloud, table maintenance, SM31, SM34.
Configuration only via SAP Fiori apps or SAP BTP.
