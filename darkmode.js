(() => {
  const STYLE_ID = "superlevels-darkmode";

  // CSS approach: invert the whole page, then re-invert media so images/videos look normal
  function buildCSS(brightness) {
    const b = brightness / 100;
    return `
      html.superlevels-dark {
        filter: invert(1) hue-rotate(180deg) brightness(${b}) !important;
        background: #fff !important;
      }
      html.superlevels-dark img,
      html.superlevels-dark video,
      html.superlevels-dark canvas,
      html.superlevels-dark svg image,
      html.superlevels-dark picture,
      html.superlevels-dark [style*="background-image"],
      html.superlevels-dark iframe {
        filter: invert(1) hue-rotate(180deg) !important;
      }
      /* Don't double-invert nested media inside iframes - handled by iframe's own injection */
      /* Fix common elements that break */
      html.superlevels-dark input,
      html.superlevels-dark textarea,
      html.superlevels-dark select {
        background-color: inherit !important;
        color: inherit !important;
      }
    `;
  }

  function applyDarkMode(enabled, brightness) {
    let style = document.getElementById(STYLE_ID);
    if (enabled) {
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = buildCSS(brightness);
      document.documentElement.classList.add("superlevels-dark");
    } else {
      document.documentElement.classList.remove("superlevels-dark");
      if (style) style.remove();
    }
  }

  function isDarkApplied() {
    return document.documentElement.classList.contains("superlevels-dark");
  }

  // Get hostname for per-site storage
  const host = location.hostname;
  const storageKey = "darkmode_" + host;
  const globalKey = "darkmode_global";
  const autoKey = "darkmode_auto";
  const cacheKey = "darkmode_autocache";
  const CACHE_MAX = 400;

  let brightness = 100;
  let autoEnabled = false;
  let siteState; // per-site override: true / false / undefined (= no override)
  let manualOverride = false; // user flipped the switch during this page load

  // ═══════════════════════════════════
  //  "Is this page light?" detection
  // ═══════════════════════════════════

  // getComputedStyle gives us "rgb(r, g, b)" / "rgba(r, g, b, a)"; newer Chrome
  // can also hand back "rgb(r g b / a)", so accept both separators.
  function parseColor(str) {
    const m = /rgba?\(([^)]+)\)/i.exec(str || "");
    if (!m) return null;
    const p = m[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function isLightColor(c) {
    // Perceived brightness, 0 (black) … 1 (white)
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 >= 0.5;
  }

  // First ancestor (element included) that actually paints a background
  function opaqueBgUnder(el) {
    while (el && el !== document.documentElement) {
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.9) return c;
      el = el.parentElement;
    }
    return null;
  }

  // true = page looks light, false = page is already dark
  function detectLightPage() {
    // Sample a few spots rather than trusting <body>: plenty of sites paint the
    // real background on a wrapper div and leave body transparent.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const votes = [];
    if (w > 0 && h > 0) {
      for (const [fx, fy] of [[0.5, 0.3], [0.2, 0.6], [0.8, 0.6], [0.5, 0.85]]) {
        const c = opaqueBgUnder(document.elementFromPoint(w * fx, h * fy));
        if (c) votes.push(isLightColor(c));
      }
    }
    if (votes.length) {
      const light = votes.filter(Boolean).length;
      return light * 2 >= votes.length; // ties count as light
    }

    // Nothing opaque under the sample points — fall back to the page canvas.
    const bodyBg = document.body && parseColor(getComputedStyle(document.body).backgroundColor);
    if (bodyBg && bodyBg.a >= 0.9) return isLightColor(bodyBg);
    // <html>'s background is ours while the filter is on, so only trust it otherwise.
    if (!isDarkApplied()) {
      const htmlBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
      if (htmlBg && htmlBg.a >= 0.9) return isLightColor(htmlBg);
    }
    // A page that opts into dark rendering gets the benefit of the doubt;
    // otherwise the browser canvas is white.
    const scheme = getComputedStyle(document.documentElement).colorScheme || "";
    if (/\bdark\b/.test(scheme) && !/\blight\b/.test(scheme)) return false;
    return true;
  }

  // Remember the verdict per host so the next visit applies it at document_start
  // (before first paint) instead of flashing white until the DOM is measurable.
  function rememberVerdict(light) {
    chrome.storage.local.get([cacheKey], (data) => {
      const cache = (data && data[cacheKey]) || {};
      cache[host] = [light ? 1 : 0, Date.now()];
      const hosts = Object.keys(cache);
      if (hosts.length > CACHE_MAX) {
        hosts
          .sort((a, b) => (cache[a][1] || 0) - (cache[b][1] || 0))
          .slice(0, hosts.length - CACHE_MAX)
          .forEach((h) => delete cache[h]);
      }
      chrome.storage.local.set({ [cacheKey]: cache });
    });
  }

  let lastVerdict; // avoids re-writing the cache on every re-check

  function runAutoCheck() {
    if (!autoEnabled || manualOverride || siteState !== undefined) return;
    const light = detectLightPage();
    if (light !== isDarkApplied()) applyDarkMode(light, brightness);
    if (light !== lastVerdict) {
      lastVerdict = light;
      rememberVerdict(light);
    }
  }

  function scheduleAutoChecks() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runAutoCheck, { once: true });
    } else {
      runAutoCheck();
    }
    window.addEventListener("load", runAutoCheck, { once: true });
    setTimeout(runAutoCheck, 1500); // apps that paint their theme late
  }

  // Load state as early as possible to prevent flash
  chrome.storage.local.get(
    [storageKey, globalKey, autoKey, cacheKey, "darkmode_brightness"],
    (data) => {
      brightness = data.darkmode_brightness || 100;
      siteState = data[storageKey];
      autoEnabled = data[autoKey] === true;

      // An explicit per-site choice always wins, and stops auto-detection.
      if (siteState !== undefined) {
        if (siteState) applyDarkMode(true, brightness);
        return;
      }

      // Auto mode: only invert pages that look light. Sits between the per-site
      // override and the global default.
      if (autoEnabled) {
        const cached = (data[cacheKey] || {})[host];
        if (cached && cached[0] === 1) applyDarkMode(true, brightness);
        scheduleAutoChecks();
        return;
      }

      if (data[globalKey]) applyDarkMode(true, brightness);
    }
  );

  // Listen for toggle messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "darkmode_toggle") {
      brightness = msg.brightness || brightness;
      // A deliberate flip outranks auto-detection for the rest of this page load.
      manualOverride = true;
      applyDarkMode(msg.enabled, brightness);
      sendResponse({ ok: true });
    }
    if (msg.type === "darkmode_settings") {
      // Auto mode / the per-site override changed in the popup — recompute from
      // scratch. siteState comes as null when there is no override.
      autoEnabled = msg.auto === true;
      siteState = msg.siteState === null || msg.siteState === undefined ? undefined : msg.siteState;
      brightness = msg.brightness || brightness;
      manualOverride = false;
      if (siteState !== undefined) applyDarkMode(siteState, brightness);
      else if (autoEnabled) scheduleAutoChecks();
      else applyDarkMode(msg.global === true, brightness);
      sendResponse({ ok: true });
    }
    if (msg.type === "darkmode_query") {
      sendResponse({
        active: isDarkApplied(),
        host: host,
      });
    }
  });
})();
