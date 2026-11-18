"""Regression checks for the private workspace security boundaries."""
import base64
import hashlib
import io
import json
from pathlib import Path
import secrets
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import app
import security
import team


class Request(app.Handler):
    def setup(self):
        self.rfile = io.BytesIO(self.request)
        self.wfile = io.BytesIO()

    def finish(self):
        self.response = self.wfile.getvalue()

    def log_message(self, *_):
        pass


class WorkspaceSecurity(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        override = patch.object(app, "DB_PATH", Path(temp.name) / "workspace.sqlite3")
        override.start()
        self.addCleanup(override.stop)
        app.initialize()
        self.password = "test-only-password"
        app.add_user("owner", self.password)
        with app.database() as conn:
            conn.execute("INSERT INTO admins VALUES('owner')")

    def call(self, path, data=None, cookie="", status=200):
        body = json.dumps(data).encode() if data is not None else b""
        method = "POST" if data is not None else "GET"
        headers = [f"{method} {path} HTTP/1.0", "Host: localhost", "Cookie: " + cookie,
                   "Content-Type: application/json", "X-Fieldbench: 1", f"Content-Length: {len(body)}"]
        response = Request(("\r\n".join(headers)+"\r\n\r\n").encode()+body, ("127.0.0.1",0),
                           SimpleNamespace(demo=False)).response
        head, body = response.split(b"\r\n\r\n",1)
        self.assertEqual(int(head.split()[1]),status,body)
        self.assertIn(b"Cache-Control: no-store",head)
        return head, json.loads(body) if b"application/json" in head else body

    def login(self, name="owner", code="", password=None):
        head, _ = self.call("/auth/login", {"name":name,"password":password or self.password,"code":code})
        self.assertIn(b"HttpOnly",head)
        return head.split(b"Set-Cookie: ")[1].split(b";")[0].decode()

    def approve_new(self, name, admin_cookie):
        self.call("/auth/request",{"name":name,"password":self.password},status=202)
        _, settings = self.call("/account/settings",cookie=admin_cookie)
        request = next(row for row in settings["requests"] if row["name"]==name)
        self.call("/account/approve",{"request_id":request["id"],"password":self.password},admin_cookie)

    def test_quote_to_delivery_and_shared_attachments(self):
        cookie = self.login()
        def post(op, fields, status=200):
            return self.call("/api/team/"+op, fields, cookie, status)

        post("lead",dict(customer="Farm",title="Pilot",currency="HKD",owner="owner",
                         stage="Quoted",quote="80000",estimate="52000",action="Confirm dates",project="A"))
        post("convert",{"lead":1})
        post("convert",{"lead":1})
        post("item",dict(sale=1,item=1,label="Drone",quantity="1",price="80000",cost="50000"))
        freight=dict(sale=1,label="Freight",amount="2000",day="2026-11-19",request_key="freight-once")
        post("charge",freight)
        post("charge",freight)
        post("payment",dict(sale=1,label="Deposit",amount="20000",day="2026-11-19"))
        post("fulfillment",dict(sale=1,status="Delivered",due="2026-11-19"))
        raw=b"\x89PNG\r\n\x1a\n"+b"test"
        file=dict(sale=1,filename="delivery.png",file=base64.b64encode(raw).decode())
        post("document",file)
        post("document",dict(file,sale=999),400)
        _,snapshot=self.call("/api/team",cookie=cookie)
        self.assertEqual(len(snapshot["sales"]),1)
        self.assertEqual(len(snapshot["sale_entries"]),2)
        self.assertEqual(len(snapshot["documents"]),1)
        self.assertEqual(snapshot["documents"][0]["sale"],1)
        self.assertEqual(snapshot["documents"][0]["preview"],"image/png")
        self.call("/previews/1",status=401)
        head,preview=self.call("/previews/1",cookie=cookie)
        self.assertIn(b"image/png",head)
        self.assertEqual(preview,raw)
        _,home=self.call("/api/workspace",cookie=cookie)
        self.assertEqual(home["leads"],[])
        post("order",dict(currency="HKD",quantity="3",supplier="Parts Co",invoice="P1",
             unit="5",extras="1",file=file["file"],filename="purchase.png"))
        post("allocate",dict(sale=1,purchase=1,quantity="2"))
        post("allocate",dict(sale=1,purchase=1,quantity="2"),400)
        post("allocate",dict(sale=1,purchase=1,quantity="1"))
        _,snapshot=self.call("/api/team",cookie=cookie)
        self.assertEqual(sum(int(a["amount"]) for a in snapshot["allocations"]),1600)

    def test_reset_and_first_login(self):
        old = self.login()
        self.call("/auth/request",{"name":"visitor","password":self.password},status=202)
        with app.database(write=True) as conn:
            app.save_record(conn,dict(kind="builds",title="Build",owner="owner",status="Ready",airframe="A",revision="1"),"owner")
            activation = security.reset_accounts(conn,"temp-password")
            self.assertEqual([r[0] for r in conn.execute("SELECT name FROM users")],["admin"])
            self.assertEqual(conn.execute("SELECT owner FROM records").fetchone()[0],"admin")
        self.call("/api/workspace",cookie=old,status=401)
        initial={"name":"admin","password":"temp-password"}
        head,result=self.call("/auth/login",initial)
        self.assertTrue(result["must_change"])
        self.assertNotIn(b"Set-Cookie",head)
        self.call("/auth/login",dict(initial,activation="wrong",replacement=self.password),status=403)
        self.call("/auth/login",dict(initial,activation=activation,replacement="temp-password"),status=400)
        head,_=self.call("/auth/login",dict(initial,activation=activation,replacement=self.password))
        cookie=head.split(b"Set-Cookie: ")[1].split(b";")[0].decode()
        _,settings=self.call("/account/settings",cookie=cookie)
        self.assertTrue(settings["admin"])
        self.assertEqual(settings["requests"][0]["name"],"visitor")
        self.call("/auth/login",initial,status=401)

    def test_registration_approval_and_profile(self):
        request = {"name":"pilot","display":"Flight lead","password":self.password}
        self.call("/auth/request",request,status=202)
        self.call("/auth/request",dict(request,display="Replacement"),status=202)
        self.call("/auth/login",request,status=401)
        owner = self.login()
        _, settings = self.call("/account/settings",cookie=owner)
        pending = settings["requests"]
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]["display"],"Flight lead")
        self.assertNotIn("password_hash",pending[0])
        approval = {"request_id":pending[0]["id"],"password":self.password}
        self.call("/account/approve",approval,owner)
        self.call("/account/approve",approval,owner,status=400)
        pilot = self.login("pilot")
        self.call("/account/profile",{"display":"Pilot One","password":self.password},pilot)
        _, state = self.call("/api/workspace",cookie=pilot)
        self.assertEqual(state["labels"]["pilot"],"Pilot One")
        self.assertEqual(state["actor"],"pilot")
        self.call("/auth/request",dict(request,name="visitor"),status=202)
        _, settings = self.call("/account/settings",cookie=owner)
        approval["request_id"] = settings["requests"][0]["id"]
        self.call("/account/approve",approval,pilot,status=403)
        self.call("/account/reject",approval,owner)
        self.call("/auth/login",dict(request,name="visitor"),status=401)

    def test_migration_and_limits(self):
        salt = secrets.token_bytes(16)
        legacy = hashlib.scrypt(self.password.encode(),salt=salt,n=16384,r=8,p=1)
        with app.database() as conn:
            conn.execute("UPDATE users SET salt=?,password_hash=? WHERE name='owner'",(salt,legacy))
        self.login()
        with app.database() as conn:
            saved = conn.execute("SELECT password_hash FROM users").fetchone()[0]
            self.assertTrue(saved.startswith(b"s2:"))
            for _ in range(25):
                security.failure(conn,["account:other","source:peer"],10,"unknown")
            self.assertGreater(security.blocked(conn,["account:new","source:peer"],10),10)
        for _ in range(5):
            self.call("/auth/login",{"name":"owner","password":"bad"},status=401)
        self.call("/auth/login",{"name":"owner","password":self.password},status=429)

    def test_enrollment_policy_and_recovery(self):
        old = self.login()
        current = self.login()
        auth = {"password":self.password}
        self.call("/account/require",auth,current,400)
        _, setup = self.call("/account/start",auth,current)
        code = team.code(setup["secret"],int(time.time())//30)
        _, enrolled = self.call("/account/confirm",dict(auth,code=code),current)
        self.call("/api/workspace",cookie=old,status=401)
        self.call("/account/require",auth,current)
        backup = enrolled["codes"][0]
        recovered = self.login(code=backup)
        self.call("/auth/login",dict(auth,name="owner",code=backup),status=403)
        self.approve_new("new",recovered)
        limited = self.login("new")
        self.call("/api/workspace",cookie=limited,status=403)
        self.call("/downloads/1",cookie=limited,status=403)
        self.call("/security",cookie=limited)
        _, settings = self.call("/account/settings",cookie=limited)
        self.assertNotIn("events",settings)
        self.call("/account/logout-all",auth,recovered)
        self.call("/account/settings",cookie=current,status=401)
        self.call("/api/team",cookie=recovered,status=401)
        with app.database() as conn:
            self.assertTrue(all(len(row[0]) == 64 for row in conn.execute("SELECT digest FROM recovery")))
            self.assertEqual(conn.execute("SELECT count(*) FROM recovery").fetchone()[0],7)

    def test_admin_and_download_activity(self):
        owner = self.login()
        auth = {"password":self.password,"target":"member"}
        self.approve_new("member",owner)
        member = self.login("member")
        self.call("/auth/register",{"name":"new","password":self.password},member,404)
        self.call("/account/grant",auth,member,403)
        self.call("/downloads/1",status=401)
        with app.database() as conn:
            conn.execute("INSERT INTO documents(name,body) VALUES('bill.pdf',?)",(b"private invoice",))
        self.call("/downloads/1",cookie=member)
        _, settings = self.call("/account/settings",cookie=owner)
        self.assertTrue(any(e["event"]=="Document downloaded" and e["actor"]=="member" for e in settings["events"]))
        self.assertNotIn("private invoice",json.dumps(settings))
        self.call("/account/disable",auth,owner)
        self.call("/downloads/1",cookie=member,status=401)
        self.call("/auth/login",{"name":"member","password":self.password},status=401)
        self.call("/account/enable",auth,owner)
        member = self.login("member")
        self.call("/account/reset",dict(auth,replacement="new-test-password"),owner)
        self.call("/api/workspace",cookie=member,status=401)
        self.login("member",password="new-test-password")
        self.call("/account/disable",dict(auth,target="owner"),owner,400)


if __name__ == "__main__":
    unittest.main()
