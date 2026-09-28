---
name: s4pc-kdd-generator
description: Generates a Key Design Decision (KDD) log for SAP S/4HANA Cloud Public Edition scope items. Runs a 4-stage pipeline per item: (1) past decisions library overlay — pre-fills answers from approved decisions on earlier projects; (2) SAP context parsing — extracts overview, key process flow, and business benefits from scope-catalog.json so questions are process-specific, not generic; (3) three sequential Claude calls — 15 questions across 10 coverage areas (Fiori config, master data, approval workflow, outputs, integration, reporting, authorisation, data migration, org structure, number ranges), then enrichment (rationale, owner, phase, impact), then RICEF classification for Gap/Partial rows; (4) Cloud PE validation with auto-fix — scans for forbidden on-prem terms and replaces them. Exports a 5-sheet Excel: Cover, Instructions, Scope Overview, KDD Master Log, and Summary. Use when asked to generate, create, or produce KDDs for a scope item, LOB, or SAP project.
---

# Explore Accelerator · KDD Generator

You are generating a Key Design Decision (KDD) log for an SAP S/4HANA Cloud **Public Edition** implementation. Follow every step in order. Do not skip steps.

---

## STEP 1 — Check Prerequisites

Read the file `scope-catalog.json` from the current working directory.

**If the file does not exist:**
```
⚠️  scope-catalog.json not found.

Please run the SAP Deck Agent extension first:
  1. Open Chrome → go to me.sap.com/processnavigator
  2. Click the SAP Deck Agent extension icon
  3. Click "Load Full Catalog"
  4. Click "📁 Save to Cartridge" → pick this folder

Or provide scope item IDs manually and I will generate using built-in SAP knowledge.

Do you want to:
  A) Wait — I will load the catalog now
  B) Continue with manual IDs (lower quality — no SAP process context)
```
Wait for the user's answer before proceeding.

**If the file exists — check the SAP release version:**

Calculate the expected current SAP release:
- Get today's date
- If month >= 8 → expected release = `{2-digit year}08` (e.g. August 2026 → `2608`)
- If month < 8  → expected release = `{2-digit year}02` (e.g. March 2026 → `2602`)

Read `catalog.version` from the file. If it is less than the expected release:
```
⚠️  Your scope catalog is from SAP release {catalog.version}.
    SAP {expectedRelease} was released — process content, scope items,
    business benefits and Fiori apps may have changed.

    To update: Extension → Load Full Catalog → Save to Cartridge

    Continuing with {catalog.version} data. Results may not reflect
    latest {expectedRelease} changes.
```
Then continue regardless — do not block.

---

## STEP 2 — Get Project Details

**If the user provided Client and Project in the prompt** (e.g. `— Client: Acme, Project: S4H Rollout`), extract them and confirm.

**If not provided**, ask:
```
📋 Project details
  Client name:   [e.g. Acme Corporation]
  Project name:  [e.g. S4HANA Rollout Phase 1]
```
Wait for the answer.

---

## STEP 3 — Scope Item Selection

**If scope item IDs were provided in the prompt** (e.g. `BD6, J59, BEI`):
- Look each ID up in `scope-catalog.json` to get the full name, LOB, and description
- Show a confirmation list and ask: "Proceed with these scope items? [yes / change]"

**If no scope items were provided**, show LOB-based selection:

Extract all unique `lob` values from `scope-catalog.json`, sort alphabetically, and show:
```
🔍 Select Line of Business:

  1.  Asset Management
  2.  Finance
  3.  Human Resources
  4.  Manufacturing
  5.  Procurement
  6.  Sales
  7.  Supply Chain
  ...

Type a number, or type a scope item ID directly (e.g. BD6):
```

After the user picks a LOB, show the scope items in that LOB:
```
📋 Finance — scope items:

  BD6   Accounts Payable
  J59   Credit Management
  1GA   Asset Accounting
  BEI   Cash Management
  ...

Type IDs to select (e.g. BD6, J59) or "back" to change LOB:
```

Confirm the final selection before generating.

---

## STEP 4 — Generate KDD Questions

For **each selected scope item**, generate exactly **15 KDD questions**.

### Context to use
From `scope-catalog.json`, find the entry matching the scope item ID. Extract:
- `description` — the full process text (contains Overview, Key Process Flow, Business Benefits, Solution Capabilities)
- `name` — the process name
- `lob` — line of business

Parse the description to find sections:
- Lines after "Overview" until next section = process overview
- Lines after "Key Process Flow" until next section = process steps
- Lines after "Business Benefits" until next section = business benefits
- Lines after "Solution Capabilities" until next section = capabilities

Use all of this as context when generating questions. Questions must be **specific to this process** — never generic SAP questions that could apply to any scope item.

### Cloud PE Rules — enforce strictly on every question
- ❌ Never reference: ABAP, ECC, R/3, SE16, SM30, SE38, SE80, SE91, user exit, BAdI, BAdI, CMOD, SMOD, OBYC, table maintenance, SM31, SM34, SAP GUI, SAPGUI, on-premise, on premise, private cloud, classic tcode, backend custom
- ✅ Configuration only via SAP Fiori apps or SAP BTP — never via tcodes
- ✅ All questions must be achievable in S/4HANA Cloud Public Edition out-of-the-box or via BTP extensibility

### Question categories — cover all 15 across these areas
1. **Fiori Configuration** — how is this specific process configured in Fiori apps?
2. **Master Data** — what master data setup is specific to this process?
3. **Approval / Workflow** — what approval steps and notification rules apply?
4. **Outputs & Forms** — what documents, forms, or outputs does this process produce?
5. **Integration** — how does this connect to adjacent SAP processes or external systems?
6. **Reporting & Analytics** — what reports and KPIs are needed for this process?
7. **Authorisation** — what roles and access controls govern this process?
8. **Data Migration** — what legacy data needs to be migrated for this process?
9. **Org Structure** — what org unit decisions (company code, plant, etc.) affect this process?
10. **Number Ranges & Outputs** — what number ranges, output types, or print settings are needed?

