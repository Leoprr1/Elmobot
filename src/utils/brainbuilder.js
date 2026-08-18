const fs = require("fs").promises;
const path = require("path");

const databasePath = path.resolve(__dirname, "../../database");
const GENERATED_FILE = path.resolve(databasePath, "generated-memory.json");

let brain = {
  metadata: {
    createdAt: Date.now(),
    source: "incremental-brain",
  },
  topics: {},
  global: {
    wordFrequency: {},
    totalSentences: 0,
  },
};

// 🧠 Caches de búsqueda instantánea O(1)
const processedSet = new Set();
const sentenceSet = new Set();

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function addFrequency(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function detectTopic(text) {
  const topicMap = {
    edad: ["edad", "años"],
    nombre: ["nombre", "llamas"],
    saludo: ["hola", "buenas", "hey"],
    estado: ["como estas", "todo bien"],
    identidad: ["quien sos", "quien eres"],
    despedida: ["chau", "adios", "nos vemos"]
  };

  for (const [topic, keywords] of Object.entries(topicMap)) {
    if (keywords.some(k => text.includes(k))) return topic;
  }

  return "general";
}

// 🔥 PROCESAMIENTO OPTIMIZADO (RÁPIDO COMO UN RAYO)
function processEntry(sentence) {
  if (!sentence) return;

  const normalized = normalize(sentence);
  if (!normalized || processedSet.has(normalized)) return;
  processedSet.add(normalized);

  const topic = detectTopic(normalized);

  if (!brain.topics[topic]) {
    brain.topics[topic] = {
      keywords: new Set(), // Usa Set para no repetir palabras sin hacer uniqueArray
      sentences: [],
      wordFrequency: {},
      bigrams: {},
      totalSentences: 0,
    };
  }

  const topicData = brain.topics[topic];

  if (!sentenceSet.has(normalized)) {
    sentenceSet.add(normalized);
    topicData.sentences.push(normalized);
    topicData.totalSentences++;
    brain.global.totalSentences++;
  }

  const words = normalized.split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    topicData.keywords.add(word); // Instantáneo

    addFrequency(topicData.wordFrequency, word);
    addFrequency(brain.global.wordFrequency, word);

    if (i < words.length - 1) {
      const bigram = word + " " + words[i + 1];
      addFrequency(topicData.bigrams, bigram);
    }
  }
}

// 🔥 CARGA INCREMENTAL
async function syncFromDB() {
  try {
    const { getDB } = require("./jsoncache");

    const auto = getDB("auto-responder") || [];
    const lb2 = getDB("learningbot2") || [];

    for (const entry of auto) {
      if (!entry.match) continue;
      processEntry(entry.match);

      const answers = entry.answers || (entry.answer ? [entry.answer] : []);
      for (const a of answers) processEntry(a);
    }

    for (const msg of lb2) {
      processEntry(msg);
    }

    console.log("🧠 Brain actualizado incrementalmente");
  } catch (err) {
    console.error("❌ Error sincronizando Brain:", err.message);
  }
}

// 🔥 GUARDADO LIVIANO
async function saveBrain() {
  try {
    // Convertir keywords de Set a Array solo al momento de guardar
    const exportBrain = JSON.parse(JSON.stringify(brain));
    for (const t in exportBrain.topics) {
      if (brain.topics[t]?.keywords) {
        exportBrain.topics[t].keywords = Array.from(brain.topics[t].keywords);
      }
    }
    await fs.writeFile(GENERATED_FILE, JSON.stringify(exportBrain, null, 2));
  } catch (err) {
    console.error("❌ Error guardando brain:", err);
  }
}

// 🚀 INICIO DIFERIDO (15 segundos después de arrancar para no trabar la conexión)
function initWatcher() {
  setTimeout(() => {
    syncFromDB();

    setInterval(() => {
      syncFromDB();
      saveBrain();
    }, 60 * 1000);
  }, 15000); // 15s le da tiempo a Baileys de conectar limpio sin interrupciones
}

initWatcher();

module.exports = { syncFromDB };


