(() => {
  const PETAL_WAVE_MARK = "petalWaveHandled";
  let waveObserver = null;
  let audioObserver = null;

  function relocateMemoryText() {
    const caption = byId("heroCaption");
    const stage = byId("heroStage");
    if (!caption || !stage) return;
    const section = stage.closest(".hero-section");
    if (!section) return;
    let area = byId("heroMemoryTextArea");
    if (!area) {
      area = document.createElement("div");
      area.id = "heroMemoryTextArea";
      area.className = "hero-memory-text-area";
      section.insertBefore(area, stage);
    }
    if (caption.parentElement !== area) area.appendChild(caption);
  }

  function polishAudioPanel() {
    const section = byId("audioSection");
    if (!section) return;
    section.classList.add("audio-compact");
    const intro = section.querySelector(".audio-top p");
    if (intro) intro.textContent = "Background playlist for the carousel.";
    const now = byId("audioNow");
    if (now && now.textContent.startsWith("Choose songs")) now.textContent = "Playing: no active song yet";
    if (!audioObserver) {
      audioObserver = new MutationObserver(() => window.setTimeout(polishAudioPanel, 0));
      audioObserver.observe(section, { childList: true, subtree: true });
    }
  }

  function numberFromVar(element, name, fallback) {
    const value = element.style.getPropertyValue(name).trim();
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function spawnCompanionPetal(origin, index) {
    const layer = origin.parentElement;
    if (!layer) return;
    const petal = document.createElement("span");
    petal.className = "anniv-object petal";
    petal.dataset.waveMember = "true";
    petal.innerHTML = `<span class="anniv-shadow"></span><span class="anniv-shape"></span>`;

    const startX = numberFromVar(origin, "--start-x", -8);
    const startY = numberFromVar(origin, "--start-y", 42);
    const travelX = numberFromVar(origin, "--travel-x", 112);
    const travelY = numberFromVar(origin, "--travel-y", -28);
    const duration = numberFromVar(origin, "--duration", 8.5);
    const size = numberFromVar(origin, "--size", 18);

    petal.style.setProperty("--start-x", `${startX + random(-4, 5)}vw`);
    petal.style.setProperty("--start-y", `${startY + random(-8, 8)}vh`);
    petal.style.setProperty("--travel-x", `${travelX + random(-14, 14)}vw`);
    petal.style.setProperty("--travel-y", `${travelY + random(-14, 14)}vh`);
    petal.style.setProperty("--duration", `${duration + random(-1.2, 1.6)}s`);
    petal.style.setProperty("--delay", `${0.08 + index * random(0.08, 0.18)}s`);
    petal.style.setProperty("--size", `${Math.max(10, size + random(-5, 6))}px`);
    petal.style.setProperty("--rotate-start", `${random(-42, 28)}deg`);
    petal.style.setProperty("--rotate-end", `${random(-28, 74)}deg`);
    petal.style.setProperty("--end-scale", `${random(0.78, 1.18)}`);
    petal.style.setProperty("--shadow-scale", `${random(0.66, 1.28)}`);
    petal.style.setProperty("--shadow-opacity", `${random(0.08, 0.18)}`);
    petal.style.setProperty("--peak-opacity", `${random(0.42, 0.74)}`);
    layer.appendChild(petal);
    window.setTimeout(() => petal.remove(), (duration + 2.4) * 1000);
  }

  function createPetalWave(origin) {
    if (!origin || origin.dataset[PETAL_WAVE_MARK] || origin.dataset.waveMember) return;
    origin.dataset[PETAL_WAVE_MARK] = "true";
    if (document.body.dataset.fxOff === "true" || document.body.dataset.motionReduced === "true") return;
    const count = Math.floor(random(3, 6));
    for (let index = 0; index < count; index += 1) spawnCompanionPetal(origin, index);
  }

  function observePetals() {
    const layer = document.querySelector(".anniversary-fx-layer");
    if (!layer || waveObserver) return;
    waveObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList?.contains("petal")) createPetalWave(node);
        });
      }
    });
    waveObserver.observe(layer, { childList: true });
  }

  function refreshCorrections() {
    relocateMemoryText();
    polishAudioPanel();
    observePetals();
  }

  const originalRenderAll = typeof renderAll === "function" ? renderAll : null;
  if (originalRenderAll) {
    renderAll = function correctedRenderAll(...args) {
      const result = originalRenderAll.apply(this, args);
      window.setTimeout(refreshCorrections, 0);
      return result;
    };
  }

  const originalRenderCarousel = typeof renderCarousel === "function" ? renderCarousel : null;
  if (originalRenderCarousel) {
    renderCarousel = function correctedRenderCarousel(...args) {
      const result = originalRenderCarousel.apply(this, args);
      window.setTimeout(relocateMemoryText, 0);
      return result;
    };
  }

  window.setInterval(observePetals, 2200);
  window.setTimeout(refreshCorrections, 300);
})();
