// โครงหลักของแอป: เมนู, แดชบอร์ด, ล็อกอินผู้ดูแลระบบ (ผู้ใช้งานทั่วไปใช้เครื่องคำนวณได้เลยไม่ต้องล็อกอิน)
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const AppState = {
  user: null,
  profile: null,
};

// MENU: รายการที่ไม่ใส่ adminOnly = ผู้ใช้งานทั่วไปเห็นได้เลยโดยไม่ต้องล็อกอิน
// รายการที่มี children = หัวข้อหมวดหมู่ กดแล้วจะกาง/หุบเมนูย่อย (ไม่ใช่หน้าของตัวเอง)
const MENU = [
  { id: "dashboard", label: "แดชบอร์ด", adminOnly: true },
  {
    id: "gov-trip",
    label: "คำนวณค่าใช้จ่ายเดินทางไปราชการ",
    children: [
      { id: "gov-allowance-individual", label: "ค่าเบี้ยเลี้ยง (คนเดียว)" },
      { id: "gov-allowance-group", label: "ค่าเบี้ยเลี้ยง (หมู่คณะ)" },
      { id: "gov-lodging-individual", label: "ค่าที่พัก (คนเดียว)" },
      { id: "gov-lodging-group", label: "ค่าที่พัก (หมู่คณะ)" },
      { id: "gov-transport", label: "ค่าพาหนะ" },
    ],
  },
  { id: "training-trip", label: "คำนวณค่าใช้จ่ายเดินทางไปฝึกอบรม" },
  { id: "rates", label: "จัดการอัตราค่าใช้จ่าย", adminOnly: true },
];

const UI = {
  toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebarBackdrop").classList.toggle("active");
  },
  closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarBackdrop").classList.remove("active");
  },
  showView(id) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById("view-" + id).classList.add("active");
    document.querySelectorAll(".menu-item").forEach((m) => m.classList.toggle("active", m.dataset.id === id));
    const item = UI.findMenuItem(id);
    document.getElementById("pageTitle").textContent = item ? item.label : "หน้าแรก";
    UI.closeSidebar();
    if (id === "dashboard") Dashboard.load();
    if (id.startsWith("gov-")) GovTrip.onShowView(id);
    if (id === "rates") RatesAdmin.load();
  },
  // หาเมนู (รวมเมนูย่อยที่ซ้อนอยู่ใน children) จาก id — ใช้ตั้งชื่อหัวข้อบนสุดของหน้า
  findMenuItem(id) {
    for (const m of MENU) {
      if (m.id === id) return m;
      if (m.children) {
        const c = m.children.find((c) => c.id === id);
        if (c) return c;
      }
    }
    return null;
  },
  expandedMenus: new Set(),
  toggleSubmenu(menuId) {
    if (UI.expandedMenus.has(menuId)) UI.expandedMenus.delete(menuId);
    else UI.expandedMenus.add(menuId);
    UI.renderMenu();
    const activeView = document.querySelector(".view.active");
    if (activeView) {
      const activeId = activeView.id.replace("view-", "");
      document.querySelectorAll(".menu-item").forEach((m) => m.classList.toggle("active", m.dataset.id === activeId));
    }
  },
  toast(msg, isError) {
    Swal.fire({
      toast: true,
      position: "top-end",
      icon: isError ? "error" : "success",
      title: msg,
      showConfirmButton: false,
      timer: 3200,
      timerProgressBar: true,
      didOpen: (el) => {
        el.addEventListener("mouseenter", Swal.stopTimer);
        el.addEventListener("mouseleave", Swal.resumeTimer);
      },
    });
  },
  async confirmDialog({ title, html, confirmText = "ยืนยัน", danger = true }) {
    const result = await Swal.fire({
      icon: "warning",
      title,
      html,
      showCancelButton: true,
      confirmButtonText: confirmText,
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: danger ? "#c94430" : "#1c4c80",
      cancelButtonColor: "#8a9dae",
      reverseButtons: true,
      focusCancel: danger,
    });
    return result.isConfirmed;
  },
  // แสดงเฉพาะเมนูที่ไม่ใช่ adminOnly เสมอ ส่วนเมนูผู้ดูแลระบบโผล่มาก็ต่อเมื่อล็อกอินเป็น admin แล้วเท่านั้น
  renderMenu() {
    const isAdmin = AppState.profile && AppState.profile.role === "admin";
    const el = document.getElementById("menuList");
    el.innerHTML = MENU.filter((m) => !m.adminOnly || isAdmin)
      .map((m) => UI.renderMenuItem(m))
      .join("");
  },
  // เมนูที่มี children = หัวข้อหมวดหมู่ (กางเป็นเมนูย่อยอีกชั้น ไม่ใช่หน้าของตัวเอง)
  renderMenuItem(m) {
    if (!m.children) {
      return `<div class="menu-item" data-id="${m.id}" onclick="UI.showView('${m.id}')"><span class="menu-label">${m.label}</span></div>`;
    }
    const isOpen = UI.expandedMenus.has(m.id);
    return `
      <div class="menu-item has-children ${isOpen ? "expanded" : ""}" onclick="UI.toggleSubmenu('${m.id}')">
        <span class="menu-label">${m.label}</span><span class="menu-caret">›</span>
      </div>
      <div class="submenu ${isOpen ? "open" : ""}">
        ${m.children.map((c) => `<div class="menu-item sub" data-id="${c.id}" onclick="event.stopPropagation();UI.showView('${c.id}')"><span class="menu-label">${c.label}</span></div>`).join("")}
      </div>`;
  },
  // อัปเดตปุ่ม/ป้ายมุมขวาบนและเมนู ให้ตรงกับสถานะล็อกอินปัจจุบัน
  updateAuthUI() {
    const isLoggedIn = !!AppState.profile;
    document.getElementById("adminLoginBtn").style.display = isLoggedIn ? "none" : "";
    document.getElementById("adminLogoutBtn").style.display = isLoggedIn ? "" : "none";
    const badge = document.getElementById("adminBadge");
    if (isLoggedIn) {
      badge.style.display = "";
      badge.textContent = `${AppState.profile.full_name} (${AppState.profile.role === "admin" ? "ผู้ดูแลระบบ" : "เจ้าหน้าที่"})`;
    } else {
      badge.style.display = "none";
    }
    document.getElementById("whoAmI").textContent = isLoggedIn
      ? `${AppState.profile.full_name} (${AppState.profile.role === "admin" ? "ผู้ดูแลระบบ" : "เจ้าหน้าที่"})`
      : "ผู้ใช้งานทั่วไป";
    UI.renderMenu();
    // ถ้ากำลังอยู่หน้าที่ต้องเป็นแอดมิน แล้วออกจากระบบไป ให้พากลับหน้าแรก
    const activeView = document.querySelector(".view.active");
    const activeId = activeView ? activeView.id.replace("view-", "") : null;
    const activeMenuItem = MENU.find((m) => m.id === activeId);
    if (activeMenuItem && activeMenuItem.adminOnly && !isLoggedIn) UI.showView("home");
  },
};

