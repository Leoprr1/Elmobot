/**
 * newtyc.js — Sistema de noticias desde Instagram (TyC Sports)
 * Instancia persistente + Verificación de sesión inteligente (solo lee cookies si vence la sesión).
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const crypto = require("crypto");
const { readJSON, writeJSON } = require("./database");
const ffmpegService = require("../services/ffmpeg");

let intervalStarted = false;
let globalBrowser = null;
let globalPage = null;

const MAX_ARTICLES = 10;
const HISTORY_LIMIT = 20;
const INSTAGRAM_USER = "tycsports";
const COOKIES_PATH = "./src/commands/cache/cookies.json";

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateHash(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function initBrowser() {
  if (globalBrowser) return;

  console.log("🚀 Iniciando navegador persistente de Instagram...");
  globalBrowser = await puppeteer.launch({
    headless: fs.existsSync(COOKIES_PATH),
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
    ],
  });

  globalPage = await globalBrowser.newPage();

  // Bloqueo de recursos no esenciales para máxima velocidad y ahorro de memoria
  await globalPage.setRequestInterception(true);
  globalPage.on("request", (req) => {
    const resource = req.resourceType();
    if (["font", "stylesheet"].includes(resource)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await ensureActiveSession(globalPage);
}

// Verifica si la sesión está activa; si caducó, recién ahí aplica las cookies guardadas
async function ensureActiveSession(page) {
  try {
    // Si la URL actual ya es Instagram y no estamos en la pantalla de login, comprobamos si estamos adentro
    const currentUrl = page.url();
    if (currentUrl.includes("instagram.com") && !currentUrl.includes("/accounts/login")) {
      const isLoggedIn = await page.evaluate(() => !!document.querySelector("a[href*='/p/'], a[href*='/reel/'], nav, svg[aria-label*='Home']"));
      if (isLoggedIn) return; // La sesión sigue perfecta en memoria, no hace nada.
    }

    console.log("🔑 Verificando / Restaurando sesión de Instagram...");

    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
      await page.setCookie(...cookies);
      await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

      try {
        await waitForFeed(page);
        console.log("✅ Sesión restaurada con cookies guardadas.");
        return;
      } catch {
        console.log("⚠ Las cookies expiraron o la sesión caducó.");
      }
    }

    console.log("🔐 Abriendo pantalla de login manual...");
    await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle2" });
    await waitForFeed(page);

    console.log("✅ Nueva sesión detectada, actualizando cookies...");
    const newCookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(newCookies, null, 2));
  } catch (err) {
    console.error("⚠ Error en el control de sesión:", err.message);
  }
}

async function waitForFeed(page) {
  const timeout = 15000;
  const startTime = Date.now();
  let feedDetected = false;

  while (!feedDetected && Date.now() - startTime < timeout) {
    feedDetected = await page.evaluate(() => !!document.querySelector("a[href*='/p/'], a[href*='/reel/']"));
    if (!feedDetected) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await wait(1000);
    }
  }

  if (!feedDetected) {
    throw new Error("Feed no detectado");
  }
}

async function getLatestNews(limit = MAX_ARTICLES) {
  try {
    if (!globalPage || globalPage.isClosed()) {
      await initBrowser();
    } else {
      // Revisa que la sesión siga activa antes de scrapear
      await ensureActiveSession(globalPage);
    }

    await globalPage.goto(`https://www.instagram.com/${INSTAGRAM_USER}/`, { waitUntil: "networkidle2" });
    await waitForFeed(globalPage);

    const posts = await globalPage.evaluate((max) => {
      const links = Array.from(document.querySelectorAll("a[href*='/p/'], a[href*='/reel/']")).slice(0, max);
      return links.map(a => ({
        url: a.href,
        imageUrl: a.querySelector("img")?.src || "",
      }));
    }, limit);

    console.log("📝 Posts detectados:", posts.map(p => p.url));
    return posts;
  } catch (err) {
    console.error("❌ Instagram Puppeteer error:", err.message);
    if (globalBrowser) {
      await globalBrowser.close().catch(() => {});
      globalBrowser = null;
    }
    return [];
  }
}

async function fetchNewsDetails(items) {
  const articles = [];

  for (const item of items) {
    try {
      await globalPage.goto(item.url, { waitUntil: "networkidle2" });
      await wait(1000);

      const detail = await globalPage.evaluate(() => {
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
        const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
        const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
        const timeEl = document.querySelector("time");
        const imgEl = document.querySelector("article img");

        let rawText = ogTitle || metaDesc || ogDescription;
        let cleanText = rawText
          .replace(/^.*?:/i, "")
          .replace(/^["'“\s]+|["'”\s]+$/g, "")
          .trim();

        if (rawText.includes(":") && cleanText.length < 5) {
          const parts = rawText.split(":");
          cleanText = parts.slice(1).join(":").replace(/^["'“\s]+|["'”\s]+$/g, "").trim();
        }

        return {
          summary: cleanText || rawText,
          time: timeEl ? new Date(timeEl.getAttribute("datetime")).toISOString() : "",
          imageUrl: imgEl ? imgEl.src : "",
        };
      });

      let imageBuffer = null;
      const finalImageUrl = detail.imageUrl || item.imageUrl;

      if (finalImageUrl) {
        try {
          const tmpPath = await ffmpegService._createTempFilePath("jpg");
          await ffmpegService.downloadImage(finalImageUrl, tmpPath);
          imageBuffer = fs.readFileSync(tmpPath);
          await ffmpegService.cleanup(tmpPath);
        } catch (e) {
          console.error("⚠ Error bajando imagen:", e.message);
        }
      }

      const cleanUrl = item.url.split("?")[0];
      const contentHash = generateHash(cleanUrl);

      articles.push({
        url: item.url,
        summary: detail.summary || "Sin descripción",
        time: detail.time,
        imageBuffer,
        hash: contentHash,
      });

      await wait(200);
    } catch (err) {
      console.error("Error procesando publicación:", err.message);
    }
  }

  return articles.sort((a, b) => new Date(a.time) - new Date(b.time));
}

async function sendNewsToGroups(sock, newsItem, db) {
  if (!newsItem || !db.groupsEnabled?.length) return;

  const captionText = `📰 *Noticias TyC Sports*\n\n${newsItem.summary}\n\n🔗 ${newsItem.url}`;

  for (const group of db.groupsEnabled) {
    try {
      const msgOptions = newsItem.imageBuffer
        ? { image: newsItem.imageBuffer, caption: captionText }
        : { text: captionText };

      await sock.sendMessage(group, msgOptions);
      console.log("✅ Publicación enviada a:", group);

      await wait(1000);
    } catch (err) {
      console.error("Error enviando publicación al grupo", group, ":", err.message);
    }
  }
}

let newsLock = false;

async function checkNews(sock) {
  if (newsLock) return;
  newsLock = true;

  try {
    let db = readJSON("news-tyc");
    if (!db || typeof db !== "object") db = {};

    if (db.enabled === undefined) db.enabled = true;
    if (!Array.isArray(db.lastPosts)) db.lastPosts = [];
    if (!Array.isArray(db.groupsEnabled)) db.groupsEnabled = [];

    if (!db.enabled || !db.groupsEnabled.length) return;

    const scraped = await getLatestNews(MAX_ARTICLES);
    if (!scraped.length) return;

    const articles = await fetchNewsDetails(scraped);
    if (!articles.length) return;

    const sentHashes = new Set(db.lastPosts.map(post => (typeof post === "object" ? post.hash : post)));
    const newPosts = articles.filter(article => !sentHashes.has(article.hash));

    if (!newPosts.length) {
      console.log("💤 No hay publicaciones nuevas de TyC Sports.");
      return;
    }

    for (const post of newPosts) {
      await sendNewsToGroups(sock, post, db);
      db.lastPosts.push({ url: post.url, hash: post.hash });
      sentHashes.add(post.hash);
    }

    db.lastPosts = db.lastPosts.slice(-HISTORY_LIMIT);
    writeJSON("news-tyc", db);
  } catch (err) {
    console.error("Error checkNews:", err.message);
  } finally {
    newsLock = false;
  }
}

async function startTyCSystem(sock) {
  if (intervalStarted) return;
  intervalStarted = true;

  console.log("📡 Sistema TyC Instagram iniciado");
  await initBrowser();

  setInterval(async () => {
    try {
      await checkNews(sock);
    } catch (err) {
      console.error("Interval error:", err.message);
    }
  }, 60 * 1000);
}

module.exports = { startTyCSystem };


