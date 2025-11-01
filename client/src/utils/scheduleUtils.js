// scheduleUtils.js: 스케줄과 관련된 모든 처리 로직을 담당하는 유틸리티
import { parseDateString } from './dateUtils';
import { toISODateLocal, toKoreanDate, toLocalMidnightDate } from './dateNormalize';
import { normalizeCategoryName } from './categoryAlias';
import { inferCategory } from './categoryClassifier';

// 디버깅 유틸리티 (환경 독립형)
const isDev =
  (typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'production') ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

const debug = (...args) => {
  if (isDev) console.log(...args);
};

// 클라이언트용 날짜 전처리 함수 (test_dates.js와 동일한 로직)
export function preprocessMessage(message, nowLike) {
  const base = resolveNow(nowLike);
  // 브라우저 호환성을 위해 lookbehind 제거
  const KB = { L: '(^|[^가-힣A-Za-z0-9])', R: '($|[^가-힣A-Za-z0-9])' };
  
  let out = message;
  let foundTime = false;
  
  // === 1) 상대 날짜들 (이미 태깅된 토큰 재태깅 방지) ===
  const REL = [
    { word: '오늘', days: 0 },
    { word: '금일', days: 0 },
    { word: '내일', days: 1 },
    { word: '익일', days: 1 },
    { word: '명일', days: 1 },
    { word: '모레', days: 2 },
    { word: '내일모레', days: 2 }
  ];
  
  const toDay = (offset) => {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    return convertToRelativeDay(d, base);
  };
  
  const wrap = (re, fn) => {
    out = out.replace(re, fn);
  };
  
  for (const { word, days } of REL) {
    wrap(new RegExp(`${KB.L}(${word})(?![^()]*\\))${KB.R}`, 'g'),
      (match, prefix, captured, suffix) => `${prefix}${captured} (day:${toDay(days)})${suffix}`
    );
  }
  
  // === 2) 주간 표현들 ===
  const WEEK = [
    { word: '이번주', offset: 0 },
    { word: '다음주', offset: 7 },
    { word: '다다음주', offset: 14 }
  ];
  
  const WEEKDAYS = [
    { word: '월요일', day: 1 },
    { word: '화요일', day: 2 },
    { word: '수요일', day: 3 },
    { word: '목요일', day: 4 },
    { word: '금요일', day: 5 },
    { word: '토요일', day: 6 },
    { word: '일요일', day: 7 }
  ];
  
  for (const { word: week, offset } of WEEK) {
    for (const { word: day, day: dayNum } of WEEKDAYS) {
      const re = new RegExp(`${KB.L}(${week})\\s*(${day})(?![^()]*\\))${KB.R}`, 'g');
      wrap(re, (match, prefix, weekWord, dayWord, suffix) => {
        // 해당 주의 시작일(월요일)을 기준으로 계산
        const d = new Date(base);
        d.setDate(d.getDate() + offset);
        
        // 해당 주의 월요일을 찾기
        const currentDayOfWeek = d.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
        const daysToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1; // 월요일까지의 일수
        d.setDate(d.getDate() - daysToMonday);
        
        // 월요일부터 목표 요일까지의 일수 계산
        const targetDayOffset = dayNum - 1; // dayNum은 1=월요일, 7=일요일
        d.setDate(d.getDate() + targetDayOffset);
        
        const finalDay = convertToRelativeDay(d, base);
        return `${prefix}${weekWord} ${dayWord} (day:${finalDay})${suffix}`;
      });
    }
  }
  
  // === 2-1) '이번/다음/다다음 주말' 처리 ===
  for (const { word: week, offset } of WEEK) {
    const reWeekend = new RegExp(`${KB.L}(${week})\\s*주말(?![^()]*\\))${KB.R}`, 'g');
    wrap(reWeekend, (match, prefix, weekWord, suffix) => {
      const d = new Date(base);
      d.setDate(d.getDate() + offset);
      const dow = d.getDay();                 // 0=일
      const toMonday = dow === 0 ? 6 : dow - 1;
      d.setDate(d.getDate() - toMonday);      // 그 주 월요일
      const sat = new Date(d); sat.setDate(d.getDate() + 5);
      const sun = new Date(d); sun.setDate(d.getDate() + 6);
      const satDay = convertToRelativeDay(sat, base);
      const sunDay = convertToRelativeDay(sun, base);
      return `${prefix}${weekWord} 토요일 (day:${satDay}) 일요일 (day:${sunDay})${suffix}`;
    });
  }
  
  // === 2-2) '오는/다음/이번 + 요일' 단독 표현 ===
  const RELWEEK = [
    { key: '이번', add: 0 },
    { key: '오는', add: 0 },
    { key: '다음', add: 7 }
  ];
  for (const { key, add } of RELWEEK) {
    for (const { word: day, day: dayNum } of WEEKDAYS) {
      const re = new RegExp(`${KB.L}(${key})\\s*(${day})(?![^()]*\\))${KB.R}`, 'g');
      wrap(re, (m, prefix, kw, dw, suffix) => {
        const d = new Date(base);
        d.setDate(d.getDate() + add);
        // 다음 발생 요일로 스냅
        const cur = d.getDay() === 0 ? 7 : d.getDay();
        let delta = dayNum - cur;
        if (delta < 0) delta += 7;
        if (kw === '다음' && delta === 0) delta = 7;
        d.setDate(d.getDate() + delta);
        return `${prefix}${kw} ${dw} (day:${convertToRelativeDay(d, base)})${suffix}`;
      });
    }
  }
  
  // === 3) 특정 날짜들 ===
  const DATE_PATTERNS = [
    // (추가) YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD
    { re: /(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?![^()]*\))/g,
      fn: (m, year, month, day) => {
        const yy = parseInt(year, 10);
        const mm = parseInt(month, 10) - 1;
        const dd = parseInt(day, 10);
        const d = new Date(yy, mm, dd);
        // 유효성: 역직렬화해서 연/월/일 동일해야 함
        if (d.getFullYear() === yy && d.getMonth() === mm && d.getDate() === dd) {
          return `${m} (day:${convertToRelativeDay(d, base)})`;
        }
        return m; // 무효하면 그대로 반환(태깅 생략)
      }
    },
    // (추가) MM.DD / MM-DD / MM/DD  (연도 미기재 시, base 기준으로 지난 날짜면 내년으로 밀기)
    { re: /(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?!\d)(?![^()]*\))/g,
      fn: (m, month, day) => {
        const yy = base.getFullYear();
        const mm = parseInt(month, 10) - 1;
        const dd = parseInt(day, 10);
        let d = new Date(yy, mm, dd);
        // 옵션: 이미 과거면 내년
        if (d < resetToStartOfDay(base)) d = new Date(yy + 1, mm, dd);
        // 유효성: 역직렬화해서 연/월/일 동일해야 함
        if (d.getMonth() === mm && d.getDate() === dd) {
          return `${m} (day:${convertToRelativeDay(d, base)})`;
        }
        return m; // 무효하면 그대로 반환(태깅 생략)
      }
    },
    { re: /(\d{1,2})\s*월\s*(\d{1,2})\s*일(?![^()]*\))/g, fn: (m, month, day) => {
      const yy = base.getFullYear();
      const mm = parseInt(month, 10) - 1;
      const dd = parseInt(day, 10);
      let d = new Date(yy, mm, dd);
      // 옵션: 이미 과거면 내년
      if (d < resetToStartOfDay(base)) d = new Date(yy + 1, mm, dd);
      // 유효성: 역직렬화해서 연/월/일 동일해야 함
      if (d.getFullYear() === yy && d.getMonth() === mm && d.getDate() === dd) {
        return `${m} (day:${convertToRelativeDay(d, base)})`;
      }
      return m; // 무효하면 그대로 반환(태깅 생략)
    }},
    { re: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?![^()]*\))/g, fn: (m, year, month, day) => {
      const yy = parseInt(year, 10);
      const mm = parseInt(month, 10) - 1;
      const dd = parseInt(day, 10);
      const d = new Date(yy, mm, dd);
      // 유효성: 역직렬화해서 연/월/일 동일해야 함
      if (d.getFullYear() === yy && d.getMonth() === mm && d.getDate() === dd) {
        return `${m} (day:${convertToRelativeDay(d, base)})`;
      }
      return m; // 무효하면 그대로 반환(태깅 생략)
    }},
    { re: /(\d+)\s*(일|주)\s*(후|뒤)(?![^()]*\))/g, fn: (m, num, unit, _) => {
      const offset = unit === '주' ? parseInt(num, 10) * 7 : parseInt(num, 10);
      const d = new Date(base);
      d.setDate(d.getDate() + offset);
      return `${m} (day:${convertToRelativeDay(d, base)})`;
    }}
  ];
  
  for (const { re, fn } of DATE_PATTERNS) {
    wrap(re, fn);
  }
  
  // === 4) 시간 표현들 ===
  const injectTime = (body, hour) => {
    foundTime = true;
    return `${body} (${hour.toString().padStart(2, '0')}:00)`;
  };

  // 분/반 처리: 반드시 '시간만' 패턴보다 먼저!
  wrap(new RegExp(`${KB.L}오전\\s*(\\d{1,2})시\\s*(\\d{1,2})분(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, mm, suffix) => {
      const hh = (parseInt(h,10) % 12).toString().padStart(2,'0');
      const m2 = parseInt(mm,10).toString().padStart(2,'0');
      foundTime = true; return `${prefix}오전 ${h}시 (${hh}:${m2})${suffix}`;
    });
  wrap(new RegExp(`${KB.L}오후\\s*(\\d{1,2})시\\s*(\\d{1,2})분(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, mm, suffix) => {
      const base = (parseInt(h,10)%12)+12;
      const hh = base.toString().padStart(2,'0');
      const m2 = parseInt(mm,10).toString().padStart(2,'0');
      foundTime = true; return `${prefix}오후 ${h}시 (${hh}:${m2})${suffix}`;
    });
  wrap(new RegExp(`${KB.L}(\\d{1,2})시\\s*(\\d{1,2})분(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, mm, suffix) => {
      const hh = (parseInt(h,10)===12?12:parseInt(h,10)).toString().padStart(2,'0');
      const m2 = parseInt(mm,10).toString().padStart(2,'0');
      foundTime = true; return `${prefix}${h}시 (${hh}:${m2})${suffix}`;
    });
  // '반' = 30분
  wrap(new RegExp(`${KB.L}오전\\s*(\\d{1,2})시\\s*반(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, suffix) => {
      const hh = (parseInt(h,10)%12).toString().padStart(2,'0');
      foundTime = true;
      return `${prefix}오전 ${h}시 (${hh}:30)${suffix}`;
    });
  wrap(new RegExp(`${KB.L}오후\\s*(\\d{1,2})시\\s*반(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, suffix) => {
      const base = (parseInt(h,10)%12)+12;
      const hh = base.toString().padStart(2,'0');
      foundTime = true;
      return `${prefix}오후 ${h}시 (${hh}:30)${suffix}`;
    });
  wrap(new RegExp(`${KB.L}(\\d{1,2})시\\s*반(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, suffix) => {
      const base = (parseInt(h,10)===12?12:parseInt(h,10));
      const hh = base.toString().padStart(2,'0');
      foundTime = true;
      return `${prefix}${h}시 (${hh}:30)${suffix}`;
    });
  
  wrap(new RegExp(`${KB.L}(자정)(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, w, suffix) => `${injectTime(`${prefix}${w}`, 0)}${suffix}`);

  wrap(new RegExp(`${KB.L}(정오)(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, w, suffix) => `${injectTime(`${prefix}${w}`, 12)}${suffix}`);

  wrap(new RegExp(`${KB.L}(오전\\s*12시)(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, w, suffix) => `${injectTime(`${prefix}${w}`, 0)}${suffix}`);

  wrap(new RegExp(`${KB.L}(오후\\s*12시)(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, w, suffix) => `${injectTime(`${prefix}${w}`, 12)}${suffix}`);

  wrap(new RegExp(`${KB.L}(00시)(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, w, suffix) => `${injectTime(`${prefix}${w}`, 0)}${suffix}`);

  wrap(new RegExp(`${KB.L}(12시)(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, w, suffix) => `${injectTime(`${prefix}${w}`, 12)}${suffix}`);

  wrap(new RegExp(`${KB.L}오전\\s*(\\d{1,2})시(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, suffix) => `${injectTime(`${prefix}오전 ${h}시`, (parseInt(h,10)%12))}${suffix}`);

  wrap(new RegExp(`${KB.L}오후\\s*(\\d{1,2})시(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, suffix) => `${injectTime(`${prefix}오후 ${h}시`, (parseInt(h,10)%12)+12)}${suffix}`);

  wrap(new RegExp(`${KB.L}(\\d{1,2})시(?![^()]*\\))${KB.R}`, 'g'),
    (m, prefix, h, suffix, ...rest) => {
      const offset = rest[rest.length - 2];
      const whole  = rest[rest.length - 1];
      const pre = whole.slice(Math.max(0, offset - 2), offset);
      if (/오전$|오후$/.test(pre)) return m; // 이미 AM/PM 규칙으로 처리됨
      const n = parseInt(h, 10);
      return `${injectTime(`${prefix}${h}시`, n === 12 ? 12 : n)}${suffix}`;
    });
  
  // === 5) '시간만 있고 날짜가 전혀 없는 경우'에만 day 보강 ===
  const hasDay = /\(day:\d+\)/.test(out);
  const hasExplicitDate = /((이번|다음|다다음)\s*주\s*[월화수목금토일]요일)|(오늘|금일|익일|내일|명일|모레|내일모레)|(\d{1,2}\s*월\s*\d{1,2}\s*일)|(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)|(\d+\s*(일|주)\s*(후|뒤))/.test(out);
  
  if (!hasDay && foundTime && !hasExplicitDate) {
    const dayTag = ` (day:${convertToRelativeDay(base, base)})`;
    // 끝 공백/구두점 앞에 삽입
    out = out.replace(/(\s*[.,!?)」』\]]*\s*)$/, `${dayTag}$1`);
  }
  
  return out;
} 

// 시간 리셋 함수: 하루의 시작 또는 끝으로 설정
export function resetToStartOfDay(date, isEnd = false) {
    const newDate = new Date(date);
    if (isEnd)
      newDate.setHours(23, 59, 59, 999);
    else
      newDate.setHours(0, 0, 0, 0);
    return newDate;
  }
  
  // 요일 변환 함수: JS 기준(일=0) → GPT 기준(월=1 ~ 일=7)
  export function getGptDayIndex(date) {
    const jsDay = date.getDay();
    return jsDay === 0 ? 7 : jsDay;
  }
  
  // 날짜 → ISO 문자열 포맷
  export function formatLocalISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }

  
  // 한국어 요일 이름을 숫자 인덱스로 변환 (월:1 ~ 일:7)
  function getKoreanDayIndex(dayName) {
    const days = {
      '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 7
    };
    return days[dayName] || 0;
  }
  
  // GPT 프롬프트: 새 시간표 생성용
export function buildShedAIPrompt(lifestyleText, taskText, nowLike) {
  const today = resolveNow(nowLike);
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const gptDayIndex = getGptDayIndex(today); // 월=1 ~ 일=7
  const dayName = dayNames[today.getDay()];
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const nowTime = `${today.getHours()}시 ${today.getMinutes()}분`;
  
  const prefix =
 `당신은 사용자의 생활 패턴과 할 일, 그 외 피드백을 바탕으로,
사용자에게 최적화된 효율적인 스케줄을 설계해주는 고급 일정 관리 전문가입니다.

[현재 기준]
지금은 ${dateStr} ${dayName} ${nowTime} 입니다. 오늘 스케줄에서 '지금 이전' 시간대에는 어떤 활동도 배치하지 마세요.
오늘(day:${gptDayIndex})의 활동은 반드시 ${nowTime} 이후 시각만 사용하세요. 과거 시간대 활동을 출력하면 안 됩니다.
모든 활동의 시간은 반드시 "HH:MM" 24시간제로 표기하세요(예: "09:00", "21:30"). "9시"처럼 모호하게 쓰지 마세요.

당신의 목표는 다음과 같습니다.
- 단순히 빈 시간을 채우는 것이 아니라, 사용자의 상황과 우선순위를 정확히 분석하여 "와, 진짜 내 상황에 맞는 일정이다!"라고 느껴질 수 있도록 설계합니다.
- 현실적으로 실현 가능한 시간표를 설계하여야 합니다. 빈 시간이라고 무조건 일정을 채우지 말고, 이전 일정들도 확인하여 언제 쉬고, 언제 추가하는 게 적합한지를 함께 계산하세요.

기본 설계 원칙
1. 사용자는 자연어로 [생활 패턴]과 [할 일 목록]을 입력합니다.  
   이를 분리 및 구조화한 후, 전체 스케줄을 JSON 형식으로 생성해야 합니다.

2. 생활 패턴(수면, 식사, 회사 일정 등)은 **고정된 일정**으로 간주되며, 절대 침범해서는 안 됩니다.  
   우선적으로 해당 시간대에 배치하고, 남는 시간(자유 시간)에만 할 일을 배치하세요.
   
   **중요한 생활 패턴 규칙:**
   - **출근/회사 업무**: 오직 평일(day:1~5)에만 배치
   - **주말(day:6, day:7)**: 출근, 회사 업무, 업무 관련 활동 절대 금지
   - **수면 패턴**: 요일별로 다를 수 있음 (예: 주말 늦잠)
   - **식사 패턴**: 요일별로 다를 수 있음 (예: 주말 늦은 아침)

[자동 작업 판단 규칙]
- AI는 다음 기준으로 작업의 성격을 **자동으로 판단**합니다.
  - 긴 집중이 필요한 과제, 논문, 코딩, 발표준비, 설계 등은 "몰입형 작업"으로 간주하고 하루 1~2회, 60~120분 단위로 배치합니다.
  - 매일 반복하거나 꾸준히 연습이 필요한 과제(공부, 연습, 복습, 운동 등)는 "반복 작업"으로 간주하고 30~90분 단위로 매일 또는 격일 배치합니다.
  - 특정 날짜·시간이 명시된 일(회의, 시험, 발표, 제출 등)은 해당 시각에 단발로 배치하고, 필요하면 그 전에 준비 시간을 자동으로 추가합니다.
- 모델이 판단한 작업 유형은 내부적으로만 반영하고, 출력 JSON의 "type" 필드는 기존 구조 그대로 유지합니다.
- 따라서 출력 형식은 지금과 동일하게 유지합니다.

3. 할 일 목록은 다음 기준에 따라 배치합니다:
   - **중요도**와 **긴급도**를 Eisenhower Matrix로 분석하여 우선순위 지정
     - 1순위: 중요 + 긴급 → 즉시 처리
     - 2순위: 중요 + 여유 → 계획적 배치
     - 3순위: 덜 중요 + 긴급 → 틈틈이 처리
     - 4순위: 덜 중요 + 여유 → 필요 시 배치
   - **마감일이 가까울수록 긴급도 상승**
   - **난이도에 따라 쉬는 시간 반영**:
     - 상: 최소 30분
     - 중: 최소 20분
     - 하: 최소 10~15분
     - 쉬는 시간의 경우 사용자의 요구사항에 따라 기준값이 달라질 수 있습니다. 사용자의 요구사항이 최우선이니 잊지 마세요. 지금 주어진 쉬는시간은 기준 값입니다.
     - 설명에 있는 키워드(벼락치기, 시험, 발표, 개념 복습 등)를 고려해서 작업을 세분화하고 반복 학습 또는 준비-실행-정리 흐름이 있도록 구성합니다.

4. 스케줄 생성 시 다음을 반드시 지켜야 합니다:
   - 활동 간 시간대 **절대 중복 금지**
   - **AI 일정 자동 설계는 2가지 모드로 제공됨**:
     * ①집중 우선 배치형: 사용자의 집중 시간대에 난이도 '상' 업무 우선 배정 (2.5시간 연속)
     * ②유동형: 작업 난이도에 따라 분할 학습(ex.50분 업무 후 20분 휴식)과 고난이도 후 휴식, 산책 시간을 제안
   - **시험/중요 작업(중요도 상, 난이도 상)은 매일 반복 배치** 필수
   - 하루 일과가 과밀하지 않도록 적절한 간격 확보

5. 요일 계산 규칙
   - \`day:1\`은 **월요일**이고, 오늘이 수요일이면 \`day:3\`
   - "오늘"이라는 표현은 반드시 현재 날짜 기준 \`day:x\`로 환산
   - 실제 날짜("5월 19일")는 사용자의 입력에서 파악하여 \`day:x\`로 변환하여 사용
   - 모든 \`day:x\`는 **오늘부터 오름차순(day:3 → day:4 → ... → day:14)**으로만 출력. 절대 되돌아가면 안 됨.

6. 주말 및 반복 일정 처리
   - **평일** = day:1~5 (월요일~금요일), **주말** = day:6~7 (토요일, 일요일)
   - **중요**: 주말(day:6, day:7)에는 출근, 회사 업무 등 평일 전용 활동을 절대 배치하지 마세요
   - 생활 패턴이 반복될 경우(예: 평일 23:00~06:30 수면), 해당 요일에 반복 배치
   - 운동 등 습관성 활동은 **되도록 동일 시간대에 반복**
   - 주말에는 휴식, 취미, 가족 시간 등 여가 활동에 집중하세요

오늘 날짜는 ${dateStr} ${dayName}(day:${gptDayIndex})요일이며, 현재 시각 ${nowTime} 이후부터의 시간대에만 할 일을 배치하세요. 이전 시간은 이미 지났으므로 제외하세요.

📌 마감일 처리 방식 안내:
- 날짜 기반 마감일("5월 19일 오전 9시", "5월 28일까지")이 주어질 경우,
  반드시 오늘 날짜를 기준으로 day:x 값을 계산하여 사용해야 합니다.
- 예: 오늘이 5월 15일(day:4)이고, 마감일이 5월 19일이면 → day:8입니다.
- "이번주 토요일"이나 "다음주 월요일"과 같은 상대적 날짜 표현도 반드시 정확히 계산해야 합니다.
- 중요: 마감일 표현 뒤에 "(day:X)" 형식으로 이미 계산된 날짜가 있다면, 반드시 그 값을 사용하세요.
  예: "이번주 토요일 (day:10)"이라면 반드시 day:10을 마감일로 사용하세요.
- 모든 할 일은 이 상대 day:x 값을 기준으로 정확히 스케줄링해야 하며,
  마감일을 초과한 일정 배치는 절대로 하지 마세요.

모든 할 일은 반드시 오늘(day:${gptDayIndex})을 기준으로 상대적 마감일을 day 숫자로 환산하여, 
해당 마감일까지 day:14, day:15 등 필요한 만큼 스케줄을 생성해야 합니다.
중요하거나 마감이 임박한 일은 오늘부터 바로 시작하고,
**절대로 day:7까지만 출력하거나 중간에 멈추지 마세요.
- 일정이 day:14 또는 그 이전에서 종료되더라도, 그 이유를 반드시 notes에 설명하세요.
- 예: "할 일의 총 소요 시간이 충분히 분산되어 day:10까지만 계획하면 됩니다."
- 계획이 짧게 끝난 경우, 사용자가 불안해하지 않도록 **왜 더 이상 배치하지 않았는지 반드시 notes에 포함**해야 합니다.

📊 활동 분류 & 비중 분석 (동적)
- 활동 카테고리는 고정값을 사용하지 말고, 이번 스케줄의 활동들을 보고 4~8개의 카테고리를 스스로 정의하세요(taxonomy).
- 예시는 "Deep work", "Admin/잡무", "Study/학습", "Exercise", "Commute", "Meals", "Chores", "Leisure" 등이나, 이번 데이터에 맞춰 더 적절한 이름을 만드세요.
- 모든 activities 항목에 "category" 필드를 추가해 반드시 해당 카테고리 중 하나로 라벨링하세요.
- 각 라벨의 총 소요시간을 합산해 전체 대비 비중(%)을 계산하여 activityAnalysis에 담으세요.
- 출력 JSON에는 아래 키를 포함합니다:
  - "taxonomy": [{ "name": "<카테고리명>", "description": "<짧은 정의>" }, ...]
  - "activityAnalysis": { "<카테고리명>": <정수 %>, ... }   // 퍼센트 합은 100이어야 함
- (선택) 활동 단위에 아래 메타를 추가해 품질을 높여도 됩니다:
  - "confidence": 0~1 사이 소수(라벨 신뢰도)
  - "altCategories": ["대안1","대안2"]  // 상위 1~2개 후보

📤 출력 형식 필수 지침 (※ 이 부분이 매우 중요)
- 출력은 반드시 아래와 같은 **JSON 형식 하나만 반환**하세요.
- **각 day별로 하나의 객체**가 있어야 하며, 각 객체는 반드시 아래 필드를 포함해야 합니다:
  - \`day\`: 오늘 기준 상대 날짜 번호 (정수, 오름차순)
  - \`weekday\`: 해당 요일 이름 (예: "수요일")
  - \`activities\`: 배열 형태로 활동 목록
    - 각 활동은 \`start\`, \`end\`, \`title\`, \`type\` 필드 포함
      - \`type\`은 "lifestyle" 또는 "task" 중 하나
- **절대 활동별로 days 배열을 반환하지 마세요!**
- 반드시 아래 예시처럼 day별로 activities를 묶어서 반환하세요.

예시:
\`\`\`json
{
  "schedule": [
    {
      "day": 3,
      "weekday": "수요일",
      "activities": [
        { "start": "06:00", "end": "07:00", "title": "회사 준비", "type": "lifestyle", "category": "Admin" },
        { "start": "08:00", "end": "17:00", "title": "근무", "type": "lifestyle", "category": "Deep work" },
        { "start": "19:00", "end": "21:00", "title": "정보처리기사 실기 개념 암기", "type": "task", "category": "Study" },
        { "start": "21:00", "end": "22:00", "title": "운동", "type": "lifestyle", "category": "Exercise" }
      ]
    },
    {
      "day": 4,
      "weekday": "목요일",
      "activities": [
        { "start": "06:00", "end": "07:00", "title": "회사 준비", "type": "lifestyle" },
        { "start": "08:00", "end": "17:00", "title": "근무", "type": "lifestyle" },
        { "start": "19:00", "end": "21:00", "title": "정보처리기사 실기 개념 암기", "type": "task" }
      ]
    }
    // ... day:14까지 반복
  ],
  "taxonomy": [
    { "name": "Deep work", "description": "집중이 필요한 주요 작업" },
    { "name": "Study", "description": "학습 및 자기계발 활동" },
    { "name": "Exercise", "description": "신체 활동 및 운동" },
    { "name": "Meals", "description": "식사 시간" },
    { "name": "Commute", "description": "출퇴근 이동 시간" },
    { "name": "Leisure", "description": "여가 및 휴식 활동" }
  ],
  "activityAnalysis": {
    "Deep work": 35,
    "Study": 20,
    "Exercise": 10,
    "Meals": 15,
    "Commute": 10,
    "Leisure": 10
  },
  "notes": [
    "정보처리기사 시험이 4일 남아 있어 상위 우선순위로 배치함.",
    "생활 패턴과 중복되지 않도록 빈 시간대를 활용하여 분산 구성.",
    "운동은 매일 저녁 같은 시간대에 반복 배치하여 습관 형성 유도."
  ]
}
\`\`\`
- **이 예시와 완전히 동일한 구조로만 출력하세요.**
- day별로 activities를 묶어서, 각 day가 하나의 객체로 배열에 들어가야 합니다.
- 다른 형식(활동별 days 배열, 텍스트 목록, 옵션1/2 구분 등)은 절대 출력하지 마세요.
- 절대로 "자유시간", "Free time", "빈 시간" 등과 같이 아무 활동이 없는 시간대를 별도의 활동으로 출력하지 마세요.
- 오직 실제 활동(수면, 식사, 회사, 할 일 등)만 activities에 포함하세요.
- 빈 시간은 activities 배열에 포함하지 않고, 단순히 비워두세요.

각 활동(activity)에는 반드시 다음 중 하나의 type 값을 포함해야 합니다:
- 생활 패턴에서 유래한 일정: "type": "lifestyle"
- 할 일이나 유동적인 작업: "type": "task"
이 값은 반드시 JSON 객체의 각 activity에 포함되어야 하며, 렌더링 및 필터링에 사용됩니다.
  `;
  
    return `${prefix}\n[생활 패턴]\n${lifestyleText}\n\n[할 일 목록]\n${taskText}`;
  }
  
  // GPT 프롬프트: 기존 시간표 수정용
  export function buildFeedbackPrompt(lifestyleText, taskText, previousSchedule) {
    // 기존 일정의 최대 일수 확인
    let maxDay = 0;
    if (previousSchedule && Array.isArray(previousSchedule)) {
      previousSchedule.forEach(day => {
        if (day.day > maxDay) maxDay = day.day;
      });
    }
    
    const prefix =
  `당신은 사용자의 생활 패턴과 할 일, 그 외 피드백을 바탕으로,
사용자에게 최적화된 효율적인 스케줄을 설계해주는 고급 일정 관리 전문가입니다.

[현재 기준]
지금은 ${new Date().getFullYear()}년 ${new Date().getMonth()+1}월 ${new Date().getDate()}일 입니다. 오늘 스케줄에서 '지금 이전' 시간대에는 어떤 활동도 배치하지 마세요.
오늘의 활동은 반드시 현재 시각 이후만 사용하세요. 과거 시간대 활동을 출력하면 안 됩니다.
모든 활동의 시간은 반드시 "HH:MM" 24시간제로 표기하세요(예: "09:00", "21:30"). "9시"처럼 모호하게 쓰지 마세요.

피드백 기반 일정 수정
- 기존 스케줄이 제공된 경우, **수정 요청이 없는 활동은 유지**
- 기존 마감일을 조기 종료하거나 삭제하지 말고, 새 작업만 병합하여 재조정
- 예: 기존 작업이 day:14까지 계획돼 있었다면, 수정 후에도 day:14까지 유지

기본 설계 원칙
1. 사용자는 자연어로 [생활 패턴]과 [할 일 목록]을 입력합니다.  
   이를 분리 및 구조화한 후, 전체 스케줄을 JSON 형식으로 생성해야 합니다.

2. 생활 패턴(수면, 식사, 회사 일정 등)은 **고정된 일정**으로 간주되며, 절대 침범해서는 안 됩니다.  
   우선적으로 해당 시간대에 배치하고, 남는 시간(자유 시간)에만 할 일을 배치하세요.
   
   **중요한 생활 패턴 규칙:**
   - **출근/회사 업무**: 오직 평일(day:1~5)에만 배치
   - **주말(day:6, day:7)**: 출근, 회사 업무, 업무 관련 활동 절대 금지
   - **수면 패턴**: 요일별로 다를 수 있음 (예: 주말 늦잠)
   - **식사 패턴**: 요일별로 다를 수 있음 (예: 주말 늦은 아침)

3. 할 일 목록은 다음 기준에 따라 배치합니다:
   - **중요도**와 **긴급도**를 Eisenhower Matrix로 분석하여 우선순위 지정
     - 1순위: 중요 + 긴급 → 즉시 처리
     - 2순위: 중요 + 여유 → 계획적 배치
     - 3순위: 덜 중요 + 긴급 → 틈틈이 처리
     - 4순위: 덜 중요 + 여유 → 필요 시 배치
   - **마감일이 가까울수록 긴급도 상승**
   - **난이도에 따라 쉬는 시간 반영**:
     - 상: 최소 30분
     - 중: 최소 20분
     - 하: 최소 10~15분
     - 쉬는 시간의 경우 사용자의 요구사항에 따라 기준값이 달라질 수 있습니다. 사용자의 요구사항이 최우선이니 잊지 마세요. 지금 주어진 쉬는시간은 기준 값입니다.
     - 설명에 있는 키워드(벼락치기, 시험, 발표, 개념 복습 등)를 고려해서 작업을 세분화하고 반복 학습 또는 준비-실행-정리 흐름이 있도록 구성합니다.

4. 스케줄 생성 시 다음을 반드시 지켜야 합니다:
   - 활동 간 시간대 **절대 중복 금지**
   - **AI 일정 자동 설계는 2가지 모드로 제공됨**:
     * ①집중 우선 배치형: 사용자의 집중 시간대에 난이도 '상' 업무 우선 배정 (2.5시간 연속)
     * ②유동형: 작업 난이도에 따라 분할 학습(ex.50분 업무 후 20분 휴식)과 고난이도 후 휴식, 산책 시간을 제안
   - **시험/중요 작업(중요도 상, 난이도 상)은 매일 반복 배치** 필수
   - 하루 일과가 과밀하지 않도록 적절한 간격 확보

5. 요일 계산 규칙
   - \`day:1\`은 **월요일**이고, 오늘이 수요일이면 \`day:3\`
   - "오늘"이라는 표현은 반드시 현재 날짜 기준 \`day:x\`로 환산
   - 실제 날짜("5월 19일")는 사용자의 입력에서 파악하여 \`day:x\`로 변환하여 사용
   - 모든 \`day:x\`는 **오늘부터 오름차순(day:3 → day:4 → ... → day:14)**으로만 출력. 절대 되돌아가면 안 됨.

6. 주말 및 반복 일정 처리
   - **평일** = day:1~5 (월요일~금요일), **주말** = day:6~7 (토요일, 일요일)
   - **중요**: 주말(day:6, day:7)에는 출근, 회사 업무 등 평일 전용 활동을 절대 배치하지 마세요
   - 생활 패턴이 반복될 경우(예: 평일 23:00~06:30 수면), 해당 요일에 반복 배치
   - 운동 등 습관성 활동은 **되도록 동일 시간대에 반복**
   - 주말에는 휴식, 취미, 가족 시간 등 여가 활동에 집중하세요

⚠️ 중요: 반드시 현재 일정의 전체 날짜 범위를 유지해야 합니다. 기존 일정이 day:${maxDay}까지 있었다면,
새 일정도 최소한 day:${maxDay}까지 포함해야 합니다. 절대로 일정을 7일 이하로 줄이지 마세요.

📊 활동 분류 & 비중 분석 (동적)
- 활동 카테고리는 고정값을 사용하지 말고, 이번 스케줄의 활동들을 보고 4~8개의 카테고리를 스스로 정의하세요(taxonomy).
- 예시는 "Deep work", "Admin/잡무", "Study/학습", "Exercise", "Commute", "Meals", "Chores", "Leisure" 등이나, 이번 데이터에 맞춰 더 적절한 이름을 만드세요.
- 모든 activities 항목에 "category" 필드를 추가해 반드시 해당 카테고리 중 하나로 라벨링하세요.
- 각 라벨의 총 소요시간을 합산해 전체 대비 비중(%)을 계산하여 activityAnalysis에 담으세요.
- 출력 JSON에는 아래 키를 포함합니다:
  - "taxonomy": [{ "name": "<카테고리명>", "description": "<짧은 정의>" }, ...]
  - "activityAnalysis": { "<카테고리명>": <정수 %>, ... }   // 퍼센트 합은 100이어야 함
- (선택) 활동 단위에 아래 메타를 추가해 품질을 높여도 됩니다:
  - "confidence": 0~1 사이 소수(라벨 신뢰도)
  - "altCategories": ["대안1","대안2"]  // 상위 1~2개 후보

📤 출력 형식 필수 지침 (※ 이 부분이 매우 중요)
- 출력은 반드시 아래와 같은 **JSON 형식 하나만 반환**하세요.
- **각 day별로 하나의 객체**가 있어야 하며, 각 객체는 반드시 아래 필드를 포함해야 합니다:
  - \`day\`: 오늘 기준 상대 날짜 번호 (정수, 오름차순)
  - \`weekday\`: 해당 요일 이름 (예: "수요일")
  - \`activities\`: 배열 형태로 활동 목록
    - 각 활동은 \`start\`, \`end\`, \`title\`, \`type\` 필드 포함
      - \`type\`은 "lifestyle" 또는 "task" 중 하나
- **절대 활동별로 days 배열을 반환하지 마세요!**
- 반드시 day별로 activities를 묶어서 반환하세요.
- 절대로 "자유시간", "Free time", "빈 시간" 등과 같이 아무 활동이 없는 시간대를 별도의 활동으로 출력하지 마세요.
- 오직 실제 활동(수면, 식사, 회사, 할 일 등)만 activities에 포함하세요.
- 빈 시간은 activities 배열에 포함하지 않고, 단순히 비워두세요.`;
  
    return `${prefix}
  
  [기존 시간표]
  ${JSON.stringify(previousSchedule, null, 2)}
  
  [사용자 피드백 및 추가 할 일]
  ${lifestyleText}
  ${taskText}
  
  [조건]
  - 기존 할 일과 새 할 일을 병합해 중요도 및 마감일 기준으로 재정렬
  - 사용자의 요구사항을 기반으로 스케줄을 재설계하기
  - 야간 작업이나 쉬는 시간 조정 같은 피드백은 반드시 반영
  - day:오늘부터 마감일까지 연속된 일정으로 출력
  - 스케줄이 조기 종료될 경우 반드시 notes에 이유를 설명하세요
  - 기존 할 일의 마감일이 수정된 게 아닌 이상, 기존의 마감일을 반드시 유지해야 하며, 절대로 더 일찍 끝내지 마세요
  - 기존 작업이 day:14까지 진행되고 있었다면, 그 작업은 최소한 day:14까지 계속 배치되어야 합니다.
  - 피드백으로 인해 새 작업이 추가되거나 시간이 부족하더라도, 기존 할 일을 삭제하거나 조기 종료하지 마세요.
  - 평일(day:1~5)과 주말(day:6~7)의 생활패턴이 다른 경우, 반드시 구분하여 적용하세요.
  - 예를 들어 "평일 07:00~08:00 아침 식사"는 오직 월~금에만 적용하고, "주말 10:00~12:00 운동"은 토,일에만 적용하세요.
  - 어떤 일정도 시간이 겹치지 않도록 주의하세요. 특히 평일/주말 구분이 있는 생활패턴 일정과 다른 할일이 겹치지 않아야 합니다.
  - 일정 간 충돌이 있을 경우, 생활패턴을 우선하고 할일은 다른 시간대로 이동시키세요.
  - ⚠️ 절대로 일정을 day:7이나 day:8까지만 출력하지 마세요. 기존 일정이 day:${maxDay}까지 있었다면 최소 그 날짜까지 모든 일정을 유지해야 합니다.
  - ⚠️ 반드시 기존 일정의 모든 활동을 포함하여 최소한 day:${maxDay}까지 스케줄을 생성하세요.
  - 상대적 날짜 표현("이번주 토요일", "다음주 수요일" 등)은 오늘 날짜 기준으로 정확히 계산해서 적용하세요.
  - 중요: 날짜 표현 뒤에 "(day:X)" 형식으로 이미 계산된 날짜가 있다면, 반드시 그 값을 사용하세요.
    예: "다음주 수요일 (day:12)"이라면 반드시 day:12를 마감일로 사용하세요.`;
  }
  
  // GPT 응답 구조를 프론트엔드 구조로 변환
  export function flattenSchedule(gptResponse) {
    if (!gptResponse || !gptResponse.schedule || !Array.isArray(gptResponse.schedule)) {
      console.warn('flattenSchedule: 유효하지 않은 gptResponse', gptResponse);
      return [];
    }

  // 서버에서 보내는 형식: [{day, weekday, activities}]
  // 요일 정규화 적용 후 반환
  return gptResponse.schedule.map(daySchedule => ({
    day: daySchedule.day,
    weekday: normalizeWeekday(daySchedule.day, daySchedule.weekday),
    activities: daySchedule.activities || []
  }));
  }


  // 요일 이상치 정규화 함수
  function normalizeWeekday(day, raw) {
    const KOREAN_WEEKDAYS = ['','월요일','화요일','수요일','목요일','금요일','토요일','일요일'];
    
    // ✅ day>7인 경우 모듈로 보정 (1~7로 래핑)
    const dayNum = Number(day) || 0;
    const wrappedDay = ((dayNum - 1) % 7 + 7) % 7 + 1; // 1~7로 래핑
    if (KOREAN_WEEKDAYS[wrappedDay]) return KOREAN_WEEKDAYS[wrappedDay];
    
    // raw 값에서 요일 추출 (공백 제거 후)
    const s = String(raw||'').replace(/\s+/g,'');
    if (s.includes('목')) return '목요일';
    if (s.includes('수')) return '수요일';
    if (s.includes('화')) return '화요일';
    if (s.includes('금')) return '금요일';
    if (s.includes('토')) return '토요일';
    if (s.includes('일')) return '일요일';
    if (s.includes('월')) return '월요일';
    
    // 기본값
    return KOREAN_WEEKDAYS[wrappedDay] || '알 수 없음';
  }

  // GPT → FullCalendar 이벤트 변환기 (배열만 받음)
export function convertScheduleToEvents(scheduleArray, nowLike = new Date()) {
  const today = resolveNow(nowLike);
  const events = [];
  const nowMin = today.getHours()*60 + today.getMinutes();
    
    const ensureHms = (tRaw) => {
      const t = String(tRaw || '00:00');
      if (/^\d+$/.test(t.trim())) {
        const h = parseInt(t, 10) || 0;
        return `${String(h).padStart(2,'0')}:00:00`;
      }
      const [h='0', m='0', s] = t.split(':');
      const hh = String(parseInt(h,10)||0).padStart(2,'0');
      const mm = String(parseInt(m,10)||0).padStart(2,'0');
      const ss = s != null ? String(parseInt(s,10)||0).padStart(2,'0') : '00';
      return `${hh}:${mm}:${ss}`;
    };
    
    // scheduleArray는 이미 정규화된 배열이어야 함
    const scheduleData = scheduleArray;
    
    // 방어 코드: scheduleData가 유효하지 않으면 빈 배열 반환
    if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) {
      // 빈 스케줄은 정상적인 경우이므로 경고 대신 디버그 로그만 출력
      debug('convertScheduleToEvents: 빈 스케줄 데이터', {
        scheduleData,
        type: typeof scheduleData,
        isArray: Array.isArray(scheduleData),
        length: scheduleData?.length
      });
      return events;
    }
    
    // 오늘의 day 값 계산 (일요일=7, 월요일=1, ..., 토요일=6)
    const todayDayOfWeek = today.getDay();
    const baseDay  = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;

    scheduleData.forEach(dayBlock => {
      if (!dayBlock || typeof dayBlock.day !== 'number') {
        console.warn('convertScheduleToEvents: 유효하지 않은 dayBlock', dayBlock);
        return;
      }
      
      const dateOffset = dayBlock.day - baseDay;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + dateOffset);
      const dateStr = formatLocalISO(targetDate).split('T')[0];
      const isToday = (targetDate.getFullYear()===today.getFullYear()
                    && targetDate.getMonth()===today.getMonth()
                    && targetDate.getDate()===today.getDate());

      // activities가 유효하지 않으면 건너뛰기
      if (!dayBlock.activities || !Array.isArray(dayBlock.activities)) {
        console.warn('convertScheduleToEvents: dayBlock.activities가 유효하지 않음', dayBlock);
        return;
      }

      dayBlock.activities.forEach(activity => {
        // activity가 유효하지 않으면 건너뛰기
        if (!activity || !activity.start || !activity.title) {
          console.warn('convertScheduleToEvents: 유효하지 않은 activity', activity);
          return;
        }
        
        const start = new Date(`${dateStr}T${ensureHms(activity.start)}`);
        let end;
        
        // end가 없을 때만 fallback duration 적용 (task는 120분, lifestyle은 90분)
        if (!activity.end) {
          const isTask = (activity.type || '').toLowerCase() === 'task';
          const fallbackDuration = isTask ? 120 : 90; // task는 120분, lifestyle은 90분
          end = new Date(start.getTime() + fallbackDuration * 60 * 1000);
        } else {
          end = new Date(`${dateStr}T${ensureHms(activity.end)}`);
        }
        
        // 카테고리 자동 분류 및 정규화 적용
        const rawCategory = activity.category || inferCategory(activity);
        const normalizedCategory = normalizeCategoryName(rawCategory);
        
        const extendedProps = {
          type: activity.type || "task",
          importance: activity.importance,
          difficulty: activity.difficulty,
          isRepeating: !!activity.isRepeating,
          description: activity.description,
          category: normalizedCategory,
          confidence: activity.confidence ?? undefined
        };
        
        // 디버깅 로그 제거 (필요시 주석 해제)
        // if (isDev && activity.type === 'task') {
        //   console.log('[convertScheduleToEvents] task 타입 이벤트 생성:', {
        //     title: activity.title,
        //     type: activity.type,
        //     start: activity.start,
        //     end: activity.end
        //   });
        // }

        // 과거 클리핑은 postprocessSchedule(enforceFutureOnly)에서만 담당

        if (end < start) {
          const endOfToday = resetToStartOfDay(start, true); // 당일 23:59:59.999
          const nextDay = new Date(start);
          nextDay.setDate(nextDay.getDate() + 1);
          const startOfNextDay = resetToStartOfDay(nextDay);

          const eventIdPrefix = `${(activity.title||'').trim()}__${dateStr}`;
          // ✅ 자정 넘는 일정 ID 일관성: 실제 end 시간과 일치
          const endOfTodayTimeStr = formatLocalISO(endOfToday).split('T')[1].slice(0, 8); // HH:MM:SS
          
          // 당일 뒷부분
          events.push({
            id: `${eventIdPrefix}__${ensureHms(activity.start)}-${endOfTodayTimeStr}`,
            title: activity.title,
            start: formatLocalISO(start),
            end: formatLocalISO(endOfToday),
            extendedProps
          });
          
          // 다음날 앞부분
          const endNext = new Date(startOfNextDay);
          endNext.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), 0); // 원래 end 시각 복제
          const nextDateStr = formatLocalISO(startOfNextDay).split('T')[0];
          const endNextTimeStr = formatLocalISO(endNext).split('T')[1].slice(0, 8); // HH:MM:SS
          events.push({
            id: `${eventIdPrefix}__next-${formatLocalISO(startOfNextDay).split('T')[1].slice(0,8)}-${endNextTimeStr}`,
            title: activity.title,
            start: formatLocalISO(startOfNextDay),
            end: formatLocalISO(endNext),
            extendedProps
          });
          return;
        }

        // 중복 방지를 위한 고유 ID 생성 (✅ 계산된 end 사용)
        const endTimeStr = formatLocalISO(end).split('T')[1].slice(0, 8); // HH:MM:SS
        const eventId = `${(activity.title||'').trim()}__${dateStr}__${ensureHms(activity.start)}-${endTimeStr}`;
        
        events.push({
          id: eventId,
          title: activity.title,
          start: formatLocalISO(start),
          end: formatLocalISO(end),
          extendedProps
        });

        // 🔄 isRepeating 태스크 자동 확장 (7일 반복)
        // ⚠️ CalendarPageRefactored.jsx의 postprocess에서 마감일 관리하므로 이 경로는 비활성화
        const ALLOW_CLIENT_AUTOREPEAT = false;
        if (ALLOW_CLIENT_AUTOREPEAT && activity.isRepeating) {
          for (let i = 1; i < 7; i++) { // 7일 반복
            const cloneDate = new Date(targetDate);
            cloneDate.setDate(targetDate.getDate() + i);
            const dateStrRepeat = formatLocalISO(cloneDate).split('T')[0];
            
            const repeatStart = new Date(`${dateStrRepeat}T${ensureHms(activity.start)}`);
            let repeatEnd;
            
            // end가 없을 때만 fallback duration 적용
            if (!activity.end) {
              const isTask = (activity.type || '').toLowerCase() === 'task';
              const fallbackDuration = isTask ? 120 : 90;
              repeatEnd = new Date(repeatStart.getTime() + fallbackDuration * 60 * 1000);
            } else {
              repeatEnd = new Date(`${dateStrRepeat}T${ensureHms(activity.end)}`);
            }
            
            events.push({
              title: activity.title,
              start: formatLocalISO(repeatStart),
              end: formatLocalISO(repeatEnd),
              extendedProps: {
                ...extendedProps,
                isRepeating: true,
                source: 'auto_repeat'
              }
            });
          }
          
          console.info('[Auto Repeat] 반복 일정 생성:', {
            title: activity.title,
            days: 7,
            timeSlot: `${activity.start}-${activity.end || 'auto'}`,
            mode: activity.mode || 'default'
          });
        }
      });
    });

    return events;
  }
  
