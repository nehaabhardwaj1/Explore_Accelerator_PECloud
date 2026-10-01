# a2a/router.py — A2A protocol v0.2.x — spec-compliant
# Agent Card  GET  /.well-known/agent.json  (served via server.py)
# JSON-RPC    POST /a2a  and  POST /a2a/    (both handled, no redirect)
# SSE stream  GET  /a2a/tasks/{id}/subscribe
# Handoff     GET  /a2a/tasks/{id}/handoff?ack=true   (internal, non-A2A)
# Trigger     POST /a2a/trigger                        (internal, non-A2A)
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

_BASE_URL  = os.environ.get("AGENT_BASE_URL", "http://localhost:3000")
_AGENT_ID  = "explore-accelerator"
_AGENT_VER = "1.0.0"
_AUDIT_LOG = Path(__file__).parent.parent / "output" / "a2a-audit.log"


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
    r"ignore\b[\w\s]{0,30}\binstructions"   # covers "ignore all/previous/prior/all previous instructions"
    r"|new (system )?prompt"
    r"|you are now"
    r"|disregard\b[\w\s]{0,20}\b"
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


# ── Agent Card builder (dynamic — base URL derived from request) ───────────────

def build_card(base_url: str) -> dict:
    """Build the A2A agent card using the correct base URL for this deployment."""
    rpc_url = f"{base_url}/a2a/"
    return {
        # ── A2A v0.2.x required fields ─────────────────────────────────────
        "name":            _AGENT_ID,
        "version":         _AGENT_VER,
        "protocolVersion": "0.2.2",
        "description": (
            "Generates Key Design Decisions (KDD) for SAP S/4HANA Cloud Public Edition. "
            "Covers BDCQ enrichment, KDD log generation, and scope catalog search."
        ),
        "url": rpc_url,
        # capabilities: object with protocol-level boolean flags (spec §4.1)
        "capabilities": {
            "streaming":              True,
            "pushNotifications":      False,
            "stateTransitionHistory": False,
        },
        # security: no auth required for local / internal deployment
        "securitySchemes": {},
        "security":        [],
        "defaultInputModes":  ["text/plain", "application/json"],
        "defaultOutputModes": ["application/json"],
        # ── Skills (per-capability detail for discovery matching) ───────────
        "skills": [
            {
                "id":          "kdd.generate",
                "name":        "KDD Generator",
                "description": "Generate 15 KDD questions per SAP scope item with RICEF classification.",
                "tags":        ["kdd", "sap", "s4hana", "cloud", "explore"],
                "examples":    ["Generate KDD for BD6, J59 — Client: Acme Corp, Project: S4H Rollout"],
                "inputModes":  ["text/plain", "application/json"],
                "outputModes": ["application/json"],
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scope_ids": {"type": "array",  "items": {"type": "string"}},
                        "client":    {"type": "string"},
                        "project":   {"type": "string"},
                    },
                    "required": ["scope_ids"],
                },
                "outputSchema": {
                    "type": "object",
                    "properties": {
                        "kdd_excel_url":  {"type": "string"},
                        "scope_overview": {"type": "array"},
                        "total_kdds":     {"type": "integer"},
                    },
                },
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
                "examples":    ["Is BDCQ loaded?"],
                "inputModes":  ["text/plain"],
                "outputModes": ["application/json"],
            },
        ],
    }


# Fallback static card for imports that don't have a request context
AGENT_CARD = build_card(_BASE_URL)


# ── Error registry ─────────────────────────────────────────────────────────────
# -32001..-32003 are standard A2A error codes (kept as-is)
# -32004/-32005 are reserved by the spec for UnsupportedOperation / ContentTypeNotSupported
# Custom errors use -32050+ (unreserved range)

_A2A_ERRORS = {
    "TASK_NOT_FOUND":          {"code": -32001, "message": "Task not found"},
    "TASK_CANT_CANCEL":        {"code": -32002, "message": "Task cannot be cancelled in current state"},
    "PUSH_NOT_SUPPORTED":      {"code": -32003, "message": "Push notifications not supported"},
    "PAYLOAD_REJECTED":        {"code": -32050, "message": "Payload rejected: failed injection screening"},
    "TASK_NOT_COMPLETE":       {"code": -32051, "message": "Task not completed — handoff unavailable"},
    "UNSUPPORTED_OPERATION":   {"code": -32004, "message": "Unsupported operation"},
    "CONTENT_TYPE_NOT_SUPPORTED": {"code": -32005, "message": "Content type not supported"},
}


