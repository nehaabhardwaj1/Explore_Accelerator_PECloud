# routes/deps.py — shared constants and helpers used by all API routers
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CLAUDE_MODEL   = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
CLAUDE_TIMEOUT = int(os.environ.get("CLAUDE_TIMEOUT_S", "240"))
PORT           = int(os.environ.get("PORT", "3000"))

CATALOG_PATH   = ROOT / "scope-catalog.json"
CACHE_PATH     = ROOT / "kdd-cache.json"
DECISIONS_PATH = ROOT / "decisions.json"
OUTPUT_DIR     = ROOT / "output"

OUTPUT_DIR.mkdir(exist_ok=True)


# ── Claude CLI ────────────────────────────────────────────────────────────────

def _resolve_claude() -> str:
    if sys.platform != "win32":
        return "claude"
    if (p := os.environ.get("CLAUDE_PATH")) and Path(p).exists():
        return p
    home    = os.environ.get("USERPROFILE") or str(Path.home())
    appdata = os.environ.get("APPDATA") or str(Path(home, "AppData", "Roaming"))
    for candidate in [
        Path(home, ".local", "bin", "claude.exe"),
        Path(home, "AppData", "Local", "Programs", "claude", "claude.exe"),
        Path(appdata, "npm", "claude.exe"),
        Path(appdata, "npm", "claude.cmd"),
    ]:
        if candidate.exists():
            return str(candidate)
    try:
        out = subprocess.check_output(["where", "claude"], text=True, timeout=5, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            line = line.strip()
            if line and Path(line).exists():
                return line
    except Exception:
        pass
    return "claude"


CLAUDE_EXE = _resolve_claude()


def make_env() -> dict:
    home    = str(Path.home())
    appdata = os.environ.get("APPDATA") or str(Path(home, "AppData", "Roaming"))
    sep     = ";" if sys.platform == "win32" else ":"
    extra   = sep.join([
        str(Path(home, ".local", "bin")),
        str(Path(home, "AppData", "Local", "Programs", "claude")),
        str(Path(appdata, "npm")),
        os.environ.get("PATH", ""),
    ])
    return {**os.environ, "PATH": extra}


async def spawn_claude(prompt: str, timeout: int = CLAUDE_TIMEOUT) -> str:
    is_cmd = sys.platform == "win32" and CLAUDE_EXE.lower().endswith((".cmd", ".bat"))
    if is_cmd:
        proc = await asyncio.create_subprocess_shell(
            f'"{CLAUDE_EXE}" --model {CLAUDE_MODEL} --print --dangerously-skip-permissions',
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=make_env(), cwd=tempfile.gettempdir(),
        )
    else:
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_EXE, "--model", CLAUDE_MODEL, "--print", "--dangerously-skip-permissions",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=make_env(), cwd=tempfile.gettempdir(),
        )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(prompt.encode("utf-8")), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()  # prevent zombie process accumulation
        raise TimeoutError(f"Claude timed out after {timeout}s")
    except asyncio.CancelledError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()  # prevent zombie on request cancellation
        raise
    if proc.returncode != 0:
        stderr_text = _.decode("utf-8", errors="replace")[:400] if _ else ""
        raise RuntimeError(f"Claude exited {proc.returncode}: {stderr_text.strip()}")
    return stdout.decode("utf-8", errors="replace")


# ── Data helpers ──────────────────────────────────────────────────────────────

def load_catalog() -> dict:
    if not CATALOG_PATH.exists():
        return {"items": []}
    data = json.loads(CATALOG_PATH.read_text("utf-8"))
    if isinstance(data, list):
        return {"items": data}
    # Chrome extension saves as "processes" key; normalise to "items"
    if "processes" in data and "items" not in data:
        data = {**data, "items": data["processes"]}
    return data


def load_cache():
    if not CACHE_PATH.exists():
        return None
    return json.loads(CACHE_PATH.read_text("utf-8"))


def load_decisions() -> list:
    if not DECISIONS_PATH.exists():
        return []
    try:
        return json.loads(DECISIONS_PATH.read_text("utf-8"))
    except Exception:
        return []


def save_decisions(decisions: list):
    DECISIONS_PATH.write_text(json.dumps(decisions, indent=2, ensure_ascii=False), "utf-8")


def get_past_decisions(scope_id: str) -> list:
    return [d for d in load_decisions() if d.get("scopeItemId") == scope_id][:5]


def append_run_log(entry: dict):
    try:
        with open(OUTPUT_DIR / "runs.log", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def slugify(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", s.strip())[:40] if s.strip() else "default"


def kdd_data_path(session_id: str = "default") -> Path:
    """Session-scoped kdd-data file — prevents parallel users from clobbering each other."""
    safe = slugify(session_id) or "default"
    return OUTPUT_DIR / f"kdd-data-{safe}.json"
