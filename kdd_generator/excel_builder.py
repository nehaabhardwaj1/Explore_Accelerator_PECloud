# kdd_generator/excel_builder.py — 5-sheet XLSX builder using openpyxl
import argparse
import json
import sys
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from .helpers import (
    dedup, detect_on_prem, get_rag_status, get_decision_owner,
    get_sap_activate_phase, get_integration_flags, get_config_effort,
)

ROOT = Path(__file__).resolve().parent.parent

HEADERS = [
    "Industry", "Module", "L1", "L2", "L3", "L4",
    "KDD ID", "Scope Item ID", "Scope Item Name", "Design Question",
    "Decision Made", "Rationale", "Impact / Actions",
    "Fit/Gap", "Complexity", "RAG", "SAP Activate Phase", "Config Effort",
    "Integration Flags", "Decision Owner", "SAP Consultant", "Status",
    "Notes", "Source", "Data Source",
    "Workshop Date", "Decided By", "Sign-off Status", "Action Items", "BPD Reference",
    "RICEF Title", "RICEF Type", "Extensibility Path", "BTP Required", "Effort Estimate", "Complexity",
]
COL_WIDTHS = [
    18, 10, 20, 25, 25, 25,
    15, 15, 35, 65,
    30, 30, 30,
    13, 13, 10, 16, 18,
    25, 22, 22, 13,
    30, 35, 20,
    16, 22, 16, 45, 22,
    35, 13, 22, 13, 14, 13,
]

_HEADER_FILL  = PatternFill("solid", fgColor="1F4E79")
_WARN_FILL    = PatternFill("solid", fgColor="FF0000")
_HEADER_FONT  = Font(color="FFFFFF", bold=True, size=9)
_BOLD         = Font(bold=True)
_WARN_FONT    = Font(color="FFFFFF", bold=True, size=8)


def _set_col_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _make_kdd_sheet(wb: Workbook, rows: list) -> None:
    ws = wb.create_sheet("KDD Master Log")

    # Header row
    ws.append(HEADERS)
    for cell in ws[1]:
        cell.font      = _HEADER_FONT
        cell.fill      = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    # Disclaimer row
    disclaimer = [""] * len(HEADERS)
    disclaimer[0] = "WARNING"
    disclaimer[9] = "AI-generated. SAP S/4HANA Cloud Public Edition only. Validate with a Cloud PE consultant before use."
    ws.append(disclaimer)
    for cell in ws[2]:
        if cell.value:
            cell.font = _WARN_FONT
            cell.fill = _WARN_FILL

    # Data rows
    for r in rows:
        row_vals = [
            "Cross Industry",
            r.get("module", ""),
            r.get("l1", ""),
            r.get("l2", ""),
            r.get("l3", ""),
            r.get("l4", ""),
            r.get("kddId", ""),
            r.get("scopeItemId", ""),
            r.get("scopeItemName", ""),
            r.get("designQuestion", ""),
            r.get("decisionMade", ""),
            r.get("rationale", ""),
            r.get("impactActions", ""),
            r.get("fitGap", "Fit"),
            r.get("complexity", "Low"),
            get_rag_status(r),
            get_sap_activate_phase(r),
            get_config_effort(r),
            get_integration_flags(r),
            r.get("decisionOwner") or get_decision_owner(r),
            r.get("sapConsultant", ""),
            r.get("status", "Open"),
            r.get("notes", ""),
            r.get("source", ""),
            r.get("dataSource", ""),
            r.get("workshopDate", ""),
            r.get("decidedBy", ""),
            r.get("signOffStatus", "Open"),
            r.get("actionItems", ""),
            r.get("bpdRef", ""),
            r.get("ricefTitle", ""),
            r.get("ricefType", "None"),
            r.get("extensibilityType", "None"),
            r.get("btpRequired", "No"),
            r.get("effortEstimate", "None"),
            r.get("complexity", "Low"),
        ]
        ws.append(row_vals)
        # Wrap text for long columns
        for cell in ws[ws.max_row]:
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    _set_col_widths(ws, COL_WIDTHS)
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 30


