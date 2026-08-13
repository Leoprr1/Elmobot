/**
Funciones útiles para trabajar con datos.

@author Dev Gui
*/
const path = require("node:path");
const fs = require("node:fs");
const { PREFIX } = require("../config");
const databasePath = path.resolve(__dirname, "..", "..", "database");

// Archivos base
const ANTI_LINK_GROUPS_FILE = "anti-link-groups";
const EXIT_GROUPS_FILE = "exit-groups";
const GROUP_RESTRICTIONS_FILE = "group-restrictions";
const INACTIVE_GROUPS_FILE = "inactive-groups";
const MUTE_FILE = "muted";
const ONLY_ADMINS_FILE = "only-admins";
const ONLY_ADMINS_EXCEPTIONS_FILE = "only-admins-exceptions";
const PREFIX_GROUPS_FILE = "prefix-groups";
const RESTRICTED_MESSAGES_FILE = "restricted-messages";
const WELCOME_GROUPS_FILE = "welcome-groups";
const USERS_FILE = "users"; // 🔹 archivo JSON para usuarios
const ABBREVIATIONS_FILE = "abbreviations.json";

// =====================
// FUNCIONES BASE
// =====================
function createIfNotExists(fullPath, formatIfNotExists = []) {
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, JSON.stringify(formatIfNotExists));
  }
}

function readJSON(jsonFile, formatIfNotExists = []) {
  const fullPath = path.resolve(databasePath, `${jsonFile}.json`);
  createIfNotExists(fullPath, formatIfNotExists);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function writeJSON(jsonFile, data, formatIfNotExists = []) {
  const fullPath = path.resolve(databasePath, `${jsonFile}.json`);
  createIfNotExists(fullPath, formatIfNotExists);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");
}

// =====================
// FUNCIONES DE USUARIOS
// =====================
function readUserProfiles() {
  return readJSON(USERS_FILE, {});
}

function saveUserProfiles(users) {
  writeJSON(USERS_FILE, users, {});
}

function incrementCommandCount(userJid) {
  const users = readUserProfiles();
  if (users[userJid]) {
    users[userJid].commandsUsed = (users[userJid].commandsUsed || 0) + 1;
    saveUserProfiles(users);
  }
}

// =====================
// FUNCIONES DE TEXTO
// =====================
const abbreviationsPath = path.resolve(databasePath, ABBREVIATIONS_FILE);
const abbreviations = fs.existsSync(abbreviationsPath)
  ? JSON.parse(fs.readFileSync(abbreviationsPath, "utf8"))
  : {};

function normalizeText(text) {
  if (!text) return "";
  let normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(.)\1{2,}/g, "$1")
    .replace(/[^\w\s]/g, "");

  for (const [key, value] of Object.entries(abbreviations)) {
    const regex = new RegExp(`\\b${key}\\b`, "gi");
    normalized = normalized.replace(regex, value);
  }

  const stopwords = ["de", "la", "el", "y", "a", "en", "lo", "un", "una"];
  normalized = normalized
    .split(/\s+/)
    .filter((w) => !stopwords.includes(w))
    .join(" ");

  return normalized.trim();
}

// =====================
// FUNCIONES DE GRUPOS
// =====================
exports.activateExitGroup = (groupId) => {
  const exitGroups = readJSON(EXIT_GROUPS_FILE);
  if (!exitGroups.includes(groupId)) exitGroups.push(groupId);
  writeJSON(EXIT_GROUPS_FILE, exitGroups);
};

exports.deactivateExitGroup = (groupId) => {
  const exitGroups = readJSON(EXIT_GROUPS_FILE);
  const index = exitGroups.indexOf(groupId);
  if (index !== -1) exitGroups.splice(index, 1);
  writeJSON(EXIT_GROUPS_FILE, exitGroups);
};

exports.isActiveExitGroup = (groupId) => readJSON(EXIT_GROUPS_FILE).includes(groupId);

exports.activateWelcomeGroup = (groupId) => {
  const welcomeGroups = readJSON(WELCOME_GROUPS_FILE);
  if (!welcomeGroups.includes(groupId)) welcomeGroups.push(groupId);
  writeJSON(WELCOME_GROUPS_FILE, welcomeGroups);
};

exports.deactivateWelcomeGroup = (groupId) => {
  const welcomeGroups = readJSON(WELCOME_GROUPS_FILE);
  const index = welcomeGroups.indexOf(groupId);
  if (index !== -1) welcomeGroups.splice(index, 1);
  writeJSON(WELCOME_GROUPS_FILE, welcomeGroups);
};

exports.isActiveWelcomeGroup = (groupId) => readJSON(WELCOME_GROUPS_FILE).includes(groupId);

exports.activateGroup = (groupId) => {
  const inactiveGroups = readJSON(INACTIVE_GROUPS_FILE);
  const index = inactiveGroups.indexOf(groupId);
  if (index !== -1) inactiveGroups.splice(index, 1);
  writeJSON(INACTIVE_GROUPS_FILE, inactiveGroups);
};

exports.deactivateGroup = (groupId) => {
  const inactiveGroups = readJSON(INACTIVE_GROUPS_FILE);
  if (!inactiveGroups.includes(groupId)) inactiveGroups.push(groupId);
  writeJSON(INACTIVE_GROUPS_FILE, inactiveGroups);
};

exports.isActiveGroup = (groupId) => !readJSON(INACTIVE_GROUPS_FILE).includes(groupId);

