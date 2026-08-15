/**
 * Auto-responder optimizado con cache en RAM (sin recalcular por mensaje)
 * Con priorización por cobertura de palabras, coincidencia de contexto y Cooldown Anti-Spam.
 */

const path = require("node:path");
const fs = require("node:fs");
const stringSimilarity = require("string-similarity");
const { normalizeText, readJSON, writeJSON } = require("./database");
const { getDB } = require("./jsoncache");

const databasePath = path.resolve(__dirname, "..", "..", "database");

const AUTO_RESPONDER_GROUPS_FILE = "auto-responder-groups";
const AUTO_RESPONDER_FILE = "auto-responder";

// =====================
// ⏱️ CONFIGURACIÓN Y COOLDOWN (ANTI-SPAM)
// =====================

// Tiempo de espera (en milisegundos) para no repetir la MISMA respuesta (10 minutos)
const RESPONSE_COOLDOWN_MS = 10 * 60 * 1000; 

// Mapa en memoria para trackear respuestas recientes { "normalised_answer": timestamp }
const recentResponsesMap = new Map();

/**
 * Filtra y selecciona una respuesta que no haya sido usada recientemente.
 */
function getFreshAnswer(answers) {
  if (!Array.isArray(answers) || !answers.length) return null;

  const now = Date.now();

  // Filtrar respuestas que NO estén en cooldown
  const availableAnswers = answers.filter((ans) => {
    const key = normalizeText(ans);
    const lastUsed = recentResponsesMap.get(key);
    if (!lastUsed) return true;
    return now - lastUsed > RESPONSE_COOLDOWN_MS;
  });

  // Si todas las opciones están en cooldown, no respondemos nada para evitar spam
  if (!availableAnswers.length) return null;

  // Seleccionar una respuesta válida al azar
  const selectedAnswer = availableAnswers[Math.floor(Math.random() * availableAnswers.length)];

  // Registrar el uso en el mapa de cooldowns
  recentResponsesMap.set(normalizeText(selectedAnswer), now);

  return selectedAnswer;
}

// Limpieza automática del Map de cooldowns cada 10 minutos para liberar memoria RAM
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentResponsesMap.entries()) {
    if (now - timestamp > RESPONSE_COOLDOWN_MS) {
      recentResponsesMap.delete(key);
    }
  }
}, 10 * 60 * 1000);


// =====================
// 🔥 CACHE EN RAM
// =====================

let cachedResponses = [];
let lastHash = null;

const crypto = require("crypto");

// preparar cache
function prepareAutoResponder() {
  try {
    const responses = getDB("auto-responder") || [];

    // 🔥 validar que sea array
    if (!Array.isArray(responses)) return;

    // 🔥 generar hash del contenido
    const currentHash = crypto
      .createHash("md5")
      .update(JSON.stringify(responses))
      .digest("hex");

    // 🔥 si no cambió, NO recalcular
    if (currentHash === lastHash) return;

    lastHash = currentHash;

    // 🔥 reconstruir cache ordenando por longitud de palabras y caracteres (mayor a menor)
    cachedResponses = responses
      .map((r) => {
        const normalized = normalizeText(r.match);
        const words = normalized.split(/\s+/).filter(Boolean);

        return {
          raw: r,
          normalized,
          words,
          wordCount: words.length,
        };
      })
      .sort((a, b) => {
        if (b.wordCount !== a.wordCount) {
          return b.wordCount - a.wordCount; // Más palabras primero
        }
        return b.normalized.length - a.normalized.length; // Más caracteres primero
      });

    console.log("⚡ Auto-responder cache actualizado:", cachedResponses.length);

  } catch (err) {
    console.log("❌ Error preparando cache auto-responder:", err);
  }
}

// 🔥 delay inicial (espera a que JSONCache cargue)
setTimeout(() => {
  prepareAutoResponder();

  // 🔁 luego sí, interval normal
  setInterval(() => {
    prepareAutoResponder();
  }, 600000);

}, 10000); // 10 segundos

// =====================
// AUTO RESPONDER
// =====================

