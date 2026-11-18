"""Run the shared Fieldbench workspace on a private network."""
import argparse
import base64
import binascii
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta, timezone
import getpass
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("FIELDBENCH_DB", ROOT / "data" / "workspace.sqlite3"))
STATUSES = {
    "builds": ("Design", "Assembly", "Ready", "Retired"),
    "tests": ("Planned", "Passed", "Failed", "Inconclusive"),
    "issues": ("Open", "In progress", "Blocked", "Done"),
    "parts": ("Needed", "Ordered", "Received"),
}
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    name TEXT PRIMARY KEY, salt BLOB NOT NULL, password_hash BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    owner TEXT REFERENCES users(name),
    record_date TEXT NOT NULL,
    notes TEXT NOT NULL,
    details TEXT NOT NULL,
    build_id INTEGER REFERENCES records(id),
    test_id INTEGER REFERENCES records(id),
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}


@contextmanager
def database(write=False):
    with closing(sqlite3.connect(DB_PATH)) as conn, conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        if write:
            conn.execute("BEGIN IMMEDIATE")
        yield conn


def initialize():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with database() as conn:
        conn.executescript(SCHEMA)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)


def add_user(name, password):
    salt = secrets.token_bytes(16)
    with database(write=True) as conn:
        conn.execute("INSERT INTO users VALUES (?, ?, ?)", (name, salt, password_hash(password, salt)))


def as_record(row):
    record = dict(row)
    record["details"] = json.loads(record["details"])
    return record


def clean_text(data, key, limit, required=False):
    value = data.get(key, "")
    if not isinstance(value, str):
        raise ValueError(f"{key} must be text.")
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise ValueError(f"Enter a valid {key} (up to {limit} characters).")
    return value


def linked_id(conn, data, key, kind, required=False):
    value = data.get(key)
    if value in ("", None) and not required:
        return None
    if type(value) is not int or not conn.execute(
        "SELECT 1 FROM records WHERE id = ? AND kind = ?", (value, kind)
    ).fetchone():
        raise ValueError(f"Choose an existing {kind[:-1]} record.")
    return value


class EditConflict(Exception):
    pass


