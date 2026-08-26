const { onlyNumbers } = require(`${BASE_DIR}/utils`);
const { divorce, getMarriage, isMarried } = require(`${BASE_DIR}/utils/marriageDB`);

module.exports = {
  name: "divorce",
  commands: ["divorce", "divorcio"],

  handle: async ({
    sendText,
    sendErrorReply,
    userJid,
  }) => {

    // 🔎 Verificar si está casado
    if (!isMarried(userJid)) {
      await sendErrorReply("No estás casado 💔");
      return;
    }

    // 💍 Obtener datos del matrimonio antes de borrarlo
    const marriage = getMarriage(userJid);

    if (!marriage || !marriage.partner) {
      await sendErrorReply("Ocurrió un error al obtener la información de tu matrimonio 💔");
      return;
    }

    const partnerJid = marriage.partner;

    // 💔 Ejecutar el divorcio en la base de datos
    divorce(userJid);

    const userNumber = onlyNumbers(userJid);
    const partnerNumber = onlyNumbers(partnerJid);

    await sendText(
`💔 *DIVORCIO CONFIRMADO*

@${userNumber} y @${partnerNumber} ya no están casados...

El amor terminó 🥀`,
      [userJid, partnerJid]
    );
  },
};


