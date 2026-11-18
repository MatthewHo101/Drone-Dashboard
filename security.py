"""Server-side account policy and session security for Lysim."""
import base64
import hashlib
import hmac
import ipaddress
import os
import secrets
import socket
import time

import team

SCHEMA = """
CREATE TABLE IF NOT EXISTS first_login(name TEXT PRIMARY KEY REFERENCES users, activation_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(name TEXT PRIMARY KEY REFERENCES users, display TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
 display TEXT NOT NULL, salt BLOB NOT NULL, password_hash BLOB NOT NULL, requested INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS registration_limits(peer TEXT PRIMARY KEY, count INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS admins(name TEXT PRIMARY KEY REFERENCES users);
CREATE TABLE IF NOT EXISTS disabled(name TEXT PRIMARY KEY REFERENCES users);
CREATE TABLE IF NOT EXISTS pending(name TEXT PRIMARY KEY REFERENCES users, token TEXT, secret TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS recovery(name TEXT REFERENCES users, digest TEXT, PRIMARY KEY(name,digest));
CREATE TABLE IF NOT EXISTS policy(key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, failures INTEGER, until_time INTEGER, expires INTEGER);
CREATE INDEX IF NOT EXISTS limits_expiry ON limits(expires);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, stamp INTEGER, event TEXT, actor TEXT, subject TEXT);
"""


def password_hash(password, salt):
    return b"s2:" + hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=3, maxmem=64*1024*1024)


def reset_accounts(conn, initial_password):
    # Caller holds a write transaction. Records keep their last-editor history.
    activation = secrets.token_urlsafe(24)
    conn.execute("UPDATE records SET owner=NULL WHERE owner IS NOT NULL")
    for table in ("sessions","pending","recovery","factors","profiles","admins","disabled","first_login","limits","users"):
        conn.execute(f"DELETE FROM {table}")
    salt = secrets.token_bytes(16)
    conn.execute("INSERT INTO users VALUES(?,?,?)",("admin",salt,password_hash(initial_password,salt)))
    conn.execute("INSERT INTO admins VALUES('admin')")
    conn.execute("INSERT INTO profiles VALUES('admin','Administrator')")
    conn.execute("UPDATE opportunities SET owner='admin'")
    conn.execute("UPDATE records SET owner='admin' WHERE owner IS NULL")
    conn.execute("DELETE FROM registrations WHERE name='admin'")
    conn.execute("INSERT INTO first_login VALUES('admin',?)",(digest(activation),))
    audit(conn,"Account reset","server console","admin")
    return activation


def verify_password(password, user):
    salt = user["salt"] if user else bytes(16)
    saved = user["password_hash"] if user else b"s2:"
    if len(saved) != 64:
        actual = password_hash(password, salt)
    else:
        actual = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return user is not None and hmac.compare_digest(actual,saved)


def audit(conn, event, actor, subject=""):
    conn.execute("INSERT INTO activity(stamp,event,actor,subject) VALUES(?,?,?,?)",
                 (int(time.time()),event,actor,subject))
    conn.execute("DELETE FROM activity WHERE id <= (SELECT max(id)-5000 FROM activity)")


def source(handler):
    peer = handler.client_address[0]
    forwarded = handler.headers.get("X-Forwarded-For","")
    if forwarded and os.environ.get("LYSIM_TRUST_CADDY") == "1":
        try:
            trusted = {info[4][0] for info in socket.getaddrinfo("caddy",None)}
            if peer in trusted:
                return str(ipaddress.ip_address(forwarded.split(",")[-1].strip()))
        except (ValueError,OSError):
            pass
    return peer


def throttle_keys(name, peer):
    return ["account:"+hashlib.sha256(name.encode()).hexdigest(), "source:"+peer]


def blocked(conn, keys, now):
    return conn.execute("SELECT max(until_time) FROM limits WHERE key IN (?,?) AND expires>?",
                        (*keys,now)).fetchone()[0] or 0


