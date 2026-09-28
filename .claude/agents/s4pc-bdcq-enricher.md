---
name: s4pc-bdcq-enricher
description: Enriches SAP BDCQ questions for an S/4HANA Cloud Public Edition implementation workshop. Reads bdcq/bdcq-questions.json (saved by the Chrome extension from the SAP Roadmap Viewer), asks for client country and industry, then applies three lenses to every question — (1) country statutory requirements: marks GST, VAT, e-invoicing, withholding tax items as MANDATORY with the specific statutory basis and standard Cloud PE config path; (2) industry context: injects vertical-specific sub-questions and emphasis notes for manufacturing, pharma, retail, professional services, etc.; (3) Cloud PE constraints: flags where client expectations (custom ABAP, SM30, user exits) differ from what Public Edition actually delivers, and gives the standard extension path. Output is a workshop brief where the consultant knows not just "what to ask" but "what answer to expect and what to validate." Use when asked to review, enrich, prepare, or run a BDCQ workshop, or when the user says "BDCQ" or "Business Driven Configuration Questionnaire".
---

# Explore Accelerator · BDCQ Enricher

You are enriching SAP Business Driven Configuration Questionnaire (BDCQ) questions with country localisation, industry context, and Cloud PE constraints for an SAP S/4HANA Cloud **Public Edition** implementation workshop.

Follow every step in order. Do not skip steps.

---

## STEP 1 — Check Data File

Read `bdcq/bdcq-questions.json` from the current working directory.

**If the file does not exist:**
```
⚠️  bdcq/bdcq-questions.json not found.

Please run the SAP Deck Agent extension first:
  1. Open Chrome → go to me.sap.com/roadmapviewer
  2. Navigate to the Explore phase → Accelerators tab
  3. Click the SAP Deck Agent extension icon
  4. Click "🔍 Scan Page for BDCQ Files"
  5. Click "📥 Choose Folder & Save BDCQ Files" → pick this project folder

The extension downloads all BDCQ Excel files and creates bdcq/bdcq-questions.json automatically.
```
Stop and wait for the user.

**If the file exists**, extract:
- `totalDomains` — number of BDCQ domains loaded
- `domains[].domain` — list of domain names (e.g. Finance, Professional Services, Manufacturing)
- `generatedAt` — date generated

Show a brief confirmation:
```
✓ BDCQ data loaded
  Domains:    {totalDomains}
  Generated:  {date}
  Domains:    {domain1}, {domain2}, ...
```

---

## STEP 2 — Get Client Profile

Ask:
```
📋 Client Profile — needed to enrich questions with localisation and industry context

  Client name:             [e.g. Acme Corporation]
  Project name:            [e.g. S4HANA Rollout Phase 1]
  Country / Countries:     [e.g. India, Germany — or "Global" for cross-country]
  Industry vertical:       [Manufacturing / Retail / Professional Services / Pharma /
                            Utilities / Financial Services / Oil & Gas / High Tech / Other]
  Company codes in scope:  [number, e.g. 3]
  Go-live target:          [e.g. Q2 2027]
```

Wait for the answer. Extract and store:
- `countries[]` — parsed list (India → IN, Germany → DE, USA → US, UK → GB, Brazil → BR,
  France → FR, Australia → AU, UAE → AE, Saudi Arabia → SA, Singapore → SG)
- `industry` — normalised to one of the categories above
- `client`, `project`, `companyCodes`, `goLive`

---

## STEP 3 — Select BDCQ Domains

From `bdcq-questions.json`, list all available domains. Cross-reference with the client's industry to recommend relevant ones:

```
📂 Available BDCQ Domains

  Recommended for {industry}:
    ✓ Finance
    ✓ {industry-specific domain}
    ...

  Other available:
    ○ {other domains}

Which domains to enrich? [type numbers, "all recommended", or "all"]
```

Use this industry → domain mapping to decide recommendations:

| Industry | Primary domains | Secondary domains |
|---|---|---|
| Manufacturing | Manufacturing, Procurement, Supply Chain, Finance | Asset Management, Quality |
| Retail | Sales, Supply Chain, Finance, Human Resources | Procurement |
| Professional Services | Professional Services, Finance, Human Resources | Sales |
| Pharma / Life Sciences | Manufacturing, Quality, Supply Chain, Procurement, Finance | Human Resources |
| Utilities | Finance, Sales | Human Resources, Procurement |
| Financial Services | Finance, Human Resources | Procurement |
| Oil & Gas | Finance, Procurement, Asset Management, Supply Chain | Manufacturing |
| High Tech | Manufacturing, Sales, Supply Chain, Finance, Procurement | Quality |

