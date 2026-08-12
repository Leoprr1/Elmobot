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
  name: "mp3",
  description: "Descarga y envía audio MP3 desde YouTube optimizado (320k)",
  commands: ["mp3", "playmp3", "pam"],
  usage: `${PREFIX}mp3 duki goteo`,

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
      cacheFile = path.join(CACHE_DIR, `${safeTitle}.mp3`);

      // Cambio a Bitrate 320k
      const audioBitrate = "320k";
      const estimatedBytes = (320000 / 8) * lengthSeconds;
      const fileSizeMB = (estimatedBytes / (1024 * 1024)).toFixed(2);
      const minutes = Math.floor(lengthSeconds / 60);
      const seconds = lengthSeconds % 60;

      /* ===============================
         🔗 GENERAR / ENVIAR AUDIO
      ================================ */

      if (fs.existsSync(cacheFile)) {
        console.log("⚡ Usando audio MP3 cacheado");

        if (thumb) {
          await sendImageFromURL(
            thumb,
            `\`*Título*:\` ${title}\n\`*Duración*:\` ${minutes}m ${seconds}s\n\`*Canal*:\` ${channel}\n\`*Bitrate*:\` ${audioBitrate}\n\`*Peso*:\` ${fileSizeMB}MB`
          ).catch(() => {});
        }
        
        await socket.sendMessage(remoteJid, {
          audio: fs.readFileSync(cacheFile),
          mimetype: "audio/mpeg",
          ptt: false
        });

      } else {
        const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 9999);
        const tempFile = path.join(os.tmpdir(), `${uniqueId}.mp3`);

        const ytDlpPath = path.join(process.cwd(), "yt-dlp.exe");
        
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

        // Configuración de FFmpeg forzando 320k en MP3
        const ff = spawn(ffmpegPath, [
          "-i", "pipe:0",
          "-vn",
          "-c:a", "libmp3lame",
          "-b:a", audioBitrate,
          "-ar", "44100",
          "-ac", "2",
          "-avoid_negative_ts", "make_zero",
          "-map_metadata", "-1",
          "-f", "mp3",
          tempFile
        ], {
          windowsHide: true,
          stdio: ["pipe", "ignore", "ignore"],
          creationFlags: 0x08000000
        });

        let ytErrorLog = "";
        yt.stderr.on("data", (chunk) => { ytErrorLog += chunk.toString(); });

        yt.stdout.pipe(ff.stdin);

        await new Promise((resolve, reject) => {
          ff.on("error", reject);
          ff.on("close", async code => {
            if (code === 0 && fs.existsSync(tempFile)) {

              if (thumb) {
                await sendImageFromURL(
                  thumb,
                  `\`*Título*:\` ${title}\n\`*Duración*:\` ${minutes}m ${seconds}s\n\`*Canal*:\` ${channel}\n\`*Bitrate*:\` ${audioBitrate}\n\`*Peso*:\` ${fileSizeMB}MB`
                ).catch(() => {});
              }
              
              await socket.sendMessage(remoteJid, {
                audio: fs.readFileSync(tempFile),
                mimetype: "audio/mpeg",
                ptt: false
              });

              fs.copyFileSync(tempFile, cacheFile);
              fs.unlinkSync(tempFile);
              cleanCache();
              resolve();
            } else {
              if (ytErrorLog) console.error("🔴 LOG REAL DE YT-DLP:\n", ytErrorLog.trim());
              reject(new Error("Error generando audio MP3"));
            }
          });
        });
      }

      await sendSuccessReact();
      return;

    } catch (err) {
      console.error(`Error en mp3 (intento ${globalAttempt}):`, err);

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

