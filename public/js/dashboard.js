(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch { return iso; }
  }

  async function init() {
    let me;
    try {
      me = await (await fetch("/api/auth/me")).json();
    } catch {
      me = { user: null };
    }

    if (!me.user) {
      $("#gate").hidden = false;
      return;
    }

    $("#dashContent").hidden = false;
    $("#welcomeName").textContent = `Welcome, ${me.user.name.split(" ")[0]}`;
    $("#pName").textContent = me.user.name;
    $("#pEmail").textContent = me.user.email;
    $("#pSince").textContent = fmtDate(me.user.createdAt);

    $("#logoutBtn").addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    });

    const appsWrap = $("#appsWrap");
    try {
      const data = await (await fetch("/api/my/applications")).json();
      const apps = data.applications || [];
      appsWrap.innerHTML = apps.length
        ? `<table class="dash-table"><thead><tr><th>Applied</th><th>Program</th><th>Status</th></tr></thead><tbody>
            ${apps.map((a) => `<tr><td>${fmtDate(a.appliedAt)}</td><td>${esc(a.courseName)}</td><td><span class="status-pill">${esc(a.status || "Under review")}</span></td></tr>`).join("")}
          </tbody></table>`
        : `<p class="dash-empty">No applications yet — use "Apply Now" on the homepage to apply to a program.</p>`;
    } catch {
      appsWrap.innerHTML = `<p class="dash-empty">Couldn't load your applications.</p>`;
    }
  }

  init();
})();
