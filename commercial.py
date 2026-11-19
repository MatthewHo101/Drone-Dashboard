"""Commercial records in the shared workspace database. Amounts use minor currency units."""
from datetime import date
from decimal import Decimal, localcontext, ROUND_HALF_UP
import json
import sqlite3
import time
from urllib.request import urlopen

CURRENCIES = ("HKD","USD","EUR","GBP","CNY","AUD","CAD")
PIPELINE = ("Discovery","Qualified","Quoted","Lost")
FULFILLMENT = ("Confirmed","In progress","Delivered","Cancelled")
SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_cache(id INTEGER PRIMARY KEY CHECK(id=1), fetched INTEGER, rate_day TEXT, rates TEXT);
CREATE TABLE IF NOT EXISTS opportunities(id INTEGER PRIMARY KEY, customer TEXT, title TEXT, owner TEXT,
 stage TEXT, currency TEXT, quote INTEGER, estimate INTEGER, action TEXT, due TEXT, project TEXT);
CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY, opportunity INTEGER UNIQUE REFERENCES opportunities,
 customer TEXT, title TEXT, currency TEXT, status TEXT, due TEXT, project TEXT);
CREATE TABLE IF NOT EXISTS sale_items(id INTEGER PRIMARY KEY, sale INTEGER REFERENCES sales,
 label TEXT, quantity INTEGER, price INTEGER, cost INTEGER);
CREATE TABLE IF NOT EXISTS sale_entries(id INTEGER PRIMARY KEY, sale INTEGER REFERENCES sales,
 kind TEXT, label TEXT, amount INTEGER, day TEXT);
CREATE TABLE IF NOT EXISTS sale_docs(document INTEGER PRIMARY KEY REFERENCES documents, sale INTEGER REFERENCES sales);
CREATE TABLE IF NOT EXISTS purchase_tags(purchase INTEGER PRIMARY KEY REFERENCES orders, category TEXT, project TEXT);
CREATE TABLE IF NOT EXISTS chart_projects(chart INTEGER PRIMARY KEY REFERENCES charts, project TEXT);
CREATE TABLE IF NOT EXISTS meeting_links(meeting INTEGER PRIMARY KEY REFERENCES meetings, project TEXT, opportunity INTEGER REFERENCES opportunities);
CREATE TABLE IF NOT EXISTS allocations(id INTEGER PRIMARY KEY, purchase INTEGER REFERENCES orders,
 sale INTEGER REFERENCES sales, quantity INTEGER, amount INTEGER);