const Auth = {
  // ระบบนี้ไม่มีหน้าสมัครสมาชิก/ล็อกอินแยก ใช้กล่องโต้ตอบ (modal) แทน เพราะผู้ใช้งานทั่วไปไม่ต้องล็อกอิน
  // มีแต่ผู้ดูแลระบบที่กดปุ่มมุมขวาบนเพื่อล็อกอินเข้ามาเป็นครั้งคราว
  async openLogin() {
    const { value: creds } = await Swal.fire({
      title: "เข้าสู่ระบบผู้ดูแลระบบ",
      html: `
        <div class="field" style="text-align:left;"><label>อีเมล</label><input id="swalEmail" type="email" placeholder="name@example.com"/></div>
        <div class="field" style="text-align:left;margin-bottom:0;"><label>รหัสผ่าน</label><input id="swalPassword" type="password" placeholder="••••••••"/></div>
      `,
      confirmButtonText: "เข้าสู่ระบบ",
      confirmButtonColor: "#1c4c80",
      showCancelButton: true,
      cancelButtonText: "ยกเลิก",
      focusConfirm: false,
      preConfirm: () => {
        const email = document.getElementById("swalEmail").value.trim();
        const password = document.getElementById("swalPassword").value;
        if (!email || !password) {
          Swal.showValidationMessage("กรุณากรอกอีเมลและรหัสผ่าน");
          return false;
        }
        return { email, password };
      },
    });
    if (!creds) return;
    const { error } = await sb.auth.signInWithPassword(creds);
    if (error) return UI.toast("เข้าสู่ระบบไม่สำเร็จ: อีเมลหรือรหัสผ่านไม่ถูกต้อง", true);
    await Auth.loadProfile();
    UI.toast("เข้าสู่ระบบเรียบร้อยแล้ว");
  },

  async logout() {
    await sb.auth.signOut();
    AppState.user = null;
    AppState.profile = null;
    UI.updateAuthUI();
  },

  // โหลดโปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่ (ถ้ามี) แล้วอัปเดตหน้าจอ — เรียกตอนเปิดหน้าเว็บและตอนล็อกอินสำเร็จ
  async loadProfile() {
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) {
      AppState.user = null;
      AppState.profile = null;
      UI.updateAuthUI();
      return;
    }
    AppState.user = session.user;
    const { data: profile } = await sb.from("profiles").select("full_name,role").eq("id", session.user.id).single();
    AppState.profile = profile || null;
    UI.updateAuthUI();
  },
};

