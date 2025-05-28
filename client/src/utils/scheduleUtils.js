// utils/scheduleUtils.js

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
  `오늘 날짜는 ${dateStr} ${dayName}(day:${gptDayIndex})요일이며, 현재 시각 ${nowTime}이후부터의 시간대에만 할 일을 배치하세요. 이전 시간은 이미 지났으므로 제외하세요.
  - 생활 패턴에 포함된 활동(예: 수면, 회사 업무, 가족 시간 등)은 **절대적으로 고정된 일정**이며,  
  어떠한 할 일도 해당 시간대를 침범해서는 안 됩니다.
  - 생활 패턴이 "평일", "주말"과 같이 요일 구분이 있는 경우 반드시 해당 요일에만 적용하세요.
    - "평일" = 월요일(day:1), 화요일(day:2), 수요일(day:3), 목요일(day:4), 금요일(day:5)
    - "주말" = 토요일(day:6), 일요일(day:7)
  - 어떤 일정도 시간이 겹치지 않도록 주의하세요. 특히 "아이 재우기"와 같은 활동과 다른 할일이 같은 시간에 배치되면 안됩니다.
  - 반드시 먼저 생활 패턴을 고정 시간대로 배치한 후, 남는 시간대에만 할 일을 배치하세요.
  모든 할 일은 반드시 오늘(day:${gptDayIndex})을 기준으로 상대적 마감일을 day 숫자로 환산하여, 
  해당 마감일까지 day:14, day:15 등 필요한 만큼 스케줄을 생성해야 합니다.
  중요하거나 마감이 임박한 일은 오늘부터 바로 시작하고,
  **절대로 day:7까지만 출력하거나 중간에 멈추지 마세요.
  - 일정이 day:14 또는 그 이전에서 종료되더라도, 그 이유를 반드시 notes에 설명하세요.
  - 예: "할 일의 총 소요 시간이 충분히 분산되어 day:10까지만 계획하면 됩니다."
  - 계획이 짧게 끝난 경우, 사용자가 불안해하지 않도록 **왜 더 이상 배치하지 않았는지 반드시 notes에 포함**해야 합니다.
  
  📌 마감일 처리 방식 안내:
  - 날짜 기반 마감일("5월 19일 오전 9시", "5월 28일까지")이 주어질 경우,
    반드시 오늘 날짜를 기준으로 day:x 값을 계산하여 사용해야 합니다.
  - 예: 오늘이 5월 15일(day:4)이고, 마감일이 5월 19일이면 → day:8입니다.
  - "이번주 토요일"이나 "다음주 월요일"과 같은 상대적 날짜 표현도 반드시 정확히 계산해야 합니다.
  - 중요: 마감일 표현 뒤에 "(day:X)" 형식으로 이미 계산된 날짜가 있다면, 반드시 그 값을 사용하세요.
    예: "이번주 토요일 (day:10)"이라면 반드시 day:10을 마감일로 사용하세요.
  - 모든 할 일은 이 상대 day:x 값을 기준으로 정확히 스케줄링해야 하며,
    마감일을 초과한 일정 배치는 절대로 하지 마세요.
  
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
  `기존 시간표를 유지하면서, 피드백과 새로운 할 일을 반영해 전체 일정을 다시 설계하세요.
  기존 활동은 가능한 유지하되, 필요시 우선순위에 따라 재조정 가능합니다.

  ⚠️ 중요: 반드시 현재 일정의 전체 날짜 범위를 유지해야 합니다. 기존 일정이 day:${maxDay}까지 있었다면,
  새 일정도 최소한 day:${maxDay}까지 포함해야 합니다. 절대로 일정을 7일 이하로 줄이지 마세요.`;
  
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
  
  // GPT → FullCalendar 이벤트 변환기
  export function convertScheduleToEvents(gptSchedule, today = new Date()) {
    const events = [];
    const gptDayToday = gptSchedule[0].day;

    gptSchedule.forEach(dayBlock => {
      const dateOffset = dayBlock.day - gptDayToday;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + dateOffset);
      const dateStr = formatLocalISO(targetDate).split('T')[0];

      dayBlock.activities.forEach(activity => {
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
  