def failure(conn, keys, now, actor):
    conn.execute("DELETE FROM limits WHERE expires<=?",(now,))
    for key, threshold in zip(keys,(5,25)):
        row = conn.execute("SELECT failures FROM limits WHERE key=?", (key,)).fetchone()
        count = row[0]+1 if row else 1
        delay = min(300, 5 * 2**min(6,count-threshold)) if count>=threshold else 0
        conn.execute("INSERT OR REPLACE INTO limits VALUES(?,?,?,?)",(key,count,now+delay,now+900))
        if delay:
            audit(conn,"Login throttled",actor)
    audit(conn,"Login failed",actor)


def exists(conn, table, name):
    # Table names come only from internal call sites.
    return bool(conn.execute(f"SELECT 1 FROM {table} WHERE name=?", (name,)).fetchone())


def mandatory(conn):
    return bool(conn.execute("SELECT 1 FROM policy WHERE key='mandatory'").fetchone())


def digest(code):
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def new_codes(conn, actor):
    codes = [secrets.token_hex(10).upper() for _ in range(8)]
    conn.execute("DELETE FROM recovery WHERE name=?", (actor,))
    conn.executemany("INSERT INTO recovery VALUES(?,?)",[(actor,digest(code)) for code in codes])
    return codes


def display_name(value):
    if not isinstance(value,str) or not 1 <= len(value.strip()) <= 80 or not value.strip().isprintable():
        raise ValueError("Enter a display name of 1–80 printable characters.")
    return value.strip()


def label(conn, name):
    row = conn.execute("SELECT display FROM profiles WHERE name=?", (name,)).fetchone()
    return row[0] if row else name


def request_registration(conn, peer, name, display, password):
    now = int(time.time())
    conn.execute("DELETE FROM registration_limits WHERE expires<=?", (now,))
    conn.execute("INSERT INTO registration_limits VALUES(?,1,?) ON CONFLICT(peer) DO UPDATE SET count=count+1",
                 (peer,now+3600))
    count = conn.execute("SELECT count FROM registration_limits WHERE peer=?", (peer,)).fetchone()[0]
    if count > 8:
        return False
    if not exists(conn,"users",name):
        salt = secrets.token_bytes(16)
        conn.execute("INSERT OR IGNORE INTO registrations(name,display,salt,password_hash,requested) VALUES(?,?,?,?,?)",
                     (name,display,salt,password_hash(password,salt),now))
    return True


def settings(conn, actor):
    admin = exists(conn,"admins",actor) and (not mandatory(conn) or exists(conn,"factors",actor))
    result = {"display":label(conn,actor),"admin":admin,"enrolled":exists(conn,"factors",actor),"mandatory":mandatory(conn)}
    if admin:
        result["requests"] = [dict(r) for r in conn.execute("SELECT id,name,display,requested FROM registrations ORDER BY requested,id")]
        result["users"] = [dict(r) for r in conn.execute("""
            SELECT u.name, coalesce(p.display,u.name) AS display, a.name IS NOT NULL AS admin, d.name IS NOT NULL AS disabled,
            f.name IS NOT NULL AS enrolled FROM users u LEFT JOIN profiles p USING(name) LEFT JOIN admins a USING(name)
            LEFT JOIN disabled d USING(name) LEFT JOIN factors f USING(name) ORDER BY u.name""")]
        result["events"] = [dict(r) for r in conn.execute("SELECT * FROM activity ORDER BY id DESC LIMIT 100")]
    return result


