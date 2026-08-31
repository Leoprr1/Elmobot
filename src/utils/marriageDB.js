const fs = require("fs");
const path = require("path");

const DB_PATH = path.resolve(__dirname, "..", "database", "marriages.json");

function readDB() {
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[MARRIAGE DB] Error leyendo DB, resguardando datos:", err);
    return {};
  }
}

function writeDB(data) {
  // 🛡️ Validar que los datos existan y no sean vacíos/inválidos antes de escribir
  if (!data || typeof data !== "object") {
    console.error("[MARRIAGE DB] ⚠️ Intento de escritura abortado: Datos inválidos.");
    return;
  }

  const tempPath = `${DB_PATH}.tmp`;

  try {
    // 1. Escribir primero en el archivo temporal
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));

    // 2. Reemplazo atómico seguro a nivel OS (evita dejar el JSON en 0 bytes)
    fs.renameSync(tempPath, DB_PATH);
  } catch (err) {
    console.error("[MARRIAGE DB] Error escribiendo en DB:", err);
  }
}

function isMarried(user) {
  const db = readDB();
  return !!db[user];
}

function getMarriage(user) {
  const db = readDB();
  return db[user] || null;
}

function marry(user1, user2) {
  const db = readDB();
  const now = Date.now();

  db[user1] = {
    partner: user2,
    since: now
  };

  db[user2] = {
    partner: user1,
    since: now
  };

  writeDB(db);
}

function divorce(user) {
  const db = readDB();
  const data = db[user];

  if (data) {
    delete db[user];
    delete db[data.partner];
    writeDB(db);
  }
}

module.exports = {
  isMarried,
  getMarriage,
  marry,
  divorce
};