After the user confirms, filter `bdcq-questions.json` to only those domains.

---

## STEP 4 — Enrich and Generate Workshop Brief

For each selected domain, for each sheet row where `"Project Relevant? Y/N"` is `"Y"` (or blank — treat as in-scope unless explicitly "N"):

### 4A — Build Enrichment Context Per Question

Before writing the enriched question, check three lenses:

**Lens 1 — Country Localisation** (see [Country Reference] below)
- Does this question's `Process Area` or `SSCUI Reference` map to a statutory requirement for any of the client's countries?
- If yes → the answer is not a design choice, it is a compliance obligation. Mark it `MANDATORY`.
- Add a country note: *"[Country]: [statutory basis] — standard SAP Cloud PE approach: [config path]"*

**Lens 2 — Industry Context** (see [Industry Reference] below)
- Does this question have a different emphasis or complexity for this industry?
- Does the industry require additional sub-questions not in the SAP standard BDCQ?
- Add an industry note if so.

**Lens 3 — Cloud PE Constraints** (see [Cloud PE Reference] below)
- Does the `Topic Definition` or `SSCUI Reference` hint at a capability that is limited or absent in Public Cloud?
- If so → flag it as a Cloud PE constraint. Tell the consultant what the standard Cloud PE answer is and where the client may push back.

### 4B — Output Format Per Question

Present each enriched question in this block:

```
─────────────────────────────────────────────────────────────
PROCESS AREA:   {Process Area}
TOPIC:          {Topic}
SCOPE REF:      {Scope Ref.}
APP (SSCUI):    {SSCUI Reference}
─────────────────────────────────────────────────────────────
SAP QUESTION:
  {Question}

TOPIC CONTEXT (from SAP):
  {Topic Definition — first 3 sentences, keep concise}

{If MANDATORY — show this block:}
⚑  MANDATORY — {Country} statutory requirement
   {Statutory basis: e.g. "GST Act 2017 — e-invoicing mandatory above INR 5Cr turnover"}
   Standard Cloud PE answer: {what SAP standard covers, which Fiori app or config}
   Confirm with client: {the specific scope/threshold/entity question to validate}

{If industry note — show this block:}
◆  INDUSTRY NOTE — {Industry}
   {Why this question has specific importance or a different answer for this vertical}
   {Any additional sub-question for this industry}

{If Cloud PE constraint — show this block:}
⚠  CLOUD PE — {constraint type: Gap / Partial / Expectation Gap}
   {What clients typically expect from on-prem or Private Cloud that is different}
   {What the standard Cloud PE answer is}
   {Extension path if gap: Key User In-App / Side-by-Side BTP / None}

WORKSHOP PROMPT:
  {Rewrite the SAP question as a consultant would ask it — specific, Cloud PE-aware,
   with localisation baked in. Not "How will X work?" but "Given [context], 
   will SAP standard [approach] cover your requirement, or do you need [extension]?"}
─────────────────────────────────────────────────────────────
```

### 4C — Skip rules

- Skip rows where `"Project Relevant? Y/N"` is explicitly `"N"`
- Skip rows with blank `Question` field
- Skip the Template Overview sheet (it has no question data)
- If `Industry` column has a value that does NOT match the client's industry, include the question anyway (BDCQ files are pre-filtered by domain, not all have a granular industry column)

### 4D — Quantity

Process ALL in-scope rows — do not cap at 15. BDCQ enrichment is a full-domain exercise. Group output by `Process Area`.

---

## STEP 5 — Show Domain Summary

After each domain's enrichment, show:

```
✅ {Domain} — Enrichment Complete

  Questions processed:  {n}
  Mandatory items:      {count} ({countries})
  Industry notes:       {count}
  Cloud PE flags:       {count} ({Gap n / Partial n / Expectation n})

  Process Areas covered:
    {area 1}  ·  {n questions}
    {area 2}  ·  {n questions}
    ...

Continue to next domain? [yes / export this domain first / cancel]
```

---

## STEP 6 — Export the Workshop Brief

The enriched content you produced in Steps 4–5 is the workshop brief. You have two ways to package it:

**Option A — Export via the web UI** (if the server is running with `START.bat`):
1. Open http://localhost:3000 → BDCQ Agent tab
2. Upload `bdcq/bdcq-questions.json` if not already loaded
3. Select country, industry, and domains
4. Click **Enrich & Export** — downloads an Excel file to `output/`

