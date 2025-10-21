// 날짜/타임존 일관화 유틸리티
// Firestore Timestamp, Date, 문자열을 안전하게 ISO 날짜로 변환 (로컬 기준)

// 로컬 자정 Date로 정규화 (Timestamp, Date, 문자열 모두 지원)
const toLocalMidnightDate = (v) => {
  if (!v) return null;

  // Firestore Timestamp
  if (v?.toDate) v = v.toDate();

  // 'YYYY-MM-DD' 순수 문자열 → 로컬 자정 Date
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);       // ✔️ 로컬 자정
    return isNaN(dt) ? null : dt;
  }

  // 그 외 입력(ISO 문자열/숫자/Date)
  const dt = v instanceof Date ? v : new Date(v);
  if (isNaN(dt)) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); // ✔️ 로컬 자정
};

// Firestore Timestamp, Date, 문자열을 안전한 'YYYY-MM-DD'로 (로컬 기준)
export const toISODateLocal = (v) => {
  const d = toLocalMidnightDate(v);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;                // ✔️ 직접 포맷(UTC 변환 금지)
};

// ISO(YYYY-MM-DD)를 한국어 형식으로
export const toKoreanDate = (isoDate) => {
  if (!isoDate) return '날짜없음';
  const d = toLocalMidnightDate(isoDate);
  return d ? d.toLocaleDateString('ko-KR') : '날짜없음';
};

export { toLocalMidnightDate }; // 필요 시 외부에서 사용
