// The lists on the Birthdays, Trips and Outings pages.
// Names added on those pages are stored online, so everyone sees the same folders
// (and so the photos uploaded into them).
//   kind      "birthday" | "trip" | "outing"
//   fixed     names that are always in the list
//   link      start of the address each name opens, e.g. "person.html#trip:"
//   oldKey    where added names used to be kept: only in the browser that added them
function createFolderList({ kind, fixed, link, oldKey }) {
  const list = document.getElementById("members");
  const note = document.getElementById("add-note");
  const empty = document.getElementById("list-empty");
  const form = document.getElementById("add-form");
  const input = document.getElementById("member-name");
  let added = [];

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
  const problem = (err, what) => (err instanceof TypeError ? "No connection. " + what : err.message);
  const has = (name) => fixed.concat(added).some((n) => n.toLowerCase() === name.toLowerCase());

  function render() {
    list.textContent = "";
    if (empty) empty.hidden = fixed.length + added.length > 0;
    fixed.concat(added).forEach((name, index) => {
      const li = document.createElement("li");
      li.className = "member";

      // each name opens its own photo wall
      const a = document.createElement("a");
      a.className = "member-name";
      a.href = link + encodeURIComponent(name);
      a.textContent = name;
      li.appendChild(a);

      if (index >= fixed.length) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "member-remove";
        remove.setAttribute("aria-label", "Remove " + name);
        remove.textContent = "×";
        // the cross only asks; the item goes when "Delete" is pressed
        const ask = document.createElement("span");
        ask.className = "member-confirm";
        ask.hidden = true;
        const question = document.createElement("span");
        question.textContent = "Delete?";
        const yes = document.createElement("button");
        yes.type = "button";
        yes.className = "member-yes";
        yes.textContent = "Delete";
        const no = document.createElement("button");
        no.type = "button";
        no.className = "member-no";
        no.textContent = "Keep";
        ask.append(question, yes, no);

        remove.addEventListener("click", () => {
          remove.hidden = true;
          ask.hidden = false;
          no.focus();
        });
        no.addEventListener("click", () => {
          ask.hidden = true;
          remove.hidden = false;
          remove.focus();
        });
        yes.addEventListener("click", async () => {
          yes.disabled = true;
          try {
            added = (await call("/folders/remove", "POST", { kind, name })).folders[kind];
            note.textContent = "";
            render();
          } catch (err) {
            yes.disabled = false;
            note.textContent = problem(err, "Not deleted.");
          }
        });
        li.append(remove, ask);
      }
      list.appendChild(li);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (has(name)) {
      note.textContent = name + " is already in the list.";
      return;
    }
    const button = form.querySelector(".add-btn");
    button.disabled = true;
    note.textContent = "Adding…";
    try {
      added = (await call("/folders", "POST", { kind, name })).folders[kind];
      render();
      input.value = "";
      note.textContent = name + " added. Everyone can see it now.";
    } catch (err) {
      note.textContent = problem(err, "Not added, try again.");
    } finally {
      button.disabled = false;
    }
  });

  // names added before the lists were shared are sent online once, then forgotten here
  async function moveOld() {
    let old;
    try {
      old = JSON.parse(localStorage.getItem(oldKey));
    } catch (e) {
      return;
    }
    if (!Array.isArray(old)) return;
    for (const name of old) {
      if (typeof name === "string" && name.trim() && !has(name.trim())) {
        added = (await call("/folders", "POST", { kind, name })).folders[kind];
      }
    }
    try {
      localStorage.removeItem(oldKey);
    } catch (e) { /* storage unavailable */ }
  }

  async function refresh() {
    try {
      added = (await call("/folders", "GET")).folders[kind];
      await moveOld();
      render();
    } catch (err) {
      if (!added.length) note.textContent = problem(err, "Could not load the names others added.");
    }
  }

  render();
  refresh();
  // show what others added when coming back to this page
  window.addEventListener("pageshow", (e) => { if (e.persisted) refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
