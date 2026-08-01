(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  async function load() {
    const key = $("#adminKey").value.trim();
    const headers = { "X-Admin-Key": key };

    const msgWrap = $("#messagesWrap");
    const appWrap = $("#appsWrap");
    const usersWrap = $("#usersWrap");
    msgWrap.innerHTML = `<p class="empty">Loading…</p>`;
    appWrap.innerHTML = `<p class="empty">Loading…</p>`;
    usersWrap.innerHTML = `<p class="empty">Loading…</p>`;

    try {
      const [msgsRes, appsRes, usersRes] = await Promise.all([
        fetch("/api/admin/messages", { headers }),
        fetch("/api/admin/applications", { headers }),
        fetch("/api/admin/users", { headers }),
      ]);
      if (msgsRes.status === 401 || appsRes.status === 401 || usersRes.status === 401) {
        msgWrap.innerHTML = `<p class="empty">Unauthorized — check the admin key.</p>`;
        appWrap.innerHTML = "";
        usersWrap.innerHTML = "";
        return;
      }
      const msgs = (await msgsRes.json()).messages || [];
      const apps = (await appsRes.json()).applications || [];
      const users = (await usersRes.json()).users || [];

      msgWrap.innerHTML = msgs.length
        ? `<table><thead><tr><th>Received</th><th>Name</th><th>Email</th><th>Subject</th><th>Message</th></tr></thead><tbody>
            ${msgs.map((m) => `<tr><td>${fmtDate(m.receivedAt)}</td><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.subject)}</td><td>${esc(m.message)}</td></tr>`).join("")}
          </tbody></table>`
        : `<p class="empty">No messages yet — submit the contact form on the homepage.</p>`;

      appWrap.innerHTML = apps.length
        ? `<table><thead><tr><th>Applied</th><th>Name</th><th>Email</th><th>Phone</th><th>Program</th></tr></thead><tbody>
            ${apps.map((a) => `<tr><td>${fmtDate(a.appliedAt)}</td><td>${esc(a.name)}</td><td>${esc(a.email)}</td><td>${esc(a.phone)}</td><td>${esc(a.courseName)}</td></tr>`).join("")}
          </tbody></table>`
        : `<p class="empty">No applications yet — use "Apply Now" on the homepage.</p>`;

      usersWrap.innerHTML = users.length
        ? `<table><thead><tr><th>Joined</th><th>Name</th><th>Email</th></tr></thead><tbody>
            ${users.map((u) => `<tr><td>${fmtDate(u.createdAt)}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td></tr>`).join("")}
          </tbody></table>`
        : `<p class="empty">No student accounts yet — register on the homepage.</p>`;
    } catch (e) {
      msgWrap.innerHTML = `<p class="empty">Couldn't reach the server.</p>`;
      appWrap.innerHTML = "";
      usersWrap.innerHTML = "";
    }
  }

  $("#loadBtn").addEventListener("click", load);
  load();
})();
