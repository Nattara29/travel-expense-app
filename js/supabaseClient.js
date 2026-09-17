// การเชื่อมต่อฐานข้อมูล Supabase
// SUPABASE_URL และ SUPABASE_KEY เป็นค่า "สาธารณะ" ที่ตั้งใจฝังในโค้ดฝั่งเว็บได้
// ความปลอดภัยที่แท้จริงมาจาก Row Level Security (RLS) ที่ตั้งไว้ในฐานข้อมูล ไม่ใช่การซ่อนคีย์นี้
const SUPABASE_URL = "https://ewdlpnqxsijnfcgawjsj.supabase.co";
const SUPABASE_KEY = "sb_publishable_28GLT5LHCQnX8bDi7Ndlyg__ASODp1C";

// ตั้งชื่อตัวแปรว่า sb (ไม่ใช้ชื่อ "supabase") เพราะไลบรารี UMD ของ Supabase
// สร้างตัวแปร global ชื่อ "supabase" ไว้ก่อนแล้ว ถ้าตั้งชื่อซ้ำจะ error "already been declared"
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
