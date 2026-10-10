// Thoughts and poems. They are stored online, so everyone who is logged in sees the same ones.
const WordsStore = (() => {
  const OLD_KEY = "ghumi-words"; // where they used to be kept: only in the browser that wrote them

  async function call(path, method, body) {
    const res = await fetch(Auth.API + path, {
      method,
      headers: Object.assign({ authorization: "Bearer " + Auth.token() }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      Auth.forget();
      Auth.goLogin();
      return new Promise(() => {}); // the page is leaving
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }

  // oldest first
  async function list() {
    await moveOld();
    return (await call("/words", "GET")).words;
  }
  const add = async (word) => (await call("/words", "POST", word)).word;
  const remove = (id) => call("/words/" + encodeURIComponent(id), "DELETE");

  // thoughts and poems written before they were shared are sent online once, then forgotten here
  async function moveOld() {
    let old;
    try {
      old = JSON.parse(localStorage.getItem(OLD_KEY));
    } catch (e) {
      return;
    }
    if (!Array.isArray(old)) return;
    while (old.length) {
      const w = old[0];
      if (w && typeof w.text === "string" && w.text.trim()) await add({ kind: w.kind, text: w.text, by: w.by });
      old.shift();
      try {
        if (old.length) localStorage.setItem(OLD_KEY, JSON.stringify(old));
        else localStorage.removeItem(OLD_KEY);
      } catch (e) { /* storage unavailable */ }
    }
  }

  return { list, add, remove };
})();
