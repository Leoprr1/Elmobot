# 🤖 Elmobot

<div align="center">
    <img src="./assets/images/takeshi-bot.png" width="500">
</div>

<br />

<div align="center">
    <a href="https://github.com/Leoprr1/Elmobot">
        <img alt="Versión" src="https://img.shields.io/badge/Vers%C3%A3o-10.0.0-blue">
    </a>
</div>

<br />

> Bot de WhatsApp multifuncional listo para usar.
## este bot fue creado utilizando de base el takeshi-bot original de guiireal
## el tutorial de instalacion de este bot Elmobot esta en el repositorio

[![Node.js](https://img.shields.io/badge/Node.js-22.14-green?logo=node.js)](https://nodejs.org/en)
[![Baileys](https://img.shields.io/badge/Baileys-6.7.18-purple?logo=whatsapp)](https://github.com/WhiskeySockets/Baileys)
[![PM2](https://img.shields.io/badge/PM2-Latest-online?logo=pm2)](https://pm2.keymetrics.io/)

---

## 📋 Índice

1. [Requisitos previos](#-requisitos-previos)
2. [Instalación del bot](#-instalación-del-bot)
3. [Vinculación con WhatsApp](#-vinculación-con-whatsapp)
4. [Actualización del proyecto](#-actualización-del-proyecto)
5. [Ejecución en segundo plano con PM2](#-ejecución-en-segundo-plano-con-pm2)
6. [Monitoreo y gestión](#-monitoreo-y-gestión)
7. [Actualización de librerías](#-actualización-de-librerías)
8. [Control de procesos](#-control-de-procesos)
9. [Actualizar librería Baileys](#-actualizar-librería-baileys)

---

## 📌 Requisitos previos

para correr este bot debes de tener instalado node (se recomienda instalarlo con NVM en Windows usando `nvm install lts` y `nvm use lts`)

---

## 📥 Instalación del bot

para la instalacion del bot copia y pega esto en el cmd:

```cmd
cd C:\ruta donde quieras que se instale
git clone [https://github.com/Leoprr1/Elmobot.git](https://github.com/Leoprr1/Elmobot.git)
cd Elmobot
npm install

📱 Vinculación con WhatsApp
una vez completado arranca el bot con npm start para enlazar el bot al whatsapp con el QR,
cuando ya haya enlazado el bot al whatsapp cerra el proceso con control+C
🔄 Actualización del proyecto
para actualizar el bot con las nuevas modificaciones del github pone esto:

cd C:\ruta donde instalaste el bot\Elmobot
git pull

⚙️ Ejecución en segundo plano con PM2
luego para arrancar el bot con los siguientes comandos debes de instalar pm2:

npm install -g pm2

para arrancar el bot luego de hacer npm start y cerrar el cmd
copia y pega en el cmd todo esto hasta pm2 save --force:

pm2 install pm2-logrotate
cd C:\ruta donde instalaste el bot\Elmobot
set UV_THREADPOOL_SIZE=8 && pm2 start index.js --max-memory-restart 800M --node-args="--expose-gc --max-old-space-size=1536 --no-warnings"
pm2 start backup-rpg.js --name "b"
pm2 save --force

si se te borran los procesos menos el pm2 logrotate en el pm2 monit
copia y pega en el cmd solo desde el cd C:\ruta donde instalaste el bot\takeshi-new hasta el pm2 save --force
(y bueno si se te borraron todos los procesos incluso el pm2 logrotate copia todo)
📊 Monitoreo y gestión
para ver todos los procesos solo pone (con las flechitas del teclado podes moverte del monit):

pm2 monit

(no hace falta poner el cd C:\ruta donde instalaste el bot)


📦 Actualización de librerías
esto es un check update, se encarga de buscar las ultimas actualizaciones de las librerias:

cd C:\ruta donde instalaste el bot\Elmobot
npm install -g npm-check-updates

una vez instalado solo pone esto cuando quieras actualizar las librerias:

cd C:\ruta donde instalaste el bot\Elmobot
npx npm-check-updates -u
npm install


🛠️ Control de procesos

para reiniciar el proceso del bot del pm2:
pm2 restart index

para pararlo:
pm2 stop index

para parar todos los procesos:
pm2 stop all


⚡ Actualizar librería Baileys
por si solo vas a actualizar el baileys:
cd C:\ruta donde instalaste el bot\Elmobot
npm install @whiskeysockets/baileys@latest

