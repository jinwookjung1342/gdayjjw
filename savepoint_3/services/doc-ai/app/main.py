import math
import re
from io import BytesIO
from typing import Any

import pandas as pd
from docx import Document
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="JB Complaint Doc AI", version="0.1.0")

RECEIPT_PATTERNS = [
    re.compile(r"접수번호\s*[:：]?\s*([A-Za-z0-9\-]{6,})"),
    re.compile(r"\((?:접수번호\s*)?([A-Za-z0-9\-]{6,})\)"),
]

SECTION_PATTERNS = {
    "is_third_party": [r"제3자\s*여부", r"제\s*3\s*자\s*여부"],
    "complainant_summary": [r"민원인\s*주장\s*요지", r"귀하\s*주장\s*요지"],
    "similar_case_content": [r"동일\s*민원.*처리\s*내용"],
    "company_opinion": [r"당사.*구체적\s*의견"],
    "violation_and_action": [r"임직원\s*위규.*조치\s*내용", r"위규.*조치\s*내용"],
    "future_action_plan": [r"향후\s*처리\s*방안"],
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(col).strip() for col in df.columns]
    return df


def _extract_receipt_number(text: str) -> str | None:
    for pattern in RECEIPT_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1).strip()
    return None


def _extract_sections(paragraphs: list[str]) -> dict[str, str]:
    result: dict[str, str] = {key: "" for key in SECTION_PATTERNS.keys()}
    current_key: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        nonlocal current_key, buffer
        if current_key:
            joined = "\n".join([line for line in buffer if line.strip()]).strip()
            if joined:
                result[current_key] = joined
        buffer = []

    for paragraph in paragraphs:
        line = paragraph.strip()
        if not line:
            continue
        matched_key = None
        for key, regexes in SECTION_PATTERNS.items():
            if any(re.search(rx, line) for rx in regexes):
                matched_key = key
                break
        if matched_key:
            flush()
            current_key = matched_key
            continue
        if current_key:
            buffer.append(line)

    flush()
    return result


def _parse_word_file(raw: bytes, file_name: str) -> dict[str, Any]:
    doc = Document(BytesIO(raw))
    paragraphs = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    full_text = "\n".join(paragraphs)
    receipt_number = _extract_receipt_number(full_text[:4000])
    sections = _extract_sections(paragraphs)
    return {
        "file_name": file_name,
        "receipt_number": receipt_number,
        "sections": sections,
        "raw_excerpt": full_text[:1500],
    }


def _find_excel_receipt_column(df: pd.DataFrame) -> str | None:
    candidates = ["기관접수번호", "접수번호", "접수 번호", "기관 접수번호"]
    for col in df.columns:
        if col in candidates:
            return col
    return None


def _find_route_column(df: pd.DataFrame) -> str | None:
    candidates = [
        "접수경로구분명",
        "접수경로분류명",
        "접수경로",
        "접수경로분류",
    ]
    for col in df.columns:
        if col in candidates:
            return col
    return None


def _find_date_column(df: pd.DataFrame) -> str | None:
    """엑셀 '접수일자' 등 (민원통계 월 집계용)."""
    candidates = ["접수일자", "접수 일자", "접수일", "접수일시", "접수 일시"]
    for col in df.columns:
        if str(col) in candidates:
            return str(col)
    for col in df.columns:
        sc = str(col).replace(" ", "")
        if "접수" in sc and "일" in sc:
            return str(col)
    return None


def _count_month_keys_for_column(df: pd.DataFrame, col: str) -> int:
    """해당 열에서 접수일로 파싱되는 행 수(월별 집계용 열 선택)."""
    n = 0
    for v in df[col]:
        if _month_key_from_excel_value(v) is not None:
            n += 1
    return n


def _find_best_date_column(df: pd.DataFrame) -> str | None:
    """이름에 '접수'·'일'이 있는 열 후보 중, 날짜 파싱 성공이 가장 많은 열."""
    candidates: list[str] = []
    for col in df.columns:
        sc = str(col).replace(" ", "")
        if str(col) in ("접수일자", "접수 일자", "접수일", "접수일시", "접수 일시"):
            candidates.append(str(col))
        elif "접수" in sc and "일" in sc:
            candidates.append(str(col))
    if not candidates:
        return _find_date_column(df)
    best_col: str | None = None
    best_n = -1
    for col in candidates:
        n = _count_month_keys_for_column(df, col)
        if n > best_n:
            best_n = n
            best_col = col
    if best_n > 0 and best_col is not None:
        return best_col
    return _find_date_column(df)


