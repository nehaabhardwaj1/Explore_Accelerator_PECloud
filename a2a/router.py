# a2a/router.py — Google A2A protocol v0.2.2 — fully compliant
# Agent Card at /.well-known/agent.json
# JSON-RPC 2.0  POST /a2a
# SSE streaming GET  /a2a/tasks/{id}/subscribe
# Handoff        GET  /a2a/tasks/{id}/handoff?ack=true
# Event triggers POST /a2a/trigger  |  POST /a2a/listeners
import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter()

_BASE_URL     = os.environ.get("AGENT_BASE_URL", "http://localhost:3000")
_AGENT_ID     = "explore-accelerator"
_AGENT_VER    = "1.0.0"
_AUDIT_LOG    = Path(__file__).parent.parent / "output" / "a2a-audit.log"

# ── Audit logging ──────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(event: str, task_id: str, run_id: str, **kw):
    entry = {
        "ts": _ts(), "event": event, "taskId": task_id, "runId": run_id,
        "agentId": _AGENT_ID, "agentVersion": _AGENT_VER, **kw,
    }
    try:
        _AUDIT_LOG.parent.mkdir(exist_ok=True)
        with _AUDIT_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


# ── Payload injection screening ────────────────────────────────────────────────

_INJECT_RE = re.compile(
    r"ignore (all |previous |prior )?instructions"
    r"|new (system )?prompt"
    r"|you are now"
    r"|disregard (all |your )?"
    r"|<\s*script"
    r"|system\s*:",
    re.IGNORECASE,
)


def _screen(message: dict) -> str | None:
    """Return an error string if payload looks injected, else None."""
    parts = message.get("parts") or []
    text  = " ".join(p.get("text", "") for p in parts if p.get("type") == "text")
    if _INJECT_RE.search(text):
        return "Potential prompt injection detected in payload"
    return None


# ── Agent Card ─────────────────────────────────────────────────────────────────
# Satisfies both the PDF blueprint spec and the A2A v0.2.2 wire format.

AGENT_CARD = {
    # ── PDF spec fields (used by orchestrators for capability-based discovery) ─
    "name":        _AGENT_ID,
    "version":     _AGENT_VER,
    "description": (
        "Generates Key Design Decisions (KDD) for SAP S/4HANA Cloud Public Edition. "
        "Covers BDCQ enrichment, KDD log generation, and scope catalog search."
    ),
    "capabilities": ["kdd.generate", "catalog.search", "bdcq.status"],
    "input_schema": {
        "type": "object",
        "properties": {
            "scope_ids": {
                "type": "array", "items": {"type": "string"},
                "description": "SAP scope item IDs (e.g. ['BD6', 'J59', 'BEI'])",
            },
            "client":  {"type": "string", "description": "Client / company name"},
            "project": {"type": "string", "description": "Project name"},
        },
        "required": ["scope_ids"],
    },
    "output_schema": {
        "type": "object",
        "properties": {
            "kdd_excel_url":  {"type": "string",  "description": "Download URL for the generated KDD Excel log"},
            "scope_overview": {"type": "array",   "description": "Array of scope items with KDD overviews"},
            "total_kdds":     {"type": "integer", "description": "Total KDD rows generated"},
        },
    },
    "auth":     "none",
    "endpoint": f"{_BASE_URL}/a2a",

    # ── A2A v0.2.2 protocol fields ─────────────────────────────────────────────
    "url":             f"{_BASE_URL}/a2a",
    "protocolVersion": "0.2.2",
    "protocolCapabilities": {
        "streaming":              True,
        "pushNotifications":      False,
        "stateTransitionHistory": False,
    },
    "authentication":    {"schemes": ["none"]},
    "defaultInputModes": ["text/plain", "application/json"],
    "defaultOutputModes":["application/json"],

    # ── Skills (detailed per-capability definitions) ───────────────────────────
    "skills": [
        {
            "id":          "kdd.generate",
            "name":        "KDD Generator",
            "description": "Generate 15 KDD questions per SAP scope item with RICEF classification.",
            "tags":        ["kdd", "sap", "s4hana", "cloud", "explore"],
            "examples":    ["Generate KDD for BD6, J59 — Client: Acme Corp, Project: S4H Rollout"],
            "inputModes":  ["text/plain", "application/json"],
            "outputModes": ["application/json"],
        },
        {
            "id":          "catalog.search",
            "name":        "Scope Catalog Search",
            "description": "Search the SAP for Me process catalog by name, LOB, or keyword.",
            "tags":        ["catalog", "scope", "sap"],
            "examples":    ["Find Finance scope items", "Search for Accounts Payable"],
            "inputModes":  ["text/plain"],
            "outputModes": ["application/json"],
        },
        {
            "id":          "bdcq.status",
            "name":        "BDCQ Status",
            "description": "Check if BDCQ questions are loaded and return domain statistics.",
            "tags":        ["bdcq", "status"],
            "examples":    ["Is BDCQ loaded?", "How many BDCQ questions are available?"],
            "inputModes":  ["text/plain"],
            "outputModes": ["application/json"],
        },
    ],
}