// 날짜를 day 인덱스로 변환하는 함수 (오늘부터 상대적인 일수)
export function convertToRelativeDay(targetDate, baseDate = new Date()) {
  if (!targetDate) return null;
  const startOfBaseDate = resetToStartOfDay(baseDate);
  const startOfTargetDate = resetToStartOfDay(targetDate);
  const diffTime = startOfTargetDate.getTime() - startOfBaseDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const todayGptDay = getGptDayIndex(baseDate);
  return todayGptDay + diffDays;
}

// ============================================================
// CalendarPageRefactored에서 이동된 함수들
// ============================================================

// 타이틀 정규화 헬퍼
const normTitle = (s='') => s.replace(/\s+/g, ' ').trim();
// 의미 기준 표준 타이틀(동의/접미 제거)
const canonTitle = (s='') => {
  const base = String(s).toLowerCase();
  const stripped = base
    // 괄호/구분자/기호 제거
    .replace(/[()\[\]{}<>_\-*–—:.,\/\\|+~!@#$%^&=]/g, '')
    // 공백 제거
    .replace(/\s+/g, '')
    // 흔한 접미사 제거(어말)
    .replace(/(준비|공부|하기)$/g, '')
    // 세션 꼬리표, 진행표기 제거
    .replace(/(집중세션|세션|몰입|분할|라운드)\d*/g, '')
    .replace(/\d+\/\d+/g, '')
    .trim();
  return stripped || base.replace(/\s+/g,'');
};

// YYYY-MM-DD 문자열을 로컬 자정 Date로 파싱
const parseYYYYMMDDLocal = (s) => {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mm = +m[2], dd = +m[3];
  return new Date(y, mm - 1, dd, 0, 0, 0, 0);
};

// 유사 매칭 기반 데드라인 day 찾기
function findDeadlineDayForTitle(actTitle, deadlineMap) {
  if (!deadlineMap || !deadlineMap.size) return null;
  const actKey = canonTitle(actTitle || '');
  if (!actKey) return null;

  if (deadlineMap.has(actKey)) return deadlineMap.get(actKey);

  for (const [taskKey, dlDay] of deadlineMap.entries()) {
    if (!taskKey) continue;
    if (actKey.startsWith(taskKey) || taskKey.startsWith(actKey)) return dlDay;
    if (actKey.includes(taskKey) || taskKey.includes(actKey)) return dlDay;
  }

  const tokenize = (k) => String(k).replace(/[^가-힣a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const aTok = tokenize(actKey);
  let best = { score: 0, dlDay: null };
  for (const [taskKey, dlDay] of deadlineMap.entries()) {
    const tTok = tokenize(taskKey);
    if (tTok.length === 0 || aTok.length === 0) continue;
    const setA = new Set(aTok);
    let hit = 0;
    for (const t of tTok) if (setA.has(t)) hit++;
    const score = hit / Math.max(tTok.length, aTok.length);
    if (score > best.score) best = { score, dlDay };
  }
  return best.score >= 0.5 ? best.dlDay : null;
}

// 시간 유틸리티
const hhmmToMin = (s) => {
  const [h,m] = String(s||'').split(':').map(n=>parseInt(n||'0',10));
  return (isNaN(h)?0:h)*60 + (isNaN(m)?0:m);
};

const minToHHMM = (min) => {
  const h = Math.floor(min/60)%24;
  const m = min%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};

const overlap = (aStart, aEnd, bStart, bEnd) => Math.max(aStart,bStart) < Math.min(aEnd,bEnd);

// 상수 정의
const PREFERRED_MIN = 19 * 60;
const MIN_SPLIT_CHUNK = 30;
const FALLBACK_BLOCK = [21*60, 23*60];

// 시험/평가류 제목 판별
function isExamTitle(t='') {
  return /시험|테스트|평가|자격증|오픽|토익|토플|텝스|면접/i.test(String(t));
}

// 날짜 파싱 헬퍼
const pickNextDate = (y, m, d, today) => {
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (dt < base) dt.setFullYear(dt.getFullYear() + 1);
  return dt;
};

const tryParseLooseKoreanDate = (s, today) => {
  let m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);
  m = s.match(/(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return pickNextDate(today.getFullYear(), +m[1], +m[2], today);
  m = s.match(/(\d{1,2})\s*[\.\/\-]\s*(\d{1,2})(?!\d)/);
  if (m) return pickNextDate(today.getFullYear(), +m[1], +m[2], today);
  return null;
};

const isExamLike = (t='') => /(오픽|토익|토플|텝스|토스|면접|자격증|시험|테스트|평가)/i.test(t);

const safeParseDateString = (text, today) => {
  try { return parseDateString(text, today); } catch { return null; }
};

// YYYY.MM.DD / YYYY-MM-DD / M월 D일 + (오전|오후) HH(:mm)? "시" 조합까지 처리
function tryParseKoreanDateTime(s, today = new Date()) {
  const text = String(s || '').replace(/\s+/g, ' ').trim();

  // 1) YYYY.MM.DD HH(:mm)? (AM/PM 한국어)
  let m = text.match(/(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})\s*(오전|오후)?\s*(\d{1,2})(?::(\d{1,2}))?\s*시?/);
  if (m) {
    const y = +m[1], M = +m[2] - 1, d = +m[3];
    let h = +(m[5] || 0), mm = +(m[6] || 0);
    if (m[4] === '오후' && h < 12) h += 12;
    if (m[4] === '오전' && h === 12) h = 0;
    return new Date(y, M, d, h, mm, 0, 0);
  }

  // 2) M월 D일 (AM/PM) HH(:mm)? "시"
  m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(오전|오후)?\s*(\d{1,2})(?::(\d{1,2}))?\s*시?/);
  if (m) {
    const y = today.getFullYear(), M = +m[1] - 1, d = +m[2];
    let h = +(m[4] || 0), mm = +(m[5] || 0);
    if (m[3] === '오후' && h < 12) h += 12;
    if (m[3] === '오전' && h === 12) h = 0;
    const dt = new Date(y, M, d, h, mm, 0, 0);
    // 과거면 내년으로 밀어주는 옵션 (원래 코드 정책과 일치)
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (dt < base) dt.setFullYear(dt.getFullYear() + 1);
    return dt;
  }

  return null;
}

// 약속/회의 키워드 체크용 정규식
const APPOINTMENT_KEYWORDS = /(브런치|점심|저녁|약속|미팅|회의|면담|인터뷰|진료|병원|상담|촬영|행사|발표|수업|강의|세미나|티타임|점심 회동|식사 약속|식사)/i;

// 채팅 문장 → 태스크 파싱
export const parseTaskFromFreeText = (text, nowLike = new Date()) => {
  const today = resolveNow(nowLike);
  if (!text || typeof text !== 'string') return null;
  const s = text.replace(/\s+/g, ' ').trim();

  // 0) 날짜+시간 한 번에 잡기 (가장 우선)
  let dtFull = tryParseKoreanDateTime(s, today);

  // 1) 기존 parseDateString 시도 (시간 포함 가능)
  if (!dtFull) {
    dtFull = safeParseDateString(s, today);
    if (dtFull && isNaN(dtFull.getTime())) dtFull = null;
  }

  // 2) 날짜만 / 상대 표현만 잡히는 경우 기존 로직 유지
  let deadlineDate = dtFull;
  if (!(deadlineDate instanceof Date) || isNaN(deadlineDate.getTime())) {
    const rawCandidates = s.match(/(\d{4}\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[.\-\/]\d{1,2})/g) || [];
    for (const cand of rawCandidates) {
      const dt = tryParseLooseKoreanDate(cand, today);
      if (dt instanceof Date && !isNaN(dt.getTime())) { deadlineDate = dt; break; }
    }
  }
  if (!(deadlineDate instanceof Date) || isNaN(deadlineDate.getTime())) {
    const rel = s.match(/(\d+)\s*(일|주)\s*(후|뒤)/);
    if (rel) {
      const n = +rel[1], unit = rel[2];
      const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      base.setDate(base.getDate() + (unit === '주' ? n*7 : n));
      deadlineDate = base;
    }
  }
  if (!(deadlineDate instanceof Date) || isNaN(deadlineDate.getTime())) return null;

  // --- 시각 감지: dtFull가 유효하고 시간이 자정이 아닌 경우 우선 사용
  let deadlineTime = null;
  if (dtFull instanceof Date && !isNaN(dtFull.getTime())) {
    const hh0 = dtFull.getHours();
    const mm0 = dtFull.getMinutes();
    if (!(hh0 === 0 && mm0 === 0)) {
      deadlineTime = `${String(hh0).padStart(2,'0')}:${String(mm0).padStart(2,'0')}`;
    }
  }
  // 보강: 한국어 시각 패턴(오전/오후 HH(:mm)?시, HH(:mm)?시, '반')에서 시간 추출
  if (!deadlineTime) {
    const mAMPM = s.match(/(오전|오후)\s*(\d{1,2})(?::?(\d{1,2}))?\s*시?/);
    const mHalf = s.match(/(오전|오후)?\s*(\d{1,2})\s*시\s*반/);
    // 역탐색 없이 문맥 검사로 대체: 일반 HH시 패턴은 앞이 '오전|오후'면 스킵
    let mHHMM = null;
    {
      const reHH = /(\d{1,2})(?::(\d{1,2}))?\s*시\b/;
      const m = s.match(reHH);
      if (m) {
        const idx = (m.index != null) ? m.index : s.indexOf(m[0]);
        const pre = s.slice(Math.max(0, idx - 2), idx);
        if (!/오전$|오후$/.test(pre)) mHHMM = m;
      }
    }
    if (mAMPM) {
      let h = parseInt(mAMPM[2], 10) || 0;
      const min = parseInt(mAMPM[3] || '0', 10) || 0;
      if (mAMPM[1] === '오후' && h < 12) h += 12;
      if (mAMPM[1] === '오전' && h === 12) h = 0;
      deadlineTime = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    } else if (mHalf) {
      let h = parseInt(mHalf[2], 10) || 0;
      if (mHalf[1] === '오후' && h < 12) h += 12;
      if (mHalf[1] === '오전' && h === 12) h = 0;
      deadlineTime = `${String(h).padStart(2,'0')}:30`;
    } else if (mHHMM) {
      let h = parseInt(mHHMM[1], 10) || 0;
      const min = parseInt(mHHMM[2] || '0', 10) || 0;
      // 12시는 그대로 유지 (오전/오후 수식 없으면 그대로)
      deadlineTime = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    }
  }

  // 제목 생성
  let title = '';
  if (isExamLike(s)) {
    const word = (s.match(/(오픽|토익|토플|텝스|토스|면접|자격증|시험|테스트|평가)/i)?.[1] || '').trim();
    title = `${/시험$/i.test(word) ? word : `${word} 시험`}`.trim();
    if (/(준비|공부|학습)/.test(s)) title += ' 준비';
  } else {
    const cut = s.split(/(?:마감일|마감|데드라인|까지|due|deadline)/i)[0]
                 .split(/(\d{4}\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}[.\-\/]\d{1,2})/)[0]
                 .replace(/(있어|해야 ?해|할게|한다|해줘(요)?|합니다|해요)$/,'')
                 .trim();
    if (cut && cut.length >= 2) title = cut;
    else {
      const m = s.match(/([가-힣A-Za-z0-9]+)\s*(과제|보고서|프로젝트|발표|신청|접수|등록|업무|자료|문서)/);
      title = m ? `${m[1]} ${m[2]}` : '할 일';
    }
  }

  const levelMap = { 상:'상', 중:'중', 하:'하' };
  const impRaw = (s.match(/중요도\s*(상|중|하)/)?.[1]);
  const diffRaw = (s.match(/난이도\s*(상|중|하)/)?.[1]);
  const isExam = isExamLike(s);
  const importance = levelMap[impRaw] || (isExam ? '상' : '중');
  const difficulty = levelMap[diffRaw] || (isExam ? '상' : '중');
  const localMid = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());

  // 타입 지정: 회의/약속류는 appointment, 그 외 task
  // 키워드 OR deadlineTime 존재하면 appointment
  const looksAppointment = APPOINTMENT_KEYWORDS.test(s) || !!deadlineTime;

  const result = {
    title,
    importance,
    difficulty,
    description: s.replace(title, '').trim(),
    deadlineAtMidnight: localMid,
    deadlineTime,
    estimatedMinutes: looksAppointment ? 60 : (isExam ? 150 : 120),
    type: looksAppointment ? 'appointment' : 'task'
  };

  // 약속인데 시각이 빠졌다면, 안전 기본값(예: 12:00) 보강
  if (result.type === 'appointment' && !result.deadlineTime) {
    result.deadlineTime = '12:00';
  }

  return result;
};

// 할 일을 existingTasks와 사람이 읽는 taskText로 동시에 만들기
export const buildTasksForAI = async (uid, firestoreService, opts = {}) => {
  const fetchLocalTasks = opts.fetchLocalTasks; // async (uid) => [{ title, deadline, importance, difficulty, description, isActive }]
  let all = [];

  // Firestore
  try {
    if (firestoreService?.getAllTasks) {
      all = await firestoreService.getAllTasks(uid);
    } else {
      if (isDev) console.debug('[buildTasksForAI] firestoreService 미주입: Firestore 스킵');
      all = [];
    }
  } catch (error) {
    if (isDev) console.debug('[buildTasksForAI] Firestore 조회 실패:', error?.message);
    all = [];
  }

  // 로컬 DB
  let localDbTasks = [];
  try {
    if (typeof fetchLocalTasks === 'function') {
      localDbTasks = await fetchLocalTasks(uid);
    }
  } catch (e) {
    console.warn('[buildTasksForAI] 로컬 DB 조회 실패:', e?.message);
    localDbTasks = [];
  }

  // 로컬 스토리지
  const readTempTasks = () => {
    try {
      const cands = ['shedAI:tempTasks', 'shedAI:tasks', 'tasks'];
      for (const k of cands) {
        const s = localStorage.getItem(k);
        if (s) return JSON.parse(s);
      }
    } catch {}
    return [];
  };
  const tempTasks = readTempTasks();

  // 여러 형태의 마감일을 로컬 자정 Date로 정규화
  const toDateAtLocalMidnight = (v) => {
    try {
      if (!v) return null;
      if (v.toDate) v = v.toDate();
      if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
      if (typeof v === 'string') {
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(+m[1], +m[2]-1, +m[3]);
        const d = new Date(v);
        if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      return null;
    } catch { return null; }
  };

  const combinedTasksRaw = [...(all || []), ...(localDbTasks || []), ...(tempTasks || [])];
  const active = (combinedTasksRaw || [])
    .map(t => ({
      ...t,
      isActive: t.isActive === undefined ? true : !!t.isActive,
      deadline: toDateAtLocalMidnight(
        t?.deadline ?? t?.deadlineAtMidnight ?? t?.deadlineAt ?? t?.dueDate ?? t?.due
      )
    }))
    .filter(t => t && t.isActive);

  const existingTasksForAI = active.map(t => ({
    title: normTitle(t.title || '제목없음'),
    deadline: (() => {
      if (t.deadline instanceof Date) {
        return `${t.deadline.getFullYear()}-${String(t.deadline.getMonth()+1).padStart(2,'0')}-${String(t.deadline.getDate()).padStart(2,'0')}`;
      }
      if (typeof t.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.deadline)) return t.deadline;
      // ✅ 최후의 수단: 오늘 날짜를 사용해 캡 맵 비는 상황 방지
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    })(),
    importance: t.importance || '중',
    difficulty: t.difficulty || '중',
    description: t.description || '',
    type: (t.type || 'task'),
    deadlineTime: t.deadlineTime || null,
    estimatedMinutes: t.estimatedMinutes || 120
  }));

  const taskText = active.map(t => {
    const iso = t.deadline
      ? `${t.deadline.getFullYear()}-${String(t.deadline.getMonth()+1).padStart(2,'0')}-${String(t.deadline.getDate()).padStart(2,'0')}`
      : '';
    const dd = toKoreanDate(iso);
    return `${t.title || '제목없음'} (마감일: ${dd || '미설정'}, 중요도: ${t.importance || '중'}, 난이도: ${t.difficulty || '중'})`;
  }).join('\n');

  return { existingTasksForAI, taskText };
};

// 프롬프트에 강제 규칙 주입
const enforceScheduleRules = (basePrompt) => `${basePrompt}

[반드시 지켜야 할 규칙]
- [현재 할 일 목록]에 있는 모든 항목은 반드시 스케줄 JSON의 activities에 'type': 'task' 로 포함할 것.
- lifestyle 항목과 병합/대체 금지. task는 task로 남길 것.
- 모든 task는 start, end, title, type 필드를 포함해야 한다. (예: {"start":"19:00","end":"21:00","title":"오픽 시험 준비","type":"task"})
- lifestyle과 task의 시간은 절대 겹치지 않도록 조정할 것. 겹친다면 task를 가장 가까운 빈 시간대로 이동하라.
- 출력은 day별 객체 배열(JSON 하나)만 반환하라. 불필요한 텍스트 금지.
`;

// 공통 메시지 빌더
export const buildScheduleMessages = ({ basePrompt, conversationContext, existingTasksForAI, taskText }) => {
  const enforced = enforceScheduleRules(basePrompt);
  const messages = [
    ...conversationContext.slice(-8),
    {
      role: 'user',
      content: `${enforced}\n\n[현재 할 일 목록]\n${taskText || '할 일 없음'}`
    }
  ].filter(m => m && m.role && typeof m.content === 'string' && m.content.trim());

  return messages;
};

// 생활패턴 제목 정리 함수
const cleanLifestyleTitle = (title, start, end) => {
  if (!title) return '';
  
  const strip = (s='') => s
    .replace(/^[~\-–—|·•,:;\s]+/, '')
    .replace(/[~\-–—|·•,:;\s]+$/, '')
    .replace(/\s{2,}/g,' ')
    .trim();
  let cleaned = strip(title);

  cleaned = cleaned
    .replace(/(?:^|[\s,·•])(매일|평일|주말)(?=$|[\s,·•])/gi,' ')
    .replace(/(?:^|[\s,·•])(매|평)(?=$|[\s,·•])/g,' ')
    .replace(/\bevery\s*day\b/gi,' ');
  cleaned = strip(cleaned);

  if (/^([0-9]{2})$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    if (n === 40) cleaned = '점심식사';
    else if (n < 10) cleaned = '아침식사';
    else cleaned = '활동';
  }
  
  if (!cleaned || /^[0-9]+$/.test(cleaned)) {
    const startHour = parseInt(start?.split(':')[0] || '0', 10);
    const endHour = parseInt(end?.split(':')[0] || '0', 10);
    const wrapsMidnight = (end && start) ? (endHour < startHour) : false;

    if (wrapsMidnight || startHour < 6) {
      cleaned = '수면';
    } else if (startHour >= 6 && startHour < 9) {
      cleaned = '아침식사';
    } else if (startHour >= 12 && startHour < 14) {
      cleaned = '점심식사';
    } else if (startHour >= 9 && startHour < 18) {
      cleaned = '출근';
    } else if (startHour >= 18 && startHour < 22) {
      cleaned = '저녁식사';
    } else if (startHour >= 20 && startHour < 22) {
      cleaned = '헬스';
    } else {
      cleaned = '활동';
    }
  }
  
  return cleaned;
};

// ===== 휴식 정책 =====  // NEW
const BREAK_MINUTES_DEFAULT = 20;      // 기본 휴식
const BREAK_MINUTES_HARD    = 30;      // 중요/난이도 '상' 휴식

// 작업 난이도/중요도 기반 휴식 길이 계산  // NEW
const requiredBreakAfter = (a, override = null) => {
  if (typeof override === 'number' && override >= 0) return override;
  const imp = String(a?.importance || '').trim();
  const diff = String(a?.difficulty || '').trim();
  const isHard = imp === '상' || diff === '상' || isExamTitle(a?.title || '');
  return isHard ? BREAK_MINUTES_HARD : BREAK_MINUTES_DEFAULT;
};

// day별 lifestyle 블록에서 빈 시간대 계산
const buildFreeBlocks = (activities) => {
  const dayStart = 0;
  const dayEnd = 24*60;
  
  const rawLifestyle = (activities||[])
    .filter(a => (a.type||'').toLowerCase()==='lifestyle' && a.start && a.end)
    .map(a => [hhmmToMin(a.start), hhmmToMin(a.end)]);

  const lifestyle = [];
  for (const [s,e] of rawLifestyle) {
    if (e >= s) {
      lifestyle.push([s,e]);
    } else {
      lifestyle.push([0, e]);
      lifestyle.push([s, dayEnd]);
    }
  }
  lifestyle.sort((x,y)=>x[0]-y[0]);

  const merged = [];
  for (const [s,e] of lifestyle) {
    if (!merged.length || s>merged[merged.length-1][1]) merged.push([s,e]);
    else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], e);
  }

  const free = [];
  let cursor = dayStart;
  for (const [s,e] of merged) {
    if (cursor < s) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) free.push([cursor, dayEnd]);
  return free;
};