### Assign these fields for each question
| Field | Values |
|---|---|
| `fitGap` | `"Fit"` — standard SAP covers it · `"Partial Fit"` — needs config · `"Gap"` — needs extension |
| `complexity` | `"Low"` · `"Medium"` · `"High"` |
| `status` | Always `"Open"` |
| `module` | Derive from LOB: Finance→`FIN`, Sales→`SD`, Procurement→`MM`, Manufacturing→`PP`, HR→`HCM`, else `Cross` |
| `l1` | Top-level process area (e.g. "Procure to Pay") |
| `l2` | Sub-area (e.g. "Invoice Processing") |
| `l3` | Process step (e.g. "Invoice Verification") |
| `l4` | Detail (e.g. "3-Way Match Configuration") |
| `decisionOwner` | Finance Lead/CFO · Sales Lead/CCO · Procurement Lead · Operations Lead · HR Lead · IT Security Lead · Integration Lead · Data Migration Lead · Business Process Owner |
| `sapActivatePhase` | `"Explore"` for master data/org structure · `"Realize"` for config/workflow/integration · `"Deploy"` for migration/auth |
| `rationale` | 1-2 sentences explaining why this decision matters |
| `impactActions` | What happens if this is not decided — specific consequence |
| `notes` | Any Cloud PE-specific constraints or Fiori app references |

### On-premise detection — after generating each batch
Scan every generated question's `designQuestion`, `rationale`, `impactActions`, and `notes` for these terms (case-insensitive):
`ABAP, user exit, BADI, BAdI, SE16, SM30, SE38, SE80, CMOD, SMOD, on-premise, on premise, private cloud, ECC, R/3, table maintenance, SM31, SM34, SAP GUI, SAPGUI, OBYC, backend custom`

If any are found — **remove that question and replace it** with a valid Cloud PE question. Do not keep flagged questions.

### KDD ID format
`{scopeItemId}-KDD-001` through `{scopeItemId}-KDD-015`

---

## STEP 5 — Show Summary for Confirmation

After generating all questions, show a summary table:

```
✅ KDD Generation Complete

  Scope items:  3
  Total KDDs:   45
  On-prem removed: 2

  BD6  Accounts Payable       15 questions   FIN
  J59  Credit Management      15 questions   FIN
  BEI  Cash Management        15 questions   FIN

  Fit: 28  |  Partial Fit: 12  |  Gap: 5
  Low: 18  |  Medium: 20       |  High: 7

  Red: 3   |  Amber: 8         |  Green: 34

Proceed to export Excel? [yes / review first / cancel]
```

If user says "review first" — show the questions in a readable table grouped by scope item, wait for any edits.

---

## STEP 6 — Build the KDD Data File

Write all KDD rows to `output/kdd-data.json` in this exact format:

```json
{
  "rows": [ ...all KDD row objects... ],
  "meta": {
    "client": "<client name>",
    "project": "<project name>",
    "catalogVersion": "<version from scope-catalog.json>",
    "generatedAt": "<ISO timestamp>",
    "scopeCount": <number of scope items>,
    "overviews": [
      {
        "id": "<scopeItemId>",
        "name": "<process name>",
        "module": "<module>",
        "lob": "<lob>",
        "version": "<catalog version>",
        "overview": "<overview text>",
        "keyProcessFlow": "1. Step one\n2. Step two\n...",
        "businessBenefits": "1. Benefit one\n2. Benefit two\n...",
        "source": "SAP for Me"
      }
    ]
  }
}
```

Each row object must have ALL these fields:
`processId, kddId, scopeItemId, scopeItemName, designQuestion, fitGap, complexity, status, source, dataSource, module, l1, l2, l3, l4, decisionMade, rationale, impactActions, decisionOwner, sapConsultant, notes, ragStatus, sapActivatePhase, configEffort, integrationFlags`

Set `source` to `"SAP for Me - Process Navigator"` and `dataSource` to `"SAP for Me"`.

---

## STEP 7 — Build the Excel File

Run this command to build the 5-sheet Excel from the KDD data file you just wrote:

```bash
python -m kdd_generator.excel_builder --input output/kdd-data.json
```

The script reads `output/kdd-data.json`, produces `output/Accenture_KDD_<Client>_<Project>_<Date>.xlsx`, and prints the filename on completion.

If the command fails:
- Missing module error → run `pip install -r requirements.txt` (or double-click `SETUP.bat`)
- File not found → confirm Step 6 wrote `output/kdd-data.json` before retrying

---

## STEP 8 — Confirm Output

Show the user:
```
📥 Excel file ready:
   output/Accenture_KDD_<Client>_<Project>_<Date>.xlsx

   Sheets: Cover · Instructions · Scope Overview · KDD Master Log · Summary
   Total KDDs: <n>  |  Data source: SAP for Me (v<version>)
   Prompt version: <PROMPT_VERSION from kdd-data.json>

If the server is running (START.bat), you can also:
  • Open http://localhost:3000 → KDD Editor to review and edit KDDs interactively
  • Use KDD Analysis for RAG status, gap analysis, and RICEF breakdown
  • Export PPT from the Output Files tab
```

---

## Quality Reminders
- Every question must be **specific** to the named scope item — not generic SAP questions
- No question should be answerable with "not applicable" — if unsure, replace it
- Rationale and Impact/Actions must be concrete, not vague
- Fiori app names and BTP service names must be accurate for Cloud PE