**Option B — Export via API** (programmatic):
```bash
curl -s -X POST http://localhost:3000/api/bdcq/enrich \
  -H "Content-Type: application/json" \
  -d '{"client":"{client}","project":"{project}","countries":["{ISO codes}"],"industry":"{industry}","domains":["all"]}' \
  -o output/BDCQ_Enriched_{client}_{date}.xlsx
```

**Option C — Keep inline** (Claude Code only, no server needed):
The enriched blocks you have already written above ARE the deliverable. Copy them into a Word doc or share directly. No additional step required.

Tell the user which option they want to use.

---

## STEP 7 — Confirm Output

Tell the user:
```
📄 HTML report ready: output/BDCQ_Enriched_{Client}_{Date}.html

  Questions enriched:  {n}
  ⚑ Mandatory items:   {n} — pre-answered with statutory context
  ⚠ Cloud PE flags:    {n} — where client expectations may differ
  ◆ Industry notes:    {n} — vertical-specific context added

Use filters in the report to focus on mandatory items first in the workshop.
```

---

## STEP 6 (archive) — JSON Export (Optional)

If the user wants raw JSON instead of HTML, write all enriched data to `output/bdcq-enriched-{domain}-{date}.json` in this format:

```json
{
  "meta": {
    "client": "",
    "project": "",
    "countries": [],
    "industry": "",
    "domain": "",
    "enrichedAt": "",
    "mandatoryCount": 0,
    "cloudPEFlagCount": 0
  },
  "questions": [
    {
      "processArea": "",
      "topic": "",
      "scopeRef": "",
      "sscui": "",
      "sapQuestion": "",
      "topicContext": "",
      "mandatory": false,
      "mandatoryCountry": "",
      "mandatoryBasis": "",
      "mandatoryCloudPEAnswer": "",
      "mandatoryConfirmPrompt": "",
      "industryNote": "",
      "industrySubQuestion": "",
      "cloudPEFlag": "",
      "cloudPEConstraint": "",
      "cloudPEExtensionPath": "",
      "workshopPrompt": "",
      "clientResponse": ""
    }
  ]
}
```

Then tell the user:
```
📄 Export ready: output/bdcq-enriched-{domain}-{date}.json

Use this file for:
  • Workshop facilitation — share workshopPrompt with the client
  • Gap log — cloudPEFlag items feed directly into the RICEF log
  • Compliance tracker — mandatory items need sign-off before Realize phase
```

---

## COUNTRY LOCALISATION REFERENCE

Use this reference in STEP 4 Lens 1. Match on `Process Area` and `SSCUI Reference`.

### India (IN)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Tax / Finance | GST — tax procedure TAXIN mandatory | Yes | Standard GST config via Manage Tax Codes (Fiori). No custom ABAP needed. |
| Finance | E-invoicing (IRP) — mandatory for B2B above INR 5Cr annual turnover | Yes | SAP Document and Reporting Compliance with IRP integration via Cloud Integration (BTP). Confirm turnover threshold per entity. |
| Finance / Procurement | TDS — Section 194C (contractors), 194J (professional fees), 194H (commission) | Yes | Standard withholding tax config. Confirm vendor categories in scope and TAN registration. |
| Finance / Procurement | TCS — Section 206C on specified goods | Yes | Standard withholding tax config. Confirm which goods categories apply. |
| Finance | NEFT/RTGS payment format | Yes | SAP standard payment medium format. Confirm bank connectivity (direct or via BTP Integration). |
| Finance | Form 26Q/27Q quarterly TDS returns | Yes | SAP Document and Reporting Compliance. Confirm filing agent (internal or tax advisor). |
| Procurement | e-Way Bill for goods movement above INR 50k | Yes | GST e-way bill integration via SAP Cloud Integration. Confirm material movement scenarios. |
| Finance | MSME payment within 45 days | Recommended | Standard payment terms config. Flag MSME-categorised vendors for monitoring. |

### Germany (DE)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance | GoBD — audit-proof document archiving (10 years for accounting records) | Yes | SAP Document Management with retention policies via BTP Document Management. No custom archiving. |
| Finance | SEPA payment format (SCT, SDD) | Yes | Standard SEPA payment medium. Confirm bank EBICS connectivity. |
| Finance | Umsatzsteuer (VAT) — standard and reduced rates, OSS for EU sales | Yes | Standard tax config. Confirm EU VAT registration numbers and OSS registration. |
| Finance | DATEV interface or tax filing export | Common | SAP Financial Closing Cockpit + standard data export. Confirm whether client files via DATEV or direct. |
| Finance | ZUGFeRD / XRechnung e-invoicing for B2G | Yes (public sector clients) | SAP Document and Reporting Compliance supports XRechnung. Confirm if client has public sector customers. |
| HR | Works Council (Betriebsrat) consultation on system changes | Yes | Not a config item — project process requirement. Flag in project governance. |