// 오늘(day:base)에는 현재 시각 이전 배치 금지  // NEW
const clipTodayFreeBlocksFromNow = (freeBlocks, nowMin) => {
  const out = [];
  for (const [fs, fe] of freeBlocks) {
    if (fe <= nowMin) continue;
    out.push([Math.max(fs, nowMin), fe]);
  }
  return out;
};

// 19:00 근접도 가중치 기반 배치
const placeIntoFree = (freeBlocks, durationMin, opts = {}) => {
  const preferred = PREFERRED_MIN;
  const padAfterMin = Math.max(0, Number(opts.padAfterMin || 0));  // NEW
  let best = null;

  for (const [fs, fe] of freeBlocks) {
    if (fe - fs < durationMin + padAfterMin) continue; // NEW
    const earliest = fs;
    const latest = (fe - padAfterMin) - durationMin; // NEW
    const target = preferred - durationMin / 2;
    const start = Math.min(Math.max(target, earliest), latest);
    const mid = start + durationMin / 2;
    const distance = Math.abs(mid - preferred);
    if (!best || distance < best.distance || (distance === best.distance && start < best.start)) {
      best = { start, end: start + durationMin, distance };
    }
  }
  if (best) return { start: best.start, end: best.end, padAfterMin }; // CHANGED

  let longest = null, len = -1;
  for (const [fs, fe] of freeBlocks) {
    if (fe - fs > len) { len = fe - fs; longest = [fs, fe]; }
  }
  return longest ? { start: longest[0], end: longest[0] + Math.min(len, durationMin), padAfterMin: 0 } : null; // CHANGED
};

