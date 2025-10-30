// dateUtils.js: 날짜 관련 유틸리티 함수들

export const resetToStartOfDay = (date) => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

// 로컬 타임존 기준 YYYY-MM-DD 문자열로 변환
export function toYMDLocal(value) {
  if (!value) return '';
  const d = (value instanceof Date) ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

// === NEW: 상대일(내일/모레/글피/오늘) + (오전/오후) 시:분 파서 ===
function parseKoreanRelativeDateTime(input, today = new Date()) {
  if (!input) return null;
  const text = String(input).trim();

  // 상대일 단어
  let dayOffset = 0;
  if (/(내일)/.test(text)) dayOffset = 1;
  else if (/(모레)/.test(text)) dayOffset = 2;
  else if (/(글피)/.test(text)) dayOffset = 3;
  else if (/(오늘)/.test(text)) dayOffset = 0;

  // 시간/분 추출: (오전|오후)? HH(:mm)?  — “2시 30분”, “14:00”, “오후 2시”
  const timeRe = /(?:(오전|오후)\s*)?(\d{1,2})(?:\s*시)?(?:\s*[:시]\s*(\d{1,2}))?(?:\s*분)?/;
  const m = text.match(timeRe);

  // 시간 정보가 없으면 여기선 처리하지 않음(기존 패턴에 맡김)
  if (!m) return null;

  const ampm = m[1];              // "오전" | "오후" | undefined
  let hour   = parseInt(m[2], 10);
  const minute = m[3] ? parseInt(m[3], 10) : 0;

  // 12시간제 보정
  if (ampm === '오후') {
    if (hour !== 12) hour += 12;
  } else if (ampm === '오전') {
    if (hour === 12) hour = 0;
  }

  // 기준일 00:00 + dayOffset
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  base.setDate(base.getDate() + dayOffset);

  // 결과 시각 적용
  const result = new Date(base);
  result.setHours(hour, minute, 0, 0);
  return result; // Date 객체 반환
}

export const parseDateString = (text, today) => {
  // 공백 정규화: NBSP( ) 등도 스페이스로 치환 후 압축
  let norm = String(text).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  // (day:n) 주석이 있으면 날짜 해석에서 제외
  if (/\(day:\d+\)/.test(norm)) {
    norm = norm.replace(/\(day:\d+\)/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  console.log('[parseDateString] 입력(norm):', norm, 'today:', today);

  // === NEW: 상대일+시각 우선 처리 ===
  const relDT = parseKoreanRelativeDateTime(norm, today);
  if (relDT) {
    console.log('[parseDateString] 상대일+시각 매칭:', relDT);
    return relDT; // Date 객체
  }

  // 한국어 "이번주/다음주/오는 + 요일" 우선 처리 (월요일=주 시작)
  const KO_WD = { '월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':7 };
  const startOfIsoWeek = (d) => {
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const js = dt.getDay();              // 0=Sun..6=Sat
    const iso = js === 0 ? 7 : js;       // 1=Mon..7=Sun
    dt.setDate(dt.getDate() - (iso - 1)); // go to Monday
    dt.setHours(0,0,0,0);
    return dt;
  };
  const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
  const parseKoreanWeekPhrase = (s, base) => {
    const m = s.match(/(이번주|다음주|오는)\s*(월|화|수|목|금|토|일)요일?/);
    if (!m) return null;
    const when = m[1];
    const wd = m[2];
    const target = KO_WD[wd];
    const baseMon = startOfIsoWeek(base);
    if (when === '이번주') {
      return addDays(baseMon, target - 1);
    }
    if (when === '오는') {
      const cand = addDays(baseMon, target - 1);
      const todayMid = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      if (cand >= todayMid) return cand;      // 이번 주에 남아있으면 이번 주
      return addDays(baseMon, 7 + (target - 1)); // 아니면 다음 주
    }
    if (when === '다음주') {
      return addDays(baseMon, 7 + (target - 1));
    }
    return null;
  };
  const weekPhraseDate = parseKoreanWeekPhrase(norm, today);
  if (weekPhraseDate) {
    return weekPhraseDate;
  }
  
  const patterns = [
    { regex: /이번\s*주\s*(월|화|수|목|금|토|일)요일/, type: 'thisWeek' },
    { regex: /다음\s*주\s*(월|화|수|목|금|토|일)요일/, type: 'nextWeek' },
    { regex: /(\d{1,2})\s*월\s*(\d{1,2})\s*일\b/, type: 'monthDay' },
    { regex: /(\d+)일\s*(후|뒤)/, type: 'daysAfter' },
    { regex: /(\d+)주\s*(후|뒤)/, type: 'weeksAfter' },
    { regex: /다음\s*(월|화|수|목|금|토|일)요일/, type: 'nextWeekday' },
    { regex: /오는\s*(월|화|수|목|금|토|일)요일/, type: 'comingWeekday' },
    { regex: /이번\s*(월|화|수|목|금|토|일)요일/, type: 'thisWeekday' },
    { regex: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\b/, type: 'fullDate' }
  ];

  for (const pattern of patterns) {
    // 어떤 환경에서도 g/y가 섞이지 않게 "비-글로벌 사본"으로 exec
    const flags = (pattern.regex.flags || '').replace(/[gy]/g, ''); // g,y 제거
    const re = new RegExp(pattern.regex.source, flags);            // u는 필요시 유지
    const match = re.exec(norm);
    console.log('[parseDateString] 패턴 테스트:', pattern.type, '매치:', match);
    if (match) {
      const result = parseDateByType(match, pattern.type, today);
      console.log('[parseDateString] parseDateByType 결과:', result);
      return result;
    }
  }
  
  console.log('[parseDateString] 매칭 실패, null 반환');
  return null;
};

const parseDateByType = (match, type, today) => {
  const weekdays = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
  
  switch (type) {
    case 'thisWeek':
    case 'thisWeekday':
      const thisWeekday = weekdays[match[1]];
      const thisWeekDate = new Date(today);
      const thisWeekDayDiff = (thisWeekday - today.getDay() + 7) % 7;
      thisWeekDate.setDate(today.getDate() + thisWeekDayDiff);
      return thisWeekDate;
      
    case 'nextWeek':
    case 'nextWeekday':
    case 'comingWeekday':
      const nextWeekday = weekdays[match[1]];
      const nextWeekDate = new Date(today);
      const nextWeekDayDiff = (nextWeekday - today.getDay() + 7) % 7 + 7;
      nextWeekDate.setDate(today.getDate() + nextWeekDayDiff);
      return nextWeekDate;
      
    case 'monthDay': {
      const month = parseInt(match[1], 10);
      const day = parseInt(match[2], 10);
      console.log('[parseDateByType] monthDay:', { month, day, matchArray: match });
      if (!Number.isFinite(month) || !Number.isFinite(day)) {
        console.warn('[parseDateByType] month/day 파싱 실패:', match);
        return null;
      }
      const monthDayDate = new Date(today.getFullYear(), month - 1, day);
      console.log('[parseDateByType] monthDayDate 생성:', monthDayDate);
      return monthDayDate;
    }
      
    case 'daysAfter':
      const days = parseInt(match[1]);
      const daysAfterDate = new Date(today);
      daysAfterDate.setDate(today.getDate() + days);
      return daysAfterDate;
      
    case 'weeksAfter':
      const weeks = parseInt(match[1]);
      const weeksAfterDate = new Date(today);
      weeksAfterDate.setDate(today.getDate() + (weeks * 7));
      return weeksAfterDate;
      
    case 'fullDate':
      const year = parseInt(match[1]);
      const fullMonth = parseInt(match[2]);
      const fullDay = parseInt(match[3]);
      return new Date(year, fullMonth - 1, fullDay);
      
    default:
      return null;
  }
};

export const convertToRelativeDay = (date, today) => {
  const diffTime = date.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};
