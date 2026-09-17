-- ============================================================
-- ระบบคำนวณค่าใช้จ่ายเดินทางไปราชการ/ฝึกอบรม เทศบาลเมืองศรีสัชนาลัย
-- โครงสร้างฐานข้อมูล (Supabase/Postgres)
-- ไฟล์นี้เก็บไว้เป็นหลักฐาน/สำเนา ถ้าต้องสร้างฐานข้อมูลใหม่ที่อื่น
-- สามารถคัดลอกไปรันใน Supabase SQL editor ได้ทั้งไฟล์
-- ============================================================

-- ---------- ชนิดข้อมูลแบบเลือกได้ (enum) ----------
create type app_role as enum ('admin','officer');
create type trip_type_enum as enum ('government','training');       -- ไปราชการ / ไปฝึกอบรม
create type trip_mode_enum as enum ('individual','group');          -- รายบุคคล / หมู่คณะ
create type trip_status_enum as enum ('draft','pending','approved','rejected');
create type room_type_enum as enum ('single','double');             -- ห้องพักเดี่ยว / ห้องพักคู่
create type rate_type_enum as enum ('daily_allowance','lodging_single','lodging_double','transport_per_km','lodging_lump_sum');
create type transport_type_enum as enum ('personal_car','government_car','airplane','public_transport','personal_motorcycle');
create type document_type_enum as enum ('order','circular','announcement','approval','other');

-- ---------- ระดับตำแหน่ง (ใช้กำหนดอัตราเบี้ยเลี้ยง/ที่พัก) ----------
create table public.position_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null,
  created_at timestamptz not null default now()
);

-- ---------- โปรไฟล์ผู้ใช้งาน (ต่อยอดจาก auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  position_level_id uuid references public.position_levels(id),
  role app_role not null default 'officer',
  created_at timestamptz not null default now()
);

-- ---------- อัตราค่าใช้จ่าย (แก้ไขได้โดย admin, เก็บประวัติด้วย effective_date) ----------
-- หลักการ: ไม่แก้ตัวเลขเดิม แต่เพิ่มแถวใหม่พร้อมวันที่เริ่มมีผล เพื่อให้ทริปเก่ายังคำนวณ
-- ด้วยอัตราที่ใช้ ณ ตอนนั้นถูกต้อง แม้ภายหลังจะมีการปรับอัตราใหม่
create table public.rate_settings (
  id uuid primary key default gen_random_uuid(),
  rate_type rate_type_enum not null,
  position_level_id uuid references public.position_levels(id),   -- ใช้กับ daily_allowance/lodging_* (null = ไม่ผูกกับระดับตำแหน่ง)
  room_type room_type_enum,                                       -- ใช้กับ lodging_single/lodging_double เท่านั้น
  transport_type transport_type_enum,                             -- ใช้กับ transport_per_km เท่านั้น (รถยนต์/รถจักรยานยนต์)
  value numeric not null,
  effective_date date not null default current_date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- ทริป (การเดินทางไปราชการ/ฝึกอบรม 1 ครั้ง อาจมีผู้เดินทางคนเดียวหรือหลายคน) ----------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  trip_type trip_type_enum not null,
  mode trip_mode_enum not null,
  title text not null,
  start_date date not null,
  end_date date not null,
  status trip_status_enum not null default 'draft',
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint end_after_start check (end_date >= start_date)
);

-- ---------- ผู้เดินทางในแต่ละทริป (1 แถวต่อ 1 คน แม้เดินทางคนเดียวก็มี 1 แถว) ----------
create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id),          -- อ้างอิงบัญชีในระบบ ถ้ามี (ไม่บังคับ กรอกชื่อเองก็ได้)
  full_name text not null,
  position_level_id uuid references public.position_levels(id),
  created_at timestamptz not null default now()
);

-- ---------- ผลคำนวณเบี้ยเลี้ยง (ต่อผู้เดินทาง 1 คน) ----------
create table public.allowance_calculations (
  id uuid primary key default gen_random_uuid(),
  trip_member_id uuid not null references public.trip_members(id) on delete cascade,
  departure_at timestamptz not null,
  return_at timestamptz not null,
  has_meals_provided boolean not null default false,   -- มีผู้จัดเลี้ยงอาหารให้หรือไม่ (หักมื้อที่จัดให้)
  meals_deducted int not null default 0,
  calculated_days numeric not null,                     -- จำนวนวันที่คำนวณได้ (นับตามข้อ 17 ของระเบียบ อาจเป็นครึ่งวัน)
  rate_applied numeric not null,
  total_amount numeric not null,
  created_at timestamptz not null default now(),
  constraint return_after_departure check (return_at >= departure_at)
);