// 분할 배치 함수
const splitPlaceIntoFree = (freeBlocks, durationMin) => {
  const sorted = [...freeBlocks].sort((a,b)=> (b[1]-b[0]) - (a[1]-a[0]));
  const segments = [];
  let remain = durationMin;

  for (const [fs, fe] of sorted) {
    if (remain <= 0) break;
    const len = fe - fs;
    if (len <= MIN_SPLIT_CHUNK) continue;
    const want = segments.length === 0 ? Math.max(MIN_SPLIT_CHUNK, remain) : remain;
    const use = Math.min(len, want, remain);
    segments.push({ start: fs, end: fs + use });
    remain -= use;
  }
  return remain <= 0 ? segments : null;
};

// 스케줄 전역에서 lifestyle과 task 충돌 제거 + 누락 task에 시간 채움
const fixOverlaps = (schedule, opts = {}) => {
  const allowed = opts.allowedTitles || new Set();
  const allowAutoRepeat = !!opts.allowAutoRepeat;
  const deadlineMap = opts.deadlineMap || new Map();
  const copy = (schedule||[]).map(day => ({
    ...day,
    activities: (day.activities||[]).map(a=>({...a}))
  }));

  const examTasks = [];
  for (const day of copy) {
    for (const a of day.activities || []) {
      if ((a.type||'').toLowerCase() === 'task') {
        const dl = findDeadlineDayForTitle(a.title || '', deadlineMap);
        if (dl && day.day > dl) {
          a.__drop__ = true;
          continue;
        }
      }
      if ((a.type||'').toLowerCase() === 'task' && 
          (a.importance === '상' || a.difficulty === '상' || a.isRepeating || isExamTitle(a.title))) {
        // ✅ 수집 단계에서는 화이트리스트 체크 없이 후보로 담기 (중요 태스크는 모두 후보)
        examTasks.push({
          title: a.title,
          importance: a.importance || (isExamTitle(a.title) ? '상' : '중'),
          difficulty: a.difficulty || (isExamTitle(a.title) ? '상' : '중'),
          duration: a.duration || 150,
          isRepeating: a.isRepeating ?? (isExamTitle(a.title) || false)
        });
      }
    }
    day.activities = day.activities.filter(a => !a.__drop__);
  }

  const lifestyleBlocksCache = new Map();

  for (const day of copy) {
    const dayKey = `${day.day}-${day.weekday}`;
    let freeBlocks = lifestyleBlocksCache.get(dayKey);
    
    if (!freeBlocks) {
      freeBlocks = buildFreeBlocks(day.activities);
      // 오늘이면 '지금 이전' 슬롯 제거  // NEW
      const baseDay = (opts.today || new Date()).getDay() === 0 ? 7 : (opts.today || new Date()).getDay();
      if (day.day === baseDay) {
        const now = opts.today || new Date();
        const nowMin = now.getHours()*60 + now.getMinutes();
        freeBlocks = clipTodayFreeBlocksFromNow(freeBlocks, nowMin);
      }
      lifestyleBlocksCache.set(dayKey, freeBlocks);
    }

    for (const a of day.activities) {
      const isLifestyle = (a.type||'').toLowerCase()==='lifestyle';
      
      if (isLifestyle) {
        a.title = cleanLifestyleTitle(a.title, a.start, a.end);
      }
      
      if (isLifestyle) continue;

      let dur = 120;
      if (a.importance === '상' || a.difficulty === '상') {
        dur = 150;
      } else if (a.difficulty === '하') {
        dur = 90;
      }
      
      if (a.start && a.end) {
        const s = hhmmToMin(a.start), e = hhmmToMin(a.end);
        const ls = day.activities.filter(x => (x.type||'').toLowerCase()==='lifestyle' && x.start && x.end);
        const hasOverlap = ls.some(x => overlap(s,e, hhmmToMin(x.start), hhmmToMin(x.end)));
        if (!hasOverlap && e>s) {
          dur = e - s;
          continue;
        }
      }
      
      // === 휴식 여유 확보 후 배치 ===  // NEW
      const breakNeed = requiredBreakAfter(a, opts.breakMinutesOverride);
      let placed = placeIntoFree(freeBlocks, dur, { padAfterMin: breakNeed });
      if (placed) {
        a.start = minToHHMM(placed.start);
        a.end = minToHHMM(placed.end);
        // 바로 뒤에 휴식 블록 삽입 (겹침 방지용) // NEW
        if (placed.padAfterMin > 0) {
          const brStart = placed.end;
          const brEnd   = placed.end + placed.padAfterMin;
          day.activities.push({
            title: '휴식/리커버리',
            start: minToHHMM(brStart),
            end:   minToHHMM(brEnd),
            type: 'task',
            importance: '중',
            difficulty: '하',
            extendedProps: { isBreak: true }
          });
          // 휴식도 점유 영역이므로 freeBlocks 재계산  // NEW
          freeBlocks = buildFreeBlocks(day.activities);
        }
      } else {
        const parts = splitPlaceIntoFree(freeBlocks, dur);
        if (parts && parts.length) {
          a.start = minToHHMM(parts[0].start);
          a.end = minToHHMM(parts[0].end);
          for (let i=1;i<parts.length;i++) {
            day.activities.push({
              title: a.title,
              start: minToHHMM(parts[i].start),
              end: minToHHMM(parts[i].end),
              type: a.type || 'task',
              importance: a.importance,
              difficulty: a.difficulty,
              isRepeating: a.isRepeating
            });
          }
          // 첫 세그먼트 뒤에도 최소 휴식 삽입 시도  // NEW
          const brStart = parts[0].end;
          const brEnd   = brStart + breakNeed;
          const canFit  = buildFreeBlocks(day.activities).some(([fs,fe]) => brStart>=fs && brEnd<=fe);
          if (canFit) {
            day.activities.push({
              title: '휴식/리커버리',
              start: minToHHMM(brStart),
              end:   minToHHMM(brEnd),
              type: 'task',
              importance: '중',
              difficulty: '하',
              extendedProps: { isBreak: true }
            });
          }
        } else {
          a.start = minToHHMM(FALLBACK_BLOCK[0]);
          a.end = minToHHMM(Math.min(FALLBACK_BLOCK[0] + dur, FALLBACK_BLOCK[1]));
          // 폴백 구간 뒤에도 휴식 끼워넣기 (가능 시)  // NEW
          const brStart = hhmmToMin(a.end);
          const brEnd   = brStart + breakNeed;
          const freeNow = buildFreeBlocks(day.activities);
          const canFit  = freeNow.some(([fs,fe]) => brStart>=fs && brEnd<=fe);
          if (canFit) {
            day.activities.push({
              title: '휴식/리커버리',
              start: minToHHMM(brStart),
              end:   minToHHMM(brEnd),
              type: 'task',
              importance: '중',
              difficulty: '하',
              extendedProps: { isBreak: true }
            });
          }
        }
      }
      if (!a.type) a.type = 'task';
    }

    if (allowAutoRepeat && examTasks.length > 0) {
      // 중요/상난이도/반복 태스크를 당일 빈 시간에 최대한 촘촘히 추가
      // 하루 상한 제거, 중복은 시간 겹침만 금지
      let guard = 0;
      while (guard++ < 20) { // 안전장치
        let added = false;
        for (const examTask of examTasks) {
          const isImportant = examTask.isRepeating || examTask.importance === '상' || examTask.difficulty === '상' || isExamTitle(examTask.title);
          if (!isImportant) continue;

          const dl = findDeadlineDayForTitle(examTask.title||'', deadlineMap);
          if (dl && day.day > dl) continue;

          // 현재 활동 전체를 점유로 간주해 자유 슬롯 계산 (겹침 방지)
          const occupied = buildOccupiedForTasks(day.activities);
          const free = freeFromOccupied(occupied);

          // 가장 이른 슬롯에 배치 (퍼뜨리지 않음)
          let placedInterval = null;
          for (const [fs, fe] of free) {
            if (fe - fs >= (examTask.duration || 150)) { placedInterval = { start: fs, end: fs + (examTask.duration || 150) }; break; }
          }
          if (!placedInterval) continue;

          // 화이트리스트 정책 우회 판단
          const titleKey = canonTitle(examTask.title||'');
          if (!allowed.has(titleKey)) {
            // 중요 태스크는 우회 허용
          }

          day.activities.push({
            title: examTask.title,
            start: minToHHMM(placedInterval.start),
            end: minToHHMM(placedInterval.end),
            type: 'task',
            importance: examTask.importance,
            difficulty: examTask.difficulty,
            isRepeating: true,
            source: 'auto_repeat'
          });
          added = true;
        }
        if (!added) break;
      }
    }

    day.activities = day.activities.filter(a => !a.__drop__).sort((x,y)=>hhmmToMin(x.start||'00:00')-hhmmToMin(y.start||'00:00'));
  }
  return copy;
};

