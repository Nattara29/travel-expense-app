// เมนู "จัดการอัตราค่าใช้จ่าย" — เฉพาะผู้ดูแลระบบ (RLS: insert/delete ได้เท่านั้น ไม่มี update)
// หลักการ: ปรับอัตราใหม่ = เพิ่มแถวใหม่พร้อมวันที่เริ่มมีผล ไม่แก้ของเดิม เพื่อให้ทริปเก่ายังคำนวณถูกต้อง

const RATE_TYPE_LABEL = {
  daily_allowance: "ค่าเบี้ยเลี้ยง",
  lodging_single: "ค่าที่พัก จ่ายจริง (ห้องเดี่ยว)",
  lodging_double: "ค่าที่พัก จ่ายจริง (ห้องคู่)",
  lodging_lump_sum: "ค่าที่พักเหมาจ่าย",
  transport_per_km: "ค่าพาหนะส่วนตัว (ต่อกิโลเมตร)",
};

const TRANSPORT_TYPE_LABEL_RA = { personal_car: "รถยนต์ส่วนบุคคล", personal_motorcycle: "รถจักรยานยนต์ส่วนบุคคล" };

const RatesAdmin = {
  async load() {
    await RateEngine.reload();
    this.renderPositionRateTable("raAllowance", "daily_allowance", "บาท/วัน");
    this.renderPositionRateTable("raLodgingSingle", "lodging_single", "บาท/คืน");
    this.renderPositionRateTable("raLodgingDouble", "lodging_double", "บาท/คืน");
    this.renderPositionRateTable("raLodgingLumpSum", "lodging_lump_sum", "บาท/คืน");
    this.renderTransportRateTable("raTransport");
  },

  labelFor(rateType, positionLevelId, roomType, transportType) {
    let label = RATE_TYPE_LABEL[rateType] || rateType;
    if (positionLevelId) label += " — " + RateEngine.positionName(positionLevelId);
    if (transportType) label += " — " + (TRANSPORT_TYPE_LABEL_RA[transportType] || transportType);
    return label;
  },

  // ตารางอัตราแยกตามระดับตำแหน่ง (ใช้กับเบี้ยเลี้ยง / ที่พักจ่ายจริง / ที่พักเหมาจ่าย)
  renderPositionRateTable(containerId, rateType, unitLabel) {
    const rows = RateEngine.positionLevels.map((p) => ({ position: p, row: RateEngine.findRateRow(rateType, { positionLevelId: p.id }) }));
    document.getElementById(containerId).innerHTML = `
      <h3 class="section-title">${RATE_TYPE_LABEL[rateType]}</h3>
      <p class="section-sub">อัตราที่ใช้อยู่ ณ วันนี้ แยกตามระดับตำแหน่ง (หน่วย: ${unitLabel})</p>
      <div class="table-scroll"><table><thead><tr><th>ระดับตำแหน่ง</th><th>อัตราปัจจุบัน</th><th>มีผลตั้งแต่</th><th></th></tr></thead><tbody>
        ${rows
          .map(
            ({ position, row }) => `<tr>
          <td>${escapeHtml(position.name)}</td>
          <td>${row ? RateEngine.fmt(Number(row.value)) + " บาท" : '<span style="color:var(--red);">ยังไม่กำหนด</span>'}</td>
          <td>${row ? new Date(row.effective_date).toLocaleDateString("th-TH") : "-"}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm" onclick="RatesAdmin.editRate('${rateType}','${position.id}',null,null)">แก้ไข</button>
            <button class="btn btn-ghost btn-sm" onclick="RatesAdmin.showHistory('${rateType}','${position.id}',null,null)">ประวัติ</button>
          </td>
        </tr>`
          )
          .join("")}
      </tbody></table></div>
    `;
  },

  // ตารางค่าพาหนะ (แยกตามประเภทพาหนะ ไม่ผูกกับระดับตำแหน่ง)
  renderTransportRateTable(containerId) {
    const types = Object.keys(TRANSPORT_TYPE_LABEL_RA);
    const rows = types.map((t) => ({ type: t, row: RateEngine.findRateRow("transport_per_km", { transportType: t }) }));
    document.getElementById(containerId).innerHTML = `
      <h3 class="section-title">${RATE_TYPE_LABEL.transport_per_km}</h3>
      <p class="section-sub">อัตราชดเชยตามระยะทาง แยกตามประเภทพาหนะ</p>
      <div class="table-scroll"><table><thead><tr><th>ประเภทพาหนะ</th><th>อัตราปัจจุบัน</th><th>มีผลตั้งแต่</th><th></th></tr></thead><tbody>
        ${rows
          .map(
            ({ type, row }) => `<tr>
          <td>${TRANSPORT_TYPE_LABEL_RA[type]}</td>
          <td>${row ? RateEngine.fmt(Number(row.value)) + " บาท/กม." : '<span style="color:var(--red);">ยังไม่กำหนด</span>'}</td>
          <td>${row ? new Date(row.effective_date).toLocaleDateString("th-TH") : "-"}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm" onclick="RatesAdmin.editRate('transport_per_km',null,null,'${type}')">แก้ไข</button>
            <button class="btn btn-ghost btn-sm" onclick="RatesAdmin.showHistory('transport_per_km',null,null,'${type}')">ประวัติ</button>
          </td>
        </tr>`
          )
          .join("")}
      </tbody></table></div>
    `;
  },

  // เปิดกล่องโต้ตอบให้กรอกอัตราใหม่ + วันที่เริ่มมีผล แล้วบันทึกเป็นแถวใหม่ (ไม่แก้ของเดิม)
  async editRate(rateType, positionLevelId, roomType, transportType) {
    const label = RatesAdmin.labelFor(rateType, positionLevelId, roomType, transportType);
    const current = RateEngine.findRate(rateType, { positionLevelId, roomType, transportType });
    const today = new Date().toISOString().slice(0, 10);

    const { value: form } = await Swal.fire({
      title: `ปรับอัตรา: ${label}`,
      html: `
        <div class="field" style="text-align:left;"><label>อัตราใหม่ (บาท)</label><input id="swalRateValue" min="0" step="0.01" type="number" value="${current !== null ? current : ""}"/></div>
        <div class="field" style="text-align:left;margin-bottom:0;"><label>มีผลตั้งแต่วันที่</label><input id="swalRateDate" type="date" value="${today}"/></div>
        <p style="text-align:left;font-size:12.5px;color:var(--text-soft);margin:10px 0 0;">ระบบจะเก็บอัตราเดิมไว้เป็นประวัติ ไม่ลบทิ้ง เพื่อให้ทริปเก่าที่คำนวณไปแล้วยังถูกต้องตามอัตรา ณ ตอนนั้น</p>
      `,
      confirmButtonText: "บันทึกอัตราใหม่",
      confirmButtonColor: "#1c4c80",
      showCancelButton: true,
      cancelButtonText: "ยกเลิก",
      focusConfirm: false,
      preConfirm: () => {
        const value = Number(document.getElementById("swalRateValue").value);
        const date = document.getElementById("swalRateDate").value;
        if (!value || value <= 0) {
          Swal.showValidationMessage("กรุณากรอกอัตราที่มากกว่า 0");
          return false;
        }
        if (!date) {
          Swal.showValidationMessage("กรุณาเลือกวันที่เริ่มมีผล");
          return false;
        }
        return { value, date };
      },
    });
    if (!form) return;

    const { error } = await sb.from("rate_settings").insert({
      rate_type: rateType,
      position_level_id: positionLevelId || null,
      room_type: roomType || null,
      transport_type: transportType || null,
      value: form.value,
      effective_date: form.date,
      created_by: AppState.user ? AppState.user.id : null,
    });
    if (error) return UI.toast("บันทึกอัตราใหม่ไม่สำเร็จ: " + error.message, true);

    UI.toast("บันทึกอัตราใหม่เรียบร้อยแล้ว");
    await RatesAdmin.load();
  },

  // แสดงประวัติอัตราทั้งหมดของรายการนี้ (เรียงจากล่าสุดไปเก่าสุด)
  showHistory(rateType, positionLevelId, roomType, transportType) {
    const label = RatesAdmin.labelFor(rateType, positionLevelId, roomType, transportType);
    const rows = RateEngine.rates
      .filter(
        (r) =>
          r.rate_type === rateType &&
          (positionLevelId ? r.position_level_id === positionLevelId : !r.position_level_id) &&
          (roomType ? r.room_type === roomType : !r.room_type) &&
          (transportType ? r.transport_type === transportType : !r.transport_type)
      )
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date));

    const html = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>อัตรา (บาท)</th><th>มีผลตั้งแต่</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${RateEngine.fmt(Number(r.value))}</td><td>${new Date(r.effective_date).toLocaleDateString("th-TH")}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p style="color:var(--text-soft);">ยังไม่มีประวัติอัตรา</p>';

    Swal.fire({ title: `ประวัติอัตรา: ${label}`, html, confirmButtonText: "ปิด", confirmButtonColor: "#1c4c80" });
  },
};
