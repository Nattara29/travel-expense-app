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

// ป้ายกำกับกลุ่มตำแหน่งแบบระบบซีเดิม (ระดับ 1-11) ที่ระเบียบเดินทางไปราชการบางฉบับยังอ้างอิงอยู่
// ใช้ช่วยให้แอดมินที่คุ้นกับคำนี้หากลุ่มเจอง่ายขึ้นเท่านั้น ไม่กระทบวิธีคำนวณหรือโครงสร้างข้อมูลใดๆ
const OLD_LEVEL_TAGS = [
  {
    label: "ระดับ 8 ลงมาหรือเทียบเท่า",
    positionNames: [
      "ประเภททั่วไป ระดับปฏิบัติงาน",
      "ประเภททั่วไป ระดับชำนาญงาน",
      "ประเภททั่วไป ระดับอาวุโส",
      "ประเภทวิชาการ ระดับปฏิบัติการ",
      "ประเภทวิชาการ ระดับชำนาญการ",
      "ประเภทวิชาการ ระดับชำนาญการพิเศษ",
      "ประเภทอำนวยการ ระดับต้น",
      "ประเภทบริหาร ระดับต้น",
      "พนักงานจ้าง / ลูกจ้างประจำ (เทียบเท่าระดับ 8 ลงมา)",
    ],
  },
];