// 요일 정규화 함수
const getKoreanWeekday = (day) => {
  const weekdays = ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
  return weekdays[day] || '알 수 없음';
};

const toWeekday1to7 = (dayNum) => ((dayNum - 1) % 7) + 1;

// 시간 문자열 정규화
const normHHMM = (t='00:00') => {
  const [h,m] = String(t).split(':').map(n=>parseInt(n||'0',10));
  const hh = isNaN(h)?0:h, mm = isNaN(m)?0:m;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
};

// AI 응답에 '생활패턴 강제 투영'
const applyLifestyleHardOverlay = (schedule, parsedPatterns) => {
  if (!Array.isArray(schedule)) return schedule;
  const patterns = Array.isArray(parsedPatterns) ? parsedPatterns : [];

  const byDayNeed = (weekday) =>
    patterns.filter(p => (p.days || [1,2,3,4,5,6,7]).includes(weekday));

  return schedule.map(day => {
    const weekday = toWeekday1to7(day.day || 1);
    const need = byDayNeed(weekday);

    const acts = Array.isArray(day.activities) ? [...day.activities] : [];

    const filtered = acts.filter(a => {
      if ((a.type || '').toLowerCase() !== 'lifestyle') return true;
      const start = normHHMM(a.start || '00:00');
      const end = normHHMM(a.end || '23:00');
      const titleNorm = cleanLifestyleTitle(a.title, start, end);
      const hasTodayPattern = need.some(p => {
        const pStart = normHHMM(p.start || '00:00');
        const pEnd = normHHMM(p.end || '23:00');
        const pTitle = cleanLifestyleTitle(p.title, pStart, pEnd);
        return pStart === start && pEnd === end && pTitle === titleNorm;
      });
      return hasTodayPattern;
    });

    const existingKey = new Set(
      filtered
        .filter(a => (a.type || '').toLowerCase() === 'lifestyle')
        .map(a => `${normHHMM(a.start||'00:00')}-${normHHMM(a.end||'23:00')}::${cleanLifestyleTitle(a.title, a.start, a.end)}`)
    );

    for (const p of need) {
      const s = normHHMM(p.start || '00:00');
      const e = normHHMM(p.end || '23:00');
      const t = cleanLifestyleTitle(p.title, s, e);
      const key = `${s}-${e}::${t}`;
      if (!existingKey.has(key)) {
        filtered.push({
          title: t,
          start: s,
          end: e,
          type: 'lifestyle',
          // ✅ __days를 extendedProps로 옮겨 유지 (후속 필터링/충돌조정 참고용)
          extendedProps: { days: p.days || [1,2,3,4,5,6,7] }
        });
      }
    }

    filtered.sort((x,y) => hhmmToMin(x.start || '00:00') - hhmmToMin(y.start || '00:00'));

    return { ...day, activities: filtered };
  });
};