def save_record(conn, data, actor, record_id=None):
    if not isinstance(data, dict):
        raise ValueError("Expected a record object.")
    kind = clean_text(data, "kind", 20, True)
    status = clean_text(data, "status", 20, True)
    if status not in STATUSES.get(kind, ()):
        raise ValueError("Choose a valid status.")
    title = clean_text(data, "title", 140, True)
    owner = clean_text(data, "owner", 40, True)
    if not conn.execute("SELECT 1 FROM users WHERE name = ?", (owner,)).fetchone():
        raise ValueError("Choose a founder.")
    record_date = clean_text(data, "record_date", 10)
    if record_date and date.fromisoformat(record_date).isoformat() != record_date:
        raise ValueError("Enter a date in YYYY-MM-DD format.")
    if kind == "tests" and not record_date:
        raise ValueError("Choose a test date.")
    notes = clean_text(data, "notes", 2000)
    build_id = linked_id(conn, data, "build_id", "builds", kind == "tests") if kind in ("tests", "issues", "parts") else None
    test_id = linked_id(conn, data, "test_id", "tests") if kind == "issues" else None
    if test_id:
        tested_build = conn.execute("SELECT build_id FROM records WHERE id = ?", (test_id,)).fetchone()[0]
        if build_id and build_id != tested_build:
            raise ValueError("The issue and linked test must refer to the same build.")
        build_id = tested_build
    details = {}
    if kind == "builds":
        details["airframe"] = clean_text(data, "airframe", 80, True)
        details["revision"] = clean_text(data, "revision", 40, True)
        details["firmware"] = clean_text(data, "firmware", 200)
    elif kind == "tests":
        details["test_type"] = clean_text(data, "test_type", 15, True)
        if details["test_type"] not in ("Bench", "Flight"):
            raise ValueError("Choose Bench or Flight.")
        details["expected"] = clean_text(data, "expected", 2000, True)
        details["actual"] = clean_text(data, "actual", 2000, status != "Planned")
    elif kind == "issues":
        details["next_action"] = clean_text(data, "next_action", 300, status != "Done")
    else:
        details["supplier"] = clean_text(data, "supplier", 100)
    if kind in ("builds", "tests", "parts"):
        link = clean_text(data, "link", 600)
        if link:
            parsed = urlsplit(link)
            if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username is not None:
                raise ValueError("Enter an HTTP or HTTPS link without credentials.")
        details["link"] = link

    if kind == "builds":
        existing = conn.execute("SELECT id, details FROM records WHERE kind = 'builds'").fetchall()
        identifier = (details["airframe"].casefold(), details["revision"].casefold())
        for build in existing:
            saved = json.loads(build["details"])
            if build["id"] != record_id and identifier == (saved["airframe"].casefold(), saved["revision"].casefold()):
                raise ValueError("This airframe already has that revision.")

    now = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    fields = (title, status, owner, record_date, notes, json.dumps(details), build_id, test_id, actor, now)
    if record_id is None:
        cursor = conn.execute(
            """INSERT INTO records
               (title,status,owner,record_date,notes,details,build_id,test_id,updated_by,updated_at,kind)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (*fields, kind)
        )
        record_id = cursor.lastrowid
    else:
        old = conn.execute("SELECT * FROM records WHERE id = ? AND kind = ?", (record_id, kind)).fetchone()
        if old is None:
            raise LookupError("Record not found.")
        if data.get("updated_at") != old["updated_at"]:
            raise EditConflict("This record changed. Copy any unsaved edits, then reload and reopen it.")
        if kind == "builds" and conn.execute("SELECT 1 FROM records WHERE build_id = ? AND kind = 'tests'", (record_id,)).fetchone():
            if (title, notes, details) != (old["title"], old["notes"], json.loads(old["details"])):
                raise ValueError("This revision has linked tests. Create a new revision to change its configuration.")
        if kind == "tests" and build_id != old["build_id"]:
            if old["status"] != "Planned" or conn.execute("SELECT 1 FROM records WHERE test_id = ?", (record_id,)).fetchone():
                raise ValueError("The build is locked once this test has a result or a linked issue.")
        conn.execute(
            """UPDATE records SET title=?,status=?,owner=?,record_date=?,notes=?,details=?,
               build_id=?,test_id=?,updated_by=?,updated_at=? WHERE id=?""", (*fields, record_id)
        )
    return as_record(conn.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone())


def seed_demo():
    today = date.today()
    with database(write=True) as conn:
        marker = conn.execute("SELECT 1 FROM users WHERE name = 'Morgan'").fetchone()
        if marker:
            return
        if conn.execute("SELECT 1 FROM users").fetchone() or conn.execute("SELECT 1 FROM records").fetchone():
            raise SystemExit("Use a fresh database for the demo.")
        for name in ("Morgan", "Riley", "Sam"):
            salt = secrets.token_bytes(16)
            conn.execute("INSERT INTO users VALUES (?, ?, ?)", (name, salt, password_hash(secrets.token_urlsafe(), salt)))

        def add(kind, title, status, owner, **fields):
            return save_record(conn, dict(kind=kind, title=title, status=status, owner=owner, **fields), owner)["id"]

        kestrel = add("builds", "Kestrel airframe", "Ready", "Morgan", airframe="AGR-01", revision="R03",
                      firmware="v0.3.0", notes="Revised avionics tray and cable routing.")
        add("builds", "Finch test rig", "Assembly", "Sam", airframe="AGR-02", revision="R01",
            notes="Bench platform for evaluating component fit.")
        test = add("tests", "Position hold check", "Failed", "Riley", build_id=kestrel, test_type="Flight",
                   record_date=(today - timedelta(days=1)).isoformat(), expected="Maintain stable position during the observation period.",
                   actual="Intermittent position drift was observed. Log marked for review.")
        add("tests", "Telemetry link check", "Passed", "Morgan", build_id=kestrel, test_type="Bench",
            record_date=(today - timedelta(days=3)).isoformat(), expected="Continuous telemetry through the bench session.",
            actual="No dropped telemetry in the recorded session.")
        add("tests", "Post-fix verification", "Planned", "Riley", build_id=kestrel, test_type="Bench",
            record_date=(today + timedelta(days=3)).isoformat(), expected="Recheck telemetry and review position log.")
        add("issues", "Investigate position drift", "Blocked", "Riley", test_id=test,
            record_date=(today + timedelta(days=1)).isoformat(), next_action="Review the recorded session with Morgan.")
        add("issues", "Update assembly notes", "In progress", "Morgan", build_id=kestrel,
            record_date=(today + timedelta(days=2)).isoformat(), next_action="Document avionics tray and connector changes.")
        add("parts", "Replacement mounting hardware", "Ordered", "Sam", build_id=kestrel,
            record_date=(today + timedelta(days=4)).isoformat(), supplier="Local hardware supplier")
        add("parts", "Spare enclosure", "Needed", "Morgan", build_id=kestrel)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def send_body(self, status, body, content_type, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def json(self, status, payload, headers=None):
        self.send_body(status, json.dumps(payload).encode(), "application/json; charset=utf-8", headers)

    def authenticate(self, conn):
        if self.server.demo:
            return "Morgan"
        method, _, token = self.headers.get("Authorization", "").partition(" ")
        if method.lower() != "basic" or len(token) > 1024:
            return None
        try:
            name, separator, password = base64.b64decode(token, validate=True).decode("utf-8").partition(":")
        except (UnicodeError, binascii.Error):
            return None
        if not separator:
            return None
        user = conn.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchone()
        if user:
            actual = password_hash(password, user["salt"])
            if hmac.compare_digest(actual, user["password_hash"]):
                return name
        return None

    def dispatch(self):
        path = urlsplit(self.path).path
        try:
            if self.server.demo and self.headers.get("Host", "").split(":")[0] not in ("localhost", "127.0.0.1"):
                self.json(403, {"error": "Use the demo loopback address."})
                return
            with database() as conn:
                actor = self.authenticate(conn)
                if actor is None:
                    self.json(401, {"error": "Sign in to Fieldbench."},
                              {"WWW-Authenticate": 'Basic realm="Fieldbench", charset="UTF-8"'})
                    return
                if self.command == "GET" and path in ASSETS:
                    name, content_type = ASSETS[path]
                    self.send_body(200, (ROOT / "static" / name).read_bytes(), content_type)
                    return
                if self.command == "GET" and path == "/api/workspace":
                    records = [as_record(row) for row in conn.execute("SELECT * FROM records ORDER BY id DESC")]
                    users = [row["name"] for row in conn.execute("SELECT name FROM users ORDER BY name")]
                    self.json(200, {"records": records, "users": users, "actor": actor, "demo": self.server.demo})
                    return
            entry = re.fullmatch(r"/api/records/([1-9][0-9]{0,17})", path)
            if (self.command == "POST" and path == "/api/records") or (self.command == "PUT" and entry):
                if self.headers.get("X-Fieldbench") != "1" or self.headers.get_content_type() != "application/json":
                    self.json(403, {"error": "Expected a workspace request."})
                    return
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 32768:
                    self.json(413, {"error": "Invalid request size."})
                    return
                data = json.loads(self.rfile.read(size))
                with database(write=True) as conn:
                    record = save_record(conn, data, actor, int(entry[1]) if entry else None)
                self.json(200 if entry else 201, record)
                return
            self.json(404, {"error": "Page not found."})
        except (ValueError, UnicodeError) as error:
            self.json(400, {"error": str(error)})
        except EditConflict as error:
            self.json(409, {"error": str(error)})
        except LookupError as error:
            self.json(404, {"error": str(error)})
        except sqlite3.OperationalError as error:
            if "locked" not in str(error):
                raise
            self.json(503, {"error": "Workspace busy. Try again."})

    do_GET = dispatch
    do_POST = dispatch
    do_PUT = dispatch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8080)
    serve.add_argument("--demo", action="store_true")
    user = sub.add_parser("add-user")
    user.add_argument("name")
    backup = sub.add_parser("backup")
    backup.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "serve" and args.demo:
        if args.host != "127.0.0.1":
            parser.error("The demo only runs on 127.0.0.1.")
        global DB_PATH
        DB_PATH = DB_PATH.parent / "demo.sqlite3"
    initialize()
    if args.command == "add-user":
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}", args.name) or args.name != args.name.strip():
            parser.error("Use 1–40 letters, numbers, spaces, dots, dashes, or underscores for the username.")
        password = getpass.getpass("Password (at least 12 characters): ")
        if not 12 <= len(password) <= 128 or password != getpass.getpass("Confirm password: "):
            parser.error("Passwords must match and be 12–128 characters.")
        try:
            add_user(args.name, password)
        except sqlite3.IntegrityError:
            parser.error("Username already exists.")
        print(f"Created user {args.name}.")
    elif args.command == "backup":
        try:
            with args.destination.open("xb"):
                pass
        except FileExistsError:
            parser.error("Choose a new backup filename.")
        try:
            with database() as source, closing(sqlite3.connect(args.destination)) as target:
                source.backup(target)
        except Exception:
            args.destination.unlink(missing_ok=True)
            raise
        print(f"Backup written to {args.destination}")
    else:
        if args.demo:
            seed_demo()
        else:
            with database() as conn:
                if not conn.execute("SELECT 1 FROM users").fetchone():
                    print("No accounts yet. Run 'python app.py add-user <name>' before signing in.", flush=True)
        with ThreadingHTTPServer((args.host, args.port), Handler) as server:
            server.demo = args.demo
            print(f"Fieldbench listening at http://{args.host}:{args.port}", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
