# DB 설계 요약

`db/schema.sql`은 Supabase(PostgreSQL)에서 바로 실행 가능한 초기 스키마입니다.

## 핵심 테이블

- `complaint_records`
  - 통합 민원 데이터 원본 + AI 분석 결과를 함께 저장
  - Excel/Word 매핑 완료 후 단일 레코드로 관리
  - `receipt_number` 유니크로 중복 방지
- `source_files`
  - 업로드 파일 메타/파싱 상태 관리
  - 원본은 Supabase Storage 경로(`storage_path`)로 추적
- `complaint_record_sources`
  - 하나의 통합 민원이 어떤 파일에서 왔는지 연결
- `monthly_issue_reports`
  - "이달의 민원"에서 수기 편집 가능한 보고서 상태 저장
- `report_exports`
  - PPT/Word 생성 파일 이력 관리
- `reply_draft_sessions`
  - 초안작성 검색조건, 선택사례, 생성 초안 저장

## 대외/대내 구분 규칙

- `receipt_channel_name`가 아래 중 하나면 `complaint_scope='대외'`
  - 금융감독원
  - 한국소비자보호원
- 그 외는 `대내`

## AI 분석 저장 필드

- `ai_category`, `ai_subcategory`, `ai_keywords`
- 검색 고도화를 위한 `ai_embedding vector(1536)`

## 인덱스

- 월별 대시보드 성능을 위해 `receipt_date`, `complaint_scope`, `ai_category` 인덱스 포함

## 다음 마이그레이션 권장

- RLS 정책(역할 기반 접근제어)
- `updated_at` 자동 업데이트 트리거
- 자주 쓰는 월별 통계를 위한 materialized view
