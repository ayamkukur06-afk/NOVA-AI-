/* =====================================================================
   NOVA — AI Chat (single-page vanilla app)
   Sections: utils -> i18n -> storage/state -> auth -> render -> chat
   engine -> composer/files -> image tools -> settings -> search -> init
   ===================================================================== */
(function () {
  "use strict";

  /* ------------------------------ UTILS ------------------------------ */
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const escapeHtml = (s) => (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fmtBytes = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
  const nowIso = () => new Date().toISOString();

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach((k) => {
      if (k === "class") node.className = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) => { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }
  function icon(name, cls) {
    const span = h("span", { class: cls || "" });
    span.innerHTML = "<i data-lucide=\"" + name + "\"></i>";
    return span;
  }
  function refreshIcons() { try { lucide.createIcons(); } catch (e) {} }

  function toast(msg, ms) {
    const host = qs("#toastHost");
    const t = h("div", { class: "toast", text: msg });
    host.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .25s"; setTimeout(() => t.remove(), 260); }, ms || 2400);
  }

  function ripple(e) {
    const target = e.currentTarget;
    if (getComputedStyle(target).position === "static") target.style.position = "relative";
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const r = h("span", { class: "ripple-el" });
    r.style.width = r.style.height = size + "px";
    r.style.left = (e.clientX - rect.left - size / 2) + "px";
    r.style.top = (e.clientY - rect.top - size / 2) + "px";
    target.style.overflow = "hidden";
    target.appendChild(r);
    setTimeout(() => r.remove(), 520);
  }
  function withRipple(node) { node.classList.add("ripple"); node.addEventListener("click", ripple); return node; }

  async function sha256(text) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) { return "plain:" + text; } // fallback (very old browsers)
  }

  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfWeek() { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); return d.getTime() - day * 86400000; }
  function startOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }

  /* ------------------------------ I18N ------------------------------ */
  const DICT = {
    id: {
      newChat: "Chat Baru", searchHistory: "Cari riwayat...", pinned: "Favorit", archived: "Arsip", trash: "Sampah",
      settings: "Pengaturan", today: "Hari ini", yesterday: "Kemarin", earlier: "Sebelumnya",
      placeholder: "Tulis pesan untuk Nova...", online: "Online", thinking: "Sedang berpikir...",
      send: "Kirim", stop: "Hentikan", emptyTitle: "Mulai percakapan baru", emptySub: "Tanyakan apa saja, atau coba salah satu ide di bawah ini.",
    },
    en: {
      newChat: "New Chat", searchHistory: "Search history...", pinned: "Pinned", archived: "Archived", trash: "Trash",
      settings: "Settings", today: "Today", yesterday: "Yesterday", earlier: "Earlier",
      placeholder: "Message Nova...", online: "Online", thinking: "Thinking...",
      send: "Send", stop: "Stop", emptyTitle: "Start a new conversation", emptySub: "Ask anything, or try one of the ideas below.",
    }
  };
  function t(key) { return (DICT[state.settings.lang] || DICT.id)[key] || key; }

  /* ------------------------------ STORAGE ------------------------------ */
  const LS = {
    get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } },
    del(key) { try { localStorage.removeItem(key); } catch (e) {} }
  };

  const DEFAULT_SETTINGS = {
    theme: "dark", lang: "id", notifications: false, highContrast: false,
    apiKey: "", apiProvider: "groq", defaultModel: "fast"
  };

  const state = {
    session: LS.get("nova_session", null), // {userId}
    users: LS.get("nova_users", {}),        // id -> {id,name,email,bio,avatar,passHash}
    settings: LS.get("nova_settings", DEFAULT_SETTINGS),
    chats: LS.get("nova_chats", {}),        // id -> {id,title,messages:[],pinned,archived,trashed,createdAt,updatedAt,mode}
    activeChat: null,
    sidebarTab: "all",                      // all | pinned | archived | trash
    sidebarCollapsed: LS.get("nova_sidebar_collapsed", false),
    mobileSidebarOpen: false,
    pendingFiles: [],                       // attachments staged for next send
    streaming: false,
    abortCtrl: null,
    otpDemo: null
  };
  function saveUsers() { LS.set("nova_users", state.users); }
  function saveSettings() { LS.set("nova_settings", state.settings); }
  function saveChats() { LS.set("nova_chats", state.chats); }
  function saveSession() { LS.set("nova_session", state.session); }

  function currentUser() { return state.session ? state.users[state.session.userId] : null; }
  function isLoggedIn() { return !!currentUser(); }

  /* ------------------------------ AUTH SCREEN ------------------------------ */
  let authMode = "login"; // login | signup | otp

  function renderAuth() {
    applyThemeClass();
    const root = qs("#app");
    root.innerHTML = "";
    const wrap = h("div", { class: "auth-wrap" });
    const card = h("div", { class: "auth-card" });

    card.appendChild(h("div", { class: "auth-logo" }, [
      h("div", { class: "brand-mark", html: '<i data-lucide="sparkles" style="width:18px;height:18px"></i>' }),
      h("span", { class: "brand-name", text: "Nova" })
    ]));

    if (authMode === "otp") {
      card.appendChild(h("h2", { class: "auth-title", text: "Verifikasi Email" }));
      card.appendChild(h("p", { class: "auth-sub", text: "Kode demo (tanpa server email sungguhan) sudah ditampilkan di bawah." }));
      const codeBox = h("div", { class: "field-input", style: "text-align:center;font-weight:800;font-size:22px;letter-spacing:.3em;margin-bottom:14px;", text: state.otpDemo.code });
      card.appendChild(codeBox);
      const otpInput = h("input", { class: "field-input", placeholder: "Masukkan 6 digit kode", maxlength: "6", inputmode: "numeric" });
      card.appendChild(h("label", { class: "field-label", text: "Kode OTP" }));
      card.appendChild(otpInput);
      const confirmBtn = h("button", { class: "btn-primary", text: "Verifikasi & Masuk", style: "margin-top:16px;" });
      confirmBtn.addEventListener("click", () => {
        if (otpInput.value.trim() === state.otpDemo.code) {
          completeSignup(state.otpDemo.pending);
        } else toast("Kode OTP salah.");
      });
      card.appendChild(confirmBtn);
      root.appendChild(wrap); wrap.appendChild(card); refreshIcons(); return;
    }

    card.appendChild(h("h2", { class: "auth-title", text: authMode === "login" ? "Masuk ke Nova" : "Buat Akun Nova" }));
    card.appendChild(h("p", { class: "auth-sub", text: "AI chat yang cepat, aman, dan nyaman digunakan." }));

    // OAuth stub buttons — jujur diberi label "demo", karena OAuth asli butuh backend.
    const gBtn = withRipple(h("button", { class: "btn-secondary", style: "margin-bottom:8px;" }, [icon("chrome"), h("span", { text: "Lanjutkan dengan Google" })]));
    gBtn.addEventListener("click", () => toast("Login Google butuh backend OAuth — belum dikonfigurasi di demo ini."));
    const ghBtn = withRipple(h("button", { class: "btn-secondary" }, [icon("github"), h("span", { text: "Lanjutkan dengan GitHub" })]));
    ghBtn.addEventListener("click", () => toast("Login GitHub butuh backend OAuth — belum dikonfigurasi di demo ini."));
    card.appendChild(gBtn); card.appendChild(ghBtn);
    card.appendChild(h("div", { class: "divider", text: "atau dengan email" }));

    if (authMode === "signup") {
      card.appendChild(h("label", { class: "field-label", text: "Nama" }));
    }
    const nameInput = authMode === "signup" ? h("input", { class: "field-input", placeholder: "Nama kamu", id: "authName" }) : null;
    if (nameInput) card.appendChild(nameInput);

    card.appendChild(h("label", { class: "field-label", text: "Email" }));
    const emailInput = h("input", { class: "field-input", type: "email", placeholder: "kamu@email.com", id: "authEmail" });
    card.appendChild(emailInput);

    card.appendChild(h("label", { class: "field-label", text: "Kata sandi" }));
    const passInput = h("input", { class: "field-input", type: "password", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", id: "authPass" });
    card.appendChild(passInput);

    if (authMode === "login") {
      const rowRemember = h("div", { style: "display:flex;align-items:center;gap:8px;margin-top:10px;" }, [
        h("input", { type: "checkbox", id: "rememberMe", checked: "checked" }),
        h("label", { for: "rememberMe", style: "font-size:12.5px;color:var(--text-dim);", text: "Ingat saya di perangkat ini" })
      ]);
      card.appendChild(rowRemember);
    }

    const submitBtn = h("button", { class: "btn-primary", style: "margin-top:16px;", text: authMode === "login" ? "Masuk" : "Daftar & Kirim OTP" });
    submitBtn.addEventListener("click", async () => {
      const email = emailInput.value.trim().toLowerCase();
      const pass = passInput.value;
      if (!email || !pass) return toast("Isi email dan kata sandi.");
      if (authMode === "signup") {
        const name = nameInput.value.trim() || email.split("@")[0];
        const existing = Object.values(state.users).find((u) => u.email === email);
        if (existing) return toast("Email sudah terdaftar, silakan masuk.");
        const passHash = await sha256(pass);
        const pendingUser = { id: uid(), name, email, passHash, bio: "", avatar: "", createdAt: nowIso() };
        state.otpDemo = { code: String(Math.floor(100000 + Math.random() * 900000)), pending: pendingUser };
        authMode = "otp"; renderAuth();
      } else {
        const passHash = await sha256(pass);
        const found = Object.values(state.users).find((u) => u.email === email && u.passHash === passHash);
        if (!found) return toast("Email atau kata sandi salah.");
        state.session = { userId: found.id };
        saveSession();
        toast("Selamat datang kembali, " + found.name + "!");
        boot();
      }
    });
    card.appendChild(submitBtn);

    const switchRow = h("div", { class: "auth-switch" });
    if (authMode === "login") {
      switchRow.appendChild(document.createTextNode("Belum punya akun? "));
      const b = h("button", { text: "Daftar" }); b.addEventListener("click", () => { authMode = "signup"; renderAuth(); });
      switchRow.appendChild(b);
    } else {
      switchRow.appendChild(document.createTextNode("Sudah punya akun? "));
      const b = h("button", { text: "Masuk" }); b.addEventListener("click", () => { authMode = "login"; renderAuth(); });
      switchRow.appendChild(b);
    }
    card.appendChild(switchRow);

    wrap.appendChild(card);
    root.appendChild(wrap);
    refreshIcons();
  }

  function completeSignup(pendingUser) {
    state.users[pendingUser.id] = pendingUser;
    saveUsers();
    state.session = { userId: pendingUser.id };
    saveSession();
    state.otpDemo = null;
    toast("Akun dibuat. Selamat datang, " + pendingUser.name + "!");
    boot();
  }

  function logout() {
    state.session = null; saveSession();
    authMode = "login";
    renderAuth();
  }

  /* ------------------------------ THEME ------------------------------ */
  function applyThemeClass() {
    const r = document.documentElement;
    r.classList.remove("dark", "light");
    r.classList.add(state.settings.theme === "light" ? "light" : "dark");
    r.classList.toggle("contrast", !!state.settings.highContrast);
    document.body.className = state.settings.theme === "light" ? "light" : "dark";
  }

  /* ------------------------------ CHAT DATA HELPERS ------------------------------ */
  const MODES = [
    { id: "fast", label: "Fast", icon: "zap" },
    { id: "thinking", label: "Thinking", icon: "brain-circuit" },
    { id: "creative", label: "Creative", icon: "palette" },
    { id: "coding", label: "Coding", icon: "code-2" },
    { id: "vision", label: "Vision", icon: "eye" }
  ];
  const MODE_PROMPTS = {
    fast: "Kamu adalah Nova, asisten AI yang cepat, jelas, dan ringkas. Jawab langsung ke inti, gunakan bahasa yang sama dengan pengguna.",
    thinking: "Kamu adalah Nova. Pikirkan langkah demi langkah secara ringkas sebelum memberi kesimpulan akhir yang jelas. Gunakan bahasa yang sama dengan pengguna.",
    creative: "Kamu adalah Nova, asisten AI yang imajinatif dan ekspresif untuk brainstorming, tulisan kreatif, dan ide-ide baru. Gunakan bahasa yang sama dengan pengguna.",
    coding: "Kamu adalah Nova, asisten AI pemrograman setingkat senior engineer. Selalu bungkus kode dalam blok markdown dengan penanda bahasa (```javascript, ```python, dll). Jika ada beberapa file, pisahkan tiap file dalam blok kode terpisah. Utamakan kode yang bersih, benar, modern, dan siap pakai.",
    vision: "Kamu adalah Nova. Pengguna mungkin melampirkan gambar. Jelaskan / analisis isi gambar sejelas mungkin berdasarkan deskripsi/metadata yang diberikan, dan jawab pertanyaan terkait gambar tersebut."
  };

  function newChat() {
    const id = uid();
    state.chats[id] = { id, title: "Percakapan baru", messages: [], pinned: false, archived: false, trashed: false, mode: state.settings.defaultModel || "fast", createdAt: nowIso(), updatedAt: nowIso(), userId: state.session.userId };
    state.activeChat = id;
    saveChats();
    render();
  }
  function getChat(id) { return state.chats[id]; }
  function userChats() { return Object.values(state.chats).filter((c) => c.userId === state.session.userId); }
  function touchChat(c) { c.updatedAt = nowIso(); saveChats(); }

  function ensureActiveChat() {
    const list = userChats().filter((c) => !c.trashed);
    if (state.activeChat && state.chats[state.activeChat]) return;
    if (list.length) { state.activeChat = list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id; }
    else state.activeChat = null;
  }

  /* ------------------------------ MAIN RENDER ------------------------------ */
  function render() {
    if (!isLoggedIn()) { renderAuth(); return; }
    applyThemeClass();
    ensureActiveChat();
    const root = qs("#app");
    root.innerHTML = "";

    if (state.mobileSidebarOpen) {
      const bd = h("div", { class: "sidebar-backdrop" });
      bd.addEventListener("click", () => { state.mobileSidebarOpen = false; render(); });
      root.appendChild(bd);
    }

    root.appendChild(renderSidebar());

    const mainCol = h("div", { class: "main-col" });
    mainCol.appendChild(renderHeader());
    mainCol.appendChild(renderChatScroll());
    mainCol.appendChild(renderComposer());
    root.appendChild(mainCol);

    refreshIcons();
    scrollChatToBottom(false);
  }

  /* ---------- Sidebar ---------- */
  function chatBucket(tab) {
    const list = userChats();
    if (tab === "pinned") return list.filter((c) => c.pinned && !c.trashed);
    if (tab === "archived") return list.filter((c) => c.archived && !c.trashed);
    if (tab === "trash") return list.filter((c) => c.trashed);
    return list.filter((c) => !c.trashed && !c.archived);
  }
  function groupByDate(list) {
    const today = startOfToday(), yest = today - 86400000;
    const groups = { today: [], yesterday: [], earlier: [] };
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).forEach((c) => {
      const ts = new Date(c.updatedAt).getTime();
      if (ts >= today) groups.today.push(c);
      else if (ts >= yest) groups.yesterday.push(c);
      else groups.earlier.push(c);
    });
    return groups;
  }

  let sidebarSearchQ = "";
  function renderSidebar() {
    const collapsed = state.sidebarCollapsed;
    const sb = h("div", { class: "sidebar" + (collapsed ? " collapsed" : "") + (state.mobileSidebarOpen ? " mobile-open" : "") });

    sb.appendChild(h("div", { class: "brand" }, [
      h("div", { class: "brand-mark", html: '<i data-lucide="sparkles" style="width:18px;height:18px"></i>' }),
      h("span", { class: "brand-name hide-collapsed", text: "Nova" }),
      (function () { const b = withRipple(h("button", { class: "icon-btn hide-collapsed", style: "margin-left:auto;", "aria-label": "Ciutkan sidebar" }, [icon("panel-left-close")])); b.addEventListener("click", () => { state.sidebarCollapsed = true; LS.set("nova_sidebar_collapsed", true); render(); }); return b; })()
    ]));
    if (collapsed) {
      const expandBtn = withRipple(h("button", { class: "icon-btn", style: "margin:4px auto;", "aria-label": "Perluas sidebar" }, [icon("panel-left-open")]));
      expandBtn.addEventListener("click", () => { state.sidebarCollapsed = false; LS.set("nova_sidebar_collapsed", false); render(); });
      sb.appendChild(expandBtn);
    }

    const newBtn = withRipple(h("button", { class: "new-chat-btn", "aria-label": t("newChat") }, [icon("plus"), h("span", { class: "hide-collapsed", text: t("newChat") })]));
    newBtn.addEventListener("click", newChat);
    sb.appendChild(newBtn);

    if (!collapsed) {
      const searchWrap = h("div", { class: "side-search" });
      searchWrap.innerHTML = '<i data-lucide="search"></i>';
      const searchInput = h("input", { placeholder: t("searchHistory"), value: sidebarSearchQ, "aria-label": t("searchHistory") });
      searchInput.addEventListener("input", debounce((e) => { sidebarSearchQ = e.target.value; renderSidebarList(); }, 150));
      searchWrap.appendChild(searchInput);
      sb.appendChild(searchWrap);

      const tabs = h("div", { class: "side-tabs" });
      [["all", "Chat"], ["pinned", t("pinned")], ["archived", t("archived")], ["trash", t("trash")]].forEach(([id, label]) => {
        const btn = h("button", { class: "side-tab" + (state.sidebarTab === id ? " active" : ""), text: label });
        btn.addEventListener("click", () => { state.sidebarTab = id; render(); });
        tabs.appendChild(btn);
      });
      sb.appendChild(tabs);
    }

    const scrollArea = h("div", { class: "sidebar-scroll scroll-thin", id: "sidebarScroll" });
    sb.appendChild(scrollArea);
    setTimeout(renderSidebarList, 0);

    const footer = h("div", { class: "sidebar-footer" });
    const settingsBtn = h("button", { class: "side-link" }, [icon("settings-2"), h("span", { class: "hide-collapsed", text: t("settings") })]);
    settingsBtn.addEventListener("click", openSettingsDrawer);
    footer.appendChild(settingsBtn);
    const u = currentUser();
    const profRow = h("div", { class: "profile-row" }, [
      h("div", { class: "avatar" }, [u.avatar ? h("img", { src: u.avatar }) : h("span", { text: (u.name || "?").slice(0, 1).toUpperCase() })]),
      h("div", { class: "hide-collapsed", style: "min-width:0;overflow:hidden;" }, [
        h("div", { style: "font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", text: u.name }),
        h("div", { style: "font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", text: u.email })
      ])
    ]);
    profRow.addEventListener("click", openProfileModal);
    footer.appendChild(profRow);
    sb.appendChild(footer);

    return sb;
  }

  function renderSidebarList() {
    const scrollArea = qs("#sidebarScroll");
    if (!scrollArea) return;
    scrollArea.innerHTML = "";
    let list = chatBucket(state.sidebarTab);
    if (sidebarSearchQ.trim()) {
      const qy = sidebarSearchQ.toLowerCase();
      list = list.filter((c) => c.title.toLowerCase().includes(qy) || c.messages.some((m) => (m.content || "").toLowerCase().includes(qy)));
    }
    if (!list.length) {
      scrollArea.appendChild(h("div", { style: "padding:22px 10px;color:var(--text-dim);font-size:13px;text-align:center;", text: "Belum ada percakapan di sini." }));
      refreshIcons(); return;
    }
    const groups = groupByDate(list);
    [["today", t("today")], ["yesterday", t("yesterday")], ["earlier", t("earlier")]].forEach(([key, label]) => {
      if (!groups[key].length) return;
      scrollArea.appendChild(h("div", { class: "side-section-label hide-collapsed", text: label }));
      groups[key].forEach((c) => scrollArea.appendChild(renderChatItem(c)));
    });
    refreshIcons();
  }

  function renderChatItem(c) {
    const item = h("div", { class: "chat-item" + (c.id === state.activeChat ? " active" : ""), tabindex: "0", role: "button", "aria-label": c.title });
    item.appendChild(icon(c.pinned ? "pin" : "message-square", ""));
    item.appendChild(h("span", { class: "ci-title hide-collapsed", text: c.title }));
    const actions = h("div", { class: "ci-actions hide-collapsed" });
    const mk = (name, title, fn) => { const b = h("button", { title: title, "aria-label": title }, [icon(name)]); b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); return b; };
    if (!c.trashed) {
      actions.appendChild(mk("pin", "Pin", () => { c.pinned = !c.pinned; touchChat(c); render(); }));
      actions.appendChild(mk("pencil", "Ganti nama", () => renameChat(c)));
      actions.appendChild(mk("copy", "Duplikat", () => duplicateChat(c)));
      actions.appendChild(mk("archive", c.archived ? "Keluarkan dari arsip" : "Arsipkan", () => { c.archived = !c.archived; touchChat(c); render(); }));
      actions.appendChild(mk("trash-2", "Hapus", () => { c.trashed = true; touchChat(c); if (state.activeChat === c.id) state.activeChat = null; render(); }));
    } else {
      actions.appendChild(mk("rotate-ccw", "Pulihkan", () => { c.trashed = false; touchChat(c); render(); }));
      actions.appendChild(mk("x", "Hapus permanen", () => { delete state.chats[c.id]; saveChats(); render(); }));
    }
    item.appendChild(actions);
    item.addEventListener("click", () => { state.activeChat = c.id; state.mobileSidebarOpen = false; render(); });
    return item;
  }

  function renameChat(c) {
    const name = prompt("Nama percakapan:", c.title);
    if (name && name.trim()) { c.title = name.trim(); touchChat(c); render(); }
  }
  function duplicateChat(c) {
    const id = uid();
    state.chats[id] = Object.assign({}, c, { id, title: c.title + " (salinan)", pinned: false, createdAt: nowIso(), updatedAt: nowIso(), messages: JSON.parse(JSON.stringify(c.messages)) });
    saveChats(); state.activeChat = id; render();
  }

  /* ---------- Header ---------- */
  function renderHeader() {
    const header = h("div", { class: "topheader" });
    const mobileToggle = withRipple(h("button", { class: "icon-btn sidebar-toggle-mobile", "aria-label": "Buka sidebar" }, [icon("menu")]));
    mobileToggle.addEventListener("click", () => { state.mobileSidebarOpen = true; render(); });
    header.appendChild(mobileToggle);

    const chat = state.activeChat ? getChat(state.activeChat) : null;
    const titleWrap = h("div", { class: "th-title" }, [h("div", { class: "status-dot", title: t("online") })]);
    const titleSpan = h("span", { text: chat ? chat.title : "Nova" });
    titleWrap.appendChild(titleSpan);
    if (chat) {
      const editBtn = withRipple(h("button", { class: "icon-btn", style: "width:26px;height:26px;", "aria-label": "Ganti nama" }, [icon("pencil")]));
      editBtn.querySelector("svg") || (editBtn.style.width = "26px");
      editBtn.addEventListener("click", () => renameChat(chat));
      titleWrap.appendChild(editBtn);
    }
    header.appendChild(titleWrap);

    header.appendChild(h("div", { style: "flex:1" }));

    if (chat) {
      const modePill = h("button", { class: "model-pill" }, [icon(MODES.find((m) => m.id === chat.mode).icon), h("span", { text: MODES.find((m) => m.id === chat.mode).label })]);
      modePill.addEventListener("click", () => openModePicker(chat));
      header.appendChild(modePill);

      const searchBtn = withRipple(h("button", { class: "icon-btn", "aria-label": "Cari" }, [icon("search")]));
      searchBtn.addEventListener("click", openSearchModal);
      header.appendChild(searchBtn);

      const shareBtn = withRipple(h("button", { class: "icon-btn", "aria-label": "Bagikan" }, [icon("share-2")]));
      shareBtn.addEventListener("click", () => shareChat(chat));
      header.appendChild(shareBtn);

      const exportBtn = withRipple(h("button", { class: "icon-btn", "aria-label": "Ekspor" }, [icon("download")]));
      exportBtn.addEventListener("click", () => openExportMenu(chat, exportBtn));
      header.appendChild(exportBtn);

      const delBtn = withRipple(h("button", { class: "icon-btn", "aria-label": "Hapus" }, [icon("trash-2")]));
      delBtn.addEventListener("click", () => { if (confirm("Hapus percakapan ini?")) { chat.trashed = true; touchChat(chat); state.activeChat = null; render(); } });
      header.appendChild(delBtn);
    } else {
      const searchBtn = withRipple(h("button", { class: "icon-btn", "aria-label": "Cari" }, [icon("search")]));
      searchBtn.addEventListener("click", openSearchModal);
      header.appendChild(searchBtn);
    }

    const themeBtn = withRipple(h("button", { class: "icon-btn", "aria-label": "Ganti tema" }, [icon(state.settings.theme === "light" ? "moon" : "sun")]));
    themeBtn.addEventListener("click", () => { state.settings.theme = state.settings.theme === "light" ? "dark" : "light"; saveSettings(); render(); });
    header.appendChild(themeBtn);

    return header;
  }

  function openModePicker(chat) {
    const menu = h("div", { class: "overlay" });
    const card = h("div", { class: "modal", style: "max-width:320px;" });
    card.appendChild(h("div", { class: "modal-head" }, [h("h3", { text: "Mode AI" }), closeX(() => menu.remove())]));
    MODES.forEach((m) => {
      const row = h("button", { class: "settings-row", style: "width:100%;background:none;border:none;cursor:pointer;" }, [
        h("div", { style: "display:flex;align-items:center;gap:10px;" }, [icon(m.icon), h("span", { class: "sr-label", text: m.label })]),
        chat.mode === m.id ? icon("check") : null
      ]);
      row.addEventListener("click", () => { chat.mode = m.id; touchChat(chat); menu.remove(); render(); });
      card.appendChild(row);
    });
    menu.appendChild(card);
    menu.addEventListener("click", (e) => { if (e.target === menu) menu.remove(); });
    document.body.appendChild(menu);
    refreshIcons();
  }
  function closeX(fn) { const b = withRipple(h("button", { class: "icon-btn", "aria-label": "Tutup" }, [icon("x")])); b.addEventListener("click", fn); return b; }

  function chatAsText(chat) {
    return chat.messages.map((m) => (m.role === "user" ? "Kamu" : "Nova") + ":\n" + m.content + "\n").join("\n");
  }
  function shareChat(chat) {
    const text = chat.title + "\n\n" + chatAsText(chat);
    if (navigator.share) navigator.share({ title: chat.title, text: text }).catch(() => {});
    else { navigator.clipboard.writeText(text).then(() => toast("Percakapan disalin ke clipboard.")); }
  }
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function openExportMenu(chat, anchor) {
    const menu = h("div", { class: "overlay" });
    const card = h("div", { class: "modal", style: "max-width:300px;" });
    card.appendChild(h("div", { class: "modal-head" }, [h("h3", { text: "Ekspor percakapan" }), closeX(() => menu.remove())]));
    const opts = [
      ["TXT", () => downloadBlob(chat.title + ".txt", new Blob([chatAsText(chat)], { type: "text/plain" }))],
      ["Markdown", () => downloadBlob(chat.title + ".md", new Blob([chat.messages.map((m) => "**" + (m.role === "user" ? "Kamu" : "Nova") + "**\n\n" + m.content + "\n").join("\n---\n\n")], { type: "text/markdown" }))],
      ["PDF", () => exportPdf(chat)]
    ];
    opts.forEach(([label, fn]) => {
      const b = h("button", { class: "btn-secondary", style: "margin-bottom:8px;" }, [icon("file-down"), h("span", { text: "Ekspor sebagai " + label })]);
      b.addEventListener("click", () => { fn(); menu.remove(); });
      card.appendChild(b);
    });
    menu.appendChild(card);
    menu.addEventListener("click", (e) => { if (e.target === menu) menu.remove(); });
    document.body.appendChild(menu);
    refreshIcons();
  }
  function exportPdf(chat) {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const lines = doc.splitTextToSize(chatAsText(chat), 180);
      doc.setFontSize(14); doc.text(chat.title, 14, 16);
      doc.setFontSize(10); doc.text(lines, 14, 26);
      doc.save(chat.title + ".pdf");
    } catch (e) { toast("Gagal membuat PDF."); }
  }

  /* ---------- Chat area ---------- */
  const SUGGESTIONS = [
    { title: "Ringkas dokumen", sub: "Tempel teks panjang, minta ringkasannya", q: "Tolong ringkas teks berikut jadi 5 poin utama." },
    { title: "Bantu ngoding", sub: "Buatkan komponen atau perbaiki bug", q: "Buatkan aku halaman landing page sederhana dengan HTML, CSS, dan JS." },
    { title: "Brainstorm ide", sub: "Cari ide baru untuk proyek kamu", q: "Bantu aku brainstorming ide konten untuk minggu ini." },
    { title: "Terjemahkan", sub: "Ubah bahasa teks apa pun", q: "Terjemahkan paragraf berikut ke Bahasa Inggris yang natural." }
  ];

  function renderChatScroll() {
    const scroll = h("div", { class: "chat-scroll scroll-thin", id: "chatScroll" });
    const chat = state.activeChat ? getChat(state.activeChat) : null;
    if (!chat || !chat.messages.length) {
      scroll.appendChild(renderEmptyState(chat));
      return scroll;
    }
    const inner = h("div", { class: "chat-inner", id: "chatInner" });
    chat.messages.forEach((m, idx) => inner.appendChild(renderMessageRow(m, chat, idx)));
    scroll.appendChild(inner);
    return scroll;
  }

  function renderEmptyState(chat) {
    const wrap = h("div", { class: "empty-state" });
    wrap.appendChild(h("div", { class: "es-icon" }, [icon("sparkles")]));
    wrap.appendChild(h("h2", { style: "color:var(--text);margin:0;font-size:19px;font-weight:800;", text: t("emptyTitle") }));
    wrap.appendChild(h("p", { style: "margin:0;font-size:13.5px;max-width:340px;", text: t("emptySub") }));
    const grid = h("div", { class: "suggest-grid" });
    SUGGESTIONS.forEach((s) => {
      const card = h("button", { class: "suggest-card" }, [h("b", { text: s.title }), h("span", { text: s.sub })]);
      card.addEventListener("click", () => { if (!chat) newChat(); qs("#composerInput").value = s.q; autoResize(qs("#composerInput")); sendMessage(); });
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderMessageRow(m, chat, idx) {
    const row = h("div", { class: "msg-row " + m.role });
    if (m.role === "ai") row.appendChild(h("div", { class: "msg-avatar" }, [icon("sparkles")]));
    const col = h("div", { style: "display:flex;flex-direction:column;align-items:" + (m.role === "user" ? "flex-end" : "flex-start") + ";max-width:100%;gap:4px;" });

    if (m.attachments && m.attachments.length) {
      const strip = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;justify-content:" + (m.role === "user" ? "flex-end" : "flex-start") + ";" });
      m.attachments.forEach((a) => strip.appendChild(renderAttachmentChip(a, null)));
      col.appendChild(strip);
    }

    const bubble = h("div", { class: "bubble " + m.role });
    renderMarkdownInto(bubble, m.content || "");
    col.appendChild(bubble);

    if (m.role === "ai" && !m.streaming) {
      const actions = h("div", { class: "msg-actions" });
      const regenBtn = h("button", { title: "Mulai ulang jawaban", "aria-label": "Mulai ulang jawaban" }, [icon("rotate-ccw")]);
      regenBtn.addEventListener("click", () => regenerate(chat, idx));
      const copyBtn = h("button", { title: "Salin", "aria-label": "Salin" }, [icon("copy")]);
      copyBtn.addEventListener("click", () => { navigator.clipboard.writeText(m.content); toast("Disalin."); });
      const upBtn = h("button", { title: "Suka", "aria-label": "Suka" }, [icon("thumbs-up")]);
      upBtn.addEventListener("click", () => { upBtn.classList.toggle("active"); });
      const downBtn = h("button", { title: "Tidak suka", "aria-label": "Tidak suka" }, [icon("thumbs-down")]);
      downBtn.addEventListener("click", () => { downBtn.classList.toggle("active"); });
      actions.appendChild(regenBtn); actions.appendChild(copyBtn); actions.appendChild(upBtn); actions.appendChild(downBtn);
      col.appendChild(actions);
    }
    if (m.role === "user") {
      const actions = h("div", { class: "msg-actions" });
      const editBtn = h("button", { title: "Tulis ulang", "aria-label": "Tulis ulang" }, [icon("pencil")]);
      editBtn.addEventListener("click", () => { qs("#composerInput").value = m.content; autoResize(qs("#composerInput")); qs("#composerInput").focus(); });
      actions.appendChild(editBtn);
      col.appendChild(actions);
    }

    row.appendChild(col);
    return row;
  }

  function renderAttachmentChip(a, onRemove) {
    const chip = h("div", { class: "attach-chip" });
    if (a.dataUrl && a.type && a.type.startsWith("image/")) chip.appendChild(h("img", { src: a.dataUrl, alt: a.name }));
    else chip.appendChild(h("div", { class: "ac-icon" }, [icon(iconForFile(a.type))]));
    chip.appendChild(h("span", { class: "ac-name", text: a.name }));
    if (onRemove) { const rm = h("button", { class: "ac-remove", "aria-label": "Hapus lampiran" }, [icon("x")]); rm.addEventListener("click", onRemove); chip.appendChild(rm); }
    return chip;
  }
  function iconForFile(type) {
    if (!type) return "file";
    if (type.startsWith("image/")) return "image";
    if (type === "application/pdf") return "file-text";
    if (type.includes("zip")) return "file-archive";
    if (type.includes("json") || type.includes("csv")) return "table";
    return "file-code";
  }

  /* ---------- Markdown + code rendering ---------- */
  function renderMarkdownInto(container, raw) {
    container.innerHTML = "";
    let html;
    try { html = marked.parse(raw || "", { breaks: true, gfm: true }); } catch (e) { html = escapeHtml(raw); }
    const clean = window.DOMPurify ? DOMPurify.sanitize(html, { ADD_ATTR: ["target"] }) : html;
    const tmp = document.createElement("div");
    tmp.innerHTML = clean;
    // pull out <pre><code> blocks into rich code-cards
    qsa("pre", tmp).forEach((pre) => {
      const codeEl = pre.querySelector("code");
      if (!codeEl) return;
      const langMatch = (codeEl.className || "").match(/language-(\w+)/);
      const lang = langMatch ? langMatch[1] : "text";
      const codeCard = buildCodeCard(codeEl.textContent, lang);
      pre.replaceWith(codeCard);
    });
    while (tmp.firstChild) container.appendChild(tmp.firstChild);
    try { qsa("pre code", container).forEach((b) => hljs.highlightElement(b)); } catch (e) {}
  }

  function buildCodeCard(code, lang) {
    const card = h("div", { class: "code-card" });
    const head = h("div", { class: "cc-head" });
    head.appendChild(h("span", { class: "cc-lang", text: lang || "text" }));
    const actions = h("div", { class: "cc-actions" });
    const collapseBtn = h("button", { title: "Ciutkan", "aria-label": "Ciutkan blok kode" }, [icon("chevron-up")]);
    collapseBtn.addEventListener("click", () => { card.classList.toggle("collapsed"); collapseBtn.innerHTML = ""; collapseBtn.appendChild(icon(card.classList.contains("collapsed") ? "chevron-down" : "chevron-up")); refreshIcons(); });
    const copyBtn = h("button", { title: "Salin kode", "aria-label": "Salin kode" }, [icon("copy")]);
    copyBtn.addEventListener("click", () => { navigator.clipboard.writeText(code); toast("Kode disalin."); });
    const dlBtn = h("button", { title: "Unduh", "aria-label": "Unduh kode" }, [icon("download")]);
    dlBtn.addEventListener("click", () => downloadBlob("snippet." + extForLang(lang), new Blob([code], { type: "text/plain" })));
    actions.appendChild(collapseBtn); actions.appendChild(copyBtn); actions.appendChild(dlBtn);
    head.appendChild(actions);
    card.appendChild(head);
    const pre = h("pre", {});
    const table = h("table", { class: "cl" });
    code.replace(/\n$/, "").split("\n").forEach((line, i) => {
      const tr = h("tr", {});
      tr.appendChild(h("td", { class: "ln", text: String(i + 1) }));
      const codeCell = h("td", { class: "cd" });
      const codeEl = h("code", { class: "language-" + (lang || "text"), text: line || " " });
      codeCell.appendChild(codeEl);
      tr.appendChild(codeCell);
      table.appendChild(tr);
    });
    pre.appendChild(table);
    card.appendChild(pre);
    refreshIcons();
    return card;
  }
  function extForLang(lang) {
    const map = { javascript: "js", python: "py", html: "html", css: "css", json: "json", sql: "sql", bash: "sh", typescript: "ts", java: "java", c: "c", cpp: "cpp" };
    return map[(lang || "").toLowerCase()] || "txt";
  }

  function scrollChatToBottom(smooth) {
    const scroll = qs("#chatScroll");
    if (!scroll) return;
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  /* ---------- Composer ---------- */
  const ACCEPTED_TYPES = ".pdf,.docx,.txt,.html,.css,.js,.json,.csv,.zip,.png,.jpg,.jpeg,.webp";
  const MAX_FILE_MB = 15;

  function renderComposer() {
    const wrap = h("div", { class: "composer-wrap" });
    const box = h("div", { class: "composer", id: "composerBox" });

    if (state.activeChat) {
      const modeBar = h("div", { class: "mode-bar" });
      const chat = getChat(state.activeChat);
      MODES.forEach((m) => {
        const chip = h("button", { class: "mode-chip" + (chat.mode === m.id ? " active" : "") }, [icon(m.icon), h("span", { text: m.label })]);
        chip.addEventListener("click", () => { chat.mode = m.id; touchChat(chat); render(); });
        modeBar.appendChild(chip);
      });
      box.appendChild(modeBar);
    }

    if (state.pendingFiles.length) {
      const strip = h("div", { class: "attach-strip", id: "attachStrip" });
      state.pendingFiles.forEach((a, i) => {
        const chip = renderAttachmentChip(a, () => { state.pendingFiles.splice(i, 1); render(); });
        if (a.type && a.type.startsWith("image/") && a.dataUrl) { chip.style.cursor = "pointer"; chip.addEventListener("click", (e) => { if (e.target.closest(".ac-remove")) return; openImageTools(a); }); }
        strip.appendChild(chip);
      });
      box.appendChild(strip);
    }

    const row = h("div", { class: "composer-row" });
    const textarea = h("textarea", { id: "composerInput", rows: "1", placeholder: t("placeholder"), "aria-label": t("placeholder") });
    textarea.value = composerDraft;
    textarea.addEventListener("input", () => { composerDraft = textarea.value; autoResize(textarea); updateSendBtn(); });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); sendMessage(); }
      else if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); sendMessage(true); }
    });
    row.appendChild(textarea);

    const tools = h("div", { class: "composer-tools" });
    const fileInput = h("input", { type: "file", multiple: "multiple", accept: ACCEPTED_TYPES, style: "display:none;", id: "fileInput" });
    fileInput.addEventListener("change", (e) => handleFiles(e.target.files));
    const attachBtn = withRipple(h("button", { class: "icon-btn", title: "Lampirkan file", "aria-label": "Lampirkan file" }, [icon("paperclip")]));
    attachBtn.addEventListener("click", () => fileInput.click());

    const photoInput = h("input", { type: "file", accept: "image/*", style: "display:none;", id: "photoInput" });
    photoInput.addEventListener("change", (e) => handleFiles(e.target.files));
    const photoBtn = withRipple(h("button", { class: "icon-btn", title: "Unggah foto", "aria-label": "Unggah foto" }, [icon("image")]));
    photoBtn.addEventListener("click", () => photoInput.click());

    const cameraBtn = withRipple(h("button", { class: "icon-btn", title: "Kamera", "aria-label": "Kamera" }, [icon("camera")]));
    cameraBtn.addEventListener("click", openCameraModal);

    const micBtn = withRipple(h("button", { class: "icon-btn", title: "Input suara", "aria-label": "Input suara", id: "micBtn" }, [icon("mic")]));
    micBtn.addEventListener("click", toggleVoiceInput);

    tools.appendChild(fileInput); tools.appendChild(attachBtn);
    tools.appendChild(photoInput); tools.appendChild(photoBtn);
    tools.appendChild(cameraBtn);
    tools.appendChild(micBtn);

    const sendBtn = h("button", { class: "send-btn" + (state.streaming ? " stop" : ""), id: "sendBtn", "aria-label": state.streaming ? t("stop") : t("send") }, [icon(state.streaming ? "square" : "arrow-up")]);
    sendBtn.addEventListener("click", () => { state.streaming ? stopGenerate() : sendMessage(); });
    tools.appendChild(sendBtn);
    row.appendChild(tools);

    box.appendChild(row);
    wrap.appendChild(box);
    wrap.appendChild(h("div", { class: "composer-hint", text: "Enter kirim \u00b7 Shift+Enter baris baru \u00b7 Ctrl+Enter kirim paksa" }));

    // drag & drop
    ["dragover", "dragenter"].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add("dropzone-active"); }));
    ["dragleave", "drop"].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.remove("dropzone-active"); }));
    box.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

    setTimeout(() => { autoResize(textarea); updateSendBtn(); }, 0);
    return wrap;
  }

  let composerDraft = "";
  function autoResize(ta) { if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 180) + "px"; }
  function updateSendBtn() {
    const btn = qs("#sendBtn");
    if (!btn) return;
    btn.disabled = !state.streaming && !composerDraft.trim() && !state.pendingFiles.length;
  }

  /* ---------- File handling ---------- */
  function handleFiles(fileList) {
    Array.from(fileList).forEach((file) => {
      if (file.size > MAX_FILE_MB * 1024 * 1024) { toast(file.name + " terlalu besar (maks " + MAX_FILE_MB + "MB)."); return; }
      const att = { id: uid(), name: file.name, type: file.type || "application/octet-stream", size: file.size, dataUrl: null, textContent: null, progress: 0 };
      state.pendingFiles.push(att);
      render();
      const reader = new FileReader();
      reader.onprogress = (e) => { if (e.lengthComputable) { att.progress = Math.round((e.loaded / e.total) * 100); } };
      reader.onload = () => {
        att.progress = 100;
        if (file.type.startsWith("image/")) att.dataUrl = reader.result;
        else if (file.type.startsWith("text/") || /\.(txt|html|css|js|json|csv)$/i.test(file.name)) att.textContent = String(reader.result).slice(0, 20000);
        else att.dataUrl = null;
        render();
      };
      reader.onerror = () => toast("Gagal membaca " + file.name);
      if (file.type.startsWith("image/")) reader.readAsDataURL(file);
      else if (file.type.startsWith("text/") || /\.(txt|html|css|js|json|csv)$/i.test(file.name)) reader.readAsText(file);
      else reader.readAsDataURL(file);
    });
    qs("#fileInput") && (qs("#fileInput").value = "");
    qs("#photoInput") && (qs("#photoInput").value = "");
  }

  /* ---------- Voice input (Web Speech API) ---------- */
  let recognizer = null, listening = false;
  function toggleVoiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast("Browser ini tidak mendukung input suara.");
    if (listening) { recognizer.stop(); return; }
    recognizer = new SR();
    recognizer.lang = state.settings.lang === "en" ? "en-US" : "id-ID";
    recognizer.interimResults = false;
    recognizer.onstart = () => { listening = true; qs("#micBtn").style.color = "var(--danger)"; };
    recognizer.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      composerDraft = (composerDraft ? composerDraft + " " : "") + text;
      const ta = qs("#composerInput"); if (ta) { ta.value = composerDraft; autoResize(ta); }
      updateSendBtn();
    };
    recognizer.onend = () => { listening = false; const b = qs("#micBtn"); if (b) b.style.color = ""; };
    recognizer.onerror = () => { listening = false; toast("Input suara gagal / izin ditolak."); };
    recognizer.start();
  }

  /* ---------- Camera capture ---------- */
  function openCameraModal() {
    const overlay = h("div", { class: "overlay" });
    const card = h("div", { class: "modal", style: "max-width:420px;" });
    card.appendChild(h("div", { class: "modal-head" }, [h("h3", { text: "Ambil foto" }), closeX(() => { stopStream(); overlay.remove(); })]));
    const video = h("video", { autoplay: "autoplay", playsinline: "playsinline", style: "width:100%;border-radius:14px;background:#000;" });
    card.appendChild(video);
    const snapBtn = h("button", { class: "btn-primary", style: "margin-top:12px;", text: "Jepret" });
    card.appendChild(snapBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    let stream = null;
    function stopStream() { if (stream) stream.getTracks().forEach((tr) => tr.stop()); }
    navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { stream = s; video.srcObject = s; }).catch(() => { toast("Tidak bisa mengakses kamera."); overlay.remove(); });
    snapBtn.addEventListener("click", () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", .92);
      state.pendingFiles.push({ id: uid(), name: "kamera-" + Date.now() + ".jpg", type: "image/jpeg", size: 0, dataUrl, progress: 100 });
      stopStream(); overlay.remove(); render();
    });
  }

  /* ------------------------------ AI ENGINE ------------------------------ */
  // Model dipanggil langsung dari browser memakai API key milik pengguna sendiri
  // (diisi di Pengaturan > API Key). Tidak ada key rahasia yang ditanam di kode ini.
  const MODEL_FOR_MODE = {
    fast: "llama-3.1-8b-instant",
    thinking: "llama-3.3-70b-versatile",
    creative: "llama-3.3-70b-versatile",
    coding: "llama-3.3-70b-versatile",
    vision: "llama-3.2-11b-vision-preview"
  };
  const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

  function buildApiMessages(chat) {
    const sys = MODE_PROMPTS[chat.mode] || MODE_PROMPTS.fast;
    const msgs = [{ role: "system", content: sys }];
    chat.messages.slice(-16).forEach((m) => {
      if (m.role === "user") {
        const imgs = (m.attachments || []).filter((a) => a.type && a.type.startsWith("image/") && a.dataUrl);
        if (chat.mode === "vision" && imgs.length) {
          const content = [{ type: "text", text: m.content || "Tolong jelaskan gambar ini." }];
          imgs.forEach((im) => content.push({ type: "image_url", image_url: { url: im.dataUrl } }));
          msgs.push({ role: "user", content });
        } else {
          let text = m.content || "";
          (m.attachments || []).forEach((a) => {
            if (a.textContent) text += "\n\n[File: " + a.name + "]\n" + a.textContent.slice(0, 6000);
            else if (a.type && a.type.startsWith("image/")) text += "\n\n[Gambar terlampir: " + a.name + "]";
            else text += "\n\n[File terlampir: " + a.name + "]";
          });
          msgs.push({ role: "user", content: text });
        }
      } else if (m.role === "ai") {
        msgs.push({ role: "assistant", content: m.content });
      }
    });
    return msgs;
  }

  async function streamGroq(messages, modelId, onDelta) {
    if (!state.settings.apiKey) throw new Error("NO_KEY");
    state.abortCtrl = new AbortController();
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.settings.apiKey },
      body: JSON.stringify({ model: modelId, messages, temperature: 0.7, max_tokens: 2048, stream: true }),
      signal: state.abortCtrl.signal
    });
    if (!res.ok || !res.body) {
      let detail = "HTTP " + res.status;
      try { const j = await res.json(); if (j.error && j.error.message) detail = j.error.message; } catch (e) {}
      throw new Error(detail);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t2 = line.trim();
        if (!t2.startsWith("data:")) continue;
        const payload = t2.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) { full += delta; onDelta(full); }
        } catch (e) {}
      }
    }
    return full;
  }

  function stopGenerate() {
    if (state.abortCtrl) state.abortCtrl.abort();
  }

  async function sendMessage(force) {
    const ta = qs("#composerInput");
    const text = (composerDraft || "").trim();
    if (!text && !state.pendingFiles.length) return;
    if (state.streaming && !force) return;
    if (!state.activeChat) newChat();
    const chat = getChat(state.activeChat);

    const attachments = state.pendingFiles.map((a) => ({ id: a.id, name: a.name, type: a.type, dataUrl: a.dataUrl || null, textContent: a.textContent || null }));
    chat.messages.push({ role: "user", content: text, attachments, ts: nowIso() });
    if (chat.messages.length === 1) chat.title = text.slice(0, 42) || attachments[0].name;
    composerDraft = ""; state.pendingFiles = [];
    touchChat(chat);
    render();

    if (!state.settings.apiKey) {
      chat.messages.push({ role: "ai", content: "Sebelum ngobrol, isi dulu **API key** kamu di Pengaturan \u2192 API Key (pakai key Groq milikmu sendiri, gratis untuk daftar). Ini supaya key tidak pernah ditanam langsung di kode dan tetap aman.", ts: nowIso() });
      touchChat(chat); render(); openSettingsDrawer(); return;
    }

    chat.messages.push({ role: "ai", content: "", streaming: true, ts: nowIso() });
    state.streaming = true;
    render();
    scrollChatToBottom(true);

    const aiMsg = chat.messages[chat.messages.length - 1];
    const modelId = MODEL_FOR_MODE[chat.mode] || MODEL_FOR_MODE.fast;
    const showThinking = chat.mode === "thinking";
    const bubbleEl = () => qsa(".msg-row.ai").pop() && qsa(".msg-row.ai").pop().querySelector(".bubble");

    try {
      if (showThinking) { renderThinkingPill(); await new Promise((r) => setTimeout(r, 550)); }
      await streamGroq(buildApiMessages(chat), modelId, (partial) => {
        aiMsg.content = partial;
        const b = bubbleEl();
        if (b) { renderMarkdownInto(b, partial); scrollChatToBottom(false); }
      });
      aiMsg.streaming = false;
      touchChat(chat);
    } catch (err) {
      aiMsg.streaming = false;
      if (err.name === "AbortError") { aiMsg.content = aiMsg.content || "_(dihentikan)_"; }
      else if (err.message === "NO_KEY") { aiMsg.content = "API key belum diisi. Buka Pengaturan \u2192 API Key."; }
      else { aiMsg.content = "Maaf, Nova gagal terhubung ke server AI (" + err.message + "). Cek API key / koneksi lalu coba lagi."; }
      touchChat(chat);
    } finally {
      state.streaming = false;
      state.abortCtrl = null;
      render();
      scrollChatToBottom(true);
      if (state.settings.notifications && document.hidden) { try { new Notification("Nova", { body: "Jawaban baru sudah siap." }); } catch (e) {} }
    }
  }

  function renderThinkingPill() {
    const b = qsa(".msg-row.ai").pop() && qsa(".msg-row.ai").pop().querySelector(".bubble");
    if (b) { b.innerHTML = ""; const pill = h("span", { class: "thinking-pill" }, [h("span", { text: t("thinking") })]); b.appendChild(pill); }
  }

  async function regenerate(chat, idx) {
    if (state.streaming) return;
    // remove this ai message and everything after it stays removed too
    chat.messages.splice(idx, chat.messages.length - idx);
    chat.messages.push({ role: "ai", content: "", streaming: true, ts: nowIso() });
    touchChat(chat);
    state.streaming = true;
    render(); scrollChatToBottom(true);
    const aiMsg = chat.messages[chat.messages.length - 1];
    const modelId = MODEL_FOR_MODE[chat.mode] || MODEL_FOR_MODE.fast;
    const bubbleEl = () => qsa(".msg-row.ai").pop() && qsa(".msg-row.ai").pop().querySelector(".bubble");
    try {
      await streamGroq(buildApiMessages(chat), modelId, (partial) => { aiMsg.content = partial; const b = bubbleEl(); if (b) { renderMarkdownInto(b, partial); scrollChatToBottom(false); } });
      aiMsg.streaming = false; touchChat(chat);
    } catch (err) {
      aiMsg.streaming = false;
      aiMsg.content = err.name === "AbortError" ? "_(dihentikan)_" : "Maaf, gagal mengambil jawaban baru.";
      touchChat(chat);
    } finally {
      state.streaming = false; state.abortCtrl = null; render(); scrollChatToBottom(true);
    }
  }

  /* ------------------------------ SETTINGS DRAWER ------------------------------ */
  function switchEl(on, onToggle) {
    const b = h("button", { class: "switch" + (on ? " on" : ""), role: "switch", "aria-checked": on ? "true" : "false" }, [h("span", { class: "knob" })]);
    b.addEventListener("click", () => onToggle(b));
    return b;
  }

  function openSettingsDrawer() {
    closeDrawers();
    const overlay = h("div", { class: "overlay", id: "settingsOverlay", style: "justify-content:flex-end;align-items:stretch;padding:0;" });
    const drawer = h("div", { class: "side-drawer" });
    drawer.appendChild(h("div", { class: "drawer-head" }, [h("h3", { style: "margin:0;font-size:16px;font-weight:800;", text: t("settings") }), closeX(() => overlay.remove())]));
    const body = h("div", { class: "drawer-body scroll-thin" });

    // Theme & appearance
    const sec1 = h("div", { class: "settings-section" });
    sec1.appendChild(h("h4", { text: "Tampilan" }));
    const themeRow = h("div", { class: "settings-row" }, [h("span", { class: "sr-label", text: "Tema" })]);
    const themeSeg = h("div", { class: "seg", style: "width:170px;" });
    ["dark", "light"].forEach((th) => {
      const b = h("button", { class: state.settings.theme === th ? "active" : "", text: th === "dark" ? "Gelap" : "Terang" });
      b.addEventListener("click", () => { state.settings.theme = th; saveSettings(); applyThemeClass(); openSettingsDrawer(); });
      themeSeg.appendChild(b);
    });
    themeRow.appendChild(themeSeg); sec1.appendChild(themeRow);

    const contrastRow = h("div", { class: "settings-row" }, [
      h("div", [h("div", { class: "sr-label", text: "Kontras tinggi" }), h("div", { class: "sr-sub", text: "Untuk keterbacaan lebih baik" })])
    ]);
    contrastRow.appendChild(switchEl(state.settings.highContrast, () => { state.settings.highContrast = !state.settings.highContrast; saveSettings(); applyThemeClass(); openSettingsDrawer(); }));
    sec1.appendChild(contrastRow);

    const langRow = h("div", { class: "settings-row" }, [h("span", { class: "sr-label", text: "Bahasa" })]);
    const langSeg = h("div", { class: "seg", style: "width:130px;" });
    ["id", "en"].forEach((lg) => {
      const b = h("button", { class: state.settings.lang === lg ? "active" : "", text: lg.toUpperCase() });
      b.addEventListener("click", () => { state.settings.lang = lg; saveSettings(); render(); openSettingsDrawer(); });
      langSeg.appendChild(b);
    });
    langRow.appendChild(langSeg); sec1.appendChild(langRow);
    body.appendChild(sec1);

    // AI / API
    const sec2 = h("div", { class: "settings-section" });
    sec2.appendChild(h("h4", { text: "AI & API" }));
    body.appendChild(sec2);
    sec2.appendChild(h("label", { class: "field-label", text: "API Key (Groq)" }));
    const apiInput = h("input", { class: "field-input", type: "password", placeholder: "gsk_...", value: state.settings.apiKey });
    apiInput.addEventListener("change", () => { state.settings.apiKey = apiInput.value.trim(); saveSettings(); toast("API key disimpan di perangkat ini."); });
    sec2.appendChild(apiInput);
    sec2.appendChild(h("p", { style: "font-size:11.5px;color:var(--text-dim);margin:6px 0 0;", text: "Key disimpan hanya di browser kamu (localStorage) dan dipakai langsung dari browser ke penyedia AI. Tidak dikirim ke server lain." }));
    sec2.appendChild(h("label", { class: "field-label", text: "Model default" }));
    const modelSel = h("select", { class: "field-input" });
    MODES.forEach((m) => { const opt = h("option", { value: m.id, text: m.label }); if (state.settings.defaultModel === m.id) opt.selected = true; modelSel.appendChild(opt); });
    modelSel.addEventListener("change", () => { state.settings.defaultModel = modelSel.value; saveSettings(); });
    sec2.appendChild(modelSel);

    // Notifications & privacy
    const sec3 = h("div", { class: "settings-section" });
    sec3.appendChild(h("h4", { text: "Notifikasi & Privasi" }));
    const notifRow = h("div", { class: "settings-row" }, [
      h("div", [h("div", { class: "sr-label", text: "Notifikasi jawaban" }), h("div", { class: "sr-sub", text: "Butuh izin notifikasi browser" })])
    ]);
    notifRow.appendChild(switchEl(state.settings.notifications, async () => {
      if (!state.settings.notifications) {
        if (!("Notification" in window)) return toast("Browser tidak mendukung notifikasi.");
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return toast("Izin notifikasi ditolak.");
      }
      state.settings.notifications = !state.settings.notifications; saveSettings(); openSettingsDrawer();
    }));
    sec3.appendChild(notifRow);
    const privRow = h("button", { class: "settings-row", style: "width:100%;background:none;border:none;text-align:left;cursor:pointer;" }, [h("span", { class: "sr-label", text: "Kebijakan privasi" }), icon("chevron-right")]);
    privRow.addEventListener("click", () => toast("Semua data (akun demo, riwayat chat, API key) disimpan lokal di browser kamu, tidak diunggah ke server manapun."));
    sec3.appendChild(privRow);
    body.appendChild(sec3);

    // Shortcuts
    const sec4 = h("div", { class: "settings-section" });
    sec4.appendChild(h("h4", { text: "Pintasan Keyboard" }));
    [["Enter", "Kirim pesan"], ["Shift+Enter", "Baris baru"], ["Ctrl+Enter", "Kirim paksa"], ["Ctrl+K", "Cari percakapan"], ["Ctrl+/", "Chat baru"]].forEach(([k, d]) => {
      sec4.appendChild(h("div", { class: "settings-row" }, [h("span", { class: "sr-sub", text: d }), h("span", { class: "sr-label", style: "font-family:'JetBrains Mono',monospace;font-size:12px;", text: k })]));
    });
    body.appendChild(sec4);

    // Data management
    const sec5 = h("div", { class: "settings-section" });
    sec5.appendChild(h("h4", { text: "Kelola Data" }));
    const clearCacheBtn = h("button", { class: "btn-secondary", style: "margin-bottom:8px;" }, [icon("eraser"), h("span", { text: "Bersihkan cache" })]);
    clearCacheBtn.addEventListener("click", () => { toast("Cache dibersihkan."); });
    const delHistBtn = h("button", { class: "btn-secondary", style: "color:var(--danger);border-color:var(--danger);" }, [icon("trash-2"), h("span", { text: "Hapus semua riwayat" })]);
    delHistBtn.addEventListener("click", () => { if (confirm("Hapus semua percakapan? Tindakan ini tidak bisa dibatalkan.")) { userChats().forEach((c) => delete state.chats[c.id]); saveChats(); state.activeChat = null; overlay.remove(); render(); } });
    sec5.appendChild(clearCacheBtn); sec5.appendChild(delHistBtn);
    body.appendChild(sec5);

    const logoutBtn = h("button", { class: "btn-secondary", style: "color:var(--danger);border-color:var(--danger);margin-top:8px;" }, [icon("log-out"), h("span", { text: "Keluar" })]);
    logoutBtn.addEventListener("click", () => { overlay.remove(); logout(); });
    body.appendChild(logoutBtn);

    drawer.appendChild(body);
    overlay.appendChild(drawer);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    refreshIcons();
  }
  function closeDrawers() { qsa(".side-drawer").forEach((d) => d.closest(".overlay") && d.closest(".overlay").remove()); }

  /* ------------------------------ PROFILE MODAL ------------------------------ */
  function openProfileModal() {
    const u = currentUser();
    const overlay = h("div", { class: "overlay" });
    const card = h("div", { class: "modal" });
    card.appendChild(h("div", { class: "modal-head" }, [h("h3", { text: "Profil" }), closeX(() => overlay.remove())]));

    const avaWrap = h("div", { style: "display:flex;justify-content:center;margin-bottom:14px;" });
    const ava = h("div", { class: "avatar", style: "width:72px;height:72px;font-size:26px;cursor:pointer;" }, [u.avatar ? h("img", { src: u.avatar }) : h("span", { text: (u.name || "?").slice(0, 1).toUpperCase() })]);
    const avaInput = h("input", { type: "file", accept: "image/*", style: "display:none;" });
    avaInput.addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { u.avatar = reader.result; saveUsers(); overlay.remove(); openProfileModal(); render(); };
      reader.readAsDataURL(f);
    });
    ava.addEventListener("click", () => avaInput.click());
    avaWrap.appendChild(ava); avaWrap.appendChild(avaInput);
    card.appendChild(avaWrap);

    card.appendChild(h("label", { class: "field-label", text: "Nama" }));
    const nameInput = h("input", { class: "field-input", value: u.name });
    card.appendChild(nameInput);
    card.appendChild(h("label", { class: "field-label", text: "Email" }));
    card.appendChild(h("input", { class: "field-input", value: u.email, disabled: "disabled", style: "opacity:.6;" }));
    card.appendChild(h("label", { class: "field-label", text: "Bio" }));
    const bioInput = h("textarea", { class: "field-input", rows: "3", style: "resize:none;", text: u.bio || "" });
    card.appendChild(bioInput);

    const saveBtn = h("button", { class: "btn-primary", style: "margin-top:16px;", text: "Simpan" });
    saveBtn.addEventListener("click", () => { u.name = nameInput.value.trim() || u.name; u.bio = bioInput.value.trim(); saveUsers(); overlay.remove(); render(); toast("Profil disimpan."); });
    card.appendChild(saveBtn);

    overlay.appendChild(card);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    refreshIcons();
  }

  /* ------------------------------ SEARCH MODAL ------------------------------ */
  function openSearchModal() {
    const overlay = h("div", { class: "overlay", style: "align-items:flex-start;padding-top:80px;" });
    const card = h("div", { class: "modal wide" });
    card.appendChild(h("div", { class: "modal-head" }, [h("h3", { text: "Cari percakapan" }), closeX(() => overlay.remove())]));
    const input = h("input", { class: "field-input", placeholder: "Ketik kata kunci...", autofocus: "autofocus" });
    card.appendChild(input);
    const filterSeg = h("div", { class: "seg", style: "margin-top:10px;" });
    let filter = "all";
    [["all", "Semua"], ["today", "Hari ini"], ["week", "Minggu ini"], ["month", "Bulan ini"]].forEach(([id, label]) => {
      const b = h("button", { class: id === "all" ? "active" : "", text: label });
      b.addEventListener("click", () => { filter = id; qsa("button", filterSeg).forEach((x) => x.classList.remove("active")); b.classList.add("active"); runSearch(); });
      filterSeg.appendChild(b);
    });
    card.appendChild(filterSeg);
    const results = h("div", { style: "margin-top:14px;max-height:360px;overflow-y:auto;", class: "scroll-thin" });
    card.appendChild(results);

    function runSearch() {
      const qy = input.value.trim().toLowerCase();
      let list = userChats().filter((c) => !c.trashed);
      if (filter === "today") list = list.filter((c) => new Date(c.updatedAt).getTime() >= startOfToday());
      if (filter === "week") list = list.filter((c) => new Date(c.updatedAt).getTime() >= startOfWeek());
      if (filter === "month") list = list.filter((c) => new Date(c.updatedAt).getTime() >= startOfMonth());
      if (qy) list = list.filter((c) => c.title.toLowerCase().includes(qy) || c.messages.some((m) => (m.content || "").toLowerCase().includes(qy)));
      results.innerHTML = "";
      if (!list.length) { results.appendChild(h("div", { style: "padding:20px;text-align:center;color:var(--text-dim);font-size:13px;", text: "Tidak ada hasil." })); return; }
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).forEach((c) => {
        const row = h("button", { class: "chat-item", style: "width:100%;" }, [icon("message-square"), h("span", { class: "ci-title", text: c.title })]);
        row.addEventListener("click", () => { state.activeChat = c.id; overlay.remove(); render(); });
        results.appendChild(row);
        refreshIcons();
      });
    }
    input.addEventListener("input", debounce(runSearch, 120));
    runSearch();

    overlay.appendChild(card);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    refreshIcons();
    setTimeout(() => input.focus(), 30);
  }

  /* ------------------------------ IMAGE TOOLS MODAL ------------------------------ */
  function openImageTools(attachment) {
    const overlay = h("div", { class: "overlay" });
    const card = h("div", { class: "modal wide" });
    card.appendChild(h("div", { class: "modal-head" }, [h("h3", { text: "Alat Gambar" }), closeX(() => overlay.remove())]));
    const canvasWrap = h("div", { class: "imgtool-canvas-wrap" });
    const canvas = h("canvas", { style: "max-width:100%;max-height:100%;" });
    canvasWrap.appendChild(canvas);
    card.appendChild(canvasWrap);

    let rotation = 0, zoom = 1;
    const img = new Image();
    img.onload = draw;
    img.src = attachment.dataUrl;
    function draw() {
      const ctx = canvas.getContext("2d");
      const w = img.width, hh = img.height;
      canvas.width = 500; canvas.height = 300;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(zoom, zoom);
      const ratio = Math.min(canvas.width / w, canvas.height / hh);
      ctx.drawImage(img, (-w * ratio) / 2, (-hh * ratio) / 2, w * ratio, hh * ratio);
      ctx.restore();
    }
    const controls = h("div", { class: "imgtool-controls" });
    const mkBtn = (name, label, fn) => { const b = h("button", {}, [icon(name), h("span", { text: label })]); b.addEventListener("click", fn); return b; };
    controls.appendChild(mkBtn("zoom-in", "Perbesar", () => { zoom = Math.min(zoom + .2, 3); draw(); }));
    controls.appendChild(mkBtn("zoom-out", "Perkecil", () => { zoom = Math.max(zoom - .2, .3); draw(); }));
    controls.appendChild(mkBtn("rotate-cw", "Putar", () => { rotation = (rotation + 90) % 360; draw(); }));
    controls.appendChild(mkBtn("scan-text", "OCR (baca teks)", async () => {
      toast("Membaca teks dari gambar...");
      try {
        const { data } = await Tesseract.recognize(attachment.dataUrl, "eng+ind");
        const text = (data.text || "").trim() || "(tidak ada teks terbaca)";
        composerDraft = (composerDraft ? composerDraft + "\n\n" : "") + text;
        const ta = qs("#composerInput"); if (ta) { ta.value = composerDraft; autoResize(ta); }
        toast("Teks dari gambar ditambahkan ke kolom chat.");
      } catch (e) { toast("OCR gagal dijalankan."); }
    }));
    controls.appendChild(mkBtn("wand-2", "Caption otomatis", () => {
      composerDraft = (composerDraft ? composerDraft + " " : "") + "Tolong buatkan deskripsi/caption singkat untuk gambar ini.";
      const ta = qs("#composerInput"); if (ta) { ta.value = composerDraft; autoResize(ta); }
      toast("Ganti ke mode Vision lalu kirim supaya AI mendeskripsikan gambar.");
    }));
    card.appendChild(controls);
    card.appendChild(h("p", { style: "font-size:11.5px;color:var(--text-dim);margin-top:10px;", text: "Text-to-Image, penghapus latar, dan upscale butuh API/backend khusus yang belum dikonfigurasi di demo ini." }));

    overlay.appendChild(card);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    refreshIcons();
  }

  /* ------------------------------ GLOBAL KEYBOARD SHORTCUTS ------------------------------ */
  document.addEventListener("keydown", (e) => {
    if (!isLoggedIn()) return;
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (ctrlOrCmd && e.key.toLowerCase() === "k") { e.preventDefault(); openSearchModal(); }
    if (ctrlOrCmd && e.key === "/") { e.preventDefault(); newChat(); }
    if (e.key === "Escape") { qsa(".overlay").forEach((o) => o.remove()); }
  });

  /* ------------------------------ PWA ------------------------------ */
  function registerPWA() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; showInstallHint(deferredPrompt); });
  }
  function showInstallHint(deferredPrompt) {
    const bar = h("div", { class: "toast", style: "cursor:pointer;", text: "Instal Nova sebagai aplikasi \u2192" });
    bar.addEventListener("click", async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; bar.remove(); });
    qs("#toastHost").appendChild(bar);
    setTimeout(() => bar.remove(), 8000);
  }

  /* ------------------------------ BOOT ------------------------------ */
  function boot() {
    applyThemeClass();
    if (!isLoggedIn()) { renderAuth(); return; }
    ensureActiveChat();
    render();
    registerPWA();
  }

  boot();
})();
