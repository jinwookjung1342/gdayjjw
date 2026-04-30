# 배포 정보 (JB 민원 프로젝트)

초보용으로 필요한 것만 적어 둡니다. Cursor의 AI에게도 같은 내용은 `.cursor/rules/jb-deployment.mdc` 규칙으로 전달됩니다.

## 레포지토리
- **GitHub:** https://github.com/jinwookjung1342/gdayjjw  
- **브랜치:** `main` 에 푸시하면 자동 배포가 연결되어 있으면 각 서비스가 빌드됩니다.

## Vercel (웹 / Next.js)
| 항목 | 값 |
|------|-----|
| 프로젝트 | jbwrccustomer |
| URL | https://jbwrccustomer.vercel.app |
| Root Directory | 보통 **`apps/web`** (대시보드 Settings → General 에서 확인) |

**환경 변수 (서버 전용)**  
- `DOC_AI_API_BASE_URL` = `https://gdayjjw.onrender.com`  
  - **`https://` 포함**, 경로(`/parse` 등)**붙이지 않음**.  
  - 저장 후 **Deployments → Redeploy** 권장.

## Render (문서 파싱 / doc-ai)
| 항목 | 값 |
|------|-----|
| 서비스 이름 | gdayjjw |
| URL | https://gdayjjw.onrender.com |
| Git Root Directory | **services/doc-ai** |
| 빌드 | Dockerfile 기준 (`services/doc-ai/Dockerfile`) |

**엔드포인트 예**  
- `GET https://gdayjjw.onrender.com/health`  
- 월별 데이터 업로드는 Vercel API가 `@/api/monthly-data/parse`에서 위 호스트로 `POST /parse/monthly-data` 를 호출합니다.

## 로컬에서 푸시하는 순서 (Windows)
```powershell
cd "경로\커서ai"
git status
git add .
git commit -m "설명 한 줄"
git push origin main
```
커밋이 처음이면:
```powershell
git config --global user.name "이름"
git config --global user.email "GitHub에 등록한 이메일"
```

## 문제가 자주 나는 경우
1. **파싱 시 Not Found** → Vercel `DOC_AI_API_BASE_URL` 이 호스트만인지 확인 후 Redeploy.  
2. **Render 빌드 실패** → Events에서 로그 확인, `services/doc-ai`에 Dockerfile·`app` 폴더 있는지 확인.  
3. **첫 API 요청만 느림** → Render 무료 인스턴스 슬립; `/health` 한 번 열고 잠시 후 다시 시도.
