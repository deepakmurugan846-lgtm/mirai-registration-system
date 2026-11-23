import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import Database from 'better-sqlite3';
import { Server } from 'socket.io';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
const io = new Server(server, { cors: { origin: allowedOrigins, methods: ['GET', 'POST'] } });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (origin, cb) => !origin || allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Origin not allowed')) }));
app.use(express.json({ limit: '20kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false }));

const keyText = process.env.ENCRYPTION_KEY || '';
let encryptionKey;
try { encryptionKey = Buffer.from(keyText, 'base64'); } catch { encryptionKey = Buffer.alloc(0); }
if (encryptionKey.length !== 32) {
  console.warn('\nWARNING: ENCRYPTION_KEY is missing or invalid. Create a 32-byte base64 key in server/.env before accepting real registrations.\n');
}
function encrypt(value) {
  if (!encryptionKey || encryptionKey.length !== 32) throw new Error('Server encryption is not configured. Set ENCRYPTION_KEY in server/.env.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
function decrypt(payload) {
  const [iv, tag, ciphertext] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

const dataDir = path.join(__dirname, '..', 'data');
import fs from 'node:fs';
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'registrations.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, encrypted_details TEXT NOT NULL
)`);
const insertRegistration = db.prepare('INSERT INTO registrations (id, created_at, encrypted_details) VALUES (?, ?, ?)');
const getAll = db.prepare('SELECT id, created_at, encrypted_details FROM registrations ORDER BY created_at DESC');
const getCount = db.prepare('SELECT COUNT(*) AS count FROM registrations');

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  email: z.string().trim().email().max(150),
  college: z.string().trim().min(2).max(120),
  consent: z.literal(true)
});
const sessions = new Map();
const newSession = () => {
  const token = crypto.randomBytes(18).toString('hex');
  sessions.set(token, { createdAt: Date.now(), used: false });
  return token;
};

function getLanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) {
    if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
  }
  return addresses;
}
function publicRegistration(row) {
  const details = JSON.parse(decrypt(row.encrypted_details));
  return { id: row.id, createdAt: row.created_at, ...details };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'MIRAI registration server', time: new Date().toISOString() }));
app.get('/api/network', (_req, res) => res.json({ port: PORT, addresses: getLanAddresses() }));
app.post('/api/session', async (req, res) => {
  const token = newSession();
  const base = req.body?.publicBaseUrl;
  if (typeof base !== 'string' || !/^https?:\/\//.test(base)) return res.status(400).json({ error: 'Provide the tablet-accessible publicBaseUrl.' });
  const registrationUrl = `${base.replace(/\/$/, '')}/register/${token}`;
  const qrDataUrl = await QRCode.toDataURL(registrationUrl, { width: 320, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#06221c', light: '#ffffff' } });
  res.json({ token, registrationUrl, qrDataUrl, expiresInMinutes: 60 });
});
app.post('/api/register/:token', (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session || session.used || Date.now() - session.createdAt > 60 * 60 * 1000) return res.status(410).json({ error: 'This QR code has expired. Please scan the new QR code on the robot.' });
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Please check your details.' });
  try {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const details = parsed.data;
    insertRegistration.run(id, createdAt, encrypt(JSON.stringify(details)));
    session.used = true;
    const record = { id, createdAt, ...details };
    io.emit('registration:new', record);
    io.emit('registration:count', getCount.get().count);
    io.emit('robot:registered', { message: 'Thank you for registering!' });
    res.status(201).json({ ok: true, message: 'Thank you for registering! Enjoy your goodies.' });
  } catch (error) {
    console.error('Registration save failed:', error.message);
    res.status(500).json({ error: error.message.includes('encryption') ? error.message : 'Could not save registration. Please try again.' });
  }
});
app.get('/api/registrations', (_req, res) => {
  try { res.json({ count: getCount.get().count, registrations: getAll.all().map(publicRegistration) }); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Unable to read registrations.' }); }
});
app.get('/api/export.csv', (_req, res) => {
  try {
    const rows = getAll.all().map(publicRegistration);
    const fields = ['id', 'createdAt', 'name', 'phone', 'email', 'college'];
    const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const csv = [fields.join(','), ...rows.map(r => fields.map(f => quote(r[f])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mirai-registrations.csv"');
    res.send('\ufeff' + csv);
  } catch (error) { res.status(500).json({ error: 'Export failed.' }); }
});

io.on('connection', socket => {
  socket.emit('registration:count', getCount.get().count);
  socket.on('robot:state', state => {
    if (['idle', 'speaking', 'qr', 'happy'].includes(state)) socket.broadcast.emit('robot:state', state);
  });
});

const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nMIRAI server running: http://localhost:${PORT}`);
  console.log(`LAN addresses: ${getLanAddresses().map(ip => `http://${ip}:${PORT}`).join(' | ') || 'Connect laptop to Wi-Fi first'}`);
  console.log(`Tablet Vite dev URL: http://<LAPTOP-IP>:5173\n`);
});