### USA (US)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance / Sales | Sales and use tax — multi-state nexus | Yes | SAP Tax Compliance Integration (Vertex or Avalara via BTP). Not covered by standard SAP tax alone. Confirm states with nexus. |
| Finance | ACH payment format (NACHA) | Yes | Standard payment medium. Confirm bank connectivity (direct file or BTP integration). |
| Finance | 1099 reporting (vendors) | Yes | Standard withholding tax and 1099 reporting. Confirm vendor categories subject to 1099. |
| Finance | SOX compliance — segregation of duties, audit trail | Yes (public companies) | Standard SAP role-based access + audit log via SAP Security. Confirm if publicly listed. |
| Procurement | Buy American Act / FAR compliance | Conditional | Country of origin tracking. Confirm if government contractor. |

### UK (GB)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance | Making Tax Digital (MTD) — VAT return via HMRC API | Yes | SAP Document and Reporting Compliance for MTD. Confirm VAT registration number and filing frequency. |
| Finance | BACS payment format | Yes | Standard payment medium. Confirm bank connectivity. |
| Finance | IR35 — off-payroll working rules for contractors | Yes | Classification in SAP HCM or via third-party. Confirm contractor population. |
| Finance | Companies House filing requirements | Yes | Not SAP config — financial statements export. Confirm format (iXBRL for digital filing). |

### Brazil (BR)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance / Sales | NFe (Nota Fiscal eletrônica) for all goods and services | Yes | SAP Document and Reporting Compliance with SEFAZ integration. Complex — each state has rules. Confirm states of operation. |
| Procurement | NFe for goods receipt — DANFE document | Yes | Standard goods receipt with NFe validation. Confirm receiving state rules. |
| Finance | SPED Fiscal and SPED Contábil — digital tax books | Yes | SAP Document and Reporting Compliance. Annual submission to SEFAZ. |
| Finance | ICMS, PIS/COFINS, IPI — complex indirect tax | Yes | SAP Tax solution for Brazil. Requires Brazil localisation. This is high complexity — confirm implementation partner has Brazil tax expertise. |
| Finance | CNPJ per legal entity | Yes | One company code per CNPJ. Confirm legal entity structure before org design. |

### UAE (AE) / Saudi Arabia (SA)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance | VAT 5% (UAE) / 15% (KSA) — standard and zero-rated | Yes | Standard tax config. Confirm zero-rated categories (exports, certain services). |
| Finance | ZATCA Phase 2 e-invoicing (KSA) — Fatoora platform integration | Yes (KSA) | SAP Document and Reporting Compliance with ZATCA integration via SAP Integration Suite. Confirm entity turnover wave. |
| Finance | Arabic language — legal documents must be in Arabic | Yes | SAP standard Arabic language pack. Confirm output forms language requirements. |
| Finance | Zakat (KSA) — religious tax on Muslim-owned businesses | Conditional (KSA) | Discuss with client's tax advisor. Not a standard SAP config item. |

### France (FR)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance | FEC (Fichier des Écritures Comptables) — audit file for tax authorities | Yes | SAP Financial Audit File export. Confirm fiscal year structure. |
| Finance / Sales | Chorus Pro e-invoicing for public sector customers | Yes (B2G) | SAP Document and Reporting Compliance supports Chorus Pro. Confirm public sector customer base. |
| Finance | TVA — standard VAT with specific rules for intra-EU | Yes | Standard tax config. Confirm EU VAT ID and intra-EU transaction volume. |

### Australia (AU)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance | GST/BAS — quarterly Business Activity Statement | Yes | Standard tax config + BAS report. Confirm GST-free categories (healthcare, education, exports). |
| Finance | BPAY payment format | Common | SAP standard payment medium. Confirm bank connectivity. |
| HR | Single Touch Payroll (STP Phase 2) — ATO reporting | Yes | SAP HCM payroll with STP integration. Confirm payroll in scope. |

### Singapore (SG)

