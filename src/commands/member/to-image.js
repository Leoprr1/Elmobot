const fs = require("fs");
const path = require("path");
const { getRandomName } = require(`${BASE_DIR}/utils`);
const { InvalidParameterError } = require(`${BASE_DIR}/errors`);
const { PREFIX, TEMP_DIR } = require(`${BASE_DIR}/config`);
const Ffmpeg = require(`${BASE_DIR}/services/ffmpeg`);

module.exports = {
  name: "toimage",
  description: "Convierte stickers estáticos o animados a PNG o Video MP4",
  commands: ["toimage", "toimg"],
  usage: `${PREFIX}toimage (responde a un sticker)`,

  handle: async ({
    isSticker,
    downloadSticker,
    webMessage,
    sendWaitReact,
    sendSuccessReact,
    sendImageFromFile,
    sendVideoFromFile,
    sendErrorReply,
  }) => {
    if (!isSticker) {
      throw new InvalidParameterError("¡Necesitas responder a un sticker!");
    }

    await sendWaitReact();

    const outputBase = getRandomName();
    const outputPath = path.resolve(TEMP_DIR, outputBase);
    let inputPath = null;
    let finalOutput = null;

    try {
      // -------------------
      // DESCARGAR STICKER CON NOMBRE ÚNICO
      // -------------------
      const uniqueInputName = `input_${getRandomName()}`;
      inputPath = await downloadSticker(webMessage, uniqueInputName);

      if (!fs.existsSync(inputPath) || fs.statSync(inputPath).size === 0) {
        throw new Error("El sticker descargado está vacío o corrupto");
      }

      // -------------------
      // DETECTAR SI ES ANIMADO
      // -------------------
      const isAnimated = await Ffmpeg.isWebpAnimated(inputPath);

      // -------------------
      // CONVERTIR Y ENVIAR SEGÚN TIPO
      // -------------------
      if (isAnimated) {
        finalOutput = `${outputPath}.mp4`;
        await Ffmpeg.convertWebpToGif(inputPath, finalOutput);

        if (!fs.existsSync(finalOutput)) {
          throw new Error("FFmpeg no creó el archivo MP4 de salida");
        }

        await sendSuccessReact();
        
        if (typeof sendVideoFromFile === "function") {
          await sendVideoFromFile(finalOutput, true);
        } else {
          await sendImageFromFile(finalOutput);
        }
      } else {
        finalOutput = `${outputPath}.png`;
        await Ffmpeg.convertWebpToPng(inputPath, finalOutput);

        if (!fs.existsSync(finalOutput)) {
          throw new Error("FFmpeg no creó el archivo PNG de salida");
        }

        await sendSuccessReact();
        await sendImageFromFile(finalOutput);
      }

      // -------------------
      // LIMPIEZA
      // -------------------
      await Ffmpeg.cleanup(inputPath);
      if (finalOutput) await Ffmpeg.cleanup(finalOutput);

    } catch (err) {
      console.error("[TOIMAGE ERROR]", err);
      if (inputPath && fs.existsSync(inputPath)) await Ffmpeg.cleanup(inputPath);
      if (finalOutput && fs.existsSync(finalOutput)) await Ffmpeg.cleanup(finalOutput);
      return sendErrorReply(`❌ Error al procesar el sticker: ${err.message}`);
    }
  },
};