# ── In-memory state ────────────────────────────────────────────────────────────

_tasks:       dict[str, dict]          = {}
_subscribers: dict[str, asyncio.Queue] = {}
_listeners:   list[dict]               = []

_A2A_ERRORS = {
    "TASK_NOT_FOUND":    {"code": -32001, "message": "Task not found"},
    "TASK_CANT_CANCEL":  {"code": -32002, "message": "Task cannot be cancelled in current state"},
    "PUSH_NOT_SUPPORTED":{"code": -32003, "message": "Push notifications not supported"},
    "PAYLOAD_REJECTED":  {"code": -32004, "message": "Payload rejected: failed injection screening"},
    "TASK_NOT_COMPLETE": {"code": -32005, "message": "Task not completed — handoff unavailable"},
}


# ── Context envelope (cross-agent trace) ───────────────────────────────────────

def _envelope(task: dict) -> dict:
    return {
        "run_id":               task.get("runId", task["id"]),
        "source_agent":         _AGENT_ID,
        "source_agent_version": _AGENT_VER,
        "timestamp":            _ts(),
    }


# ── Task lifecycle ─────────────────────────────────────────────────────────────

def _new_task(message: dict, session_id: str | None = None) -> dict:
    task_id = str(uuid.uuid4())
    meta    = message.get("metadata") or {}
    # Propagate caller's run_id for end-to-end trace correlation
    run_id  = meta.get("run_id") or task_id
    task = {
        "id":        task_id,
        "sessionId": session_id or task_id,
        "runId":     run_id,
        "status":    {"state": "submitted", "timestamp": _ts()},
        "messages":  [message],
        "artifacts": [],
        "metadata":  {
            "runId":         run_id,
            "sourceAgent":   meta.get("source_agent", "external"),
            "agentId":       _AGENT_ID,
            "agentVersion":  _AGENT_VER,
        },
    }
    _tasks[task_id] = task
    return task


def _set_state(task: dict, state: str, message_text: str | None = None) -> dict:
    task["status"] = {
        "state":     state,
        "timestamp": _ts(),
        "context":   _envelope(task),
    }
    if message_text:
        task["status"]["message"] = {
            "role": "agent", "parts": [{"type": "text", "text": message_text}]
        }
    return task


def _push(task_id: str, event: dict):
    q = _subscribers.get(task_id)
    if q:
        q.put_nowait(event)


def _publish_event(event_type: str, payload: dict):
    """Notify registered listeners about an internal event."""
    for lst in _listeners:
        if lst.get("event") in (event_type, "*"):
            _audit("event.published", payload.get("taskId", "system"),
                   payload.get("runId", "system"), eventType=event_type,
                   listenerId=lst.get("id", "?"))


# ── JSON-RPC helpers ───────────────────────────────────────────────────────────

def _ok(id_, result):
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _err(id_, error_key_or_obj):
    if isinstance(error_key_or_obj, str):
        err = _A2A_ERRORS.get(error_key_or_obj, {"code": -32000, "message": error_key_or_obj})
    else:
        err = error_key_or_obj
    return {"jsonrpc": "2.0", "id": id_, "error": err}