// คืนป้ายกำกับก็ต่อเมื่อกลุ่มตำแหน่งตรงกับกลุ่มที่รู้จักพอดี (ไม่เดาป้ายกำกับให้กลุ่มที่ไม่ตรงเป๊ะ)
function oldLevelTagFor(positionNames) {
  const nameSet = new Set(positionNames);
  const tag = OLD_LEVEL_TAGS.find((t) => t.positionNames.length === nameSet.size && t.positionNames.every((n) => nameSet.has(n)));
  return tag ? tag.label : null;
}

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
  // จัดกลุ่มระดับตำแหน่งที่ใช้อัตราเท่ากันไว้แถวเดียวกัน เพื่อไม่ให้ตารางยาวเกินไป (ตามระเบียบส่วนใหญ่ใช้อัตราเดียวกันหลายระดับ)
  renderPositionRateTable(containerId, rateType, unitLabel) {
    const groups = [];
    const unset = [];
    RateEngine.positionLevels.forEach((p) => {
      const row = RateEngine.findRateRow(rateType, { positionLevelId: p.id });
      if (!row) {
        unset.push(p);
        return;
      }
      const value = Number(row.value);
      let group = groups.find((g) => g.value === value);
      if (!group) {
        group = { value, positions: [] };
        groups.push(group);
      }
      group.positions.push({ position: p, effective_date: row.effective_date });
    });
    groups.sort((a, b) => a.value - b.value);

    const dateRangeLabel = (positions) => {
      const dates = [...new Set(positions.map((x) => x.effective_date))].sort();
      if (dates.length === 1) return new Date(dates[0]).toLocaleDateString("th-TH");
      return `${new Date(dates[0]).toLocaleDateString("th-TH")} – ${new Date(dates[dates.length - 1]).toLocaleDateString("th-TH")}`;
    };

    const groupRows = groups
      .map((g) => {
        const posIds = g.positions.map((x) => x.position.id);
        const tag = oldLevelTagFor(g.positions.map((x) => x.position.name));
        return `<tr>
          <td>${RateEngine.fmt(g.value)} บาท</td>
          <td class="wrap-cell">
            ${tag ? `<div class="rate-old-level-tag">${escapeHtml(tag)}</div>` : ""}
            ${g.positions.map((x) => escapeHtml(x.position.name)).join(", ")}
          </td>
          <td>${dateRangeLabel(g.positions)}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm" onclick='RatesAdmin.editRateGroup("${rateType}", ${JSON.stringify(posIds)})'>แก้ไข</button>
            <button class="btn btn-ghost btn-sm" onclick='RatesAdmin.showHistoryGroup("${rateType}", ${JSON.stringify(posIds)})'>ประวัติ</button>
          </td>
        </tr>`;
      })
      .join("");

    const unsetRow = unset.length
      ? `<tr>
          <td><span style="color:var(--red);">ยังไม่กำหนด</span></td>
          <td class="wrap-cell">${unset.map((p) => escapeHtml(p.name)).join(", ")}</td>
          <td>-</td>
          <td><button class="btn btn-ghost btn-sm" onclick='RatesAdmin.editRateGroup("${rateType}", ${JSON.stringify(unset.map((p) => p.id))})'>กำหนดอัตรา</button></td>
        </tr>`
      : "";

    document.getElementById(containerId).innerHTML = `
      <h3 class="section-title">${RATE_TYPE_LABEL[rateType]}</h3>
      <p class="section-sub">จัดกลุ่มระดับตำแหน่งที่ใช้อัตราเท่ากันไว้แถวเดียวกัน (หน่วย: ${unitLabel})</p>
      <div class="table-scroll"><table><thead><tr><th>อัตรา</th><th>ใช้กับระดับตำแหน่ง</th><th>มีผลตั้งแต่</th><th></th></tr></thead><tbody>
        ${groupRows}${unsetRow}
      </tbody></table></div>
    `;
  },

  // เปิดกล่องโต้ตอบปรับอัตรากลุ่ม — แสดงรายชื่อระดับตำแหน่งทั้งหมดให้ติ๊กเลือกว่าจะใช้อัตราใหม่นี้กับใครบ้าง
  // (ติ๊กไว้ล่วงหน้าตามกลุ่มที่กดแก้ไข แต่ปรับเพิ่ม/ลดได้ เผื่อจะรวม/แยกกลุ่มใหม่)
  async editRateGroup(rateType, positionIds) {
    const checkedSet = new Set(positionIds);
    const sampleRow = positionIds.map((id) => RateEngine.findRateRow(rateType, { positionLevelId: id })).find(Boolean);
    const currentValue = sampleRow ? Number(sampleRow.value) : "";
    const today = new Date().toISOString().slice(0, 10);

    const checklistHtml = RateEngine.positionLevels
      .map(
        (p) => `<label style="display:flex;align-items:center;gap:8px;font-weight:400;padding:3px 0;text-align:left;">
          <input class="ra-edit-pos-checkbox" data-id="${p.id}" style="width:auto;" type="checkbox" ${checkedSet.has(p.id) ? "checked" : ""}/>
          ${escapeHtml(p.name)}
        </label>`
      )
      .join("");

    const { value: form } = await Swal.fire({
      title: `ปรับอัตรา: ${RATE_TYPE_LABEL[rateType]}`,
      width: 560,
      html: `
        <div class="field" style="text-align:left;"><label>อัตราใหม่ (บาท)</label><input id="swalRateValue" min="0" step="0.01" type="number" value="${currentValue}"/></div>
        <div class="field" style="text-align:left;"><label>มีผลตั้งแต่วันที่</label><input id="swalRateDate" type="date" value="${today}"/></div>
        <div class="field" style="text-align:left;margin-bottom:0;">
          <label>ใช้กับระดับตำแหน่ง (เลือกได้หลายรายการ)</label>
          <div style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px 12px;">${checklistHtml}</div>
        </div>
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
        const ids = Array.from(document.querySelectorAll(".ra-edit-pos-checkbox:checked")).map((el) => el.dataset.id);
        if (!value || value <= 0) {
          Swal.showValidationMessage("กรุณากรอกอัตราที่มากกว่า 0");
          return false;
        }
        if (!date) {
          Swal.showValidationMessage("กรุณาเลือกวันที่เริ่มมีผล");
          return false;
        }
        if (ids.length === 0) {
          Swal.showValidationMessage("กรุณาเลือกระดับตำแหน่งอย่างน้อย 1 รายการ");
          return false;
        }
        return { value, date, ids };
      },
    });
    if (!form) return;

    const { error } = await sb.from("rate_settings").insert(
      form.ids.map((positionLevelId) => ({
        rate_type: rateType,
        position_level_id: positionLevelId,
        room_type: null,
        transport_type: null,
        value: form.value,
        effective_date: form.date,
        created_by: AppState.user ? AppState.user.id : null,
      }))
    );
    if (error) return UI.toast("บันทึกอัตราใหม่ไม่สำเร็จ: " + error.message, true);

    UI.toast(`บันทึกอัตราใหม่เรียบร้อยแล้ว (${form.ids.length} ระดับตำแหน่ง)`);
    await RatesAdmin.load();
  },

  // ประวัติอัตรารวมของทุกระดับตำแหน่งในกลุ่มนี้ เรียงจากล่าสุดไปเก่าสุด แยกป้ายชื่อระดับตำแหน่งต่อแถว
  showHistoryGroup(rateType, positionIds) {
    const idSet = new Set(positionIds);
    const rows = RateEngine.rates
      .filter((r) => r.rate_type === rateType && r.position_level_id && idSet.has(r.position_level_id))
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date) || RateEngine.positionName(a.position_level_id).localeCompare(RateEngine.positionName(b.position_level_id), "th"));

    const html = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>ระดับตำแหน่ง</th><th>อัตรา (บาท)</th><th>มีผลตั้งแต่</th></tr></thead><tbody>
          ${rows
            .map(
              (r) =>
                `<tr><td>${escapeHtml(RateEngine.positionName(r.position_level_id))}</td><td>${RateEngine.fmt(Number(r.value))}</td><td>${new Date(r.effective_date).toLocaleDateString("th-TH")}</td></tr>`
            )
            .join("")}
        </tbody></table></div>`
      : '<p style="color:var(--text-soft);">ยังไม่มีประวัติอัตรา</p>';

    Swal.fire({ title: `ประวัติอัตรา: ${RATE_TYPE_LABEL[rateType]}`, html, width: 560, confirmButtonText: "ปิด", confirmButtonColor: "#1c4c80" });
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
