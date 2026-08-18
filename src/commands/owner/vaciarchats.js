const { PREFIX } = require(`${BASE_DIR}/config`);
const { isBotOwner } = require(`${BASE_DIR}/middlewares`);

module.exports = {
  name: "clearchats",
  description: "Vacía el historial de mensajes de los grupos para acelerar el arranque",
  commands: ["clearchats", "vaciar"],
  usage: `${PREFIX}clearchats`,

  handle: async ({ socket, sendReply, userJid, isLid }) => {
    // 🔒 SOLO OWNER
    if (!isBotOwner({ userJid, isLid })) {
      return sendReply("❌ Este comando solo puede usarlo el owner del bot.");
    }

    try {
      await sendReply("⏳ Obteniendo grupos y limpiando historial...");

      // 1. Obtener todos los grupos donde está el bot directamente desde WhatsApp
      const groupsMap = await socket.groupFetchAllParticipating();
      const groupJids = Object.keys(groupsMap || {});

      if (groupJids.length === 0) {
        return sendReply("⚠️ El bot no está presente en ningún grupo.");
      }

      let contador = 0;

      for (const jid of groupJids) {
        try {
          // 2. Enviar orden de vaciado a cada grupo
          await socket.chatModify(
            {
              clear: {
                messages: [{ id: "CLEAN", fromMe: true }]
              }
            },
            jid
          );
          contador++;
          await new Promise((r) => setTimeout(r, 200));
        } catch (e) {
          // Ignorar errores puntuales si un chat no permite la orden
        }
      }

      return sendReply(`✅ **Limpieza completada.**\n\nSe vació el historial de **${contador}** grupos directamente desde WhatsApp.`);

    } catch (error) {
      return sendReply(`❌ Error al ejecutar la limpieza: ${error.message}`);
    }
  },
};