def _make_overview_sheet(wb: Workbook, overviews: list) -> None:
    if not overviews:
        return
    ws = wb.create_sheet("Scope Overview")
    headers = [
        "Scope Item ID", "Scope Item Name", "Module", "Line of Business",
        "SAP Version", "Overview", "Key Process Flow", "Business Benefits", "Source",
    ]
    ws.append(headers)
    for cell in ws[1]:
        cell.font      = _HEADER_FONT
        cell.fill      = _HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    for o in overviews:
        ws.append([
            o.get("id"), o.get("name"), o.get("module"), o.get("lob"),
            o.get("version"), o.get("overview"),
            o.get("keyProcessFlow"), o.get("businessBenefits"), o.get("source"),
        ])
        for cell in ws[ws.max_row]:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    for i, w in enumerate([15, 40, 10, 28, 12, 100, 100, 80, 15], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def _make_instructions_sheet(wb: Workbook, meta: dict) -> None:
    ws = wb.create_sheet("Instructions")
    today = date.today().strftime("%d/%m/%Y")
    rows = [
        ("KDD Master Log", ""),
        ("", ""),
        ("Client",          meta.get("client", "")),
        ("Project",         meta.get("project", "")),
        ("Generated",       today),
        ("Catalog version", meta.get("catalogVersion", "")),
        ("", ""),
        ("Column",          "Guidance"),
        ("Source",          "SAP for Me = real extracted content. Claude Knowledge = AI-generated."),
        ("Data Source",     "Indicates quality level. SAP for Me rows are higher quality."),
        ("Fit/Gap",         "Fit / Partial Fit / Gap"),
        ("Complexity",      "Low / Medium / High"),
        ("Status",          "Open / In Progress / Closed"),
        ("", ""),
        ("IMPORTANT",       "SAP S/4HANA Cloud PUBLIC EDITION only — not ECC, not Private Cloud"),
        ("Validate",        "All Fiori app IDs and SPRO paths must be validated by a Cloud PE consultant"),
        ("SAP Help",        "https://help.sap.com/docs/SAP_S4HANA_CLOUD"),
    ]
    for r in rows:
        ws.append(list(r))
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 80
    ws["A1"].font = _BOLD
    ws["A8"].font = _BOLD


def _make_cover_sheet(wb: Workbook, rows: list, meta: dict) -> None:
    ws = wb.create_sheet("Cover")
    today = date.today().strftime("%d/%m/%Y")
    data = [
        ("", ""),
        ("", ""),
        ("    ACCENTURE", ""),
        ("", ""),
        ("    KEY DESIGN DECISIONS (KDD) LOG", ""),
        ("", ""),
        ("    SAP S/4HANA Cloud Public Edition", ""),
        ("", ""),
        ("    Client:",          meta.get("client", "[Client Name]")),
        ("    Project:",         meta.get("project", "[Project Name]")),
        ("    Generated:",       today),
        ("    Catalog Version:", meta.get("catalogVersion", "")),
        ("    Scope Items:",     meta.get("scopeCount", "")),
        ("    Total KDD Items:", len(rows)),
        ("", ""),
        ("    DISCLAIMER", ""),
        ("    This document contains AI-generated KDD questions.", ""),
        ("    SAP S/4HANA Cloud Public Edition only.", ""),
        ("    All items must be validated by a certified Cloud PE consultant.", ""),
    ]
    for r in data:
        ws.append(list(r))
    ws.column_dimensions["A"].width = 35
    ws.column_dimensions["B"].width = 50


def _make_summary_sheet(wb: Workbook, rows: list, meta: dict) -> None:
    ws = wb.create_sheet("Summary")
    today = date.today().strftime("%d/%m/%Y")
    by_process = {}
    for r in rows:
        k = r.get("scopeItemId", "Unknown")
        by_process.setdefault(k, []).append(r)

    data = [
        ("KDD Summary",   ""),
        ("Client",        meta.get("client", "")),
        ("Project",       meta.get("project", "")),
        ("Generated",     today),
        ("", ""),
        ("Scope Items",      len(by_process)),
        ("Total KDD Items",  len(rows)),
        ("SAP for Me rows",  sum(1 for r in rows if r.get("dataSource") == "SAP for Me")),
        ("AI Knowledge rows",sum(1 for r in rows if r.get("dataSource") != "SAP for Me")),
        ("", ""),
        ("Fit",          sum(1 for r in rows if r.get("fitGap") == "Fit")),
        ("Partial Fit",  sum(1 for r in rows if r.get("fitGap") == "Partial Fit")),
        ("Gap",          sum(1 for r in rows if r.get("fitGap") == "Gap")),
        ("", ""),
        ("Low",          sum(1 for r in rows if r.get("complexity") == "Low")),
        ("Medium",       sum(1 for r in rows if r.get("complexity") == "Medium")),
        ("High",         sum(1 for r in rows if r.get("complexity") == "High")),
        ("", ""),
        ("Red",          sum(1 for r in rows if get_rag_status(r) == "Red")),
        ("Amber",        sum(1 for r in rows if get_rag_status(r) == "Amber")),
        ("Green",        sum(1 for r in rows if get_rag_status(r) == "Green")),
        ("", ""),
        ("── Workshop Outcomes ──", ""),
        ("Approved",    sum(1 for r in rows if r.get("signOffStatus") == "Approved")),
        ("Deferred",    sum(1 for r in rows if r.get("signOffStatus") == "Deferred")),
        ("Rejected",    sum(1 for r in rows if r.get("signOffStatus") == "Rejected")),
        ("Open",        sum(1 for r in rows if not r.get("signOffStatus") or r.get("signOffStatus") == "Open")),
        ("With BPD Ref",    sum(1 for r in rows if (r.get("bpdRef") or "").strip())),
        ("Action Items",    sum(1 for r in rows if (r.get("actionItems") or "").strip())),
        ("", ""),
        ("── RICEF / Extensibility ──", ""),
        ("RICEF Items (Gap rows)", sum(1 for r in rows if r.get("ricefType") and r["ricefType"] != "None")),
        ("  R — Reports",           sum(1 for r in rows if r.get("ricefType") == "R")),
        ("  I — Interfaces",        sum(1 for r in rows if r.get("ricefType") == "I")),
        ("  C — Conversions",       sum(1 for r in rows if r.get("ricefType") == "C")),
        ("  E — Enhancements",      sum(1 for r in rows if r.get("ricefType") == "E")),
        ("  F — Forms",             sum(1 for r in rows if r.get("ricefType") == "F")),
        ("  W — Workflows",         sum(1 for r in rows if r.get("ricefType") == "W")),
        ("Key User In-App",         sum(1 for r in rows if r.get("extensibilityType") == "Key User In-App")),
        ("Developer ABAP Cloud",    sum(1 for r in rows if r.get("extensibilityType") == "Developer ABAP Cloud")),
        ("Side-by-Side BTP",        sum(1 for r in rows if r.get("extensibilityType") == "Side-by-Side BTP")),
        ("BTP Required",            sum(1 for r in rows if r.get("btpRequired") == "Yes")),
        ("Effort S (<1 day)",       sum(1 for r in rows if r.get("effortEstimate") == "S")),
        ("Effort M (1–3 days)",     sum(1 for r in rows if r.get("effortEstimate") == "M")),
        ("Effort L (1–2 weeks)",    sum(1 for r in rows if r.get("effortEstimate") == "L")),
        ("Effort XL (>2 weeks)",    sum(1 for r in rows if r.get("effortEstimate") == "XL")),
    ]
    for row in data:
        ws.append(list(row))
    ws.column_dimensions["A"].width = 25
    ws.column_dimensions["B"].width = 15


def build_excel(all_rows: list, meta: dict, output_path: Path = None) -> Path:
    dd = dedup(all_rows)
    wb = Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    _make_cover_sheet(wb, dd, meta)
    _make_instructions_sheet(wb, meta)
    _make_overview_sheet(wb, meta.get("overviews") or [])
    _make_kdd_sheet(wb, dd)
    _make_summary_sheet(wb, dd, meta)

    if not output_path:
        client  = "".join(c if c.isalnum() else "_" for c in (meta.get("client") or ""))[:20]
        project = "".join(c if c.isalnum() else "_" for c in (meta.get("project") or ""))[:20]
        today   = date.today().strftime("%Y%m%d")
        parts   = ["Accenture_KDD"]
        if client:  parts.append(client)
        if project: parts.append(project)
        parts.append(today)
        filename    = "_".join(parts) + ".xlsx"
        out_dir     = ROOT / "output"
        out_dir.mkdir(exist_ok=True)
        output_path = out_dir / filename

    wb.save(str(output_path))
    return output_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  required=True, help="Path to kdd-data-{session}.json (session-scoped, required)")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    payload = json.loads(input_path.read_text("utf-8"))
    rows    = payload.get("rows", [])
    meta    = payload.get("meta", {})

    if not rows:
        print("No KDD rows in input file.", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output) if args.output else None
    out = build_excel(rows, meta, output_path)
    print(f"Excel written: {out}")
    print(f"Rows: {len(dedup(rows))}  |  Sheets: Cover · Instructions · Scope Overview · KDD Master Log · Summary")


if __name__ == "__main__":
    main()
