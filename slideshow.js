// Full-page background slideshow: cross-fades through every photo, then repeats.
function createBackgroundSlideshow(container, options) {
  const cfg = Object.assign({
    images: [],
    interval: 6000, // time each photo stays, in ms
    shuffle: true
  }, options);

  const list = cfg.images.slice();
  if (!list.length) return;
  if (cfg.shuffle) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  // two stacked layers; the hidden one loads the next photo, then they swap
  const layers = [0, 1].map(() => {
    const el = document.createElement("div");
    el.className = "bg-slide";
    container.appendChild(el);
    return el;
  });

  let index = 0;
  let front = 0;

  function show(i) {
    const src = list[i % list.length];
    const img = new Image();
    img.onload = img.onerror = () => {
      const next = layers[1 - front];
      next.style.backgroundImage = 'url("' + src + '")';
      next.classList.add("is-visible");
      layers[front].classList.remove("is-visible");
      front = 1 - front;
    };
    img.src = src;
  }

  show(index);
  setInterval(() => {
    if (document.hidden) return;
    index++;
    show(index);
  }, cfg.interval);
}
