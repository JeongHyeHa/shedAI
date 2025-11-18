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

// === 시간 정규식: '시' 또는 ':' 필수 (단순 숫자 금지) ===
// '11월' 같은 월 표기의 숫자를 시간으로 인식하지 않도록
const TIME_RE = /\b(?:오전|오후)?\s*([01]?\d|2[0-3])\s*(?::\s*([0-5]\d))?\s*시?\b/i;

// === 상대일(내일/모레/글피/오늘) + (오전/오후) 시:분 파서 ===
function parseKoreanRelativeDateTime(input, today = new Date()) {
  if (!input) return null;
  const text = String(input).trim();

  // 상대일 단어
  let dayOffset = 0;
  if (/(내일)/.test(text)) dayOffset = 1;
  else if (/(모레)/.test(text)) dayOffset = 2;
  else if (/(글피)/.test(text)) dayOffset = 3;
  else if (/(오늘)/.test(text)) dayOffset = 0;
  else return null; // 상대일 단어가 없으면 null 반환

  // 시간/분 추출: '시' 또는 ':' 필수
  const m = TIME_RE.exec(text);

  // 시간 정보가 없으면 여기선 처리하지 않음(기존 패턴에 맡김)
  if (!m) return null;

  const ampmMatch = /(오전|오후)/i.exec(text);
  const ampm = ampmMatch ? ampmMatch[1] : null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;

  // 12시간제 보정
  if (ampm && /오후/i.test(ampm)) {
    if (hour < 12) hour += 12;
  } else if (ampm && /오전/i.test(ampm)) {
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

export const parseDateString = (text, today = new Date()) => {
  // 공백 정규화: NBSP( ) 등도 스페이스로 치환 후 압축
  let norm = String(text).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  // (day:n) 주석이 있으면 날짜 해석에서 제외
  if (/\(day:\d+\)/.test(norm)) {
    norm = norm.replace(/\(day:\d+\)/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  console.log('[parseDateString] 입력(norm):', norm, 'today:', today);

  const base = today || new Date();

  // === 1) 절대 날짜 먼저 처리 ===
  // '일' 뒤에 조사(에/까지/부터)나 문장부호가 와도 매칭되도록 처리
  const ABS_KR_RE = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*(?:에|까지|부터))?(?=$|[^가-힣0-9])/;
  // 숫자 형식: YYYY.MM.DD 또는 YYYY-MM-DD 또는 YYYY/MM/DD
  const ABS_DOT_RE = /(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})(?=$|[^0-9])/;

  let dt = null;
  let y, m, d;

  const mAbsKr = ABS_KR_RE.exec(norm);
  if (mAbsKr) {
    y = mAbsKr[1] ? parseInt(mAbsKr[1], 10) : base.getFullYear();
    m = parseInt(mAbsKr[2], 10);
    d = parseInt(mAbsKr[3], 10);
    dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    console.log('[parseDateString] 절대날짜(한국어) 매칭:', dt);
  }

  if (!dt) {
    const mAbsDot = ABS_DOT_RE.exec(norm);
    if (mAbsDot) {
      y = parseInt(mAbsDot[1], 10);
      m = parseInt(mAbsDot[2], 10);
      d = parseInt(mAbsDot[3], 10);
      dt = new Date(y, m - 1, d, 0, 0, 0, 0);
      console.log('[parseDateString] 절대날짜(숫자) 매칭:', dt);
    }
  }

  // === 2) 상대 날짜 처리 ===
  if (!dt) {
    // 한국어 "이번주/다음주/오는 + 요일" 처리 (월요일=주 시작)
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
    const weekPhraseDate = parseKoreanWeekPhrase(norm, base);
    if (weekPhraseDate) {
      dt = weekPhraseDate;
      console.log('[parseDateString] 상대날짜(주) 매칭:', dt);
    }
  }

  // 기존 patterns로 상대 날짜 처리
  if (!dt) {
    const patterns = [
      { regex: /이번\s*주\s*(월|화|수|목|금|토|일)요일/, type: 'thisWeek' },
      { regex: /다음\s*주\s*(월|화|수|목|금|토|일)요일/, type: 'nextWeek' },
      { regex: /다음\s*(월|화|수|목|금|토|일)요일/, type: 'nextWeekday' },
      { regex: /오는\s*(월|화|수|목|금|토|일)요일/, type: 'comingWeekday' },
      { regex: /이번\s*(월|화|수|목|금|토|일)요일/, type: 'thisWeekday' },
      { regex: /(\d+)\s*일\s*(후|뒤)/, type: 'daysAfter' },
      { regex: /(\d+)\s*주\s*(후|뒤)/, type: 'weeksAfter' },
      { regex: /(\d+)\s*일\s*(안|안에|내|이내)/, type: 'daysWithin' },
      { regex: /(\d+)\s*주\s*(안|안에|내|이내)/, type: 'weeksWithin' }
    ];

    for (const pattern of patterns) {
      const flags = (pattern.regex.flags || '').replace(/[gy]/g, '');
      const re = new RegExp(pattern.regex.source, flags);
      const match = re.exec(norm);
      if (match) {
        dt = parseDateByType(match, pattern.type, base);
        if (dt) {
          console.log('[parseDateString] 상대날짜 패턴 매칭:', pattern.type, dt);
          break;
        }
      }
    }
  }

  // 상대일+시각 처리 (상대일 단어가 있는 경우만)
  if (!dt) {
    const relDT = parseKoreanRelativeDateTime(norm, base);
    if (relDT) {
      dt = relDT;
      console.log('[parseDateString] 상대일+시각 매칭:', dt);
    }
  }

  // "이번 달/다음 달"과 같은 월 마감 표현 처리
  if (!dt) {
    const monthRangeMatch = norm.match(/(이번|이\s*번|이달|다음)\s*달\s*(?:안|안에|까지|내|말|말까지)?/);
    if (monthRangeMatch) {
      const keyword = monthRangeMatch[1].replace(/\s+/g, '');
      const year = base.getFullYear();
      const month = base.getMonth();
      if (keyword === '다음') {
        dt = new Date(year, month + 2, 0, 0, 0, 0, 0); // 다음 달의 마지막 날
      } else {
        dt = new Date(year, month + 1, 0, 0, 0, 0, 0); // 이번 달의 마지막 날
      }
      console.log('[parseDateString] 월 마감 표현 매칭:', keyword === '다음' ? '다음달' : '이번달', dt);
    }
  }

  // 날짜를 찾지 못하면 null 반환
  if (!dt || isNaN(dt.getTime())) {
    console.log('[parseDateString] 매칭 실패, null 반환');
    return { date: null, hasTime: false, time: null };
  }

  // === 3) 시간 처리 (날짜가 있을 때만) ===
  let hasTime = false;
  let time = null;

  const mTime = TIME_RE.exec(norm);
  if (mTime && dt) {
    const ampmMatch = /(오전|오후)/i.exec(norm);
    const ampm = ampmMatch ? ampmMatch[1] : null;
    let hh = parseInt(mTime[1], 10);
    const mm = mTime[2] ? parseInt(mTime[2], 10) : 0;

    if (ampm && /오후/i.test(ampm) && hh < 12) hh += 12;
    if (ampm && /오전/i.test(ampm) && hh === 12) hh = 0;

    dt.setHours(hh, mm, 0, 0);
    hasTime = true;
    time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    console.log('[parseDateString] 시각 매칭:', time);
  } else {
    console.log('[parseDateString] 시각 매칭 없음');
  }

  return { date: dt, hasTime, time };
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
      
    case 'daysWithin':
      // "N일 안에"는 오늘을 포함한 N일이므로, 실제로는 (N-1)일 후가 마감일
      const daysWithin = parseInt(match[1]);
      const daysWithinDate = new Date(today);
      daysWithinDate.setDate(today.getDate() + (daysWithin - 1));
      return daysWithinDate;
      
    case 'weeksAfter':
    case 'weeksWithin':
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
