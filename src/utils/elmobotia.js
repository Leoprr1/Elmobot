/**
 * ElmoBotia - Sistema generativo inteligente con control de coherencia
 * + Sintesis optimizada por oraciones aprendidas y bigramas estrictos
 * + Lectura de 'generated-memory' de brainbuilder
 */

const fs = require("fs");
const { getDB } = require("./jsoncache");

const MIN_CONFIDENCE = 0.55; // Ajuste de umbral balanceado para respuesta activa y lógica

let lastGeneratedMessage = null;

/* ===========================
   UTILIDADES
=========================== */

function normalizeText(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?¿¡;]/g, "")
    .trim();
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ===========================
   CLASIFICACIÓN GRAMATICAL MEJORADA
=========================== */

function getWordType(word) {
  const lower = word.toLowerCase();

  const pronouns = ["yo","tú","él","ella","nosotros","vosotros","ellos","ellas","me","te","se","nos","os","lo","la","los","las","vos"];
  if (pronouns.includes(lower)) return "pronoun";

  const articles = ["el","la","los","las","un","una","unos","unas"];
  const prepositions = ["a","ante","bajo","con","contra","de","desde","en","entre","hacia","hasta","para","por","según","sin","sobre","tras"];
  if (articles.includes(lower)) return "article";
  if (prepositions.includes(lower)) return "preposition";

  if (/ar$|er$|ir$|ando$|iendo$|ado$|ido$|é$|aste$|ó$|amos$|aron$|í$|iste$|ió$|imos$|ieron$/.test(lower)) return "verb";
  if (/mente$/.test(lower)) return "adverb";
  if (/o$|a$|os$|as$/.test(lower)) return "noun";
  if (/ivo$|iva$|oso$|osa$|ble$|al$|ar$|ante$/.test(lower)) return "adjective";

  return "other";
}

/* ===========================
   DETECTAR TIPO DE MENSAJE
=========================== */

function detectMessageType(text) {
  if (text.includes("?")) return "question";
  return "statement";
}

/* ===========================
   EXTRACTOR
=========================== */

function extractTextFromMessage(message) {
  if (!message) return "";

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.buttonsResponseMessage?.selectedDisplayText)
    return message.buttonsResponseMessage.selectedDisplayText;
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId)
    return message.listResponseMessage.singleSelectReply.selectedRowId;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;

  return "";
}

/* ===========================
   DETECCIÓN DE TEMA
=========================== */

function detectTopicWithScore(message, brain) {
  const normalized = normalizeText(message);
  const words = normalized.split(/\s+/);

  let bestTopic = "general";
  let bestScore = 0;

  for (const [topic, data] of Object.entries(brain.topics || {})) {
    if (!data.keywords || !data.keywords.length) continue;

    let matches = 0;
    words.forEach((word) => {
      if (data.keywords.includes(word)) matches++;
    });

    const score = words.length ? matches / words.length : 0;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return { topic: bestTopic, relevance: bestScore };
}

/* ===========================
   RANDOM PESADO
=========================== */

function weightedRandom(words, frequencyMap) {
  let total = 0;
  const weighted = [];

  words.forEach((word) => {
    const weight = frequencyMap[word] || 1;
    total += weight;
    weighted.push({ word, cumulative: total });
  });

  const random = Math.random() * total;
  for (const item of weighted) {
    if (random <= item.cumulative) return item.word;
  }
  return words[0];
}

/* ===========================
   GENERADOR CON COHERENCIA MEJORADA
=========================== */

function generateSentence(topicData, messageType, maxWords = 10) {
  if (!topicData) return { sentence: null, bigramHits: 0 };

  // 1. PRIORIDAD (70%): Usar frases u oraciones completas aprendidas del tema
  const sentencesList = topicData.sentences || topicData.phrases || [];
  if (sentencesList.length > 0 && Math.random() < 0.7) {
    const validSentences = sentencesList.filter((s) => s.split(/\s+/).length >= 2);
    if (validSentences.length > 0) {
      let chosen = validSentences[Math.floor(Math.random() * validSentences.length)];
      chosen = capitalize(chosen);
      if (messageType === "question" && !chosen.endsWith("?")) chosen += "?";
      else if (messageType === "statement" && !chosen.endsWith(".")) chosen += ".";
      return { sentence: chosen, bigramHits: 3 };
    }
  }

  // 2. GENERACIÓN POR BIGRAMAS ESTRICTOS (Pares de palabras frecuentes)
  const bigrams = topicData.bigrams || {};
  const strongBigrams = Object.entries(bigrams)
    .filter(([_, count]) => count >= 1)
    .map(([pair]) => pair);

  if (!strongBigrams.length) return { sentence: null, bigramHits: 0 };

  const startPair = strongBigrams[Math.floor(Math.random() * strongBigrams.length)];
  const sentence = startPair.split(" ");
  let bigramHits = 1;

  for (let i = 2; i < maxWords; i++) {
    const lastWord = sentence[sentence.length - 1];
    const possibleNext = strongBigrams
      .filter((pair) => pair.startsWith(lastWord + " "))
      .map((pair) => pair.split(" ")[1]);

    if (!possibleNext.length) break;

    const nextWord = weightedRandom(possibleNext, topicData.wordFrequency || {});
    sentence.push(nextWord);
    bigramHits++;
  }

  let finalSentence = sentence.join(" ");

  // Validar que la oración tenga sentido mínimo (al menos 2 palabras)
  if (sentence.length < 2) return { sentence: null, bigramHits: 0 };

  finalSentence = capitalize(finalSentence);
  if (messageType === "question" && !finalSentence.endsWith("?")) finalSentence += "?";
  else if (messageType === "statement" && !finalSentence.endsWith(".")) finalSentence += ".";

  return { sentence: finalSentence, bigramHits };
}

/* ===========================
   CONFIANZA Y FILTRO
=========================== */

function calculateConfidence({ relevance, sentenceLength, bigramHits, topicData }) {
  const densityScore = topicData.totalSentences > 0 ? Math.min(topicData.totalSentences / 20, 1) : 0;
  const structureScore = Math.min(bigramHits / 3, 1);
  const lengthScore = Math.min(sentenceLength / 6, 1);
  return relevance * 0.4 + densityScore * 0.2 + structureScore * 0.2 + lengthScore * 0.2;
}

/* ===========================
   RESPUESTA PRINCIPAL
=========================== */

exports.getElmoBotiaResponse = (webMessage) => {
  if (!webMessage?.message || webMessage?.key?.fromMe) return null;

  const messageText = extractTextFromMessage(webMessage.message);
  if (!messageText || messageText.length < 2) return null;

  // Ignorar comandos con prefijo
  if (messageText.trim().startsWith(".")) return null;

  // Evitar bucles de repetición
  if (lastGeneratedMessage && normalizeText(messageText) === normalizeText(lastGeneratedMessage)) {
    return null;
  }

  const brain = getDB("generated-memory") || {};
  if (!brain.topics || Object.keys(brain.topics).length === 0) return null;

  const { topic, relevance } = detectTopicWithScore(messageText, brain);
  const topicData = brain.topics[topic];
  if (!topicData) return null;

  const messageType = detectMessageType(messageText);

  const { sentence, bigramHits } = generateSentence(topicData, messageType);
  if (!sentence) return null;

  const sentenceLength = sentence.split(/\s+/).length;

  const confidence = calculateConfidence({ relevance, sentenceLength, bigramHits, topicData });
  if (confidence < MIN_CONFIDENCE) return null;

  lastGeneratedMessage = sentence;
  return sentence;
};

