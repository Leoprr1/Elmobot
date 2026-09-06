/**
 * Menú del bot
 *
 * @author Dev Gui
 */
const { getDB } = require("./utils/jsoncache");
const { readMore } = require("./utils");
const { getPrefix } = require("./utils/database");

let MENU_CACHE = null;

function getMenu(groupJid) {
  if (MENU_CACHE) return MENU_CACHE;
  MENU_CACHE = getDB("menu"); // lee menu.json
  return MENU_CACHE;
}

function menuMessage(groupJid) {
  const menu = getMenu(groupJid);
  const prefix = getPrefix(groupJid);
  const date = new Date();

  let msg = `╭━━⪩ ¡BIENVENIDO! ⪨━━${readMore()}
▢
▢ • \`${menu.BOT_NAME}\`
▢ • \`Fecha: ${date.toLocaleDateString("es-ES")}\`
▢ • \`Hora: ${date.toLocaleTimeString("es-ES")}\`
▢ • \`Prefijo: ${prefix}\`
▢ • \`Versión: ${menu.VERSION}\`
▢
╰━━─「🪐」─━━\n\n`;

  const sectionEmojis = {
    social: "🌐",
    owner: "🌌",
    perfil: "🧬",
    admins: "🛡️",
    rpg: "⭐",
    principal: "🎡",
    nsfw: "🥵",
  };

  for (const [sectionName, sectionItems] of Object.entries(menu)) {
    // omitimos BOT_NAME y VERSION
    if (["BOT_NAME", "VERSION"].includes(sectionName)) continue;
    if (!sectionItems || sectionItems.length === 0) continue;

    msg += `╭━━⪩ ${sectionName.toUpperCase()} ⪨━━\n`;

    if (sectionName === "social") {
      sectionItems.forEach(s => {
        msg += `▢ • \`${s.name}:\` ${s.link}\n`;
      });
    } else {
      sectionItems.forEach(cmd => {
        msg += `▢ • \`${prefix}${cmd.command}\``;
        if (cmd.desc) msg += ` <-- *${cmd.desc}*`;
        msg += `\n`;
      });
    }

    const emoji = sectionEmojis[sectionName] || "🔹";
    msg += `╰━━─「${emoji}」─━━\n\n`;
  }

  return msg;
}

module.exports = { menuMessage, getMenu };

