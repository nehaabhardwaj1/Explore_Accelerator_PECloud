# agents_py/generation_agent.py — Stage 4: generate KDDs via Claude CLI
# Three sequential async subprocess calls:
#   Call 1 (~25-40s) — 15 questions, 6 core fields
#   Call 2 (~20-35s) — enrich with rationale, owner, phase, notes
#   Call 3 (~15-30s) — RICEF classification for Gap/Partial rows
import asyncio
import json
import logging
import os
import re
import sys
import tempfile
import time

from .shared import CLAUDE_MODEL, CLAUDE_TIMEOUT_S, LOB_MODULE, PROMPT_VERSION, ROOT

log = logging.getLogger(__name__)


# ── Claude CLI resolution (Windows) ──────────────────────────────────────────
def _resolve_claude() -> str:
    if sys.platform != "win32":
        return "claude"
    if (p := os.environ.get("CLAUDE_PATH")) and os.path.exists(p):
        return p
    home       = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    appdata    = os.environ.get("APPDATA")    or os.path.join(home, "AppData", "Roaming")
    localappdata = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    candidates = [
        os.path.join(home,        ".local", "bin", "claude.exe"),
        os.path.join(localappdata, "Programs", "claude", "claude.exe"),
        os.path.join(appdata,     "npm", "claude.exe"),
        os.path.join(appdata,     "npm", "claude.cmd"),
        os.path.join(home,        ".local", "bin", "claude.cmd"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    try:
        import subprocess
        out = subprocess.check_output(["where", "claude"], text=True, timeout=5,
                                      stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            line = line.strip()
            if line and os.path.exists(line):
                return line
    except Exception:
        pass
    return "claude"


_CLAUDE_EXE = _resolve_claude()


def _make_env() -> dict:
    home    = os.path.expanduser("~")
    appdata = os.environ.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
    sep     = ";" if sys.platform == "win32" else ":"
    extra   = sep.join([
        os.path.join(home, ".local", "bin"),
        os.path.join(home, "AppData", "Local", "Programs", "claude"),
        os.path.join(appdata, "npm"),
        os.environ.get("PATH", ""),
    ])
    return {**os.environ, "PATH": extra}


async def _spawn_claude(prompt: str, timeout: int = CLAUDE_TIMEOUT_S) -> str:
    is_cmd = sys.platform == "win32" and _CLAUDE_EXE.lower().endswith((".cmd", ".bat"))
    args   = [_CLAUDE_EXE, "--model", CLAUDE_MODEL, "--print", "--dangerously-skip-permissions"]

    if is_cmd:
        # .cmd shims need cmd.exe shell
        shell_args = f'"{_CLAUDE_EXE}" --model {CLAUDE_MODEL} --print --dangerously-skip-permissions'
        proc = await asyncio.create_subprocess_shell(
            shell_args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_make_env(),
            cwd=tempfile.gettempdir(),
        )
    else:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_make_env(),
            cwd=tempfile.gettempdir(),
        )

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(prompt.encode("utf-8")), timeout=timeout
        )
    except asyncio.TimeoutError:
        proc.kill()
        raise TimeoutError(f"Claude timed out after {timeout}s")

    if proc.returncode != 0:
        msg = stderr.decode("utf-8", errors="replace")[:200]
        raise RuntimeError(f"Claude exited {proc.returncode}: {msg}")

    return stdout.decode("utf-8", errors="replace")


def _extract_json(raw: str) -> list:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"^```\s*$", "", cleaned, flags=re.MULTILINE).strip()

    s = cleaned.find("[")
    e = cleaned.rfind("]")
    if s < 0 or e < 0:
        raise ValueError("No JSON array in response")
    json_str = cleaned[s:e + 1]

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    # Repair: fix unescaped newlines inside strings, trailing commas
    repaired = re.sub(
        r'"(?:[^"\\]|\\.)*"',
        lambda m: m.group().replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t"),
        json_str,
    )
    repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError:
        preview = json_str[:300].replace("\n", "↵")
        raise ValueError(f"JSON parse failed. Preview: {preview}")


