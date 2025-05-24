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
    const prefix =
  `기존 시간표를 유지하면서, 피드백과 새로운 할 일을 반영해 전체 일정을 다시 설계하세요.
  기존 활동은 가능한 유지하되, 필요시 우선순위에 따라 재조정 가능합니다.`;
  
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
  - 피드백으로 인해 새 작업이 추가되거나 시간이 부족하더라도, 기존 할 일을 삭제하거나 조기 종료하지 마세요.`;
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
  