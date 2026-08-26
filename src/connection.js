/**
 * Inicialización del bot con QR
 * Conexión estable usando Baileys con Watchdog y Reconexión Controlada
 */
const path = require("node:path");
const fs = require("node:fs");
const pino = require("pino");
const NodeCache = require("node-cache");
const qrcode = require("qrcode-terminal");

const { load } = require("./loader");
const {
  infoLog,
  warningLog,
  errorLog,
  successLog,
  sayLog,
} = require("./utils/logger");

const { TEMP_DIR } = require("./config");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const logger = pino({ level: "silent" });

const msgRetryCounterCache = new NodeCache();
const groupCache = new NodeCache({ stdTTL: 60 * 60 * 24 });

let socketGlobal = null;
let reconnecting = false;

// ----------------------------
// 🔥 WATCHDOG GLOBAL
// ----------------------------
let disconnectTimer = null;
let watchdogInterval = null;
let disconnectStartTime = null;

const WATCHDOG_TIMEOUT = 60000;
const CHECK_INTERVAL = 10000;

const MAX_GROUP_CACHE = 300;

function isSocketAlive() {
  try {
    return socketGlobal?.ws?.readyState === 1;
  } catch {
    return false;
  }
}

function clearWatchdog() {
  if (disconnectTimer) clearTimeout(disconnectTimer);
  if (watchdogInterval) clearInterval(watchdogInterval);

  disconnectTimer = null;
  watchdogInterval = null;
  disconnectStartTime = null;
}

function startWatchdog() {
  if (disconnectTimer) return;

  warningLog("⚠️ Bot desconectado, iniciando watchdog...");
  disconnectStartTime = Date.now();

  disconnectTimer = setTimeout(() => {
    if (!isSocketAlive()) {
      warningLog("💀 Sigue desconectado tras 60s → reiniciando proceso...");
      process.exit(1);
    }
  }, WATCHDOG_TIMEOUT);

  watchdogInterval = setInterval(() => {
    if (isSocketAlive()) {
      clearWatchdog();
      infoLog("🧠 Reconectado detectado → watchdog cancelado");
      return;
    }

    const elapsed = Date.now() - disconnectStartTime;
    const remaining = Math.max(0, WATCHDOG_TIMEOUT - elapsed);
    const secondsLeft = Math.floor(remaining / 1000);

    warningLog(`⏳ Sigue desconectado... reinicio en ${secondsLeft}s`);
  }, CHECK_INTERVAL);
}

// ----------------------------
// FUNCION CACHEAR METADATA
// ----------------------------
async function cacheGroupMetadata(socket, jid) {
  try {
    const metadata = await socket.groupMetadata(jid);

    if (global.GROUP_CACHE && Object.keys(global.GROUP_CACHE).length > MAX_GROUP_CACHE) {
      const firstKey = Object.keys(global.GROUP_CACHE)[0];
      delete global.GROUP_CACHE[firstKey];
    }

    if (global.GROUP_CACHE) {
      global.GROUP_CACHE[jid] = {
        admins: metadata.participants
          .filter(p => p.admin)
          .map(p => p.id),
        participants: metadata.participants.length,
        time: Date.now()
      };
    }
  } catch {}
}

// ----------------------------
// Reconexión controlada
// ----------------------------
async function handleReconnect(reason) {
  if (reconnecting) return;
  reconnecting = true;

  startWatchdog();
  infoLog(`⚠️ Reconexión iniciada por: ${reason}`);

  try {
    // Destruir socket viejo de forma limpia si aún existe
    if (socketGlobal) {
      try {
        socketGlobal.ev.removeAllListeners("connection.update");
        socketGlobal.ev.removeAllListeners("messages.upsert");
        socketGlobal.ws?.close();
      } catch {}
    }

    await new Promise((r) => setTimeout(r, 3000)); // Espera 3s

    await connect();
    reconnecting = false;

  } catch (err) {
    errorLog(`❌ Reconexión fallida: ${err.message}`);
    reconnecting = false;
    // En cortes prolongados o microcortes repetidos, forzar reintento
    setTimeout(() => handleReconnect("Reintento tras error de red"), 3000);
  }
}

async function connect() {
  const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    isJidStatusBroadcast,
    isJidNewsletter,
  } = await import("@whiskeysockets/baileys");

  const authPath = path.resolve(__dirname, "..", "assets", "auth", "baileys");

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    msgRetryCounterCache,
    keepAliveIntervalMs: 20000,
    connectTimeoutMs: 20000,
    defaultQueryTimeoutMs: undefined,
    options: {
      timeout: 30000,
    },
    shouldIgnoreJid: (jid) =>
      isJidBroadcast(jid) ||
      isJidStatusBroadcast(jid) ||
      isJidNewsletter(jid),
  });

  socketGlobal = socket;

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== undefined) return;

    for (const msg of messages) {
      if (!msg.key || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      const participant = msg.key.participant ?? null;

      try {
        await socket.sendReceipt(jid, participant, [msg.key.id], "read");

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          "";

        if (!text.startsWith(".")) continue;

        socket.sendPresenceUpdate("composing", jid).then(() => {
          setTimeout(() => {
            socket.sendPresenceUpdate("paused", jid).catch(() => {});
          }, 2000);
        }).catch(() => {});

        if (jid && jid.endsWith("@g.us") && global.GROUP_CACHE && !global.GROUP_CACHE[jid]) {
          await cacheGroupMetadata(socket, jid);
        }

      } catch (err) {
        warningLog("Error enviando visto:", err.message);
      }
    }
  });

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sayLog("Escaneá este QR con WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      clearWatchdog();
      reconnecting = false;
      successLog("✅ ¡Conectado correctamente a WhatsApp!");
      infoLog("WhatsApp Web versión: " + version.join("."));
      infoLog("¿Última versión?: " + (isLatest ? "Sí" : "No"));
      load(socket);
      return;
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      warningLog("Conexión cerrada. Motivo: " + reason);

      if (reason === DisconnectReason.loggedOut) {
        errorLog("Sesión cerrada. Borra la carpeta auth y vuelve a escanear QR.");
        process.exit(1);
      } else {
        handleReconnect(reason || connection);
      }
    }
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("group-participants.update", async (update) => {
    await cacheGroupMetadata(socket, update.id);
  });

  return socket;
}

exports.connect = connect;



