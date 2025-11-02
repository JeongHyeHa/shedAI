// Free Windows 계산 유틸리티 (drop-in upgrade)

const { timeToMinutes, minutesToTime } = require('./scheduleUtils');

/**
 * freeWindows 계산: busy 블록을 제외한 자유 시간대 계산
 * - busy 겹침/인접 병합
 * - 00:00 ~ workdayEnd 경계 클램핑
 * - "24:00" 안전 처리
 * - 최소 30분 필터
 * - 옵션 nowFloor: 오늘(allowedDays[0])의 과거 시간대 제외
 *
 * @param {Array<{day:number,start:string,end:string,title?:string,source?:string}>} busy
 * @param {number[]} allowedDays - 상대 day 배열 (예: [1..14])
 * @param {string} workdayEnd - 기본 '23:00'
 * @param {Object} [opts]
 * @param {string} [opts.workdayStart='00:00'] - 근무 시작 경계
 * @param {boolean} [opts.nowFloor=false] - true면 todayStart를 '지금'으로 올림(첫 번째 day만)
 * @param {Date} [opts.baseNow=new Date()] - nowFloor 기준 시각
 * @param {number} [opts.minMinutes=30] - 최소 free window 길이
 */
function calculateFreeWindows(
  busy,
  allowedDays,
  workdayEnd = '23:00',
  opts = {}
) {
  const workdayStart = opts.workdayStart || '00:00';
  const minMinutes = Number.isFinite(opts.minMinutes) ? opts.minMinutes : 30;
  const baseNow = opts.baseNow instanceof Date ? opts.baseNow : new Date();
  const useNowFloor = !!opts.nowFloor;

  // 안전한 분 변환 (24:00 지원)
  const toMinSafe = (t) => (t === '24:00' ? 24 * 60 : timeToMinutes(t));

  const dayStartMinDefault = toMinSafe(workdayStart);
  const dayEndMinDefault = toMinSafe(workdayEnd);

  const freeWindows = {};
  const busyByDay = {};

  // busy를 day별로 모으고, 문자열 시각 → 분 단위로 변환
  for (const b of busy || []) {
    if (!b || typeof b.day !== 'number') continue;
    const s = toMinSafe(b.start || '00:00');
    const e = toMinSafe(b.end || '00:00');
    if (!busyByDay[b.day]) busyByDay[b.day] = [];
    busyByDay[b.day].push({ start: s, end: e });
  }

  // 오늘(relative 첫 day)에 대한 nowFloor 계산
  const nowHHMM = `${String(baseNow.getHours()).padStart(2, '0')}:${String(
    baseNow.getMinutes()
  ).padStart(2, '0')}`;
  const nowMin = toMinSafe(nowHHMM);
  const firstRelDay = allowedDays?.[0];

  for (const day of allowedDays || []) {
    const dayBusyRaw = (busyByDay[day] || []).slice();

    // 경계 (필요 시 오늘만 nowFloor 적용)
    let dayStartMin = dayStartMinDefault;
    if (useNowFloor && day === firstRelDay) {
      dayStartMin = Math.max(dayStartMinDefault, nowMin);
    }
    const dayEndMin = dayEndMinDefault;

    // 1) 경계 클램핑 + 비정상 구간 제거
    const clamped = dayBusyRaw
      .map(({ start, end }) => {
        const s = Math.max(dayStartMin, Math.min(dayEndMin, start));
        const e = Math.max(dayStartMin, Math.min(dayEndMin, end));
        return e > s ? { start: s, end: e } : null;
      })
      .filter(Boolean);

    // 2) 시작 기준 정렬
    clamped.sort((a, b) => a.start - b.start);

    // 3) 겹침/인접 병합 (인접: end === next.start 도 병합)
    const merged = [];
    for (const blk of clamped) {
      if (!merged.length) {
        merged.push({ ...blk });
        continue;
      }
      const last = merged[merged.length - 1];
      if (blk.start <= last.end) {
        // 겹침 또는 인접 → 확장
        last.end = Math.max(last.end, blk.end);
      } else {
        merged.push({ ...blk });
      }
    }

    // 4) free window 추출
    const windows = [];
    let cursor = dayStartMin;

    for (const blk of merged) {
      if (cursor < blk.start) {
        windows.push({ start: cursor, end: blk.start });
      }
      cursor = Math.max(cursor, blk.end);
    }

    // 마지막 busy 이후 ~ dayEnd
    if (cursor < dayEndMin) {
      windows.push({ start: cursor, end: dayEndMin });
    }

    // 5) 최소 길이 필터 + 문자열로 변환
    freeWindows[day] = windows
      .filter((w) => w.end - w.start >= minMinutes)
      .map((w) => ({
        start: minutesToTime(w.start),
        end: minutesToTime(w.end),
      }));
  }

  return freeWindows;
}

/**
 * 큰 free window를 2시간 단위로 분할 (최대한 활용)
 * - 2시간 이상이면 2시간 단위로 자르기
 * - 마지막 남은 부분은 1시간 이상이면 그대로 사용, 아니면 제거
 * - 예: 6시간 블록 → [2시간, 2시간, 2시간] 또는 [2시간, 2시간, 남은 시간]
 *
 * @param {Object<number, Array<{start:string, end:string}>>} freeWindows
 * @param {number} [chunkMinutes=120] - 분할할 단위 (기본 2시간)
 * @param {number} [minChunkMinutes=60] - 최소 허용 단위 (기본 1시간)
 */
function splitLargeFreeWindows(freeWindows, chunkMinutes = 120, minChunkMinutes = 60) {
  const toMinSafe = (t) => (t === '24:00' ? 24 * 60 : timeToMinutes(t));
  const result = {};
  
  for (const [day, windows] of Object.entries(freeWindows || {})) {
    const dayNum = Number(day);
    if (!Array.isArray(windows)) continue;
    
    const splitWindows = [];
    
    for (const win of windows) {
      const startMin = toMinSafe(win.start);
      const endMin = toMinSafe(win.end);
      const duration = endMin - startMin;
      
      // chunkMinutes보다 작으면 그대로 사용
      if (duration <= chunkMinutes) {
        splitWindows.push(win);
        continue;
      }
      
      // chunkMinutes 단위로 자르기
      let cursor = startMin;
      while (cursor < endMin) {
        const remaining = endMin - cursor;
        
        // 남은 시간이 minChunkMinutes보다 작으면 중단 (너무 작은 조각 제거)
        if (remaining < minChunkMinutes) {
          break;
        }
        
        // 남은 시간이 chunkMinutes 이상이면 chunkMinutes만큼, 아니면 남은 시간만큼
        const chunkSize = remaining >= chunkMinutes ? chunkMinutes : remaining;
        const chunkEnd = cursor + chunkSize;
        
        splitWindows.push({
          start: minutesToTime(cursor),
          end: minutesToTime(chunkEnd)
        });
        
        cursor = chunkEnd;
      }
    }
    
    if (splitWindows.length > 0) {
      result[dayNum] = splitWindows;
    }
  }
  
  return result;
}

module.exports = {
    calculateFreeWindows,
    splitLargeFreeWindows
};
