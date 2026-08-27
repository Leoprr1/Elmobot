// cleaner.js - Optimizado y adaptado a límites de RAM (sin romper sesión)

const { infoLog, warningLog } = require("./src/utils/logger");

const NORMAL_INTERVAL = 60_000;
const RECONNECT_INTERVAL = 15_000;
const DEEP_CLEAN_INTERVAL = 5 * 60 * 1000;

// 🎯 Detección de límite asignado a Node.js (--max-old-space-size)
const v8 = require("v8");
const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);

// Umbrales calculados proporcionalmente (o fallback seguro)
const MEMORY_THRESHOLD_MB = Math.round(heapLimitMB * 0.4) || 500; 
const MEMORY_CRITICAL_MB = Math.round(heapLimitMB * 0.75) || 900;

let lastGC = 0;

module.exports = function (bot, queues = {}) {

  const { IDROPS, TEMP_QUEUE, EVENT_QUEUE, LOGS } = queues;

  // -----------------------------
  // GC CONTROLADO
  // -----------------------------
  function runGC(force = false) {
    if (!global.gc) return;

    const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;

    // Solo ejecuta GC si supera el umbral (o si se fuerza por estado crítico)
    if (!force && memUsageMB < MEMORY_THRESHOLD_MB) return;

    const now = Date.now();

    // Evitar spam de GC (salvo que sea forzado por memoria crítica)
    if (!force && (now - lastGC < 30_000)) return;

    const before = process.memoryUsage().heapUsed;
    global.gc();
    const after = process.memoryUsage().heapUsed;

    lastGC = now;

    console.log(`[CLEANER] GC | ${((before - after)/1024/1024).toFixed(2)} MB liberados | Heap: ${(after/1024/1024).toFixed(2)} MB / ${heapLimitMB} MB`);
  }

  // -----------------------------
  // Limpieza normal
  // -----------------------------
  function cleanMemory() {
    try {
      const now = Date.now();

      if (Array.isArray(IDROPS) && IDROPS.length > 0) {
        for (let i = IDROPS.length - 1; i >= 0; i--) {
          if (now - IDROPS[i].creado > 5000) {
            IDROPS.splice(i, 1);
          }
        }
      }

      if (Array.isArray(TEMP_QUEUE) && TEMP_QUEUE.length > 50) {
        TEMP_QUEUE.length = 0;
      }

      if (Array.isArray(EVENT_QUEUE) && EVENT_QUEUE.length > 50) {
        EVENT_QUEUE.length = 0;
      }

      if (Array.isArray(LOGS) && LOGS.length > 500) {
        LOGS.splice(0, 400);
      }

      runGC();

      const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;

      if (memUsageMB > MEMORY_THRESHOLD_MB) {
        warningLog(`⚠️ RAM alta: ${memUsageMB.toFixed(2)} MB (Límite: ${MEMORY_THRESHOLD_MB} MB)`);
      }

    } catch (err) {
      warningLog("Error limpieza normal:", err.message);
    }
  }

  // -----------------------------
  // Limpieza agresiva
  // -----------------------------
  function aggressiveClean() {
    try {

      if (Array.isArray(IDROPS)) IDROPS.length = 0;
      if (Array.isArray(TEMP_QUEUE)) TEMP_QUEUE.length = 0;
      if (Array.isArray(EVENT_QUEUE)) EVENT_QUEUE.length = 0;

      if (Array.isArray(LOGS) && LOGS.length > 50) {
        LOGS.splice(0, LOGS.length - 50);
      }

      runGC(true); // Fuerza GC en reconexión

      warningLog("⚡ Limpieza agresiva (reconexión)");

    } catch (err) {
      warningLog("Error limpieza agresiva:", err.message);
    }
  }

  // -----------------------------
  // Deep clean
  // -----------------------------
  function deepClean() {
    try {

      if (Array.isArray(IDROPS)) IDROPS.length = 0;

      if (Array.isArray(TEMP_QUEUE) && TEMP_QUEUE.length > 20) {
        TEMP_QUEUE.length = 0;
      }

      if (Array.isArray(EVENT_QUEUE) && EVENT_QUEUE.length > 20) {
        EVENT_QUEUE.length = 0;
      }

      if (Array.isArray(LOGS) && LOGS.length > 100) {
        LOGS.splice(0, LOGS.length - 100);
      }

      runGC(true);

      infoLog("🧠 Deep clean completado");

    } catch (err) {
      warningLog("Error deep clean:", err.message);
    }
  }

  // -----------------------------
  // Memoria crítica
  // -----------------------------
  function memoryPressureClean() {
    try {

      const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;

      if (memUsageMB > MEMORY_CRITICAL_MB) {

        warningLog(`🚨 RAM crítica (${memUsageMB.toFixed(2)} MB)`);

        if (Array.isArray(IDROPS)) IDROPS.length = 0;
        if (Array.isArray(TEMP_QUEUE)) TEMP_QUEUE.length = 0;
        if (Array.isArray(EVENT_QUEUE)) EVENT_QUEUE.length = 0;

        if (Array.isArray(LOGS)) LOGS.length = 0;

        runGC(true); // Fuerza GC sin esperar los 30s
      }

    } catch (err) {
      warningLog("Error memoria crítica:", err.message);
    }
  }

  // -----------------------------
  // LOOP PRINCIPAL
  // -----------------------------
  setInterval(() => {
    try {
      if (bot.reconnecting) {
        aggressiveClean();
      } else {
        cleanMemory();
      }

      memoryPressureClean();

    } catch (err) {
      warningLog("Error loop principal:", err.message);
    }
  }, NORMAL_INTERVAL);

  // -----------------------------
  // LOOP RECONEXIÓN
  // -----------------------------
  setInterval(() => {
    if (bot.reconnecting) {
      aggressiveClean();
    }
  }, RECONNECT_INTERVAL);

  // -----------------------------
  // DEEP CLEAN
  // -----------------------------
  setInterval(deepClean, DEEP_CLEAN_INTERVAL);

  // -----------------------------
  // LOG CONTROLADO
  // -----------------------------
  setInterval(() => {
    const memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;
    infoLog(`🧹 RAM Heap: ${memUsageMB.toFixed(2)} MB / ${heapLimitMB} MB`);
  }, 60_000);

  infoLog(`🚀 Cleaner iniciado (Tope asignado: ${heapLimitMB} MB | Alerta: ${MEMORY_THRESHOLD_MB} MB)`);
};

