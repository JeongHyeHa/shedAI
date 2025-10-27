// scheduleUtils.js: 스케줄과 관련된 모든 처리 로직을 담당하는 유틸리티

// 디버깅 유틸리티 (환경 독립형)
const isDev =
  (typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'production') ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

const debug = (...args) => {
  if (isDev) console.log(...args);
};

// 클라이언트용 날짜 전처리 함수 (test_dates.js와 동일한 로직)
export function preprocessMessage(message) {
  const base = new Date();
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
    return getGptDayIndex(d);
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
        
        const finalDay = getGptDayIndex(d);
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
      const satDay = getGptDayIndex(sat);
      const sunDay = getGptDayIndex(sun);
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
        if (delta <= 0) delta += 7; // 같은 요일이면 다음 주로
        d.setDate(d.getDate() + delta);
        return `${prefix}${kw} ${dw} (day:${getGptDayIndex(d)})${suffix}`;
      });
    }
  }
  
  // === 3) 특정 날짜들 ===
  const DATE_PATTERNS = [
    { re: /(\d{1,2})\s*월\s*(\d{1,2})\s*일(?![^()]*\))/g, fn: (m, month, day) => {
      const yy = base.getFullYear();
      const mm = parseInt(month, 10) - 1;
      const dd = parseInt(day, 10);
      let d = new Date(yy, mm, dd);
      // 옵션: 이미 과거면 내년
      if (d < resetToStartOfDay(base)) d = new Date(yy + 1, mm, dd);
      // 유효성: 역직렬화해서 연/월/일 동일해야 함
      if (d.getFullYear() === yy && d.getMonth() === mm && d.getDate() === dd) {
        return `${m} (day:${getGptDayIndex(d)})`;
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
        return `${m} (day:${getGptDayIndex(d)})`;
      }
      return m; // 무효하면 그대로 반환(태깅 생략)
    }},
    { re: /(\d+)\s*(일|주)\s*(후|뒤)(?![^()]*\))/g, fn: (m, num, unit, _) => {
      const offset = unit === '주' ? parseInt(num, 10) * 7 : parseInt(num, 10);
      const d = new Date(base);
      d.setDate(d.getDate() + offset);
      return `${m} (day:${getGptDayIndex(d)})`;
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
    (m, prefix, h, suffix) => {
      const n = parseInt(h, 10);
      return `${injectTime(`${prefix}${h}시`, n === 12 ? 12 : n)}${suffix}`;
    });
  
  // === 5) '시간만 있고 날짜가 전혀 없는 경우'에만 day 보강 ===
  const hasDay = /\(day:\d+\)/.test(out);
  const hasExplicitDate = /((이번|다음|다다음)\s*주\s*[월화수목금토일]요일)|(오늘|금일|익일|내일|명일|모레|내일모레)|(\d{1,2}\s*월\s*\d{1,2}\s*일)|(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)|(\d+\s*(일|주)\s*(후|뒤))/.test(out);
  
  if (!hasDay && foundTime && !hasExplicitDate) {
    const dayTag = ` (day:${getGptDayIndex(base)})`;
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
  export function buildShedAIPrompt(lifestyleText, taskText, today) {
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const gptDayIndex = getGptDayIndex(today); // 월=1 ~ 일=7
    const dayName = dayNames[today.getDay()];
    const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
    const nowTime = `${today.getHours()}시 ${today.getMinutes()}분`;
  
    const prefix =
  `당신은 사용자의 생활 패턴과 할 일, 그 외 피드백을 바탕으로,
사용자에게 최적화된 효율적인 스케줄을 설계해주는 고급 일정 관리 전문가입니다.

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

오늘 날짜는 ${dateStr} ${dayName}(day:${gptDayIndex})요일이며, 현재 시각 ${nowTime}이후부터의 시간대에만 할 일을 배치하세요. 이전 시간은 이미 지났으므로 제외하세요.

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

📊 활동 비중 분석 요구사항
- 스케줄 생성과 함께 사용자의 활동 패턴을 분석하여 활동 비중을 계산해주세요.
- 다음 카테고리별로 활동 시간을 집계하여 비중을 계산하세요:
  - work: 업무, 개발, 코딩, 회사 관련 활동
  - study: 공부, 학습, 시험 준비, 강의 관련 활동
  - exercise: 운동, 헬스, 러닝, 요가 등 신체 활동
  - reading: 독서, 책 읽기 관련 활동
  - hobby: 취미, 게임, 음악, 여가 활동
  - others: 기타 활동들
- 각 카테고리의 비중은 해당 카테고리의 총 활동 시간을 전체 활동 시간으로 나눈 비율로 계산하세요.

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
        { "start": "06:00", "end": "07:00", "title": "회사 준비", "type": "lifestyle" },
        { "start": "08:00", "end": "17:00", "title": "근무", "type": "lifestyle" },
        { "start": "19:00", "end": "21:00", "title": "정보처리기사 실기 개념 암기", "type": "task" },
        { "start": "21:00", "end": "22:00", "title": "운동", "type": "lifestyle" }
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
  "activityAnalysis": {
    "work": 45,
    "study": 20,
    "exercise": 10,
    "reading": 5,
    "hobby": 5,
    "others": 15
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

📊 활동 비중 분석 요구사항
- 스케줄 생성과 함께 사용자의 활동 패턴을 분석하여 활동 비중을 계산해주세요.
- 다음 카테고리별로 활동 시간을 집계하여 비중을 계산하세요:
  - work: 업무, 개발, 코딩, 회사 관련 활동
  - study: 공부, 학습, 시험 준비, 강의 관련 활동
  - exercise: 운동, 헬스, 러닝, 요가 등 신체 활동
  - reading: 독서, 책 읽기 관련 활동
  - hobby: 취미, 게임, 음악, 여가 활동
  - others: 기타 활동들
- 각 카테고리의 비중은 해당 카테고리의 총 활동 시간을 전체 활동 시간으로 나눈 비율로 계산하세요.

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
    
    // day 번호가 유효하면 해당 요일 반환
    if (KOREAN_WEEKDAYS[day]) return KOREAN_WEEKDAYS[day];
    
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
    return KOREAN_WEEKDAYS[day] || '알 수 없음';
  }

  // GPT → FullCalendar 이벤트 변환기 (배열만 받음)
  export function convertScheduleToEvents(scheduleArray, today = new Date()) {
    const events = [];
    
    // 시간 형식 보강 함수 (초가 누락된 경우 기본값 부여)
    const ensureHms = (tRaw) => {
      const t = String(tRaw || '00:00');
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
    const gptDayToday = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;
    
    // 디버깅 로그 제거 (필요시 주석 해제)
    // if (isDev) {
    //   debug('[convertScheduleToEvents] 디버깅 정보:', {
    //     gptDayToday,
    //     today: today.toISOString().split('T')[0],
    //     todayDayOfWeek,
    //     scheduleDataLength: scheduleData.length,
    //     firstDayBlock: scheduleData[0]
    //   });
    // }

    scheduleData.forEach(dayBlock => {
      // dayBlock이 유효하지 않으면 건너뛰기
      if (!dayBlock || typeof dayBlock.day !== 'number') {
        console.warn('convertScheduleToEvents: 유효하지 않은 dayBlock', dayBlock);
        return;
      }
      
      const dateOffset = dayBlock.day - gptDayToday;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + dateOffset);
      const dateStr = formatLocalISO(targetDate).split('T')[0];

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
        
        const extendedProps = {
          type: activity.type || "task",
          importance: activity.importance,
          difficulty: activity.difficulty,
          isRepeating: !!activity.isRepeating,
          description: activity.description
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

        if (end < start) {
          const endOfToday = resetToStartOfDay(start, true); // 당일 23:59:59
          const nextDay = new Date(start);
          nextDay.setDate(nextDay.getDate() + 1);
          const startOfNextDay = resetToStartOfDay(nextDay);

          const eventIdPrefix = `${(activity.title||'').trim()}__${dateStr}`;
          
          // 당일 뒷부분
          events.push({
            id: `${eventIdPrefix}__${ensureHms(activity.start)}-${formatLocalISO(endOfToday).split('T')[1].slice(0,5)}`,
            title: activity.title,
            start: formatLocalISO(start),
            end: formatLocalISO(endOfToday),
            extendedProps
          });
          
          // 다음날 앞부분
          const endNext = new Date(startOfNextDay);
          endNext.setHours(end.getHours(), end.getMinutes(), end.getSeconds?.() ?? 0, 0); // 원래 end 시각 복제
          const nextDateStr = formatLocalISO(startOfNextDay).split('T')[0];
          events.push({
            id: `${eventIdPrefix}__next-${formatLocalISO(startOfNextDay).split('T')[1].slice(0,5)}-${ensureHms(activity.end)}`,
            title: activity.title,
            start: formatLocalISO(startOfNextDay),
            end: formatLocalISO(endNext),
            extendedProps
          });
          return;
        }

        // 중복 방지를 위한 고유 ID 생성
        const eventId = `${(activity.title||'').trim()}__${dateStr}__${ensureHms(activity.start)}-${ensureHms(activity.end || activity.start)}`;
        
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
  
  // 날짜 차이를 밀리초로 계산 후 일수로 변환
  const diffTime = startOfTargetDate.getTime() - startOfBaseDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // 오늘의 GPT day 인덱스
  const todayGptDay = getGptDayIndex(baseDate);
  
  // 상대적 day 값 반환
  return todayGptDay + diffDays;
}
  