// =====================
// EXCEPCIONES DE ONLY-ADMINS
// =====================
exports.addOnlyAdminException = (groupId, userJid) => {
  const exceptions = readJSON(ONLY_ADMINS_EXCEPTIONS_FILE, {});
  if (!exceptions[groupId]) exceptions[groupId] = [];
  if (!exceptions[groupId].includes(userJid)) {
    exceptions[groupId].push(userJid);
    writeJSON(ONLY_ADMINS_EXCEPTIONS_FILE, exceptions);
  }
};

exports.removeOnlyAdminException = (groupId, userJid) => {
  const exceptions = readJSON(ONLY_ADMINS_EXCEPTIONS_FILE, {});
  if (!exceptions[groupId]) return;
  const index = exceptions[groupId].indexOf(userJid);
  if (index !== -1) {
    exceptions[groupId].splice(index, 1);
    writeJSON(ONLY_ADMINS_EXCEPTIONS_FILE, exceptions);
  }
};

exports.isOnlyAdminException = (groupId, userJid) => {
  const exceptions = readJSON(ONLY_ADMINS_EXCEPTIONS_FILE, {});
  return exceptions[groupId]?.includes(userJid) || false;
};



// =====================
// ANTI LINK
// =====================
exports.activateAntiLinkGroup = (groupId) => {
  const groups = readJSON(ANTI_LINK_GROUPS_FILE);
  if (!groups.includes(groupId)) groups.push(groupId);
  writeJSON(ANTI_LINK_GROUPS_FILE, groups);
};

exports.deactivateAntiLinkGroup = (groupId) => {
  const groups = readJSON(ANTI_LINK_GROUPS_FILE);
  const index = groups.indexOf(groupId);
  if (index !== -1) groups.splice(index, 1);
  writeJSON(ANTI_LINK_GROUPS_FILE, groups);
};

exports.isActiveAntiLinkGroup = (groupId) => readJSON(ANTI_LINK_GROUPS_FILE).includes(groupId);

// =====================
// MUTE Y ADMINS
// =====================
exports.muteMember = (groupId, memberId) => {
  const mutedMembers = readJSON(MUTE_FILE, {});
  if (!mutedMembers[groupId]) mutedMembers[groupId] = [];
  if (!mutedMembers[groupId].includes(memberId)) mutedMembers[groupId].push(memberId);
  writeJSON(MUTE_FILE, mutedMembers);
};

exports.unmuteMember = (groupId, memberId) => {
  const mutedMembers = readJSON(MUTE_FILE, {});
  if (!mutedMembers[groupId]) return;
  const index = mutedMembers[groupId].indexOf(memberId);
  if (index !== -1) mutedMembers[groupId].splice(index, 1);
  writeJSON(MUTE_FILE, mutedMembers);
};

exports.checkIfMemberIsMuted = (groupId, memberId) => {
  const mutedMembers = readJSON(MUTE_FILE, {});
  return mutedMembers[groupId]?.includes(memberId) || false;
};

exports.activateOnlyAdmins = (groupId) => {
  const groups = readJSON(ONLY_ADMINS_FILE, []);
  if (!groups.includes(groupId)) groups.push(groupId);
  writeJSON(ONLY_ADMINS_FILE, groups);
};

exports.deactivateOnlyAdmins = (groupId) => {
  const groups = readJSON(ONLY_ADMINS_FILE, []);
  const index = groups.indexOf(groupId);
  if (index !== -1) groups.splice(index, 1);
  writeJSON(ONLY_ADMINS_FILE, groups);
};

exports.isActiveOnlyAdmins = (groupId) => readJSON(ONLY_ADMINS_FILE, []).includes(groupId);

// =====================
// RESTRICCIONES Y PREFIX
// =====================
exports.readGroupRestrictions = () => readJSON(GROUP_RESTRICTIONS_FILE, {});
exports.saveGroupRestrictions = (restrictions) => writeJSON(GROUP_RESTRICTIONS_FILE, restrictions, {});
exports.isActiveGroupRestriction = (groupId, restriction) => {
  const restrictions = exports.readGroupRestrictions();
  return restrictions[groupId]?.[restriction] === true;
};
exports.updateIsActiveGroupRestriction = (groupId, restriction, isActive) => {
  const restrictions = exports.readGroupRestrictions();
  if (!restrictions[groupId]) restrictions[groupId] = {};
  restrictions[groupId][restriction] = isActive;
  exports.saveGroupRestrictions(restrictions);
};

exports.readRestrictedMessageTypes = () => readJSON(RESTRICTED_MESSAGES_FILE, {
  sticker: "stickerMessage",
  video: "videoMessage",
  image: "imageMessage",
  audio: "audioMessage",
  product: "productMessage",
  document: "documentMessage",
  event: "eventMessage",
});

exports.setPrefix = (groupJid, prefix) => {
  const prefixes = readJSON(PREFIX_GROUPS_FILE, {});
  prefixes[groupJid] = prefix;
  writeJSON(PREFIX_GROUPS_FILE, prefixes, {});
};

exports.getPrefix = (groupJid) => readJSON(PREFIX_GROUPS_FILE, {})[groupJid] || PREFIX;

// =====================
// EXPORTAR FUNCIONES DE USUARIOS
// =====================
exports.readUserProfiles = readUserProfiles;
exports.saveUserProfiles = saveUserProfiles;
exports.incrementCommandCount = incrementCommandCount;

// =====================
// EXPORTAR FUNCIONES BASE
// =====================
exports.readJSON = readJSON;
exports.writeJSON = writeJSON;
exports.normalizeText = normalizeText;