def _month_key_from_excel_serial(f: float) -> str | None:
    """엑셀 일련번호(날짜) -> YYYY-MM."""
    if not math.isfinite(f):
        return None
    if f <= 2000 or f >= 100_000:
        return None
    try:
        ts = pd.to_datetime(f, unit="D", origin="1899-12-30", errors="coerce")
        if pd.isna(ts):
            return None
        d = ts.to_pydatetime().date()
        return f"{d.year:04d}-{d.month:02d}"
    except Exception:
        return None


def _month_key_from_excel_value(val: Any) -> str | None:
    """접수일 셀 값 -> YYYY-MM, 실패 시 None."""
    if val is None:
        return None
    try:
        if bool(pd.isna(val)):  # type: ignore[arg-type]
            return None
    except Exception:
        pass
    if isinstance(val, float) and math.isnan(val):
        return None
    # 숫자 / 숫자 문자열 → 엑셀 시리얼 시도
    if isinstance(val, str):
        s = val.strip()
        if s and re.match(r"^[\d.]+$", s):
            try:
                mk = _month_key_from_excel_serial(float(s))
                if mk:
                    return mk
            except ValueError:
                pass
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        try:
            mk = _month_key_from_excel_serial(float(val))
            if mk:
                return mk
        except (TypeError, ValueError, OverflowError):
            pass
    try:
        ts = pd.to_datetime(val, errors="coerce", dayfirst=False)
        if pd.isna(ts):
            return None
        d = ts.to_pydatetime().date()
        return f"{d.year:04d}-{d.month:02d}"
    except Exception:
        return None


def _build_month_rollup(
    excel_rows: list[dict[str, Any]],
    date_col: str | None,
    route_col: str | None,
) -> dict[str, dict[str, int]]:
    """접수일이 해당 YYYY-MM 인 **엑셀 전체 행** 기준. 대내민원 = total - external."""
    from collections import defaultdict

    total_by: dict[str, int] = defaultdict(int)
    ext_by: dict[str, int] = defaultdict(int)
    for row in excel_rows:
        if not date_col:
            break
        mk = _month_key_from_excel_value(row.get(date_col))
        if not mk:
            continue
        total_by[mk] += 1
        rtxt = _route_cell_value(row, route_col)
        if _is_external_complaint(rtxt):
            ext_by[mk] += 1
    out: dict[str, dict[str, int]] = {}
    for mk, t in total_by.items():
        e = ext_by[mk]
        out[mk] = {"total": t, "external": e, "internal": t - e}
    return out


def _find_age_column(sample_row: dict[str, Any]) -> str | None:
    """엑셀 「연령대」 열 이름 (공백 무시)."""
    for k in sample_row.keys():
        sk = str(k).replace(" ", "").replace("\u3000", "")
        if sk == "연령대":
            return str(k)
    return None


def _age_label_from_excel_value(val: Any, age_col_set: bool) -> str:
    """연령대 셀 값 → 라벨. 열 없음은 호출부에서 처리."""
    if not age_col_set:
        return "미상"
    if val is None:
        return "미상"
    try:
        if bool(pd.isna(val)):  # type: ignore[arg-type]
            return "미상"
    except Exception:
        pass
    if isinstance(val, float) and math.isnan(val):
        return "미상"
    s = str(val).strip()
    return s if s else "미상"


def _build_month_age_rollup(
    excel_rows: list[dict[str, Any]],
    date_col: str | None,
) -> dict[str, dict[str, int]]:
    """접수일이 month_rollup과 동일한 열·규칙. 월별 연령대 건수(대내·대외 구분 없음)."""
    from collections import defaultdict

    if not excel_rows or not date_col:
        return {}
    age_col = _find_age_column(excel_rows[0])
    out: dict[str, defaultdict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in excel_rows:
        mk = _month_key_from_excel_value(row.get(date_col))
        if not mk:
            continue
        label = _age_label_from_excel_value(row.get(age_col), bool(age_col))
        out[mk][label] += 1
    return {k: dict(v) for k, v in out.items()}


def _sanitize_excel_cell(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):  # type: ignore[arg-type]
            return None
    except Exception:
        pass
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "isoformat"):
        return str(value).split()[0][:10] if " " in str(value) else str(value)[:10]
    return value


def _sanitize_excel_row(row: dict[str, Any]) -> dict[str, Any]:
    return {str(k): _sanitize_excel_cell(v) for k, v in row.items()}


def _is_external_complaint(route_text: str) -> bool:
    """대외: 금융감독원 또는 한국소비자원(보호원) 계열."""
    v = str(route_text or "").strip()
    if not v:
        return False
    if "금융감독원" in v or "금감원" in v:
        return True
    if "한국소비자원" in v or "한국소비자보호원" in v or "소비자보호원" in v or "소비자원" in v:
        return True
    return False