def _fill_defaults(rows: list, item: dict, mod: str) -> list:
    out = []
    for i, r in enumerate(rows):
        out.append({
            "kddId":            r.get("kddId")            or f"{item['id']}-KDD-{i+1:03d}",
            "scopeItemId":      item["id"],
            "scopeItemName":    item["name"],
            "designQuestion":   r.get("designQuestion")   or "",
            "fitGap":           r.get("fitGap")           or "Fit",
            "complexity":       r.get("complexity")       or "Low",
            "status":           "Open",
            "module":           mod,
            "l1":               item.get("lob") or r.get("l1") or "",
            "l2":               r.get("l2")               or "",
            "l3":               "",
            "l4":               "",
            "decisionOwner":    r.get("decisionOwner")    or "",
            "sapActivatePhase": r.get("sapActivatePhase") or "Explore",
            "rationale":        r.get("rationale")        or "",
            "impactActions":    r.get("impactActions")    or "",
            "notes":            r.get("notes")            or "",
            "decisionMade":     "",
            "sapConsultant":    "",
            "ricefTitle":       "",
            "ricefType":        "None",
            "extensibilityType":"None",
            "btpRequired":      "No",
            "effortEstimate":   "None",
            "source":           "SAP for Me - Process Navigator",
            "dataSource":       "SAP for Me",
        })
    return out


# ── Call 1: Question Generation ───────────────────────────────────────────────
async def _generate_questions(item: dict, context: dict, past_decisions: list,
                              retry: int = 0) -> list:
    mod = LOB_MODULE.get(item.get("lob", ""), "Cross")

    desc_parts = []
    if context.get("overview"):
        desc_parts.append(f"Overview: {context['overview']}")
    if context.get("flow"):
        desc_parts.append(f"Key Process Flow:\n{context['flow']}")
    if context.get("benefits"):
        desc_parts.append(f"Business Benefits: {context['benefits']}")
    desc_block = "\n\n".join(desc_parts)

    past_block = ""
    if past_decisions:
        lines = "\n".join(f"• {d['question']} [{d.get('fitGap','?')}]" for d in past_decisions)
        past_block = f"\nPast decisions for {item['id']}:\n{lines}"

    prompt = f"""Generate exactly 15 KDD questions for SAP S/4HANA Cloud Public Edition.

Scope: {item['id']} — {item['name']} | LOB: {item.get('lob','')} | Module: {mod}

{desc_block}
{past_block}

Rules: Cloud PE only. Each question must name a specific Fiori app or BTP service. No ABAP/ECC/SAP GUI/on-premise.
IMPORTANT: If the description does not give enough detail to name a real Fiori app, write the question as "To confirm in workshop: [category] configuration approach" — do NOT fabricate an app name.

Cover: [2] Fiori Config  [2] Master Data  [2] Approval/Workflow  [1] Outputs/Forms
       [2] Integration  [1] Reporting  [1] Authorisation  [2] Data Migration
       [1] Org Structure  [1] Number Ranges

Return ONLY a JSON array of exactly 15 objects with these 6 fields:
[{{
  "kddId": "{item['id']}-KDD-001",
  "designQuestion": "specific question naming Fiori app (max 150 chars)",
  "fitGap": "Fit" | "Partial Fit" | "Gap",
  "complexity": "Low" | "Medium" | "High",
  "l1": "top-level area e.g. Finance",
  "l2": "sub-area e.g. Accounts Payable"
}}]
JSON only. No markdown."""

    out  = await _spawn_claude(prompt)
    rows = _extract_json(out)

    if not isinstance(rows, list) or len(rows) != 15:
        if retry == 0:
            log.warning("%s call-1 wrong count — retrying", item["id"])
            return await _generate_questions(item, context, past_decisions, 1)
        raise ValueError(f"Call 1: expected 15 rows, got {len(rows) if isinstance(rows, list) else type(rows)}")

    log.info("%s — call-1 done (%d questions)", item["id"], len(rows))
    return rows


# ── Call 2: Enrichment ────────────────────────────────────────────────────────
async def _enrich_questions(item: dict, questions: list, retry: int = 0) -> list:
    q_lines = "\n".join(
        f"{i+1}. [{q['kddId']}] [{q.get('fitGap','')}] {q.get('designQuestion','')}"
        for i, q in enumerate(questions)
    )
    prompt = f"""You are an SAP S/4HANA Cloud Public Edition consultant.

Add detail fields to these {len(questions)} KDD questions for scope item {item['id']} — {item['name']}.

Questions:
{q_lines}

Return ONLY a JSON array of exactly {len(questions)} objects:
[{{
  "kddId": "...",
  "decisionOwner": "role e.g. Finance Lead / IT Security Lead / Plant Manager",
  "sapActivatePhase": "Explore" | "Realize" | "Deploy",
  "rationale": "1 sentence why this matters for Cloud PE (max 100 chars)",
  "impactActions": "1 sentence consequence if not decided before go-live (max 100 chars)",
  "notes": "exact Fiori app name or BTP service (max 80 chars)"
}}]
Cloud PE only. No ABAP/ECC/SAP GUI.
IMPORTANT: If you cannot determine a field from the question text alone, write "To be confirmed" — never guess or fabricate Fiori app names. JSON only."""

    out    = await _spawn_claude(prompt)
    detail = _extract_json(out)

    if not isinstance(detail, list) or len(detail) != len(questions):
        if retry == 0:
            log.warning("%s call-2 wrong count — retrying", item["id"])
            return await _enrich_questions(item, questions, 1)
        log.warning("%s call-2 failed after retry — using empty enrichment", item["id"])
        return [{**q, "decisionOwner": "", "sapActivatePhase": "Explore",
                 "rationale": "", "impactActions": "", "notes": ""} for q in questions]

    by_id = {d["kddId"]: d for d in detail}
    merged = []
    for i, q in enumerate(questions):
        d = by_id.get(q["kddId"], detail[i] if i < len(detail) else {})
        merged.append({
            **q,
            "decisionOwner":    d.get("decisionOwner", ""),
            "sapActivatePhase": d.get("sapActivatePhase", "Explore"),
            "rationale":        d.get("rationale", ""),
            "impactActions":    d.get("impactActions", ""),
            "notes":            d.get("notes", ""),
        })
    return merged


