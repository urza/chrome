// Cookie cleaner: on browser startup, wipe all cookies whose domain
// does not match an entry in the user's whitelist.

const SETTINGS_KEY = "cookieclean_settings";
const LASTRUN_KEY = "cookieclean_lastrun";

const DEFAULT_WHITELIST = [
  // Google
  "google.com", "youtube.com", "googleusercontent.com",
  // Microsoft / Apple
  "microsoft.com", "live.com", "office.com", "microsoftonline.com",
  "apple.com", "icloud.com",
  // Socials
  "x.com", "twitter.com",
  "facebook.com", "instagram.com", "whatsapp.com", "messenger.com",
  "linkedin.com", "reddit.com", "tiktok.com", "pinterest.com",
  "twitch.tv", "discord.com",
  // Dev / work
  "github.com", "gitlab.com", "stackoverflow.com",
  "slack.com", "notion.so", "figma.com",
  // Media / shopping
  "spotify.com", "netflix.com", "amazon.com",
  "dropbox.com",
];

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (data) => {
      const s = data[SETTINGS_KEY];
      if (!s) {
        resolve({ enabled: false, whitelist: DEFAULT_WHITELIST.slice() });
        return;
      }
      resolve({
        enabled: s.enabled === true, // default OFF (don't surprise-nuke cookies)
        whitelist: Array.isArray(s.whitelist) ? s.whitelist : DEFAULT_WHITELIST.slice(),
      });
    });
  });
}

// Seed the whitelist with sensible defaults the first time we see no settings.
// Fires on install AND update so previously-installed users also get defaults
// (without overwriting an existing whitelist).
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([SETTINGS_KEY]);
  if (data[SETTINGS_KEY]) return;
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { enabled: false, whitelist: DEFAULT_WHITELIST.slice() },
  });
});

function normalizeDomain(d) {
  if (!d) return "";
  return d.replace(/^\./, "").toLowerCase().trim();
}

function isWhitelisted(cookieDomain, whitelist) {
  const host = normalizeDomain(cookieDomain);
  if (!host) return false;
  return whitelist.some((entry) => {
    const w = normalizeDomain(entry);
    if (!w) return false;
    return host === w || host.endsWith("." + w);
  });
}

function cookieUrl(cookie) {
  const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const protocol = cookie.secure ? "https:" : "http:";
  return `${protocol}//${domain}${cookie.path}`;
}

async function getAllCookiesAllStores() {
  const stores = await chrome.cookies.getAllCookieStores();
  const all = [];
  for (const store of stores) {
    const cookies = await chrome.cookies.getAll({ storeId: store.id });
    all.push(...cookies);
  }
  return all;
}

async function cleanCookies({ force = false } = {}) {
  const { enabled, whitelist } = await getSettings();
  if (!enabled && !force) return { removed: 0, kept: 0, skipped: true };

  const cookies = await getAllCookiesAllStores();
  let removed = 0;
  let kept = 0;

  for (const cookie of cookies) {
    if (isWhitelisted(cookie.domain, whitelist)) {
      kept++;
      continue;
    }
    try {
      await chrome.cookies.remove({
        url: cookieUrl(cookie),
        name: cookie.name,
        storeId: cookie.storeId,
      });
      removed++;
    } catch (e) {
      // ignore individual failures (e.g. partitioned cookies that can't be removed by URL)
    }
  }

  const result = { ts: Date.now(), removed, kept };
  chrome.storage.local.set({ [LASTRUN_KEY]: result });
  return result;
}

chrome.runtime.onStartup.addListener(() => {
  cleanCookies();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "cookieclean_now") {
    cleanCookies({ force: true }).then(sendResponse);
    return true; // async response
  }
});