def _route_cell_value(excel_row: dict[str, Any], route_col: str | None) -> str:
    if not route_col:
        return ""
    route_val = excel_row.get(route_col, "")
    if route_val is not None and not isinstance(route_val, str):
        return str(route_val).strip()
    return str(route_val or "").strip()


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/parse/monthly-data")
async def parse_monthly_data(
    excel_file: UploadFile = File(...), word_files: list[UploadFile] = File(default=[])
) -> dict[str, Any]:
    if not excel_file.filename:
        raise HTTPException(status_code=400, detail="Excel file is required.")

    excel_raw = await excel_file.read()
    try:
        excel_df = pd.read_excel(BytesIO(excel_raw))
    except Exception as exc:  # pragma: no cover - parsing library exception
        raise HTTPException(status_code=400, detail=f"Excel parsing failed: {exc}") from exc

    excel_df = _normalize_columns(excel_df)
    receipt_col = _find_excel_receipt_column(excel_df)
    if not receipt_col:
        raise HTTPException(
            status_code=400,
            detail="Excel must contain receipt number column (기관접수번호 or 접수번호).",
        )

    excel_df[receipt_col] = excel_df[receipt_col].astype(str).str.strip()
    excel_rows = excel_df.to_dict(orient="records")
    excel_index = {str(row.get(receipt_col, "")).strip(): row for row in excel_rows if str(row.get(receipt_col, "")).strip()}

    parsed_words: list[dict[str, Any]] = []
    for word_file in word_files:
        if not word_file.filename:
            continue
        parsed_words.append(_parse_word_file(await word_file.read(), word_file.filename))

    word_by_receipt: dict[str, dict[str, Any]] = {}
    for w in parsed_words:
        rn = str(w.get("receipt_number") or "").strip()
        if rn and rn not in word_by_receipt:
            word_by_receipt[rn] = w

    route_col = _find_route_column(excel_df)
    date_col = _find_best_date_column(excel_df)
    month_rollup = _build_month_rollup(excel_rows, date_col, route_col)
    month_age_rollup = _build_month_age_rollup(excel_rows, date_col)

    # 엑셀 전체 행 기준(접수번호 유무와 무관): 카드 '엑셀전체/대외/대내'가 합이 맞도록
    external_total = sum(
        1
        for row in excel_rows
        if _is_external_complaint(_route_cell_value(row, route_col))
    )
    internal_total = len(excel_rows) - external_total

    unified_records: list[dict[str, Any]] = []
    external_with_word = 0

    for excel_row in excel_rows:
        rn = str(excel_row.get(receipt_col, "") or "").strip()
        if not rn:
            continue
        route_val = _route_cell_value(excel_row, route_col)

        is_external = _is_external_complaint(route_val)
        complaint_scope = "대외" if is_external else "대내"

        word_data = word_by_receipt.get(rn) if is_external else None
        word_matched = bool(word_data)
        if is_external and word_matched:
            external_with_word += 1
        sections = word_data["sections"] if word_data else {}
        wf_name = word_data["file_name"] if word_data else ""

        unified_records.append(
            {
                "receipt_number": rn,
                "excel_row": _sanitize_excel_row(dict(excel_row)),
                "complaint_scope": complaint_scope,
                "word_file_name": wf_name or None,
                "word_sections": sections,
                "word_matched": word_matched,
            }
        )

    word_matched_excel_count = sum(
        1
        for w in parsed_words
        if str(w.get("receipt_number") or "").strip() in excel_index
    )

    merged_preview = []
    for word in parsed_words[:20]:
        receipt_number = str(word.get("receipt_number") or "").strip()
        base_row = excel_index.get(receipt_number, {})
        merged_preview.append(
            {
                "receipt_number": receipt_number,
                "excel_row": base_row,
                "word_file_name": word["file_name"],
                "word_sections": word["sections"],
            }
        )

    return {
        "ok": True,
        "excel_total": len(excel_rows),
        "word_total": len(parsed_words),
        "external_total": external_total,
        "internal_total": internal_total,
        "matched_total": word_matched_excel_count,
        "external_with_word_total": external_with_word,
        "unmatched_word_files": [
            w["file_name"]
            for w in parsed_words
            if not w.get("receipt_number") or str(w.get("receipt_number")).strip() not in excel_index
        ],
        "preview_rows": merged_preview,
        "unified_records": unified_records,
        "route_column": route_col,
        "date_column": date_col,
        "month_rollup": month_rollup,
        "month_age_rollup": month_age_rollup,
        "excel_columns": list(excel_df.columns),
    }
