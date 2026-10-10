// Extra buttons for the full-size viewer on every page:
//  - Download (top right): saves the photo or video that is open to this device
//  - Delete: removes the open photo or video for everyone (needs the group passcode).
//    Pages that should not offer it put data-no-delete on the viewer.
(() => {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;
  const media = lightbox.querySelector(".lightbox-media");

  function button(className, label, path) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lightbox-btn " + className;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
    lightbox.appendChild(b);
    return b;
  }

  const current = () => {
    const el = media.querySelector("img, video");
    return el ? (el.currentSrc || el.src) : "";
  };
  // uploaded files live at .../media/<album>/<id>-<p|v>.<ext>
  const postId = (url) => {
    const m = url.match(/\/media\/[a-z0-9-]+\/(\d{13}-[a-f0-9]{12})-[pv]\.[a-z0-9]+(?:$|\?)/);
    return m ? m[1] : "";
  };

  // photos that came with the site: their path inside the site, e.g. wall/full/dance-0001.jpg
  const sitePath = (url) => {
    try {
      // media kept in cloud storage: the part after the storage address is the path
      if (typeof MEDIA_BASE !== "undefined" && MEDIA_BASE && url.startsWith(MEDIA_BASE)) {
        const kept = decodeURIComponent(url.slice(MEDIA_BASE.length).split("?")[0]);
        return /^(wall\/(full|video)|images)\/[A-Za-z0-9._-]{1,80}$/.test(kept) ? kept : "";
      }
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) return "";
      const base = new URL(".", location.href).pathname;
      const p = decodeURIComponent(u.pathname);
      const rel = p.startsWith(base) ? p.slice(base.length) : p.replace(/^\/+/, "");
      return /^(wall\/(full|video)|images)\/[A-Za-z0-9._-]{1,80}$/.test(rel) ? rel : "";
    } catch (e) {
      return "";
    }
  };

  // ---------- download ----------
  const downloadBtn = button("lightbox-download", "Download", '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>');
  downloadBtn.addEventListener("click", async () => {
    const url = current();
    if (!url) return;
    const name = "ghumi-ghumi-" + decodeURIComponent(url.split("?")[0].split("/").pop() || "photo");
    const link = document.createElement("a");
    link.download = name;
    downloadBtn.disabled = true;
    try {
      // fetching the file first makes the browser save it instead of opening it in a tab
      const blob = await (await fetch(url)).blob();
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
    } catch (e) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      downloadBtn.disabled = false;
    }
  });

  // ---------- delete ----------
  let deleteBtn = null;
  if (typeof MediaStore !== "undefined" && !document.getElementById("post-delete") && !("noDelete" in lightbox.dataset)) {
    deleteBtn = button("lightbox-trash", "Delete", '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>');
    deleteBtn.hidden = true;
    // the question is asked inside the page (browser pop-ups can be blocked or switched off)
    const ask = document.createElement("div");
    ask.className = "lightbox-confirm";
    ask.hidden = true;
    ask.innerHTML =
      '<p class="lightbox-confirm-text" role="alert"></p>' +
      '<div class="passcode-actions">' +
      '<button type="button" class="cam-btn" data-act="cancel">Cancel</button>' +
      '<button type="button" class="cam-btn cam-post" data-act="delete">Delete</button>' +
      "</div>";
    lightbox.appendChild(ask);
    const askText = ask.querySelector(".lightbox-confirm-text");
    const confirmBtn = ask.querySelector('[data-act="delete"]');
    const QUESTION = "Delete this for everyone?";

    deleteBtn.addEventListener("click", () => {
      if (!postId(current()) && !sitePath(current())) return;
      askText.textContent = QUESTION;
      confirmBtn.textContent = "Delete";
      ask.hidden = false;
      confirmBtn.focus();
    });
    ask.querySelector('[data-act="cancel"]').addEventListener("click", () => { ask.hidden = true; });
    confirmBtn.addEventListener("click", async () => {
      const id = postId(current());
      const path = sitePath(current());
      if (!id && !path) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Deleting…";
      try {
        if (id) await MediaStore.remove(id);
        else await MediaStore.hide(path);
        location.reload();
      } catch (e) {
        askText.textContent = e.message + " Not deleted.";
        confirmBtn.textContent = "Try again";
        confirmBtn.disabled = false;
      }
    });
    // show the bin while something that can be deleted is open
    new MutationObserver(() => {
      deleteBtn.hidden = !(postId(current()) || sitePath(current()));
      ask.hidden = true; // moved to another photo, or closed
    }).observe(media, { childList: true });
  }
})();
