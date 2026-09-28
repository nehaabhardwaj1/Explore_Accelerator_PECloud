# a2a/router.py — Google A2A protocol implementation for FastAPI
# Agent Card at /.well-known/agent.json
# JSON-RPC 2.0 POST /a2a  +  SSE streaming GET /a2a/tasks/{id}/subscribe
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter()

_BASE_URL = os.environ.get("AGENT_BASE_URL", "http://localhost:3000")

# ── Agent Card ─────────────────────────────────────────────────────────────────

AGENT_CARD = {
    "name":            "Explore Accelerator — SAP S/4HANA Cloud PE KDD Generator",
    "description":     "Generates Key Design Decisions (KDD) for SAP S/4HANA Cloud Public Edition. Covers BDCQ enrichment, KDD generation, and scope catalog search.",
    "url":             f"{_BASE_URL}/a2a",
    "version":         "1.0.0",
    "protocolVersion": "0.2.2",
    "capabilities": {
        "streaming":          True,
        "pushNotifications":  False,
        "stateTransitionHistory": False,
    },
    "authentication": {"schemes": []},
    "defaultInputModes":  ["text/plain", "application/json"],
    "defaultOutputModes": ["application/json"],
    "skills": [
        {
            "id":          "kdd-generate",
            "name":        "KDD Generator",
            "description": "Generate 15 KDD questions per SAP scope item with RICEF classification",
            "tags":        ["kdd", "sap", "s4hana", "cloud", "explore"],
            "examples":    ["Generate KDD for BD6, J59 — Client: Acme Corp, Project: S4H Rollout"],
            "inputModes":  ["text/plain", "application/json"],
            "outputModes": ["application/json"],
        },
        {
            "id":          "catalog-search",
            "name":        "Scope Catalog Search",
            "description": "Search the SAP for Me process catalog by name, LOB, or keyword",
            "tags":        ["catalog", "scope", "sap"],
            "examples":    ["Find Finance scope items", "Search for Accounts Payable"],
            "inputModes":  ["text/plain"],
            "outputModes": ["application/json"],
        },
        {
            "id":          "bdcq-status",
            "name":        "BDCQ Status",
            "description": "Check if BDCQ questions are loaded and return domain statistics",
            "tags":        ["bdcq", "status"],
            "examples":    ["Is BDCQ loaded?", "How many BDCQ questions are available?"],
            "inputModes":  ["text/plain"],
            "outputModes": ["application/json"],
        },
    ],
}

# ── In-memory task store ───────────────────────────────────────────────────────

_tasks: dict[str, dict]         = {}
_subscribers: dict[str, asyncio.Queue] = {}

_A2A_ERRORS = {
    "TASK_NOT_FOUND":    {"code": -32001, "message": "Task not found"},
    "TASK_CANT_CANCEL":  {"code": -32002, "message": "Task cannot be cancelled in current state"},
    "PUSH_NOT_SUPPORTED":{"code": -32003, "message": "Push notifications not supported"},
}


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_task(message: dict, session_id: str | None = None) -> dict:
    task_id = str(uuid.uuid4())
    task    = {
        "id":        task_id,
        "sessionId": session_id or task_id,
        "status":    {"state": "submitted", "timestamp": _ts()},
        "messages":  [message],
        "artifacts": [],
        "metadata":  {},
    }
    _tasks[task_id] = task
    return task


def _set_state(task: dict, state: str, message_text: str | None = None) -> dict:
    task["status"] = {"state": state, "timestamp": _ts()}
    if message_text:
        task["status"]["message"] = {"role": "agent", "parts": [{"type": "text", "text": message_text}]}
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

async def _run_task(task: dict):
    from .task_runner import execute
    task_id = task["id"]
    _set_state(task, "working")
    _push(task_id, {"id": task_id, "status": task["status"], "final": False})
    try:
        artifacts = await execute(task, lambda ev: _push(task_id, {"id": task_id, "status": task["status"], "final": False}))
        task["artifacts"] = artifacts
        _set_state(task, "completed")
        # Send each artifact as a TaskArtifactUpdateEvent before the final status
        for artifact in artifacts:
            _push(task_id, {"id": task_id, "artifact": artifact, "final": False})
        _push(task_id, {"id": task_id, "status": task["status"], "final": True})
    except Exception as exc:
        _set_state(task, "failed", str(exc)[:200])
        _push(task_id, {"id": task_id, "status": task["status"], "final": True})


# ── Route handlers ─────────────────────────────────────────────────────────────

@router.get("/")
async def get_agent_card():
    return JSONResponse(AGENT_CARD)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = _tasks.get(task_id)
    if not task:
        return JSONResponse(_err(None, "TASK_NOT_FOUND"), status_code=404)
    return JSONResponse(_ok(task_id, task))


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


@router.post("/")
async def a2a_rpc(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})

    id_    = body.get("id")
    method = body.get("method", "")
    params = body.get("params", {})

    # ── tasks/send ────────────────────────────────────────────────────────────
    if method == "tasks/send":
        message    = params.get("message", {})
        session_id = params.get("sessionId")
        task       = _new_task(message, session_id)
        asyncio.create_task(_run_task(task))
        return JSONResponse(_ok(id_, task))

    # ── tasks/sendSubscribe ──────────────────────────────────────────────────
    if method == "tasks/sendSubscribe":
        message    = params.get("message", {})
        session_id = params.get("sessionId")
        task       = _new_task(message, session_id)
        q: asyncio.Queue = asyncio.Queue()
        _subscribers[task["id"]] = q
        # Start task
        asyncio.create_task(_run_task(task))

        async def sse_gen() -> AsyncGenerator[str, None]:
            # First event: initial submitted status (spec: TaskStatusUpdateEvent)
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
        return JSONResponse(_ok(id_, task))

    # ── tasks/pushNotificationConfig ─────────────────────────────────────────
    if method in ("tasks/pushNotificationConfig/set", "tasks/pushNotificationConfig/get"):
        return JSONResponse(_err(id_, "PUSH_NOT_SUPPORTED"))

    return JSONResponse(_err(id_, {"code": -32601, "message": f"Method not found: {method}"}))