// 상대 day 정규화
const normalizeRelativeDays = (schedule, baseDay) => {
  const arr = Array.isArray(schedule) ? schedule : [];
  let current = baseDay;
  return arr.map((dayObj, idx) => {
    let dayNum = Number.isInteger(dayObj?.day) ? dayObj.day : (baseDay + idx);
    if (idx === 0 && dayNum !== baseDay) dayNum = baseDay;
    if (dayNum < current) dayNum = current;
    if (idx > 0 && dayNum <= current) dayNum = current + 1;
    current = dayNum;
    const weekdayNum = ((dayNum - 1) % 7) + 1;
    return {
      ...dayObj,
      day: dayNum,
      weekday: getKoreanWeekday(weekdayNum)
    };
  });
};

// 각 제목의 마감 day 계산
const buildDeadlineDayMap = (existingTasks = [], todayDate) => {
  const map = new Map();
  const base = todayDate.getDay() === 0 ? 7 : todayDate.getDay();
  const toMid = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  // ✅ Timestamp/Date/문자열 모두 안전하게 처리 (YYYY-MM-DD는 로컬 자정으로)
  const toDateSafe = (v) => {
    if (!v) return null;
    if (v.toDate) return v.toDate();           // Firestore Timestamp
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const ymd = parseYYYYMMDDLocal(v);
      if (ymd) return ymd;
      const parsed = new Date(v);
      if (!isNaN(parsed.getTime())) return parsed;
      const iso = toISODateLocal(v);
      return iso ? new Date(iso) : null;
    }
    return null;
  };
  
  for (const t of (existingTasks || [])) {
    const d0 = toDateSafe(t.deadline);
    if (!d0 || isNaN(d0.getTime())) continue;
    const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()); // 로컬 자정
    const diffDays = Math.floor((toMid(d) - toMid(todayDate)) / (24*60*60*1000));
    const deadlineDay = base + Math.max(0, diffDays);
    map.set(canonTitle(t.title || ''), deadlineDay);
  }
  return map;
};

