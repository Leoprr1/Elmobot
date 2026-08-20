/**
 * Interceptadores diversos.

 */
const { OWNER_NUMBER, OWNER_LID } = require("../config");
const { compareUserJidWithOtherNumber } = require("../utils");
const { getPrefix } = require("../utils/database");

exports.verifyPrefix = (prefix, groupJid) => {
  const groupPrefix = getPrefix(groupJid);

  return groupPrefix === prefix;
};

exports.hasTypeAndCommand = ({ type, command }) => !!type && !!command;

// ------------------------------------------------------------------
// DETECCIÓN DE LINKS (ignora comandos con prefijo)
// ------------------------------------------------------------------
exports.isLink = (text, prefix = ".") => {
  const cleanText = text.trim();

  // Ignorar comandos con el prefijo
  if (cleanText.startsWith(prefix)) return false;

  // Ignorar números puros
  if (/^\d+$/.test(cleanText)) return false;

  // Ignorar puntos consecutivos tipo '..' o '...'
  if (/[.]{2,3}/.test(cleanText)) return false;

  try {
    const url = new URL(cleanText);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    try {
      const url = new URL("https://" + cleanText);

      const originalHostname = cleanText
        .split("/")[0]
        .split("?")[0]
        .split("#")[0];

      const hostnameWithoutTrailingDot = originalHostname.replace(/\.$/, "");

      return (
        url.hostname.includes(".") &&
        hostnameWithoutTrailingDot.includes(".") &&
        url.hostname.length > 4 &&
        !/^\d+$/.test(originalHostname)
      );
    } catch (error) {
      return false;
    }
  }
};

exports.isAdmin = async ({ remoteJid, userJid, socket }) => {
  const { participants, owner } = await socket.groupMetadata(remoteJid);

  const cleanUserJid = userJid?.split(":")[0].split("@")[0];

  const participant = participants.find((p) => {
    const cleanParticipantId = p.id?.split(":")[0].split("@")[0];
    return p.id === userJid || cleanParticipantId === cleanUserJid;
  });

  if (!participant) {
    return false;
  }

  const isOwner =
    participant.id === owner ||
    participant.admin === "superadmin" ||
    compareUserJidWithOtherNumber({
      userJid: participant.id,
      otherNumber: OWNER_NUMBER,
    });

  const isAdmin = participant.admin === "admin";

  return isOwner || isAdmin;
};

exports.isBotOwner = ({ userJid, webMessage }) => {
  let jid = userJid;

  // ⚡ Si viene webMessage lo usamos
  if (!jid && webMessage?.key) {
    if (webMessage.key.participant) {
      jid = webMessage.key.participant;
    } else {
      jid = webMessage.key.remoteJid;
    }
  }

  if (!jid) return false;

  // ⚡ Normalizamos a @lid
  const normalizedJid = jid.endsWith("@s.whatsapp.net")
    ? jid.replace("@s.whatsapp.net", "@lid")
    : jid;

  // ⚡ Verificar por LID
  if (normalizedJid === OWNER_LID) {
    return true;
  }

  // ⚡ Verificar por número
  return compareUserJidWithOtherNumber({
    userJid: jid,
    otherNumber: OWNER_NUMBER,
  });
};

exports.checkPermission = async ({ type, socket, userJid, remoteJid }) => {

  const isBotOwner =
    compareUserJidWithOtherNumber({ userJid, otherNumber: OWNER_NUMBER }) ||
    userJid === OWNER_LID;

  // ✅ Permitir comandos owner en privado
  if (!remoteJid.endsWith("@g.us")) {

    if (type === "owner") {
      return isBotOwner;
    }

    if (type === "member") {
      return true;
    }

    return false;
  }

  // 🔽 lógica normal para grupos
  if (type === "member") {
    return true;
  }

  try {
    const { participants, owner } = await socket.groupMetadata(remoteJid);

    // Extraer solo la parte numérica sin sufijos de servidor
    const cleanUserJid = userJid?.split(":")[0].split("@")[0];

    // Búsqueda flexible (por JID exacto o comparando solo el número base)
    const participant = participants.find((p) => {
      const cleanParticipantId = p.id?.split(":")[0].split("@")[0];
      return p.id === userJid || cleanParticipantId === cleanUserJid;
    });

    if (!participant) {
      // Si la búsqueda estricta falla y es Owner, se aprueba directamente
      return isBotOwner;
    }

    const isGroupOwner =
      participant.id === owner || participant.admin === "superadmin";

    const isAdmin = participant.admin === "admin";

    if (type === "admin") {
      return isGroupOwner || isAdmin || isBotOwner;
    }

    if (type === "owner") {
      return isGroupOwner || isBotOwner;
    }

    return false;

  } catch (error) {
    return isBotOwner;
  }
};



