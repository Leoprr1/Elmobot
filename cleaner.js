// cleaner.js - Ultra Optimización de RAM + Limpieza de Archivos Temporales

const fs = require("fs");
const path = require("path");
const v8 = require("v8");
const { infoLog, warningLog } = require("./src/utils/logger");
const { TEMP_DIR } = require("./src/config"); // Asegúrate que la ruta sea correcta a tu config

const NORMAL_INTERVAL = 15_000;
const DEEP_CLEAN_INTERVAL = 1 * 60 * 1000;

// Detección de límite de memoria RAM
const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
const MEMORY_THRESHOLD_MB = Math.round(heapLimitMB * 0.20) || 400; 
const MEMORY_CRITICAL_MB = Math.round(heapLimitMB * 0.50) || 800;

let lastGC = 0;

module.exports = function (botGlobal, queues = {}) {
  const { IDROPS, TEMP_QUEUE, EVENT_QUEUE, LOGS } = queues;

  // -----------------------------
  // 1. RECOLECTOR DE BASURA (GC)
  // -----------------------------
  function runGC(force = false) {
    if (!global.gc) return;

    const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const now = Date.now();

    if (!force && memUsageMB < MEMORY_THRESHOLD_MB) return;
    if (!force && (now - lastGC < 10_000)) return;

    const before = process.memoryUsage().heapUsed;
    global.gc();
    const after = process.memoryUsage().heapUsed;

    lastGC = now;
    const freed = ((before - after) / 1024 / 1024).toFixed(2);
    if (parseFloat(freed) > 1.0) {
      console.log(`[CLEANER] 🧹 GC ejecutado | ${freed} MB liberados | RAM Heap actual: ${(after / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  // -----------------------------
  // 2. LIMPIEZA DE CARPETA TEMP DISCO/RAM
  // -----------------------------
  function cleanTempFiles() {
    try {
      if (!TEMP_DIR || !fs.existsSync(TEMP_DIR)) return;

      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      let deletedCount = 0;

      for (const file of files) {
        // Ignora archivos ocultos o de sistema
        if (file.startsWith(".")) continue;

        const filePath = path.join(TEMP_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          // Si el archivo temporal tiene más de 2 minutos de creado, se elimina
          if (now - stats.mtimeMs > 2 * 60 * 1000) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {}
      }

      if (deletedCount > 0) {
        infoLog(`[CLEANER] 🗑️ ${deletedCount} archivos temporales residuales borrados.`);
      }
    } catch (err) {
      warningLog("Error al limpiar archivos temporales:", err.message);
    }
  }

  // -----------------------------
  // 3. LIMPIEZA DE CACHÉ INTERNA
  // -----------------------------
  function cleanCaches() {
    try {
      // Limpia caché interna de grupos si supera los 200 ítems
      if (global.GROUP_CACHE && typeof global.GROUP_CACHE === "object") {
        const keys = Object.keys(global.GROUP_CACHE);
        if (keys.length > 200) {
          // Conserva solo los últimos 100
          keys.slice(0, keys.length - 100).forEach(key => delete global.GROUP_CACHE[key]);
        }
      }
    } catch (err) {
      warningLog("Error limpiando caché de grupos:", err.message);
    }
  }

  // -----------------------------
  // 4. LIMPIEZA REGULAR
  // -----------------------------
  function cleanMemory() {
    try {
      const now = Date.now();

      // Limpia arreglos de colas
      if (Array.isArray(IDROPS) && IDROPS.length > 0) {
        for (let i = IDROPS.length - 1; i >= 0; i--) {
          if (now - (IDROPS[i].creado || now) > 3000) {
            IDROPS.splice(i, 1);
          }
        }
      }

      if (Array.isArray(TEMP_QUEUE) && TEMP_QUEUE.length > 20) TEMP_QUEUE.length = 0;
      if (Array.isArray(EVENT_QUEUE) && EVENT_QUEUE.length > 20) EVENT_QUEUE.length = 0;
      if (Array.isArray(LOGS) && LOGS.length > 200) LOGS.splice(0, LOGS.length - 100);

      cleanCaches();
      cleanTempFiles();
      runGC();

    } catch (err) {
      warningLog("Error en limpieza regular:", err.message);
    }
  }

  // -----------------------------
  // 5. DEEP CLEAN & MEMORIA CRÍTICA
  // -----------------------------
  function deepClean() {
    try {
      if (Array.isArray(IDROPS)) IDROPS.length = 0;
      if (Array.isArray(TEMP_QUEUE)) TEMP_QUEUE.length = 0;
      if (Array.isArray(EVENT_QUEUE)) EVENT_QUEUE.length = 0;
      if (Array.isArray(LOGS) && LOGS.length > 50) LOGS.splice(0, LOGS.length - 50);

      cleanCaches();
      cleanTempFiles();
      runGC(true); // Fuerza recolección profunda

    } catch (err) {
      warningLog("Error en Deep Clean:", err.message);
    }
  }

  function checkMemoryPressure() {
    try {
      const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;

      if (memUsageMB > MEMORY_CRITICAL_MB) {
        warningLog(`🚨 RAM Crítica detectada (${memUsageMB.toFixed(2)} MB / ${heapLimitMB} MB). Forzando vaciado...`);

        if (Array.isArray(IDROPS)) IDROPS.length = 0;
        if (Array.isArray(TEMP_QUEUE)) TEMP_QUEUE.length = 0;
        if (Array.isArray(EVENT_QUEUE)) EVENT_QUEUE.length = 0;
        if (Array.isArray(LOGS)) LOGS.length = 0;

        if (global.GROUP_CACHE) global.GROUP_CACHE = {};

        runGC(true);
      }
    } catch (err) {
      warningLog("Error chequeando presión de memoria:", err.message);
    }
  }

  // -----------------------------
  // CRONOGRAMA Y TEMPORIZADORES
  // -----------------------------
  setInterval(() => {
    cleanMemory();
    checkMemoryPressure();
  }, NORMAL_INTERVAL);

  setInterval(deepClean, DEEP_CLEAN_INTERVAL);

  setInterval(() => {
    const mem = process.memoryUsage();
    const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const rss = (mem.rss / 1024 / 1024).toFixed(2);
    infoLog(`🧹 [ESTADO RAM] Heap: ${heapUsed} MB | RSS Total: ${rss} MB / Límite: ${heapLimitMB} MB`);
  }, 120_000);

  infoLog(`🚀 Ultra Cleaner activado (Tope asignado: ${heapLimitMB} MB | Umbral Alerta: ${MEMORY_THRESHOLD_MB} MB)`);
};