// 마감일 이후의 task 제거
const capTasksByDeadline = (schedule, deadlineMap) => {
  return (schedule || []).map(day => ({
    ...day,
    activities: (day.activities || []).filter(a => {
      if ((a.type || 'task').toLowerCase() !== 'task') return true;
      const dl = findDeadlineDayForTitle(a.title || '', deadlineMap);
      return !dl || day.day <= dl;
    })
  }));
};

// 주말 업무 방지
const stripWeekendWork = (schedule) => {
  return (schedule || []).map(day => ({
    ...day,
    activities: (day.activities || []).filter(a => {
      const isWeekend = (day.day % 7 === 6) || (day.day % 7 === 0);
      const isWorkLike = /(회사|근무|업무|미팅|회의)(?!.*(스터디|공부|학습|개인|사이드))/.test(a.title || '');
      return !(isWeekend && isWorkLike);
    })
  }));
};

  // task 메타 보강
const enrichTaskMeta = (schedule, existingTasks=[]) => {
  if (!Array.isArray(schedule)) return schedule;
  const byTitle = new Map();
  // ✅ 타이틀 정규화 일관성: canonTitle로 통일
  (existingTasks||[]).forEach(t => {
    const normalized = canonTitle(t.title || '');
    if (normalized) byTitle.set(normalized, t);
  });

  for (const day of schedule) {
    for (const a of (day.activities||[])) {
      if ((a.type||'').toLowerCase() !== 'task') continue;

      // ✅ 타이틀 정규화로 매칭 (canonTitle)
      const base = byTitle.get(canonTitle(a.title || ''));

      if (isExamTitle(a.title)) {
        a.importance = a.importance || '상';
        a.difficulty = a.difficulty || '상';
        a.isRepeating = a.isRepeating ?? true;
      }

      if (base) {
        if (!a.importance) a.importance = base.importance || '중';
        if (!a.difficulty) a.difficulty = base.difficulty || '중';
        if (isExamTitle(a.title) || a.importance === '상' || a.difficulty === '상') {
          a.isRepeating = a.isRepeating ?? true;
        }
      }

      if (!a.duration && a.start && a.end) {
        a.duration = hhmmToMin(a.end) - hhmmToMin(a.start);
      }
    }
  }
  return schedule;
};

// ===== 3-pass 배치 유틸 =====
const toMin = (s) => { const [h,m]=String(s||'0:0').split(':').map(n=>parseInt(n||'0',10)); return (isNaN(h)?0:h)*60+(isNaN(m)?0:m); };
const toHHMM = (m) => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

// ISO 로컬 날짜/시각을 모두 허용 (예: 2025-10-31 또는 2025-10-31T14:20)  // NEW
export const parseLocalDateOrDateTime = (s) => {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, M, d, h, m2, s2] = m;
    return new Date(+y, +M - 1, +d, +h, +m2, +(s2 || 0), 0);
  }
  m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, M, d] = m;
    return new Date(+y, +M - 1, +d, 0, 0, 0, 0);
  }
  return null;
};

// ✅ 기준 시각 resolve (문자열/Date/미지정 모두 처리)  // NEW
export const resolveNow = (nowLike) => {
  if (nowLike instanceof Date) return nowLike;
  if (typeof nowLike === 'string') {
    const d = parseLocalDateOrDateTime(nowLike);
    if (d) return d;
  }
  return new Date();
};

const mergeRanges = (ranges) => {
  const a = [...ranges].sort((x,y)=>x[0]-y[0]);
  const out = [];
  for (const [s,e] of a) {
    if (!out.length || s>out[out.length-1][1]) out.push([s,e]);
    else out[out.length-1][1]=Math.max(out[out.length-1][1], e);
  }
  return out;
};

const freeFromOccupied = (occupied, dayStart=0, dayEnd=24*60) => {
  const merged = mergeRanges(occupied);
  const free=[]; let cur=dayStart;
  for (const [s,e] of merged) { if (cur<s) free.push([cur,s]); cur=Math.max(cur,e); }
  if (cur<dayEnd) free.push([cur,dayEnd]);
  return free;
};

// 오늘의 과거 활동 제거/정리  // NEW
const enforceFutureOnly = (schedule, now = new Date()) => {
  const baseDay = now.getDay() === 0 ? 7 : now.getDay();
  const nowMin  = now.getHours() * 60 + now.getMinutes();

  return (schedule || []).map(day => {
    if (day.day !== baseDay) return day;

    const acts = (day.activities || []).slice().sort((a,b)=>hhmmToMin(a.start||'00:00')-hhmmToMin(b.start||'00:00'));
    const kept = [];
    for (const a of acts) {
      const s = hhmmToMin(a.start || '00:00');
      const e = hhmmToMin(a.end   || '00:00');
      if (e <= nowMin) continue; 
      if (s < nowMin && e > nowMin) { 
        kept.push({ ...a, start: minToHHMM(nowMin) });
        continue;
      }
      kept.push(a);
    }

    const dedup = [];
    let lastEnd = nowMin;
    for (const a of kept.sort((x,y)=>hhmmToMin(x.start||'00:00')-hhmmToMin(y.start||'00:00'))) {
      const s = Math.max(hhmmToMin(a.start||'00:00'), lastEnd);
      const e = Math.max(s + 1, hhmmToMin(a.end||'00:00'));
      dedup.push({ ...a, start: minToHHMM(s), end: minToHHMM(e) });
      lastEnd = e;
    }

    return { ...day, activities: dedup };
  });
};

const buildOccupiedForAppointments = (acts=[]) => {
  return mergeRanges(
    (acts||[])
      .filter(a => (a.type||'').toLowerCase()==='appointment' && a.start && a.end)
      .map(a => [toMin(a.start), toMin(a.end)])
  );
};

const buildOccupiedForTasks = (acts=[]) => {
  return mergeRanges(
    (acts||[])
      .filter(a => (a.start && a.end))
      .flatMap(a => {
        const s = toMin(a.start), e = toMin(a.end);
        return e>=s ? [[s,e]] : [[0,e],[s,24*60]];
      })
  );
};

const dayIndexFromISO = (iso, todayDate) => {
  const base = (todayDate.getDay()===0?7:todayDate.getDay());
  if (!iso) return base;
  const t0 = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
  const d  = new Date(iso);
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return base + Math.max(0, Math.floor((d0 - t0)/86400000));
};

export const placeAppointmentsPass = (schedule=[], allItems=[], todayDate=new Date()) => {
  const copy = (schedule||[]).map(d=>({...d, activities:[...(d.activities||[])]}));
  const norm = (s='') => String(s).replace(/\s+/g,'').toLowerCase();
  const hasSameTitleSameDay = (acts=[], title='') => {
    const key = norm(title);
    return (acts||[]).some(a => norm(a.title||'')===key);
  };
  const appts = (allItems||[]).filter(t => (t.type||'task').toLowerCase()==='appointment' && t.isActive!==false);
  const baseDay = (todayDate.getDay()===0?7:todayDate.getDay());
  const nowMin = todayDate.getHours()*60 + todayDate.getMinutes();
  for (const t of appts) {
    const day = dayIndexFromISO(typeof toISODateLocal==='function' ? toISODateLocal(t.deadline) : t.deadline, todayDate);
    const dayObj = copy.find(x=>x.day===day) || copy[0] || copy.at(-1);
    if (!dayObj) continue;
    const occ = buildOccupiedForAppointments(dayObj.activities);
    const want = String(t.deadlineTime||'').slice(0,5);
    const target = /^\d{2}:\d{2}$/.test(want) ? toMin(want) : 9*60;
    const dur = Math.max(30, Number(t.estimatedMinutes || 60));
    let free = freeFromOccupied(occ);
    if (day === baseDay) {
      // 오늘은 현재 시각 이전 금지: free 블록을 now 이후로 자름
      free = free
        .map(([fs,fe]) => [Math.max(fs, nowMin), fe])
        .filter(([fs,fe]) => fe - fs >= Math.max(1, dur));
    }
    let best=null;
    for (const [fs,fe] of free) {
      if (fe-fs < dur) continue;
      const start = Math.min(Math.max(target, fs), fe - dur);
      const mid = start + dur/2;
      const dist = Math.abs(mid - target);
      if (!best || dist<best.dist) best={start,end:start+dur,dist};
    }
    if (!best) continue;
    dayObj.activities.push({
      title: t.title,
      start: toHHMM(best.start),
      end: toHHMM(best.end),
      type: 'appointment',
      importance: t.importance || '중',
      difficulty: t.difficulty || '중',
      source: 'place_appointment'
    });
    dayObj.activities.sort((a,b)=>toMin(a.start||'00:00')-toMin(b.start||'00:00'));
  }
  return copy;
};

export const placeTasksPass = (schedule=[], allItems=[], todayDate=new Date()) => {
  const copy = (schedule||[]).map(d=>({...d, activities:[...(d.activities||[])]}));
  const norm = (s='') => String(s).replace(/\s+/g,'').toLowerCase();
  const hasSameTitleSameDay = (acts=[], title='') => (acts||[]).some(a => norm(a.title||'')===norm(title||''));
  const tasks = (allItems||[]).filter(t => String(t.type).toLowerCase()==='task' && t.isActive!==false);
  const baseDay = (todayDate.getDay()===0?7:todayDate.getDay());
  const nowMin = todayDate.getHours()*60 + todayDate.getMinutes();
  for (const t of tasks) {
    const day = dayIndexFromISO(typeof toISODateLocal==='function' ? toISODateLocal(t.deadline) : t.deadline, todayDate);
    const dayObj = copy.find(x=>x.day===day) || copy[0] || copy.at(-1);
    if (!dayObj) continue;
    // 중복은 시간 겹침만 금지: 동일 타이틀 존재 여부로는 스킵하지 않음
    const occ = buildOccupiedForTasks(dayObj.activities);
    let free = freeFromOccupied(occ);
    if (day === baseDay) {
      // 오늘은 현재 시각 이전 금지: free 블록을 now 이후로 자름
      free = free.map(([fs,fe]) => [Math.max(fs, nowMin), fe]).filter(([fs,fe]) => fe - fs >= 1);
    }
    const dur = Math.max(30, Number(t.estimatedMinutes || 120));
    const preferred = 19*60;
    let best=null;
    for (const [fs,fe] of free) {
      if (fe-fs < dur) continue;
      const start = Math.min(Math.max(preferred, fs), fe - dur);
      const mid = start + dur/2;
      const dist = Math.abs(mid - preferred);
      if (!best || dist<best.dist) best={start,end:start+dur,dist};
    }
    if (!best) {
      let longest=[null,-1];
      for (const [fs,fe] of free) {
        const len = fe-fs;
        if (len > longest[1] && len>=dur) longest=[[fs,fe],len];
      }
      if (longest[0]) best = { start:longest[0][0], end:longest[0][0]+dur, dist:9999 };
    }
    if (!best) continue;
    dayObj.activities.push({
      title: t.title,
      start: toHHMM(best.start),
      end: toHHMM(best.end),
      type: 'task',
      importance: t.importance || '중',
      difficulty: t.difficulty || '중',
      source: 'place_task'
    });
    dayObj.activities.sort((a,b)=>toMin(a.start||'00:00')-toMin(b.start||'00:00'));
  }
  return copy;
};

