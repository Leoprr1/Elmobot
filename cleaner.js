// cleaner.js - Ultra Optimización de RAM + Limpieza Profunda de Sesión y Módulos

const fs = require("fs");
const path = require("path");
const v8 = require("v8");
const { infoLog, warningLog } = require("./src/utils/logger");
const { TEMP_DIR } = require("./src/config");

const NORMAL_INTERVAL = 15_000;
const DEEP_CLEAN_INTERVAL = 45 * 1000; // Cada 45s para mayor reactividad

const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
const MEMORY_THRESHOLD_MB = 220; // Forzar limpieza baja para no dejarlo subir a 400MB
const MEMORY_CRITICAL_MB = 350;

let lastGC = 0;

module.exports = function (botGlobal, queues = {}) {
  const { IDROPS, TEMP_QUEUE, EVENT_QUEUE, LOGS } = queues;

  // -----------------------------
  // 1. RECOLECTOR DE BASURA AGRESIVO (PASADA DOBLE)
  // -----------------------------
  function runGC(force = false) {
    if (!global.gc) return;

    const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const now = Date.now();

    if (!force && memUsageMB < MEMORY_THRESHOLD_MB) return;
    if (!force && (now - lastGC < 8_000)) return;

    const before = process.memoryUsage().heapUsed;

    // ⚡ Doble pasada de Garbage Collector: la 1ra marca los objetos huérfanos, la 2da los destruye del Old Space
    global.gc();
    global.gc();

    lastGC = now;
    const after = process.memoryUsage().heapUsed;
    const freed = ((before - after) / 1024 / 1024).toFixed(2);

    if (parseFloat(freed) > 0.5) {
      console.log(`[CLEANER] 🧹 GC Profundo ejecutado | ${freed} MB liberados | RAM Heap actual: ${(after / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  // -----------------------------
  // 2. PURGA INTERNA DE LA SESIÓN DE BAILEYS
  // -----------------------------
  function cleanBaileysSession() {
    try {
      const sock = global.socketGlobal;
      if (!sock) return;

      // Vacio de oyentes de eventos o historiales retenidos internamente por Baileys
      if (sock.store && typeof sock.store.reset === "function") {
        sock.store.reset();
      }

      // Vacia cache interna de llaves/mensajes si Baileys las acumula en el socket
      if (sock.msgRetryCounterCache && typeof sock.msgRetryCounterCache.flushAll === "function") {
        sock.msgRetryCounterCache.flushAll();
      }

      // Limpia emisores temporales si superan un límite seguro
      if (sock.ws && sock.ws._events) {
        if (Array.isArray(sock.ws._events.message) && sock.ws._events.message.length > 5) {
          sock.ws._events.message = sock.ws._events.message.slice(-2);
        }
      }
    } catch (err) {
      warningLog("Error en limpieza de sesión Baileys:", err.message);
    }
  }

  // -----------------------------
  // 3. PURGA DE REQUIRE.CACHE (JSONs CORTADOS)
  // -----------------------------
  function cleanRequireCache() {
    try {
      // Borra la caché de archivos JSON cargados dinámicamente para que no queden duplicados en RAM
      Object.keys(require.cache).forEach((key) => {
        if (key.endsWith(".json") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
      });
    } catch {}
  }

  // -----------------------------
  // 4. LIMPIEZA DE ARCHIVOS TEMPORALES
  // -----------------------------
  function cleanTempFiles() {
    try {
      if (!TEMP_DIR || !fs.existsSync(TEMP_DIR)) return;

      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();

      for (const file of files) {
        if (file.startsWith(".")) continue;

        const filePath = path.join(TEMP_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          // Reducido a 1 minuto de tolerancia
          if (now - stats.mtimeMs > 60 * 1000) {
            fs.unlinkSync(filePath);
          }
        } catch {}
      }
    } catch (err) {
      warningLog("Error al limpiar archivos temporales:", err.message);
    }
  }

  // -----------------------------
  // 5. CACHÉS GLOBALES Y ARRAYS
  // -----------------------------
  function cleanCaches() {
    try {
      if (global.GROUP_CACHE && typeof global.GROUP_CACHE === "object") {
        const keys = Object.keys(global.GROUP_CACHE);
        if (keys.length > 50) { // Reducido tope de 200 a 50 para liberar RAM de la sesión
          keys.slice(0, keys.length - 20).forEach((key) => delete global.GROUP_CACHE[key]);
        }
      }
    } catch (err) {
      warningLog("Error limpiando caché de grupos:", err.message);
    }
  }

  // -----------------------------
  // BUCLES DE EJECUCIÓN
  // -----------------------------
  function cleanMemory() {
    try {
      const now = Date.now();

      if (Array.isArray(IDROPS) && IDROPS.length > 0) {
        for (let i = IDROPS.length - 1; i >= 0; i--) {
          if (now - (IDROPS[i].creado || now) > 2000) {
            IDROPS.splice(i, 1);
          }
        }
      }

      if (Array.isArray(TEMP_QUEUE)) TEMP_QUEUE.length = 0;
      if (Array.isArray(EVENT_QUEUE)) EVENT_QUEUE.length = 0;
      if (Array.isArray(LOGS)) LOGS.length = 0;

      cleanCaches();
      cleanTempFiles();
      cleanRequireCache();
      cleanBaileysSession();

      runGC();
    } catch (err) {
      warningLog("Error en limpieza regular:", err.message);
    }
  }

  function deepClean() {
    try {
      if (Array.isArray(IDROPS)) IDROPS.length = 0;
      if (Array.isArray(TEMP_QUEUE)) TEMP_QUEUE.length = 0;
      if (Array.isArray(EVENT_QUEUE)) EVENT_QUEUE.length = 0;
      if (Array.isArray(LOGS)) LOGS.length = 0;

      cleanCaches();
      cleanTempFiles();
      cleanRequireCache();
      cleanBaileysSession();

      runGC(true);
    } catch (err) {
      warningLog("Error en Deep Clean:", err.message);
    }
  }

  function checkMemoryPressure() {
    try {
      const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;

      if (memUsageMB > MEMORY_CRITICAL_MB) {
        warningLog(`🚨 Presión de RAM detectada (${memUsageMB.toFixed(2)} MB). Ejecutando purga total...`);

        if (global.GROUP_CACHE) global.GROUP_CACHE = {};
        cleanRequireCache();
        cleanBaileysSession();

        runGC(true);
      }
    } catch (err) {
      warningLog("Error chequeando presión de memoria:", err.message);
    }
  }

  setInterval(() => {
    cleanMemory();
    checkMemoryPressure();
  }, NORMAL_INTERVAL);

  setInterval(deepClean, DEEP_CLEAN_INTERVAL);

  setInterval(() => {
    const mem = process.memoryUsage();
    const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const rss = (mem.rss / 1024 / 1024).toFixed(2);
    infoLog(`🧹 [ESTADO RAM] Heap: ${heapUsed} MB | RSS: ${rss} MB`);
  }, 120_000);

  infoLog(`🚀 Ultra Cleaner Profundo activado (Límite bajo: ${MEMORY_THRESHOLD_MB} MB)`);
};


