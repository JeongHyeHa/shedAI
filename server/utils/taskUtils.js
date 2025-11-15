/**
 * Task 관련 유틸리티 함수
 * 
 * title 추출 및 정제 로직을 포함합니다.
 */

// 🔹 앞쪽에 붙은 날짜/시간/오늘·내일 같은 표현 제거 유틸
function stripLeadingDateTimePhrases(s) {
  let out = s;

  // 오늘/내일/모레 + 요일
  out = out.replace(
    /^(오늘|내일|모레|이번주|다음주|다다음주)\s*[월화수목금토일]요일?\s*(에)?\s*/i,
    ''
  );

  // 오늘/내일/모레 + (오전/오후) 시간
  out = out.replace(
    /^(오늘|내일|모레)\s*(오전|오후)?\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?\s*(에)?\s*/i,
    ''
  );

  // 단독 요일
  out = out.replace(
    /^(이번주|다음주|다다음주)?\s*[월화수목금토일]요일?\s*(에)?\s*/i,
    ''
  );

  // 12월 1일까지 / 12월 1일 까지
  out = out.replace(
    /^\d{1,2}\s*월\s*\d{1,2}\s*일?\s*(까지|까진)?\s*/i,
    ''
  );

  // (오전/오후) 4시 20분에
  out = out.replace(
    /^(오전|오후)\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?\s*(에)?\s*/i,
    ''
  );

  // 숫자 월.일 형태 (12.1, 12-1 등)
  out = out.replace(
    /^\d{1,2}\s*[.\-\/]\s*\d{1,2}\s*(까지|까진)?\s*/i,
    ''
  );

  return out.trim();
}

/**
 * 사용자 입력에서 task title을 정제하여 추출합니다.
 * 
 * @param {string} input - 사용자 입력 텍스트 또는 여러 줄 요약 텍스트
 * @returns {string} 정제된 title
 * 
 * @example
 * extractTaskTitle("학술제 발표 PPT 만들어야 해. 마감일은 12월 1일이고 중요도와 난이도는 중이야.")
 * // => "학술제 발표 PPT"
 * 
 * extractTaskTitle(`은 12월 1일이고 중요도와 난이도는 중이야.
 * 마감일: 2025. 12. 1.
 * 중요도: 중
 * 난이도: 중
 * 학술제 발표 PPT 만들어야 해. 마감일`)
 * // => "학술제 발표 PPT"
 */
function extractTaskTitle(input) {
  if (!input || typeof input !== 'string') {
    return '할 일';
  }

  // 0) 여러 줄 들어오는 경우: 뒤에서부터 "해야"류가 있는 줄을 우선 선택
  let text = input.trim();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length > 1) {
    let picked = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/(해야|만들어야|준비해야|작성해야)/.test(lines[i])) {
        picked = lines[i];
        break;
      }
    }
    text = picked || lines[lines.length - 1];
  }

  // 🔹 0-1) 먼저 "회의/미팅/발표/프로젝트/과제" 같은 키워드를 우선적으로 잡기
  //  - "오늘 오후 4시 20분에 회의 일정 추가해줘" -> "회의"
  const meetingOrTaskKeywordRegex =
    /([가-힣A-Za-z0-9\s]{0,30}?)(회의|미팅|면담|인터뷰|진료|상담|발표|수업|강의|세미나|프로젝트|과제)(\s*일정)?/;

  const kwMatch = text.match(meetingOrTaskKeywordRegex);
  if (kwMatch) {
    let cand = (kwMatch[1] + kwMatch[2]).trim(); // 앞+키워드
    cand = stripLeadingDateTimePhrases(cand);
    cand = cand.replace(/\s*일정$/, '');         // '회의 일정' -> '회의'
    cand = cand.replace(/(을|를|은|는|의)\s*$/g, '').trim();
    if (cand) {
      return cand;
    }
  }

  // 1) "마감일", "기한", "데드라인" 이후 전부 제거 (선택된 한 줄에만 적용)
  text = text.split(/마감일|마감|기한|데드라인/)[0].trim();

  // 🔹 1-1) 한 번 더 앞쪽 날짜/시간 표현 제거
  text = stripLeadingDateTimePhrases(text);

  // 2) "해야 해/돼/됨/함", "만들어야 해", "~준비해야 해" 등 제거
  text = text
    .replace(/만들어야\s*해/g, '')
    .replace(/준비해야\s*해/g, '')
    .replace(/작성해야\s*해/g, '')
    .replace(/해야\s*(해|돼|됨|함)/g, '')
    .replace(/해야\s*돼/g, '')
    .replace(/해야\s*함/g, '')
    .replace(/일정\s*(추가|등록)\s*해줘?/g, '') // "일정 추가해줘" 제거
    .replace(/추가해줘/g, '')
    .replace(/등록해줘/g, '')
    .trim();

  // 3) 종결 조사 제거 (문장 끝의 조사만)
  text = text.replace(/(을|를|은|는|의)\s*$/g, '').trim();

  // 4) 문장 부호 제거
  text = text.replace(/[.!?。，,]/g, '').trim();

  // 5) 앞부분 명사구 추출 (한글/영문/숫자/공백만)
  const match = text.match(/^[가-힣A-Za-z0-9\s]+/);
  let title = match ? match[0].trim() : text.trim();

  // 6) 혹시 문장 앞에 조사만 남아 있으면 제거 (예: "은 학술제 발표 PPT")
  title = title.replace(/^(은|는|을|를|이|가)\s+/, '').trim();

  // 7) 최종 정제: 앞뒤 공백 제거 및 빈 문자열 체크
  if (!title || title.length < 1) {
    // 그래도 못 뽑았으면 원문에서 한 번 더 시도
    let verbMatch = input.match(/([가-힣A-Za-z0-9\s]{2,40})\s*(만들어야|준비해야|해야|작성해야)/);
    if (verbMatch && verbMatch[1]) {
      title = verbMatch[1].trim();
      // 👉 여기서도 날짜/시간/조사 제거
      title = stripLeadingDateTimePhrases(title);
      title = title.replace(/(을|를|은|는|의)\s*$/g, '').trim();
    }
  }

  if (!title || title.length < 1) {
    return '할 일';
  }

  // 8) 최대 길이 제한 (너무 긴 경우 앞부분만)
  if (title.length > 50) {
    title = title.substring(0, 50).trim();
  }

  return title;
}

/**
 * Task 객체의 title을 정제합니다.
 * 
 * @param {Object} task - Task 객체
 * @param {string} task.title - 원본 title
 * @param {string} [task.description] - 원본 description (title이 없을 때 사용)
 * @returns {Object} title이 정제된 task 객체
 */
function normalizeTaskTitle(task) {
  if (!task || typeof task !== 'object') {
    return task;
  }

  // title이 있으면 정제, 없으면 description에서 추출 시도
  const sourceText = task.title || task.description || '';
  const normalizedTitle = extractTaskTitle(sourceText);

  return {
    ...task,
    title: normalizedTitle
  };
}

module.exports = {
  extractTaskTitle,
  normalizeTaskTitle
};