# ── In-memory task store ───────────────────────────────────────────────────────

_tasks:       dict[str, dict]          = {}
_subscribers: dict[str, asyncio.Queue] = {}


# ── Context envelope ───────────────────────────────────────────────────────────

def _envelope(task: dict) -> dict:
    return {
        "run_id":               task.get("runId", task["id"]),
        "source_agent":         _AGENT_ID,
        "source_agent_version": _AGENT_VER,
        "timestamp":            _ts(),
    }


# ── Task lifecycle ─────────────────────────────────────────────────────────────

def _new_task(message: dict, context_id: str | None = None) -> dict:
    task_id = str(uuid.uuid4())
    meta    = message.get("metadata") or {}
    run_id  = meta.get("run_id") or task_id
    task = {
        "kind":      "task",
        "id":        task_id,
        "contextId": context_id or task_id,   # was sessionId — renamed per spec
        "runId":     run_id,
        "status":    {"state": "submitted", "timestamp": _ts()},
        "history":   [message],               # was messages — renamed per spec
        "artifacts": [],
        "metadata":  {
            "runId":        run_id,
            "sourceAgent":  meta.get("source_agent", "external"),
            "agentId":      _AGENT_ID,
            "agentVersion": _AGENT_VER,
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
            "kind": "message",
            "role": "agent",
            "parts": [{"type": "text", "text": message_text}],
        }
    return task


def _push(task_id: str, event: dict):
    q = _subscribers.get(task_id)
    if q:
        q.put_nowait(event)


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

class _InputRequired(Exception):
    """Raised by the task runner when required parameters are absent."""


async def _run_task(task: dict):
    from .task_runner import execute, InputRequired as TRInputRequired
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
            _push(task_id, {"id": task_id, "artifact": {**artifact, "kind": "artifact"}, "final": False})
        _push(task_id, {"id": task_id, "status": task["status"], "final": True})
        _audit("task.completed", task_id, run_id, artifactCount=len(artifacts))

    except TRInputRequired as exc:
        _set_state(task, "input-required", str(exc))
        _push(task_id, {"id": task_id, "status": task["status"], "final": False})
        _audit("task.input-required", task_id, run_id, prompt=str(exc))

    except Exception as exc:
        _set_state(task, "failed", str(exc)[:200])
        _push(task_id, {"id": task_id, "status": task["status"], "final": True})
        _audit("task.failed", task_id, run_id, error=str(exc)[:200])


# ── SSE helper ────────────────────────────────────────────────────────────────

async def _sse_stream(task: dict) -> AsyncGenerator[str, None]:
    task_id = task["id"]
    q: asyncio.Queue = asyncio.Queue()
    _subscribers[task_id] = q
    asyncio.create_task(_run_task(task))
    # First event: initial submitted state
    yield f"data: {json.dumps({'id': task_id, 'status': task['status'], 'final': False})}\n\n"
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


# ── Route handlers ─────────────────────────────────────────────────────────────

@router.get("/")
async def get_agent_card(request: Request):
    base = str(request.base_url).rstrip("/")
    return JSONResponse(build_card(base))


@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = _tasks.get(task_id)
    if not task:
        return JSONResponse(_err(None, "TASK_NOT_FOUND"), status_code=404)
    return JSONResponse(_ok(task_id, task))


@router.get("/tasks/{task_id}/handoff")
async def get_handoff(task_id: str, ack: bool = False):
    """Internal non-A2A endpoint: package a completed task for downstream agent consumption."""
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
        task["metadata"]["acknowledged"]   = True
        task["metadata"]["acknowledgedAt"] = _ts()
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


@router.post("/trigger")
async def receive_trigger(request: Request):
    """Internal non-A2A endpoint: accept an event from another agent and start a task."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    run_id  = body.get("run_id") or str(uuid.uuid4())
    payload = body.get("payload", {})
    message = {
        "kind":  "message",
        "role":  "user",           # inbound messages are always "user" (finding #8)
        "parts": [{"type": "text", "text": json.dumps(payload)}],
        "metadata": {
            "run_id":       run_id,
            "source_agent": body.get("source_agent", "external"),
            "event":        body.get("event", ""),
        },
    }
    # Screen trigger payloads the same as JSON-RPC payloads (finding #11)
    err = _screen(message)
    if err:
        _audit("payload.rejected", "N/A", run_id, reason=err)
        return JSONResponse({"error": err, "code": -32050}, status_code=400)

    task = _new_task(message)
    asyncio.create_task(_run_task(task))
    _audit("trigger.received", task["id"], run_id, eventType=body.get("event", ""))
    return JSONResponse({"ok": True, "taskId": task["id"], "runId": run_id})


# ── JSON-RPC entry point (handles both /a2a and /a2a/) ────────────────────────

async def _handle_rpc(request: Request) -> JSONResponse | StreamingResponse:
    # Validate body is a JSON object (finding #9)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None,
                             "error": {"code": -32700, "message": "Parse error"}})

    if not isinstance(body, dict):
        return JSONResponse({"jsonrpc": "2.0", "id": None,
                             "error": {"code": -32600, "message": "Invalid Request"}})

    id_    = body.get("id")        # None means notification — no response
    method = body.get("method", "")
    params = body.get("params", {})

    # ── message/send (spec name) + tasks/send (backward-compat alias) ─────────
    if method in ("message/send", "tasks/send"):
        message    = params.get("message", {})
        context_id = params.get("contextId") or params.get("sessionId")

        err = _screen(message)
        if err:
            _audit("payload.rejected", "N/A", "N/A", reason=err)
            if id_ is None:
                return JSONResponse(None, status_code=204)
            return JSONResponse(_err(id_, "PAYLOAD_REJECTED"))

        task = _new_task(message, context_id)
        asyncio.create_task(_run_task(task))
        _audit("task.submitted", task["id"], task["runId"], method=method)
        if id_ is None:
            return JSONResponse(None, status_code=204)
        return JSONResponse(_ok(id_, task))

    # ── message/stream (spec name) + tasks/sendSubscribe (backward-compat) ────
    if method in ("message/stream", "tasks/sendSubscribe"):
        message    = params.get("message", {})
        context_id = params.get("contextId") or params.get("sessionId")

        err = _screen(message)
        if err:
            _audit("payload.rejected", "N/A", "N/A", reason=err)
            if id_ is None:
                return JSONResponse(None, status_code=204)
            return JSONResponse(_err(id_, "PAYLOAD_REJECTED"))

        task = _new_task(message, context_id)
        _audit("task.submitted", task["id"], task["runId"], method=method)
        return StreamingResponse(_sse_stream(task), media_type="text/event-stream")

    # ── tasks/get ─────────────────────────────────────────────────────────────
    if method == "tasks/get":
        task_id = params.get("id")
        task    = _tasks.get(task_id)
        if not task:
            if id_ is None:
                return JSONResponse(None, status_code=204)
            return JSONResponse(_err(id_, "TASK_NOT_FOUND"))
        if id_ is None:
            return JSONResponse(None, status_code=204)
        return JSONResponse(_ok(id_, task))

    # ── tasks/cancel ──────────────────────────────────────────────────────────
    if method == "tasks/cancel":
        task_id = params.get("id")
        task    = _tasks.get(task_id)
        if not task:
            if id_ is None:
                return JSONResponse(None, status_code=204)
            return JSONResponse(_err(id_, "TASK_NOT_FOUND"))
        if task["status"]["state"] in ("completed", "failed", "canceled"):
            if id_ is None:
                return JSONResponse(None, status_code=204)
            return JSONResponse(_err(id_, "TASK_CANT_CANCEL"))
        _set_state(task, "canceled")
        _push(task_id, {"type": "status", "status": task["status"], "final": True})
        _audit("task.canceled", task_id, task.get("runId", task_id))
        if id_ is None:
            return JSONResponse(None, status_code=204)
        return JSONResponse(_ok(id_, task))

    # ── tasks/pushNotificationConfig ──────────────────────────────────────────
    if method in ("tasks/pushNotificationConfig/set", "tasks/pushNotificationConfig/get"):
        if id_ is None:
            return JSONResponse(None, status_code=204)
        return JSONResponse(_err(id_, "PUSH_NOT_SUPPORTED"))

    # ── Notification with unknown method: silent 204 ───────────────────────────
    if id_ is None:
        return JSONResponse(None, status_code=204)

    return JSONResponse(_err(id_, {"code": -32601, "message": f"Method not found: {method}"}))


@router.post("/")
async def a2a_rpc_slash(request: Request):
    return await _handle_rpc(request)


@router.post("")
async def a2a_rpc(request: Request):
    return await _handle_rpc(request)
