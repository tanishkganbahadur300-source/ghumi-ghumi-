// Infinite spiral of photo cards. Options mirror the InfiniteSpiral component props.
function createInfiniteSpiral(container, options) {
  const cfg = Object.assign({
    items: [],
    animationMode: "all", // "auto" | "scroll" | "drag" | "all"
    speed: 0.55,          // cards per second
    radius: 170,
    cardWidth: 100,
    cardHeight: 100,
    verticalSpacing: 60,  // gap between one turn of the spiral and the next
    perspective: 1000,
    cardRadius: 10,
    centerScale: 1.2,
    edgeBlur: 6,
    edgeFade: 1,          // how much cards fade out towards the top / bottom (0 - 1)
    cardsPerTurn: 7,
    pauseOnHover: true,
    imageFit: "cover",    // "cover" fills the card (crops), "contain" shows the whole photo
    designHeight: 600,    // the sizes above are for a stage this tall; it scales to fit
    onOpen: null          // called with the photo's index when a card is clicked
  }, options);

  const items = cfg.items;
  if (!items.length) return;

  const modes = cfg.animationMode === "all" ? ["auto", "scroll", "drag"] : [cfg.animationMode];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const autoPlay = modes.includes("auto") && !reducedMotion;
  const step = (Math.PI * 2) / cfg.cardsPerTurn;
  const rise = (cfg.cardHeight + cfg.verticalSpacing) / cfg.cardsPerTurn; // vertical step per card
  const mod = (n, m) => ((n % m) + m) % m;

  const stage = document.createElement("div");
  stage.className = "spiral-stage";
  container.appendChild(stage);

  let scale = 1;
  let halfHeight = 300;
  let pool = [];

  function layout() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const designWidth = cfg.radius * 2 + cfg.cardWidth * cfg.centerScale + 40;
    scale = Math.min(h / cfg.designHeight, w / designWidth);
    halfHeight = h / 2;
    stage.style.perspective = cfg.perspective * scale + "px";

    // enough cards to cover the stage, plus a few off-screen so images load early
    const needed = Math.ceil(h / (rise * scale)) + cfg.cardsPerTurn * 2;
    while (pool.length < needed) {
      const el = document.createElement("div");
      el.className = "spiral-card";
      const img = document.createElement("img");
      img.decoding = "async";
      img.draggable = false;
      img.style.objectFit = cfg.imageFit;
      el.appendChild(img);
      stage.appendChild(el);
      pool.push({ el, img, slot: null });
    }
    while (pool.length > needed) stage.removeChild(pool.pop().el);
    pool.forEach((c) => {
      c.slot = null;
      c.el.style.width = cfg.cardWidth * scale + "px";
      c.el.style.height = cfg.cardHeight * scale + "px";
      c.el.style.borderRadius = cfg.cardRadius * scale + "px";
    });
  }

  let position = 0; // which card sits at the centre (fractional)
  let velocity = 0; // extra cards per second from wheel / drag
  let hovering = false;
  let dragging = false;
  let paused = false;

  function render() {
    const first = Math.round(position) - Math.floor(pool.length / 2);
    for (let i = 0; i < pool.length; i++) {
      const slot = first + i;
      const card = pool[mod(slot, pool.length)];
      if (card.slot !== slot) {
        card.slot = slot;
        const item = items[mod(slot, items.length)];
        card.img.src = item.src;
        card.img.alt = item.alt || "";
        card.el.dataset.index = mod(slot, items.length);
      }

      const d = slot - position;
      const angle = d * step;
      const x = Math.sin(angle) * cfg.radius * scale;
      const z = Math.cos(angle) * cfg.radius * scale;
      const y = d * rise * scale;

      const edge = Math.min(1, Math.abs(y) / halfHeight); // 0 centre, 1 top/bottom edge
      const front = Math.max(0, Math.cos(angle));          // 1 facing the viewer
      const s = 1 + (cfg.centerScale - 1) * front * (1 - edge);
      const blur = cfg.edgeBlur * scale * edge * edge;
      const brightness = 0.45 + 0.55 * (Math.cos(angle) + 1) / 2;

      const st = card.el.style;
      st.transform =
        "translate(-50%, -50%) translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px," + z.toFixed(2) + "px) " +
        "rotateY(" + angle.toFixed(4) + "rad) scale(" + s.toFixed(3) + ")";
      st.opacity = Math.max(0, 1 - cfg.edgeFade * edge * edge).toFixed(3);
      st.filter = "brightness(" + brightness.toFixed(2) + ")" + (blur > 0.3 ? " blur(" + blur.toFixed(1) + "px)" : "");
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!dragging && !paused) {
      const auto = autoPlay && !(cfg.pauseOnHover && hovering) ? cfg.speed : 0;
      position += (auto + velocity) * dt;
      velocity *= Math.pow(0.05, dt); // ease out
      if (Math.abs(velocity) < 0.01) velocity = 0;
    }
    render();
    requestAnimationFrame(frame);
  }

  if (cfg.pauseOnHover) {
    stage.addEventListener("pointerover", (e) => { if (e.target.closest(".spiral-card")) hovering = true; });
    stage.addEventListener("pointerout", (e) => { if (e.target.closest(".spiral-card")) hovering = false; });
  }

  if (modes.includes("scroll")) {
    container.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      velocity += delta / (rise * scale) * 2;
      velocity = Math.max(-40, Math.min(40, velocity));
    }, { passive: false });
  }

  if (modes.includes("drag")) {
    let lastY = 0, lastT = 0, startX = 0, startY = 0, travelled = 0, downCard = null;
    container.style.touchAction = "none";
    container.style.cursor = "grab";
    container.addEventListener("pointerdown", (e) => {
      dragging = true;
      velocity = 0;
      travelled = 0;
      startX = e.clientX;
      startY = e.clientY;
      downCard = e.target.closest ? e.target.closest(".spiral-card") : null;
      lastY = e.clientY;
      lastT = performance.now();
      container.setPointerCapture(e.pointerId);
      container.style.cursor = "grabbing";
    });
    container.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const now = performance.now();
      travelled = Math.max(travelled, Math.hypot(e.clientX - startX, e.clientY - startY));
      const moved = -(e.clientY - lastY) / (rise * scale);
      position += moved;
      velocity = moved / Math.max(0.001, (now - lastT) / 1000);
      lastY = e.clientY;
      lastT = now;
    });
    const end = () => {
      dragging = false;
      hovering = false;
      velocity = Math.max(-40, Math.min(40, velocity));
      container.style.cursor = "grab";
    };
    container.addEventListener("pointerup", () => {
      const wasDragging = dragging;
      end();
      // a press and release without moving is a click: open that photo
      if (wasDragging && travelled < 6 && downCard && cfg.onOpen) {
        velocity = 0;
        cfg.onOpen(Number(downCard.dataset.index));
      }
      downCard = null;
    });
    container.addEventListener("pointercancel", () => { downCard = null; end(); });
  }

  window.addEventListener("keydown", (e) => {
    if (paused) return;
    if (e.key === "ArrowDown") velocity += 4;
    if (e.key === "ArrowUp") velocity -= 4;
  });

  window.addEventListener("resize", layout);
  layout();
  requestAnimationFrame(frame);

  return {
    pause() { paused = true; },
    resume() { paused = false; }
  };
}