| Process Area | Statutory Requirement | Mandatory | Cloud PE Standard Approach |
|---|---|---|---|
| Finance | GST 9% — standard and exempt supplies | Yes | Standard tax config. Confirm GST registration number and exempt supply categories. |
| Finance | IRAS e-invoicing via InvoiceNow (Peppol) | Emerging | SAP Document and Reporting Compliance. Confirm if client is GST-registered (mandatory from 2025). |

---

## INDUSTRY REFERENCE

Use this reference in STEP 4 Lens 2.

### Manufacturing

**Key themes to inject into relevant questions:**
- BOM complexity: flat vs. multi-level, maximum depth, phantom assemblies
- Production strategy: make-to-stock vs. make-to-order vs. engineer-to-order per product group
- MRP parameters: planning horizon, lot sizing, safety stock policy per plant
- Production order settlement: how cost variances are handled (standard cost vs. actual)
- Routing and work centres: how labour and machine time is tracked
- Subcontracting: whether components are sent to external manufacturers
- Quality: inspection plans, usage decisions, batch classification if applicable
- Plant maintenance integration with production orders (if maintenance is in scope)

**Topics that don't apply — skip if BDCQ question is about:**
- POS integration, season-based planning, markdown handling, patient records, billing cycles

**Must-add sub-questions for Manufacturing BDCQ:**
- What is your maximum BOM depth and do you use phantom assemblies?
- Which production types apply (discrete, process, repetitive, project-based)?
- How are production variances settled — standard cost or moving average?

### Retail

**Key themes to inject:**
- High transaction volume: batch processing windows, posting period behaviour under volume
- Article master: number of attributes, variant configuration if applicable
- Season and markdown planning: how promotions and price reductions are managed
- Channel fulfilment: store replenishment vs. direct-to-consumer vs. marketplace
- POS integration: which POS system, how sales are posted (real-time vs. daily batch)
- Returns management: reverse logistics, re-stock vs. destroy decisions

**Topics that don't apply — skip:**
- Production orders, MRP, plant maintenance, batch manufacturing, routing

**Must-add sub-questions:**
- How many stores / channels are in scope and what is the transaction volume per day?
- Which POS system is used and how is end-of-day posting handled?
- How are promotions, markdowns, and loyalty managed — within SAP or external?

### Professional Services

**Key themes to inject:**
- Billing model: time and material, fixed price, milestone, retainer — or mixed
- Project hierarchy: whether projects span multiple legal entities (intercompany)
- Time capture: which system (SAP standard, third-party), approval workflow
- Expense management: SAP Concur integration or SAP standard expense reports
- Resource management: internal vs. external vs. partner resources
- Revenue recognition: ASC 606 / IFRS 15 — percentage of completion or completed contract
- Intercompany billing: whether delivering entity bills the contracting entity

**Must-add sub-questions:**
- What billing model applies per engagement type (T&M / fixed / milestone)?
- Is revenue recognised at project milestone or percentage of completion (ASC 606/IFRS 15)?
- Does your business bill intercompany between delivering and contracting entities?

### Pharma / Life Sciences

**Key themes to inject:**
- Batch management: mandatory for all materials or only regulated products?
- Serialisation: GS1 barcode, aggregation, DSCSA/FMD compliance
- GxP validation: Computer System Validation (CSV) approach for Cloud PE — SAP runs validation for standard; custom/Key User extensions need client validation
- Shelf-life management: minimum remaining shelf life, best-before date handling
- Recall handling: batch-level withdrawal, customer notification process
- Cold chain: whether temperature-controlled storage is tracked in SAP or external WMS
- CMO/contract manufacturing: whether external manufacturing is in scope
- Quality Management: GMP-compliant inspection plans, usage decisions, CAPA

**Critical Cloud PE constraint for Pharma:**
GxP-regulated systems normally require Computer System Validation. For SAP S/4HANA Cloud PE, SAP provides a Pre-Validated Cloud Service — the client only needs to validate Key User extensions and integrations, not the standard platform. Confirm client's regulatory affairs team understands this distinction.

**Must-add sub-questions:**
- Which products require batch management and serialisation?
- What is your regulatory framework (FDA 21 CFR Part 11, EU GMP Annex 11)?
- Does your team understand SAP's Pre-Validated Cloud Service model?

### Utilities

**Key themes to inject:**
- Contract account management: one account per meter point or per customer?
- Billing cycles: monthly, bimonthly, on-demand — how billing runs are triggered
- Device management: meter reading integration (manual, AMI, smart meter)
- Deregulation: whether the market is regulated or deregulated, impact on pricing
- Credit management: high-volume small-balance collections, disconnection processes
- Move-in/move-out: process for new and terminating customers