def manage(conn, actor, token, op, data):
    user = conn.execute("SELECT * FROM users WHERE name=?", (actor,)).fetchone()
    password = data.get("password","")
    if not isinstance(password,str) or len(password)>128 or not verify_password(password,user):
        raise ValueError("Enter your current password.")
    now = int(time.time())
    if op == "profile":
        display = display_name(data.get("display"))
        conn.execute("INSERT OR REPLACE INTO profiles VALUES(?,?)",(actor,display))
        return {}
    if op == "logout-all":
        conn.execute("DELETE FROM sessions WHERE name=?", (actor,))
        audit(conn,"All sessions revoked",actor)
        return {"signed_out":True}
    if op in ("start","confirm"):
        if exists(conn,"factors",actor):
            raise ValueError("This account is already enrolled.")
        if op == "start":
            secret = base64.b32encode(secrets.token_bytes(20)).decode()
            conn.execute("INSERT OR REPLACE INTO pending VALUES(?,?,?,?)",(actor,token,secret,now+600))
            return {"secret":secret}
        row = conn.execute("SELECT secret FROM pending WHERE name=? AND token=? AND expires>?",(actor,token,now)).fetchone()
        code = data.get("code","")
        step = team.verify_step(row[0],code,-1) if row and isinstance(code,str) and code.isascii() and len(code)==6 else None
        if step is None:
            raise ValueError("Check the code or start setup again.")
        conn.execute("INSERT INTO factors(name,secret,last_step) VALUES(?,?,?)",(actor,row[0],step))
        conn.execute("DELETE FROM pending WHERE name=?",(actor,))
        conn.execute("DELETE FROM sessions WHERE name=? AND token<>?",(actor,token))
        audit(conn,"Authenticator enrolled",actor)
        return {"codes":new_codes(conn,actor)}
    if op == "codes":
        if not exists(conn,"factors",actor):
            raise ValueError("Enroll an authenticator first.")
        audit(conn,"Recovery codes replaced",actor)
        return {"codes":new_codes(conn,actor)}
    if not exists(conn,"admins",actor):
        raise PermissionError("Administrator access required.")
    if op in ("approve","reject"):
        row = conn.execute("SELECT * FROM registrations WHERE id=?", (data.get("request_id"),)).fetchone()
        if not row:
            raise ValueError("This request has already been processed. Refresh the page.")
        if op == "approve":
            if exists(conn,"users",row["name"]):
                raise ValueError("This username now has an account. Reject this request.")
            conn.execute("INSERT INTO users VALUES(?,?,?)",(row["name"],row["salt"],row["password_hash"]))
            conn.execute("INSERT INTO profiles VALUES(?,?)",(row["name"],row["display"]))
        conn.execute("DELETE FROM registrations WHERE id=?",(row["id"],))
        audit(conn,"Registration approved" if op=="approve" else "Registration rejected",actor,row["name"])
        return {}
    if op == "require":
        if conn.execute("SELECT 1 FROM users WHERE name NOT IN (SELECT name FROM disabled) AND name NOT IN (SELECT name FROM factors)").fetchone():
            raise ValueError("Enroll all active users before requiring two-factor authentication.")
        conn.execute("INSERT OR IGNORE INTO policy VALUES('mandatory')")
        audit(conn,"2FA required for workspace",actor)
        return {}
    target = data.get("target")
    if not isinstance(target,str) or not exists(conn,"users",target):
        raise ValueError("Choose an existing user.")
    if op == "reset":
        replacement = data.get("replacement","")
        if not isinstance(replacement,str) or not 12<=len(replacement)<=128:
            raise ValueError("Choose a password of 12–128 characters.")
        salt = secrets.token_bytes(16)
        conn.execute("UPDATE users SET salt=?,password_hash=? WHERE name=?",(salt,password_hash(replacement,salt),target))
        audit(conn,"Password reset",actor,target)
    elif op == "disable":
        if exists(conn,"admins",target):
            raise ValueError("Remove the administrator role before disabling this account.")
        conn.execute("INSERT OR IGNORE INTO disabled VALUES(?)",(target,))
        audit(conn,"Account disabled",actor,target)
    elif op == "enable":
        conn.execute("DELETE FROM disabled WHERE name=?",(target,))
        audit(conn,"Account enabled",actor,target)
    elif op in ("grant","demote"):
        if target==actor or exists(conn,"disabled",target):
            raise ValueError("Choose another active user.")
        if op=="grant":
            conn.execute("INSERT OR IGNORE INTO admins VALUES(?)",(target,))
        else:
            conn.execute("DELETE FROM admins WHERE name=?",(target,))
        audit(conn,"Administrator role "+("granted" if op=="grant" else "removed"),actor,target)
    else:
        raise ValueError("Unknown account operation.")
    conn.execute("DELETE FROM sessions WHERE name=?",(target,))
    conn.execute("DELETE FROM pending WHERE name=?",(target,))
    return {"signed_out": target==actor}

