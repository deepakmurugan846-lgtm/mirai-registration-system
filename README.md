# MIRAI — Two-device registration robot

A local-network registration system. The laptop runs the Express + Socket.IO + SQLite backend and live admin dashboard. The tablet opens the robot face and QR flow. Visitors scan the QR code on their own phone to register.

## 1) Requirements
- Node.js 20 LTS or newer (install from https://nodejs.org)
- Laptop and tablet on the same Wi-Fi network
- Allow Node.js through your laptop firewall on private networks

## 2) Install
Open Terminal in this project folder:

```bash
npm run install:all
```

Create the server environment file:

```bash
cp server/.env.example server/.env
```

Generate a secure 32-byte encryption key:

```bash
openssl rand -base64 32
```

Paste the generated value into `server/.env` as `ENCRYPTION_KEY=...`.

Find your laptop's Wi-Fi IPv4 address:
- macOS: System Settings → Wi-Fi → Details → TCP/IP
- Windows: run `ipconfig` and look for IPv4 Address

Create the client environment file:

```bash
cp client/.env.example client/.env
```

Replace `192.168.1.10` in both client values with your laptop's actual Wi-Fi IP. In `server/.env`, set `CLIENT_ORIGIN` to both local development origins, for example:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173,http://192.168.1.10:5173
ENCRYPTION_KEY=PASTE_YOUR_GENERATED_KEY_HERE
GROQ_API_KEY=
```

Do not share `.env` files or commit them to GitHub.

## 3) Start both servers (two Terminal windows)
Terminal 1 — laptop backend:

```bash
npm run dev:server
```

Terminal 2 — tablet website frontend:

```bash
npm run dev:client
```

Open on the laptop:
- Admin dashboard: `http://localhost:5173/admin`
- Robot preview: `http://localhost:5173/`

Open on the tablet (replace with laptop IP):
- `http://192.168.1.10:5173/`

Keep both Terminal windows open. The laptop must remain awake and connected to Wi-Fi. Tap the robot face; after the greeting, a QR code appears. Scan it with a phone and submit the form. The laptop admin dashboard updates live.

## 4) Production build (optional)
```bash
npm run build
npm start
```
The Express server serves the built frontend on port 4000. For this mode, set the client build-time API and public URL values before building, and use `http://LAPTOP-IP:4000` as the tablet URL. For a real public event, use HTTPS and a trusted network/domain.

## Data and security
- Registration fields are validated in the browser and again on the server with Zod.
- Records are encrypted at rest using AES-256-GCM before being written to SQLite (`server/data/registrations.sqlite`).
- The encryption key is stored in `server/.env`, separate from the database.
- Phone numbers and emails are personal data. Restrict access to the laptop and Wi-Fi; the sample admin endpoint is intended for a trusted event LAN and does not include administrator login. Add authentication before exposing this server to the internet or an untrusted network.
- HTTPS is required for production use across public networks. Local HTTP is only for a trusted isolated LAN demo.
- A QR session expires after 60 minutes and can be used once.
- Groq is optional and not used by the basic greeting flow. Browser speech synthesis handles the welcome voice, so no paid voice API is needed.

## Routes
- `/` tablet robot interface
- `/register/:token` visitor registration form
- `/admin` laptop live dashboard
- `GET /api/registrations` live data snapshot
- `GET /api/export.csv` CSV export
- `GET /api/network` laptop LAN addresses
- `GET /api/health` health check
