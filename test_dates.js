const axios = require('axios');

// 현재 날짜 정보
const currentDate = new Date('2025-10-19'); // 일요일
const currentDayName = '일요일';
const dayOfWeek = 0; // 일요일 = 0

console.log(`📅 현재 날짜: ${currentDate.getFullYear()}년 ${currentDate.getMonth() + 1}월 ${currentDate.getDate()}일 (${currentDayName})`);
console.log(`📅 현재 요일 번호: ${dayOfWeek} (0=일요일, 1=월요일, ..., 6=토요일)`);
console.log(`📅 AI day 계산 기준: day 1 = 월요일, day 7 = 일요일\n`);

// 이전 코드의 핵심 함수들 추가
function resetToStartOfDay(date, isEnd = false) {
  const newDate = new Date(date);
  if (isEnd)
    newDate.setHours(23, 59, 59, 999);
  else
    newDate.setHours(0, 0, 0, 0);
  return newDate;
}

function getGptDayIndex(date) {
  const jsDay = date.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function parseDateString(dateStr, baseDate = new Date()) {
  if (!dateStr) return null;
  
  const today = resetToStartOfDay(baseDate);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentDate = today.getDate();
  const currentDay = today.getDay();
  
  // 이번주 토요일/일요일 패턴 처리
  const thisWeekPattern = /이번\s*주\s*(월|화|수|목|금|토|일)요일/i;
  const nextWeekPattern = /다음\s*주\s*(월|화|수|목|금|토|일)요일/i;
  
  if (thisWeekPattern.test(dateStr)) {
    const match = dateStr.match(thisWeekPattern);
    const targetDay = getKoreanDayIndex(match[1]);
    const daysToAdd = (targetDay - currentDay + 7) % 7;
    
    const result = new Date(today);
    result.setDate(currentDate + daysToAdd);
    return result;
  }
  
  if (nextWeekPattern.test(dateStr)) {
    const match = dateStr.match(nextWeekPattern);
    const targetDay = getKoreanDayIndex(match[1]);
    const daysToAdd = (targetDay - currentDay + 7) % 7 + 7;
    
    const result = new Date(today);
    result.setDate(currentDate + daysToAdd);
    return result;
  }
  
  // X월 XX일 패턴 처리
  const monthDayPattern = /(\d{1,2})월\s*(\d{1,2})일/;
  if (monthDayPattern.test(dateStr)) {
    const match = dateStr.match(monthDayPattern);
    const month = parseInt(match[1], 10) - 1;
    const day = parseInt(match[2], 10);
    
    let year = currentYear;
    if (month < currentMonth || (month === currentMonth && day < currentDate)) {
      year += 1;
    }
    
    return new Date(year, month, day);
  }
  
  return null;
}

function getKoreanDayIndex(dayName) {
  const days = {
    '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 7
  };
  return days[dayName] || 0;
}

function convertToRelativeDay(targetDate, baseDate = new Date()) {
  if (!targetDate) return null;
  
  const startOfBaseDate = resetToStartOfDay(baseDate);
  const startOfTargetDate = resetToStartOfDay(targetDate);
  
  const diffTime = startOfTargetDate.getTime() - startOfBaseDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const todayGptDay = getGptDayIndex(baseDate);
  
  return todayGptDay + diffDays;
}

// 날짜 전처리 함수
// 안전한 경계 \b를 쓰고, '내일모레'를 가장 먼저 처리
// 날짜는 DateParser(또는 동일 로직)로 계산해서 (day:X) 주입
// 시간 토큰은 명시 HH:mm으로 정규화. 날짜가 없으면 '오늘'로 보강.

function preprocessMessage(text) {
    const base = resetToStartOfDay(currentDate);
  
    const toDay = (d) => {
      const diffDays = Math.ceil((resetToStartOfDay(d) - base) / (1000*60*60*24));
      return getGptDayIndex(base) + diffDays;
    };
  
    let out = text;
  
    // === 한글 안전 경계 (lookbehind 미사용) ===
    // 왼쪽 경계: 문두 또는 비-한영숫자 1글자 캡쳐 -> 치환 시 보존
    // 오른쪽 경계: 문미 또는 비-한영숫자 (lookahead만 사용)
    const KB = {
      L: '(^|[^가-힣A-Za-z0-9])',
      R: '(?=$|[^가-힣A-Za-z0-9])'
    };
  
    // 유틸: “prefix + 본문” 형태 치환
    const wrap = (re, replacer) =>
      out = out.replace(re, (...args) => {
        const prefix = args[1] ?? '';         // 캡쳐된 왼쪽 한 글자 또는 문두
        const full   = args[0].slice(prefix.length); // 매칭 본문 (prefix 제거)
        return prefix + replacer(full, args);
      });
  
    // === 0) ‘…까지’ 선처리: 날짜표현 + ‘까지’ → 먼저 날짜표현에 (day:X) 주입 ===
    // 0-1) 상대 단어 + 까지
    const REL_WORDS = ['내일모레','금일','오늘','익일','내일','명일','모레'];
    wrap(new RegExp(`${KB.L}(${REL_WORDS.join('|')})\\s*까지${KB.R}`,'g'), (body)=>{
      const word = body.replace(/까지.*$/,''); // 본문에서 단어만
      const daysMap = { 금일:0, 오늘:0, 익일:1, 내일:1, 명일:1, 모레:2, 내일모레:2 };
      const d = new Date(base); d.setDate(d.getDate() + (daysMap[word] ?? 0));
      const day = toDay(d);
      return `${word} (day:${day}) (마감일: day:${day})`;
    });
  
    // 0-2) 복합 날짜표현 + 까지
    const DEADLINE_PAT = new RegExp(
      `${KB.L}((?:이번\\s*주\\s*[월화수목금토일]요일|다음\\s*주\\s*[월화수목금토일]요일|다다음\\s*주\\s*[월화수목금토일]요일|` +
      `\\d{4}\\s*년\\s*\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일|` +
      `\\d+\\s*(?:일|주)\\s*(?:후|뒤)))\\s*까지${KB.R}`, 'g');
    wrap(DEADLINE_PAT, (body)=>{
      const token = body.replace(/\s*까지.*$/,'');
      const parsed = parseDateString(token, base);
      if (!parsed) return body; // 파싱 실패 시 원문 유지
      const day = toDay(parsed);
      return `${token} (day:${day}) (마감일: day:${day})`;
    });
  
    // === 1) 결합어 우선: 내일모레
    wrap(new RegExp(`${KB.L}(내일모레)${KB.R}`, 'g'), (body)=>{
      const d = new Date(base); d.setDate(d.getDate() + 2);
      return `${body} (day:${toDay(d)})`;
    });
  
    // === 2) 단일 상대 날짜들 (이미 태깅된 토큰 재태깅 방지)
    const REL = [
      { word:'금일', days:0 }, { word:'오늘', days:0 },
      { word:'익일', days:1 }, { word:'내일', days:1 }, { word:'명일', days:1 },
      { word:'모레', days:2 },
    ];
    for (const {word, days} of REL) {
      wrap(new RegExp(`${KB.L}(${word})(?![^()]*\\))${KB.R}`, 'g'), (body)=>{
        const d = new Date(base); d.setDate(d.getDate() + days);
        return `${body} (day:${toDay(d)})`;
      });
    }
  
    // === 3) 복합 날짜표현 (요일/주차/절대일/N일후·N주후) → parseDateString
    const COMPLEX = [
      new RegExp(`${KB.L}(이번\\s*주\\s*[월화수목금토일]요일)${KB.R}`, 'g'),
      new RegExp(`${KB.L}(다음\\s*주\\s*[월화수목금토일]요일)${KB.R}`, 'g'),
      new RegExp(`${KB.L}(다다음\\s*주\\s*[월화수목금토일]요일)${KB.R}`, 'g'),
      new RegExp(`${KB.L}((\\d{4})\\s*년\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일)${KB.R}`, 'g'),
      new RegExp(`${KB.L}((\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일)${KB.R}`, 'g'),
      new RegExp(`${KB.L}((\\d+)\\s*일\\s*(후|뒤))${KB.R}`, 'g'),
      new RegExp(`${KB.L}((\\d+)\\s*주\\s*(후|뒤))${KB.R}`, 'g'),
    ];
    for (const pat of COMPLEX) {
      wrap(pat, (body)=>{
        const parsed = parseDateString(body, base);
        if (!parsed) return body;
        return `${body} (day:${toDay(parsed)})`;
      });
    }
  
    // === 4) 시간 토큰 정규화(HH:mm). ‘…에’ 유무와 상관없이 토큰 자체만 교체
    let foundTime = false;
    const injectTime = (orig, hour) => {
      foundTime = true;
      const hh = String(hour).padStart(2,'0');
      return orig.replace(/(자정|정오|오전\s*12시|오후\s*12시|00시|12시|\d{1,2}시)/, `${hh}:00`);
    };
  
    // 시간 패턴 (왼쪽경계 캡쳐 방식)
    wrap(new RegExp(`${KB.L}(자정)${KB.R}`, 'g'), (b)=> injectTime(b,0));
    wrap(new RegExp(`${KB.L}(정오)${KB.R}`, 'g'), (b)=> injectTime(b,12));
    wrap(new RegExp(`${KB.L}(오전\\s*12시)${KB.R}`, 'g'), (b)=> injectTime(b,0));
    wrap(new RegExp(`${KB.L}(오후\\s*12시)${KB.R}`, 'g'), (b)=> injectTime(b,12));
    wrap(new RegExp(`${KB.L}(00시)${KB.R}`, 'g'), (b)=> injectTime(b,0));
    wrap(new RegExp(`${KB.L}(12시)${KB.R}`, 'g'), (b)=> injectTime(b,12));
    wrap(new RegExp(`${KB.L}오전\\s*(\\d{1,2})시${KB.R}`, 'g'), (b,h)=> injectTime(b,(parseInt(h,10)%12)));
    wrap(new RegExp(`${KB.L}오후\\s*(\\d{1,2})시${KB.R}`, 'g'), (b,h)=> injectTime(b,(parseInt(h,10)%12)+12));
    wrap(new RegExp(`${KB.L}(\\d{1,2})시${KB.R}`, 'g'), (b,h)=>{
      const n = parseInt(h,10);
      return injectTime(b, n===12 ? 12 : n);
    });
  
    // === 5) ‘시간만 있고 날짜가 전혀 없는 경우’에만 day 보강 ===
    const hasDay = /\(day:\d+\)/.test(out);
    const hasExplicitDate = /((이번|다음|다다음)\s*주\s*[월화수목금토일]요일)|(오늘|금일|익일|내일|명일|모레|내일모레)|(\d{1,2}\s*월\s*\d{1,2}\s*일)|(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)|(\d+\s*(일|주)\s*(후|뒤))/.test(out);
  
    if (!hasDay && foundTime && !hasExplicitDate) {
      out = `(day:${getGptDayIndex(base)}) ` + out;
    }
  
    return out;
  }
  
  
  

// 테스트할 날짜 표현들
const testCases = [
  "오늘 졸업작품 제출",
  "내일 회의",
  "모레 발표", 
  "다음주 화요일까지 프로젝트 완료",
  "10월 25일 회의",
  "12월 1일 발표",
  "00시에 작업",
  "12시에 점심",
  "오후 12시에 회의",
  "자정에 마무리",
  "정오에 식사",
  "금일 작업",
  "익일 회의",
  "명일 발표",
  "내일모레까지 완료"
];

async function testDateParsing() {
  console.log('🧪 날짜 파싱 테스트 시작...\n');
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const processedMessage = preprocessMessage(testCase);
    console.log(`\n${i + 1}. 테스트: "${testCase}"`);
    console.log(`   전처리된 메시지: "${processedMessage}"`);
    
    try {
      const response = await axios.post('http://localhost:3001/api/schedule/generate', {
        messages: [{ role: 'user', content: processedMessage }],
        nowOverride: '2025-10-19T00:00:00',   // 서버 기준일 강제
        anchorDay: 7                          // 오늘 = day 7 고정
      });
      
      if (response.data.ok && response.data.schedule.length > 0) {
        console.log('✅ 성공!');
        
        // Debug 정보 출력
        if (response.data.__debug) {
          console.log('🔍 DEBUG:', response.data.__debug);
        }
        
        console.log('📅 생성된 스케줄:');
        response.data.schedule.forEach(day => {
          // day 값을 실제 날짜로 변환 (앵커 day 사용)
          const anchor = response.data.__debug?.anchorDay ?? 7; // Use anchorDay from debug info
          const dayOffset = day.day - anchor;
          const actualDate = new Date(currentDate);
          actualDate.setDate(actualDate.getDate() + dayOffset);
          
          const actualDateStr = `${actualDate.getFullYear()}년 ${actualDate.getMonth() + 1}월 ${actualDate.getDate()}일`;
          console.log(`   Day ${day.day} (${day.weekday}) = ${actualDateStr}:`);
          day.activities.forEach(activity => {
            console.log(`     - ${activity.title} (${activity.start}-${activity.end})`);
          });
        });
        if (response.data.explanation) {
          console.log('💡 설명:', response.data.explanation);
        }
      } else {
        console.log('❌ 실패:', response.data.message || '스케줄 생성 실패');
      }
    } catch (error) {
      console.log('❌ 에러:', error.message);
    }
    
    // 요청 간 간격
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n🏁 테스트 완료!');
}

testDateParsing().catch(console.error);