# ── Call 3: RICEF Classification ──────────────────────────────────────────────
async def _classify_ricef(item: dict, rows: list) -> list:
    targets = [r for r in rows if r.get("fitGap") in ("Gap", "Partial Fit")]
    if not targets:
        return rows

    lines = "\n".join(
        f"{i+1}. [{r['kddId']}] [{r.get('fitGap','')}] {r.get('designQuestion','')}"
        for i, r in enumerate(targets)
    )
    prompt = f"""SAP S/4HANA Cloud PE extensibility classifier. Scope: {item['id']} — {item['name']}.

{lines}

Return ONLY JSON array of exactly {len(targets)} objects:
[{{
  "kddId": "...",
  "ricefTitle": "short title — {item['id']}",
  "ricefType": "R"|"I"|"C"|"E"|"F"|"W"|"None",
  "extensibilityType": "Key User In-App"|"Developer ABAP Cloud"|"Side-by-Side BTP"|"None",
  "btpRequired": "Yes"|"No"|"Possible",
  "effortEstimate": "S"|"M"|"L"|"XL"|"None"
}}]
No on-premise ABAP.
IMPORTANT: If fitGap does not clearly indicate an extensibility need, set ricefType to "None" and extensibilityType to "None" — do not guess. JSON only."""

    try:
        out        = await asyncio.wait_for(_spawn_claude(prompt), timeout=60)
        classified = _extract_json(out)
        by_id      = {c["kddId"]: c for c in classified}
        return [
            {**r, **{
                "ricefTitle":       by_id[r["kddId"]].get("ricefTitle", ""),
                "ricefType":        by_id[r["kddId"]].get("ricefType", "None"),
                "extensibilityType":by_id[r["kddId"]].get("extensibilityType", "None"),
                "btpRequired":      by_id[r["kddId"]].get("btpRequired", "No"),
                "effortEstimate":   by_id[r["kddId"]].get("effortEstimate", "None"),
            }} if r["kddId"] in by_id else r
            for r in rows
        ]
    except Exception as e:
        log.warning("%s RICEF skipped: %s", item["id"], e)
        return rows


# ── Agent entry point ─────────────────────────────────────────────────────────
async def run(state: dict) -> dict:
    item           = state["item"]
    context        = state.get("context", {})
    past_decisions = state.get("past_decisions", [])
    on_event       = state.get("on_event")
    mod            = LOB_MODULE.get(item.get("lob", ""), "Cross")
    t0             = time.monotonic()

    def emit(msg: str):
        if on_event:
            on_event({"type": "progress", "item": item["id"], "name": item["name"], "message": msg})

    emit("[4a/5] Generating 15 questions…")
    questions = await _generate_questions(item, context, past_decisions)
    emit(f"[4b/5] Questions ready ({int(time.monotonic()-t0)}s) — adding rationale & detail…")

    enriched = await _enrich_questions(item, questions)
    emit(f"[4c/5] Detail added ({int(time.monotonic()-t0)}s) — classifying RICEF…")

    full_rows  = _fill_defaults(enriched, item, mod)
    with_ricef = await _classify_ricef(item, full_rows)

    total_s = int(time.monotonic() - t0)
    log.info("%s — done in %ds (3 calls)", item["id"], total_s)

    # Approximate token counts
    input_tokens  = round((min(len(item.get("description", "")), 800) + 400) / 4)
    output_tokens = round((6 * 30 + 5 * 25) * 15 / 4)

    versioned = [{**r, "promptVersion": PROMPT_VERSION} for r in with_ricef]
    return {
        **state,
        "source":        "claude",
        "rows":          versioned,
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
        "generation_ms": total_s * 1000,
        "promptVersion": PROMPT_VERSION,
    }
