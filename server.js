/**
 * EduGlobal University Portal — backend server
 * Pure Node.js (no dependencies to install). Serves the frontend from /public
 * and a small REST API backed by JSON files in /data.
 *
 * Run:   node server.js
 * Open:  http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123"; // change before real deployment
const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, in seconds

// ---------- tiny JSON "database" helpers ----------

function readJSON(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8") || "[]");
  } catch (e) {
    console.error(`Failed to parse ${file}:`, e.message);
    return [];
  }
}

function writeJSON(file, data) {
  const p = path.join(DATA_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// simple in-memory rate limiter (per IP, per route) to stop form spam
const rateBucket = new Map();
function isRateLimited(ip, route, limit = 5, windowMs = 60_000) {
  const key = `${ip}:${route}`;
  const now = Date.now();
  const hits = (rateBucket.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  rateBucket.set(key, hits);
  return hits.length > limit;
}

// ---------- response helpers ----------

function sendJSON(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    ...extraHeaders,
  });
  res.end(body);
}

function collectBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkAdmin(req, url) {
  const headerKey = req.headers["x-admin-key"];
  const queryKey = url.searchParams.get("key");
  return headerKey === ADMIN_KEY || queryKey === ADMIN_KEY;
}

// ---------- auth: passwords, cookies, sessions ----------

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  // constant-time compare
  const a = Buffer.from(check, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookieHeader(name, value, maxAgeSeconds) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAgeSeconds != null) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (IS_PROD) parts.push("Secure");
  return parts.join("; ");
}

// in-memory session store: token -> { userId, expires }
// (Restarting the server logs everyone out — fine for a demo; swap for a
// real session store, e.g. Redis, before production.)
const sessions = new Map();

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, expires: Date.now() + SESSION_MAX_AGE * 1000 });
  return token;
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.sid;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const users = readJSON("users.json");
  const user = users.find((u) => u.id === session.userId);
  return user || null;
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt };
}

// ---------- static file serving ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === "/" ? "/index.html" : urlPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      // SPA-style fallback to index.html for unknown non-file routes
      if (!path.extname(fullPath)) {
        return fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, idx) => {
          if (e2) {
            res.writeHead(404);
            return res.end("Not found");
          }
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(idx);
        });
      }
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

// ---------- API routes ----------

async function handleAPI(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const ip = req.socket.remoteAddress || "unknown";

  // ---- Auth: register ----
  if (pathname === "/api/auth/register" && method === "POST") {
    if (isRateLimited(ip, "register", 8)) {
      return sendJSON(res, 429, { error: "Too many attempts. Please try again shortly." });
    }
    let body;
    try { body = await collectBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const { name, email, password } = body;
    const errors = {};
    if (!name || !String(name).trim()) errors.name = "Name is required.";
    if (!email || !EMAIL_RE.test(String(email).trim())) errors.email = "A valid email is required.";
    if (!password || String(password).length < 8) errors.password = "Password must be at least 8 characters.";
    if (Object.keys(errors).length) return sendJSON(res, 422, { error: "Validation failed", fields: errors });

    const users = readJSON("users.json");
    if (users.some((u) => u.email.toLowerCase() === String(email).trim().toLowerCase())) {
      return sendJSON(res, 409, { error: "An account with that email already exists.", fields: { email: "Already registered — try logging in instead." } });
    }
    const { salt, hash } = hashPassword(String(password));
    const user = {
      id: crypto.randomUUID(),
      name: escapeHTML(String(name).trim()).slice(0, 200),
      email: String(email).trim().slice(0, 200),
      salt, hash,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeJSON("users.json", users);

    const token = createSession(user.id);
    return sendJSON(res, 201, { ok: true, user: publicUser(user) }, { "Set-Cookie": setCookieHeader("sid", token, SESSION_MAX_AGE) });
  }

  // ---- Auth: login ----
  if (pathname === "/api/auth/login" && method === "POST") {
    if (isRateLimited(ip, "login", 10)) {
      return sendJSON(res, 429, { error: "Too many attempts. Please try again shortly." });
    }
    let body;
    try { body = await collectBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    const { email, password } = body;
    const users = readJSON("users.json");
    const user = users.find((u) => u.email.toLowerCase() === String(email || "").trim().toLowerCase());
    if (!user || !verifyPassword(String(password || ""), user.salt, user.hash)) {
      return sendJSON(res, 401, { error: "Incorrect email or password." });
    }
    const token = createSession(user.id);
    return sendJSON(res, 200, { ok: true, user: publicUser(user) }, { "Set-Cookie": setCookieHeader("sid", token, SESSION_MAX_AGE) });
  }

  // ---- Auth: logout ----
  if (pathname === "/api/auth/logout" && method === "POST") {
    const cookies = parseCookies(req);
    if (cookies.sid) sessions.delete(cookies.sid);
    return sendJSON(res, 200, { ok: true }, { "Set-Cookie": setCookieHeader("sid", "", 0) });
  }

  // ---- Auth: current user ----
  if (pathname === "/api/auth/me" && method === "GET") {
    const user = getSessionUser(req);
    return sendJSON(res, 200, { user: user ? publicUser(user) : null });
  }

  // ---- My applications (requires login) ----
  if (pathname === "/api/my/applications" && method === "GET") {
    const user = getSessionUser(req);
    if (!user) return sendJSON(res, 401, { error: "Log in to see your applications." });
    const apps = readJSON("applications.json").filter((a) => a.userId === user.id);
    return sendJSON(res, 200, { applications: apps });
  }

  // ---- Courses ----
  if (pathname === "/api/courses" && method === "GET") {
    const courses = readJSON("courses.json").map((c) => ({
      ...c,
      seatsLeft: Math.max(c.seats - c.seatsTaken, 0),
      full: c.seatsTaken >= c.seats,
    }));
    return sendJSON(res, 200, { courses });
  }

  // ---- Faculty ----
  if (pathname === "/api/faculty" && method === "GET") {
    return sendJSON(res, 200, { faculty: readJSON("faculty.json") });
  }

  // ---- Gallery ----
  if (pathname === "/api/gallery" && method === "GET") {
    return sendJSON(res, 200, { gallery: readJSON("gallery.json") });
  }

  // ---- Stats (for the "campus at a glance" strip) ----
  if (pathname === "/api/stats" && method === "GET") {
    const courses = readJSON("courses.json");
    const faculty = readJSON("faculty.json");
    const totalSeats = courses.reduce((sum, c) => sum + c.seats, 0);
    const takenSeats = courses.reduce((sum, c) => sum + c.seatsTaken, 0);
    return sendJSON(res, 200, {
      programs: courses.length,
      faculty: faculty.length,
      seatsOpen: totalSeats - takenSeats,
      applicantsToday: readJSON("applications.json").length,
    });
  }

  // ---- Contact form ----
  if (pathname === "/api/contact" && method === "POST") {
    if (isRateLimited(ip, "contact")) {
      return sendJSON(res, 429, { error: "Too many messages sent. Please try again in a minute." });
    }
    let body;
    try {
      body = await collectBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
    const { name, email, subject, message } = body;
    const errors = {};
    if (!name || !String(name).trim()) errors.name = "Name is required.";
    if (!email || !EMAIL_RE.test(String(email).trim())) errors.email = "A valid email is required.";
    if (!message || String(message).trim().length < 10) errors.message = "Message must be at least 10 characters.";
    if (Object.keys(errors).length) return sendJSON(res, 422, { error: "Validation failed", fields: errors });

    const entry = {
      id: crypto.randomUUID(),
      name: escapeHTML(String(name).trim()).slice(0, 200),
      email: String(email).trim().slice(0, 200),
      subject: escapeHTML(String(subject || "General Inquiry").trim()).slice(0, 200),
      message: escapeHTML(String(message).trim()).slice(0, 3000),
      receivedAt: new Date().toISOString(),
    };
    const all = readJSON("messages.json");
    all.unshift(entry);
    writeJSON("messages.json", all);
    return sendJSON(res, 201, { ok: true, message: "Thanks — your message has been received. We'll reply within 2 business days." });
  }

  // ---- Course application ----
  if (pathname === "/api/apply" && method === "POST") {
    if (isRateLimited(ip, "apply")) {
      return sendJSON(res, 429, { error: "Too many applications submitted. Please try again in a minute." });
    }
    let body;
    try {
      body = await collectBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
    const { name, email, phone, courseId } = body;
    const courses = readJSON("courses.json");
    const course = courses.find((c) => c.id === courseId);
    const errors = {};
    if (!name || !String(name).trim()) errors.name = "Name is required.";
    if (!email || !EMAIL_RE.test(String(email).trim())) errors.email = "A valid email is required.";
    if (!phone || String(phone).trim().length < 7) errors.phone = "A valid phone number is required.";
    if (!course) errors.courseId = "Select a valid program.";
    if (Object.keys(errors).length) return sendJSON(res, 422, { error: "Validation failed", fields: errors });

    if (course.seatsTaken >= course.seats) {
      return sendJSON(res, 409, { error: `${course.name} is already at full capacity for this intake.` });
    }

    course.seatsTaken += 1;
    writeJSON("courses.json", courses);

    const sessionUser = getSessionUser(req);
    const entry = {
      id: crypto.randomUUID(),
      userId: sessionUser ? sessionUser.id : null,
      name: escapeHTML(String(name).trim()).slice(0, 200),
      email: String(email).trim().slice(0, 200),
      phone: escapeHTML(String(phone).trim()).slice(0, 40),
      courseId,
      courseName: course.name,
      status: "Under review",
      appliedAt: new Date().toISOString(),
    };
    const all = readJSON("applications.json");
    all.unshift(entry);
    writeJSON("applications.json", all);

    return sendJSON(res, 201, {
      ok: true,
      message: `Application received for ${course.name}. Seats remaining: ${course.seats - course.seatsTaken}.`,
      seatsLeft: course.seats - course.seatsTaken,
    });
  }

  // ---- Newsletter subscribe (footer) ----
  if (pathname === "/api/subscribe" && method === "POST") {
    if (isRateLimited(ip, "subscribe")) {
      return sendJSON(res, 429, { error: "Too many attempts. Please try again shortly." });
    }
    let body;
    try {
      body = await collectBody(req);
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
    const email = String(body.email || "").trim();
    if (!EMAIL_RE.test(email)) return sendJSON(res, 422, { error: "A valid email is required." });
    const all = readJSON("subscribers.json");
    if (all.some((s) => s.email.toLowerCase() === email.toLowerCase())) {
      return sendJSON(res, 200, { ok: true, message: "You're already subscribed." });
    }
    all.unshift({ email, subscribedAt: new Date().toISOString() });
    writeJSON("subscribers.json", all);
    return sendJSON(res, 201, { ok: true, message: "Subscribed! Watch your inbox for campus news." });
  }

  // ---- Admin: read submissions (simple shared-key auth, demo only) ----
  if (pathname === "/api/admin/messages" && method === "GET") {
    if (!checkAdmin(req, url)) return sendJSON(res, 401, { error: "Unauthorized" });
    return sendJSON(res, 200, { messages: readJSON("messages.json") });
  }
  if (pathname === "/api/admin/applications" && method === "GET") {
    if (!checkAdmin(req, url)) return sendJSON(res, 401, { error: "Unauthorized" });
    return sendJSON(res, 200, { applications: readJSON("applications.json") });
  }
  if (pathname === "/api/admin/users" && method === "GET") {
    if (!checkAdmin(req, url)) return sendJSON(res, 401, { error: "Unauthorized" });
    return sendJSON(res, 200, { users: readJSON("users.json").map(publicUser) });
  }

  return sendJSON(res, 404, { error: "Unknown API route" });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
      "Access-Control-Allow-Credentials": "true",
    });
    return res.end();
  }

  if (url.pathname.startsWith("/api/")) {
    try {
      return await handleAPI(req, res, url);
    } catch (e) {
      console.error(e);
      return sendJSON(res, 500, { error: "Internal server error" });
    }
  }

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`EduGlobal University Portal running at http://localhost:${PORT}`);
  console.log(`Admin key for /admin.html: ${ADMIN_KEY}`);
});
