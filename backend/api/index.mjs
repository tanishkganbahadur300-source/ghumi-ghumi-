// GHUMI GHUMI posts API (runs as a Neon Function).
// Shared photos and videos live in the "posts" storage bucket; this function hands out
// upload links to people who know the group passcode and lists what has been posted.
// No dependencies: request signing for the S3-compatible storage is done by hand.
import crypto from "node:crypto";

const BUCKET = "posts";
const TOKEN_DAYS = 36500; // logins do not run out; a person stays logged in until they log out
const env = process.env;

// ---------- small helpers ----------
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-max-age": "86400"
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- login tokens ----------
// A token is  <expiry>.<name>.<signature>  and proves that this person logged in.
function makeToken(name) {
  const body = String(Date.now() + TOKEN_DAYS * 86400000) + "." + Buffer.from(name).toString("base64url");
  return body + "." + hmac(env.TOKEN_SECRET, body).toString("hex");
}
function tokenOk(request) {
  const header = request.headers.get("authorization") || "";
  const [exp, name, sig] = header.replace(/^Bearer\s+/i, "").split(".");
  if (!exp || !name || !sig || !env.TOKEN_SECRET) return false;
  // a correctly signed token is accepted whatever its date: logins last until the person logs out
  return safeEqual(sig, hmac(env.TOKEN_SECRET, exp + "." + name).toString("hex"));
}

// a few wrong guesses per minute per address, then wait
const attempts = new Map();
function tooManyAttempts(request) {
  const who = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (attempts.get(who) || []).filter((t) => now - t < 60000);
  recent.push(now);
  attempts.set(who, recent);
  if (attempts.size > 5000) attempts.clear();
  return recent.length > 8;
}

// ---------- storage (S3-compatible, Signature Version 4) ----------
const endpoint = () => (env.AWS_ENDPOINT_URL_S3 || "").replace(/\/+$/, "");
const region = () => env.AWS_REGION || "us-east-1";
const amzDate = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260101T000000Z
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const pathFor = (key) => "/" + BUCKET + (key ? "/" + key.split("/").map(rfc3986).join("/") : "");
const canonicalQuery = (params) =>
  Object.keys(params).sort().map((k) => rfc3986(k) + "=" + rfc3986(params[k])).join("&");

function signature(stamp, canonicalRequest) {
  const day = stamp.slice(0, 8);
  const scope = day + "/" + region() + "/s3/aws4_request";
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonicalRequest)].join("\n");
  let key = hmac("AWS4" + env.AWS_SECRET_ACCESS_KEY, day);
  key = hmac(key, region());
  key = hmac(key, "s3");
  key = hmac(key, "aws4_request");
  return { scope, value: hmac(key, toSign).toString("hex") };
}

// a request this function makes itself (list, delete, CORS setup)
async function s3(method, key, params = {}, body = "", extraHeaders = {}) {
  const host = new URL(endpoint()).host;
  const stamp = amzDate();
  const payloadHash = sha256(body);
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp, ...extraHeaders };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonical = [
    method, pathFor(key), canonicalQuery(params),
    names.map((h) => h + ":" + String(lower[h]).trim() + "\n").join(""),
    names.join(";"), payloadHash
  ].join("\n");
  const sig = signature(stamp, canonical);
  const auth = "AWS4-HMAC-SHA256 Credential=" + env.AWS_ACCESS_KEY_ID + "/" + sig.scope +
    ", SignedHeaders=" + names.join(";") + ", Signature=" + sig.value;
  const query = canonicalQuery(params);
  const { host: _h, ...sendHeaders } = lower;
  return fetch(endpoint() + pathFor(key) + (query ? "?" + query : ""), {
    method, headers: { ...sendHeaders, authorization: auth }, body: body || undefined
  });
}

