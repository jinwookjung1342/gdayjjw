# JB우리캐피탈 월별 민원현황

사내 민원 데이터 분석/보고 자동화를 위한 실서비스 지향 프로젝트입니다.

## 아키텍처

- `apps/web`: Next.js + Tailwind + TypeScript 기반 관리자 웹
- `services/doc-ai`: FastAPI + Python 문서 파싱/AI 전처리 서비스
- `db`: PostgreSQL(Supabase) 스키마 및 마이그레이션 SQL
- `docs`: 설계 문서

## 빠른 시작

### 1) Web 실행

```bash
cd apps/web
npm install
npm run dev
```

### 2) Doc-AI 실행

```bash
cd services/doc-ai
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## 기본 라우트

- `/login`: 사번 + 비밀번호 로그인(정규식 검증)
- `/`: 로그인 여부에 따라 대시보드 또는 로그인으로 이동
- `/statistics`: 민원통계(초기 페이지)
- `/monthly-issues`: 이달의 민원(초기 페이지)
- `/monthly-data`: 월별 데이터 입력(초기 페이지)
- `/monthly-report`: 월보발송(초기 페이지)
- `/reply-draft`: 민원회신서 초안 작성(초기 페이지)

## 인증 정책(초기 버전)

- 사번 형식 정규식: `^[0-9]{2}[A-Za-z]{1,2}[0-9]{4,5}$`
- 초기 정책상 형식만 맞으면 로그인 성공
- 비밀번호는 사번과 동일해야 로그인 허용
- 성공 시 HttpOnly 쿠키(`jb_session`) 발급

## 배포 권장

- 프론트엔드: Vercel
- DB/Auth/Storage: Supabase
- 문서/AI 마이크로서비스: Render