// ไอคอนเส้น (outline) แบบเรียบง่าย วาดเองด้วย SVG ไม่พึ่งไลบรารีไอคอนภายนอก
const DASH_ICONS = {
  briefcase: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><rect height="13" rx="2" width="20" x="2" y="7"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  calendar: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><rect height="16" rx="2" width="18" x="3" y="5"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  users: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  clock: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
};

const TRIP_TYPE_LABEL = { government: "ไปราชการ", training: "ฝึกอบรม" };
const TRIP_STATUS_LABEL = { draft: "ฉบับร่าง", pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ" };
const TRIP_STATUS_BADGE = { draft: "badge-gray", pending: "badge-amber", approved: "badge-green", rejected: "badge-red" };

const Dashboard = {
  async load() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
    const name = AppState.profile ? AppState.profile.full_name : "";
    document.getElementById("dashGreeting").innerHTML = `
      <div class="dash-hello">${greeting}${name ? ", " + escapeHtml(name) : ""}</div>
      <div class="dash-date">${new Date().toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>`;

    const el = document.getElementById("dashStats");
    el.innerHTML = '<div class="card">กำลังโหลด...</div>';

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [{ count: totalTrips }, { count: monthTrips }, { count: pendingTrips }, { data: trips }] = await Promise.all([
      sb.from("trips").select("*", { count: "exact", head: true }),
      sb.from("trips").select("*", { count: "exact", head: true }).gte("start_date", startOfMonth.toISOString().slice(0, 10)),
      sb.from("trips").select("*", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("trips").select("id,title,trip_type,mode,start_date,end_date,status").order("created_at", { ascending: false }).limit(6),
    ]);

    let totalPeople = 0;
    if (trips && trips.length) {
      const { count } = await sb.from("trip_members").select("*", { count: "exact", head: true }).in("trip_id", trips.map((t) => t.id));
      totalPeople = count || 0;
    }

    const stats = [
      { label: "ทริปทั้งหมด", num: (totalTrips || 0).toLocaleString("th-TH"), grad: "var(--grad-1)", icon: DASH_ICONS.briefcase },
      { label: "ทริปเดือนนี้", num: (monthTrips || 0).toLocaleString("th-TH"), grad: "var(--grad-2)", icon: DASH_ICONS.calendar },
      { label: "ผู้เดินทางในทริปล่าสุด", num: totalPeople.toLocaleString("th-TH"), grad: "var(--grad-3)", icon: DASH_ICONS.users },
      { label: "รออนุมัติ", num: (pendingTrips || 0).toLocaleString("th-TH"), grad: "var(--grad-4)", icon: DASH_ICONS.clock },
    ];
    el.innerHTML = stats
      .map((s) => `<div class="stat-card" style="background:${s.grad}"><div class="stat-icon">${s.icon}</div><div class="stat-num">${s.num}</div><div class="stat-label">${s.label}</div></div>`)
      .join("");

    const tbody = document.querySelector("#dashTripsTable tbody");
    if (!trips || trips.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-soft);">ยังไม่มีทริป</td></tr>';
      return;
    }
    tbody.innerHTML = trips
      .map(
        (t) => `<tr>
        <td>${escapeHtml(t.title)}</td>
        <td>${TRIP_TYPE_LABEL[t.trip_type] || t.trip_type} (${t.mode === "group" ? "หมู่คณะ" : "รายบุคคล"})</td>
        <td>${new Date(t.start_date).toLocaleDateString("th-TH")}${t.end_date && t.end_date !== t.start_date ? " - " + new Date(t.end_date).toLocaleDateString("th-TH") : ""}</td>
        <td>-</td>
        <td><span class="badge ${TRIP_STATUS_BADGE[t.status] || "badge-gray"}">${TRIP_STATUS_LABEL[t.status] || t.status}</span></td>
      </tr>`
      )
      .join("");
  },
};

async function boot() {
  // หน้าเว็บใช้งานได้ทันทีโดยไม่ต้องล็อกอิน — แค่เช็คว่ามี session แอดมินค้างอยู่ไหม (เช่น รีเฟรชหน้า)
  // แล้วอัปเดตปุ่ม/เมนูให้ตรงสถานะ ไม่ได้บล็อกการแสดงผลของหน้าแรกเลย
  UI.renderMenu();
  await Auth.loadProfile();
}

document.addEventListener("DOMContentLoaded", boot);