// a link the browser can upload one file to, valid for a short time
function presignedPut(key, seconds = 900) {
  const host = new URL(endpoint()).host;
  const stamp = amzDate();
  const scope = stamp.slice(0, 8) + "/" + region() + "/s3/aws4_request";
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": env.AWS_ACCESS_KEY_ID + "/" + scope,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host"
  };
  const canonical = ["PUT", pathFor(key), canonicalQuery(params), "host:" + host + "\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
  params["X-Amz-Signature"] = signature(stamp, canonical).value;
  return endpoint() + pathFor(key) + "?" + canonicalQuery(params);
}

const publicUrl = (key) => endpoint() + pathFor(key);

// browsers may only upload straight to the bucket once it allows other sites to do so
let corsState = "not tried";
async function ensureCors() {
  if (corsState === "ok") return;
  const xml =
    "<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin>" +
    "<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>" +
    "<AllowedHeader>*</AllowedHeader><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule></CORSConfiguration>";
  try {
    const md5 = crypto.createHash("md5").update(xml).digest("base64");
    const res = await s3("PUT", "", { cors: "" }, xml, { "content-md5": md5, "content-type": "application/xml" });
    corsState = res.ok ? "ok" : "failed " + res.status + " " + (await res.text()).slice(0, 200);
  } catch (e) {
    corsState = "failed " + e.message;
  }
}

async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const params = { "list-type": "2", prefix };
    if (token) params["continuation-token"] = token;
    const res = await s3("GET", "", params);
    const xml = await res.text();
    if (!res.ok) throw new Error("list failed " + res.status + " " + xml.slice(0, 200));
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = next ? next[1] : undefined;
  } while (token);
  return keys;
}

// media/<album>/<time>-<random>-<p|v>.<ext>  and  thumbs/<time>-<random>.jpg
// The album says which part of the site a post belongs to (posts, wall, birthday-shreya, trip-trek ...).
const ALBUM = /^[a-z0-9-]{1,48}$/;
const KEY = /^media\/([a-z0-9-]{1,48})\/((\d{13})-[a-f0-9]{12})-([pv])\.([a-z0-9]{2,5})$/;
const EXTENSIONS = { p: ["jpg", "jpeg", "png", "webp"], v: ["webm", "mp4", "mov", "m4v"] };

// ---------- photos that came with the site and were deleted from a page ----------
// Those files are part of the website itself, so they cannot be removed from here.
// Their paths are kept in one small list instead, and every page leaves them out.
const HIDDEN_KEY = "meta/hidden.json";
const HIDE_PATH = /^(wall\/(full|video)|images)\/[A-Za-z0-9._-]{1,80}$/;

async function readHidden() {
  const res = await s3("GET", HIDDEN_KEY);
  if (res.status === 404) return [];
  const text = await res.text();
  if (!res.ok) throw new Error("hidden list failed " + res.status + " " + text.slice(0, 200));
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch (e) {
    return [];
  }
}
async function writeHidden(list) {
  const res = await s3("PUT", HIDDEN_KEY, {}, JSON.stringify(list), { "content-type": "application/json" });
  if (!res.ok) throw new Error("hidden save failed " + res.status + " " + (await res.text()).slice(0, 200));
}

// ---------- who may log in ----------
// Everyone shares one password; the list of names is kept in the bucket so more can be added.
const USERS_KEY = "meta/users.json";
const FIRST_USERS = ["Aditya", "Tanishk", "Sunakshi", "Gauri", "Saloni", "Pradyumna", "Shreya", "Parnavi", "Nishant", "Aarya", "Yashwant"];
const cleanName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 30);

async function readUsers() {
  const res = await s3("GET", USERS_KEY);
  if (res.status === 404) return FIRST_USERS.slice();
  const text = await res.text();
  if (!res.ok) throw new Error("user list failed " + res.status + " " + text.slice(0, 200));
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) && list.length ? list.filter((x) => typeof x === "string") : FIRST_USERS.slice();
  } catch (e) {
    return FIRST_USERS.slice();
  }
}
async function writeUsers(list) {
  const res = await s3("PUT", USERS_KEY, {}, JSON.stringify(list), { "content-type": "application/json" });
  if (!res.ok) throw new Error("user save failed " + res.status + " " + (await res.text()).slice(0, 200));
}

