const path = require("path");
const fs = require("fs");
const { connect } = require("./src/connection");
const { load } = require("./src/loader");
const { badMacHandler } = require("./src/utils/badMacHandler");
const {
  successLog,
  errorLog,
  bannerLog,
  infoLog,
  warningLog,
} = require("./src/utils/logger");
const { startTyCSystem } = require("./src/utils/newstyc");
const { loadJSONFolder, startAutoSave } = require("./src/utils/jsoncache");
const startCleaner = require("./cleaner.js");

// ----------------------------
// CACHE GLOBAL DE GRUPOS
// ----------------------------
global.GROUP_CACHE = global.GROUP_CACHE || {};
const MAX_GROUP_CACHE = 300;

global.IDROPS = global.IDROPS || [];
global.TEMP_QUEUE = global.TEMP_QUEUE || [];
global.EVENT_QUEUE = global.EVENT_QUEUE || [];
global.LOGS = global.LOGS || [];

startCleaner(global, {
  IDROPS: global.IDROPS,
  TEMP_QUEUE: global.TEMP_QUEUE,
  EVENT_QUEUE: global.EVENT_QUEUE,
  LOGS: global.LOGS,
});

let socketGlobal;
let reconnecting = false;

// ----------------------------
// 🔥 WATCHDOG GLOBAL
// ----------------------------
let disconnectTimer = null;
let watchdogInterval = null;
let disconnectStartTime = null;

const WATCHDOG_TIMEOUT = 120000;
const CHECK_INTERVAL = 20000;

// ----------------------------
// FUNCION CACHEAR METADATA
// ----------------------------
async function cacheGroupMetadata(socket, jid) {
  try {
    const metadata = await socket.groupMetadata(jid);

    if (Object.keys(global.GROUP_CACHE).length > MAX_GROUP_CACHE) {
      const firstKey = Object.keys(global.GROUP_CACHE)[0];
      delete global.GROUP_CACHE[firstKey];
    }

    global.GROUP_CACHE[jid] = {
      admins: metadata.participants
        .filter(p => p.admin)
        .map(p => p.id),
      participants: metadata.participants.length,
      time: Date.now()
    };

  } catch {}
}

// ----------------------------
// Manejo global de errores
// ----------------------------
process.on("uncaughtException", (error) => {
  if (badMacHandler.handleError(error, "uncaughtException")) return;
  errorLog(`Error crítico no capturado: ${error.message}`);
  errorLog(error.stack);
  if (!error.message.includes("ENOTFOUND") && !error.message.includes("timeout"))
    process.exit(1);
});

process.on("unhandledRejection", () => {});

// ----------------------------
// 🔥 WATCHDOG
// ----------------------------
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

function initWatchdog() {
  if (!socketGlobal) return;

  // 🔥 MATAR TODO lo de connection.js
  socketGlobal.ev.removeAllListeners("connection.update");

  socketGlobal.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      clearWatchdog();
      successLog("✅ Conectado → watchdog detenido");
      return;
    }

    if (connection === "close" || lastDisconnect?.error) {

      if (!disconnectTimer) {
        warningLog("⚠️ Bot desconectado, iniciando watchdog...");

        disconnectStartTime = Date.now();

        disconnectTimer = setTimeout(() => {
          if (!isSocketAlive()) {
            warningLog("💀 Sigue desconectado → reiniciando...");
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

      handleReconnect(lastDisconnect?.error?.output?.statusCode || connection);
    }
  });
}

// ----------------------------
// Reconexión controlada
// ----------------------------
async function handleReconnect(reason) {
  if (reconnecting) return;

  reconnecting = true;

  infoLog(`⚠️ Reconexión iniciada por: ${reason}`);

  try {
    await new Promise((r) => setTimeout(r, 30000));

    const newSocket = await connect();
    socketGlobal = newSocket;
    load(socketGlobal);

    if (socketGlobal?.ws) {
      socketGlobal.ws.on("close", () => handleReconnect("Connection closed"));
    }

    // 🔥 MATAR listeners otra vez
    socketGlobal.ev.removeAllListeners("connection.update");

    // 🔥 SOLO CONFIRMAR reconexión REAL
    socketGlobal.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      // ✅ SOLO AQUÍ ES REAL
      if (connection === "open") {
        clearWatchdog(); // 🔥 ahora sí es válido
        successLog("✅ Reconexión exitosa");
        reconnecting = false;
        return;
      }

      if (connection === "close" || connection === "error" || lastDisconnect?.error) {
        const code = lastDisconnect?.error?.output?.statusCode || connection;
        infoLog(`⚠️ connection.update detectó desconexión: ${code}`);
        handleReconnect(code);
      }
    });

    socketGlobal.ev.on("group-participants.update", async (update) => {
      await cacheGroupMetadata(socketGlobal, update.id);
    });

    // 🔥 watchdog limpio pero NO se limpia solo
    initWatchdog();

  } catch (err) {
    errorLog("❌ Reconexión fallida");
    reconnecting = false;
  }
}


