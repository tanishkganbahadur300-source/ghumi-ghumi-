// Where the site's photos and videos are loaded from.
// ""  = from the site's own folders (wall/, images/, assets/), as on your own computer.
// When the media is moved to cloud storage, put that storage's web address here,
// ending in a slash, for example "https://media.example.com/".
const MEDIA_BASE = "";

const mediaUrl = (path) => MEDIA_BASE + path;

// The photo lists (wall.js, images.js, backgrounds.js) hold paths inside the site.
// Each item keeps that as `path` (used to remember deleted items) and gets full addresses.
(() => {
  if (typeof WALL_ITEMS !== "undefined") {
    WALL_ITEMS.forEach((i) => {
      i.path = i.src;
      i.thumb = mediaUrl(i.thumb);
      i.src = mediaUrl(i.src);
    });
  }
  if (typeof SPIRAL_IMAGES !== "undefined") {
    SPIRAL_IMAGES.forEach((p) => {
      p.path = p.src;
      p.src = mediaUrl(p.src);
    });
  }
  if (typeof BACKGROUND_IMAGES !== "undefined") {
    BACKGROUND_IMAGES.forEach((src, n) => { BACKGROUND_IMAGES[n] = mediaUrl(src); });
  }
  // pictures and videos written straight into a page: <img data-media="images/x.jpg">
  const fill = () => document.querySelectorAll("[data-media]").forEach((el) => {
    if (!el.getAttribute("src")) el.src = mediaUrl(el.dataset.media);
  });
  fill();
  document.addEventListener("DOMContentLoaded", fill);
})();
