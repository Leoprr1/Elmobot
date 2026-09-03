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

// Expira llaves a los 5 minutos y las borra de la RAM automáticamente
const msgRetryCounterCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

let socketGlobal = null;
let reconnecting = false;
let isShuttingDown = false; // ⚡ Flag para prevenir reconexiones si se apaga el proceso

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
  if (disconnectTimer || isShuttingDown) return;

  warningLog("⚠️ Bot desconectado, iniciando watchdog...");
  disconnectStartTime = Date.now();

  disconnectTimer = setTimeout(() => {
    if (!isSocketAlive() && !isShuttingDown) {
      warningLog("💀 Sigue desconectado tras 60s → reiniciando proceso...");
      terminateProcess(1);
    }
  }, WATCHDOG_TIMEOUT);

  watchdogInterval = setInterval(() => {
    if (isSocketAlive()) {
      clearWatchdog();
      infoLog("🧠 Reconectado detectado → watchdog cancelado");
      return;
    }

    if (isShuttingDown) return;

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
// DESTRUCCIÓN DE SOCKET Y SUBPROCESOS
// ----------------------------
function destroyActiveSocket() {
  if (socketGlobal) {
    try {
      socketGlobal.ev.removeAllListeners();
      if (socketGlobal.ws) {
        socketGlobal.ws.close();
      }
      if (typeof socketGlobal.end === "function") {
        socketGlobal.end(new Error("Conexión finalizada"));
      }
    } catch {}
    socketGlobal = null;
    global.socketGlobal = null;
  }
}

function terminateProcess(code = 0) {
  if (isShuttingDown && code === 0) return;
  isShuttingDown = true;

  clearWatchdog();
  destroyActiveSocket();

  // Forzar la salida limpia e inmediata
  setTimeout(() => {
    process.exit(code);
  }, 100);
}

// ----------------------------
// Reconexión controlada
// ----------------------------
async function handleReconnect(reason) {
  if (reconnecting || isShuttingDown) return;
  reconnecting = true;

  startWatchdog();
  infoLog(`⚠️ Reconexión iniciada por: ${reason}`);

  try {
    destroyActiveSocket();

    await new Promise((r) => setTimeout(r, 3000)); // Espera 3s

    if (!isShuttingDown) {
      await connect();
    }
    reconnecting = false;

  } catch (err) {
    errorLog(`❌ Reconexión fallida: ${err.message}`);
    reconnecting = false;
    if (!isShuttingDown) {
      setTimeout(() => handleReconnect("Reintento tras error de red"), 3000);
    }
  }
}

async function connect() {
  if (isShuttingDown) return null;

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

  destroyActiveSocket();

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
  global.socketGlobal = socket;

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
      // Si el apagado fue iniciado voluntariamente por PM2 / sistema, ignorar eventos de reconexión
      if (isShuttingDown) return;

      const reason = lastDisconnect?.error?.output?.statusCode;
      warningLog("Conexión cerrada. Motivo: " + reason);

      if (reason === DisconnectReason.loggedOut) {
        errorLog("Sesión cerrada. Borra la carpeta auth y vuelve a escanear QR.");
        terminateProcess(1);
      } else if (reason === DisconnectReason.connectionReplaced || reason === 440) {
        // Si la conexión fue reemplazada, forzar matado total del proceso para evitar colisión de sockets
        errorLog("⚠️ Conexión duplicada (440). Reiniciando proceso completo...");
        terminateProcess(1);
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

// Intercepta las órdenes del sistema o PM2 para matar el proceso inmediatamente sin reintentos
process.on("SIGINT", () => terminateProcess(0));
process.on("SIGTERM", () => terminateProcess(0));
process.on("uncaughtException", (err) => {
  errorLog("Uncaught Exception:", err.message);
  terminateProcess(1);
});

exports.connect = connect;