// ----------------------------
// MAIN
// ----------------------------
async function startBot() {
  try {

    await loadJSONFolder(path.join(__dirname, "database"));
    await loadJSONFolder(path.join(__dirname, "src/database"));
    startAutoSave(60000);

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    process.setMaxListeners(1500);

    bannerLog();
    infoLog("Iniciando mis componentes internos...");

    async function initSocket() {
      try {
        const socket = await connect();
        socketGlobal = socket;
        load(socketGlobal);

        if (socketGlobal?.ws) {
          socketGlobal.ws.on("close", () => handleReconnect("Connection closed"));
        }

        // 🔥 MATAR connection.js desde el inicio
        socketGlobal.ev.removeAllListeners("connection.update");

        socketGlobal.ev.on("connection.update", (update) => {
          const { connection, lastDisconnect } = update;

          if (connection === "close" || connection === "error" || lastDisconnect?.error) {
            const code = lastDisconnect?.error?.output?.statusCode || connection;
            infoLog(`⚠️ connection.update detectó desconexión: ${code}`);
            handleReconnect(code);
          }
        });

        socketGlobal.ev.on("messages.upsert", async ({ messages }) => {
          const msg = messages?.[0];
          const jid = msg?.key?.remoteJid;

          if (jid && jid.endsWith("@g.us") && !global.GROUP_CACHE[jid]) {
            await cacheGroupMetadata(socketGlobal, jid);
          }
        });

        initWatchdog();

        setTimeout(() => startTyCSystem(socketGlobal), 10000);
        setTimeout(() => require("./src/commands/member/rpg.js"), 10000);
        setTimeout(() => {require("./yt-dlp-update")();}, 10000);

        successLog("✅ Bot conectado y listo.");
      } catch {
        setTimeout(initSocket, 5000);
      }
    }

    await initSocket();
// ✅ RECONEXIÓN Y LECTURA PASIVA (index.js)
setInterval(() => {
  if (socketGlobal && socketGlobal.ws && socketGlobal.ws.readyState === 1) {
    try {
      // PING pasivo nativo de WebSocket para mantener el canal abierto
      if (typeof socketGlobal.sendPing === "function") {
        socketGlobal.sendPing();
      } else if (socketGlobal.ws.ping) {
        socketGlobal.ws.ping();
      }
    } catch {}
  }
}, 45000); // ⚡ Cada 45 segundos es un tiempo seguro que Meta no detecta como spam



    setInterval(() => {
      const currentStats = badMacHandler.getStats();
      if (currentStats.errorCount > 0) {
        infoLog(`Estadísticas de BadMacHandler: ${currentStats.errorCount}/${currentStats.maxRetries} errores`);
      }
    }, 300000);

    setInterval(() => infoLog("🔄 Manteniendo sesión activa"), 30000);

  } catch (error) {
    if (badMacHandler.handleError(error, "bot-startup")) {
      setTimeout(startBot, 5000);
      return;
    }

    errorLog(`Error al iniciar el bot: ${error.message}`);
    errorLog(error.stack);
    process.exit(1);
  }
}

startBot();

