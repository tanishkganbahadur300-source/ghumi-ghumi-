// Photos and videos posted from the camera page.
// They are stored online (Neon object storage), so everyone who opens the site sees
// the same posts. Posting and deleting are done as the person who is logged in.
const MediaStore = (() => {
  const API = Auth.API;
  const ALBUM = { key: "posts", name: "Vlogs & Photos" };
  const UPLOADS = { key: "uploads", name: "Uploads" };
  const EXTENSIONS = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v"
  };

  // ---------- login ----------
  // Posting and deleting use the login from auth.js. If it has run out, the person is
  // sent to the login page and comes back here afterwards.
  function needLogin() {
    Auth.forget();
    Auth.goLogin();
    return new Promise(() => {}); // the page is leaving
  }

  // calls the API as the logged-in person
  async function authed(path, options) {
    const token = Auth.token() || await needLogin();
    const res = await fetch(API + path, Object.assign({}, options, {
      headers: Object.assign({ authorization: "Bearer " + token }, options.headers)
    }));
    if (res.status === 401) await needLogin();
    return res;
  }

  // ---------- posts ----------
  // post = { t: "p" | "v", blob, thumb, album }  (album = which part of the site it belongs to)
  async function add(post) {
    const type = (post.blob.type || "").split(";")[0].toLowerCase();
    const ext = EXTENSIONS[type];
    if (!ext) throw new Error("That kind of file cannot be posted. Use a JPG, PNG or WebP photo, or a WebM or MP4 video.");

    const res = await authed("/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: post.t, ext, album: post.album || ALBUM.key })
    });
    const links = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(links.error || "Could not start the upload.");

    const put = (url, blob, contentType) => fetch(url, { method: "PUT", headers: { "content-type": contentType }, body: blob });
    // the small picture goes first, so a post never shows up without its tile
    const thumb = await put(links.thumbUrl, post.thumb, "image/jpeg");
    const media = thumb.ok ? await put(links.mediaUrl, post.blob, type) : thumb;
    if (!media.ok) throw new Error("The upload did not finish. Check the internet and try again.");
    return links.id;
  }

  async function remove(id) {
    const res = await authed("/posts/" + encodeURIComponent(id), { method: "DELETE", headers: {} });
    if (!res.ok) throw new Error("Could not delete it. Try again.");
  }

  // newest first, in the same shape as the photo wall items
  // everything the pages need from online in one request:
  //   posts  = uploaded photos and videos
  //   hidden = paths of built-in photos and videos that someone deleted from a page
  async function state() {
    const res = await fetch(API + "/posts");
    if (!res.ok) throw new Error("Could not load the posts.");
    const data = await res.json();
    // "a" is the tab it sits under on the photo wall: camera posts, or everything else that was uploaded
    const posts = data.posts.map((p) => ({
      id: p.id, t: p.t, album: p.album, a: p.album === ALBUM.key ? ALBUM.key : UPLOADS.key,
      added: p.added, thumb: p.thumb, src: p.src
    }));
    return { posts, hidden: new Set(data.hidden || []) };
  }

  async function list() {
    return (await state()).posts;
  }

  // The photos that came with the site are files of the website itself, so a page cannot
  // erase them. Deleting one adds its path to a shared list, and every page leaves it out.
  async function hide(path) {
    const res = await authed("/hidden", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Could not delete it. Try again.");
    }
  }

  // small square picture used for the tiles
  function makeThumb(source, width, height) {
    const size = 360;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const side = Math.min(width, height);
    canvas.getContext("2d").drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  }

  return { add, remove, list, state, hide, makeThumb, ALBUM, UPLOADS };
})();
