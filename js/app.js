// โครงหลักของแอป: ล็อกอิน, เมนู, แดชบอร์ด
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const AppState = {
  user: null,
  profile: null,
};

const MENU = [
  { id: "dashboard", label: "แดชบอร์ด" },
  { id: "gov-trip", label: "คำนวณค่าใช้จ่ายเดินทางไปราชการ" },
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
    const item = MENU.find((m) => m.id === id);
    document.getElementById("pageTitle").textContent = item ? item.label : "";
    UI.closeSidebar();
    if (id === "dashboard") Dashboard.load();
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
  renderMenu() {
    const isAdmin = AppState.profile && AppState.profile.role === "admin";
    const el = document.getElementById("menuList");
    el.innerHTML = MENU.filter((m) => !m.adminOnly || isAdmin)
      .map((m) => `<div class="menu-item" data-id="${m.id}" onclick="UI.showView('${m.id}')"><span class="menu-label">${m.label}</span></div>`)
      .join("");
  },
};

const Auth = {
  showError(msg) {
    const el = document.getElementById("authError");
    el.textContent = msg;
    el.classList.add("show");
  },
  clearError() {
    document.getElementById("authError").classList.remove("show");
  },
  async login() {
    Auth.clearError();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!email || !password) return Auth.showError("กรุณากรอกอีเมลและรหัสผ่าน");
    const btn = document.getElementById("authSubmitBtn");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) return Auth.showError("เข้าสู่ระบบไม่สำเร็จ: อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    await boot();
  },
  async logout() {
    await sb.auth.signOut();
    AppState.user = null;
    AppState.profile = null;
    document.getElementById("authScreen").style.display = "flex";
    document.getElementById("app").style.display = "none";
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
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-soft);">ยังไม่มีทริป — เริ่มที่เมนู "คำนวณค่าใช้จ่ายเดินทางไปราชการ" หรือ "...ไปฝึกอบรม"</td></tr>';
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
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) {
    document.getElementById("authScreen").style.display = "flex";
    document.getElementById("app").style.display = "none";
    return;
  }
  AppState.user = session.user;
  const { data: profile } = await sb.from("profiles").select("full_name,role").eq("id", session.user.id).single();
  AppState.profile = profile;

  if (!profile) {
    await sb.auth.signOut();
    document.getElementById("authScreen").style.display = "flex";
    document.getElementById("app").style.display = "none";
    Auth.showError("ไม่พบบัญชีผู้ใช้นี้ในระบบ กรุณาติดต่อผู้ดูแลระบบ");
    return;
  }

  document.getElementById("whoAmI").textContent = `${profile.full_name} (${profile.role === "admin" ? "ผู้ดูแลระบบ" : "เจ้าหน้าที่"})`;

  document.getElementById("authScreen").style.display = "none";
  document.getElementById("app").style.display = "flex";
  UI.renderMenu();
  UI.showView("dashboard");
}

document.addEventListener("DOMContentLoaded", boot);
