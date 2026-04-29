-- 기존 DB에 적용: Supabase SQL 편집기 등에서 실행
alter table complaint_records add column if not exists age_group varchar(40);
