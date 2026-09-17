// เครื่องคำนวณค่าใช้จ่ายเดินทางไปราชการ: ค่าเบี้ยเลี้ยง / ค่าที่พัก / ค่าพาหนะ (รายบุคคล + หมู่คณะ)
// ใช้งานได้โดยไม่ต้องล็อกอิน — อ่านอัตราจากตาราง position_levels/rate_settings ที่เปิดอ่านสาธารณะไว้

// แสดง "ที่มาของผลคำนวณ" เป็นกล่องอธิบายขั้นตอน ต่อจากรายละเอียดผลลัพธ์
function renderCalcExplain(breakdown, formula) {
  return `
    <div class="calc-explain">
      <div class="calc-explain-title">ที่มาของผลคำนวณ</div>
      <ol>${breakdown.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>
      ${formula ? `<div class="calc-explain-formula">${escapeHtml(formula)}</div>` : ""}
    </div>
  `;
}

const RateEngine = {
  positionLevels: null,
  rates: null,

  async ensureLoaded() {
    if (this.positionLevels && this.rates) return;
    await this.reload();
  },

  // โหลดข้อมูลอัตรา/ระดับตำแหน่งใหม่จากฐานข้อมูลเสมอ (ใช้หลังแอดมินเพิ่มอัตราใหม่ในเมนูจัดการอัตรา)
  async reload() {
    const [{ data: levels }, { data: rateRows }] = await Promise.all([
      sb.from("position_levels").select("id,name,sort_order").order("sort_order"),
      sb.from("rate_settings").select("rate_type,position_level_id,room_type,transport_type,value,effective_date").order("effective_date", { ascending: false }),
    ]);
    this.positionLevels = levels || [];
    this.rates = rateRows || [];
  },

  // หาแถวอัตราล่าสุดที่ effective_date ไม่เกินวันนี้ ตรงเงื่อนไขที่กำหนด (ถ้าปรับอัตราใหม่ในอนาคต จะเลือกอัตราที่ใช้อยู่จริง ณ วันนี้เสมอ)
  findRateRow(rateType, { positionLevelId = null, roomType = null, transportType = null } = {}) {
    const today = new Date().toISOString().slice(0, 10);
    return (
      this.rates.find(
        (r) =>
          r.rate_type === rateType &&
          r.effective_date <= today &&
          (positionLevelId === null || r.position_level_id === positionLevelId) &&
          (roomType === null || r.room_type === roomType) &&
          (transportType === null || r.transport_type === transportType)
      ) || null
    );
  },

  findRate(rateType, opts) {
    const row = this.findRateRow(rateType, opts);
    return row ? Number(row.value) : null;
  },

  positionName(id) {
    const p = this.positionLevels.find((p) => p.id === id);
    return p ? p.name : "-";
  },

  fmt(n) {
    return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  async populatePositionSelect(selectEl) {
    await this.ensureLoaded();
    if (selectEl.dataset.filled) return;
    selectEl.innerHTML = this.positionLevels.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
    selectEl.dataset.filled = "1";
  },

  // นับจำนวนวันเพื่อคำนวณเบี้ยเลี้ยง ตามข้อ 17 ของระเบียบกระทรวงมหาดไทยฯ
  // พักแรม: ทุก 24 ชม. = 1 วัน เศษที่เกิน 12 ชม. นับเพิ่มอีก 1 วัน (เศษไม่เกิน 12 ชม. ปัดทิ้ง)
  // ไม่พักแรม: เกิน 12 ชม. (แต่ไม่ถึง 24) = 1 วัน, เกิน 6 ถึง 12 ชม. = ครึ่งวัน, ไม่เกิน 6 ชม. = ไม่มีสิทธิ
  calcAllowanceDays(departureAt, returnAt, isOvernight) {
    return this.calcAllowanceDaysDetailed(departureAt, returnAt, isOvernight).days;
  },

  // เหมือน calcAllowanceDays แต่คืนขั้นตอนการคำนวณเป็นข้อความด้วย เพื่อแสดง "ที่มาของผลคำนวณ" ให้ผู้ใช้เห็น
  calcAllowanceDaysDetailed(departureAt, returnAt, isOvernight) {
    const totalHours = (returnAt - departureAt) / 3600000;
    const fmtH = (h) => h.toLocaleString("th-TH", { maximumFractionDigits: 1 }) + " ชั่วโมง";
    if (totalHours <= 0) return { days: 0, breakdown: ["ช่วงเวลาเดินทางไม่ถูกต้อง"] };

    const breakdown = [`ระยะเวลาเดินทางทั้งหมด ${fmtH(totalHours)} (${isOvernight ? "มีการพักแรม" : "ไม่มีการพักแรม"})`];
    let days;

    if (isOvernight || totalHours > 24) {
      const fullDays = Math.floor(totalHours / 24);
      const remainder = totalHours - fullDays * 24;
      const extra = remainder > 12 ? 1 : !isOvernight && remainder > 6 ? 0.5 : 0;
      days = fullDays + extra;
      if (fullDays > 0) breakdown.push(`ครบ 24 ชั่วโมง จำนวน ${fullDays} รอบ = ${fullDays} วัน`);
      if (remainder > 0) {
        breakdown.push(
          extra === 1
            ? `เศษเวลา ${fmtH(remainder)} มากกว่า 12 ชั่วโมง → นับเพิ่มอีก 1 วัน`
            : extra === 0.5
              ? `เศษเวลา ${fmtH(remainder)} เกิน 6 ถึง 12 ชั่วโมง (ไม่พักแรม) → นับเพิ่มครึ่งวัน`
              : `เศษเวลา ${fmtH(remainder)} ไม่เกิน 12 ชั่วโมง → ไม่นับเพิ่ม`
        );
      }
    } else if (totalHours > 12) {
      days = 1;
      breakdown.push("ไม่พักแรม และเกิน 12 ชั่วโมง → นับเป็น 1 วันเต็ม");
    } else if (totalHours > 6) {
      days = 0.5;
      breakdown.push("ไม่พักแรม เกิน 6 ถึง 12 ชั่วโมง → นับเป็นครึ่งวัน");
    } else {
      days = 0;
      breakdown.push("ไม่พักแรม และไม่เกิน 6 ชั่วโมง → ไม่มีสิทธิได้รับเบี้ยเลี้ยง");
    }

    return { days, breakdown };
  },
};

const GovTrip = {
  async onShowView(id) {
    await RateEngine.ensureLoaded();
    if (id === "gov-allowance-individual") {
      await RateEngine.populatePositionSelect(document.getElementById("gaiPosition"));
    } else if (id === "gov-allowance-group") {
      const container = document.getElementById("gagRows");
      if (!container.children.length) {
        GovTrip.addAllowanceGroupRow();
        GovTrip.addAllowanceGroupRow();
      }
    } else if (id === "gov-lodging-individual") {
      await RateEngine.populatePositionSelect(document.getElementById("gliPosition"));
      GovTrip.onLodgingModeChange("gli");
    } else if (id === "gov-lodging-group") {
      const container = document.getElementById("glgRows");
      if (!container.children.length) {
        GovTrip.addLodgingGroupRow();
        GovTrip.addLodgingGroupRow();
      }
      GovTrip.onLodgingModeChange("glg");
    }
  },

  // ---------- ค่าเบี้ยเลี้ยง: รายบุคคล ----------
  calcAllowanceIndividual() {
    const positionId = document.getElementById("gaiPosition").value;
    const departure = new Date(document.getElementById("gaiDeparture").value);
    const ret = new Date(document.getElementById("gaiReturn").value);
    const overnight = document.getElementById("gaiOvernight").checked;
    if (isNaN(departure) || isNaN(ret)) return UI.toast("กรุณากรอกวันเวลาออกเดินทางและเดินทางกลับ", true);
    if (ret <= departure) return UI.toast("วันเวลาเดินทางกลับต้องอยู่หลังวันเวลาออกเดินทาง", true);

    const { days, breakdown } = RateEngine.calcAllowanceDaysDetailed(departure, ret, overnight);
    const rate = RateEngine.findRate("daily_allowance", { positionLevelId: positionId });
    if (rate === null) return UI.toast("ไม่พบอัตราเบี้ยเลี้ยงสำหรับระดับตำแหน่งนี้", true);
    const total = days * rate;

    document.getElementById("gaiResult").innerHTML = `
      <div class="result-box">
        <div class="result-row"><span>ระดับตำแหน่ง</span><span>${escapeHtml(RateEngine.positionName(positionId))}</span></div>
        <div class="result-row"><span>จำนวนวันที่คำนวณได้</span><span>${days} วัน</span></div>
        <div class="result-row"><span>อัตราต่อวัน</span><span>${RateEngine.fmt(rate)} บาท</span></div>
      </div>
      <div class="result-total"><span>รวมค่าเบี้ยเลี้ยง</span><span class="amt">${RateEngine.fmt(total)} บาท</span></div>
      ${renderCalcExplain(breakdown, `${days} วัน × ${RateEngine.fmt(rate)} บาท/วัน = ${RateEngine.fmt(total)} บาท`)}
    `;
  },

  // ---------- ค่าเบี้ยเลี้ยง: หมู่คณะ ----------
  addAllowanceGroupRow() {
    const container = document.getElementById("gagRows");
    const row = document.createElement("div");
    row.className = "mapping-row gov-allowance-row";
    row.innerHTML = `
      <input class="gag-name" placeholder="ชื่อ-สกุล"/>
      <select class="gag-position"></select>
      <button class="btn btn-ghost btn-sm" type="button">✕</button>
    `;
    RateEngine.populatePositionSelect(row.querySelector(".gag-position"));
    row.querySelector("button").addEventListener("click", () => row.remove());
    container.appendChild(row);
  },

  calcAllowanceGroup() {
    const departure = new Date(document.getElementById("gagDeparture").value);
    const ret = new Date(document.getElementById("gagReturn").value);
    const overnight = document.getElementById("gagOvernight").checked;
    if (isNaN(departure) || isNaN(ret)) return UI.toast("กรุณากรอกวันเวลาออกเดินทางและเดินทางกลับ", true);
    if (ret <= departure) return UI.toast("วันเวลาเดินทางกลับต้องอยู่หลังวันเวลาออกเดินทาง", true);
    const { days, breakdown } = RateEngine.calcAllowanceDaysDetailed(departure, ret, overnight);

    const rows = Array.from(document.querySelectorAll("#gagRows .gov-allowance-row"));
    if (rows.length === 0) return UI.toast("กรุณาเพิ่มรายชื่อผู้เดินทางอย่างน้อย 1 คน", true);

    let grandTotal = 0;
    const lines = rows.map((row) => {
      const name = row.querySelector(".gag-name").value.trim() || "(ไม่ระบุชื่อ)";
      const positionId = row.querySelector(".gag-position").value;
      const rate = RateEngine.findRate("daily_allowance", { positionLevelId: positionId }) || 0;
      const total = rate * days;
      grandTotal += total;
      return { name, positionName: RateEngine.positionName(positionId), rate, total };
    });

    document.getElementById("gagResult").innerHTML = `
      <div class="table-scroll"><table><thead><tr><th>ชื่อ-สกุล</th><th>ระดับตำแหน่ง</th><th>จำนวนวัน</th><th>อัตรา/วัน</th><th>รวม</th></tr></thead><tbody>
        ${lines
          .map(
            (l) => `<tr>
          <td>${escapeHtml(l.name)}</td><td>${escapeHtml(l.positionName)}</td><td>${days}</td>
          <td>${RateEngine.fmt(l.rate)}</td><td>${RateEngine.fmt(l.total)}</td>
        </tr>`
          )
          .join("")}
      </tbody></table></div>
      <div class="result-total" style="margin-top:12px;"><span>รวมค่าเบี้ยเลี้ยงทั้งคณะ (${lines.length} คน)</span><span class="amt">${RateEngine.fmt(grandTotal)} บาท</span></div>
      ${renderCalcExplain(breakdown, `จำนวนวันที่คำนวณได้ (ใช้กำหนดการเดียวกันทั้งคณะ) = ${days} วัน`)}
    `;
  },

  // ---------- ค่าที่พัก: สลับแสดงช่องกรอกตามวิธีเบิก (จ่ายจริง/เหมาจ่าย) ----------
  onLodgingModeChange(prefix) {
    const mode = document.getElementById(prefix + "Mode").value;
    if (prefix === "gli") {
      document.getElementById("gliActualFields").style.display = mode === "actual" ? "" : "none";
    } else if (prefix === "glg") {
      document.getElementById("glgRows").classList.toggle("lump-mode", mode === "lump_sum");
    }
  },

  // ---------- ค่าที่พัก: รายบุคคล ----------
  calcLodgingIndividual() {
    const positionId = document.getElementById("gliPosition").value;
    const nights = Number(document.getElementById("gliNights").value) || 0;
    const mode = document.getElementById("gliMode").value;
    if (nights <= 0) return UI.toast("กรุณากรอกจำนวนคืน", true);

    let rate, total;
    const detailRows = [];
    if (mode === "lump_sum") {
      rate = RateEngine.findRate("lodging_lump_sum", { positionLevelId: positionId });
      if (rate === null) return UI.toast("ไม่พบอัตราที่พักเหมาจ่ายสำหรับระดับตำแหน่งนี้", true);
      total = rate * nights;
      detailRows.push(["วิธีเบิก", "เหมาจ่าย"], ["อัตราต่อคืน", RateEngine.fmt(rate) + " บาท"]);
    } else {
      const roomType = document.getElementById("gliRoomType").value;
      const cap = RateEngine.findRate(roomType === "single" ? "lodging_single" : "lodging_double", { positionLevelId: positionId });
      if (cap === null) return UI.toast("ไม่พบเพดานอัตราที่พักสำหรับระดับตำแหน่งนี้", true);
      const actualPerNight = Number(document.getElementById("gliActualAmount").value) || 0;
      rate = Math.min(actualPerNight, cap);
      total = rate * nights;
      detailRows.push(
        ["วิธีเบิก", "จ่ายจริง (" + (roomType === "single" ? "ห้องเดี่ยว" : "ห้องคู่") + ")"],
        ["เพดานสูงสุดต่อคืน", RateEngine.fmt(cap) + " บาท"],
        ["จ่ายจริงต่อคืน", RateEngine.fmt(actualPerNight) + " บาท"],
        ["เบิกได้จริงต่อคืน (ไม่เกินเพดาน)", RateEngine.fmt(rate) + " บาท"]
      );
    }

    document.getElementById("gliResult").innerHTML = `
      <div class="result-box">
        <div class="result-row"><span>ระดับตำแหน่ง</span><span>${escapeHtml(RateEngine.positionName(positionId))}</span></div>
        <div class="result-row"><span>จำนวนคืน</span><span>${nights} คืน</span></div>
        ${detailRows.map(([k, v]) => `<div class="result-row"><span>${k}</span><span>${v}</span></div>`).join("")}
      </div>
      <div class="result-total"><span>รวมค่าที่พัก</span><span class="amt">${RateEngine.fmt(total)} บาท</span></div>
    `;
  },

  // ---------- ค่าที่พัก: หมู่คณะ (ทั้งคณะเลือกวิธีเบิกแบบเดียวกัน ตามระเบียบข้อ 18) ----------
  addLodgingGroupRow() {
    const container = document.getElementById("glgRows");
    const row = document.createElement("div");
    row.className = "mapping-row lodging-row gov-lodging-row";
    row.innerHTML = `
      <input class="glg-name" placeholder="ชื่อ-สกุล"/>
      <select class="glg-position"></select>
      <select class="glg-room lodging-actual-col">
        <option value="double">ห้องคู่</option>
        <option value="single">ห้องเดี่ยว</option>
      </select>
      <input class="glg-actual lodging-actual-col" min="0" placeholder="จ่ายจริง/คืน" step="0.01" type="number"/>
      <button class="btn btn-ghost btn-sm" type="button">✕</button>
    `;
    RateEngine.populatePositionSelect(row.querySelector(".glg-position"));
    row.querySelector("button").addEventListener("click", () => row.remove());
    container.appendChild(row);
  },

  calcLodgingGroup() {
    const nights = Number(document.getElementById("glgNights").value) || 0;
    const mode = document.getElementById("glgMode").value;
    if (nights <= 0) return UI.toast("กรุณากรอกจำนวนคืน", true);

    const rows = Array.from(document.querySelectorAll("#glgRows .gov-lodging-row"));
    if (rows.length === 0) return UI.toast("กรุณาเพิ่มรายชื่อผู้เดินทางอย่างน้อย 1 คน", true);

    let grandTotal = 0;
    const lines = rows.map((row) => {
      const name = row.querySelector(".glg-name").value.trim() || "(ไม่ระบุชื่อ)";
      const positionId = row.querySelector(".glg-position").value;
      let rate, detail;
      if (mode === "lump_sum") {
        rate = RateEngine.findRate("lodging_lump_sum", { positionLevelId: positionId }) || 0;
        detail = "เหมาจ่าย";
      } else {
        const roomType = row.querySelector(".glg-room").value;
        const cap = RateEngine.findRate(roomType === "single" ? "lodging_single" : "lodging_double", { positionLevelId: positionId }) || 0;
        const actual = Number(row.querySelector(".glg-actual").value) || 0;
        rate = Math.min(actual, cap);
        detail = (roomType === "single" ? "ห้องเดี่ยว" : "ห้องคู่") + ` (เพดาน ${RateEngine.fmt(cap)})`;
      }
      const total = rate * nights;
      grandTotal += total;
      return { name, positionName: RateEngine.positionName(positionId), detail, rate, total };
    });

    document.getElementById("glgResult").innerHTML = `
      <div class="table-scroll"><table><thead><tr><th>ชื่อ-สกุล</th><th>ระดับตำแหน่ง</th><th>รายละเอียด</th><th>เบิกได้/คืน</th><th>รวม (${nights} คืน)</th></tr></thead><tbody>
        ${lines
          .map(
            (l) => `<tr>
          <td>${escapeHtml(l.name)}</td><td>${escapeHtml(l.positionName)}</td><td>${escapeHtml(l.detail)}</td>
          <td>${RateEngine.fmt(l.rate)}</td><td>${RateEngine.fmt(l.total)}</td>
        </tr>`
          )
          .join("")}
      </tbody></table></div>
      <div class="result-total" style="margin-top:12px;"><span>รวมค่าที่พักทั้งคณะ (${lines.length} คน)</span><span class="amt">${RateEngine.fmt(grandTotal)} บาท</span></div>
    `;
  },

  // ---------- ค่าพาหนะส่วนตัว ----------
  calcTransport() {
    const vehicle = document.getElementById("gtVehicle").value;
    const distance = Number(document.getElementById("gtDistance").value) || 0;
    if (distance <= 0) return UI.toast("กรุณากรอกระยะทาง", true);

    const rate = RateEngine.findRate("transport_per_km", { transportType: vehicle });
    if (rate === null) return UI.toast("ไม่พบอัตราค่าพาหนะสำหรับประเภทนี้", true);
    const total = rate * distance;

    document.getElementById("gtResult").innerHTML = `
      <div class="result-box">
        <div class="result-row"><span>ประเภทพาหนะ</span><span>${vehicle === "personal_car" ? "รถยนต์ส่วนบุคคล" : "รถจักรยานยนต์ส่วนบุคคล"}</span></div>
        <div class="result-row"><span>ระยะทาง</span><span>${distance.toLocaleString("th-TH")} กม.</span></div>
        <div class="result-row"><span>อัตรา</span><span>${RateEngine.fmt(rate)} บาท/กม.</span></div>
      </div>
      <div class="result-total"><span>รวมค่าพาหนะ</span><span class="amt">${RateEngine.fmt(total)} บาท</span></div>
    `;
  },
};
