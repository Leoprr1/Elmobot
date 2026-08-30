/**
 * Comando sticker next-gen: detecta imagen/GIF/Video y crea sticker WebP automáticamente
 *
 * @author MRX + Dev Gui
 */
const fs = require("node:fs");
const { getRandomName } = require(`${BASE_DIR}/utils`);
const { addStickerMetadata } = require(`${BASE_DIR}/services/sticker`);
const { InvalidParameterError } = require(`${BASE_DIR}/errors`);
const { PREFIX, BOT_NAME, BOT_EMOJI } = require(`${BASE_DIR}/config`);
const Ffmpeg = require(`${BASE_DIR}/services/ffmpeg`);

module.exports = {
  name: "sticker",
  description: "Crea stickers de cualquier imagen, GIF o video ≤10s automáticamente",
  commands: ["f", "s", "sticker", "fig", "adhesivo", "calcomanía"],
  usage: `${PREFIX}sticker (marca o responde a media)`,
  handle: async ({
    isImage,
    isVideo,
    downloadImage,
    downloadVideo,
    webMessage,
    sendErrorReply,
    sendWaitReact,
    sendSuccessReact,
    remoteJid, // 👈 Inyectamos el JID del chat
    socket, // 👈 O client / conn según cómo reciba el socket tu framework
    userJid,
  }) => {
    if (!isImage && !isVideo) {
      throw new InvalidParameterError(
        `¡Necesitas marcar o responder a una imagen/GIF/video!`
      );
    }

    await sendWaitReact();

    const username =
      webMessage.pushName ||
      webMessage.notifyName ||
      userJid.replace(/@s.whatsapp.net/, "");

    const metadata = {
      username,
      botName: `${BOT_EMOJI} ${BOT_NAME}`,
    };

    const outputPath = getRandomName("webp");
    let inputPath = null;

    try {
      // -------------------
      // DESCARGA
      // -------------------
      inputPath = isImage
        ? await downloadImage(webMessage, getRandomName())
        : await downloadVideo(webMessage, getRandomName());

      // -------------------
      // VERIFICAR DURACIÓN PARA VIDEO/GIF
      // -------------------
      if (isVideo) {
        const duration = await Ffmpeg.getDuration(inputPath);
        if (duration > 10) {
          await Ffmpeg.cleanup(inputPath);
          return sendErrorReply(
            `¡El video/GIF tiene más de 10 segundos! Envía uno más corto.`
          );
        }
      }

      // -------------------
      // CONVERTIR A STICKER WEBP
      // -------------------
      await Ffmpeg.convertToSticker(inputPath, outputPath, isImage);

      if (!fs.existsSync(outputPath))
        throw new Error("FFmpeg no creó el archivo de salida");

      // -------------------
      // AGREGAR METADATOS
      // -------------------
      const stickerPath = await addStickerMetadata(
        await fs.promises.readFile(outputPath),
        metadata
      );

      await sendSuccessReact();

      // -------------------
      // ENVIAR STICKER SIN CITA / SIN CONTORNO
      // -------------------
      await socket.sendMessage(remoteJid, {
        sticker: fs.readFileSync(stickerPath),
      });

      // -------------------
      // LIMPIEZA
      // -------------------
      await Ffmpeg.cleanup(inputPath);
      await Ffmpeg.cleanup(outputPath);
      await Ffmpeg.cleanup(stickerPath);

    } catch (err) {
      console.error("Error detallado en sticker:", err);
      if (inputPath) await Ffmpeg.cleanup(inputPath);
      if (fs.existsSync(outputPath)) await Ffmpeg.cleanup(outputPath);
      return sendErrorReply(`❌ Error al procesar el sticker: ${err.message}`);
    }
  },
};


