const path = require("path");
const fs = require("fs");
const { connect } = require("./src/connection");
const { badMacHandler } = require("./src/utils/badMacHandler");
const {
  successLog,
  errorLog,
  bannerLog,
  infoLog,
} = require("./src/utils/logger");
const { startTyCSystem } = require("./src/utils/newstyc");
const { loadJSONFolder, startAutoSave } = require("./src/utils/jsoncache");
const startCleaner = require("./cleaner.js");

// ----------------------------
// CACHE GLOBAL DE GRUPOS
// ----------------------------
global.GROUP_CACHE = global.GROUP_CACHE || {};

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
        // Llama a connect() y deja que connection.js tome el control de las reconexiones
        socketGlobal = await connect();

        setTimeout(() => startTyCSystem(socketGlobal), 10000);
        setTimeout(() => require("./src/commands/member/rpg.js"), 10000);
        setTimeout(() => { require("./yt-dlp-update")(); }, 10000);

        successLog("✅ Bot iniciado y listo.");
      } catch (err) {
        errorLog(`Error al inicializar socket: ${err.message}`);
        setTimeout(initSocket, 5000);
      }
    }

    await initSocket();

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




