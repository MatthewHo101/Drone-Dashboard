# Fieldbench

Fieldbench is an internal drone-development dashboard for a small founding team. It tracks airframe revisions, bench and flight tests, issues, and part orders in a shared SQLite database.

## Try the demo

With Python 3.10 or later, run:

```sh
python app.py serve --demo
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). The demo seeds fictional data and uses a separate SQLite file. It binds to loopback and uses no login. Normal workspace data starts empty.

1. Open the failed **Position hold check** in **Tests** and inspect its linked build.
2. Choose **Create follow-up issue**, add a title and next action, then save it.
3. Open **Share** to copy a short update or open WhatsApp to select a chat and send it.

## Self-host on Ubuntu

With Docker Engine and the Compose plugin installed, clone the repository and run the following from the checkout.

```sh
docker compose up -d --build
docker compose exec fieldbench python app.py add-user founder1
docker compose exec fieldbench python app.py add-user founder2
docker compose exec fieldbench python app.py add-user founder3
```

Replace the example usernames with your founders' names. The command prompts each founder for a password. The app listens on the server's loopback interface at port 8080. For remote access, put an HTTPS reverse proxy in front of that port and restrict it to your team's private network or VPN. HTTP Basic Auth sends credentials with each request, so use HTTPS for remote access and leave the Compose port on loopback.

Open the dashboard through its shared HTTPS address before sharing records. Recipients need private-network access and a workspace account. Share opens a prefilled WhatsApp message for manual sending. It also supports copying the message, with a selectable text fallback for browsers that restrict clipboard access.

### Back up and restore

Create a consistent snapshot while the app is running, then copy it off the server.

```sh
docker compose exec fieldbench python app.py backup /data/workspace-backup.sqlite3
docker compose cp fieldbench:/data/workspace-backup.sqlite3 ./workspace-backup.sqlite3
```

Use a fresh snapshot filename each time and keep your off-server copy encrypted. To verify a restore without disrupting the running service, copy the backup to a scratch directory and run the app from this checkout with the copy and a different port:

```sh
FIELDBENCH_DB=/absolute/path/to/scratch/workspace-backup.sqlite3 python3 app.py serve --port 8081
```

Check that you can sign in and see your records at port 8081. The snapshot contains founder accounts and all dashboard records. Back up any external files separately.

## Scope

All signed-in founders can view and edit records. The app records the last editor, links tests to their build revision, and preserves a revision's configuration once it has tests. This prototype stores reference links for CAD, logs, photos, and order documents. Offline editing, automated WhatsApp messaging, uploads, and purchasing integrations are outside the prototype.

