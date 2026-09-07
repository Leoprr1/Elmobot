/**
 * Servicios de procesamiento de media con ffmpeg + sharp.
 * Versión optimizada y estable para stickers (imagen + video).
 */

const fs = require("node:fs");
const path = require("node:path");
const https = require("https");
const http = require("http");
const ffmpeg = require("fluent-ffmpeg");
const sharp = require("sharp");
const { exec } = require("node:child_process");

// Binario centralizado
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
ffmpeg.setFfmpegPath(ffmpegPath);

const { getRandomNumber } = require("../utils");
const { errorLog } = require("../utils/logger");
const { TEMP_DIR } = require("../config");

class FfmpegService {
  constructor() {
    this.tempDir = TEMP_DIR;
  }

  // -------------------
  // CREAR RUTA TEMPORAL
  // -------------------
  async _createTempFilePath(extension = "png") {
    return path.join(
      this.tempDir,
      `${getRandomNumber(10000, 99999)}.${extension}`
    );
  }

  // -------------------
  // DESCARGAR IMAGEN DESDE URL
  // -------------------
  async downloadImage(url, outputPath) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      client
        .get(url, (res) => {
          if (res.statusCode !== 200)
            return reject(new Error(`HTTP ${res.statusCode}`));
          const file = fs.createWriteStream(outputPath);
          res.pipe(file);
          file.on("finish", () => {
            file.close(resolve);
          });
        })
        .on("error", reject);
    });
  }

  // -------------------
  // EJECUTAR FFmpeg (SIN VENTANA DE CMD)
  // -------------------
  _runFfmpeg(inputPath, outputPath, options = []) {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .outputOptions(options)
        .save(outputPath);

      // ⚡ Ocultar ventana de CMD para fluidez en Windows
      if (command._process) {
        command._process.options = {
          ...command._process.options,
          windowsHide: true,
          creationFlags: 0x08000000,
        };
      }

      command
        .on("end", () => resolve(outputPath))
        .on("error", (err) => {
          errorLog("FFmpeg error:", err);
          reject(err);
        });
    });
  }

  // -------------------
  // FILTROS DE IMAGEN
  // -------------------
  async applyBlur(inputPath, intensity = "7:5") {
    const outputPath = await this._createTempFilePath();
    return this._runFfmpeg(inputPath, outputPath, [`-vf boxblur=${intensity}`]);
  }

  async convertToGrayscale(inputPath) {
    const outputPath = await this._createTempFilePath();
    return this._runFfmpeg(inputPath, outputPath, ["-vf format=gray"]);
  }

  async mirrorImage(inputPath) {
    const outputPath = await this._createTempFilePath();
    return this._runFfmpeg(inputPath, outputPath, ["-vf hflip"]);
  }

  async adjustContrast(inputPath, contrast = 1.2) {
    const outputPath = await this._createTempFilePath();
    return this._runFfmpeg(inputPath, outputPath, [`-vf eq=contrast=${contrast}`]);
  }

  async applyPixelation(inputPath) {
    const outputPath = await this._createTempFilePath();
    return this._runFfmpeg(inputPath, outputPath, [
      "-vf scale=iw/6:ih/6,scale=iw*6:iw*6:flags=neighbor",
    ]);
  }

  // -------------------
  // DETECTAR SI WEBP ES ANIMADO
  // -------------------
  async isWebpAnimated(inputPath) {
    try {
      const metadata = await sharp(inputPath, { animated: true }).metadata();
      return Boolean(metadata.pages && metadata.pages > 1);
    } catch {
      return false;
    }
  }

  // -------------------
  // CONVERTIR WEBP ANIMADO A MP4 (COMPATIBLE CON WHATSAPP)
  // -------------------
  async convertWebpToGif(inputPath, outputPath = null) {
    const tempGifPath = await this._createTempFilePath("gif");
    if (!outputPath) outputPath = await this._createTempFilePath("mp4");

    try {
      // 1. Sharp genera el GIF temporal sin metadata de WhatsApp
      await sharp(inputPath, { animated: true })
        .gif({ loop: 0 })
        .toFile(tempGifPath);

      // 2. FFmpeg convierte el GIF a MP4 usando la estructura compatible con WhatsApp
      const options = [
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-vf scale=trunc(iw/2)*2:trunc(ih/2)*2", // Dimensiones pares requeridas por H.264
        "-movflags +faststart",
      ];

      const result = await this._runFfmpeg(tempGifPath, outputPath, options);
      this.cleanup(tempGifPath);
      return result;

    } catch (err) {
      this.cleanup(tempGifPath);
      throw err;
    }
  }

  // -------------------
  // CONVERTIR WEBP A PNG (ESTÁTICO)
  // -------------------
  async convertWebpToPng(inputPath, outputPath = null) {
    if (!outputPath) outputPath = await this._createTempFilePath("png");

    try {
      await sharp(inputPath, { animated: false })
        .png()
        .toFile(outputPath);

      return outputPath;
    } catch {
      return this._runFfmpeg(inputPath, outputPath, ["-vcodec png"]);
    }
  }

  // -------------------
  // CONVERTIR A STICKER (TRANSPARENTE PRO)
  // -------------------
  async convertToSticker(inputPath, outputPath = null, isImage = false) {
    if (!outputPath) outputPath = await this._createTempFilePath("webp");

    const scaleFilter =
      "format=yuva420p," +
      "scale=512:512:force_original_aspect_ratio=decrease," +
      "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000";

    if (isImage) {
      const options = [
        "-vcodec libwebp",
        `-vf ${scaleFilter}`,
        "-pix_fmt yuva420p",
        "-lossless 0",
        "-compression_level 6",
        "-qscale 90",
      ];
      return this._runFfmpeg(inputPath, outputPath, options);
    } else {
      const options = [
        "-vcodec libwebp",
        `-vf ${scaleFilter},fps=12`,
        "-pix_fmt yuva420p",
        "-loop 0",
        "-an",
        "-t 8",
        "-preset picture",
        "-lossless 0",
        "-compression_level 6",
        "-qscale 60",
        "-metadata title=",
        "-metadata author=",
      ];
      return this._runFfmpeg(inputPath, outputPath, options);
    }
  }

  // -------------------
  // OBTENER DURACIÓN (FIX WINDOWS OCULTO)
  // -------------------
  async getDuration(inputPath) {
    return new Promise((resolve) => {
      exec(
        `"${ffmpegPath}" -i "${inputPath}" 2>&1`,
        { windowsHide: true, creationFlags: 0x08000000 },
        (err, stdout, stderr) => {
          const output = stderr || stdout;
          if (!output) return resolve(0);

          const match = output.match(/Duration: (\d+):(\d+):([\d.]+)/);
          if (!match) return resolve(0);

          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const seconds = parseFloat(match[3]);

          resolve(hours * 3600 + minutes * 60 + seconds);
        }
      );
    });
  }

  // -------------------
  // CONVERTIR AUDIO A OGG OPUS (WhatsApp)
  // -------------------
  async convertToOggOpus(inputPath, outputPath = null) {
    if (!outputPath) outputPath = await this._createTempFilePath("ogg");

    const options = ["-vn", "-c:a libopus", "-ar 48000", "-ac 1", "-b:a 64k"];
    return this._runFfmpeg(inputPath, outputPath, options);
  }

  // -------------------
  // LIMPIEZA
  // -------------------
  async cleanup(filePath) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }
  }
}

module.exports = new FfmpegService();





