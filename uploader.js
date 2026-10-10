// "Add photos" buttons: choose photos or videos from the device and post them online
// into one section of the site (an album). Needs media-store.js.
const Uploader = (() => {
  const MAX_PHOTO_SIDE = 1920;               // big photos are scaled down before upload
  const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // videos above 200 MB are refused

  // turn any name into a short album key, e.g. ("birthday", "Shreya") -> "birthday-shreya"
  function albumKey(kind, name) {
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
    return kind + "-" + (slug || "x");
  }

  async function preparePhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    const thumb = await MediaStore.makeThumb(canvas, w, h);
    return { t: "p", blob, thumb };
  }

  async function prepareVideo(file) {
    if (file.size > MAX_VIDEO_BYTES) throw new Error("is larger than 200 MB");
    const probe = document.createElement("video");
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = "auto";
    const url = URL.createObjectURL(file);
    try {
      probe.src = url;
      await new Promise((resolve, reject) => { probe.onloadeddata = resolve; probe.onerror = () => reject(new Error("cannot be read")); });
      probe.currentTime = Math.min(0.5, (probe.duration || 1) / 2);
      await new Promise((resolve) => { probe.onseeked = resolve; setTimeout(resolve, 3000); });
      const thumb = await MediaStore.makeThumb(probe, probe.videoWidth, probe.videoHeight);
      return { t: "v", blob: file, thumb };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // button: the element to click; album: where the uploads belong; onDone: called when at least one was posted
  function attach(button, album, onDone) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.multiple = true;
    input.hidden = true;
    document.body.appendChild(input);

    const label = button.textContent;
    const status = document.createElement("p");
    status.className = "upload-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    document.body.appendChild(status);

    function say(text, keep) {
      status.textContent = text;
      status.hidden = !text;
      clearTimeout(say.timer);
      if (text && !keep) say.timer = setTimeout(() => { status.hidden = true; }, 6000);
    }

    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = Array.from(input.files);
      input.value = "";
      if (!files.length) return;
      button.disabled = true;
      let posted = 0;
      const problems = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        button.textContent = "Uploading " + (i + 1) + " of " + files.length + "…";
        say("Uploading " + file.name + ". Keep this page open.", true);
        try {
          let post;
          if (file.type.startsWith("image/")) post = await preparePhoto(file);
          else if (file.type.startsWith("video/")) post = await prepareVideo(file);
          else throw new Error("is not a photo or video");
          post.album = album;
          await MediaStore.add(post);
          posted++;
        } catch (e) {
          if (/passcode/i.test(e.message)) {
            problems.push(e.message);
            break; // they cancelled the passcode box: stop here
          }
          problems.push(file.name + " " + e.message.replace(/^That kind of file.*$/, "is a kind of file that cannot be posted"));
        }
      }
      button.disabled = false;
      button.textContent = label;
      say((posted ? posted + (posted === 1 ? " file" : " files") + " added. " : "") + (problems.length ? "Not added: " + problems.join("; ") + "." : ""));
      if (posted && onDone) onDone(posted);
    });
  }

  return { attach, albumKey };
})();
