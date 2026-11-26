(() => {
  const STYLE_ID = "superlevels-darkmode";
  // Set by checkPhotoBackground() on elements that show a photo through a
  // stylesheet background-image, which no CSS selector can find.
  const PHOTO_ATTR = "data-superlevels-photo";
  // Set by markSkins() on a dark picture background of a light page.
  const SKIN_ATTR = "data-superlevels-skin";

  // A filter applies to the element and everything inside it, so media inside
  // re-inverted media is inverted a third time: every photo in a <picture>
  // (wired.com, seznam.cz) came out inverted. The :not() re-inverts only the
  // outermost one. img, video, canvas and iframe show no child elements.
  // An inline background counts only with an image in it (url): the shorthand
  // "background: url(…)" was missed, and "background-image: none" on a layout
  // block re-inverted the whole block to light.
  const INLINE_BG = `[style*="background"][style*="url("]`;
  const MEDIA = `img, video, canvas, svg image, picture, iframe, ${INLINE_BG}, [${PHOTO_ATTR}]`;
  const WRAPPERS = `picture, ${INLINE_BG}, [${PHOTO_ATTR}]`;
  const OUTER_MEDIA = `:is(${MEDIA}):not(:is(${WRAPPERS}) *)`;
  // The :not() sees only ancestors in the element's own tree. It misses a
  // wrapper outside a shadow root, and a wrapper in a shadow root that holds
  // the <slot> of a page element. The shadow root sheet (below) sets
  // --superlevels-media to "none" there. Custom properties pass into shadow
  // roots and slots on the same path as filters, so the media below such a
  // wrapper gets no second re-invert. Everywhere else the property is not set,
  // and var() uses the re-invert. Do not declare the property on <html>:
  // then each switch of the dark class restyles every element of the page
  // (Wikipedia, 17,000 elements: 63 ms instead of 7 ms).
  const REINVERT = `filter: var(--superlevels-media, invert(1) hue-rotate(180deg)) !important;`;
  const WRAPPED = `--superlevels-media: none;`;

  // CSS approach: invert the whole page, then re-invert media so images/videos look normal
  function buildCSS(brightness) {
    const b = brightness / 100;
    return `
      html.superlevels-dark {
        filter: invert(1) hue-rotate(180deg) brightness(${b}) !important;
        background: #fff !important;
      }
      html.superlevels-dark ${OUTER_MEDIA} { ${REINVERT} }
      /* White here shows as black. See markSkins(). */
      html.superlevels-dark [${SKIN_ATTR}] { background: #fff !important; }
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
      watchPhotoBackgrounds(true);
    } else {
      document.documentElement.classList.remove("superlevels-dark");
      if (style) style.remove();
      for (const el of document.querySelectorAll(`[${SKIN_ATTR}]`)) el.removeAttribute(SKIN_ATTR);
      watchPhotoBackgrounds(false);
    }
  }

  // Until a check decides, a page that is not inverted can show white. The veil
  // keeps it dark, in black, the same black that an inverted white page shows.
  // pageRootBackground() switches the veil off for its read.
  const VEIL_ID = "superlevels-darkmode-veil";
  const VEIL_CSS = {
    // First visit to a host: no verdict is cached, so the page can be light,
    // and a light page showed white until the first check (seznam.cz: about
    // 0.6 s, its 1.4 MB of HTML delays DOMContentLoaded). Hide the page.
    // opacity, not visibility: the checks use elementFromPoint() and
    // checkVisibility(), and both skip hidden elements but not transparent ones.
    hide: "html { background: #000 !important } body { opacity: 0 !important }",
    // Dark on the last visit: show the page, and paint only the canvas, which
    // is white while a page has no background. Discord's shell has none until
    // its theme loads after the load event. Zero specificity and no !important,
    // so any <html> background of the page wins. A page that paints only
    // <body> shows that colour on the body box only, until the check.
    canvas: ":where(html) { background-color: #000 }",
  };
  // The page can stay without a verdict (an app that has not loaded its theme
  // yet, a page of only images). After this time (ms from navigation start)
  // "hide" becomes "canvas", so that the veil never hides a page for long.
  const VEIL_MAX = 3000;

  // kind: "hide", "canvas", or false for no veil
  function setVeil(kind) {
    let veil = document.getElementById(VEIL_ID);
    if (!kind) {
      if (veil) veil.remove();
      return;
    }
    if (!veil) {
      veil = document.createElement("style");
      veil.id = VEIL_ID;
      (document.head || document.documentElement).appendChild(veil);
    }
    // The retries call this every 250 ms. Rewrite the sheet only on a change.
    if (veil.textContent !== VEIL_CSS[kind]) veil.textContent = VEIL_CSS[kind];
  }

  // ═══════════════════════════════════
  //  Photos in stylesheet backgrounds
  // ═══════════════════════════════════
  // Many sites show thumbnails as a CSS background-image set by a class
  // (idnes.cz: 87 photos), not as <img>. Find them and mark them for the
  // re-invert rule. The same property also carries icons, sort arrows and
  // spacer GIFs on big layout blocks, which must stay inverted, so only a
  // background that looks like a photo counts.
  function isPhotoBackground(el) {
    if (el === document.body || el === document.documentElement) return false;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundImage;
    if (!bg.includes("url(")) return false;
    // SVG is almost always an icon or a drawing, like inline <svg>.
    if (/\.svg\b|image\/svg/i.test(bg)) return false;
    // A photo is scaled to fill its box. Icons and patterns keep their own
    // size ("auto") and sit at a position or repeat.
    if (!/cover|contain|100%/.test(cs.backgroundSize)) return false;
    // A block with a lot of text is layout with a decoration, not a picture.
    // Re-inverting it would turn the whole block light again.
    return el.textContent.length <= 300;
  }

  function checkPhotoBackground(el) {
    if (isPhotoBackground(el)) {
      if (!el.hasAttribute(PHOTO_ATTR)) el.setAttribute(PHOTO_ATTR, "");
    } else if (el.hasAttribute(PHOTO_ATTR)) {
      el.removeAttribute(PHOTO_ATTR);
    }
  }

  // ═══════════════════════════════════
  //  Media in shadow roots
  // ═══════════════════════════════════
  // The page's stylesheet cannot select elements inside a shadow root, but the
  // filter on <html> inverts them too. So the <video> of a web component
  // player stayed inverted (<mux-video> on media-chrome.org; superlevels saw it
  // on Reddit), and so did the photo in a Shoelace <sl-avatar>. Each shadow root
  // gets the same re-invert rule in its own sheet. :host-context() ties the
  // rule to the same <html> class as the page rule, so the two always switch on
  // and off together.
  // The second rule marks what a wrapper re-inverted already (see REINVERT):
  // the whole shadow root when the host is a wrapper or sits in one, and the
  // children of a wrapper in the shadow root, which hold its slots and inner
  // shadow hosts. Both set the property on children (> *), not on the wrapper
  // or host: var() reads the element's own value, and a wrapper needs its
  // re-invert.
  const shadowSheet = new CSSStyleSheet();
  shadowSheet.replaceSync(`
    :host-context(html.superlevels-dark) ${OUTER_MEDIA} { ${REINVERT} }
    :host-context(:is(${WRAPPERS})) > *, :is(${WRAPPERS}) > * { ${WRAPPED} }
  `);

  let watchedRoots = new WeakSet();

  function watchShadowRoot(el) {
    // The call throws for an SVG element (which can have no shadow root), and
    // the throw stopped all checks on pages with SVG icons.
    if (!(el instanceof HTMLElement)) return;
    // Closed shadow roots too. The browser's own ones (video controls,
    // inputs) never come back, so the sheet stays out of them.
    const root = chrome.dom.openOrClosedShadowRoot(el);
    if (!root || watchedRoots.has(root)) return;
    watchedRoots.add(root);
    if (!root.adoptedStyleSheets.includes(shadowSheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, shadowSheet];
    }
    // The page's observer does not see into a shadow root. Watch the root too,
    // for photo backgrounds and for shadow roots inside it.
    photoObserver.observe(root, OBSERVE);
    for (const child of root.children) queuePhotoCheck(pendingTrees, child);
  }

  // A custom element can be in the page before the site's script defines its
  // class. It gets its shadow root at the upgrade, and no observer reports
  // that, so the player stayed inverted. Look at such elements again until the
  // browser marks them :defined. Built-in elements are always :defined.
  const undefinedEls = new Set();
  let upgradeTimer = 0;

  function checkUpgrades() {
    upgradeTimer = 0;
    for (const el of undefinedEls) {
      if (!el.isConnected) undefinedEls.delete(el);
      else if (el.matches(":defined")) {
        undefinedEls.delete(el);
        watchShadowRoot(el);
      }
    }
    if (undefinedEls.size) upgradeTimer = setTimeout(checkUpgrades, 500);
  }

  function checkElement(el) {
    checkPhotoBackground(el);
    watchShadowRoot(el);
    if (el.matches(":not(:defined)")) {
      undefinedEls.add(el);
      if (!upgradeTimer) upgradeTimer = setTimeout(checkUpgrades, 500);
    }
  }

  const OBSERVE = { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] };
  let photoObserver = null;
  let pendingTrees = new Set(); // added nodes: check them and all inside
  let pendingEls = new Set(); // style or class changed: check the element only
  let photoFrame = 0;

  function flushPhotoChecks() {
    photoFrame = 0;
    const trees = pendingTrees, els = pendingEls;
    pendingTrees = new Set();
    pendingEls = new Set();
    for (const root of trees) {
      // While the page loads, the parser adds nodes one by one, so most queued
      // roots sit inside another queued root. Check each subtree once.
      if (!root.isConnected || hasQueuedAncestor(root, trees)) continue;
      checkElement(root);
      for (const el of root.querySelectorAll("*")) checkElement(el);
    }
    for (const el of els) if (el.isConnected) checkElement(el);
  }

  function hasQueuedAncestor(el, set) {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return true;
    return false;
  }

  // Batch the checks into one per frame: an SPA or a lazy loader changes many
  // nodes at once. Runs only while the page is inverted.
  function queuePhotoCheck(set, el) {
    set.add(el);
    if (!photoFrame) photoFrame = requestAnimationFrame(flushPhotoChecks);
  }

  function watchPhotoBackgrounds(on) {
    if (!on) {
      if (photoObserver) photoObserver.disconnect();
      photoObserver = null;
      // Queued checks need the observer, which is gone now.
      cancelAnimationFrame(photoFrame);
      photoFrame = 0;
      pendingTrees.clear();
      pendingEls.clear();
      clearTimeout(upgradeTimer);
      upgradeTimer = 0;
      undefinedEls.clear();
      return;
    }
    if (photoObserver) return;
    photoObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") {
          for (const n of r.addedNodes) if (n.nodeType === 1) queuePhotoCheck(pendingTrees, n);
        } else {
          queuePhotoCheck(pendingEls, r.target);
        }
      }
    });
    // A new observer watches no shadow root yet. The full check below finds
    // them all again.
    watchedRoots = new WeakSet();
    photoObserver.observe(document.documentElement, OBSERVE);
    queuePhotoCheck(pendingTrees, document.documentElement);
  }

  function isDarkApplied() {
    return document.documentElement.classList.contains("superlevels-dark");
  }

  // Get hostname for per-site storage
  const host = location.hostname;
  const storageKey = "darkmode_" + host;
  const globalKey = "darkmode_global";
  // Verdict cache. The name is from the old "auto" mode; it stays so that the
  // cached verdicts survive the update.
  const cacheKey = "darkmode_autocache";
  const CACHE_MAX = 400;

  let brightness = 100;
  // Per-site override (true / false / undefined = follow All sites).
  let siteState;
  // All-sites mode: true (ON), false/undefined (OFF), or "auto" (Prague daylight).
  let globalSetting;
  // Dark mode is on for this page: the site's switch, else the all-sites
  // default. "Dark" means the page ends up dark. Only a light page is
  // inverted. A page that is already dark stays as it is, because inverting it
  // turns it white (Discord with its dark theme).
  let darkWanted = false;
  let scheduleTimer = 0;
  let scheduleListenersBound = false;

  // Cap the visible tab's timer at 5 min so waking a sleeping laptop or
  // changing the clock updates promptly; hidden tabs only set a single-shot
  // timer for the actual transition (zero periodic wakeups in the background).
  const SCHEDULE_TICK_CAP_MS = 5 * 60 * 1000;

  function computeDarkWanted(now = Date.now()) {
    // The site's own switch always wins over All sites (including Auto).
    if (siteState !== undefined) return siteState === true;
    if (globalSetting === "auto") return darkmodeSchedule.getState(now).isDark;
    return globalSetting === true;
  }

  // ═══════════════════════════════════
  //  "Is this page light?" detection
  // ═══════════════════════════════════

  // getComputedStyle reports classic colours as rgb()/rgba(), but keeps modern
  // ones in their own syntax: color-mix() comes back as oklab(…) or
  // color(srgb …), and lab()/oklch() stay as they are. Discord builds its whole
  // theme with color-mix(), so an rgb()-only parser saw no background there at
  // all and called the page light. A 1×1 canvas turns any CSS colour into sRGB.
  let colorCtx;
  // A check reads some hundred backgrounds, but a page has few different
  // colours, and the canvas read is the slow part. Keep the results.
  const parsedColors = new Map();
  function parseColor(str) {
    if (!str) return null;
    let c = parsedColors.get(str);
    if (!c) {
      if (parsedColors.size > 500) parsedColors.clear();
      parsedColors.set(str, (c = readColor(str)));
    }
    return c;
  }

  function readColor(str) {
    if (!colorCtx) colorCtx = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    colorCtx.clearRect(0, 0, 1, 1);
    // The canvas ignores a colour it cannot parse and keeps the last fillStyle,
    // so reset it first: unknown syntax then reads as transparent, not as the
    // previous colour.
    colorCtx.fillStyle = "transparent";
    colorCtx.fillStyle = str;
    colorCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  }

  function isLightColor(c) {
    // Perceived brightness, 0 (black) … 1 (white)
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 >= 0.5;
  }

  // First ancestor (element included) that actually paints a background.
  // Gives the element and its colour, or null.
  function opaqueBgUnder(el) {
    while (el && el !== document.documentElement) {
      const color = parseColor(getComputedStyle(el).backgroundColor);
      if (color && color.a >= 0.9) return { el, color };
      el = el.parentElement;
    }
    return null;
  }

  // ═══════════════════════════════════
  //  Dark advert skins on a light page
  // ═══════════════════════════════════
  // A shop puts a dark advert picture behind its white content column
  // (alza.cz on Black Friday). Inverted, the skin turns white and glows at
  // both sides of the dark column. A re-invert is not possible: the skin
  // element holds the content, and the content would turn light again. So
  // the skin loses its picture and shows plain black (see buildCSS).

  // The dark backgrounds of the last detectLightPage() run, sorted by isSkin().
  let skins = new Set();
  let plainDark = new Set();

  // True if some visible text has el as its background. Such text is light,
  // and the inversion makes it dark, so a black background would hide it.
  // The limit keeps a skin around a whole page cheap: its text sits on the
  // backgrounds of the content, and the first nodes show that.
  function hasTextOn(el) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let n = walk.nextNode(); n && seen < 300; n = walk.nextNode()) {
      if (!n.data.trim() || !n.parentElement.checkVisibility()) continue;
      seen++;
      const bg = opaqueBgUnder(n.parentElement);
      if (bg && bg.el === el) return true;
    }
    return false;
  }

  // el has a dark background colour. Many sample points give the same
  // element, so each element is judged once in a run.
  function isSkin(el) {
    if (skins.has(el)) return true;
    if (plainDark.has(el)) return false;
    // No picture: a dark menu or footer. It inverts to light.
    // A photo background is re-inverted and keeps its picture. Inside
    // re-inverted media, a black background would show white.
    const skin = getComputedStyle(el).backgroundImage.includes("url(")
      && !isPhotoBackground(el) && !el.closest(WRAPPERS) && !hasTextOn(el);
    (skin ? skins : plainDark).add(el);
    return skin;
  }

  // Call only while the page is inverted.
  function markSkins() {
    for (const el of skins) if (el.isConnected) el.setAttribute(SKIN_ATTR, "");
  }

  // The page's own <html> background. While the filter is on, our sheet paints
  // <html> white (see buildCSS), and the veil paints it black, so switch both
  // sheets off for the read. Without this, a dark page that paints only <html>
  // stayed inverted for good once its cache entry said "light". Off and on in
  // the same task paints nothing, and a disabled sheet, unlike a class change,
  // does not show in the page's own MutationObservers.
  function pageRootBackground() {
    const sheets = [STYLE_ID, VEIL_ID]
      .map((id) => document.getElementById(id))
      .map((style) => style && style.sheet)
      .filter(Boolean);
    for (const sheet of sheets) sheet.disabled = true;
    try {
      return getComputedStyle(document.documentElement).backgroundColor;
    } finally {
      for (const sheet of sheets) sheet.disabled = false;
    }
  }

  // True once the body shows any text. Script, style and <noscript> text is not
  // rendered, and checkVisibility() skips it. Stops at the first hit, so a huge
  // page costs no more than a small one.
  function hasVisibleText() {
    if (!document.body) return false;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.data.trim() && n.parentElement.checkVisibility()) return true;
    }
    return false;
  }

  // true = page looks light, false = page is already dark,
  // null = nothing painted yet, so there is nothing to judge
  function detectLightPage() {
    // Sample a few spots rather than trusting <body>: plenty of sites paint the
    // real background on a wrapper div and leave body transparent.
    const w = window.innerWidth;
    const h = window.innerHeight;
    // A grid of 25 points measures how much of the window is light. Four
    // points were too few: on alza.cz with a dark advert skin at both sides,
    // two of them missed the white content column by 10 px, and the tie left
    // a page white that is 59 % white.
    const GRID = [0.1, 0.3, 0.5, 0.7, 0.9];
    let light = 0, dark = 0;
    skins = new Set();
    plainDark = new Set();
    if (w > 0 && h > 0) {
      for (const fx of GRID) {
        for (const fy of GRID) {
          const bg = opaqueBgUnder(document.elementFromPoint(w * fx, h * fy));
          // A skin shows black on the inverted page too, so it does not
          // vote. On the alza.cz home page the top grid row fell on a 5 px
          // strip of the skin, and with both sides that made a 12 to 12 tie.
          // A marked skin has a white background from our sheet: skip it,
          // so that the vote is the same while the page is inverted.
          if (!bg || bg.el.hasAttribute(SKIN_ATTR)) continue;
          if (isLightColor(bg.color)) light++;
          else if (!isSkin(bg.el)) dark++;
        }
      }
      // In a narrow window the skin shows only in the margins, outside the
      // grid (alza.cz at 1600 px). Look for it at both edges. These points
      // do not vote. clientWidth leaves out the scrollbar.
      const cw = document.documentElement.clientWidth;
      for (const x of [4, cw - 5]) {
        for (const fy of GRID) {
          const bg = opaqueBgUnder(document.elementFromPoint(x, h * fy));
          if (bg && !isLightColor(bg.color)) isSkin(bg.el);
        }
      }
    }
    // A tie stays dark: inverting a half-dark page turns that half white.
    if (light + dark) return light > dark;

    // Nothing opaque under the sample points — fall back to the page canvas.
    const bodyBg = document.body && parseColor(getComputedStyle(document.body).backgroundColor);
    if (bodyBg && bodyBg.a >= 0.9) return isLightColor(bodyBg);
    const htmlBg = parseColor(pageRootBackground());
    if (htmlBg && htmlBg.a >= 0.9) return isLightColor(htmlBg);
    // A page that opts into dark rendering gets the benefit of the doubt.
    const scheme = getComputedStyle(document.documentElement).colorScheme || "";
    if (/\bdark\b/.test(scheme) && !/\blight\b/.test(scheme)) return false;
    // No background anywhere, so the white browser canvas shows. With text on
    // it, that is a plain light page. Without text, it is usually an app that
    // has not loaded its theme yet: Discord sets its theme class on <html> only
    // after DOMContentLoaded and load. Do not call that light, or the dark app
    // is inverted to white until a later check sees its theme.
    return hasVisibleText() ? true : null;
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
  let retryTimer;

  function runCheck() {
    if (!darkWanted) return;
    const detected = detectLightPage();
    // The site's own switch is manual: ON inverts the page, whatever the
    // check says. It is the way out when the check is wrong (a white page
    // that it calls dark). Only "All sites" depends on the check. The check
    // still runs here, because it finds the skins and fills the cache.
    const light = siteState === true ? true : detected;
    if (light === null) {
      // Leave the page as it is, cache nothing, and look again soon: an app can
      // paint its theme after every fixed check below has run. The time limit
      // (from navigation start) stops the retries on pages that stay empty.
      clearTimeout(retryTimer);
      if (performance.now() < 10000) retryTimer = setTimeout(runCheck, 250);
      // Show a page that still has no verdict, but keep its empty canvas dark.
      if (performance.now() >= VEIL_MAX && document.getElementById(VEIL_ID)) setVeil("canvas");
      return;
    }
    // In the same task as the invert, so no frame shows the page white.
    if (light !== isDarkApplied()) applyDarkMode(light, brightness);
    if (light) markSkins();
    setVeil(false);
    // The cache holds what the page is, not what the switch forced: it serves
    // the time after "Follow all sites".
    if (detected !== null && detected !== lastVerdict) {
      lastVerdict = detected;
      rememberVerdict(detected);
    }
  }

  function scheduleChecks() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runCheck, { once: true });
    } else {
      runCheck();
    }
    window.addEventListener("load", runCheck, { once: true });
    setTimeout(runCheck, 1500); // apps that paint their theme late
  }

  // On: check the page now and while it loads, and invert it only if it is
  // light. Never invert without a check, or a dark page turns white.
  function setDarkWanted(on) {
    darkWanted = on;
    if (on) {
      scheduleChecks();
    } else {
      clearTimeout(retryTimer);
      retryTimer = 0;
      applyDarkMode(false, brightness);
      setVeil(false);
    }
  }

  function onScheduleTick() {
    scheduleTimer = 0;
    syncState();
  }

  function onVisibilityChange() {
    // Going hidden drops the 5-min cap in favor of a single-shot timer at the
    // next transition; becoming visible re-checks immediately (catches sleep/freeze).
    if (document.visibilityState === "hidden") updateScheduleWatcher();
    else syncState();
  }

  function onWindowFocus() {
    syncState();
  }

  // Only keep timers/listeners active when Auto is actually governing this tab.
  function updateScheduleWatcher() {
    clearTimeout(scheduleTimer);
    scheduleTimer = 0;
    const needsWatch = siteState === undefined && globalSetting === "auto";
    if (!needsWatch) {
      if (scheduleListenersBound) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("focus", onWindowFocus);
        scheduleListenersBound = false;
      }
      return;
    }
    if (!scheduleListenersBound) {
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("focus", onWindowFocus);
      scheduleListenersBound = true;
    }
    const now = Date.now();
    const { nextChange } = darkmodeSchedule.getState(now);
    // +500 ms ensures we land strictly past the sunset / sunrise+1h boundary
    // even if the browser fires the timer slightly early.
    const untilChange = Math.max(1000, nextChange - now + 500);
    const delay = document.visibilityState === "hidden"
      ? untilChange
      : Math.min(untilChange, SCHEDULE_TICK_CAP_MS);
    scheduleTimer = setTimeout(onScheduleTick, delay);
  }

  function syncState(brightnessChanged = false) {
    updateScheduleWatcher();
    const wanted = computeDarkWanted();
    if (wanted !== darkWanted) {
      setDarkWanted(wanted);
    } else if (wanted) {
      if (brightnessChanged && isDarkApplied()) applyDarkMode(true, brightness);
      // Dark stays wanted, but its source can change: the site switch forces
      // the inversion, and "All sites" asks the check.
      runCheck();
    }
  }

  // Load state as early as possible to prevent flash
  chrome.storage.local.get([storageKey, globalKey, cacheKey, "darkmode_brightness"], (data) => {
    brightness = data.darkmode_brightness || 100;
    siteState = data[storageKey];
    globalSetting = data[globalKey];
    const wanted = computeDarkWanted();
    updateScheduleWatcher();
    if (!wanted) return;
    // The checks need a page they can measure. A page that was light on the
    // last visit is inverted now, before first paint, so it does not flash white.
    // Any other page is veiled until the first check.
    const cached = (data[cacheKey] || {})[host];
    if (siteState === true || (cached && cached[0] === 1)) applyDarkMode(true, brightness);
    else setVeil(cached ? "canvas" : "hide");
    setDarkWanted(true);
  });

  // The popup asks if this page is inverted now, to show it on the big switch.
  // The popup can ask before the storage event below arrives here, so read
  // the settings first and answer for the state they give.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "darkmode_state") return;
    chrome.storage.local.get([storageKey, globalKey], (data) => {
      siteState = data[storageKey];
      globalSetting = data[globalKey];
      syncState();
      sendResponse({ inverted: isDarkApplied() });
    });
    return true; // the answer comes later
  });

  // React live across all open tabs when settings change in storage —
  // no per-tab messaging needed (same pattern as gmailfix.js and keynav.js).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let relevant = false;
    let brightnessChanged = false;
    if (storageKey in changes) {
      siteState = changes[storageKey].newValue;
      relevant = true;
    }
    if (globalKey in changes) {
      globalSetting = changes[globalKey].newValue;
      relevant = true;
    }
    if ("darkmode_brightness" in changes) {
      brightness = changes.darkmode_brightness.newValue || 100;
      brightnessChanged = true;
      relevant = true;
    }
    if (relevant) syncState(brightnessChanged);
  });
})();