const getAutoResponderResponse = (match) => {
  if (!match || !cachedResponses.length) return null;

  const normalizedMessage = normalizeText(match);
  const messageWords = normalizedMessage.split(/\s+/).filter(Boolean);
  const messageWordCount = messageWords.length;

  // ----------------------------------------------------
  // PASO 1: Match Exacto Directo (100% idéntico)
  // ----------------------------------------------------
  for (const r of cachedResponses) {
    if (r.normalized === normalizedMessage) {
      const answer = getFreshAnswer(r.raw.answers);
      if (answer) return answer;
    }
  }

  // ----------------------------------------------------
  // PASO 2: Sistema de Puntaje Exponencial por Frases
  // ----------------------------------------------------
  let bestMatch = null;
  let highestScore = 0;

  for (const r of cachedResponses) {
    let score = 0;

    // A) Si la regla guardada tiene múltiples palabras
    if (r.wordCount > 1) {
      const matchedWords = r.words.filter((w) => messageWords.includes(w)).length;

      // Si coinciden TODAS las palabras de la regla guardada
      if (matchedWords === r.wordCount) {
        // Multiplicador exponencial basado en la cantidad de palabras
        score = Math.pow(matchedWords, 2) * 0.5 + (matchedWords / messageWordCount);
      } 
      // Si coincide la mayoría de las palabras (por ejemplo 4 de 5 palabras)
      else if (matchedWords >= 2 && matchedWords / r.wordCount >= 0.7) {
        score = Math.pow(matchedWords, 1.8) * 0.3;
      }
    }

    // B) Similitud estricta por String Similarity (para oraciones largas con typos)
    if (r.normalized.length > 5) {
      const similarity = stringSimilarity.compareTwoStrings(normalizedMessage, r.normalized);
      if (similarity >= 0.75) {
        const simScore = similarity * r.wordCount * 2;
        if (simScore > score) score = simScore;
      }
    }

    // C) Subcadena (includes) - Último recurso para palabras/letras sueltas
    if (score === 0 && r.normalized.length >= 2) {
      if (normalizedMessage.includes(r.normalized)) {
        // Asigna un puntaje mínimo muy bajo para no eclipsar oraciones
        score = 0.1 * (r.normalized.length / Math.max(normalizedMessage.length, 1));
      }
    }

    // Actualizar mejor coincidencia
    if (score > highestScore) {
      highestScore = score;
      bestMatch = r;
    }
  }

  // Umbral mínimo de confianza para responder
  if (bestMatch && highestScore >= 0.25) {
    return getFreshAnswer(bestMatch.raw.answers);
  }

  return null;
};

// =====================
// AUTO RESPONDER Y ANTI LINK
// =====================

const activateAutoResponderGroup = (groupId) => {
  const groups = readJSON(AUTO_RESPONDER_GROUPS_FILE);
  if (!groups.includes(groupId)) groups.push(groupId);
  writeJSON(AUTO_RESPONDER_GROUPS_FILE, groups);
};

const deactivateAutoResponderGroup = (groupId) => {
  const groups = readJSON(AUTO_RESPONDER_GROUPS_FILE);
  const index = groups.indexOf(groupId);
  if (index !== -1) groups.splice(index, 1);
  writeJSON(AUTO_RESPONDER_GROUPS_FILE, groups);
};

const isActiveAutoResponderGroup = (groupId) =>
  readJSON(AUTO_RESPONDER_GROUPS_FILE).includes(groupId);

// =====================
// AUTO RESPONDER ITEMS
// =====================

const listAutoResponderItems = () => {
  const responses = readJSON(AUTO_RESPONDER_FILE, []);
  return responses.map((item, index) => ({
    key: index + 1,
    match: item.match,
    answers: item.answers || [],
  }));
};

const addAutoResponderItem = (match, answer) => {
  const responses = readJSON(AUTO_RESPONDER_FILE, []);

  const existing = responses.find(
    (r) => r.match.toUpperCase() === match.toUpperCase()
  );

  if (existing) {
    if (!existing.answers.includes(answer.trim())) {
      existing.answers.push(answer.trim());
      writeJSON(AUTO_RESPONDER_FILE, responses, []);
      prepareAutoResponder(); // 🔥 refrescar cache
    }
    return true;
  }

  responses.push({
    match: match.trim(),
    answers: [answer.trim()],
  });

  writeJSON(AUTO_RESPONDER_FILE, responses, []);
  prepareAutoResponder(); // 🔥 refrescar cache

  return true;
};

const removeAutoResponderItemByKey = (key) => {
  const responses = readJSON(AUTO_RESPONDER_FILE, []);
  const index = key - 1;
  if (index < 0 || index >= responses.length) return false;

  responses.splice(index, 1);
  writeJSON(AUTO_RESPONDER_FILE, responses, []);
  prepareAutoResponder(); // 🔥 refrescar cache

  return true;
};

// =====================
// EXPORTS
// =====================

module.exports = {
  getAutoResponderResponse,
  activateAutoResponderGroup,
  deactivateAutoResponderGroup,
  isActiveAutoResponderGroup,
  listAutoResponderItems,
  addAutoResponderItem,
  removeAutoResponderItemByKey,
};

