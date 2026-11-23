import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { CheckCircle2, Download, Users, Wifi, ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}:4000`;
const PUBLIC_BASE = import.meta.env.VITE_PUBLIC_BASE_URL || location.origin;
const socket = io(API, { autoConnect: true, reconnection: true });

function speak(text, onEnd) {
  if (!('speechSynthesis' in window)) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.92; utterance.pitch = 1.12; utterance.volume = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /Google UK English Female|Samantha|Microsoft Zira|female/i.test(v.name)) || voices.find(v => v.lang?.startsWith('en'));
  if (preferred) utterance.voice = preferred;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

function RobotFace({ expression = 'idle', onClick, compact = false }) {
  return <button type="button" className={`robot-face ${expression} ${compact ? 'compact' : ''}`} onClick={onClick} aria-label="Tap the robot to begin">
    <div className="brow brow-left"/><div className="brow brow-right"/>
    <div className="eyes">
      <div className="eye"><div className="pupil"><i/><b/></div></div>
      <div className="eye"><div className="pupil"><i/><b/></div></div>
    </div>
    <div className="mouth"><span/></div>
  </button>;
}

function RobotScreen() {
  const [state, setState] = useState('idle');
  const [qr, setQr] = useState(null);
  const [message, setMessage] = useState('Tap anywhere on my face to get started');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const timer = useRef(null);
  useEffect(() => {
    socket.on('registration:count', setCount);
    socket.on('robot:registered', () => {
      clearTimeout(timer.current); setState('happy'); setQr(null); setMessage('Thank you for registering! Enjoy your goodies 🎁');
      speak('Thank you for registering! Your registration is complete. Enjoy your goodies!', () => setTimeout(() => { setState('idle'); setMessage('Tap anywhere on my face to get started'); }, 4500));
    });
    return () => { socket.off('registration:count', setCount); socket.off('robot:registered'); };
  }, []);
  const start = async () => {
    if (busy || state === 'happy') return;
    setBusy(true); setQr(null); setState('speaking'); setMessage('Hello! Welcome. Scan this QR code to register and claim your goodies!');
    socket.emit('robot:state', 'speaking');
    speak('Hello! Welcome. Scan this QR code to register and claim your goodies!', async () => {
      try {
        const response = await fetch(`${API}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicBaseUrl: PUBLIC_BASE }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not create QR code');
        setQr(data); setState('qr'); setMessage('Scan me to register and claim your goodies!'); socket.emit('robot:state', 'qr');
      } catch (e) { setMessage(`${e.message}. Please check the laptop server and Wi-Fi.`); setState('idle'); }
      finally { setBusy(false); }
    });
  };
  return <main className="robot-page">
    <div className="topline"><span className="brand-dot"/> MIRAI <span className="top-sub">WELCOME ASSISTANT</span><span className="online"><i/> SYSTEM ONLINE</span></div>
    <section className="robot-stage">
      <div className="face-wrap"><RobotFace expression={state} onClick={start}/></div>
      <div className="speech-card"><span className="wave">✦</span><p>{message}</p></div>
      {qr && <div className="qr-panel"><div className="qr-copy"><strong>SCAN TO REGISTER</strong><span>Open your camera and scan this code</span></div><img src={qr.qrDataUrl} alt="Registration QR code"/><small>QR expires in 60 minutes</small></div>}
      <div className="tap-hint">{state === 'idle' ? 'TAP MY FACE' : state === 'qr' ? 'WAITING FOR YOUR REGISTRATION' : state === 'happy' ? 'REGISTRATION COMPLETE' : 'LISTENING…'}</div>
    </section>
    <footer className="robot-footer"><span><Users size={15}/> {count} registrations</span><span><Wifi size={15}/> Connected to laptop server</span><span>POWERED BY MIRAI</span></footer>
  </main>;
}

