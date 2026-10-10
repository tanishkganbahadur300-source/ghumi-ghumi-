// Login for the whole site. Loaded first on every page.
// Everyone uses their own name with the one shared group password. After logging in,
// the device is remembered until they log out, and the same login is used for posting and deleting.
// Pages that anyone may open (the landing and login pages) put data-public on <html>.
const Auth = (() => {
  const API = "https://br-empty-leaf-b3ue6iww-api.compute.c-4.ap-southeast-1.aws.neon.tech";
  const TOKEN_KEY = "ghumi-post-token";
  const NAME_KEY = "ghumi-user";
  const NEXT_KEY = "ghumi-next";

  const read = (store, key) => { try { return store.getItem(key) || ""; } catch (e) { return ""; } };
  const write = (store, key, value) => {
    try {
      if (value) store.setItem(key, value);
      else store.removeItem(key);
    } catch (e) { /* storage unavailable */ }
  };

  // the saved login, or "" when there is none (it stays until Log out is pressed)
  function token() {
    const saved = read(localStorage, TOKEN_KEY);
    return saved.split(".").length === 3 ? saved : "";
  }
  const name = () => (token() ? read(localStorage, NAME_KEY) : "");

  async function login(userName, password) {
    const res = await fetch(API + "/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: userName, passcode: password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error || "Could not log in. Try again.");
    write(localStorage, TOKEN_KEY, data.token);
    write(localStorage, NAME_KEY, data.name);
    return data.name;
  }

  function forget() {
    write(localStorage, TOKEN_KEY, "");
    write(localStorage, NAME_KEY, "");
  }
  function logout() {
    forget();
    location.href = "index.html";
  }

  // send the visitor to the login page, remembering where they were going
  function goLogin() {
    write(sessionStorage, NEXT_KEY, location.pathname.split("/").pop() + location.hash);
    location.replace("login.html");
  }
  // after logging in: back to that page, or the home page
  function goNext() {
    const next = read(sessionStorage, NEXT_KEY);
    write(sessionStorage, NEXT_KEY, "");
    location.replace(/^[a-z]+\.html(#.*)?$/i.test(next) && !/^(login|index)\.html/i.test(next) ? next : "home.html");
  }

  return { API, token, name, login, logout, forget, goLogin, goNext };
})();

if (!document.documentElement.hasAttribute("data-public") && !Auth.token()) Auth.goLogin();
