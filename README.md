# Lysim

Lysim is an internal drone-development dashboard for a small founding team. It tracks airframe revisions, bench and flight tests, issues, and part orders in a shared SQLite database.

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

Replace the example usernames with your founders' names. The command prompts each founder for a password. The app listens on the server's loopback interface at port 8080. For remote access, put an HTTPS reverse proxy in front of that port and restrict it to your team's private network or VPN. Use the login page to sign in. Choose Add user there and authenticate as a designated administrator to create another account. Sessions expire after eight hours. Use HTTPS or a localhost SSH tunnel.

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

All signed-in founders can view and edit records. The app records the last editor, links tests to their build revision, and preserves a revision's configuration once it has tests. This prototype stores reference links for CAD, logs, photos, and order documents. The team workspace also supports file uploads and invoice-backed order tracking.


## Team workspace

Choose **Team workspace** in the sidebar. Use the project board to assign tasks to founders, group them by project, set due dates, and move cards through four stages. Existing issues appear on this board. Dated tasks and meetings offer **Add to Google Calendar**. Google opens a prefilled all-day event for the founder to review and save. Later dashboard edits require a corresponding calendar edit.

Upload documents or invoices up to 5 MiB each. Choose a task during upload to show the file on its card. Documents and invoices are stored in the SQLite database and included in its backup. For an order, enter the invoice reference, currency, quantity, unit price, tax and shipping. For a mixed-item invoice, use quantity one and its pre-tax subtotal as the unit price. Lysim calculates the total and sums active orders separately by currency. Invoice values are entered manually. Cancelled orders stay in the history.

Create flowcharts by entering one directed connection per line such as `Design -> Review` and `Review -> Test`. Reuse a node name to create a branch or cycle.

### Meeting summaries

Save the meeting date, title, and notes. **Summarize notes** sends the saved text to your configured Ollama server and saves its response alongside the original. Set `OLLAMA_URL` to the service address reachable from the app and `OLLAMA_MODEL` to an installed model. Pull that model on the Ollama host first (for example, `ollama pull llama3.2`). For Compose, put both settings in an untracked `.env` file beside compose.yaml and run `docker compose up -d --build`. The default container endpoint is the Ubuntu host gateway on port 11434. Ollama must listen on an interface reachable from the container. Keep that endpoint on your private network. Notes remain saved if generation fails.

### Account security

From the trusted server console, run `docker compose exec fieldbench python app.py make-admin founder1` with an existing active username. This step applies to upgrades and fresh installations. Visitors can select Register at sign-in to request an account. An administrator reviews pending requests under Account → Account security and can approve or reject each one. Approval grants member access. Existing members can change their display name there using their current password. Usernames remain the stable sign-in and audit identifiers. Members retain their workspace access. Administrators can add users from the login page and manage roles, disable accounts, reset passwords and review recent security events under **Account → Account security**.

Each founder should enroll an authenticator from Account security, confirm one code, and store the eight displayed single-use recovery codes privately. Existing authenticator users can generate recovery codes there too. Sign-in accepts either an authenticator code or an unused recovery code. Once all active users are enrolled, an administrator can choose **Require 2FA for the workspace**. Future members get enrollment-only access until they confirm setup. Server operators can replace a lost authenticator with `python app.py enable-2fa USER` inside the container; this revokes sessions and recovery codes.

Passwords are hashed with a unique random salt and scrypt. Successful authenticated login upgrades legacy hashes. Password resets and account disabling revoke sessions. Sign out all devices invalidates every session for your account. Login limits apply separately to the account and source, with progressive delays up to five minutes. The included Compose setup uses forwarded client addresses only for connections from the resolved Caddy container. Other deployments use the direct peer by default.

The server database holds workspace records, documents, authenticator configuration, hashed recovery codes and hashed session tokens. The browser holds an eight-hour opaque Secure, HttpOnly, SameSite cookie and renders authorized API results in memory. Responses use no-store. Enrollment keys and newly generated recovery codes are briefly displayed for setup. Uploaded documents are downloaded to a user's device only when requested. Backups contain sensitive data and need private storage. Administrators see the latest 100 of up to 5,000 security events; times, account names, event types and document IDs are recorded without passwords, document bodies or codes.

### WhatsApp community

Set `WHATSAPP_COMMUNITY_URL` in the untracked Compose .env file to your community's chat.whatsapp.com invite link and recreate the container. Signed-in founders then see a community shortcut. Record sharing still opens WhatsApp for manual sending.
