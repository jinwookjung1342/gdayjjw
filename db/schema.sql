-- JB우리캐피탈 월별 민원현황
-- PostgreSQL 15+ / Supabase 기준

create extension if not exists "pgcrypto";
create extension if not exists "vector";

create type complaint_channel_type as enum ('금융감독원', '한국소비자보호원', '기타');
create type complaint_scope_type as enum ('대외', '대내');
create type complaint_category_type as enum ('영업', '채권', '고객상담', '제도정책', '기타');
create type source_file_type as enum ('excel', 'word');

create table if not exists employee_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id varchar(16) not null unique,
  display_name varchar(50),
  role varchar(20) not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists complaint_records (
  id uuid primary key default gen_random_uuid(),
  receipt_number varchar(32) not null unique,
  receipt_date date not null,
  receipt_channel_name varchar(100) not null,
  complaint_channel complaint_channel_type not null default '기타',
  complaint_scope complaint_scope_type not null default '대내',
  birth_date date,
  age_group varchar(40),
  complaint_type_major varchar(100),
  complaint_type_minor varchar(100),
  business_unit_name varchar(120),
  sales_department_name varchar(120),
  bond_department_name varchar(120),
  complaint_content text not null,
  complainant_summary text,
  similar_case_content text,
  company_opinion text,
  violation_and_action text,
  future_action_plan text,
  is_third_party boolean,
  litigation_related text,
  urgent_processing_required boolean,
  ai_category complaint_category_type,
  ai_subcategory varchar(100),
  ai_keywords text[] not null default '{}',
  ai_embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_complaint_records_receipt_date on complaint_records(receipt_date);
create index if not exists idx_complaint_records_scope on complaint_records(complaint_scope);
create index if not exists idx_complaint_records_ai_category on complaint_records(ai_category);

create table if not exists complaint_upload_batches (
  id uuid primary key default gen_random_uuid(),
  month_key char(7) not null, -- YYYY-MM
  uploaded_by uuid references employee_accounts(id),
  uploaded_at timestamptz not null default now(),
  memo text
);

create table if not exists source_files (
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid not null references complaint_upload_batches(id) on delete cascade,
  file_type source_file_type not null,
  file_name text not null,
  storage_path text not null,
  parsed_status varchar(20) not null default 'pending',
  parsed_result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists complaint_record_sources (
  id uuid primary key default gen_random_uuid(),
  complaint_record_id uuid not null references complaint_records(id) on delete cascade,
  source_file_id uuid not null references source_files(id) on delete cascade,
  source_row_key varchar(50),
  unique(complaint_record_id, source_file_id)
);

create table if not exists monthly_issue_reports (
  id uuid primary key default gen_random_uuid(),
  month_key char(7) not null unique,
  keyword_summary jsonb not null default '[]'::jsonb,
  selected_case_complaint_id uuid references complaint_records(id),
  generated_report text,
  edited_report text,
  updated_by uuid references employee_accounts(id),
  updated_at timestamptz not null default now()
);

create table if not exists report_exports (
  id uuid primary key default gen_random_uuid(),
  month_key char(7) not null,
  export_type varchar(20) not null, -- pptx, docx
  storage_path text not null,
  generated_by uuid references employee_accounts(id),
  created_at timestamptz not null default now()
);

create table if not exists reply_draft_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employee_accounts(id),
  complaint_input text not null,
  product_type varchar(100),
  category complaint_category_type,
  query_start_date date,
  query_end_date date,
  selected_case_ids uuid[] not null default '{}',
  generated_draft text,
  created_at timestamptz not null default now()
);
