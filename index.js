"use strict";
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const electronUpdater = require("electron-updater");
const child_process = require("child_process");
const os = require("os");
const AdmZip = require("adm-zip");
function setupUpdater(window) {
  if (!electron.app.isPackaged) return;
  electronUpdater.autoUpdater.autoDownload = false;
  electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
  electronUpdater.autoUpdater.on("update-available", () => {
    window.webContents.send("app:update-available");
  });
  electronUpdater.autoUpdater.on("download-progress", (progress) => {
    window.webContents.send("app:update-download-progress", progress.percent);
  });
  electronUpdater.autoUpdater.on("update-downloaded", () => {
    window.webContents.send("app:update-downloaded");
  });
  electronUpdater.autoUpdater.on("error", (err) => {
    console.error("Updater error:", err);
    window.webContents.send("app:update-error", err.message);
  });
  electron.ipcMain.handle("app:start-update-download", async () => {
    try {
      await electronUpdater.autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
  electron.ipcMain.on("app:install-update", () => {
    electronUpdater.autoUpdater.quitAndInstall();
  });
  electronUpdater.autoUpdater.checkForUpdates().catch((err) => {
    console.error("Update check failed:", err);
  });
}
function flattenSectionItems(section) {
  if (section.subsections?.length) {
    return section.subsections.flatMap((sub) => sub.items);
  }
  return section.items ?? [];
}
function flattenManifestItems(manifest) {
  return manifest.sections.flatMap((s) => flattenSectionItems(s));
}
function serverUrl() {
  const raw = "https://apps.shikarno.space/nvi/knowhub"?.trim();
  return raw || "http://localhost:3000";
}
function getContentDir() {
  return path.join(electron.app.getPath("userData"), "content");
}
function getManifestPath() {
  return path.join(getContentDir(), "manifest.json");
}
function ensureContentDir() {
  const dir = getContentDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
function getManifest() {
  ensureContentDir();
  const manifestPath = getManifestPath();
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}
function getArticleHtml(htmlFile) {
  const filePath = path.join(getContentDir(), htmlFile);
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = electron.net.request(url);
    let data = "";
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}
async function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = electron.net.request(url);
    let data = "";
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        resolve(data);
      });
    });
    request.on("error", reject);
    request.end();
  });
}
function mergeManifests(local, remote) {
  const remoteSectionIds = new Set(remote.sections.map((s) => s.id));
  const localOnlySections = local.sections.filter((s) => !remoteSectionIds.has(s.id));
  return { version: remote.version, sections: [...localOnlySections, ...remote.sections] };
}
async function syncContent(window) {
  ensureContentDir();
  const local = getManifest();
  const baseUrl = serverUrl();
  let remote;
  try {
    remote = await fetchJson(`${baseUrl}/content/manifest.json`);
  } catch (e) {
    console.error("Content sync: failed to fetch manifest:", e);
    return;
  }
  const localItems = local ? flattenManifestItems(local) : [];
  const localIds = new Map(localItems.map((i) => [i.id, i.version]));
  const remoteItems = flattenManifestItems(remote);
  const remoteIds = new Set(remoteItems.map((i) => i.id));
  const toDownload = remoteItems.filter(
    (item) => item.htmlFile && (!localIds.has(item.id) || localIds.get(item.id) < item.version)
  );
  const removedHtmlFiles = localItems.filter((item) => item.htmlFile && !remoteIds.has(item.id)).map((item) => item.htmlFile);
  const manifestChanged = !local || remote.version !== local.version || JSON.stringify(local.sections) !== JSON.stringify(remote.sections);
  if (!manifestChanged && toDownload.length === 0 && removedHtmlFiles.length === 0) {
    return;
  }
  for (const item of toDownload) {
    if (!item.htmlFile) continue;
    try {
      const html = await fetchText(`${baseUrl}/content/${item.htmlFile}`);
      const dest = path.join(getContentDir(), item.htmlFile);
      const dir = dest.substring(0, Math.max(dest.lastIndexOf("/"), dest.lastIndexOf("\\")));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, html, "utf-8");
    } catch (e) {
      console.error(`Content sync: failed to download ${item.htmlFile}:`, e);
    }
  }
  for (const htmlFile of removedHtmlFiles) {
    const path$1 = path.join(getContentDir(), htmlFile);
    if (fs.existsSync(path$1)) fs.unlinkSync(path$1);
  }
  const merged = local ? mergeManifests(local, remote) : remote;
  const hasLocalOnlySections = (local?.sections ?? []).some(
    (section) => !remote.sections.some((remoteSection) => remoteSection.id === section.id)
  );
  const catalog = hasLocalOnlySections ? merged : remote;
  fs.writeFileSync(getManifestPath(), JSON.stringify(catalog, null, 2), "utf-8");
  window.webContents.send("content:updated");
}
function getBundledContentDir() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "content");
  }
  return path.join(__dirname, "../../resources/content");
}
function seedFromBundled() {
  const bundledDir = getBundledContentDir();
  if (!fs.existsSync(bundledDir)) return;
  const bundledManifestPath = path.join(bundledDir, "manifest.json");
  if (!fs.existsSync(bundledManifestPath)) return;
  ensureContentDir();
  const localManifestPath = getManifestPath();
  if (!electron.app.isPackaged) {
    fs.cpSync(bundledDir, getContentDir(), { recursive: true, force: true });
    return;
  }
  if (!fs.existsSync(localManifestPath)) {
    fs.cpSync(bundledDir, getContentDir(), { recursive: true, force: true });
    return;
  }
  try {
    const local = JSON.parse(fs.readFileSync(localManifestPath, "utf-8"));
    const bundled = JSON.parse(fs.readFileSync(bundledManifestPath, "utf-8"));
    if ((bundled.version ?? 0) > (local.version ?? 0)) {
      fs.cpSync(bundledDir, getContentDir(), { recursive: true, force: true });
    }
  } catch {
    fs.cpSync(bundledDir, getContentDir(), { recursive: true, force: true });
  }
}
function scheduleInitialSync(window) {
  const run = () => {
    void syncContent(window).catch(console.error);
  };
  const schedule = () => {
    setTimeout(run, 280);
  };
  const wc = window.webContents;
  if (!wc.isDestroyed() && wc.isLoadingMainFrame()) {
    wc.once("did-finish-load", schedule);
  } else {
    schedule();
  }
}
function setupContentSync(window) {
  seedFromBundled();
  scheduleInitialSync(window);
}
function winboxResourcesDir() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "winbox");
  }
  return path.join(__dirname, "../../resources/winbox");
}
function getBundledExpectedName() {
  if (process.platform === "win32") return "WinBox64.exe";
  if (process.platform === "darwin") return "WinBox.app";
  return "WinBox";
}
function getBundledPath() {
  return path.join(winboxResourcesDir(), getBundledExpectedName());
}
const WINBOX_DOWNLOAD_URL = "https://mikrotik.com/download/winbox";
const WINBOX_CDN_BASE = "https://download.mikrotik.com/routeros/winbox";
const FETCH_BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
};
const FETCH_BINARY_HEADERS = {
  Accept: "*/*",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
};
function decodeWinboxPageHtml(html) {
  return html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\\\//g, "/");
}
function parseWinboxVersionFromPage(html) {
  const data = decodeWinboxPageHtml(html);
  const anchor = data.indexOf('alt="WinBox logo"');
  const slice = anchor === -1 ? data : data.slice(anchor, anchor + 24e3);
  const fromHeading = slice.match(/<h4 class="font-bold mb-4">v([\d.]+)</);
  if (fromHeading) return fromHeading[1];
  const fromComponent = data.match(/components\.software\.winbox[^]*?"version":"([\d.]+)"/);
  if (fromComponent) return fromComponent[1];
  return "";
}
function parseWinboxArtifactNamesFromPage(html) {
  const data = decodeWinboxPageHtml(html);
  const names = [];
  const re = /"name":"(WinBox[^"]+\.(?:zip|dmg))"/g;
  for (let m = re.exec(data); m; m = re.exec(data)) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}