function RegisterPage() {
  const token = location.pathname.split('/').filter(Boolean).at(-1);
  const [form, setForm] = useState({ name: '', phone: '', email: '', college: '', consent: false });
  const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const update = e => setForm(f => ({ ...f, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async e => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Registration failed'); setStatus(data.message);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  if (status) return <main className="form-page"><section className="success-card"><div className="success-icon"><CheckCircle2 size={54}/></div><h1>You're registered!</h1><p>Thank you for registering. Your details have been securely saved.</p><div className="goodies">🎁 Enjoy your goodies!</div><small>You can now return to the welcome robot.</small></section></main>;
  return <main className="form-page"><form className="registration-card" onSubmit={submit}>
    <div className="form-brand"><span className="brand-dot"/> MIRAI <span>GOODIES REGISTRATION</span></div>
    <div className="form-icon"><Sparkles size={25}/></div><h1>Claim your goodies</h1><p className="form-intro">Enter your details below to complete your event registration.</p>
    <label>Full name<input name="name" value={form.name} onChange={update} placeholder="e.g. Alex Johnson" minLength="2" maxLength="80" required/></label>
    <label>Phone number<input name="phone" value={form.phone} onChange={update} placeholder="10-digit mobile number" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength="10" required/><small>Use a valid Indian mobile number.</small></label>
    <label>Email address<input name="email" type="email" value={form.email} onChange={update} placeholder="you@example.com" maxLength="150" required/></label>
    <label>College / Organization<input name="college" value={form.college} onChange={update} placeholder="Enter your college or organization" minLength="2" maxLength="120" required/></label>
    <label className="consent"><input type="checkbox" name="consent" checked={form.consent} onChange={update} required/><span>I agree to submit these details for event registration and goodies collection.</span></label>
    {error && <div className="error-msg">{error}</div>}
    <button className="submit-btn" disabled={loading}>{loading ? 'Submitting…' : 'Complete registration'} <span>→</span></button>
    <div className="secure-note"><ShieldCheck size={15}/> Your details are encrypted before storage.</div>
  </form></main>;
}

function AdminPage() {
  const [rows, setRows] = useState([]); const [connected, setConnected] = useState(socket.connected);
  const load = async () => { try { const r = await fetch(`${API}/api/registrations`); const d = await r.json(); setRows(d.registrations || []); } catch {} };
  useEffect(() => { load(); const onNew = row => setRows(old => [row, ...old]); const onConnect = () => setConnected(true); const onDisconnect = () => setConnected(false); socket.on('registration:new', onNew); socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); return () => { socket.off('registration:new', onNew); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); }; }, []);
  return <main className="admin-page"><header className="admin-header"><div><div className="form-brand"><span className="brand-dot"/> MIRAI <span>ADMIN CONSOLE</span></div><h1>Live registrations</h1><p>Visitor details received from the tablet registration page.</p></div><div className={`connection ${connected ? 'connected' : ''}`}><i/>{connected ? 'LIVE' : 'RECONNECTING'}</div></header>
    <section className="stats"><div><Users/><span>Total registrations</span><strong>{rows.length}</strong></div><div><Wifi/><span>Live connection</span><strong>{connected ? 'Connected' : 'Offline'}</strong></div></section>
    <div className="table-head"><h2>Registered visitors</h2><a href={`${API}/api/export.csv`}><Download size={16}/> Export CSV</a></div>
    <div className="table-wrap"><table><thead><tr><th>NAME</th><th>PHONE</th><th>EMAIL</th><th>COLLEGE / ORGANIZATION</th><th>TIME</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.phone}</td><td>{r.email}</td><td>{r.college}</td><td>{new Date(r.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{!rows.length && <div className="empty">No registrations yet. Scan the robot QR code to test the flow.</div>}</div>
  </main>;
}

function App() {
  const path = location.pathname;
  if (path.startsWith('/register/')) return <RegisterPage/>;
  if (path === '/admin') return <AdminPage/>;
  return <RobotScreen/>;
}

createRoot(document.getElementById('root')).render(<App/>);
