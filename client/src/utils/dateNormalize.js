// 날짜/타임존 일관화 유틸리티
// Firestore Timestamp, Date, 문자열을 안전하게 ISO 날짜로 변환 (로컬 기준)

// 로컬 자정 Date로 정규화 (Timestamp, Date, 문자열, 숫자 모두 지원)
const toLocalMidnightDate = (v) => {
  if (v === null || v === undefined) return null;

  // Firestore Timestamp
  if (v?.toDate) v = v.toDate();

  // 이미 Date
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }

  // 'YYYY-MM-DD' 안전 파싱 (UTC 해석 방지)
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const yy = Number(m[1]);
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      const dt = new Date(yy, mm - 1, dd);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    // 그 외 문자열은 한 번 Date로 만든 후 로컬 자정 적용(최후 방어)
    const d2 = new Date(v);
    if (Number.isNaN(d2.getTime())) return null;
    return new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  }

  // timestamp number
  if (typeof v === 'number') {
    const d3 = new Date(v);
    if (Number.isNaN(d3.getTime())) return null;
    return new Date(d3.getFullYear(), d3.getMonth(), d3.getDate());
  }

  return null;
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

export const startOfTodayLocal = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export const isAfterTodayLocal = (v) => {
  const d0 = toLocalMidnightDate(v);
  if (!d0) return false;
  return d0.getTime() > startOfTodayLocal().getTime();
};

export const isTodayOrAfterLocal = (v) => {
  const d0 = toLocalMidnightDate(v);
  if (!d0) return false;
  return d0.getTime() >= startOfTodayLocal().getTime();
};

export { toLocalMidnightDate }; // 필요 시 외부에서 사용
