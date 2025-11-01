// 카테고리 자동 분류 유틸리티 (제목/타입/시간대 기반)

/**
 * 활동의 제목, 타입, 시간대를 기반으로 카테고리를 추론
 * @param {Object} activity - 활동 객체 { title, type, start, ... }
 * @returns {string} - 추론된 카테고리 이름
 */
export function inferCategory(activity = {}) {
  const t = String(activity.title || '').toLowerCase();
  const type = String(activity.type || '').toLowerCase();
  const hour = Number(String(activity.start || '00:00').split(':')[0] || 0);

  // 수면
  if (/수면|잠|취침|sleep/.test(t)) return 'Sleep';
  
  // 식사
  if (/아침|점심|저녁|식사|meal|밥|breakfast|lunch|dinner/i.test(t)) return 'Meals';
  
  // 운동
  if (/헬스|운동|러닝|조깅|요가|수영|pt|gym|run|jog|필라테스|산책/i.test(t)) return 'Exercise';
  
  // 출퇴근
  if (/출근|퇴근|통근|지하철|버스|이동|commute/.test(t)) return 'Commute';
  
  // 회의/미팅
  if (/회의|미팅|콜|sync|stand ?up|면접|발표|클라이언트|meeting|call/.test(t)) return 'Meetings';
  
  // 학습/공부
  if (/공부|학습|스터디|study|과제|시험|테스트|평가|op?ic|토익|토플|텝스|시험 준비|자격증/i.test(t)) return 'Study';
  
  // 행정/관리
  if (/정리|가계부|세금|청구|서류|행정|메일|관리|admin|잡무|보고|리포트/i.test(t)) return 'Admin';
  
  // 집안일
  if (/청소|빨래|설거지|집안일|마트|장보기|요리|정리/i.test(t)) return 'Chores';
  
  // 여가/휴식
  if (/영화|게임|카페|데이트|산책|휴식|레저|취미|유튜브|leisure|rest|break|독서|책|reading|뮤지컬|공연/i.test(t)) return 'Leisure';
  
  // 업무/개발 (명시적으로 업무인 경우)
  if (/개발|코딩|프로그래밍|작업|업무|work|dev|code|프로젝트|개발 업무/i.test(t)) return 'Deep work';
  
  // lifestyle의 전형적 시간대 힌트
  if (type === 'lifestyle') {
    if (hour < 6) return 'Sleep';
    if (hour >= 7 && hour < 9) return 'Meals';   // 아침
    if (hour >= 12 && hour < 14) return 'Meals'; // 점심
    if (hour >= 18 && hour < 21) return 'Meals'; // 저녁
  }
  
  // task 타입이고 위에 해당하지 않으면 기본적으로 'Deep work' 또는 'Study'로 추론
  if (type === 'task') {
    if (/준비|시험|공부|학습/i.test(t)) return 'Study';
    return 'Deep work';
  }
  
  return 'Uncategorized';
}

