const { isGroup, onlyNumbers, toUserJid } = require(`${BASE_DIR}/utils`);
const { errorLog } = require(`${BASE_DIR}/utils/logger`);
const { PREFIX, ASSETS_DIR } = require(`${BASE_DIR}/config`);
const { InvalidParameterError } = require(`${BASE_DIR}/errors`);
const { getProfileImageData } = require(`${BASE_DIR}/services/baileys`);
const { getDB } = require("../../utils/jsoncache");
const { getMarriage, isMarried } = require(`${BASE_DIR}/utils/marriageDB`);

function normalizeJid(jid) {
  const number = jid.split("@")[0];
  return `${number}@`;
}

// Rango aventurero
function getRangoAventurero(nivel) {
  if (nivel >= 2000) return { rango: "SSS", emoji: "🟣", medalla: "🏆" };
  if (nivel >= 1000) return { rango: "SS", emoji: "🔴", medalla: "🎖️" };
  if (nivel >= 500) return { rango: "S", emoji: "🟠", medalla: "🎖️" };
  if (nivel >= 300) return { rango: "A", emoji: "🟡", medalla: "🏅" };
  if (nivel >= 150) return { rango: "B", emoji: "🟢", medalla: "🏅" };
  if (nivel >= 100) return { rango: "C", emoji: "🔵", medalla: "🥈" };
  if (nivel >= 50) return { rango: "D", emoji: "🟣", medalla: "🥉" };
  if (nivel >= 30) return { rango: "E", emoji: "⚪", medalla: "⚪" };
  return { rango: "F", emoji: "⚫", medalla: "⚫" };
}

// Tiempo desde registro
function tiempoRegistro(timestamp) {
  if (!timestamp) return "Desconocido";

  const diff = Date.now() - timestamp;

  const dias = Math.floor(diff / 86400000);
  const horas = Math.floor(diff / 3600000);
  const minutos = Math.floor(diff / 60000);

  if (dias > 0) return `${dias} día(s)`;
  if (horas > 0) return `${horas} hora(s)`;
  return `${minutos} minuto(s)`;
}

module.exports = {
  name: "profile",
  description: "Muestra información de un usuario",
  commands: ["profile"],
  usage: `${PREFIX}profile o profile @usuario`,

  handle: async ({
    args,
    socket,
    remoteJid,
    userJid,
    sendErrorReply,
    sendWaitReply,
    sendSuccessReact,
    mentionedJid,
    replyJid,
    toUserJid,
    DB,
  }) => {

    if (!isGroup(remoteJid)) {
      throw new InvalidParameterError(
        "Este comando solo puede ser usado en un grupo."
      );
    }

    const targetJid =
      mentionedJid?.[0] ||
      replyJid ||
      (args[0] ? toUserJid(args[0]) : userJid);

    await sendWaitReply("Cargando perfil...");

    try {

      let profilePicUrl;
      let userRole = "Miembro";

      try {
        const { profileImage } = await getProfileImageData(socket, targetJid);
        profilePicUrl = profileImage || `${ASSETS_DIR}/images/default-user.png`;
      } catch (error) {
        errorLog(`Error obteniendo foto de ${targetJid}`);
        profilePicUrl = `${ASSETS_DIR}/images/default-user.png`;
      }

      const groupMetadata = await socket.groupMetadata(remoteJid);

      const participant = groupMetadata.participants.find(
        (p) => p.id === targetJid
      );

      if (participant?.admin) userRole = "Administrador";

      // ====================
      // LEER DATABASE
      // ====================

      const users = getDB("users");
      const rpgDB = DB || getDB("rpg"); // Usa la instancia de DB activa o cae a la caché

      const dbUser = users[targetJid] || users[normalizeJid(targetJid)] || {};
      const rpgUser = rpgDB[targetJid] || {};

      const age = dbUser.age || "No registrada";
      const gender = dbUser.gender || "No registrado";
      const commandsUsed = dbUser.commandsUsed || 0;
      const name = dbUser.name || `@${targetJid.split("@")[0]}`;

      const tiempo = tiempoRegistro(dbUser.registeredAt);

      const nivel = rpgUser.nivel || 0;
      const monedas = rpgUser.monedas || 0;

      const rango = getRangoAventurero(nivel);

      // ====================
      // LECTURA DE CLAN (ESTILO RPG)
      // ====================
      const clanes = rpgDB.clanes || {};
      const userClan = Object.values(clanes).find(c => {
        if (!c) return false;
        const coolideres = c.coolideres || [];
        const miembros = c.miembros || [];
        return c.lider === targetJid || coolideres.includes(targetJid) || miembros.includes(targetJid);
      });

      const clanNombre = userClan ? userClan.nombre : "Sin clan";

      // ====================
      // MATRIMONIO
      // ====================

      let estadoCivil = "Soltero/a 💔";
      const mentions = [targetJid];

      if (isMarried(targetJid)) {
        const marriage = getMarriage(targetJid);
        if (marriage && marriage.partner) {
          const partnerJid = marriage.partner;
          const partnerNumber = onlyNumbers(partnerJid);
          estadoCivil = `Casado/a con @${partnerNumber} 💍`;
          mentions.push(partnerJid);
        }
      }

      // ====================
      // MENSAJE
      // ====================

      const mensagem = `
👤 *Nombre:* ${name}
🧬 *Sexo:* ${gender}
🎂 *Edad:* ${age}
🎖️ *Cargo:* ${userRole}
💍 *Estado Civil:* ${estadoCivil}

📅 *Registrado hace:* ${tiempo}
⚡ *Comandos usados:* ${commandsUsed}

⚔️ *Nivel RPG:* ${nivel}
🛡️ *Clan:* ${clanNombre}
🏅 *Rango Aventurero:* ${rango.emoji} ${rango.rango}
💰 *Monedas:* ${monedas.toLocaleString("es-AR")}
`;

      await sendSuccessReact();

      await socket.sendMessage(remoteJid, {
        image: { url: profilePicUrl },
        caption: mensagem,
        mentions: mentions,
      });

    } catch (error) {
      console.error(error);
      sendErrorReply("Ocurrió un error al intentar verificar el perfil.");
    }
  },
};
