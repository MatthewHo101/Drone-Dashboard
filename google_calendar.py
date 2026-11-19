"""Create all-day Google Calendar events with session-bound OAuth authorization."""
import base64
import hashlib
import json
import os
import secrets
import time
from datetime import date, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SCHEMA = """
CREATE TABLE IF NOT EXISTS google_auth(session TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,
 state TEXT, verifier TEXT, pending_task INTEGER, day TEXT, until INTEGER, access TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS google_event_ids(task INTEGER PRIMARY KEY REFERENCES records(id), event TEXT NOT NULL);
"""
EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


def request(url, data=None, token=None):
    headers = {"Authorization":"Bearer "+token} if token else {}
    if isinstance(data,dict):
        headers["Content-Type"] = "application/json"
        data = json.dumps(data).encode()
    with urlopen(Request(url,data=data,headers=headers),timeout=12) as response:
        return json.load(response)


def handle(conn, session, path, data):
    client, secret, redirect = (os.getenv(k) for k in ("GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"))
    if not all((client,secret,redirect)):
        raise ValueError("Set up the Google Calendar credentials on the server first.")
    now = int(time.time())
    auth = conn.execute("SELECT * FROM google_auth WHERE session=?", (session,)).fetchone()
    try:
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
            conn.execute("UPDATE google_auth SET access=?,expires=?,verifier=NULL WHERE session=?",
                         (token,now+int(grant["expires_in"]),session))
            conn.commit()
        else:
            task_id = data.get("task")
            today = date.fromisoformat(data["today"]).isoformat()
            token = auth["access"] if auth and (auth["expires"] or 0)>now+30 else None
        task = conn.execute("SELECT * FROM records WHERE id=? AND kind='issues'",(task_id,)).fetchone()
        if not task:
            raise ValueError("Task unavailable.")
        if not token:
            state,verifier = secrets.token_urlsafe(32),secrets.token_urlsafe(48)
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
            conn.execute("INSERT OR REPLACE INTO google_auth(session,state,verifier,pending_task,day,until) VALUES(?,?,?,?,?,?)",
                         (session,state,verifier,task_id,today,now+600))
            conn.commit()
            return {"url":"https://accounts.google.com/o/oauth2/v2/auth?"+urlencode(dict(
                client_id=client,redirect_uri=redirect,response_type="code",state=state,
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
        return {"url":saved["htmlLink"]}
    except HTTPError as error:
        if error.code==401:
            conn.execute("DELETE FROM google_auth WHERE session=?",(session,))
            conn.commit()
        raise ValueError("Google Calendar declined the request. Check access and try again.") from error
    except (URLError,TimeoutError) as error:
        raise ValueError("Google Calendar could not be reached. Try again.") from error
