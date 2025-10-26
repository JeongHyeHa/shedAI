const DAY_MAP = { '월':1,'화':2,'수':3,'목':4,'금':5,'토':6,'일':7 };
const DAY_WORD_SETS = [
  { re: /(매일|매|every\s*day)/i, days: [1,2,3,4,5,6,7] }, // ← 매 추가
  { re: /(평일|평)/, days: [1,2,3,4,5] },
  { re: /(주말)/, days: [6,7] },
];

// 오전/오후/자정/정오 보정
function normalizeKoreanTimeText(text) {
  return text
    .replace(/자정/g, '오전 0시')
    .replace(/정오/g, '오후 12시')
    .replace(/밤\s*(\d{1,2})시/g, '오후 $1시')
    .replace(/새벽\s*(\d{1,2})시/g, '오전 $1시')
    .replace(/낮\s*(\d{1,2})시/g, '오후 $1시')
    .replace(/오전\s*(\d{1,2})시/g, (_, h) => `${String(h).padStart(2,'0')}:00`)
    .replace(/오후\s*12시/g, '12:00')  // 오후 12시는 12:00으로 고정 (24:00 방지)
    .replace(/오후\s*(\d{1,2})시/g, (_, h) => `${String((parseInt(h)+12)%24).padStart(2,'0')}:00`);
}

const toHHMM = (h, m=0) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