-- ---------- ผลคำนวณค่าที่พัก (ต่อผู้เดินทาง 1 คน) ----------
create table public.lodging_calculations (
  id uuid primary key default gen_random_uuid(),
  trip_member_id uuid not null references public.trip_members(id) on delete cascade,
  nights int not null check (nights >= 0),
  room_type room_type_enum not null,                    -- ไม่ใช้ (null ได้) ถ้าเลือกแบบเหมาจ่าย
  occupants_in_room int not null default 1 check (occupants_in_room >= 1),
  rate_applied numeric not null,
  actual_amount numeric,                                 -- จำนวนที่จ่ายจริง (กรณีเลือกเบิกแบบจ่ายจริง) ไม่เกิน rate_applied
  total_amount numeric not null,
  created_at timestamptz not null default now()
);

-- ---------- ผลคำนวณค่าพาหนะ (ต่อทริป หรือต่อผู้เดินทาง 1 คน) ----------
create table public.transport_calculations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_member_id uuid references public.trip_members(id) on delete cascade,
  transport_type transport_type_enum not null,
  distance_km numeric,
  rate_per_km numeric,
  actual_amount numeric,
  total_amount numeric not null,
  created_at timestamptz not null default now()
);

-- ---------- เอกสารราชการอ้างอิง (คำสั่ง/หนังสือเวียน/หนังสืออนุมัติ ฯลฯ) ----------
create table public.official_documents (
  id uuid primary key default gen_random_uuid(),
  document_number text not null,
  document_date date not null,
  subject text not null,
  issuing_agency text,
  document_type document_type_enum not null default 'other',
  storage_path text not null,
  trip_id uuid references public.trips(id) on delete set null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.position_levels enable row level security;
alter table public.profiles enable row level security;
alter table public.rate_settings enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.allowance_calculations enable row level security;
alter table public.lodging_calculations enable row level security;
alter table public.transport_calculations enable row level security;
alter table public.official_documents enable row level security;

-- ฟังก์ชันช่วยตรวจสิทธิ์แอดมิน (security definer เพื่อเลี่ยง RLS recursion เวลาใช้เป็นเงื่อนไขบนตาราง profiles เอง)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create policy "position_levels_select_all" on public.position_levels for select using (auth.role() = 'authenticated');
create policy "position_levels_admin_write" on public.position_levels for all using (is_admin()) with check (is_admin());

create policy "profiles_select_own_or_admin" on public.profiles for select using (id = auth.uid() or is_admin());
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid() or is_admin());
create policy "profiles_admin_insert" on public.profiles for insert with check (is_admin());

create policy "rate_settings_select_all" on public.rate_settings for select using (auth.role() = 'authenticated');
create policy "rate_settings_admin_insert" on public.rate_settings for insert with check (is_admin());
create policy "rate_settings_admin_delete" on public.rate_settings for delete using (is_admin());
-- หมายเหตุ: ตั้งใจไม่มี policy สำหรับ UPDATE — การ "แก้อัตรา" ทำโดยเพิ่มแถวใหม่ (insert) พร้อม effective_date ใหม่เสมอ ไม่แก้ของเดิม

create policy "trips_select_own_or_admin" on public.trips for select using (created_by = auth.uid() or is_admin());
create policy "trips_insert_own" on public.trips for insert with check (created_by = auth.uid());
create policy "trips_update_own_draft_or_admin" on public.trips for update using ((created_by = auth.uid() and status in ('draft','pending')) or is_admin());
create policy "trips_delete_own_draft_or_admin" on public.trips for delete using ((created_by = auth.uid() and status = 'draft') or is_admin());

create policy "trip_members_via_trip" on public.trip_members for all
  using (exists (select 1 from trips where trips.id = trip_members.trip_id and (trips.created_by = auth.uid() or is_admin())))
  with check (exists (select 1 from trips where trips.id = trip_members.trip_id and (trips.created_by = auth.uid() or is_admin())));

create policy "allowance_via_trip" on public.allowance_calculations for all
  using (exists (select 1 from trip_members join trips on trips.id = trip_members.trip_id where trip_members.id = allowance_calculations.trip_member_id and (trips.created_by = auth.uid() or is_admin())))
  with check (exists (select 1 from trip_members join trips on trips.id = trip_members.trip_id where trip_members.id = allowance_calculations.trip_member_id and (trips.created_by = auth.uid() or is_admin())));

create policy "lodging_via_trip" on public.lodging_calculations for all
  using (exists (select 1 from trip_members join trips on trips.id = trip_members.trip_id where trip_members.id = lodging_calculations.trip_member_id and (trips.created_by = auth.uid() or is_admin())))
  with check (exists (select 1 from trip_members join trips on trips.id = trip_members.trip_id where trip_members.id = lodging_calculations.trip_member_id and (trips.created_by = auth.uid() or is_admin())));

