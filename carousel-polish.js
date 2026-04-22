(() => {
  const FX_PREFS_KEY = "anniversary-memories-fx-v1";
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const icons = {
    install: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"></path><path d="m7 10 5 5 5-5"></path><path d="M5 19h14"></path></svg>`,
    carousel: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"></rect><path d="M8 9h8"></path><path d="M8 13h5"></path></svg>`,
    pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12"></path><path d="M15 6v12"></path></svg>`,
    play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12l9-6-9-6Z"></path></svg>`,
    sparkle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.4 5.1L18 10l-4.6 1.9L12 17l-1.4-5.1L6 10l4.6-1.9L12 3Z"></path><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"></path></svg>`,
    sparkleOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.4 5.1L18 10l-4.6 1.9L12 17l-1.4-5.1L6 10l4.6-1.9L12 3Z"></path><path d="m4 4 16 16"></path></svg>`
  };

  function loadFxPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(FX_PREFS_KEY) || "{}");
      return {
        enabled: saved.enabled !== false,
        reduced: saved.reduced === true
      };
    } catch {
      return { enabled: true, reduced: false };
    }
  }

  const fxPrefs = loadFxPrefs();
  let fxLayer = null;
  let fxTimer = null;
  let doveTimer = null;

  function saveFxPrefs() {
    localStorage.setItem(FX_PREFS_KEY, JSON.stringify(fxPrefs));
  }

  function shouldReduceMotion() {
    return fxPrefs.reduced || prefersReduced?.matches;
  }

  function iconButton(button, icon, title) {
    if (!button) return;
    button.innerHTML = icon;
    button.title = title;
    button.setAttribute("aria-label", title);
  }

  function updatePlayIcon() {
    const button = byId("playToggle");
    if (!button) return;
    const playing = state.carousel?.playing !== false;
    button.innerHTML = playing ? icons.pause : icons.play;
    button.title = playing ? "Pause carousel" : "Play carousel";
    button.setAttribute("aria-label", button.title);
  }

  function decorateIcons() {
    iconButton(byId("installBtn"), icons.install, "Install app");
    iconButton(byId("settingsButton"), icons.carousel, "Carousel controls");
    updatePlayIcon();
    const playButton = byId("playToggle");
    if (playButton && !playButton.dataset.polishObserved) {
      playButton.dataset.polishObserved = "true";
      new MutationObserver(() => {
        if (!playButton.querySelector("svg")) window.setTimeout(updatePlayIcon, 0);
      }).observe(playButton, { childList: true, characterData: true, subtree: true });
    }
  }

  function applyFolderGlowSeeds() {
    document.querySelectorAll(".folder-card").forEach((card, index) => {
      card.style.setProperty("--glow-seed", String((index % 7) + 1));
    });
  }

  function ensureFxLayer() {
    if (fxLayer) return fxLayer;
    fxLayer = document.createElement("div");
    fxLayer.className = "anniversary-fx-layer";
    fxLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(fxLayer);
    return fxLayer;
  }

  function applyMotionState() {
    document.body.dataset.fxOff = fxPrefs.enabled ? "false" : "true";
    document.body.dataset.motionReduced = shouldReduceMotion() ? "true" : "false";
    const toggle = byId("fxToggle");
    if (toggle) {
      toggle.innerHTML = fxPrefs.enabled && !shouldReduceMotion() ? icons.sparkle : icons.sparkleOff;
      toggle.title = fxPrefs.enabled ? "Turn animations off" : "Turn animations on";
      toggle.setAttribute("aria-label", toggle.title);
    }
    if (fxPrefs.enabled && !shouldReduceMotion()) startFx();
    else stopFx();
  }

  function ensureFxControls() {
    if (!byId("fxToggle")) {
      const button = document.createElement("button");
      button.id = "fxToggle";
      button.className = "fx-toggle";
      button.type = "button";
      button.addEventListener("click", () => {
        fxPrefs.enabled = !fxPrefs.enabled;
        saveFxPrefs();
        applyMotionState();
      });
      document.body.appendChild(button);
    }

    const settingsShell = byId("settingsDialog")?.querySelector(".dialog-shell");
    if (settingsShell && !byId("motionControlsCard")) {
      const section = document.createElement("section");
      section.className = "control-card settings-list";
      section.id = "motionControlsCard";
      section.innerHTML = `<div class="setting-row">
        <div><strong>Anniversary animations</strong><p>Let petals, sparkles, hearts, and the dove drift over the home screen.</p></div>
        <input id="fxEnabledInput" type="checkbox">
      </div>
      <div class="setting-row">
        <div><strong>Reduce motion</strong><p>Use a calmer home screen while keeping the app fully usable.</p></div>
        <input id="fxReducedInput" type="checkbox">
      </div>`;
      settingsShell.appendChild(section);
      byId("fxEnabledInput").addEventListener("change", (event) => {
        fxPrefs.enabled = event.target.checked;
        saveFxPrefs();
        applyMotionState();
      });
      byId("fxReducedInput").addEventListener("change", (event) => {
        fxPrefs.reduced = event.target.checked;
        saveFxPrefs();
        applyMotionState();
      });
    }
    const enabledInput = byId("fxEnabledInput");
    const reducedInput = byId("fxReducedInput");
    if (enabledInput) enabledInput.checked = fxPrefs.enabled;
    if (reducedInput) reducedInput.checked = fxPrefs.reduced || prefersReduced?.matches;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function createObject(kind = "petal") {
    if (!fxPrefs.enabled || shouldReduceMotion() || document.hidden) return;
    const layer = ensureFxLayer();
    const element = document.createElement("span");
    element.className = `anniv-object ${kind}`;
    element.innerHTML = `<span class="anniv-shadow"></span><span class="anniv-shape"></span>`;
    const fromLeft = Math.random() > 0.5;
    const duration = kind === "dove" ? random(8.2, 12.5) : random(6.5, 11.5);
    const size = kind === "dove" ? random(42, 62) : kind === "sparkle" ? random(13, 22) : random(14, 27);
    const startX = fromLeft ? random(-14, 6) : random(94, 108);
    const travelX = fromLeft ? random(102, 124) : random(-118, -96);
    const travelY = kind === "dove" ? random(-36, 18) : random(-42, 34);
    const startY = kind === "dove" ? random(18, 62) : random(20, 82);
    element.style.setProperty("--start-x", `${startX}vw`);
    element.style.setProperty("--start-y", `${startY}vh`);
    element.style.setProperty("--travel-x", `${travelX}vw`);
    element.style.setProperty("--travel-y", `${travelY}vh`);
    element.style.setProperty("--duration", `${duration}s`);
    element.style.setProperty("--size", `${size}px`);
    element.style.setProperty("--rotate-start", `${random(-28, 20)}deg`);
    element.style.setProperty("--rotate-end", `${random(-18, 54)}deg`);
    element.style.setProperty("--end-scale", `${random(0.82, 1.18)}`);
    element.style.setProperty("--shadow-scale", `${random(0.72, 1.36)}`);
    element.style.setProperty("--shadow-opacity", `${kind === "sparkle" ? random(0.06, 0.12) : random(0.12, 0.24)}`);
    element.style.setProperty("--peak-opacity", `${kind === "sparkle" ? random(0.5, 0.76) : random(0.62, 0.9)}`);
    if (!fromLeft) element.style.scale = "-1 1";
    layer.appendChild(element);
    window.setTimeout(() => element.remove(), duration * 1000 + 500);
  }

  function scheduleNextFx() {
    if (!fxPrefs.enabled || shouldReduceMotion()) return;
    const kinds = ["petal", "petal", "sparkle", "heart"];
    createObject(kinds[Math.floor(Math.random() * kinds.length)]);
    fxTimer = window.setTimeout(scheduleNextFx, random(1700, 4100));
  }

  function scheduleNextDove() {
    if (!fxPrefs.enabled || shouldReduceMotion()) return;
    createObject("dove");
    doveTimer = window.setTimeout(scheduleNextDove, random(19000, 33000));
  }

  function startFx() {
    ensureFxLayer();
    if (!fxTimer) fxTimer = window.setTimeout(scheduleNextFx, 900);
    if (!doveTimer) doveTimer = window.setTimeout(scheduleNextDove, 4200);
  }

  function stopFx() {
    if (fxTimer) window.clearTimeout(fxTimer);
    if (doveTimer) window.clearTimeout(doveTimer);
    fxTimer = null;
    doveTimer = null;
    fxLayer?.querySelectorAll(".anniv-object").forEach((item) => item.remove());
  }

  function refreshPolish() {
    decorateIcons();
    applyFolderGlowSeeds();
    ensureFxControls();
    applyMotionState();
  }

  const originalRenderAll = typeof renderAll === "function" ? renderAll : null;
  if (originalRenderAll) {
    renderAll = function polishedRenderAll(...args) {
      const result = originalRenderAll.apply(this, args);
      window.setTimeout(refreshPolish, 0);
      return result;
    };
  }

  const originalRenderCarousel = typeof renderCarousel === "function" ? renderCarousel : null;
  if (originalRenderCarousel) {
    renderCarousel = function polishedRenderCarousel(...args) {
      const result = originalRenderCarousel.apply(this, args);
      window.setTimeout(updatePlayIcon, 0);
      return result;
    };
  }

  const originalRenderSettings = typeof renderSettings === "function" ? renderSettings : null;
  if (originalRenderSettings) {
    renderSettings = function polishedRenderSettings(...args) {
      const result = originalRenderSettings.apply(this, args);
      window.setTimeout(ensureFxControls, 0);
      return result;
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopFx();
    else applyMotionState();
  });

  prefersReduced?.addEventListener?.("change", applyMotionState);
  window.setTimeout(refreshPolish, 250);
})();
