const { PREFIX } = require(`${BASE_DIR}/config`);
const { InvalidParameterError, WarningError } = require(`${BASE_DIR}/errors`);
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const queue = require(`${BASE_DIR}/utils/queue`);

const CACHE_DIR = path.join(__dirname, "../../cache/video");
const MAX_CACHE_MB = 200;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

module.exports = {
  name: "pv",
  description: "Descarga y envía video MP4 desde YouTube optimizado",
  commands: ["pv", "playv"],
  usage: `${PREFIX}play-video duki goteo`,

  handle: async (ctx) => {
    await queue.add(async () => {
      await executePlay(ctx);
    });
  },
};

async function executePlay({
  sendVideoFromURL,
  sendImageFromURL,
  fullArgs,
  sendWaitReact,
  sendSuccessReact,
  sendErrorReply,
}) {

  const queryRaw = Array.isArray(fullArgs) ? fullArgs.join(" ") : String(fullArgs || "");
  const query = queryRaw.trim();

  if (!query)
    throw new InvalidParameterError("¡Necesitas decirme qué video buscar!");

  await sendWaitReact();

  const maxGlobalAttempts = 5;
  let globalAttempt = 0;

  while (globalAttempt < maxGlobalAttempts) {
    globalAttempt++;

    let tempFile;
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
        throw new WarningError("El video dura más de 30 minutos.");

      /* ===============================
         🔑 CACHE
      ================================ */

      const safeTitle = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      cacheFile = path.join(CACHE_DIR, `${safeTitle}.mp4`);

      const videoBitrate = 800_000; // 800 kbps aproximado para 480p
      const estimatedBytes = (videoBitrate / 8) * lengthSeconds;
      const fileSizeMB = (estimatedBytes / (1024 * 1024)).toFixed(2);
      const minutes = Math.floor(lengthSeconds / 60);
      const seconds = lengthSeconds % 60;

      let finalFile;

      if (fs.existsSync(cacheFile)) {
        console.log("⚡ Usando video cacheado");
        finalFile = cacheFile;
      } else {
        const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 9999);
        tempFile = path.join(os.tmpdir(), `${uniqueId}.mp4`);
        finalFile = tempFile;

        const ytDlpPath = path.join(process.cwd(), "yt-dlp.exe");

        // Uso del cliente android y selector de formato optimizado para video
        const args = [
          "-f", "bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480]/ba/b",
          "--no-playlist",
          "--quiet",
          "--no-warnings",
          "--extractor-args", "youtube:player_client=android",
          "-o", tempFile.replace(/\\/g, "/"),
          videoUrl
        ];

        await new Promise((resolve, reject) => {
          const child = spawn(ytDlpPath, args, {
            windowsHide: true,
            stdio: "ignore",
            creationFlags: 0x08000000
          });

          child.on("error", err => reject(new Error("Error al ejecutar yt-dlp: " + err.message)));
          child.on("close", code => {
            if (code === 0 && fs.existsSync(tempFile)) resolve();
            else reject(new Error("No se pudo descargar el video. Código: " + code));
          });
        });

        fs.copyFileSync(tempFile, cacheFile);
        cleanCache();
      }

      /* ===============================
         📤 ENVIAR IMAGEN + VIDEO
      ================================ */

      let imagePromise = Promise.resolve();
      if (thumb) {
        imagePromise = sendImageFromURL(
          thumb,
          `\`*Título*:\` ${title}
\`*Duración*:\` ${minutes}m ${seconds}s
\`*Canal*:\` ${channel}
\`*Calidad*:\` 480p
\`*Peso*:\` ${fileSizeMB}MB`
        ).catch(() => {});
      }

      await Promise.all([
        sendVideoFromURL(finalFile),
        imagePromise
      ]);

      await sendSuccessReact();
      return;

    } catch (err) {
      console.error(`Error en play-video (intento ${globalAttempt}):`, err);
      if (globalAttempt >= maxGlobalAttempts) {
        await sendErrorReply(`❌ Ocurrió un error: ${err?.message || err}`);
        return;
      }
      console.log("Reintentando comando completo...");
      await new Promise(r => setTimeout(r, 1500));
    } finally {
      if (tempFile && fs.existsSync(tempFile) && tempFile !== cacheFile)
        fs.unlinkSync(tempFile);
    }
  }

}

/* ===============================
   🧹 LIMPIEZA CACHE
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

  console.log("🧹 Cache de video limpiado automáticamente (200MB máximo).");
}

