#!/usr/bin/env python3
"""
Unified claude/copilot runner — single HTTP service replacing
~/scheduled-claude, ~/plane-claude, ~/plane-copilot.

New unified API (port 9879):
    POST /run/{handler}            -> spawns handlers/{handler}.sh
    Optional auth:                   X-Runner-Secret: <CLAUDE_RUNNER_SECRET>

Legacy compatibility ports (so existing n8n workflows keep working):
    9876  POST /run-task           -> handlers/plane-claude.sh   (env: ISSUE_*)
    9877  POST /run-task           -> handlers/plane-copilot.sh  (env: ISSUE_*)
    9878  POST /run-task           -> handlers/scheduled.sh      (env: CLAUDE_*)

Handlers receive the request body's JSON keys as env vars (uppercased keys
that look like ISSUE_* or CLAUDE_* are passed through verbatim), plus
CLAUDE_EXTRA_JSON containing the full raw JSON body for handlers that
want richer access.
"""
import json
import logging
import os
import signal
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

signal.signal(signal.SIGCHLD, signal.SIG_IGN)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("claude-runner")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HANDLERS_DIR = os.path.join(BASE_DIR, "handlers")
SHARED_SECRET = os.environ.get("CLAUDE_RUNNER_SECRET", "")

# Legacy port -> (handler name, accepted secret header name, accepted secret env var)
LEGACY_PORTS = {
    9876: ("plane-claude", "X-Plane-Claude-Secret", "PLANE_CLAUDE_SECRET"),
    9877: ("plane-copilot", "X-Plane-Copilot-Secret", "PLANE_COPILOT_SECRET"),
    9878: ("scheduled", "X-Scheduled-Claude-Secret", "SCHEDULED_CLAUDE_SECRET"),
}


def spawn_handler(handler_name: str, data: dict) -> tuple[int, dict]:
    handler_path = os.path.join(HANDLERS_DIR, f"{handler_name}.sh")
    if not os.path.isfile(handler_path):
        return 404, {"error": f"unknown handler: {handler_name}"}

    env = os.environ.copy()

    # Map common Plane fields → ISSUE_* env vars
    for key in ("issue_id", "issue_title", "issue_description", "issue_sequence_id"):
        if key in data:
            env[key.upper()] = str(data[key] or "")

    # Map common scheduled fields → CLAUDE_* env vars
    if "prompt" in data:
        env["CLAUDE_PROMPT"] = str(data.get("prompt") or "")
    if "work_dir" in data:
        env["CLAUDE_WORK_DIR"] = str(data.get("work_dir") or "")
    if "label" in data:
        env["CLAUDE_LABEL"] = str(data.get("label") or "")

    # Pass through any explicit ISSUE_*/CLAUDE_* keys
    for k, v in data.items():
        if isinstance(k, str) and (k.startswith("ISSUE_") or k.startswith("CLAUDE_")):
            env[k] = str(v if v is not None else "")

    # Always include the full raw payload for handlers that want it
    env["CLAUDE_EXTRA_JSON"] = json.dumps(data)
    env["CLAUDE_HANDLER"] = handler_name

    # Required for the scheduled handler
    if handler_name == "scheduled" and not env.get("CLAUDE_PROMPT", "").strip():
        return 400, {"error": "prompt required"}

    # Required for the plane handlers
    if handler_name in ("plane-claude", "plane-copilot") and not env.get("ISSUE_ID", "").strip():
        return 400, {"error": "issue_id required"}

    log.info("Spawning handler=%s payload_keys=%s", handler_name, sorted(data.keys()))
    subprocess.Popen(
        ["bash", handler_path],
        env=env,
        cwd=BASE_DIR,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return 202, {"status": "accepted", "handler": handler_name}


class _BaseHandler(BaseHTTPRequestHandler):
    legacy_handler: str | None = None
    legacy_secret_header: str | None = None
    legacy_secret_env: str | None = None

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)

    def _respond(self, code: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_json(self) -> tuple[bool, dict]:
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        if not body:
            return True, {}
        try:
            data = json.loads(body)
            if not isinstance(data, dict):
                return False, {"error": "json body must be an object"}
            return True, data
        except json.JSONDecodeError:
            return False, {"error": "invalid json"}

    def do_GET(self):
        if self.path in ("/health", "/healthz"):
            self._respond(200, {"status": "ok"})
            return
        self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.legacy_handler is not None:
            self._handle_legacy()
        else:
            self._handle_unified()

    def _handle_unified(self):
        if not self.path.startswith("/run/"):
            self._respond(404, {"error": "not found"})
            return

        if SHARED_SECRET:
            auth = self.headers.get("X-Runner-Secret", "")
            if auth != SHARED_SECRET:
                self._respond(401, {"error": "unauthorized"})
                return

        handler_name = self.path[len("/run/"):].strip("/")
        if not handler_name or "/" in handler_name or handler_name.startswith("."):
            self._respond(400, {"error": "invalid handler name"})
            return

        ok, data = self._read_json()
        if not ok:
            self._respond(400, data)
            return

        code, body = spawn_handler(handler_name, data)
        self._respond(code, body)

    def _handle_legacy(self):
        if self.path != "/run-task":
            self._respond(404, {"error": "not found"})
            return

        expected = os.environ.get(self.legacy_secret_env or "", "")
        if expected:
            auth = self.headers.get(self.legacy_secret_header or "", "")
            if auth != expected:
                self._respond(401, {"error": "unauthorized"})
                return

        ok, data = self._read_json()
        if not ok:
            self._respond(400, data)
            return

        code, body = spawn_handler(self.legacy_handler, data)
        self._respond(code, body)


def _make_handler_class(legacy_handler=None, legacy_secret_header=None, legacy_secret_env=None):
    return type(
        "BoundHandler",
        (_BaseHandler,),
        {
            "legacy_handler": legacy_handler,
            "legacy_secret_header": legacy_secret_header,
            "legacy_secret_env": legacy_secret_env,
        },
    )


def _serve(port: int, handler_class):
    server = HTTPServer(("0.0.0.0", port), handler_class)
    log.info("listening on 0.0.0.0:%d (%s)", port,
             handler_class.legacy_handler or "unified /run/{handler}")
    server.serve_forever()


def main():
    unified_port = int(os.environ.get("PORT", 9879))
    threads = []

    for port, (handler, secret_header, secret_env) in LEGACY_PORTS.items():
        cls = _make_handler_class(handler, secret_header, secret_env)
        t = threading.Thread(target=_serve, args=(port, cls), daemon=True)
        t.start()
        threads.append(t)

    # Run unified port in the main thread so the process exits on Ctrl+C
    _serve(unified_port, _make_handler_class())


if __name__ == "__main__":
    main()
