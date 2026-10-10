// GHUMI GHUMI video storage helper (runs as a Neon Function in the "ghumi-ghumi-videos" project).
// The site's built-in videos live in this project's "videos" bucket and are read straight from
// it by the website. This function is only used while uploading them: with the upload secret it
// hands out short-lived upload links. Without UPLOAD_SECRET set, uploading is switched off.
import crypto from "node:crypto";

const BUCKET = "videos";
const env = process.env;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- storage (S3-compatible, Signature Version 4) ----------
const endpoint = () => (env.AWS_ENDPOINT_URL_S3 || "").replace(/\/+$/, "");
const region = () => env.AWS_REGION || "us-east-1";
const amzDate = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
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

async function s3(method, key, params = {}, body = "", extraHeaders = {}) {
  const host = new URL(endpoint()).host;
  const stamp = amzDate();
  const payloadHash = sha256(body);
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp, ...extraHeaders };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const names = Object.keys(lower).sort();
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

function presignedPut(key, seconds = 3600) {
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

// lets the website's Download button fetch a video from another web address
async function setCors() {
  const xml =
    "<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin>" +
    "<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>" +
    "<AllowedHeader>*</AllowedHeader><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule></CORSConfiguration>";
  const md5 = crypto.createHash("md5").update(xml).digest("base64");
  const res = await s3("PUT", "", { cors: "" }, xml, { "content-md5": md5, "content-type": "application/xml" });
  return res.ok ? "ok" : "failed " + res.status + " " + (await res.text()).slice(0, 200);
}

async function listKeys() {
  const keys = {};
  let token;
  do {
    const params = { "list-type": "2" };
    if (token) params["continuation-token"] = token;
    const res = await s3("GET", "", params);
    const xml = await res.text();
    if (!res.ok) throw new Error("list failed " + res.status + " " + xml.slice(0, 200));
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>.*?<Size>(\d+)<\/Size>/gs)) keys[m[1]] = Number(m[2]);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = next ? next[1] : undefined;
  } while (token);
  return keys;
}

const KEY = /^wall\/video\/[A-Za-z0-9._-]{1,80}\.mp4$/;

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/") {
        return json({ ok: true, storage: !!env.AWS_ENDPOINT_URL_S3, uploads: env.UPLOAD_SECRET ? "on" : "off", base: endpoint() + "/" + BUCKET + "/" });
      }
      const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!env.UPLOAD_SECRET || !given || !safeEqual(given, env.UPLOAD_SECRET)) return json({ error: "Not found." }, 404);

      if (request.method === "POST" && url.pathname === "/upload-url") {
        const body = await request.json().catch(() => ({}));
        const key = String(body.key || "");
        if (!KEY.test(key)) return json({ error: "bad key" }, 400);
        return json({ url: presignedPut(key) });
      }
      if (request.method === "POST" && url.pathname === "/cors") return json({ cors: await setCors() });
      if (request.method === "GET" && url.pathname === "/list") return json({ keys: await listKeys() });
      return json({ error: "Not found." }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  }
};
