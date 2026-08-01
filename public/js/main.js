(() => {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  document.getElementById("year").textContent = new Date().getFullYear();

  // ---------------- Mobile nav ----------------
  const navToggle = $("#navToggle");
  const mainNav = $("#mainNav");
  navToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
  $$(".nav-link").forEach((link) =>
    link.addEventListener("click", () => {
      mainNav.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    })
  );

  // ---------------- Active nav link on scroll + back-to-top ----------------
  const sections = $$("main section[id]");
  const navLinks = $$(".nav-link");
  const toTop = $("#toTop");

  function onScroll() {
    const pos = window.scrollY + 120;
    let current = sections[0]?.id;
    for (const sec of sections) {
      if (pos >= sec.offsetTop) current = sec.id;
    }
    navLinks.forEach((l) => l.classList.toggle("active", l.getAttribute("href") === `#${current}`));
    toTop.classList.toggle("show", window.scrollY > 500);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---------------- Toast ----------------
  const toastEl = $("#toast");
  let toastTimer;
  function showToast(msg, type = "ok") {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type === "err" ? "err" : ""}`;
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4200);
  }

  // ---------------- API helper ----------------
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error(data.error || "Request failed");
      err.fields = data.fields;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------------- Stats ledger ----------------
  api("/api/stats")
    .then((data) => {
      $('[data-stat="programs"]').textContent = data.programs;
      $('[data-stat="faculty"]').textContent = data.faculty;
      $('[data-stat="seatsOpen"]').textContent = data.seatsOpen;
      $('[data-stat="applicantsToday"]').textContent = data.applicantsToday;
    })
    .catch(() => {
      $$(".ledger-stats dd").forEach((dd) => (dd.textContent = "—"));
    });

  // ---------------- Courses catalog ----------------
  const catalogList = $("#catalogList");
  const courseSelect = $("#aCourse");
  let coursesCache = [];

  function renderCourses(courses) {
    coursesCache = courses;
    if (!courses.length) {
      catalogList.innerHTML = `<p class="loading">No programs published yet.</p>`;
      return;
    }
    catalogList.innerHTML = courses
      .map(
        (c) => `
      <article class="catalog-row">
        <div class="catalog-code">${c.code}</div>
        <div class="catalog-main">
          <div class="catalog-title-row">
            <h3>${c.name}</h3>
            <span class="catalog-dots"></span>
            <span class="catalog-dept">${c.dept}</span>
          </div>
          <p class="catalog-desc">${c.description}</p>
          <div class="catalog-tags">${c.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
        </div>
        <div class="catalog-side">
          <span class="seat-pill ${c.full ? "full" : ""}">${c.full ? "Full" : `${c.seatsLeft} seats left`}</span>
          <span class="seat-meter" aria-hidden="true"><span class="seat-meter-fill ${c.full ? "full" : ""}" style="width:${Math.min(100, Math.round((c.seatsTaken / c.seats) * 100))}%"></span></span>
          <span class="catalog-meta">${c.duration} · ${c.credits} credits</span>
          <button class="btn btn-small btn-outline" data-open-modal data-course="${c.id}" ${c.full ? "disabled" : ""}>
            ${c.full ? "Waitlist" : "Apply"}
          </button>
        </div>
      </article>`
      )
      .join("");

    courseSelect.innerHTML =
      `<option value="">Select a program…</option>` +
      courses.map((c) => `<option value="${c.id}" ${c.full ? "disabled" : ""}>${c.name} ${c.full ? "(Full)" : ""}</option>`).join("");

    bindModalOpeners();
  }

  function loadCourses() {
    return api("/api/courses")
      .then((data) => renderCourses(data.courses))
      .catch(() => {
        catalogList.innerHTML = `<p class="loading">Couldn't load the catalog. Is the backend server running?</p>`;
      });
  }
  loadCourses();

  // ---------------- Faculty ----------------
  const facultyGrid = $("#facultyGrid");
  api("/api/faculty")
    .then((data) => {
      facultyGrid.innerHTML = data.faculty
        .map(
          (f) => `
        <article class="faculty-card">
          <img class="faculty-photo" src="${f.photo}" alt="${f.name}" loading="lazy" />
          <h3>${f.name}</h3>
          <p class="faculty-title">${f.title}</p>
          <p class="faculty-dept">${f.dept} · since ${f.since}</p>
          <p class="faculty-bio">${f.bio}</p>
        </article>`
        )
        .join("");
    })
    .catch(() => {
      facultyGrid.innerHTML = `<p class="loading">Couldn't load faculty. Is the backend server running?</p>`;
    });

  // ---------------- Gallery ----------------
  const galleryGrid = $("#galleryGrid");
  api("/api/gallery")
    .then((data) => {
      galleryGrid.innerHTML = data.gallery
        .map(
          (g) => `
        <figure class="gallery-item">
          <img src="${g.url}" alt="${g.caption}" loading="lazy" />
          <figcaption class="gallery-cap">${g.caption}</figcaption>
        </figure>`
        )
        .join("");
    })
    .catch(() => {
      galleryGrid.innerHTML = `<p class="loading">Couldn't load the gallery. Is the backend server running?</p>`;
    });

  // ---------------- Modal (apply) ----------------
  const modal = $("#applyModal");
  function openModal(courseId) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (courseId) courseSelect.value = courseId;
    if (currentUser) {
      $("#aName").value = currentUser.name;
      $("#aEmail").value = currentUser.email;
    }
    $("#aName").focus();
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  function bindModalOpeners() {
    $$("[data-open-modal]").forEach((btn) => {
      btn.onclick = () => openModal(btn.dataset.course);
    });
  }
  bindModalOpeners();
  $("#closeModal").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  // ---------------- Modal (auth: login / register) ----------------
  const authModal = $("#authModal");
  const authTitle = $("#authModalTitle");
  const loginForm = $("#loginForm");
  const registerForm = $("#registerForm");
  const authTabs = $$(".auth-tab");

  function setAuthTab(tab) {
    authTabs.forEach((t) => {
      const active = t.dataset.tab === tab;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });
    loginForm.hidden = tab !== "login";
    registerForm.hidden = tab !== "register";
    authTitle.textContent = tab === "login" ? "Log In" : "Create Your Account";
  }
  authTabs.forEach((t) => t.addEventListener("click", () => setAuthTab(t.dataset.tab)));

  function openAuthModal(tab = "login") {
    setAuthTab(tab);
    authModal.classList.add("open");
    authModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    (tab === "login" ? $("#lEmail") : $("#rName")).focus();
  }
  function closeAuthModal() {
    authModal.classList.remove("open");
    authModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  $$("[data-open-auth]").forEach((btn) => btn.addEventListener("click", () => openAuthModal("login")));
  $("#closeAuthModal").addEventListener("click", closeAuthModal);
  authModal.addEventListener("click", (e) => { if (e.target === authModal) closeAuthModal(); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal.classList.contains("open")) closeModal();
    if (authModal.classList.contains("open")) closeAuthModal();
  });

  // ---------------- Session state ----------------
  const navAuth = $("#navAuth");
  let currentUser = null;

  function renderNavAuth() {
    if (currentUser) {
      navAuth.innerHTML = `
        <span class="nav-user">
          <span class="nav-user-name"><a href="/dashboard.html">${currentUser.name.split(" ")[0]}</a></span>
          <button class="btn btn-small btn-outline" id="navLogoutBtn">Log Out</button>
        </span>`;
      $("#navLogoutBtn").addEventListener("click", doLogout);
    } else {
      navAuth.innerHTML = `<button class="btn btn-small btn-ghost" id="navLoginBtn" data-open-auth>Log In</button>`;
      $("#navLoginBtn").addEventListener("click", () => openAuthModal("login"));
    }
  }

  async function refreshSession() {
    try {
      const data = await api("/api/auth/me");
      currentUser = data.user;
    } catch (_) {
      currentUser = null;
    }
    renderNavAuth();
  }
  refreshSession();

  async function doLogout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (_) {}
    currentUser = null;
    renderNavAuth();
    showToast("Logged out.");
  }

  // ---------------- Generic form handling ----------------
  function clearErrors(form) {
    $$(".field-error", form).forEach((el) => (el.textContent = ""));
    $$("input, textarea, select", form).forEach((el) => el.classList.remove("invalid"));
  }
  function showFieldErrors(form, fields) {
    Object.entries(fields || {}).forEach(([name, msg]) => {
      const errEl = form.querySelector(`[data-error-for="${name}"]`);
      const input = form.querySelector(`[name="${name}"]`);
      if (errEl) errEl.textContent = msg;
      if (input) input.classList.add("invalid");
    });
  }
  function setSubmitting(form, submitting) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = submitting;
    const label = btn.querySelector(".btn-label");
    if (label) label.textContent = submitting ? "Sending…" : label.dataset.original || label.textContent;
  }

  // Contact form
  const contactForm = $("#contactForm");
  const contactStatus = $("#contactStatus");
  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(contactForm);
    contactStatus.textContent = "";
    contactStatus.className = "form-status";

    const payload = Object.fromEntries(new FormData(contactForm).entries());
    if (!payload.name?.trim()) return showFieldErrors(contactForm, { name: "Name is required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email || "")) return showFieldErrors(contactForm, { email: "Enter a valid email." });
    if (!payload.message || payload.message.trim().length < 10) return showFieldErrors(contactForm, { message: "Message must be at least 10 characters." });

    setSubmitting(contactForm, true);
    try {
      const data = await api("/api/contact", { method: "POST", body: JSON.stringify(payload) });
      contactStatus.textContent = data.message;
      contactStatus.className = "form-status ok";
      contactForm.reset();
      showToast("Message sent — thanks!");
    } catch (err) {
      if (err.fields) showFieldErrors(contactForm, err.fields);
      contactStatus.textContent = err.message;
      contactStatus.className = "form-status err";
      showToast(err.message, "err");
    } finally {
      setSubmitting(contactForm, false);
    }
  });

  // Apply form
  const applyForm = $("#applyForm");
  const applyStatus = $("#applyStatus");
  applyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(applyForm);
    applyStatus.textContent = "";
    applyStatus.className = "form-status";

    const payload = Object.fromEntries(new FormData(applyForm).entries());
    if (!payload.name?.trim()) return showFieldErrors(applyForm, { name: "Name is required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email || "")) return showFieldErrors(applyForm, { email: "Enter a valid email." });
    if (!payload.phone || payload.phone.trim().length < 7) return showFieldErrors(applyForm, { phone: "Enter a valid phone number." });
    if (!payload.courseId) return showFieldErrors(applyForm, { courseId: "Select a program." });

    setSubmitting(applyForm, true);
    try {
      const data = await api("/api/apply", { method: "POST", body: JSON.stringify(payload) });
      applyStatus.textContent = data.message;
      applyStatus.className = "form-status ok";
      applyForm.reset();
      showToast("Application submitted!");
      loadCourses(); // refresh live seat counts
      setTimeout(closeModal, 1600);
    } catch (err) {
      if (err.fields) showFieldErrors(applyForm, err.fields);
      applyStatus.textContent = err.message;
      applyStatus.className = "form-status err";
      showToast(err.message, "err");
    } finally {
      setSubmitting(applyForm, false);
    }
  });

  // Login form
  const loginStatus = $("#loginStatus");
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(loginForm);
    loginStatus.textContent = "";
    loginStatus.className = "form-status";
    const payload = Object.fromEntries(new FormData(loginForm).entries());
    setSubmitting(loginForm, true);
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
      currentUser = data.user;
      renderNavAuth();
      loginForm.reset();
      showToast(`Welcome back, ${currentUser.name.split(" ")[0]}!`);
      closeAuthModal();
    } catch (err) {
      if (err.fields) showFieldErrors(loginForm, err.fields);
      loginStatus.textContent = err.message;
      loginStatus.className = "form-status err";
    } finally {
      setSubmitting(loginForm, false);
    }
  });

  // Register form
  const registerStatus = $("#registerStatus");
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(registerForm);
    registerStatus.textContent = "";
    registerStatus.className = "form-status";
    const payload = Object.fromEntries(new FormData(registerForm).entries());
    if (!payload.name?.trim()) return showFieldErrors(registerForm, { name: "Name is required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email || "")) return showFieldErrors(registerForm, { email: "Enter a valid email." });
    if (!payload.password || payload.password.length < 8) return showFieldErrors(registerForm, { password: "At least 8 characters." });

    setSubmitting(registerForm, true);
    try {
      const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
      currentUser = data.user;
      renderNavAuth();
      registerForm.reset();
      showToast(`Account created — welcome, ${currentUser.name.split(" ")[0]}!`);
      closeAuthModal();
    } catch (err) {
      if (err.fields) showFieldErrors(registerForm, err.fields);
      registerStatus.textContent = err.message;
      registerStatus.className = "form-status err";
    } finally {
      setSubmitting(registerForm, false);
    }
  });

  // Subscribe form
  const subscribeForm = $("#subscribeForm");
  const subscribeStatus = $("#subscribeStatus");
  subscribeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    subscribeStatus.textContent = "";
    subscribeStatus.className = "form-status";
    const email = $("#subEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      subscribeStatus.textContent = "Enter a valid email.";
      subscribeStatus.className = "form-status err";
      return;
    }
    setSubmitting(subscribeForm, true);
    try {
      const data = await api("/api/subscribe", { method: "POST", body: JSON.stringify({ email }) });
      subscribeStatus.textContent = data.message;
      subscribeStatus.className = "form-status ok";
      subscribeForm.reset();
    } catch (err) {
      subscribeStatus.textContent = err.message;
      subscribeStatus.className = "form-status err";
    } finally {
      setSubmitting(subscribeForm, false);
    }
  });
})();
