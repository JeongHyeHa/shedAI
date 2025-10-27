// utils/taskParse.js
export function parseKoreanTaskSentence(input, baseDate = new Date()) {
  if (!input || typeof input !== 'string') return null;

  const titleMatch = input.match(/^(.+?)(?:[.。]|$)/); // 첫 문장 마침표 전까지
  const title = titleMatch ? titleMatch[1].trim() : '';

  // 마감일: "10월 30일(까지)" 형태
  const dlMatch = input.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  let deadline = null;
  if (dlMatch) {
    const yy = baseDate.getFullYear();
    const mm = parseInt(dlMatch[1], 10) - 1;
    const dd = parseInt(dlMatch[2], 10);
    const d = new Date(yy, mm, dd, 23, 59, 0, 0); // 엄격 마감: 23:59로 고정
    // 이미 지난 날짜면 내년으로 롤오버 (원하면 이 로직은 제거/변경)
    if (d < new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())) {
      deadline = new Date(yy + 1, mm, dd, 23, 59, 0, 0);
    } else {
      deadline = d;
    }
  }

  // 중요도/난이도
  const importance = /중요도\s*상/i.test(input) ? '상'
                    : /중요도\s*하/i.test(input) ? '하'
                    : /중요도\s*중/i.test(input) ? '중' : '상'; // default 상
  const difficulty = /난이도\s*상/i.test(input) ? '상'
                    : /난이도\s*하/i.test(input) ? '하'
                    : /난이도\s*중/i.test(input) ? '중' : '상'; // default 상

  // 힌트 플래그
  const strict = /엄격/.test(input);
  const focus = /집중\s*필요|집중/.test(input);

  // 제목 보정: 문장 끝 불필요 어휘 제거
  const cleanTitle = title.replace(/\s*(마감.*|중요도.*|난이도.*)$/i, '').trim() || '할 일';

  if (!cleanTitle || !deadline) return null;

  return {
    title: cleanTitle,
    deadline,                 // JS Date
    deadlineTime: '23:59',    // 일관성
    importance,
    difficulty,
    description: input,
    isActive: true,
    persistAsTask: true,      // 우리가 저장한 "실제" 태스크임을 표시
    strictDeadline: strict,
    needsFocus: focus,
    createdAt: new Date()
  };
}
