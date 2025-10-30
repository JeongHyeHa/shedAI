// 일정 명령 감지 및 제목 정제 유틸

export const APPT_END_RE = /(일정\s*추가(?:해줘|해|해주세요|해주라)?[.!]?)\s*$/;

export function endsWithAppointmentCommand(text = '') {
  return APPT_END_RE.test(String(text).trim());
}

// 날짜/시간 표현(제목에서 제거용)
const DATE_TIME_PHRASES = /(오늘|내일|모레|이번주|다음주|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}(?::|\s*시)\s*\d{0,2}\s*분?|오전|오후)\s*/g;

// 불필요 어미/조사(제목에서 제거용)
const TRAILERS = /(을|를|에|에서|으로|로|한|하게|하세요|해줘|해요|해주세요|추가|추가해줘|추가해요|추가해주세요)$/;

export function extractAppointmentTitle(raw = '') {
  let s = String(raw).trim();
  // 1) 끝의 "일정 추가"류 제거
  s = s.replace(APPT_END_RE, '').trim();
  // 2) 날짜/시간 구절 제거
  s = s.replace(DATE_TIME_PHRASES, '').trim();
  // 3) 꼬리 제거
  s = s.replace(TRAILERS, '').trim();
  // 4) 기본값
  if (!s || s.length < 2) s = '회의';
  return s;
}


