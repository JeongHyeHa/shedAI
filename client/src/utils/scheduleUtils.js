// 스케줄과 관련된 모든 처리 로직을 담당하는 유틸리티 

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
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
  }

  // 날짜 문자열을 파싱하여 Date 객체로 변환
  export function parseDateString(dateStr, baseDate = new Date()) {
    if (!dateStr) return null;
    
    const today = resetToStartOfDay(baseDate);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const currentDate = today.getDate();
    const currentDay = today.getDay(); // 0: 일요일, 6: 토요일
    
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
      const daysToAdd = (targetDay - currentDay + 7) % 7 + 7; // 다음주니까 +7
      
      const result = new Date(today);
      result.setDate(currentDate + daysToAdd);
      return result;
    }
    
    // "다음 X요일", "오는 X요일" 패턴 처리
    const nextDayPattern = /다음\s*(월|화|수|목|금|토|일)요일/i;
    const comingDayPattern = /오는\s*(월|화|수|목|금|토|일)요일/i;
    const thisDayPattern = /이번\s*(월|화|수|목|금|토|일)요일/i;
    
    if (nextDayPattern.test(dateStr) || comingDayPattern.test(dateStr)) {
      const match = dateStr.match(nextDayPattern) || dateStr.match(comingDayPattern);
      const targetDay = getKoreanDayIndex(match[1]);
      // 현재 요일이 목표 요일보다 작으면 이번 주, 크거나 같으면 다음 주
      const daysToAdd = currentDay < targetDay 
        ? targetDay - currentDay 
        : 7 - (currentDay - targetDay);
      
      const result = new Date(today);
      result.setDate(currentDate + daysToAdd);
      return result;
    }
    
    if (thisDayPattern.test(dateStr)) {
      const match = dateStr.match(thisDayPattern);
      const targetDay = getKoreanDayIndex(match[1]);
      // 목표 요일이 현재 요일보다 작거나 같으면 다음 주, 크면 이번 주
      const daysToAdd = targetDay <= currentDay 
        ? 7 - (currentDay - targetDay) 
        : targetDay - currentDay;
      
      const result = new Date(today);
      result.setDate(currentDate + daysToAdd);
      return result;
    }
    
    // 연도를 포함한 날짜 패턴 (2023년 5월 19일)
    const fullDatePattern = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;
    if (fullDatePattern.test(dateStr)) {
      const match = dateStr.match(fullDatePattern);
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 월은 0부터 시작
      const day = parseInt(match[3], 10);
      
      return new Date(year, month, day);
    }
    
    // X월 XX일 패턴 처리
    const monthDayPattern = /(\d{1,2})월\s*(\d{1,2})일/;
    if (monthDayPattern.test(dateStr)) {
      const match = dateStr.match(monthDayPattern);
      const month = parseInt(match[1], 10) - 1; // 월은 0부터 시작
      const day = parseInt(match[2], 10);
      
      let year = currentYear;
      // 현재 월보다 작으면 내년으로 설정
      if (month < currentMonth || (month === currentMonth && day < currentDate)) {
        year += 1;
      }
      
      return new Date(year, month, day);
    }
    
    // N일 후 패턴 처리
    const daysLaterPattern = /(\d+)일\s*(후|뒤)/;
    if (daysLaterPattern.test(dateStr)) {
      const match = dateStr.match(daysLaterPattern);
      const daysToAdd = parseInt(match[1], 10);
      
      const result = new Date(today);
      result.setDate(currentDate + daysToAdd);
      return result;
    }
    
    // N주 후 패턴 처리
    const weeksLaterPattern = /(\d+)주\s*(후|뒤)/;
    if (weeksLaterPattern.test(dateStr)) {
      const match = dateStr.match(weeksLaterPattern);
      const weeksToAdd = parseInt(match[1], 10);
      
      const result = new Date(today);
      result.setDate(currentDate + (weeksToAdd * 7));
      return result;
    }
    
    return null;
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
   - 하루에 **몰입 활동은 2시간 이상 연속 배치**를 원칙으로 함
   - 단, 하루 3~4시간 이상 연속 몰아치는 작업은 피하고 분산
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
   - 하루에 **몰입 활동은 2시간 이상 연속 배치**를 원칙으로 함
   - 단, 하루 3~4시간 이상 연속 몰아치는 작업은 피하고 분산
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

    const dayMap = new Map(); // day별로 activities를 그룹화

    gptResponse.schedule.forEach(activityBlock => {
      if (!activityBlock.days || !Array.isArray(activityBlock.days)) {
        console.warn('flattenSchedule: activityBlock.days가 유효하지 않음', activityBlock);
        return;
      }

      activityBlock.days.forEach(dayInfo => {
        if (!dayInfo.day || !dayInfo.start || !dayInfo.end) {
          console.warn('flattenSchedule: dayInfo가 유효하지 않음', dayInfo);
          return;
        }

        const day = dayInfo.day;
        if (!dayMap.has(day)) {
          dayMap.set(day, {
            day: day,
            weekday: getKoreanDayName(day),
            activities: []
          });
        }

        dayMap.get(day).activities.push({
          start: dayInfo.start,
          end: dayInfo.end,
          title: dayInfo.title || activityBlock.title || activityBlock.activity,
          type: dayInfo.type || activityBlock.type || 'task'
        });
      });
    });

    // day 순서대로 정렬하여 반환
    return Array.from(dayMap.values()).sort((a, b) => a.day - b.day);
  }

  // day 번호를 한국어 요일로 변환
  function getKoreanDayName(day) {
    const dayNames = ['', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
    return dayNames[day] || '알 수 없음';
  }

  // GPT → FullCalendar 이벤트 변환기
  export function convertScheduleToEvents(gptSchedule, today = new Date()) {
    const events = [];
    
    // gptSchedule이 GPT 응답 구조인지 확인하고 변환
    let scheduleData = gptSchedule;
    if (gptSchedule && gptSchedule.schedule) {
      // GPT 응답 객체 구조
      scheduleData = flattenSchedule(gptSchedule);
    } else if (Array.isArray(gptSchedule) && gptSchedule.length > 0 && Array.isArray(gptSchedule[0]?.days)) {
      // 활동 블록 배열 구조 (활동별 days 포함) -> 자동 평탄화
      scheduleData = flattenSchedule({ schedule: gptSchedule });
    }
    
    // 방어 코드: scheduleData가 유효하지 않으면 빈 배열 반환
    if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) {
      console.warn('convertScheduleToEvents: 유효하지 않은 scheduleData', scheduleData);
      return events;
    }
    
    const gptDayToday = scheduleData[0]?.day;
    
    // 첫 번째 요소에 day 속성이 없으면 에러
    if (typeof gptDayToday !== 'number') {
      console.warn('convertScheduleToEvents: scheduleData[0].day가 유효하지 않음', scheduleData[0]);
      return events;
    }

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
        if (!activity || !activity.start || !activity.end || !activity.title) {
          console.warn('convertScheduleToEvents: 유효하지 않은 activity', activity);
          return;
        }
        
        const start = new Date(`${dateStr}T${activity.start}`);
        let end = new Date(`${dateStr}T${activity.end}`);
        const extendedProps = {
          type: activity.type || "task"
        };

        if (end < start) {
          const startOfToday = resetToStartOfDay(start);
          const endOfToday = resetToStartOfDay(start, true);

          events.push({
            title: activity.title,
            start: formatLocalISO(startOfToday),
            end: formatLocalISO(end),
            extendedProps
          });

          events.push({
            title: activity.title,
            start: formatLocalISO(start),
            end: formatLocalISO(endOfToday),
            extendedProps
          });
          return;
        }

        events.push({
          title: activity.title,
          start: formatLocalISO(start),
          end: formatLocalISO(end),
          extendedProps
        });
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
  