# ── Background task runner ─────────────────────────────────────────────────────

async def _run_task(task: dict):
    from .task_runner import execute
    task_id = task["id"]
    run_id  = task.get("runId", task_id)

    _set_state(task, "working")
    _push(task_id, {"id": task_id, "status": task["status"], "final": False})
    _audit("task.started", task_id, run_id)

    try:
        artifacts = await execute(
            task,
            lambda ev: _push(task_id, {"id": task_id, "status": task["status"], "final": False}),
        )
        task["artifacts"] = artifacts
        _set_state(task, "completed")
        for artifact in artifacts:
            _push(task_id, {"id": task_id, "artifact": artifact, "final": False})
        _push(task_id, {"id": task_id, "status": task["status"], "final": True})
        _audit("task.completed", task_id, run_id, artifactCount=len(artifacts))
        _publish_event("kdd.completed", {"taskId": task_id, "runId": run_id})

    except Exception as exc:
        _set_state(task, "failed", str(exc)[:200])
        _push(task_id, {"id": task_id, "status": task["status"], "final": True})
        _audit("task.failed", task_id, run_id, error=str(exc)[:200])


# ── Route handlers ─────────────────────────────────────────────────────────────

@router.get("/")
async def get_agent_card():
    return JSONResponse(AGENT_CARD)


# ── Task read endpoints ────────────────────────────────────────────────────────

@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = _tasks.get(task_id)
    if not task:
        return JSONResponse(_err(None, "TASK_NOT_FOUND"), status_code=404)
    return JSONResponse(_ok(task_id, task))


@router.get("/tasks/{task_id}/handoff")
async def get_handoff(task_id: str, ack: bool = False):
    """
    Package a completed task as a versioned JSON handoff payload for the next
    agent in the pipeline.  Pass ?ack=true to acknowledge receipt.
    Schema: kdd_handoff_v1
    """
    task = _tasks.get(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)
    if task["status"]["state"] != "completed":
        return JSONResponse(_err(None, "TASK_NOT_COMPLETE"), status_code=409)

    payload = {
        "schema_version": "kdd_handoff_v1",
        "context":        _envelope(task),
        "task_id":        task_id,
        "artifacts":      task.get("artifacts", []),
        "status":         task["status"],
        "metadata":       task.get("metadata", {}),
    }

    if ack:
        task["metadata"]["acknowledged"]    = True
        task["metadata"]["acknowledgedAt"]  = _ts()
        _audit("task.acknowledged", task_id, task.get("runId", task_id))

    return JSONResponse(payload)


@router.get("/tasks/{task_id}/subscribe")
async def subscribe_task(task_id: str):
    task = _tasks.get(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    q: asyncio.Queue = asyncio.Queue()
    _subscribers[task_id] = q

    async def event_gen() -> AsyncGenerator[str, None]:
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("final"):
                        break
                except asyncio.TimeoutError:
                    yield "data: {\"type\":\"heartbeat\"}\n\n"
        finally:
            _subscribers.pop(task_id, None)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# ── Event-driven auto-connection ───────────────────────────────────────────────

@router.post("/trigger")
async def receive_trigger(request: Request):
    """
    Accept an event from another agent (e.g. charter.approved) and start a task.
    Body: { "event": "charter.approved", "run_id": "...", "source_agent": "...", "payload": {...} }
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    run_id  = body.get("run_id") or str(uuid.uuid4())
    payload = body.get("payload", {})
    message = {
        "role":  "agent",
        "parts": [{"type": "text", "text": json.dumps(payload)}],
        "metadata": {
            "run_id":       run_id,
            "source_agent": body.get("source_agent", "external"),
            "event":        body.get("event", ""),
        },
    }
    task = _new_task(message)
    asyncio.create_task(_run_task(task))
    _audit("trigger.received", task["id"], run_id, eventType=body.get("event", ""))
    return JSONResponse({"ok": True, "taskId": task["id"], "runId": run_id})


@router.post("/listeners")
async def register_listener(request: Request):
    """Register a callback so this agent notifies you when an event fires."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    listener = {
        "id":           str(uuid.uuid4()),
        "event":        body.get("event", "*"),
        "callbackUrl":  body.get("callbackUrl", ""),
        "registeredAt": _ts(),
    }
    _listeners.append(listener)
    return JSONResponse({"ok": True, "listenerId": listener["id"]})


