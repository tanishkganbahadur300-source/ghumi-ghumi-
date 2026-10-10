// Circular carousel: photo cards on a slowly turning ring, seen from the inside
// like a curved wall. Options mirror the CircularCarousel component props.
// Only the cards facing the viewer exist in the page, so it works with hundreds of items.
function createCircularCarousel(container, options) {
  const cfg = Object.assign({
    items: [],            // { src, video, alt, title, subtitle }
    preset: "panorama",
    intro: "rise",        // "rise" = cards rise in one after another; "none" = no intro
    cardWidth: 220,
    aspectRatio: 0.75,    // card width / height
    speed: 14,            // how fast it turns by itself (0 = stays still)
    captions: true,
    tilt: 0,              // degrees the ring leans towards / away from the viewer
    perspective: 1800,
    gap: 24,
    designHeight: 560,    // the sizes above are for a stage this tall; it scales to fit
    onOpen: null          // called with the item's index when a card is clicked
  }, options);

  const items = cfg.items;
  if (!items.length) return null;
  const mod = (n, m) => ((n % m) + m) % m;

  const stage = document.createElement("div");
  stage.className = "ring-stage";
  const ring = document.createElement("div");
  ring.className = "ring";
  stage.appendChild(ring);
  container.classList.add("ring-carousel");
  container.appendChild(stage);

  let scale = 1, radius = 1800, stepDeg = 8, pool = [];
  let rot = 0;        // degrees turned so far (keeps counting)
  let vel = 0;        // extra degrees per second from drag / wheel
  let dragging = false, hovering = false, paused = false;
  let introDone = cfg.intro !== "rise";

  function layout() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    scale = Math.min(h / cfg.designHeight, 1.6);
    radius = cfg.perspective * scale; // the viewer stands at the centre of the ring
    const cardW = cfg.cardWidth * scale;
    const cardH = cardW / cfg.aspectRatio;
    stepDeg = ((cardW + cfg.gap * scale) / radius) * 180 / Math.PI;
    stage.style.perspective = radius + "px";

    // enough cards to cover the screen plus a couple each side
    const halfView = Math.atan((w / 2) / radius) * 180 / Math.PI;
    const needed = Math.ceil((halfView * 2) / stepDeg) + 5;
    while (pool.length < needed) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ring-card";
      const img = document.createElement("img");
      img.decoding = "async";
      img.draggable = false;
      el.appendChild(img);
      const cap = document.createElement("span");
      cap.className = "ring-caption";
      el.appendChild(cap);
      ring.appendChild(el);
      pool.push({ el, img, cap, slot: null });
    }
    while (pool.length > needed) ring.removeChild(pool.pop().el);
    pool.forEach((c) => {
      c.slot = null;
      c.el.style.width = cardW.toFixed(1) + "px";
      c.el.style.height = cardH.toFixed(1) + "px";
      c.el.style.borderRadius = 16 * scale + "px";
    });
    render();
  }

  // Which photo belongs in place number `slot`? Returns -1 for a place that stays empty.
  // With enough photos to go all the way round they simply run on and the ring never ends.
  // With only a few, each one is shown once: the first sits in the middle, the next ones
  // go to its right and left, and the other places stay empty until more are added.
  function itemAt(slot) {
    const n = items.length;
    if (n >= pool.length) return mod(slot, n);
    const c = mod(slot, pool.length);
    const side = c <= pool.length / 2 ? c : c - pool.length; // 0, 1, 2 ... then -1, -2 ...
    const rank = side >= 0 ? side * 2 : -side * 2 - 1;       // 0, +1, -1, +2, -2 -> 0, 2, 1, 4, 3
    return rank < n ? rank : -1;
  }

  function render() {
    // Each card carries the whole transform itself. (Turning one parent element instead
    // would park that element exactly at the viewer's eye, and browsers then stop
    // registering clicks on the cards inside it.)
    const lead = "translate(-50%, -50%) translateZ(" + radius.toFixed(1) + "px) rotateX(" + cfg.tilt + "deg) rotateY(";
    const tail = "deg) translateZ(" + (-radius).toFixed(1) + "px)";
    const place = (card) => { card.el.style.transform = lead + (rot - card.slot * stepDeg).toFixed(3) + tail; };

    const centre = Math.round(rot / stepDeg);
    const half = Math.floor(pool.length / 2);
    for (let slot = centre - half; slot <= centre + half; slot++) {
      const card = pool[mod(slot, pool.length)];
      if (card.slot === slot) {
        place(card);
        continue;
      }
      card.slot = slot;
      place(card);
      const index = itemAt(slot);
      const item = index === -1 ? null : items[index];
      card.el.dataset.index = index;
      card.el.classList.toggle("is-empty", !item);
      card.el.disabled = !item;
      if (!item) {
        // an empty place, waiting for the next photo
        card.el.classList.remove("is-video");
        card.el.removeAttribute("aria-label");
        card.img.removeAttribute("src");
        card.img.alt = "";
        card.cap.hidden = true;
      } else {
      card.el.classList.toggle("is-video", !!item.video);
      card.el.setAttribute("aria-label", item.title || item.alt || (item.video ? "Play video" : "Open photo"));
      if (card.img.getAttribute("src") !== item.src) card.img.src = item.src;
      card.img.alt = item.alt || "";

      const hasCaption = cfg.captions && (item.title || item.subtitle);
      card.cap.hidden = !hasCaption;
      if (hasCaption) {
        card.cap.textContent = "";
        if (item.title) {
          const t = document.createElement("strong");
          t.textContent = item.title;
          card.cap.appendChild(t);
        }
        if (item.subtitle) {
          const s = document.createElement("small");
          s.textContent = item.subtitle;
          card.cap.appendChild(s);
        }
      }
      }

      if (!introDone) {
        card.el.classList.add("is-rising");
        card.el.style.animationDelay = Math.max(0, slot - (centre - half)) * 70 + "ms";
      } else {
        card.el.classList.remove("is-rising");
        card.el.style.animationDelay = "";
      }
    }
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // "speed" is tuned for a small ring; turned into an on-screen drift of about speed x 5 px a second
  // it only turns by itself once there are enough photos to fill the ring
  const autoDegPerSec = () => (reducedMotion || items.length < pool.length ? 0 : ((cfg.speed * 5 * scale) / radius) * 180 / Math.PI);
  const degPerPx = () => (180 / Math.PI) / radius;

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!dragging && !paused) {
      const auto = hovering ? 0 : autoDegPerSec();
      if (auto || vel) {
        rot += (auto + vel) * dt;
        vel *= Math.exp(-dt * 2.5);
        if (Math.abs(vel) < 0.05) vel = 0;
        render();
      }
    }
    requestAnimationFrame(frame);
  }

  let startX = 0, lastX = 0, lastT = 0, moved = 0, downCard = null;
  container.style.touchAction = "pan-y";
  container.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    introDone = true;
    vel = 0;
    moved = 0;
    startX = lastX = e.clientX;
    lastT = performance.now();
    downCard = e.target.closest ? e.target.closest(".ring-card") : null;
    container.setPointerCapture(e.pointerId);
    container.classList.add("is-dragging");
  });
  container.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    moved = Math.max(moved, Math.abs(e.clientX - startX));
    // inside the ring, dragging right brings the cards on the left into view
    rot -= dx * degPerPx();
    vel = (-dx * degPerPx()) / Math.max(0.001, (now - lastT) / 1000);
    lastX = e.clientX;
    lastT = now;
    render();
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    container.classList.remove("is-dragging");
    if (performance.now() - lastT > 80) vel = 0;
    vel = Math.max(-60, Math.min(60, vel));
    const index = downCard ? Number(downCard.dataset.index) : -1;
    if (moved < 6 && index >= 0 && cfg.onOpen) {
      vel = 0;
      cfg.onOpen(index);
    }
    downCard = null;
  }
  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", () => { downCard = null; endDrag(); });

  ring.addEventListener("pointerover", (e) => { if (e.pointerType === "mouse" && e.target.closest(".ring-card")) hovering = true; });
  ring.addEventListener("pointerout", (e) => { if (e.target.closest(".ring-card")) hovering = false; });

  ring.addEventListener("keydown", (e) => {
    const card = e.target.closest(".ring-card");
    const index = card ? Number(card.dataset.index) : -1;
    if (index >= 0 && (e.key === "Enter" || e.key === " ") && cfg.onOpen) {
      e.preventDefault();
      cfg.onOpen(index);
    }
  });
  window.addEventListener("keydown", (e) => {
    if (paused) return;
    if (e.key === "ArrowRight") vel = Math.min(60, vel + 12);
    if (e.key === "ArrowLeft") vel = Math.max(-60, vel - 12);
  });

  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    introDone = true;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    vel = Math.max(-60, Math.min(60, vel + delta * 0.06));
  }, { passive: false });

  if (!introDone) setTimeout(() => { introDone = true; }, 1600);
  window.addEventListener("resize", layout);
  layout();
  requestAnimationFrame(frame);

  return {
    pause() { paused = true; },
    resume() { paused = false; hovering = false; last = performance.now(); }
  };
}
