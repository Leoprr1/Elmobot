const { readJSON, writeJSON } = require("./database");

// 🔒 Archivo EXCLUSIVO para los baneos globales del Owner
const FILE = "globallyDisabledGroups";

function getDisabledGroups() {
  const data = readJSON(FILE);
  return Array.isArray(data) ? data : [];
}

function disableGroup(groupId) {
  const groups = getDisabledGroups();

  if (!groups.includes(groupId)) {
    groups.push(groupId);
    writeJSON(FILE, groups);
  }
}

function enableGroup(groupId) {
  const groups = getDisabledGroups().filter(id => id !== groupId);
  writeJSON(FILE, groups);
}

function isGroupGloballyDisabled(groupId) {
  const groups = getDisabledGroups();
  return groups.includes(groupId);
}

module.exports = {
  disableGroup,
  enableGroup,
  isGroupGloballyDisabled
};