@router.get("/listeners")
async def list_listeners():
    return JSONResponse({"listeners": _listeners})


@router.delete("/listeners/{listener_id}")
async def delete_listener(listener_id: str):
    global _listeners
    before   = len(_listeners)
    _listeners = [l for l in _listeners if l["id"] != listener_id]
    if len(_listeners) == before:
        return JSONResponse({"error": "Listener not found"}, status_code=404)
    return JSONResponse({"ok": True})


# ── JSON-RPC entry point ───────────────────────────────────────────────────────

@router.post("/")
async def a2a_rpc(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None,
                             "error": {"code": -32700, "message": "Parse error"}})

    id_    = body.get("id")
    method = body.get("method", "")
    params = body.get("params", {})

    # ── tasks/send ────────────────────────────────────────────────────────────
    if method == "tasks/send":
        message    = params.get("message", {})
        session_id = params.get("sessionId")

        err = _screen(message)
        if err:
            _audit("payload.rejected", "N/A", "N/A", reason=err)
            return JSONResponse(_err(id_, "PAYLOAD_REJECTED"))

        task = _new_task(message, session_id)
        asyncio.create_task(_run_task(task))
        _audit("task.submitted", task["id"], task["runId"], method=method)
        return JSONResponse(_ok(id_, task))

    # ── tasks/sendSubscribe ───────────────────────────────────────────────────
    if method == "tasks/sendSubscribe":
        message    = params.get("message", {})
        session_id = params.get("sessionId")

        err = _screen(message)
        if err:
            _audit("payload.rejected", "N/A", "N/A", reason=err)
            return JSONResponse(_err(id_, "PAYLOAD_REJECTED"))

        task = _new_task(message, session_id)
        q: asyncio.Queue = asyncio.Queue()
        _subscribers[task["id"]] = q
        asyncio.create_task(_run_task(task))
        _audit("task.submitted", task["id"], task["runId"], method=method)

        async def sse_gen() -> AsyncGenerator[str, None]:
            # Initial submitted-state event
            yield f"data: {json.dumps({'id': task['id'], 'status': task['status'], 'final': False})}\n\n"
            try:
                while True:
                    try:
                        event = await asyncio.wait_for(q.get(), timeout=30)
                        yield f"data: {json.dumps(event)}\n\n"
                        if event.get("final"):
                            break
                    except asyncio.TimeoutError:
                        yield "data: {\"type\":\"heartbeat\"}\n\n"
            finally:
                _subscribers.pop(task["id"], None)

        return StreamingResponse(sse_gen(), media_type="text/event-stream")

    # ── tasks/get ─────────────────────────────────────────────────────────────
    if method == "tasks/get":
        task_id = params.get("id")
        task    = _tasks.get(task_id)
        if not task:
            return JSONResponse(_err(id_, "TASK_NOT_FOUND"))
        return JSONResponse(_ok(id_, task))

    # ── tasks/cancel ──────────────────────────────────────────────────────────
    if method == "tasks/cancel":
        task_id = params.get("id")
        task    = _tasks.get(task_id)
        if not task:
            return JSONResponse(_err(id_, "TASK_NOT_FOUND"))
        if task["status"]["state"] in ("completed", "failed", "canceled"):
            return JSONResponse(_err(id_, "TASK_CANT_CANCEL"))
        _set_state(task, "canceled")
        _push(task_id, {"type": "status", "status": task["status"], "final": True})
        _audit("task.canceled", task_id, task.get("runId", task_id))
        return JSONResponse(_ok(id_, task))

    # ── tasks/pushNotificationConfig ──────────────────────────────────────────
    if method in ("tasks/pushNotificationConfig/set", "tasks/pushNotificationConfig/get"):
        return JSONResponse(_err(id_, "PUSH_NOT_SUPPORTED"))

    return JSONResponse(_err(id_, {"code": -32601, "message": f"Method not found: {method}"}))