create policy "transport_via_trip" on public.transport_calculations for all
  using (exists (select 1 from trips where trips.id = transport_calculations.trip_id and (trips.created_by = auth.uid() or is_admin())))
  with check (exists (select 1 from trips where trips.id = transport_calculations.trip_id and (trips.created_by = auth.uid() or is_admin())));

create policy "documents_select_all" on public.official_documents for select using (auth.role() = 'authenticated');
create policy "documents_insert_own" on public.official_documents for insert with check (uploaded_by = auth.uid());
create policy "documents_update_own_or_admin" on public.official_documents for update using (uploaded_by = auth.uid() or is_admin());
create policy "documents_delete_own_or_admin" on public.official_documents for delete using (uploaded_by = auth.uid() or is_admin());

-- เมื่อมีผู้ใช้ถูกสร้างใน auth.users (สร้างจาก Supabase Dashboard เท่านั้น ระบบนี้ไม่เปิดสมัครสมาชิกเอง)
-- ให้สร้างแถว profile อัตโนมัติ เป็น role 'officer' ก่อน แล้วแอดมินค่อยปรับเป็น 'admin' ทีหลังผ่าน SQL
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'officer');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- ระดับตำแหน่ง 11 ระดับ ตามระเบียบกระทรวงมหาดไทยฯ ----------
insert into public.position_levels (name, sort_order) values
  ('ประเภททั่วไป ระดับปฏิบัติงาน', 1),
  ('ประเภททั่วไป ระดับชำนาญงาน', 2),
  ('ประเภททั่วไป ระดับอาวุโส', 3),
  ('ประเภทวิชาการ ระดับปฏิบัติการ', 4),
  ('ประเภทวิชาการ ระดับชำนาญการ', 5),
  ('ประเภทวิชาการ ระดับชำนาญการพิเศษ', 6),
  ('ประเภทวิชาการ ระดับเชี่ยวชาญ', 7),
  ('ประเภทอำนวยการ ระดับต้น', 8),
  ('ประเภทอำนวยการ ระดับสูง', 9),
  ('ประเภทบริหาร ระดับต้น', 10),
  ('ประเภทบริหาร ระดับสูง', 11)
on conflict (name) do nothing;

-- ---------- อัตราเริ่มต้น ตามระเบียบกระทรวงมหาดไทยว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการของเจ้าหน้าที่ท้องถิ่น ----------
-- ระดับล่าง = ทั่วไปทุกระดับ/วิชาการถึงชำนาญการพิเศษ/อำนวยการ-บริหารท้องถิ่นถึงระดับกลาง/ระดับ 8 ลงมา
-- ระดับสูง = วิชาการเชี่ยวชาญ/อำนวยการท้องถิ่นระดับสูง/ระดับ 9  |  ระดับสูงสุด = บริหารท้องถิ่นระดับสูง/ระดับ 10 ขึ้นไป
insert into public.rate_settings (rate_type, position_level_id, value, effective_date)
select 'daily_allowance', id,
  case name when 'ประเภทวิชาการ ระดับเชี่ยวชาญ' then 270 when 'ประเภทอำนวยการ ระดับสูง' then 270 when 'ประเภทบริหาร ระดับสูง' then 270 else 240 end,
  current_date
from public.position_levels;

insert into public.rate_settings (rate_type, position_level_id, room_type, value, effective_date)
select 'lodging_single', id, 'single',
  case name when 'ประเภทบริหาร ระดับสูง' then 2500 when 'ประเภทวิชาการ ระดับเชี่ยวชาญ' then 2200 when 'ประเภทอำนวยการ ระดับสูง' then 2200 else 1500 end,
  current_date
from public.position_levels;

insert into public.rate_settings (rate_type, position_level_id, room_type, value, effective_date)
select 'lodging_double', id, 'double',
  case name when 'ประเภทบริหาร ระดับสูง' then 1400 when 'ประเภทวิชาการ ระดับเชี่ยวชาญ' then 1200 when 'ประเภทอำนวยการ ระดับสูง' then 1200 else 850 end,
  current_date
from public.position_levels;

insert into public.rate_settings (rate_type, position_level_id, value, effective_date)
select 'lodging_lump_sum', id,
  case name when 'ประเภทวิชาการ ระดับเชี่ยวชาญ' then 1600 when 'ประเภทอำนวยการ ระดับสูง' then 1600 when 'ประเภทบริหาร ระดับสูง' then 1600 else 800 end,
  current_date
from public.position_levels;

insert into public.rate_settings (rate_type, transport_type, value, effective_date) values
  ('transport_per_km', 'personal_car', 4, current_date),
  ('transport_per_km', 'personal_motorcycle', 2, current_date);

-- ---------- ที่เก็บไฟล์เอกสารราชการอ้างอิง (private bucket ต้องล็อกอินถึงเข้าถึงได้) ----------
insert into storage.buckets (id, name, public)
values ('official-documents', 'official-documents', false)
on conflict (id) do nothing;
