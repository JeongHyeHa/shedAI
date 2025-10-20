// 서버측 한국어 날짜 전처리 및 day:x 환산 유틸

function resetToStartOfDay(date, isEnd = false) {
  const d = new Date(date);
  if (isEnd) d.setHours(23, 59, 59, 999); else d.setHours(0, 0, 0, 0);
  return d;
}

function getGptDayIndex(date) {
  const js = date.getDay();
  return js === 0 ? 7 : js; // 월=1 ... 일=7
}

function formatLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:00`;
}

function getKoreanDayIndex(sym) {
  const map = { '월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':7 };
  return map[sym] || 0;
}

// 절대/상대 표현을 Date로 환산
function parseDateString(dateStr, baseDate = new Date()) {
  if (!dateStr) return null;
  const today = resetToStartOfDay(baseDate);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentDate = today.getDate();
  const currentDay = today.getDay(); // 0..6

  // 상대: 오늘/내일/모레
  const relMap = [
    { re: /오늘|금일/i, days: 0 },
    { re: /내일|익일/i, days: 1 },
    { re: /모레|명일/i, days: 2 }
  ];
  for (const { re, days } of relMap) {
    if (re.test(dateStr)) {
      const d = new Date(today);
      d.setDate(currentDate + days);
      return d;
    }
  }

  // 이번주/다음주 요일
  const thisWeek = /이번\s*주\s*(월|화|수|목|금|토|일)요일/i;
  const nextWeek = /다음\s*주\s*(월|화|수|목|금|토|일)요일/i;
  const nextDay = /다음\s*(월|화|수|목|금|토|일)요일/i;
  const comingDay = /오는\s*(월|화|수|목|금|토|일)요일/i;
  if (thisWeek.test(dateStr)) {
    const m = dateStr.match(thisWeek);
    const target = getKoreanDayIndex(m[1]);
    const add = (target - currentDay + 7) % 7;
    const d = new Date(today); d.setDate(currentDate + add); return d;
  }
  if (nextWeek.test(dateStr)) {
    const m = dateStr.match(nextWeek);
    const target = getKoreanDayIndex(m[1]);
    const add = (target - currentDay + 7) % 7 + 7;
    const d = new Date(today); d.setDate(currentDate + add); return d;
  }
  if (nextDay.test(dateStr) || comingDay.test(dateStr)) {
    const m = dateStr.match(nextDay) || dateStr.match(comingDay);
    const target = getKoreanDayIndex(m[1]);
    const add = currentDay < target ? (target - currentDay) : 7 - (currentDay - target);
    const d = new Date(today); d.setDate(currentDate + add); return d;
  }

  // YYYY년 M월 D일
  const fullDate = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;
  if (fullDate.test(dateStr)) {
    const m = dateStr.match(fullDate);
    return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
  }
  // M월 D일 (연 추정)
  const monthDay = /(\d{1,2})월\s*(\d{1,2})일/;
  if (monthDay.test(dateStr)) {
    const m = dateStr.match(monthDay);
    const mon = parseInt(m[1],10)-1; const day = parseInt(m[2],10);
    let year = currentYear;
    if (mon < currentMonth || (mon === currentMonth && day < currentDate)) year += 1;
    return new Date(year, mon, day);
  }

  // N일/주 후
  const daysLater = /(\d+)일\s*(후|뒤)/;
  if (daysLater.test(dateStr)) {
    const m = dateStr.match(daysLater); const add = parseInt(m[1],10);
    const d = new Date(today); d.setDate(currentDate + add); return d;
  }
  const weeksLater = /(\d+)주\s*(후|뒤)/;
  if (weeksLater.test(dateStr)) {
    const m = dateStr.match(weeksLater); const add = parseInt(m[1],10) * 7;
    const d = new Date(today); d.setDate(currentDate + add); return d;
  }
  return null;
}

function convertToRelativeDay(targetDate, baseDate = new Date()) {
  if (!targetDate) return null;
  const startBase = resetToStartOfDay(baseDate);
  const startTarget = resetToStartOfDay(targetDate);
  const diffDays = Math.ceil((startTarget - startBase) / (1000*60*60*24));
  return getGptDayIndex(baseDate) + diffDays;
}

// 메시지 내 한국어 날짜 표현을 (day:X)로 주입
function preprocessMessageForDays(message, baseDate = new Date()) {
  if (!message || typeof message !== 'string') return message;
  const tokens = [
    /\b오늘\b/gi,
    /\b금일\b/gi,
    /\b내일\b/gi,
    /\b익일\b/gi,
    /\b모레\b/gi,
    /(이번\s*주\s*(월|화|수|목|금|토|일)요일)/gi,
    /(다음\s*주\s*(월|화|수|목|금|토|일)요일)/gi,
    /(다음\s*(월|화|수|목|금|토|일)요일)/gi,
    /(오는\s*(월|화|수|목|금|토|일)요일)/gi,
    /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/gi,
    /(\d{1,2})월\s*(\d{1,2})일/gi,
    /(\d+)일\s*(후|뒤)/gi,
    /(\d+)주\s*(후|뒤)/gi
  ];

  let out = message;
  tokens.forEach(re => {
    out = out.replace(re, (m) => {
      // 이미 (day: 가 붙어있다면 그대로
      if (/\(day:\d+\)/.test(m)) return m;
      const d = parseDateString(m, baseDate);
      if (!d) return m;
      const rel = convertToRelativeDay(d, baseDate);
      return `${m} (day:${rel})`;
    });
  });
  return out;
}

module.exports = {
  resetToStartOfDay,
  getGptDayIndex,
  formatLocalISO,
  parseDateString,
  convertToRelativeDay,
  preprocessMessageForDays
};


