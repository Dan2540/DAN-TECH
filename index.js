import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { createClient } from '@supabase/supabase-js';
import AdmZip from 'adm-zip';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OWNER_NUMBER = '254791583238'; // Your number without +
const BOT_NAME = 'Nyahure.Ke';
const PREFIX = '.';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SESSION_TABLE = 'bu_sessions';
const SESSION_ID = 'default';
const SESSION_FOLDER = './session';
let lastSave = 0;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.json({ status: 'online', bot: BOT_NAME, uptime: process.uptime() });
});

app.get('/pair.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

async function saveSession() {
  if (Date.now() - lastSave < 120000) return; 
  if (!fs.existsSync(SESSION_FOLDER)) return;
  
  const zip = new AdmZip();
  zip.addLocalFolder(SESSION_FOLDER);
  const buffer = zip.toBuffer();
  
  const { error } = await supabase.from(SESSION_TABLE).upsert({
    id: SESSION_ID,
    data: buffer.toString('base64')
  });
  
  if (!error) {
    lastSave = Date.now();
    console.log('✅ Session saved to Supabase');
  }
}

async function loadSession() {
  const { data } = await supabase.from(SESSION_TABLE).select('data').eq('id', SESSION_ID).single();
  if (data && data.data) {
    const zip = new AdmZip(Buffer.from(data.data, 'base64'));
    zip.extractAllTo(SESSION_FOLDER, true);
    console.log('✅ Session loaded from Supabase');
  }
}

async function startBot() {
  await loadSession();
  
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    syncFullHistory: false,
    fireInitQueries: false,
    browser: [BOT_NAME, 'Chrome', '20.11.1']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) io.emit('qr', qr);
    
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        console.log('❌ Logged out');
        process.exit();
      }
      if (lastDisconnect?.error?.message?.includes('conflict')) {
        console.log('❌ Stream Errored conflict. Stopping bot to prevent duplicate sessions');
        process.exit();
      }
      console.log('🔄 Reconnecting...');
      startBot();
    }
    
    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp');
      io.emit('connected', true);
      await sock.sendMessage(OWNER_NUMBER + '@s.whatsapp.net', { 
        text: `✅ ${BOT_NAME} is now online!\nPrefix: ${PREFIX}` 
      });
    }
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await saveSession();
  });

  sock.ev.on('messages.up', async (m) => {
    // Command handling will go here via router.js
  });
}

startBot();

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
