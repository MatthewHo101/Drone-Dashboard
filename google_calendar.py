"""Create all-day Google Calendar events with session-bound OAuth authorization."""
import base64
import hashlib
import json
import os
import secrets
import time
from datetime import date, datetime, timezone, timedelta

from urllib.parse import quote, urlsplit
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SCHEMA = """
CREATE TABLE IF NOT EXISTS google_auth(session TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,
 state TEXT, verifier TEXT, pending_task INTEGER, day TEXT, until INTEGER, access TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS calendar_accounts(actor TEXT PRIMARY KEY REFERENCES users(name) ON DELETE CASCADE, credential BLOB, synced TEXT, problem TEXT);
CREATE TABLE IF NOT EXISTS calendar_meetings(meeting INTEGER PRIMARY KEY REFERENCES meetings, actor TEXT, event TEXT, starts TEXT, link TEXT, video TEXT, cancelled INTEGER, UNIQUE(actor,event));
CREATE TABLE IF NOT EXISTS calendar_versions(meeting INTEGER PRIMARY KEY REFERENCES meetings, etag TEXT);
CREATE TABLE IF NOT EXISTS meeting_tasks(meeting INTEGER REFERENCES meetings, task INTEGER REFERENCES records, PRIMARY KEY(meeting,task));
CREATE TABLE IF NOT EXISTS calendar_deadlines(actor TEXT, task INTEGER REFERENCES records, day TEXT, PRIMARY KEY(actor,task));
CREATE TABLE IF NOT EXISTS google_event_ids(task INTEGER PRIMARY KEY REFERENCES records(id), event TEXT NOT NULL);
"""
EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


def request(url, data=None, token=None, method=None, etag=None):
    headers = {"Authorization":"Bearer "+token} if token else {}
    if etag:
        headers["If-None-Match"]=etag
    if isinstance(data,dict):
        headers["Content-Type"] = "application/json"
        data = json.dumps(data).encode()
    with urlopen(Request(url,data=data,headers=headers,method=method),timeout=12) as response:
        return json.load(response)


