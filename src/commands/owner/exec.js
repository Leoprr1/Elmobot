/**
 * EXEC ADMIN PANEL PRO
 * Control total del servidor desde WhatsApp
 */

const { exec } = require("child_process");
const os = require("os");

const { isBotOwner } = require(`${BASE_DIR}/middlewares`);
const { PREFIX } = require(`${BASE_DIR}/config`);
const { DangerError } = require(`${BASE_DIR}/errors`);

const SAFE_COMMANDS = [
  "dir", "tasklist", "echo", "ver", "whoami", "systeminfo",
  "tree", "netstat", "nslookup", "pm2"
];

const DANGEROUS = [
  "rm", "rmdir", "shutdown", "reboot", "format", "del /f",
  "kill", "killall"
];

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

function clean(text) {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function formatBytes(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function formatPM2(json) {
  try {
    const list = JSON.parse(json);
    let msg = "📊 *PM2 STATUS*\n\n";

    list.forEach((p) => {
      const mem = (p.monit.memory / 1024 / 1024).toFixed(1);
      msg += `🟢 *${p.name}*
Estado: ${p.pm2_env.status}
CPU: ${p.monit.cpu}%
RAM: ${mem} MB
Reinicios: ${p.pm2_env.restart_time}

`;
    });

    return msg;
  } catch {
    return null;
  }
}

function buildPanel() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const uptime = os.uptime();

  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  return `🤖 *BOT PANEL*

🖥️ Sistema: ${os.type()}
📦 Plataforma: ${os.platform()}
⚙️ CPU: ${os.cpus()[0].model}
🧠 RAM Total: ${formatBytes(total)}
📊 RAM Usada: ${formatBytes(used)}
📉 RAM Libre: ${formatBytes(free)}

⏱️ Uptime servidor: ${hours}h ${minutes}m
🧵 Cores CPU: ${os.cpus().length}

🚀 Motor: Node.js
📡 Control: PM2
`;
}

function buildMenu() {
  return `🛠️ *EXEC ADMIN MENU*

${PREFIX}exec panel
→ Panel completo del servidor

${PREFIX}exec pm2
→ Estado de procesos del bot

${PREFIX}exec ram
→ Uso de memoria del servidor

${PREFIX}exec cpu
→ Información de CPU

${PREFIX}exec disk
→ Espacio de discos

${PREFIX}exec logs
→ Últimos logs del bot

${PREFIX}exec restartbot
→ Reinicia el bot limpiamente

${PREFIX}exec pm2 list
→ Lista de procesos PM2

${PREFIX}exec pm2 jlist
→ Lista detallada de procesos

${PREFIX}exec tasklist
→ Procesos activos en Windows

${PREFIX}exec dir
→ Ver archivos del directorio

⚠️ Solo el dueño del bot puede usar estos comandos
`;
}

module.exports = {
  name: "exec",
  commands: ["exec"],
  description: "Panel admin del servidor",

  usage: `${PREFIX}exec menu`,

  handle: async ({
    fullArgs,
    sendSuccessReply,
    sendErrorReply,
    userJid,
    isLid
  }) => {
    if (!isBotOwner({ userJid, isLid }))
      throw new DangerError("❌ Solo el dueño del bot");

    if (!fullArgs)
      throw new DangerError(`Usa: ${PREFIX}exec menu`);

    const cmd = fullArgs.toLowerCase().trim();

    /* PANEL */
    if (cmd === "panel") {
      return sendSuccessReply(buildPanel());
    }

    /* MENU */
    if (cmd === "menu") {
      return sendSuccessReply(buildMenu());
    }

    /* RAM */
    if (cmd === "ram") {
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;

      return sendSuccessReply(`🧠 *RAM SERVER*

Total: ${formatBytes(total)}
Usada: ${formatBytes(used)}
Libre: ${formatBytes(free)}
`);
    }

    /* CPU */
    if (cmd === "cpu") {
      const load = os.loadavg()[0];
      const cores = os.cpus().length;

      return sendSuccessReply(`⚙️ *CPU SERVER*

Modelo: ${os.cpus()[0].model}
Cores: ${cores}
Load: ${load}
`);
    }

    /* DISK */
    if (cmd === "disk") {
      exec("wmic logicaldisk get size,freespace,caption", (err, stdout) => {
        if (err) return sendErrorReply("Error leyendo disco");

        sendSuccessReply(`💾 *DISK*

\`\`\`
${stdout}
\`\`\`
`);
      });
      return;
    }

    /* RESTART LIMPIO (Manera correcta en PM2 / Windows) */
    if (cmd === "restartbot" || cmd === "pm2 restart index" || cmd === "pm2 restart all") {
      await sendSuccessReply("🔄 Reiniciando bot de forma limpia...");
      
      // Damos 1 segundo para garantizar que el mensaje de respuesta viaje por la red
      setTimeout(() => {
        process.exit(0); // PM2 detecta la salida de Node y reinicia el proceso automáticamente sin duplicarlo
      }, 1000);
      return;
    }

    /* LOGS */
    if (cmd === "logs") {
      exec("pm2 logs --lines 20 --nostream", (err, stdout, stderr) => {
        let out = stdout || stderr;

        out = stripAnsi(out);
        out = clean(out);

        if (out.length > 3500)
          out = out.substring(0, 3500);

        sendSuccessReply(`📜 *Últimos logs*

\`\`\`
${out}
\`\`\`
`);
      });
      return;
    }

    /* PM2 PANEL */
    if (cmd === "pm2") {
      exec("pm2 jlist", (err, stdout) => {
        const formatted = formatPM2(stdout);

        if (formatted)
          return sendSuccessReply(formatted);

        sendErrorReply("Error leyendo PM2");
      });
      return;
    }

    /* SEGURIDAD */
    for (const d of DANGEROUS) {
      if (cmd.includes(d))
        throw new DangerError("🚫 Comando peligroso bloqueado");
    }

    const first = cmd.split(" ")[0];

    if (!SAFE_COMMANDS.includes(first))
      throw new DangerError(`Comando no permitido: ${first}`);

    /* EXEC NORMAL */
    exec(cmd, { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed)
          return sendErrorReply("⏱️ Timeout");

        return sendErrorReply(err.message);
      }

      let out = stdout || stderr || "Sin salida";

      out = stripAnsi(out);
      out = clean(out);

      if (cmd.includes("pm2 jlist")) {
        const formatted = formatPM2(out);

        if (formatted)
          return sendSuccessReply(formatted);
      }

      if (out.length > 3500)
        out = out.substring(0, 3500) + "\n\n... salida truncada";

      sendSuccessReply(`🖥️ *${cmd}*

\`\`\`
${out}
\`\`\`
`);
    });
  }
};


