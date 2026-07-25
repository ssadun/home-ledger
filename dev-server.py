#!/usr/bin/env python3
"""Native dev server for Home Ledger frontend — no Docker, no caching.

- Serves static files straight from ./frontend (edits show on every refresh).
- Proxies /api/* to the backend container on http://localhost:8100.
- Sends no-store headers so the browser never caches anything.
- Runs on a fresh port (8088) => a new origin with no service worker baggage.
"""
import http.server
import logging
from logging.handlers import RotatingFileHandler
import socketserver
import urllib.request
import urllib.error
import os

PORT = int(os.environ.get("PORT", "8088"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
BACKEND = os.environ.get("BACKEND", "http://localhost:8100")
LOG_FILE = os.environ.get(
    "LOG_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "home-ledger-web.log"),
)
MAX_LOG_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5

EXTRA_TYPES = {
    ".jsx": "text/javascript",
    ".js": "text/javascript",
    ".webmanifest": "application/manifest+json",
}


def rotated_name(default_name):
    stem, dot, index = default_name.rpartition(".")
    if dot and index.isdigit():
        return f"{stem}.{int(index):02d}"
    return default_name


def setup_logging():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=MAX_LOG_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.namer = rotated_name
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # Map .jsx to a JS mime type so <script type="text/babel"> loads cleanly.
    def guess_type(self, path):
        for ext, mime in EXTRA_TYPES.items():
            if path.endswith(ext):
                return mime
        return super().guess_type(path)

    # Never let the browser cache dev assets.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/Login.html")
            self.end_headers()
            return
        if self.path.startswith("/api/"):
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        return self._proxy("POST")

    def do_PATCH(self):
        return self._proxy("PATCH")

    def do_PUT(self):
        return self._proxy("PUT")

    def do_DELETE(self):
        return self._proxy("DELETE")

    def _proxy(self, method):
        if not self.path.startswith("/api/"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(BACKEND + self.path, data=body, method=method)
        for h in ("Content-Type", "Authorization", "Accept"):
            if h in self.headers:
                req.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(req) as resp:
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() not in ("transfer-encoding", "connection"):
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_error(502, str(e))

    def log_message(self, format, *args):
        logging.info("%s - %s", self.address_string(), format % args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # Default backlog is 5; over a higher-latency link (e.g. Tailscale via
    # nas-docker) the burst of parallel asset requests this app makes can fill
    # it and get a SYN dropped, surfacing as ERR_CONNECTION_TIMED_OUT on a
    # random asset. A deeper queue absorbs the burst.
    request_queue_size = 128


if __name__ == "__main__":
    setup_logging()
    os.chdir(ROOT)
    logging.info("Home Ledger dev server: http://localhost:%s  (serving %s)", PORT, ROOT)
    Server(("0.0.0.0", PORT), Handler).serve_forever()