def handle(conn, session, path, data):
    client, secret, redirect = (os.getenv(k) for k in ("GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"))
    if not all((client,secret,redirect)):
        raise ValueError("Set up the Google Calendar credentials on the server first.")
    now = int(time.time())
    auth = conn.execute("SELECT * FROM google_auth WHERE session=?", (session,)).fetchone()
    actor=conn.execute("SELECT name FROM sessions WHERE token=?",(session,)).fetchone()[0]
    account=conn.execute("SELECT * FROM calendar_accounts WHERE actor=?",(actor,)).fetchone()
    op=path.rsplit("/",1)[-1]
    try:
        if op=="status":
            return {"connected":bool(account),"problem":account["problem"] if account else ""}
        if op=="disconnect":
            conn.execute("DELETE FROM calendar_accounts WHERE actor=?",(actor,))
            conn.execute("DELETE FROM calendar_deadlines WHERE actor=?",(actor,))
            conn.execute("UPDATE calendar_meetings SET actor=NULL WHERE actor=?",(actor,))
            conn.execute("DELETE FROM google_auth WHERE session IN (SELECT token FROM sessions WHERE name=?)",(actor,))
            conn.commit()
            return {"saved":True}
        if op in ("search","link"):
            if not account:
                raise ValueError("Connect Google Calendar on the Account page first.")
            return meeting_action(conn,actor,access(account),op,data)
        if op not in ("finish","connect","add"):
            raise ValueError("Unknown Calendar operation.")
        if path.endswith("/finish"):
            if not auth or not auth["state"] or auth["until"] < now or auth["state"] != data.get("state"):
                raise ValueError("Calendar connection expired. Try again from Task details.")
            task_id, today = auth["pending_task"], auth["day"]
            if not conn.execute("UPDATE google_auth SET state=NULL WHERE session=? AND state=?", (session,auth["state"])).rowcount:
                raise ValueError("This connection request was already used.")
            conn.commit()
            grant = request("https://oauth2.googleapis.com/token",urlencode(dict(client_id=client,
                client_secret=secret,redirect_uri=redirect,grant_type="authorization_code",
                code=data.get("code",""),code_verifier=auth["verifier"])).encode())
            token = grant["access_token"]
            if grant.get("refresh_token"):
                encrypted=cipher().encrypt(grant["refresh_token"].encode())
                conn.execute("INSERT OR REPLACE INTO calendar_accounts(actor,credential) VALUES(?,?)",(actor,encrypted))
            elif not account and task_id is None:
                raise ValueError("Offline access was not granted. Connect again from Account.")
            conn.execute("UPDATE google_auth SET access=?,expires=?,verifier=NULL WHERE session=?",
                         (token,now+int(grant["expires_in"]),session))
            conn.commit()
        else:
            task_id = data.get("task")
            today = date.fromisoformat(data.get("today",date.today().isoformat())).isoformat()
            token = auth["access"] if auth and (auth["expires"] or 0)>now+30 else None
            if op=="connect":
                token=None
            elif not token and account:
                token=access(account)
        if task_id is None and op=="finish":
            return {"url":"/security"}
        task = conn.execute("SELECT * FROM records WHERE id=? AND kind='issues'",(task_id,)).fetchone()
        if not task and op!="connect":
            raise ValueError("Task unavailable.")
        if not token:
            state,verifier = secrets.token_urlsafe(32),secrets.token_urlsafe(48)
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
            conn.execute("INSERT OR REPLACE INTO google_auth(session,state,verifier,pending_task,day,until) VALUES(?,?,?,?,?,?)",
                         (session,state,verifier,task_id,today,now+600))
            conn.commit()
            return {"url":"https://accounts.google.com/o/oauth2/v2/auth?"+urlencode(dict(
                client_id=client,redirect_uri=redirect,response_type="code",state=state,access_type="offline",prompt="consent",
                scope="https://www.googleapis.com/auth/calendar.events.owned",code_challenge=challenge,
                code_challenge_method="S256"))}
        conn.execute("INSERT OR IGNORE INTO google_event_ids VALUES(?,?)",(task_id,secrets.token_hex(16)))
        event_id = conn.execute("SELECT event FROM google_event_ids WHERE task=?",(task_id,)).fetchone()[0]
        conn.commit()
        day = date.fromisoformat(task["record_date"] or today)
        link = redirect.rsplit("/google/callback",1)[0]+"/team#task/"+str(task_id)
        event = dict(id=event_id,summary=task["title"],start={"date":day.isoformat()},
                     end={"date":(day+timedelta(days=1)).isoformat()},description=link)
        try:
            saved = request(EVENTS,event,token)
        except HTTPError as error:
            if error.code != 409:
                raise
            saved = request(EVENTS+"/"+event_id,token=token)
        if saved.get("status")=="cancelled" or not saved.get("htmlLink"):
            raise ValueError("This event was deleted in Google Calendar. Restore it from Calendar trash.")
        conn.execute("BEGIN IMMEDIATE")
        meeting=save_event(conn,actor,saved)
        conn.execute("INSERT OR IGNORE INTO meeting_tasks VALUES(?,?)",(meeting,task_id))
        if account or op=="finish":
            conn.execute("INSERT OR REPLACE INTO calendar_deadlines VALUES(?,?,?)",(actor,task_id,saved.get("start",{}).get("date",day.isoformat())))
        conn.commit()
        return {"url":saved["htmlLink"],"meeting":meeting}
    except HTTPError as error:
        if error.code==401:
            conn.execute("DELETE FROM google_auth WHERE session=?",(session,))
            conn.commit()
        raise ValueError("Google Calendar declined the request. Check access and try again.") from error
    except (URLError,TimeoutError) as error:
        raise ValueError("Google Calendar could not be reached. Try again.") from error

def cipher():
    from cryptography.fernet import Fernet
    key=hashlib.sha256(("Lysim calendar refresh:"+os.environ["GOOGLE_CLIENT_SECRET"]).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def access(account):
    from cryptography.fernet import InvalidToken
    try:
        refresh=cipher().decrypt(account["credential"]).decode()
    except InvalidToken as error:
        raise ValueError("Reconnect Google Calendar after the credential change.") from error
    grant=request("https://oauth2.googleapis.com/token",urlencode(dict(client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],grant_type="refresh_token",refresh_token=refresh)).encode())
    return grant["access_token"]


def snapshot(conn,actor):
    account=conn.execute("SELECT synced,problem FROM calendar_accounts WHERE actor=?",(actor,)).fetchone()
    return dict(calendar_account=dict(account) if account else None,
        calendar_task_events=[dict(r) for r in conn.execute("""SELECT DISTINCT t.task,m.day FROM meeting_tasks t
            JOIN meetings m ON m.id=t.meeting JOIN calendar_meetings c ON c.meeting=m.id
            JOIN google_event_ids e ON e.task=t.task AND e.event=c.event WHERE c.cancelled=0""")],
        calendar_meetings=[dict(r) for r in conn.execute("SELECT meeting,starts,link,video,cancelled FROM calendar_meetings")],
        meeting_tasks=[dict(r) for r in conn.execute("SELECT * FROM meeting_tasks")])


def safe_url(url):
    return url if url and urlsplit(url).scheme=="https" else ""