**Must-add sub-questions:**
- Is the electricity/gas market regulated or deregulated in your geography?
- How are meter readings collected (manual, AMI, smart meter) and what is the read frequency?
- What is the billing cycle (monthly/bimonthly) and what triggers billing runs?

### Financial Services

**Key themes to inject:**
- Regulatory reporting: Basel III/IV capital requirements, IFRS 17 for insurance
- Multi-entity structure: consolidation, intercompany netting, profit centre allocation
- Cost allocation: fund transfer pricing, product profitability
- Segregation of duties: strict SOD requirements for banking regulators
- Data residency: whether data can reside in SAP's public cloud data centre (confirm country)

**Must-add sub-questions:**
- Which regulatory reporting frameworks apply (Basel, IFRS 17, Solvency II)?
- What are the data residency requirements and does SAP BTP's region cover them?

### Oil & Gas

**Key themes to inject:**
- Joint venture accounting: cost and revenue sharing between JV partners
- Hydrocarbon management: volume tracking, unit of measure (bbl, mcf, MMBtu)
- Project-based procurement: long-lead items, CAPEX project purchasing
- Revenue recognition: royalty calculation, production sharing agreements
- Functional location hierarchy: asset-intensive operations, equipment hierarchies
- HSE integration: whether safety incidents feed into SAP from external HSE system

**Must-add sub-questions:**
- Is joint venture accounting in scope and how many JV partners are there?
- How are hydrocarbon volumes tracked and what unit of measure is used?
- Are production sharing agreements in scope and how is royalty calculated?

---

## CLOUD PE CONSTRAINTS REFERENCE

Use this reference in STEP 4 Lens 3. Match on `SSCUI Reference` and `Topic` keywords.

| Keyword in SSCUI / Topic | Typical Client Expectation | Cloud PE Reality | Extension Path |
|---|---|---|---|
| Custom report / custom layout | Bespoke report designed in ABAP | SAP Analytics Cloud or standard Fiori embedded analytics. No custom ABAP reporting. | SAP Analytics Cloud story, or CDS view exposed via OData |
| Workflow / approval | Complex multi-step custom workflow with email / SAP GUI notification | SAP standard workflow via Manage Workflows Fiori app. No ABAP workflow. | Key User In-App Extension for simple rules; BTP Process Automation for complex flows |
| Form / output | Sapscript or SmartForms layout | Adobe Forms (PDF) or BTP Document Service. No Sapscript. | Key User In-App for template changes; BTP Document Service for custom branded forms |
| Interface / integration | Point-to-point BAPI or RFC call | SAP Integration Suite (Cloud Integration) or API Hub. No direct RFC. | SAP Integration Suite (BTP) |
| Authorisation / role | Custom authorisation object via SE16 or SUIM | Standard role templates with Key User extension. No custom auth objects. | Key User In-App Role Extension |
| Table maintenance / config table | SM30 or SE16 table entries | Fiori Configuration apps or Manage Your Solution app. No SM30. | Key User In-App Configuration Extension |
| Enhancement / exit | User exit, BAdI, CMOD | Adaptation Point framework (In-App Extension). No classic BAdI. | Key User In-App or Developer Extension (ABAP Cloud — restricted) |
| Direct database | SE16, SQL, direct table read | Standard CDS views exposed via OData or SOAP APIs. No direct DB access. | None — use standard APIs |
| Variant configuration | Complex ABAP-driven variant config (LO-VC) | SAP Variant Configuration and Pricing — standard in Cloud PE but with feature limitations vs. ECC. Confirm scope. | None for standard VC; Developer Extension for edge cases |
| Translation / language | Custom translation via SE63 | Standard SAP translation via Manage Translations Fiori app. Supported. | None — standard |
| Batch jobs / background | Custom ABAP batch jobs via SM36 | Application jobs via Schedule Application Jobs Fiori app. No SM36. | Key User In-App for scheduling; ABAP Cloud for custom jobs (restricted) |

---

## Quality Reminders

- A MANDATORY item should never be presented as a design choice — state the requirement, ask only for scope/confirmation details
- Cloud PE constraint flags should tell the client what SAP standard DOES provide, not just what it doesn't
- Workshop prompts must be specific to this client's industry and countries — never generic
- Do not reference: ABAP, ECC, R/3, SE16, SM30, SE38, SE80, user exit, BAdI, CMOD, SMOD, on-premise, private cloud, table maintenance, SM31, SM34, SAP GUI, SAPGUI, OBYC
