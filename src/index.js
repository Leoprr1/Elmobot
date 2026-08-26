const { connect } = require("./connection");
const { badMacHandler } = require("./utils/badMacHandler");
const {
  errorLog,
  warningLog,
  bannerLog,
  infoLog,
} = require("./utils/logger");

// ----------------------------
// MANEJO GLOBAL DE ERRORES
// ----------------------------
process.on("uncaughtException", (error) => {
  if (badMacHandler.handleError(error, "uncaughtException")) {
    return;
  }

  errorLog(`Error crítico no capturado: ${error.message}`);
  errorLog(error.stack);

  if (
    !error.message.includes("ENOTFOUND") &&
    !error.message.includes("timeout")
  ) {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  if (badMacHandler.handleError(reason, "unhandledRejection")) {
    return;
  }

  errorLog(`Promesa rechazada no manejada:`, reason);
});

// ----------------------------
// INICIO MANUAL DE CONSOLA (npm start)
// ----------------------------
async function startBot() {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    process.setMaxListeners(1500);

    bannerLog();
    infoLog("Iniciando bot en modo consola (src/index.js)...");

    const stats = badMacHandler.getStats();
    if (stats.errorCount > 0) {
      warningLog(
        `Estadísticas de BadMacHandler: ${stats.errorCount}/${stats.maxRetries} errores`
      );
    }

    // `connect()` se encarga de crear el socket y llamar a load(socket) automáticamente al abrir la conexión
    await connect();

    // Monitor periódico de BadMac
    setInterval(() => {
      const currentStats = badMacHandler.getStats();
      if (currentStats.errorCount > 0) {
        warningLog(
          `Estadísticas de BadMacHandler: ${currentStats.errorCount}/${currentStats.maxRetries} errores`
        );
      }
    }, 300_000);

  } catch (error) {
    if (badMacHandler.handleError(error, "bot-startup")) {
      warningLog(
        "Error de Bad MAC durante la inicialización, reintentando en 5s..."
      );

      setTimeout(() => {
        startBot();
      }, 5000);
      return;
    }

    errorLog(`Error al iniciar el bot: ${error.message}`);
    errorLog(error.stack);
    process.exit(1);
  }
}

startBot();


