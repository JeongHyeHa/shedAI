// scheduleNormalize.js
// 스케줄 입력 형식을 정규화하는 유틸리티 함수

/**
 * 다양한 스케줄 입력 형식을 배열로 정규화
 * @param {any} input - 스케줄 데이터 (배열, 객체, null 등)
 * @returns {Array} 정규화된 스케줄 배열
 */
export function normalizeSchedule(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.scheduleData)) return input.scheduleData;
  if (Array.isArray(input?.schedule)) return input.schedule;
  return [];
}

/**
 * 스케줄에 유효한 활동이 있는지 확인
 * @param {any} schedule - 스케줄 데이터
 * @returns {boolean} 활동이 있는지 여부
 */
export function hasAnyActivities(schedule) {
  const arr = normalizeSchedule(schedule);
  return arr.some(day => 
    day.activities && Array.isArray(day.activities) && day.activities.length > 0
  );
}