// ---------- thoughts and poems ----------
// Kept together in one small list in the bucket, so everyone sees the same ones.
const WORDS_KEY = "meta/words.json";
const MAX_WORDS = 1000;

async function readWords() {
  const res = await s3("GET", WORDS_KEY);
  if (res.status === 404) return [];
  const text = await res.text();
  if (!res.ok) throw new Error("words list failed " + res.status + " " + text.slice(0, 200));
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.filter((w) => w && typeof w.id === "string" && typeof w.text === "string") : [];
  } catch (e) {
    return [];
  }
}
async function writeWords(list) {
  const res = await s3("PUT", WORDS_KEY, {}, JSON.stringify(list), { "content-type": "application/json" });
  if (!res.ok) throw new Error("words save failed " + res.status + " " + (await res.text()).slice(0, 200));
}

// ---------- names added to the Birthdays, Trips and Outings lists ----------
// Kept in the bucket so everyone sees the same folders. Removing a name leaves its photos alone.
const FOLDERS_KEY = "meta/folders.json";
const FOLDER_KINDS = ["birthday", "trip", "outing"];
const MAX_FOLDERS = 300;

async function readFolders() {
  const folders = { birthday: [], trip: [], outing: [] };
  const res = await s3("GET", FOLDERS_KEY);
  if (res.status === 404) return folders;
  const text = await res.text();
  if (!res.ok) throw new Error("folder list failed " + res.status + " " + text.slice(0, 200));
  try {
    const saved = JSON.parse(text);
    for (const kind of FOLDER_KINDS) {
      if (Array.isArray(saved[kind])) folders[kind] = saved[kind].filter((x) => typeof x === "string");
    }
  } catch (e) { /* unreadable: start again from empty lists */ }
  return folders;
}
async function writeFolders(folders) {
  const res = await s3("PUT", FOLDERS_KEY, {}, JSON.stringify(folders), { "content-type": "application/json" });
  if (!res.ok) throw new Error("folder save failed " + res.status + " " + (await res.text()).slice(0, 200));
}

