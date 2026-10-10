// Dome gallery: photo tiles on the surface of a big sphere that you drag to spin.
// Options mirror the DomeGallery component props. Only the tiles facing the
// viewer exist in the page, so it works with thousands of items.
function createDomeGallery(container, options) {
  const cfg = Object.assign({
    items: [],
    fit: 1,                     // size of the sphere relative to the screen
    maxVerticalRotationDeg: 20, // how far it can tilt up / down
    dragDampening: 5,           // higher = it keeps gliding longer after a drag
    grayscale: false,
    onOpen: null                // called with the item's index when a tile is clicked
  }, options);

  const STEP = 10;         // degrees between neighbouring tiles
  const VISIBLE_HALF = 80; // columns further than this from the front are not drawn
  const POOL_COLS = Math.floor((VISIBLE_HALF * 2) / STEP) + 3;
  const mod = (n, m) => ((n % m) + m) % m;

  let items = cfg.items;
  let rows = 7;            // tiles per column; set in layout() so every row can be brought fully on screen

  const stage = document.createElement("div");
  stage.className = "dome-stage";
  const sphere = document.createElement("div");
  sphere.className = "dome-sphere";
  stage.appendChild(sphere);
  container.appendChild(stage);
  if (cfg.grayscale) sphere.style.filter = "grayscale(1)";

  // one pooled column = `rows` tiles that get re-used as the dome turns
  let columns = [];
  function buildPool() {
    sphere.textContent = "";
    columns = [];
    for (let i = 0; i < POOL_COLS; i++) {
      const tiles = [];
      for (let r = 0; r < rows; r++) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "dome-tile";
        const img = document.createElement("img");
        img.decoding = "async";
        img.draggable = false;
        img.alt = "";
        el.appendChild(img);
        sphere.appendChild(el);
        tiles.push({ el, img });
      }
      columns.push({ col: null, tiles });
    }
  }

  let radius = 800;
  let rotY = 0;  // degrees, unbounded: keeps counting as you spin
  let rotX = 0;
  let velY = 0;  // degrees per second
  let velX = 0;
  let dragging = false;

  function layout() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    radius = Math.max(w, h * 0.9) * 0.72 * cfg.fit;
    stage.style.perspective = radius * 2 + "px";

    // How far up the sphere can a tile sit and still be fully seen once the dome is tilted
    // all the way? A tile at angle a from the middle appears at  2R*sin(a) / (3 - cos(a))
    // pixels from the centre of the screen; find the largest a that stays inside it.
    let edge = 0;
    while (edge < 80 && (2 * radius * Math.sin((edge + 1) * Math.PI / 180)) / (3 - Math.cos((edge + 1) * Math.PI / 180)) <= h / 2) edge++;
    const reach = edge + cfg.maxVerticalRotationDeg - STEP / 2; // centre of the highest fully visible tile
    const perSide = Math.max(1, Math.floor((reach - STEP / 2) / STEP)); // STEP / 2 = the stagger of odd columns
    const wanted = Math.min(9, perSide * 2 + 1);
    if (wanted !== rows || !columns.length) {
      rows = wanted;
      buildPool();
    }
    columns.forEach((c) => { c.col = null; });
    render();
  }

  // Which item belongs on tile (col, r)? Returns -1 for a tile that stays empty.
  // With plenty of items they simply run on, column after column, and the dome never ends.
  // With only a few, each one is shown once: they start in the middle of the dome and
  // spread outwards, and the remaining tiles stay empty until more are added.
  function itemAt(col, r) {
    const n = items.length;
    if (n >= POOL_COLS * rows) return mod(col * rows + r, n);
    const c = mod(col, POOL_COLS);
    const side = c <= POOL_COLS / 2 ? c : c - POOL_COLS;      // 0, 1, 2 ... then -1, -2 ...
    const colRank = side >= 0 ? side * 2 : -side * 2 - 1;     // 0, +1, -1, +2, -2 -> 0, 2, 1, 4, 3
    const mid = (rows - 1) / 2;
    const up = r - mid;
    const rowRank = up >= 0 ? up * 2 : -up * 2 - 1;           // middle row first, then above / below
    const index = colRank * rows + rowRank;
    return index < n ? index : -1;
  }

  function placeColumn(slot, col) {
    slot.col = col;
    const stagger = mod(col, 2) ? STEP / 2 : 0;
    const base = (2 * radius * Math.tan((STEP / 2) * Math.PI / 180)) * 0.93;
    for (let r = 0; r < rows; r++) {
      const tile = slot.tiles[r];
      const lat = (r - (rows - 1) / 2) * STEP + stagger;
      const width = base * Math.cos(lat * Math.PI / 180); // narrower towards the top / bottom
      const st = tile.el.style;
      st.width = width.toFixed(1) + "px";
      st.height = base.toFixed(1) + "px";
      st.transform =
        "translate(-50%, -50%) rotateY(" + (col * STEP) + "deg) rotateX(" + (-lat) + "deg) translateZ(" + radius.toFixed(1) + "px)";

      const index = itemAt(col, r);
      const item = index === -1 ? null : items[index];
      tile.el.dataset.index = index;
      tile.el.classList.toggle("is-empty", !item);
      tile.el.classList.toggle("is-video", !!item && item.t === "v");
      tile.el.disabled = !item;
      if (!item) {
        tile.el.removeAttribute("aria-label");
        tile.img.removeAttribute("src");
        continue;
      }
      tile.el.setAttribute("aria-label", item.t === "v" ? "Play video" : "Open photo");
      if (tile.img.getAttribute("src") !== item.thumb) tile.img.src = item.thumb;
    }
  }

  function render() {
    sphere.style.transform =
      "translateZ(" + (-radius).toFixed(1) + "px) rotateX(" + rotX.toFixed(3) + "deg) rotateY(" + rotY.toFixed(3) + "deg)";

    // the column currently facing the viewer, and its neighbours either side
    const centre = Math.round(-rotY / STEP);
    const half = Math.floor(POOL_COLS / 2);
    for (let col = centre - half; col <= centre + half; col++) {
      const slot = columns[mod(col, POOL_COLS)];
      if (slot.col !== col) placeColumn(slot, col);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!dragging && (velY || velX)) {
      rotY += velY * dt;
      rotX = clampX(rotX + velX * dt);
      const decay = Math.exp(-dt * 10 / Math.max(0.5, cfg.dragDampening));
      velY *= decay;
      velX *= decay;
      if (Math.abs(velY) < 0.5) velY = 0;
      if (Math.abs(velX) < 0.5) velX = 0;
      render();
    }
    requestAnimationFrame(frame);
  }

  const clampX = (v) => Math.max(-cfg.maxVerticalRotationDeg, Math.min(cfg.maxVerticalRotationDeg, v));
  const degPerPx = () => (180 / Math.PI) / radius;

  let startX = 0, startY = 0, lastX = 0, lastY = 0, lastT = 0, moved = 0, downTile = null;
  container.style.touchAction = "none";
  container.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    velY = velX = 0;
    moved = 0;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    lastT = performance.now();
    downTile = e.target.closest ? e.target.closest(".dome-tile") : null;
    container.setPointerCapture(e.pointerId);
    container.classList.add("is-dragging");
  });
  container.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const dt = Math.max(0.001, (now - lastT) / 1000);
    moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY));
    rotY += dx * degPerPx();
    rotX = clampX(rotX - dy * degPerPx());
    velY = (dx * degPerPx()) / dt;
    velX = (-dy * degPerPx()) / dt;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
    render();
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    container.classList.remove("is-dragging");
    if (performance.now() - lastT > 80) velY = velX = 0; // held still before letting go
    velY = Math.max(-400, Math.min(400, velY));
    velX = Math.max(-200, Math.min(200, velX));
    const index = downTile ? Number(downTile.dataset.index) : -1;
    if (moved < 6 && index >= 0 && cfg.onOpen) {
      velY = velX = 0;
      cfg.onOpen(index);
    }
    downTile = null;
  }
  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", () => { downTile = null; endDrag(); });

  // keyboard: Enter / Space on a focused tile opens it
  sphere.addEventListener("keydown", (e) => {
    const tile = e.target.closest(".dome-tile");
    const index = tile ? Number(tile.dataset.index) : -1;
    if (index >= 0 && (e.key === "Enter" || e.key === " ") && cfg.onOpen) {
      e.preventDefault();
      cfg.onOpen(index);
    }
  });

  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    velY = Math.max(-400, Math.min(400, velY - delta * 0.25));
  }, { passive: false });

  window.addEventListener("resize", layout);
  layout();
  requestAnimationFrame(frame);

  return {
    setItems(next) {
      items = next;
      rotY = 0;
      rotX = 0;
      velY = velX = 0;
      columns.forEach((c) => { c.col = null; });
      render();
    },
    spin(deg) { velY += deg; },
    get rows() { return rows; }
  };
}
