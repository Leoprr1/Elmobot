/**
 * Direccionador de comandos con verificación de registro de usuario
 *
 * @author Dev Gui
 */

const { checkAntiSpam } = require("./antiSpam");
const {
  DangerError,
  WarningError,
  InvalidParameterError,
} = require("../errors");

const { findCommandImport } = require(".");

const {
  verifyPrefix,
  hasTypeAndCommand,
  isAdmin,
  checkPermission,
  isBotOwner,
} = require("../middlewares");

const {
  isActiveGroup,
  isActiveAntiLinkGroup,
  isActiveOnlyAdmins,
  isOnlyAdminException, 
  isActiveNsfwGroup, // 🔞 Se importa la verificación de NSFW
  getPrefix,
  readUserProfiles,
  saveUserProfiles,
} = require("./database");

const {
  getAutoResponderResponse,
  isActiveAutoResponderGroup,
} = require("./auto-responder");

const { errorLog } = require("../utils/logger");

const { ONLY_GROUP_ID, BOT_EMOJI } = require("../config");

const { badMacHandler } = require("./badMacHandler");
const { isPrivateModeEnabled } = require("./privatemode");


/* =====================================================
   🔹 CACHE SYSTEM (MEJORA DE PERFORMANCE)
===================================================== */

const commandCache = new Map();
let usersCache = readUserProfiles();


/* cache comandos */
function getCommandCached(name) {
  if (commandCache.has(name)) {
    return commandCache.get(name);
  }

  const cmd = findCommandImport(name);
  commandCache.set(name, cmd);
  return cmd;
}

/* autosave usuarios cada 30s */
setInterval(() => {
  try {
    saveUserProfiles(usersCache);
  } catch {}
}, 300000);

/* Helper para normalizar sexo */
function parseGender(input) {
  if (!input) return "No especificado";
  const val = input.toLowerCase();
  if (["h", "hombre", "masculino", "m"].includes(val)) return "Hombre 👨";
  if (["f", "mujer", "femenino"].includes(val)) return "Mujer 👩";
  return input.charAt(0).toUpperCase() + input.slice(1);
}

/**
 * Verifica si el usuario está registrado
 */
async function requireRegistration(userJid, sendWarningReply) {
  if (!usersCache[userJid]) {
    await sendWarningReply(
      "⚠️ Necesitas registrarte primero usando:\n.reg TuNombre Edad Sexo\nEjemplo: .reg Leo 23 hombre"
    );
    return false;
  }

  return true;
}

/**
 * Registra o actualiza usuario (con campo sexo/gender)
 */
function registerUser(userJid, name, age, gender, profilePic = null) {
  const now = Date.now();

  if (!usersCache[userJid]) {
    usersCache[userJid] = {
      name,
      age,
      gender,
      profilePic,
      registeredAt: now,
      commandsUsed: 0,
    };
  } else {
    usersCache[userJid].name = name;
    usersCache[userJid].age = age;
    usersCache[userJid].gender = gender;

    if (profilePic) {
      usersCache[userJid].profilePic = profilePic;
    }
  }

  saveUserProfiles(usersCache);
}

/**
 * Incrementa contador de comandos usados
 */
function incrementCommandCount(userJid) {
  if (usersCache[userJid]) {
    usersCache[userJid].commandsUsed =
      (usersCache[userJid].commandsUsed || 0) + 1;
  }
}


/**
 * @param {CommandHandleProps} paramsHandler
 * @param {number} startProcess
 */