// ---------- routes ----------
export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

      if (request.method === "GET" && path === "/") {
        return json({ ok: true, storage: !!env.AWS_ENDPOINT_URL_S3, passcodeSet: !!env.PASSCODE_SHA256, cors: corsState });
      }

      if (request.method === "POST" && path === "/login") {
        if (tooManyAttempts(request)) return json({ error: "Too many tries. Wait a minute and try again." }, 429);
        const body = await request.json().catch(() => ({}));
        const given = sha256(String(body.passcode || "").trim());
        const wanted = cleanName(body.name).toLowerCase();
        const user = wanted ? (await readUsers()).find((u) => u.toLowerCase() === wanted) : "";
        // one answer for a wrong name or a wrong password, so neither can be guessed separately
        if (!user || !env.PASSCODE_SHA256 || !safeEqual(given, env.PASSCODE_SHA256)) {
          return json({ error: "That name and password do not match." }, 401);
        }
        return json({ token: makeToken(user), name: user });
      }

      if (path === "/users" && (request.method === "GET" || request.method === "POST")) {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        const users = await readUsers();
        if (request.method === "GET") return json({ users });
        const body = await request.json().catch(() => ({}));
        const name = cleanName(body.name);
        if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,29}$/u.test(name)) return json({ error: "Use a name made of letters." }, 400);
        if (users.some((u) => u.toLowerCase() === name.toLowerCase())) return json({ error: name + " can already log in." }, 409);
        users.push(name);
        await writeUsers(users);
        return json({ ok: true, users });
      }

      if (request.method === "GET" && path === "/posts") {
        const keys = await listKeys("media/");
        const posts = keys.map((k) => k.match(KEY)).filter(Boolean).map((m) => ({
          id: m[2],
          album: m[1],
          t: m[4],
          added: Number(m[3]),
          src: publicUrl(m[0]),
          thumb: publicUrl("thumbs/" + m[2] + ".jpg")
        })).sort((a, b) => b.added - a.added);
        return json({ posts, hidden: await readHidden() });
      }

      if (request.method === "POST" && path === "/uploads") {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        const body = await request.json().catch(() => ({}));
        const t = body.t === "v" ? "v" : "p";
        const ext = String(body.ext || "").toLowerCase();
        if (!EXTENSIONS[t].includes(ext)) return json({ error: "That kind of file cannot be posted." }, 400);
        const album = String(body.album || "posts");
        if (!ALBUM.test(album)) return json({ error: "That section name cannot be used." }, 400);
        await ensureCors();
        const id = Date.now() + "-" + crypto.randomBytes(6).toString("hex");
        return json({
          id,
          mediaUrl: presignedPut("media/" + album + "/" + id + "-" + t + "." + ext),
          thumbUrl: presignedPut("thumbs/" + id + ".jpg")
        });
      }

      if (request.method === "POST" && (path === "/hidden" || path === "/hidden/restore")) {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        const body = await request.json().catch(() => ({}));
        const target = String(body.path || "");
        if (!HIDE_PATH.test(target)) return json({ error: "That item cannot be deleted from here." }, 400);
        const list = (await readHidden()).filter((x) => x !== target);
        if (path === "/hidden") list.push(target);
        await writeHidden(list);
        return json({ ok: true, hidden: list.length });
      }

      if (path === "/words" && (request.method === "GET" || request.method === "POST")) {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        const words = await readWords();
        if (request.method === "GET") return json({ words });
        const body = await request.json().catch(() => ({}));
        const kind = body.kind === "poem" ? "poem" : "thought";
        const text = String(body.text || "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
        if (!text) return json({ error: "Write something first." }, 400);
        if (words.length >= MAX_WORDS) return json({ error: "The list is full. Delete an old one first." }, 400);
        const word = { id: Date.now() + "-" + crypto.randomBytes(6).toString("hex"), kind, text, by: cleanName(body.by), added: Date.now() };
        words.push(word);
        await writeWords(words);
        return json({ ok: true, word });
      }

      if (path === "/folders" && request.method === "GET") {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        return json({ folders: await readFolders() });
      }
      if (request.method === "POST" && (path === "/folders" || path === "/folders/remove")) {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        const body = await request.json().catch(() => ({}));
        const kind = String(body.kind || "");
        const name = cleanName(body.name);
        if (!FOLDER_KINDS.includes(kind) || !name) return json({ error: "Type a name first." }, 400);
        const folders = await readFolders();
        const same = (x) => x.toLowerCase() === name.toLowerCase();
        if (path === "/folders/remove") {
          folders[kind] = folders[kind].filter((x) => !same(x));
        } else if (!folders[kind].some(same)) {
          if (folders[kind].length >= MAX_FOLDERS) return json({ error: "The list is full. Delete an old one first." }, 400);
          folders[kind].push(name);
        }
        await writeFolders(folders);
        return json({ ok: true, folders });
      }

      const delWord = path.match(/^\/words\/(\d{13}-[a-f0-9]{12})$/);
      if (request.method === "DELETE" && delWord) {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        const words = await readWords();
        const kept = words.filter((w) => w.id !== delWord[1]);
        if (kept.length !== words.length) await writeWords(kept);
        return json({ ok: true, removed: words.length - kept.length });
      }

      const del = path.match(/^\/posts\/(\d{13}-[a-f0-9]{12})$/);
      if (request.method === "DELETE" && del) {
        if (!tokenOk(request)) return json({ error: "Please log in." }, 401);
        const keys = (await listKeys("media/")).filter((k) => { const m = k.match(KEY); return m && m[2] === del[1]; });
        for (const key of keys.concat("thumbs/" + del[1] + ".jpg")) await s3("DELETE", key);
        return json({ ok: true, removed: keys.length });
      }

      return json({ error: "Not found." }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  }
};
