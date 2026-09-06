const {
  activateNsfwGroup,
  deactivateNsfwGroup,
  isActiveNsfwGroup,
} = require("../../utils/database");

const { InvalidParameterError, WarningError } = require(`${BASE_DIR}/errors`);
const { PREFIX } = require(`${BASE_DIR}/config`);

module.exports = {
  name: "nsfw",
  description: "Activa o desactiva la carpeta de comandos NSFW/Cochinos en el grupo.",
  commands: ["nsfw", "cochinos", "hot"],
  usage: `${PREFIX}nsfw 1 / 0`,

  handle: async ({ args, sendReply, sendSuccessReact, remoteJid }) => {
    if (!args.length) {
      throw new InvalidParameterError(
        `Uso correcto:\n• ${PREFIX}nsfw 1 (Activar)\n• ${PREFIX}nsfw 0 (Desactivar)`
      );
    }

    const action = args[0].trim();

    if (action === "1" || action === "0") {
      const nsfwOn = action === "1";
      const hasActive = nsfwOn && isActiveNsfwGroup(remoteJid);
      const hasInactive = !nsfwOn && !isActiveNsfwGroup(remoteJid);

      if (hasActive || hasInactive) {
        throw new WarningError(
          `¡Los comandos NSFW ya están ${nsfwOn ? "activados" : "desactivados"} en este grupo!`
        );
      }

      if (nsfwOn) activateNsfwGroup(remoteJid);
      else deactivateNsfwGroup(remoteJid);

      await sendSuccessReact();
      return sendReply(
        `¡Comandos NSFW ${nsfwOn ? "activados 🔥" : "desactivados 🚫"} en este grupo con éxito!`
      );
    }

    throw new InvalidParameterError("Opción no válida. Usa 1 o 0.");
  },
};