def save_event(conn,actor,event):
    row=conn.execute("SELECT meeting FROM calendar_meetings WHERE actor=? AND event=?",(actor,event["id"])).fetchone()
    if event.get("status")=="cancelled":
        if row:
            conn.execute("UPDATE calendar_meetings SET cancelled=1 WHERE meeting=?", (row[0],))
            return row[0]
        raise ValueError("The meeting was cancelled.")
    starts=event["start"].get("dateTime") or event["start"]["date"]
    title=event.get("summary") or "Untitled meeting"
    if row:
        meeting=row[0]
        conn.execute("UPDATE meetings SET title=?,day=? WHERE id=?",(title,starts[:10],meeting))
    else:
        meeting=conn.execute("INSERT INTO meetings(title,day,notes,summary) VALUES(?,?,'','')",(title,starts[:10])).lastrowid
    conn.execute("INSERT OR REPLACE INTO calendar_meetings VALUES(?,?,?,?,?,?,0)",
        (meeting,actor,event["id"],starts,safe_url(event.get("htmlLink")),safe_url(event.get("hangoutLink"))))
    conn.execute("INSERT OR REPLACE INTO calendar_versions VALUES(?,?)",(meeting,event.get("etag")))
    return meeting


def meeting_action(conn,actor,token,op,data):
    if op=="search":
        params=dict(singleEvents="true",orderBy="startTime",timeMin=datetime.now(timezone.utc).isoformat(),
                    maxResults=40,q=str(data.get("query",""))[:160],fields="nextPageToken,items(id,summary,start)")
        if data.get("page"):
            params["pageToken"]=data["page"]
        return request(EVENTS+"?"+urlencode(params),token=token)
    event=request(EVENTS+"/"+quote(data["event"],safe=""),token=token)
    conn.execute("BEGIN IMMEDIATE")
    if not conn.execute("SELECT 1 FROM records WHERE kind='issues' AND id=?",(data["task"],)).fetchone():
        raise ValueError("Task unavailable.")
    meeting=save_event(conn,actor,event)
    conn.execute("INSERT OR IGNORE INTO meeting_tasks VALUES(?,?)",(meeting,data["task"]))
    conn.commit()
    return {"saved":True}


def sync_account(database,account):
    actor=account["actor"]
    token=access(account)
    with database() as conn:
        meetings=list(conn.execute("SELECT event,etag FROM calendar_meetings LEFT JOIN calendar_versions USING(meeting) WHERE actor=? AND cancelled=0",(actor,)))
        deadlines=list(conn.execute("""SELECT d.task,r.record_date,e.event FROM calendar_deadlines d
            JOIN records r ON r.id=d.task JOIN google_event_ids e ON e.task=d.task
            WHERE d.actor=? AND r.record_date<>'' AND r.record_date<>d.day""",(actor,)))
    for row in meetings:
        try:
            event=request(EVENTS+"/"+quote(row["event"],safe=""),token=token,etag=row["etag"])
        except HTTPError as error:
            if error.code==304:
                continue
            if error.code not in (404,410):
                raise
            event=dict(id=row["event"],status="cancelled")
        with database(write=True) as conn:
            if conn.execute("SELECT 1 FROM calendar_meetings WHERE actor=? AND event=?",(actor,row["event"])).fetchone():
                save_event(conn,actor,event)
    for row in deadlines:
        day=date.fromisoformat(row["record_date"])
        try:
            request(EVENTS+"/"+row["event"],{"start":{"date":day.isoformat()},"end":{"date":(day+timedelta(days=1)).isoformat()}},token,"PATCH")
        except HTTPError as error:
            if error.code not in (404,410):
                raise
            with database(write=True) as conn:
                conn.execute("DELETE FROM calendar_deadlines WHERE actor=? AND task=?",(actor,row["task"]))
            continue
        with database(write=True) as conn:
            conn.execute("UPDATE calendar_deadlines SET day=? WHERE actor=? AND task=?",(row["record_date"],actor,row["task"]))


def sync_worker(database):
    while True:
        try:
            with database() as conn:
                accounts=list(conn.execute("SELECT * FROM calendar_accounts WHERE actor NOT IN (SELECT name FROM disabled)"))
            for account in accounts:
                try:
                    sync_account(database,account)
                    with database(write=True) as conn:
                        conn.execute("UPDATE calendar_accounts SET synced=?,problem=NULL WHERE actor=?",
                                     (datetime.now(timezone.utc).isoformat(),account["actor"]))
                except Exception:
                    with database(write=True) as conn:
                        conn.execute("UPDATE calendar_accounts SET problem='Sync failed. Check the connection in Account.' WHERE actor=?",(account["actor"],))
        except Exception:
            print("Calendar sync unavailable; retrying in five minutes.",flush=True)
        time.sleep(300)
