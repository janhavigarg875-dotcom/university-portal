# EduGlobal University Portal — Full-Stack

A complete rebuild of the university portal with a **real backend** (Node.js,
zero external dependencies) and a frontend that's wired to it — every section
loads live data and every form actually saves something.

## Why this needed a rebuild

The original site is hosted on GitHub Pages, which only serves static
files — there is no server behind it, so it can never have a working
backend. This project is a standalone Node app you run yourself; GitHub
Pages can still host the *frontend look-alike*, but only this server can
run the API.

## What's working, end to end

| Section | Behavior |
|---|---|
| Courses | Loaded from `GET /api/courses`. Seat counts are real and drop live when someone applies. A course that fills up flips to "Full" / disables applying. |
| Faculty | Loaded from `GET /api/faculty`. |
| Gallery | Loaded from `GET /api/gallery`. |
| Contact form | `POST /api/contact` — validates on both client and server, persists to `data/messages.json`. |
| Apply Now modal | `POST /api/apply` — validates, checks seat capacity, persists to `data/applications.json`, decrements seats. |
| Newsletter (footer) | `POST /api/subscribe` — persists to `data/subscribers.json`, blocks duplicate emails. |
| Campus stats strip | `GET /api/stats` — computed live from the data above. |
| Student accounts | Register / log in / log out with real password hashing (`scrypt`) and HTTP-only session cookies — see below. |
| `/dashboard.html` | Logged-in students see their profile and every application they've submitted, with live status. |
| `/admin.html` | Simple key-protected page to view every submitted message, application, and registered student. |

Storage is plain JSON files under `/data` — no database to install. Swap
in a real database later without touching the frontend, since the API
shape stays the same.

## Student accounts (new)

Real authentication, not a mockup:

- `POST /api/auth/register` — name, email, password (min 8 chars). Password is
  hashed with Node's built-in `scrypt` + a random salt per user (`data/users.json`
  never stores plaintext passwords).
- `POST /api/auth/login` — verifies the password with a constant-time compare,
  then issues a session token as an `HttpOnly`, `SameSite=Lax` cookie.
- `POST /api/auth/logout` — invalidates the session.
- `GET /api/auth/me` — returns the logged-in user (or `null`), used by the
  frontend to decide what the nav bar shows.
- `GET /api/my/applications` — the logged-in student's own applications only
  (401 if not logged in).

Sessions live in an in-memory `Map` on the server, so **restarting the server
logs everyone out**. That's fine for a class project or demo; before real
production use, swap it for a persistent store (Redis, a database table, etc.)
so sessions survive restarts and work across multiple server instances.

Click "Apply Now" while logged in and the application is automatically linked
to your account — check `/dashboard.html` to see it show up.

## Run it

Requires only Node.js 16+, nothing to `npm install`.

```bash
node server.js
```

Then open **http://localhost:3000**. The admin view is at
**http://localhost:3000/admin.html** (default key: `admin123`, change it
by setting the `ADMIN_KEY` environment variable before starting the server).

## Project structure

```
university-portal/
├── server.js              # Node http server: static files + REST API + auth
├── render.yaml             # Render Blueprint (auto-config on deploy)
├── data/                  # JSON "database" (courses, faculty, gallery, submissions, users)
├── public/
│   ├── index.html
│   ├── dashboard.html      # student dashboard (protected client-side)
│   ├── admin.html
│   ├── css/style.css
│   └── js/
│       ├── main.js         # fetches API data, handles forms/modal/nav/auth
│       ├── dashboard.js
│       └── admin.js
└── package.json
```

## Deploying to Render (step by step)

GitHub Pages can't run this server, so deploy the whole project to a real
Node host. Render is the easiest free option and this repo already includes
a `render.yaml` blueprint for it:

1. **Push this project to a GitHub repo.**
   ```bash
   cd university-portal
   git init
   git add .
   git commit -m "EduGlobal University Portal — full stack"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. **Create a Render account** at render.com and connect your GitHub account.
3. **New → Blueprint**, pick the repo you just pushed. Render reads
   `render.yaml` automatically and pre-fills the service (Node runtime,
   start command `node server.js`).
4. When it asks for the `ADMIN_KEY` environment variable, set your own
   secret value (don't leave it as `admin123`).
5. Click **Apply** / **Create**. First deploy takes a minute or two; you'll
   get a live URL like `https://eduglobal-university-portal.onrender.com`.
6. Visit `<your-url>/admin.html` with your `ADMIN_KEY` to confirm submissions
   are landing.

**Important limitation on Render's free tier:** the filesystem is not
guaranteed to persist across redeploys (a new deploy can start from a fresh
copy of the repo, wiping anything written to `data/*.json` at runtime, and
the instance also spins down after inactivity). That's fine for a demo or
class project. For anything you need to keep long-term, swap the JSON files
for Render's free Postgres add-on or another persistent database — the
`readJSON`/`writeJSON` functions in `server.js` are the only place that
would need to change.

**Alternatives:** Railway and Fly.io work the same way (connect repo, start
command `node server.js`). A VPS works too — run it behind `pm2` with nginx
in front for TLS.

If you'd rather *keep* GitHub Pages as the frontend and only host the backend
on Render, change the `fetch("/api/...")` calls in `public/js/main.js` (and
`dashboard.js`) to point at your Render URL instead of a relative path, and
set `Access-Control-Allow-Origin` in `server.js` to your Pages domain instead
of `*` so cookies work cross-origin correctly.

## Notes on the admin key

The admin key is a demo-grade shared secret, not real auth — fine for
showing the backend works, not fine for production. Before deploying
somewhere public, replace it with real authentication (sessions, a login
form checked against hashed passwords, etc.).