export function dedupeActivitiesByTitleTime(dayActivities=[]) {
  const norm = (s='') => String(s).replace(/\s+/g,'').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const a of (dayActivities||[])) {
    const k = `${norm(a.title||'')}:${a.start||''}-${a.end||''}:${(a.type||'')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

// 화이트리스트 필터링
const filterTasksByWhitelist = (schedule, allowedTitleSet) => {
  if (!Array.isArray(schedule) || !allowedTitleSet) return schedule;
  return schedule.map(day => ({
    ...day,
    activities: (day.activities || []).filter(a => {
      const t = (a.type || 'task').toLowerCase();
      if (t !== 'task') return true;
      const title = normTitle(a.title || '');
      return allowedTitleSet.has(title);
    })
  }));
};

// 공통 후처리 파이프라인
export const postprocessSchedule = ({
  raw,
  parsedPatterns,
  existingTasksForAI,
  today,                   // backward compat
  nowLike,                 // ✅ 새로 추가
  whitelistPolicy = 'off', // 'off' | 'strict' | 'exam-exempt' | 'smart'
  breakMinutesOverride 
}) => {
  const now = resolveNow(nowLike ?? today);
  let schedule = enrichTaskMeta(Array.isArray(raw) ? raw : (raw?.schedule || []), existingTasksForAI);

  const allowedTitles = new Set(
    (existingTasksForAI || []).map(t => canonTitle(t.title || '')).filter(Boolean)
  );

  const baseDay = now.getDay() === 0 ? 7 : now.getDay();
  schedule = normalizeRelativeDays(schedule, baseDay).map(day => ({
    ...day,
    activities: (day.activities || []).map(a => {
      if ((a.type || '').toLowerCase() === 'lifestyle') {
        return { ...a, title: cleanLifestyleTitle(a.title, a.start, a.end) };
      }
      return a;
    })
  }));

  schedule = applyLifestyleHardOverlay(schedule, parsedPatterns);
  schedule = placeAppointmentsPass(schedule, existingTasksForAI, now);
  schedule = placeTasksPass(schedule, existingTasksForAI, now);
  // (자동 반복으로 추가된 태스크가 다시 필터링되지 않도록)
  const deadlineMap = buildDeadlineDayMap(existingTasksForAI, now);
  try {
    if (deadlineMap.size === 0) {
      console.warn('[ShedAI][DEADLINE] 비어 있음 → 로컬 DB/Firestore에서 할 일 수집 실패 가능성 높음');
    }
  } catch {}
  schedule = fixOverlaps(schedule, { allowedTitles, allowAutoRepeat: false, deadlineMap, today: now, breakMinutesOverride });

  // 화이트리스트 강제 (정책에 따라) - fixOverlaps 이후 적용
  if (whitelistPolicy === 'strict') {
    schedule = schedule.map(d => ({
      ...d,
      activities: (d.activities || []).filter(a => {
        const t = (a.type || 'task').toLowerCase();
        if (t !== 'task') return true;
        const titleNorm = canonTitle(a.title || '');
        const isImportant =
          a.isRepeating || a.importance === '상' || a.difficulty === '상' || /시험|오픽|토익|면접/i.test(titleNorm);
        return isImportant || allowedTitles.has(titleNorm);
      })
    }));
  } else if (whitelistPolicy === 'exam-exempt' || whitelistPolicy === 'smart') {
    // 시험/상난이도/isRepeating은 화이트리스트 무시
    // 'smart'는 'exam-exempt'와 동일하되, 향후 유사도 체크 등 확장 가능
    schedule = schedule.map(d => ({
      ...d,
      activities: (d.activities || []).filter(a => {
        const t = (a.type || 'task').toLowerCase();
        if (t !== 'task') return true;
        const titleNorm = canonTitle(a.title || '');
        const isImportant = a.isRepeating || a.importance === '상' || a.difficulty === '상' || /시험|오픽|토익|면접/i.test(titleNorm);
        return isImportant || allowedTitles.has(titleNorm);
      })
    }));
  }
  schedule = capTasksByDeadline(schedule, deadlineMap);
  schedule = stripWeekendWork(schedule);

  // ✅ 오늘은 현재 시각 이전 활동 제거/절단 (약속/태스크 배치 이후)
  schedule = enforceFutureOnly(schedule, now);

  // 활동 유효성 필터 (기본 type 보강 후 검증)
  schedule = schedule.map(d => {
    const acts = (d.activities || []).map(a => {
      if (!a.type) a.type = 'task';
      return a;
    });
    return {
      ...d,
      activities: acts.filter(a => {
        const t = (a.type || 'task').toLowerCase();
        if (t === 'lifestyle') return a.start && a.end;
        return a.title && a.start && a.end;
      })
    };
  });

  return schedule;
};

// 고정 시각 태스크를 FullCalendar 이벤트로 변환
export function tasksToFixedEvents(tasks = []) {
  const safe = Array.isArray(tasks) ? tasks : [];
  return safe
    .filter(t => (t && (t.deadlineAtMidnight || t.deadline) && t.deadlineTime))
    .map(t => {
      const base = toLocalMidnightDate(t.deadlineAtMidnight || t.deadline);
      const [H, M] = String(t.deadlineTime).split(':').map(Number);
      const start = base ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), H || 0, M || 0) : new Date();
      const dur = Math.max(30, Number(t.estimatedMinutes || 60));
      const end = new Date(start.getTime() + dur * 60000);
      return {
        id: `fixed_${t.id || `${start.getTime()}`}`,
        title: t.title || '(제목 없음)',
        start,
        end,
        allDay: false,
        extendedProps: {
          isDone: false,
          source: 'fixed-task',
          taskId: t.id || null,
        },
      };
    });
}

// ===== Lightweight post parser to preserve tasks and normalize activities =====
const HM = {
  toMin(hm){ const [h,m]=String(hm||'0:0').split(':').map(n=>parseInt(n||'0',10)); return (isNaN(h)?0:h)*60 + (isNaN(m)?0:m); },
  toHM(min){ const h=Math.floor(min/60), m=min%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; },
  roundUp5(min){ return Math.ceil(min/5)*5; }
};

export function postProcessSchedule(modelOut, {
  now = new Date(),          // 현재 시각
  todayDay = 1,              // 프롬프트에서 계산된 '오늘 day'
  latestDay = 14,            // 가장 늦은 마감일의 day
  minRestMin = 30            // 태스크 사이 최소 휴식
} = {}) {
  const schedule = Array.isArray(modelOut?.schedule) ? modelOut.schedule : [];

  // 1) day 범위 clip (오늘~latestDay)
  const clipped = schedule.filter(d => Number.isInteger(d?.day) && d.day >= todayDay && d.day <= latestDay)
    .map(d => ({ day: d.day, weekday: d.weekday, activities: Array.isArray(d.activities)? d.activities: [] }));

  // 2) 활동 정화: 허용 필드만 유지
  for (const d of clipped) {
    d.activities = (d.activities || []).map(a => ({
      start: a.start, end: a.end, title: a.title, type: a.type
    })).filter(a => a.start && a.end && a.title && ((a.type||'').toLowerCase()==='lifestyle' || (a.type||'').toLowerCase()==='task'));
  }

  // 3) 중복 제거: day|type|title|start|end
  for (const d of clipped) {
    const seen = new Set();
    d.activities = d.activities.filter(a => {
      const key = `${d.day}|${(a.type||'').toLowerCase()}|${a.title}|${a.start}|${a.end}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  }

  // 4) 오늘(day==todayDay) '현재 시각 이전' 블록 정리
  const nowMin = HM.toMin(`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`);
  for (const d of clipped) {
    if (d.day !== todayDay) continue;
    d.activities = d.activities.flatMap(a => {
      const s = HM.toMin(a.start), e = HM.toMin(a.end);
      if (e <= nowMin) return [];
      if (s < nowMin && e > nowMin) {
        const ns = HM.toHM(HM.roundUp5(nowMin));
        return [{ ...a, start: ns }];
      }
      return [a];
    });
  }

  // 5) 태스크↔태스크 최소 휴식 확보
  for (const d of clipped) {
    d.activities.sort((x,y)=>HM.toMin(x.start)-HM.toMin(y.start));
    for (let i=0;i<d.activities.length-1;i++){
      const cur=d.activities[i], nxt=d.activities[i+1];
      if ((cur.type||'').toLowerCase()==='task' && (nxt.type||'').toLowerCase()==='task'){
        const curEnd=HM.toMin(cur.end), nxtStart=HM.toMin(nxt.start);
        const gap=nxtStart-curEnd;
        if (gap < minRestMin){
          const newStart = curEnd + (minRestMin-gap);
          const dur = HM.toMin(nxt.end)-HM.toMin(nxt.start);
          let ns = HM.roundUp5(newStart); let ne = ns + dur;
          if (ne > 24*60){ d.activities.splice(i+1,1); i--; continue; }
          nxt.start = HM.toHM(ns); nxt.end = HM.toHM(ne);
        }
      }
    }
  }

  // 6) 겹침 제거(태스크 보존 우선)
  for (const d of clipped) {
    const out=[];
    for (const a of d.activities.sort((x,y)=>HM.toMin(x.start)-HM.toMin(y.start))){
      let s=HM.toMin(a.start), e=HM.toMin(a.end); let moved=false;
      while(out.length){
        const pe=HM.toMin(out[out.length-1].end);
        if (s>=pe) break;
        const shift=pe-s; if (shift>90){ moved=true; break; }
        s=pe; e=s+(HM.toMin(a.end)-HM.toMin(a.start)); moved=true;
      }
      if (moved && e>24*60) continue;
      out.push({ ...a, start: HM.toHM(s), end: HM.toHM(e) });
    }
    d.activities = out;
  }

  // 7) 간단 분석/노트 (AI category 우선 사용)
  const totMin = clipped.flatMap(d=>d.activities).reduce((s,a)=>s+(HM.toMin(a.end)-HM.toMin(a.start)),0);
  
  // AI가 제공한 category 기반 계산 (동적 taxonomy)
  const buckets = new Map(); // category name -> minutes
  
  // 폴백: 고정 카테고리 분류 (AI category가 없을 때만 사용)
  const fallbackCat = (a) => {
    if ((a.type||'').toLowerCase()==='lifestyle'){
      if (/운동|헬스|러닝|요가/i.test(a.title)) return 'exercise';
      if (/독서|책/i.test(a.title)) return 'reading';
      if (/게임|취미|음악|여가/i.test(a.title)) return 'hobby';
      if (/근무|출근|회사/i.test(a.title)) return 'work';
      return 'others';
    }
    if (/공부|시험|준비|학습|강의/i.test(a.title)) return 'study';
    if (/업무|개발|코딩|프로젝트|회사/i.test(a.title)) return 'work';
    return 'others';
  };
  
  clipped.forEach(d=>{
    d.activities.forEach(a=>{
      const dur = HM.toMin(a.end) - HM.toMin(a.start);
      // AI category가 있으면 우선 사용하고 정규화, 없으면 fallback
      const rawCat = (a.category && a.category.trim()) ? a.category.trim() : fallbackCat(a);
      const cat = normalizeCategoryName(rawCat);
      buckets.set(cat, (buckets.get(cat) || 0) + dur);
    });
  });
  
  const pct = (m) => totMin ? Math.round((m/totMin)*100) : 0;
  
  // Map을 객체로 변환 (퍼센트 합 100 맞추기)
  const entries = Array.from(buckets.entries()).map(([k, v]) => [k, pct(v)]);
  const rounded = entries.map(([k, p]) => [k, Math.round(p)]);
  const sum = rounded.reduce((s, [, p]) => s + p, 0);
  const diff = 100 - sum;
  
  // 가장 큰 항목에 보정치 몰아주기
  if (diff !== 0 && rounded.length > 0) {
    const maxIdx = rounded.reduce((imax, [, p], idx, arr) => (p > arr[imax][1] ? idx : imax), 0);
    rounded[maxIdx][1] += diff;
  }
  
  const activityAnalysis = Object.fromEntries(rounded);

  return {
    schedule: clipped,
    activityAnalysis,
    notes: [
      `오늘(day:${todayDay})의 현재 시각 이전 활동은 제거/절단했습니다.`,
      `마감일 최댓값(day:${latestDay})까지만 출력했습니다.`,
      `태스크 사이 최소 휴식 ${minRestMin}분을 보장하도록 시프트했습니다.`
    ]
  };
}
