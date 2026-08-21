/**
 * newtyc.js — Sistema de noticias desde Instagram (TyC Sports)
 * Método original de imágenes + Extracción limpia de título vía Meta Tags
 * Historial expandido a 20 elementos y escaneo de hasta 10 noticias.
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const crypto = require("crypto");
const { readJSON, writeJSON } = require("./database");
const ffmpegService = require("../services/ffmpeg");

let intervalStarted = false;
const MAX_ARTICLES = 10; // Extrae hasta las últimas 10 publicaciones
const HISTORY_LIMIT = 20; // Guarda en memoria los últimos 20 posteos enviados
const INSTAGRAM_USER = "tycsports";
const COOKIES_PATH = "./src/commands/cache/cookies.json";

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateHash(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function instagramLogin(page) {
  if (fs.existsSync(COOKIES_PATH)) {
    console.log("🍪 Cargando cookies guardadas...");
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
    await page.setCookie(...cookies);
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    try {
      await waitForFeed(page);
      console.log("✅ Sesión válida con cookies.");
      return;
    } catch {
      console.log("⚠ Sesión expirada. Necesario login manual.");
    }
  }

  console.log("🔐 Abriendo Instagram para login manual...");
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle2" });
  console.log("⌛ Por favor, iniciá sesión manualmente en la ventana del navegador.");
  await waitForFeed(page);

  console.log("✅ Sesión detectada, guardando cookies...");
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log("🍪 Cookies guardadas correctamente.");
}

async function waitForFeed(page) {
  const timeout = 20000;
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
    console.log("⚠ No se detectó feed, se tomará la primera publicación si existe.");
  }
}

async function getLatestNews(limit = MAX_ARTICLES) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: fs.existsSync(COOKIES_PATH),
      defaultViewport: null,
      args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await instagramLogin(page);
    await page.goto(`https://www.instagram.com/${INSTAGRAM_USER}/`, { waitUntil: "networkidle2" });
    await waitForFeed(page);

    const posts = await page.evaluate((max) => {
      const links = Array.from(document.querySelectorAll("a[href*='/p/'], a[href*='/reel/']")).slice(0, max);
      return links.map(a => ({
        url: a.href,
        imageUrl: a.querySelector("img")?.src || "",
      }));
    }, limit);

    console.log("📝 Posts detectados:", posts.map(p => p.url));
    await browser.close();
    return posts;
  } catch (err) {
    console.error("❌ Instagram Puppeteer error:", err.message);
    if (browser) await browser.close();
    return [];
  }
}

async function fetchNewsDetails(items) {
  const articles = [];
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

    for (const item of items) {
      try {
        const page = await browser.newPage();
        await page.goto(item.url, { waitUntil: "networkidle2" });
        await wait(1500);

        const detail = await page.evaluate(() => {
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

        await page.close();

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

        await wait(300);
      } catch (err) {
        console.error("Error procesando publicación:", err.message);
      }
    }
  } catch (err) {
    console.error("Error en browser detalles:", err.message);
  } finally {
    if (browser) await browser.close();
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

    if (!db.enabled) {
      console.log("⏸ Sistema TyC desactivado.");
      return;
    }

    if (!db.groupsEnabled.length) {
      console.log("⚠ No hay grupos habilitados en news-tyc.json");
      return;
    }

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

    // Conserva las últimas 20 publicaciones en el historial de la BD
    db.lastPosts = db.lastPosts.slice(-HISTORY_LIMIT);
    writeJSON("news-tyc", db);
  } catch (err) {
    console.error("Error checkNews:", err.message);
  } finally {
    newsLock = false;
  }
}

function startTyCSystem(sock) {
  if (intervalStarted) return;
  intervalStarted = true;

  console.log("📡 Sistema TyC Instagram iniciado");
  setInterval(async () => {
    try {
      await checkNews(sock);
    } catch (err) {
      console.error("Interval error:", err.message);
    }
  }, 60 * 1000);
}

module.exports = { startTyCSystem };

