/**
 * Evento llamado cuando un mensaje
 * es enviado al grupo de WhatsApp
 *
 * @author Dev Gui
 */

const {
  isAtLeastMinutesInPast,
  GROUP_PARTICIPANT_ADD,
  GROUP_PARTICIPANT_LEAVE,
  isAddOrLeave,
} = require("../utils");

const { DEVELOPER_MODE } = require("../config");
const { dynamicCommand } = require("../utils/dynamicCommand");
const { loadCommonFunctions } = require("../utils/loadCommonFunctions");
const { onGroupParticipantsUpdate } = require("./onGroupParticipantsUpdate");
const { errorLog, infoLog } = require("../utils/logger");
const { badMacHandler } = require("../utils/badMacHandler");
const { checkIfMemberIsMuted } = require("../utils/database");
const { messageHandler } = require("./messageHandler");
const { isBotOwner } = require("../middlewares");

// 🔥 IMPORTAR STATS GLOBAL
const groupStats = require("../database/groupStats");
const learningBot = require("../utils/learningBot");

// 🧠 IMPORTAR LEARNING BOT 2
const { learnFromAllMessages } = require("../utils/learningBot2");

// 🧠 IMPORTAR ELMOBOTIA
const { getElmoBotiaResponse } = require("../utils/elmobotia");
const { isActiveElmoBotiaGroup } = require("../utils/elmobotiamanager");
const { isPrivateModeEnabled } = require("../utils/privatemode");
const { isGroupGloballyDisabled } = require("../utils/globalGroups");

// 🔥 SET PARA EVITAR MENSAJES DUPLICADOS
const processedMessages = new Set();
const ultimaPresencia = new Map();

exports.onMessagesUpsert = async ({ socket, messages, startProcess }) => {
  if (!messages || !messages.length) return;

  for (const webMessage of messages) {
    try {

      const jid = webMessage?.key?.remoteJid;
      if (!jid) continue;

      const isGroup = jid.endsWith("@g.us");
      const userJid = webMessage.key?.participant || webMessage.key?.remoteJid;
      const isLid = userJid.endsWith("@lid");

      if (isGroup && isGroupGloballyDisabled(jid) && !isBotOwner({ userJid, isLid })) {
        continue;
      }

      if (!jid.endsWith("@g.us") && !isPrivateModeEnabled() && !isBotOwner({ userJid, isLid })) {
        continue;
      }

      // marcar como disponible (Sin saturar y sin usar .catch)
const ahora = Date.now();
const ultimoEnvio = ultimaPresencia.get(jid) || 0;

if (ahora - ultimoEnvio > 30000) {
  ultimaPresencia.set(jid, ahora);
  try {
    await socket.sendPresenceUpdate("available", jid);
  } catch {}
}
      // marcar como leído
      await socket.readMessages([webMessage]);

      const messageId = webMessage?.key?.id;

      // 🚫 IGNORAR MENSAJES DEL PROPIO BOT
      if (webMessage?.key?.fromMe) continue;

      // 🚫 IGNORAR DUPLICADOS
      if (messageId) {
        if (processedMessages.has(messageId)) continue;

        learnFromAllMessages(webMessage);
        learningBot.learnFromMessage(webMessage);

        processedMessages.add(messageId);
        setTimeout(() => processedMessages.delete(messageId), 60_000);
      }

      if (DEVELOPER_MODE) {
        infoLog(
          `\n\n⪨========== [ MENSAJE RECIBIDO ] ==========⪩ \n\n${JSON.stringify(
            webMessage,
            null,
            2
          )}`
        );
      }

      const timestamp = webMessage.messageTimestamp;

      // 🔥 ========= SISTEMA AFK / STATS ========= 🔥
      if (webMessage?.message) {

        const remoteJid = webMessage?.key?.remoteJid;
        const userJid = webMessage?.key?.participant || remoteJid;

        if (remoteJid && remoteJid.endsWith("@g.us") && userJid) {

          if (!groupStats[remoteJid]) groupStats[remoteJid] = {};

          if (!groupStats[remoteJid][userJid]) {
            groupStats[remoteJid][userJid] = {
              messages: 0,
              lastMessage: Date.now(),
              totalAfk: 0,
            };
          }

          const userData = groupStats[remoteJid][userJid];
          const now = Date.now();

          userData.totalAfk += now - userData.lastMessage;
          userData.messages++;
          userData.lastMessage = now;
        }
      }
      // 🔥 ======================================= 🔥

      if (webMessage?.message) {
        await messageHandler(socket, webMessage);
      }

      if (isAtLeastMinutesInPast(timestamp)) continue;

      if (isAddOrLeave.includes(webMessage.messageStubType)) {

        let action = "";

        if (webMessage.messageStubType === GROUP_PARTICIPANT_ADD)
          action = "add";
        else if (webMessage.messageStubType === GROUP_PARTICIPANT_LEAVE)
          action = "remove";

        await onGroupParticipantsUpdate({
          userJid: webMessage.messageStubParameters[0],
          remoteJid: webMessage.key.remoteJid,
          socket,
          action,
        });

        continue;
      }

      const commonFunctions = await loadCommonFunctions({ socket, webMessage });
      if (!commonFunctions) continue;

      const isMuted = await checkIfMemberIsMuted(
        commonFunctions.remoteJid,
        commonFunctions.userJid
      );

      if (isMuted) {
        try {
          await commonFunctions.deleteMessage(webMessage.key);
        } catch (error) {
          errorLog(
            `Error al eliminar mensaje de miembro silenciado: ${error.message}`
          );
        }
        continue;
      }

      // 🔥 SISTEMA NORMAL
      await dynamicCommand(commonFunctions, startProcess);

      // 🧠 ELMOBOTIA
      if (isActiveElmoBotiaGroup(webMessage.key.remoteJid)) {
        try {

          const elmoReply = getElmoBotiaResponse(webMessage);

          if (elmoReply) {
            await socket.sendMessage(
              webMessage.key.remoteJid,
              { text: elmoReply },
              { quoted: webMessage }
            );
          }

        } catch (err) {
          errorLog(`Error en ElmoBotia: ${err.message}`);
        }
      }

    } catch (error) {

      if (badMacHandler.handleError(error, "message-processing")) continue;

      if (badMacHandler.isSessionError(error)) {
        errorLog(`Error de sesión al procesar mensaje: ${error.message}`);
        continue;
      }

      errorLog(
        `Error al procesar mensaje: ${error.message} | Stack: ${error.stack}`
      );
    }
  }
};