function artifactNamesForPlatform(platform, fromPage) {
  const pageMatches = fromPage.filter((name) => {
    if (platform === "win32") return /windows/i.test(name);
    if (platform === "darwin") return name.endsWith(".dmg") || /macos|darwin/i.test(name);
    return /linux/i.test(name);
  });
  const fallback = platform === "win32" ? ["WinBox_Windows.zip"] : platform === "darwin" ? ["WinBox.dmg", "WinBox_macOS.zip", "WinBox_macos.zip", "WinBox_Darwin.zip"] : ["WinBox_Linux.zip", "WinBox_linux.zip", "WinBox_Linux_x64.zip"];
  return [.../* @__PURE__ */ new Set([...pageMatches, ...fallback])];
}
async function fetchWinboxPageStatus() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15e3);
    const res = await fetch(WINBOX_DOWNLOAD_URL, {
      redirect: "follow",
      signal: controller.signal,
      headers: FETCH_BROWSER_HEADERS
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { version: "", reachable: false, artifactNames: [] };
    }
    const data = await res.text();
    return {
      version: parseWinboxVersionFromPage(data),
      reachable: true,
      artifactNames: parseWinboxArtifactNamesFromPage(data)
    };
  } catch {
    return { version: "", reachable: false, artifactNames: [] };
  }
}
function zipEntryBasename(entryName) {
  return entryName.replace(/\\/g, "/").split("/").pop() ?? "";
}
async function tryFetchBinary(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12e4);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: FETCH_BINARY_HEADERS
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function versionCandidatesForCdn(pageVersion) {
  return [...new Set([pageVersion, "4.1", "4.0"].filter((v) => !!v))];
}
async function downloadWinboxArtifactBuffer() {
  const page = await fetchWinboxPageStatus();
  const versions = await versionCandidatesForCdn(page.version);
  const names = artifactNamesForPlatform(process.platform, page.artifactNames);
  for (const ver of versions) {
    for (const name of names) {
      const url = `${WINBOX_CDN_BASE}/${ver}/${name}`;
      const buffer = await tryFetchBinary(url);
      if (buffer) {
        return { buffer, kind: name.endsWith(".dmg") ? "dmg" : "zip" };
      }
    }
  }
  throw new Error("NOT_FOUND");
}
function pickWindowsExe(zip) {
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const byName = (want) => entries.find((e) => zipEntryBasename(e.entryName).toLowerCase() === want.toLowerCase());
  return byName("winbox64.exe") || byName("WinBox.exe") || null;
}
function pickLinuxBinary(zip) {
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const base = (e) => zipEntryBasename(e.entryName);
  const by = (want) => entries.find((e) => base(e).toLowerCase() === want.toLowerCase());
  return by("WinBox") || by("winbox") || null;
}
function atomicWriteFile(filePath, data) {
  const tmp = `${filePath}.download-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
  fs.renameSync(tmp, filePath);
}
function installMacFromDmgBuffer(buf, destBundledPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kh-wb-"));
  const dmgPath = path.join(tmp, "WinBox.dmg");
  const mountPoint = path.join(tmp, "mount");
  fs.mkdirSync(mountPoint);
  fs.writeFileSync(dmgPath, buf);
  try {
    child_process.execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath], {
      stdio: "ignore"
    });
    try {
      const items = fs.readdirSync(mountPoint);
      const appFolder = items.find((n) => n.endsWith(".app"));
      if (!appFolder) throw new Error("BAD_DMG");
      const src = path.join(mountPoint, appFolder);
      fs.rmSync(destBundledPath, { recursive: true, force: true });
      fs.cpSync(src, destBundledPath, { recursive: true });
    } finally {
      child_process.execFileSync("hdiutil", ["detach", mountPoint, "-quiet"], { stdio: "ignore" });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function installWinboxFromZipBuffer(buf, destDir, destBundledPath) {
  const zip = new AdmZip(buf);
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    const entry2 = pickWindowsExe(zip);
    if (!entry2) throw new Error("BAD_ZIP");
    atomicWriteFile(destBundledPath, entry2.getData());
    return;
  }
  if (process.platform === "darwin") {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kh-wb-"));
    try {
      zip.extractAllTo(tmp, true);
      const items = fs.readdirSync(tmp);
      const appFolder = items.find((n) => n.endsWith(".app"));
      if (!appFolder) throw new Error("BAD_ZIP");
      const src = path.join(tmp, appFolder);
      fs.rmSync(destBundledPath, { recursive: true, force: true });
      fs.cpSync(src, destBundledPath, { recursive: true });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }
  const entry = pickLinuxBinary(zip);
  if (!entry) throw new Error("BAD_ZIP");
  atomicWriteFile(destBundledPath, entry.getData());
  try {
    fs.chmodSync(destBundledPath, 493);
  } catch {
  }
}
function installWinboxFromArtifact(artifact, destDir, destBundledPath) {
  if (artifact.kind === "dmg") {
    fs.mkdirSync(destDir, { recursive: true });
    installMacFromDmgBuffer(artifact.buffer, destBundledPath);
    return;
  }
  installWinboxFromZipBuffer(artifact.buffer, destDir, destBundledPath);
}
function humanDownloadError(err) {
  if (!(err instanceof Error)) return "Не удалось загрузить WinBox.";
  const code = err.code;
  if (code === "EACCES" || code === "EPERM") {
    return "Нет прав на запись в папку приложения. Запустите от имени администратора или скачайте WinBox вручную со страницы MikroTik.";
  }
  if (err.message === "NOT_FOUND") {
    return "На сервере MikroTik не найден архив WinBox для вашей системы. Откройте страницу загрузки и установите вручную.";
  }
  if (err.message === "BAD_ZIP") {
    return "Архив WinBox не удалось разобрать. Попробуйте позже или скачайте вручную.";
  }
  if (err.message === "BAD_DMG") {
    return "Образ WinBox (.dmg) не удалось разобрать. Попробуйте позже или скачайте вручную.";
  }
  if (err.name === "AbortError") {
    return "Превышено время ожидания при загрузке. Проверьте интернет и повторите попытку.";
  }
  return "Не удалось загрузить WinBox. Проверьте интернет и повторите попытку.";
}
function getBundledVersion(exePath) {
  if (process.platform !== "win32" || !fs.existsSync(exePath)) {
    return Promise.resolve("");
  }
  return new Promise((resolve) => {
    const escaped = exePath.replace(/'/g, "''");
    const ps = child_process.spawn(
      "powershell",
      [
        "-NonInteractive",
        "-NoProfile",
        "-Command",
        `try { (Get-Item '${escaped}').VersionInfo.FileVersion } catch { '' }`
      ],
      { windowsHide: true }
    );
    let out = "";
    ps.stdout.on("data", (d) => out += d.toString());
    ps.on("close", () => resolve(out.trim().replace(/,/g, ".")));
    ps.on("error", () => resolve(""));
  });
}
function versionGt(a, b) {
  const ap = a.split(".").map(Number);
  const bp = b.split(".").map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
function setupWinbox() {
  electron.ipcMain.handle("winbox:open", async () => {
    const exePath = getBundledPath();
    if (!fs.existsSync(exePath)) return { ok: false, error: "not-bundled" };
    const err = await electron.shell.openPath(exePath);
    return err ? { ok: false, error: err } : { ok: true };
  });
  electron.ipcMain.handle("winbox:check-update", async () => {
    const exePath = getBundledPath();
    const bundledExpectedName = getBundledExpectedName();
    const [fetchResult, local] = await Promise.all([
      fetchWinboxPageStatus(),
      getBundledVersion(exePath)
    ]);
    const latest = fetchResult.version;
    return {
      latest,
      local,
      hasUpdate: !!latest && !!local && versionGt(latest, local),
      bundled: fs.existsSync(exePath),
      mikrotikOnline: fetchResult.reachable,
      bundledExpectedName
    };
  });
  electron.ipcMain.handle("winbox:download-bundled", async () => {
    try {
      const destDir = winboxResourcesDir();
      const destPath = getBundledPath();
      const artifact = await downloadWinboxArtifactBuffer();
      installWinboxFromArtifact(artifact, destDir, destPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: humanDownloadError(e) };
    }
  });
  electron.ipcMain.handle("winbox:open-download-page", async () => {
    try {
      await electron.shell.openExternal(WINBOX_DOWNLOAD_URL);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}
function getWindowIconPath() {
  if (electron.app.isPackaged) {
    const packed = path.join(process.resourcesPath, "icon.png");
    if (fs.existsSync(packed)) return packed;
    return void 0;
  }
  const dev = path.join(__dirname, "../../build/icon.png");
  if (fs.existsSync(dev)) return dev;
  return void 0;
}
function createWindow() {
  const icon = getWindowIconPath();
  const mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    ...icon ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (!electron.app.isPackaged) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!electron.app.isPackaged && rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
electron.app.whenReady().then(() => {
  if (process.platform === "win32") {
    electron.app.setAppUserModelId("com.nvi.knowhub");
  }
  electron.ipcMain.handle("content:get-manifest", () => getManifest());
  electron.ipcMain.handle("content:get-article-html", (_, htmlFile) => getArticleHtml(htmlFile));
  electron.ipcMain.handle("app:get-version", () => electron.app.getVersion());
  electron.ipcMain.handle("shell:open-external", async (_, url) => {
    await electron.shell.openExternal(url);
    return { ok: true };
  });
  const mainWindow = createWindow();
  setupUpdater(mainWindow);
  setupContentSync(mainWindow);
  setupWinbox();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