// "오전 7시", "오후 3시", "정오", "자정", "07:30", "7시30분" 모두 지원
function parseKoreanTime(token) {
  if (!token) return null;
  let t = normalizeKoreanTimeText(token);

  const m1 = t.match(/(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (m1) {
    const h = Math.min(23, parseInt(m1[1],10));
    const m = m1[2] ? Math.min(59, parseInt(m1[2],10)) : 0;
    return {h,m};
  }

  const m2 = t.match(/^(\d{3,4})$/);
  if (m2) {
    const s = m2[1];
    const h = parseInt(s.slice(0, s.length-2),10);
    const m = parseInt(s.slice(-2),10);
    return {h:Math.min(23,h), m:Math.min(59,m)};
  }
  return null;
}

// "00시~23시", "오전 7시~오후 3시", "자정~정오"
function extractTimeRange(text) {
  const norm = normalizeKoreanTimeText(text);
  const re = /(\d{1,2}\s*(?::\s*\d{1,2})?\s*시?|자정|정오|오전\s*\d{1,2}\s*시?|오후\s*\d{1,2}\s*시?)\s*[-~]\s*(\d{1,2}\s*(?::\s*\d{1,2})?\s*시?|자정|정오|오전\s*\d{1,2}\s*시?|오후\s*\d{1,2}\s*시?)/;
  const m = norm.match(re);
  if (!m) return null;
  const s = parseKoreanTime(m[1]);
  const e = parseKoreanTime(m[2]);
  if (!s || !e) return null;
  return { start: toHHMM(s.h, s.m), end: toHHMM(e.h, e.m), spanText: m[0] };
}

function extractDays(text) {
  // 키워드 우선
  for (const set of DAY_WORD_SETS) {
    if (set.re.test(text)) return set.days;
  }

  // 1, 2, 3 … 리스트
  const numberListMatch = text.match(/(\d\s*,\s*)+\d/);
  if (numberListMatch) {
    const numbers = numberListMatch[0].split(',').map(n => parseInt(n.trim(), 10));
    const valid = numbers.filter(n => n >= 1 && n <= 7);
    if (valid.length) return [...new Set(valid)].sort((a,b)=>a-b);
  }

  // ⚠️ '수면'의 '수' 오인 방지: 구분자로 둘러싸인 "독립된 요일"만 잡기
  const days = [];
  const dayTokenRe = /(?:^|[\s,·])([월화수목금토일])(?:요일)?(?=$|[\s,·])/g;
  let m;
  while ((m = dayTokenRe.exec(text)) !== null) {
    const ch = m[1];
    const d = DAY_MAP[ch];
    if (d) days.push(d);
  }
  if (days.length) return [...new Set(days)].sort((a,b)=>a-b);

  return null;
}

// 시간이 없는 문장을 자동 추론
function inferTimeFromTitle(title) {
  if (!title) return { start: '09:00', end: '18:00' }; // 기본 근무형
  const t = title.toLowerCase();

  if (t.includes('수면') || t.includes('잠') || t.includes('취침'))
    return { start: '00:00', end: '07:00' };
  if (t.includes('공부') || t.includes('과제') || t.includes('시험'))
    return { start: '21:00', end: '02:00' };
  if (t.includes('운동') || t.includes('헬스') || t.includes('러닝'))
    return { start: '19:00', end: '21:00' };
  if (t.includes('출근') || t.includes('회사') || t.includes('근무'))
    return { start: '09:00', end: '18:00' };
  if (t.includes('식사') || t.includes('밥') || t.includes('점심'))
    return { start: '12:00', end: '13:00' };
  if (t.includes('산책') || t.includes('휴식'))
    return { start: '18:00', end: '19:00' };

  return { start: '09:00', end: '18:00' }; // 기본
}

function extractTitle(text, removed = []) {
  let t = text;

  // 0) 이미 감지된 시간범위(spanText)를 가장 먼저 제거
  removed.forEach(chunk => {
    if (chunk && t.includes(chunk)) t = t.replace(chunk, ' ');
  });

  // 1) 식사 표기 통일 (먼저)
  t = t.replace(/아침\s*식\s*사/g, '아침 식사')
       .replace(/점심\s*식\s*사/g, '점심 식사')
       .replace(/저녁\s*식\s*사/g, '저녁 식사');

  // 2) "시간 범위"를 먼저 제거해야 구분자(~, -)가 안 남음
  t = t.replace(
    /(오전|오후|새벽|낮|밤)?\s*\d{1,2}\s*(?::\s*\d{1,2})?\s*(시)?\s*[~\-]\s*(오전|오후|새벽|낮|밤)?\s*\d{1,2}\s*(?::\s*\d{1,2})?\s*(시)?/g,
    ' '
  ).replace(
    /\b\d{1,2}:\d{2}\s*[~\-]\s*\d{1,2}:\d{2}\b/g,
    ' '
  );

  // 3) 요일 범위 ("월~금", "화~토요일") — 경계 기반으로 제거
  t = t.replace(
    /(?:^|[\s,·•])(?:[월화수목금토일](?:요일)?)\s*[~\-]\s*(?:[월화수목금토일](?:요일)?)(?=$|[\s,·•])/g,
    ' '
  );

  // 4) 개별 요일 — 경계 기반으로만 제거 (수면의 '수' 보존)
  t = t.replace(
    /(?:^|[\s,·•])([월화수목금토일])(요일)?(?=$|[\s,·•])/g,
    ' '
  );

  // 5) 남은 단일 시간 표현 제거 (오전 7시, 20시, 07:30 등)
  t = t.replace(/(오전|오후|새벽|낮|밤)\s*\d{1,2}(?:\s*시(?:\s*\d{1,2}분)?)?/g, ' ')
       .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
       .replace(/\b\d{1,2}\s*시(?:\s*\d{1,2}분)?\b/g, ' ');

  // 6) 키워드 제거 — '평'(평일 축약), '매'(매일 축약)도 한글 경계로 제거
  // 영어 every day 는 그대로 \b 써도 OK
  t = t
    // 매일/평일/주말/매/평 (한글 경계)
    .replace(/(?:^|[\s,·•])(?:매일|평일|주말)(?=$|[\s,·•])/gi, ' ')
    .replace(/(?:^|[\s,·•])(?:매|평)(?=$|[\s,·•])/g, ' ')
    // 영어 every day
    .replace(/\bevery\s*day\b/gi, ' ');

  // 7) 남은 구분자/틸다 정리
  t = t.replace(/[~\-–—|:/]+/g, ' ')
       .replace(/[·•]+/g, ' ');

  // 8) 여분 공백 및 가장자리 구분자 제거
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[~\-–—|·•,:;]+/, '').replace(/[~\-–—|·•,:;]+$/, '').trim();

  // 9) 단일 요일 글자만 남았으면 비우기
  if (/^[월화수목금토일]$/.test(t)) t = '';

  // 10) 빈 문자열이면 기본값
  if (!t || /^[0-9]+$/.test(t)) return '활동';
  return t;
}

export function parseLifestyleLine(line) {
  const raw = (line||'').replace(/\s+/g,' ').trim();
  const time = extractTimeRange(raw);
  const days = extractDays(raw);
  const title = extractTitle(raw, [time?.spanText]);

  // 시간이 없으면 제목으로 추론
  const inferred = !time ? inferTimeFromTitle(title) : time;

  return {
    days: days || [1,2,3,4,5,6,7],
    start: inferred.start,
    end: inferred.end,
    title
  };
}

export function parseLifestyleLines(input) {
  if (!input) return [];
  const lines = input.split('\n').map(s=>s.trim()).filter(Boolean);
  return lines.map(parseLifestyleLine);
}

// ✅ 디버깅용 테스트 함수
export function testExtractTitle() {
  const testCases = [
    "월~금 오전 7시~오전 8시 아침식사",
    "토요일 밤 11시~새벽 4시 수면", 
    "평일 오후 6시~오후 7시 헬스",
    "매일 자정~오전 7시 취침",
    "주말 오후 1시~오후 2시 점심식사",
    "월요일~금요일 오후 9시~오후 11시 공부",
    "화·목·토 20:00~21:00 운동",
    "매일 00:30~07:00 수면",
    "평일 09:00~18:00 출근",
    "일요일 오전 10시~오후 1시 브런치",
    "토요일 밤 11시~새벽 4시 면",
    // ✅ 한글 경계 테스트 케이스 추가
    "매 저녁식사 18:00-19:00",
    "평 헬스 20:00-21:00", 
    "평 출근 09:00-18:00",
    "매 아침식사 07:00-08:00"
  ];

  console.log("🧪 extractTitle() 테스트 결과:");
  console.log("=".repeat(60));
  
  testCases.forEach((testCase, index) => {
    const result = extractTitle(testCase);
    console.log(`${index + 1}. "${testCase}"`);
    console.log(`   → "${result}"`);
    console.log("");
  });
  
  console.log("=".repeat(60));
}