const { PREFIX } = require(`${BASE_DIR}/config`);
const { InvalidParameterError, WarningError } = require(`${BASE_DIR}/errors`);
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const queue = require(`${BASE_DIR}/utils/queue`);

const CACHE_DIR = path.join(__dirname, "../../cache/audio");
const MAX_CACHE_MB = 100;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

module.exports = {
  name: "pm",
  description: "Descarga y envía audio desde YouTube optimizado",
  commands: ["pm", "play", "pa"],
  usage: `${PREFIX}play duki goteo`,

  handle: async (ctx) => {
    await queue.add(async () => {
      await executePlay(ctx);
    });
  },
};

async function executePlay({
  socket,
  remoteJid,
  sendImageFromURL,
  fullArgs,
  sendWaitReact,
  sendSuccessReact,
  sendErrorReply,
}) {
  const queryRaw = Array.isArray(fullArgs) ? fullArgs.join(" ") : String(fullArgs || "");
  const query = queryRaw.trim();

  if (!query)
    throw new InvalidParameterError("¡Necesitas decirme qué canción buscar!");

  await sendWaitReact();

  const maxGlobalAttempts = 5;
  let globalAttempt = 0;

  while (globalAttempt < maxGlobalAttempts) {
    globalAttempt++;

    let cacheFile;

    try {
      let videoUrl, title, lengthSeconds, thumb, channel;

      /* ===============================
         🔎 BUSCAR VIDEO
      ================================ */

      if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)/.test(query)) {
        videoUrl = query;
        const basic = await yts({ videoId: query.split("v=")[1]?.split("&")[0] });
        title = basic?.title || "Desconocido";
        lengthSeconds = basic?.seconds || 0;
        thumb = basic?.thumbnail;
        channel = basic?.author?.name || "Desconocido";
      } else {
        const res = await yts(query);
        const vid = res?.videos?.[0];
        if (!vid) {
          await sendErrorReply("❌ No encontré resultados en YouTube.");
          return;
        }
        videoUrl = vid.url;
        title = vid.title;
        lengthSeconds = vid.seconds;
        thumb = vid.thumbnail;
        channel = vid.author?.name || "Desconocido";
      }

      if (lengthSeconds > 30 * 60)
        throw new WarningError("El audio dura más de 30 minutos.");

      /* ===============================
         🔑 CACHE
      ================================ */

      const safeTitle = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      cacheFile = path.join(CACHE_DIR, `${safeTitle}.opus`);

      const audioBitrate = "130k";
      const estimatedBytes = (130000 / 8) * lengthSeconds;
      const fileSizeMB = (estimatedBytes / (1024 * 1024)).toFixed(2);
      const minutes = Math.floor(lengthSeconds / 60);
      const seconds = lengthSeconds % 60;

      /* ===============================
         🔗 GENERAR / ENVIAR AUDIO
      ================================ */

      if (fs.existsSync(cacheFile)) {
        console.log("⚡ Usando audio cacheado");

        // Luego enviamos la imagen
        if (thumb) {
          await sendImageFromURL(
            thumb,
            `\`*Título*:\` ${title}
\`*Duración*:\` ${minutes}m ${seconds}s
\`*Canal*:\` ${channel}
\`*Bitrate*:\` ${audioBitrate}
\`*Peso*:\` ${fileSizeMB}MB`
          ).catch(() => {});
        }
        // Primero enviamos el audio
        await socket.sendMessage(remoteJid, {
          audio: fs.readFileSync(cacheFile),
          mimetype: "audio/ogg; codecs=opus",
          ptt: true
        });

      } else {
        const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 9999);
        const tempFile = path.join(os.tmpdir(), `${uniqueId}.opus`);

        const ytDlpPath = path.join(process.cwd(), "yt-dlp.exe");
        
        // Uso del cliente android y fallback a ba/b para saltear el bloqueo de IP sin usar cookies
        const yt = spawn(ytDlpPath, [
          "-f", "ba/b",
          "--no-playlist",
          "--quiet",
          "--no-warnings",
          "--extractor-args", "youtube:player_client=android",
          "-o", "-",
          videoUrl
        ], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          creationFlags: 0x08000000
        });

        // FFmpeg formateado explícitamente con corrección de timestamps y metadatos
        const ff = spawn(ffmpegPath, [
          "-i", "pipe:0",
          "-vn",
          "-c:a", "libopus",
          "-b:a", audioBitrate,
          "-ar", "48000",
          "-ac", "2",
          "-avoid_negative_ts", "make_zero",
          "-map_metadata", "-1",
          "-f", "ogg",
          tempFile
        ], {
          windowsHide: true,
          stdio: ["pipe", "ignore", "ignore"],
          creationFlags: 0x08000000
        });

        let ytErrorLog = "";
        yt.stderr.on("data", (chunk) => {
          ytErrorLog += chunk.toString();
        });

        yt.stdout.pipe(ff.stdin);

        await new Promise((resolve, reject) => {
          ff.on("error", reject);
          ff.on("close", async code => {
            if (code === 0 && fs.existsSync(tempFile)) {

              // Luego enviamos la imagen
              if (thumb) {
                await sendImageFromURL(
                  thumb,
                  `\`*Título*:\` ${title}
\`*Duración*:\` ${minutes}m ${seconds}s
\`*Canal*:\` ${channel}
\`*Bitrate*:\` ${audioBitrate}
\`*Peso*:\` ${fileSizeMB}MB`
                ).catch(() => {});
              }
              // Primero enviamos el audio
              await socket.sendMessage(remoteJid, {
                audio: fs.readFileSync(tempFile),
                mimetype: "audio/ogg; codecs=opus",
                ptt: false
              });

              fs.copyFileSync(tempFile, cacheFile);
              fs.unlinkSync(tempFile);
              cleanCache();
              resolve();
            } else {
              if (ytErrorLog) {
                console.error("🔴 LOG REAL DE YT-DLP:\n", ytErrorLog.trim());
              }
              reject(new Error("Error generando audio opus"));
            }
          });
        });
      }

      await sendSuccessReact();
      return;

    } catch (err) {
      console.error(`Error en play (intento ${globalAttempt}):`, err);

      if (globalAttempt >= maxGlobalAttempts) {
        await sendErrorReply(`❌ Ocurrió un error: ${err?.message || err}`);
        return;
      }

      console.log("Reintentando comando completo...");
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

/* ===============================
   🧹 LIMPIEZA DE CACHE
=============================== */

function cleanCache() {
  if (!fs.existsSync(CACHE_DIR)) return;

  const files = fs.readdirSync(CACHE_DIR).map(file => {
    const filePath = path.join(CACHE_DIR, file);
    const stats = fs.statSync(filePath);
    return { path: filePath, size: stats.size, mtime: stats.mtimeMs };
  });

  let totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const maxBytes = MAX_CACHE_MB * 1024 * 1024;

  if (totalSize <= maxBytes) return;

  files.sort((a, b) => a.mtime - b.mtime);

  for (const file of files) {
    if (totalSize <= maxBytes) break;
    fs.unlinkSync(file.path);
    totalSize -= file.size;
  }

  console.log("🧹 Cache limpiado automáticamente para no superar 100MB.");
}