exports.dynamicCommand = async (paramsHandler, startProcess) => {
  const {
    commandName,
    fullMessage,
    isLid,
    prefix,
    remoteJid,
    sendErrorReply,
    sendReact,
    sendReply,
    sendWarningReply,
    socket, // Conexión activa de Baileys
    userJid,
    webMessage,
  } = paramsHandler;

  /* =====================================================
     🟢 REGISTRO GLOBAL DE CONEXIÓN Y GRUPOS ACTIVOS (RPG DROPS)
  ===================================================== */
  if (socket) {
    global.conn = socket;
    global.sock = socket;
  }

  if (!global.ACTIVE_RPG_GROUPS) {
    global.ACTIVE_RPG_GROUPS = new Map();
  }

  if (remoteJid && remoteJid.endsWith("@g.us")) {
    global.ACTIVE_RPG_GROUPS.set(remoteJid, {
      conn: socket,
      lastMsg: webMessage,
      sendReply
    });
  }

  if (!global.enviarMensajeGrupo) {
    global.enviarMensajeGrupo = async (jidGrupo, texto) => {
      const activeSocket = global.conn || global.sock || socket;
      if (!activeSocket || typeof activeSocket.sendMessage !== "function") {
        throw new Error("No hay socket activo en global.conn");
      }
      return await activeSocket.sendMessage(jidGrupo, { text: texto });
    };
  }
  /* ===================================================== */

  const message = (fullMessage || "").trim();
  const activeGroup = isActiveGroup(remoteJid);

  /* =========================================
     🔹 ANTILINK GLOBAL
  ========================================= */

  if (activeGroup && isActiveAntiLinkGroup(remoteJid)) {

    if (!userJid) return;
    if (webMessage.key.fromMe) return;

    if (
      message.includes("http") ||
      message.includes("www.") ||
      message.includes("chat.whatsapp.com")
    ) {

      const linkRegex =
        /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/i;

      if (linkRegex.test(message)) {

        const userIsAdmin = await isAdmin({ remoteJid, userJid, socket });

        if (!userIsAdmin) {

          await sendReply(
            "🚫 Anti-link activado. Usuario removido por enviar enlaces."
          );

          await socket.groupParticipantsUpdate(remoteJid, [userJid], "remove");

          await socket.sendMessage(remoteJid, {
            delete: {
              remoteJid,
              fromMe: false,
              id: webMessage.key.id,
              participant: webMessage.key.participant,
            },
          });

          return;
        }
      }
    }
  }


  /* =========================================
     🔹 DETECTAR COMANDO
  ========================================= */

  const isCommandMessage = message.startsWith(prefix);

  if (!remoteJid.endsWith("@g.us") && !isPrivateModeEnabled() && !isBotOwner({ userJid, isLid })) {
    return;
  }

  if (!isCommandMessage) {

    if (isActiveAutoResponderGroup(remoteJid)) {
      const response = getAutoResponderResponse(message);
      if (response) await sendReply(response);
    }

    return;
  }


  const withoutPrefix = message.slice(prefix.length).trim();
  const [cmd, ...args] = withoutPrefix.split(/\s+/);


  if (cmd === "reg" || cmd === "reg2") {

    if (args.length < 3) {
      await sendWarningReply("Uso: .reg Nombre Edad Sexo\nEjemplo: .reg Leo 23 hombre");
      return;
    }

    const name = args[0];
    const age = parseInt(args[1]);
    const genderRaw = args[2];

    if (isNaN(age) || !genderRaw) {
      await sendWarningReply("⚠️ Asegúrate de ingresar una edad numérica válida y el sexo.");
      return;
    }

    const gender = parseGender(genderRaw);
    let profilePic = null;

    try {
      profilePic = await socket.profilePictureUrl(userJid).catch(() => null);
    } catch {}

    registerUser(userJid, name, age, gender, profilePic);

    await sendReply(
      `✅ Usuario registrado correctamente como ${name}, ${age} años, ${gender}.`
    );

    return;
  }


  const { type, command } = getCommandCached(commandName);


  if (!hasTypeAndCommand({ type, command })) {

    if (isActiveAutoResponderGroup(remoteJid)) {
      const response = getAutoResponderResponse(message);
      if (response) await sendReply(response);
    }

    return;
  }


  if (!(await requireRegistration(userJid, sendWarningReply))) return;

  incrementCommandCount(userJid);

  if (ONLY_GROUP_ID && ONLY_GROUP_ID !== remoteJid) return;


  if (activeGroup) {

    if (
      !verifyPrefix(prefix, remoteJid) ||
      !hasTypeAndCommand({ type, command })
    ) {
      return;
    }

    if (!(await checkPermission({ type, ...paramsHandler }))) {
      await sendErrorReply("¡No tienes permiso para ejecutar este comando!");
      return;
    }

    if (
      isActiveOnlyAdmins(remoteJid) &&
      !(await isAdmin({ remoteJid, userJid, socket })) &&
      !isBotOwner({ userJid, isLid }) &&
      !isOnlyAdminException(remoteJid, userJid) 
    ) {
      await sendWarningReply(
        "¡Solo los administradores pueden ejecutar comandos!"
      );
      return;
    }

    /* =========================================
       🔞 CONTROL DE CARPETA/COMANDOS NSFW
    ========================================= */
    const isNsfwCommand =
      command?.category === "nsfw" ||
      command?.folder === "nsfw" ||
      command?.filePath?.includes("nsfw");

    if (isNsfwCommand && !isActiveNsfwGroup(remoteJid)) {
      await sendWarningReply(
        "🔞 Los comandos NSFW están desactivados en este grupo. Un administrador puede activarlos con .nsfw 1"
      );
      return;
    }
  }


  // 🚫 SI EL GRUPO ESTÁ DESACTIVADO (MANEJO DEL COMANDO .ON)
  if (!isBotOwner({ userJid, isLid }) && !activeGroup) {

    if (verifyPrefix(prefix, remoteJid) && hasTypeAndCommand({ type, command })) {

      // Permite únicamente ejecutar el comando de encendido
      if (command.name !== "on" && command.name !== "group-toggle") {
        await sendWarningReply(
          "⚠️ ¡Este grupo está desactivado! Un administrador debe usar .on para reactivarlo."
        );
        return;
      }

      // Validar si quien intenta usar .on es Admin del grupo
      const userIsAdmin = await isAdmin({ remoteJid, userJid, socket });

      if (!userIsAdmin) {
        await sendErrorReply("¡No tienes permiso para ejecutar este comando!");
        return;
      }

    } else return;
  }


  if (!verifyPrefix(prefix, remoteJid)) return;

  const groupPrefix = getPrefix(remoteJid);

  if (message === groupPrefix) {
    await sendReact(BOT_EMOJI);
    await sendReply(
      `¡Este es mi prefijo! ¡Usa ${groupPrefix}menu para ver los comandos disponibles!`
    );
    return;
  }


  if (!isBotOwner({ userJid, isLid })) {

    const antiSpam = checkAntiSpam(userJid);

    if (antiSpam.blocked) {

      if (antiSpam.suspended) {
        await sendErrorReply(
          `🚫 Has sido suspendido por spam.\nIntenta nuevamente en ${antiSpam.remainingMinutes} minuto(s).`
        );
      } else {
        await sendWarningReply(
          `⏳ Espera ${antiSpam.remainingSeconds}s antes de usar otro comando.\nAdvertencias restantes: ${antiSpam.remainingWarnings}`
        );
      }

      return;
    }
  }


  const mentionedJid =
    webMessage?.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    webMessage?.message?.imageMessage?.contextInfo?.mentionedJid ||
    webMessage?.message?.videoMessage?.contextInfo?.mentionedJid ||
    webMessage?.message?.conversation?.contextInfo?.mentionedJid ||
    [];


  try {

    await command.handle({
      ...paramsHandler,
      type,
      startProcess,
      m: webMessage,
      mentionedJid,
    });

  } catch (error) {

    if (badMacHandler.handleError(error, `command:${command?.name}`)) {
      await sendWarningReply(
        "Error temporal de sincronización. Inténtalo de nuevo en unos segundos."
      );
      return;
    }

    if (badMacHandler.isSessionError(error)) {
      errorLog(
        `Error de sesión durante la ejecución del comando ${command?.name}: ${error.message}`
      );
      await sendWarningReply(
        "Error de comunicación. Intenta ejecutar el comando nuevamente."
      );
      return;
    }

    if (error instanceof InvalidParameterError) {
      await sendWarningReply(`¡Parámetros inválidos! ${error.message}`);
    } else if (error instanceof WarningError) {
      await sendWarningReply(error.message);
    } else if (error instanceof DangerError) {
      await sendErrorReply(error.message);
    } else {
      errorLog("Error al ejecutar comando", error);
      await sendErrorReply(
        `Ocurrió un error al ejecutar el comando ${command.name}!\n📄 *Detalles*: ${error.message}`
      );
    }
  }
};

