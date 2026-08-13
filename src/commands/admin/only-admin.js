const {
  activateOnlyAdmins,
  deactivateOnlyAdmins,
  isActiveOnlyAdmins,
  addOnlyAdminException,
  removeOnlyAdminException,
  isOnlyAdminException,
} = require("../../utils/database");

const { InvalidParameterError, WarningError } = require(`${BASE_DIR}/errors`);
const { PREFIX } = require(`${BASE_DIR}/config`);

module.exports = {
  name: "only-admin",
  description: "Permite que solo administradores (y exceptuados) utilicen los comandos.",
  commands: [
    "only-admin",
    "only-adm",
    "only-administrator",
    "only-administrators",
    "only-admins",
    "so-adm",
    "so-admin",
    "so-administrador",
    "so-administradores",
    "so-admins",
  ],
  usage: `${PREFIX}only-admin 1 / 0 / + @user / - @user`,

  handle: async ({ args, sendReply, sendSuccessReact, remoteJid, replyJid, mentionedJid }) => {
    if (!args.length) {
      throw new InvalidParameterError(
        `Uso correcto:\n• ${PREFIX}only-admin 1 (Activar)\n• ${PREFIX}only-admin 0 (Desactivar)\n• ${PREFIX}only-admin + @usuario (Dar excepción)\n• ${PREFIX}only-admin - @usuario (Quitar excepción)`
      );
    }

    const action = args[0].trim();

    // 🔹 ACTIVAR / DESACTIVAR
    if (action === "1" || action === "0") {
      const onlyAdminOn = action === "1";
      const hasActive = onlyAdminOn && isActiveOnlyAdmins(remoteJid);
      const hasInactive = !onlyAdminOn && !isActiveOnlyAdmins(remoteJid);

      if (hasActive || hasInactive) {
        throw new WarningError(
          `¡La función ya está ${onlyAdminOn ? "activada" : "desactivada"}!`
        );
      }

      if (onlyAdminOn) activateOnlyAdmins(remoteJid);
      else deactivateOnlyAdmins(remoteJid);

      await sendSuccessReact();
      return sendReply(
        `¡Función de solo administradores ${onlyAdminOn ? "activada" : "desactivada"} con éxito!`
      );
    }

    // 🔹 AGREGAR EXCEPCIÓN (+) O REMOVER (-)
    if (action.startsWith("+") || action.startsWith("-")) {
      const isAdding = action.startsWith("+");
      const targetJid = replyJid || (mentionedJid && mentionedJid[0]);

      if (!targetJid) {
        throw new InvalidParameterError(
          "¡Necesitas mencionar a alguien o responder a su mensaje!"
        );
      }

      if (isAdding) {
        if (isOnlyAdminException(remoteJid, targetJid)) {
          throw new WarningError("Este usuario ya tenía la excepción concedida.");
        }
        addOnlyAdminException(remoteJid, targetJid);
        await sendSuccessReact();
        return sendReply("✅ Usuario añadido a la lista de excepciones de `only-admin`.");
      } else {
        if (!isOnlyAdminException(remoteJid, targetJid)) {
          throw new WarningError("Este usuario no estaba en la lista de excepciones.");
        }
        removeOnlyAdminException(remoteJid, targetJid);
        await sendSuccessReact();
        return sendReply("🚫 Excepción removida del usuario correctamente.");
      }
    }

    throw new InvalidParameterError("Opción no válida. Usa 1, 0, + o -.");
  },
};