CREATE TABLE IF NOT EXISTS commercial_writes(token TEXT PRIMARY KEY, operation TEXT, actor TEXT);
"""


def refresh_rates(database):
    now = int(time.time())
    with database() as conn:
        cached = conn.execute("SELECT fetched FROM fx_cache WHERE id=1").fetchone()
    if cached and cached[0] + 86400 > now:
        return cached[0] + 86400 - now
    with urlopen("https://api.frankfurter.dev/v1/latest?base=GBP", timeout=15) as response:
        payload = json.load(response, parse_float=Decimal)
    day = date.fromisoformat(payload["date"]).isoformat()
    if payload["base"] != "GBP":
        raise ValueError("Unexpected rate base")
    rates = {"GBP":"1"}
    for currency in CURRENCIES:
        if currency != "GBP":
            rate = Decimal(payload["rates"][currency])
            if not rate.is_finite() or rate <= 0:
                raise ValueError("Invalid exchange rate")
            rates[currency] = str(rate)
    with database(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO fx_cache VALUES(1,?,?,?)",(now,day,json.dumps(rates)))
    return 86400


def rate_worker(database):
    while True:
        try:
            delay = refresh_rates(database)
        except (OSError, ValueError, KeyError, TypeError, ArithmeticError, sqlite3.Error) as error:
            print(f"Exchange rate refresh failed: {error}", flush=True)
            delay = 3600
        time.sleep(delay)


def overview(conn, data):
    revenue = {code:0 for code in CURRENCIES}
    cost = revenue.copy()
    delivered = {s["id"]:s["currency"] for s in data["sales"] if s["status"]=="Delivered"}
    for item in data["sale_items"]:
        code = delivered.get(item["sale"])
        if code:
            revenue[code] += item["quantity"] * item["price"]
            cost[code] += item["quantity"] * (item["cost"] or 0)
    for entry in data["sale_entries"]:
        if entry["sale"] in delivered and entry["kind"]=="charge":
            cost[delivered[entry["sale"]]] += entry["amount"]
    for order in data["orders"]:
        if order["status"] != "Cancelled":
            cost[order["currency"]] += order["quantity"] * order["unit_minor"] + order["extra_minor"]
    row = conn.execute("SELECT rate_day,rates FROM fx_cache WHERE id=1").fetchone()
    rates = json.loads(row["rates"]) if row else {}
    def convert(amounts, target):
        with localcontext() as ctx:
            ctx.prec = 50
            total = Decimal(amounts[target])
            for source, amount in amounts.items():
                if source != target and amount:
                    if source not in rates or target not in rates:
                        return None
                    total += Decimal(amount) * Decimal(rates[target]) / Decimal(rates[source])
            return str(total.quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return {"rate_day":row["rate_day"] if row else None,
            "totals":{code:{"revenue":convert(revenue,code),"cost":convert(cost,code)} for code in CURRENCIES}}


def preview_type(raw):
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"%PDF-"):
        return "application/pdf"
    return ""


def snapshot(conn):
    result = {}
    for table in ("opportunities","sales","sale_items","sale_entries","allocations"):
        result[table] = [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY id DESC")]
    for allocation in result["allocations"]:
        allocation["amount"] = str(allocation["amount"])
    return result


def require_row(conn, table, value):
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (value,)).fetchone()
    if not row:
        raise ValueError("The linked record no longer exists.")
    return row


def enum(value, allowed):
    if value not in allowed:
        raise ValueError("Choose a valid option.")
    return value


def day(value):
    return date.fromisoformat(value).isoformat() if value else ""


def apply(conn, op, d, actor):
    from team import string, money
    if op in ("lead","sale"):
        customer = string(d,"customer")
        title = string(d,"title")
        currency = enum(d.get("currency"),CURRENCIES)
        project = string(d,"project",100,True)
        due = day(string(d,"due",10,True))
        if op=="sale":
            sale = conn.execute("INSERT INTO sales(customer,title,currency,status,due,project) VALUES(?,?,?,?,?,?)",
                         (customer,title,currency,"Confirmed",due,project)).lastrowid
            received = money(d,"received") if d.get("received") else 0
            if received:
                paid_on = date.fromisoformat(string(d,"paid_on",10)).isoformat()
                conn.execute("INSERT INTO sale_entries(sale,kind,label,amount,day) VALUES(?,?,?,?,?)",
                             (sale,"payment","Initial payment",received,paid_on))
            return
        owner = string(d,"owner",40)
        if not conn.execute("SELECT 1 FROM users WHERE name=?", (owner,)).fetchone():
            raise ValueError("Choose an existing owner.")
        values = (customer,title,owner,enum(d.get("stage"),PIPELINE),currency,money(d,"quote"),
                  money(d,"estimate"),string(d,"action"),due,project)
        if d.get("lead"):
            if conn.execute("SELECT 1 FROM sales WHERE opportunity=?",(d["lead"],)).fetchone():
                raise ValueError("This opportunity has already been converted.")
            require_row(conn,"opportunities",d["lead"])
            conn.execute("""UPDATE opportunities SET customer=?,title=?,owner=?,stage=?,currency=?,quote=?,
                         estimate=?,action=?,due=?,project=? WHERE id=?""",(*values,d["lead"]))
        else:
            conn.execute("INSERT INTO opportunities VALUES(NULL,?,?,?,?,?,?,?,?,?,?)",values)
        return
    if op=="convert":
        lead = require_row(conn,"opportunities",d.get("lead"))
        if lead["stage"]=="Lost":
            raise ValueError("Reopen this opportunity before converting it.")
        if conn.execute("SELECT 1 FROM sales WHERE opportunity=?",(lead["id"],)).fetchone():
            return
        sale = conn.execute("""INSERT INTO sales(opportunity,customer,title,currency,status,due,project)
                            VALUES(?,?,?,?,'Confirmed','',?)""",
                            tuple(lead[k] for k in ("id","customer","title","currency","project"))).lastrowid
        conn.execute("INSERT INTO sale_items VALUES(NULL,?,?,1,?,NULL)",(sale,lead["title"],lead["quote"]))
        return
    sale = require_row(conn,"sales",d.get("sale"))
    if op=="fulfillment":
        conn.execute("UPDATE sales SET status=?,due=? WHERE id=?",(enum(d.get("status"),FULFILLMENT),
                     day(string(d,"due",10,True)),sale["id"]))
    elif op=="item":
        quantity = int(string(d,"quantity",6))
        if not 1<=quantity<=999999:
            raise ValueError("Enter a positive quantity.")
        values = (string(d,"label"),quantity,money(d,"price"),money(d,"cost") if d.get("cost") else None)
        if d.get("item"):
            if not conn.execute("UPDATE sale_items SET label=?,quantity=?,price=?,cost=? WHERE id=? AND sale=?",
                                (*values,d["item"],sale["id"])).rowcount:
                raise ValueError("Unknown order item.")
        else:
            conn.execute("INSERT INTO sale_items(sale,label,quantity,price,cost) VALUES(?,?,?,?,?)",(sale["id"],*values))
    elif op in ("charge","payment"):
        amount = money(d,"amount")
        if amount <= 0:
            raise ValueError("Enter an amount above zero.")
        conn.execute("INSERT INTO sale_entries VALUES(NULL,?,?,?,?,?)",(sale["id"],op,string(d,"label"),amount,
                     date.fromisoformat(string(d,"day",10)).isoformat()))
    elif op=="allocate":
        purchase = require_row(conn,"orders",d.get("purchase"))
        qty = int(string(d,"quantity",6))
        used,spent = conn.execute("SELECT coalesce(sum(quantity),0),coalesce(sum(amount),0) FROM allocations WHERE purchase=?",
                                  (purchase["id"],)).fetchone()
        if purchase["currency"]!=sale["currency"] or purchase["status"]=="Cancelled" or not 0<qty<=purchase["quantity"]-used:
            raise ValueError("Choose available units from an active purchase in the order currency.")
        # Allocate tax and shipping proportionally, including the final rounding remainder.
        total = purchase["unit_minor"]*purchase["quantity"]+purchase["extra_minor"]
        amount = total*(used+qty)//purchase["quantity"]-spent
        conn.execute("INSERT INTO allocations VALUES(NULL,?,?,?,?)",(purchase["id"],sale["id"],qty,amount))
    else:
        raise LookupError("Unknown sales operation.")

