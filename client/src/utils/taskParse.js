// utils/taskParse.js

const META_INFO_REGEX = /(중요도|난이도|priority|difficulty|중요\s*도|난이\s*도)/i;
const ACTION_VERBS = [
  '정리','준비','작성','완성','편집','주문','예약','수강',
  '공부','학습','암기','외우','복습','예습','검토','리뷰',
  '제작','업데이트','정돈','정비','완료','완주','풀이','풀기',
  '풀어','읽기','읽어','읽고','보는','보기','보고','연습',
  '마치','마무리','제출','정리하기','정리해','정리하고','정돈하기',
  '암기하기','외우기','수강하기','준비하기','작성하기','완성하기'
];
const ACTION_VERB_PATTERN = `(${ACTION_VERBS.map(v => v.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})`;

function stripLeadingDateTimePhrases(s) {
  let out = s;
  out = out.replace(/^\s*(이번|다음|다다음)\s+주/gi, '$1주');
  out = out.replace(/^\s*(한|두|세|네)?\s*(시간|일|주|달|개월)\s*(안에|안|이내|내)\s*/i, '');
  out = out.replace(/^\s*\d+\s*(시간|일|주|달|개월)\s*(안에|안|이내|내)\s*/i, '');
  out = out.replace(/^\s*(연말|연초|올해|올해안|해당년|이번\s*달|이번\s*달\s*안|이번\s*달\s*내)\s*(까지|안에|안)?\s*/i, '');
  out = out.replace(/^\s*(올해|내년|금년)\s*(안에|안|까지)?\s*/i, '');
  out = out.replace(/^\s*(이번|다음|지난)\s*(달|월)\s*\d+\s*(일까지|안에|내)?\s*/i, '');
  out = out.replace(
    /^\s*(오늘|내일|모레|이번주|다음주|다다음주)\s*[월화수목금토일]요일?\s*(까지|에)?\s*/i,
    ''
  );
  out = out.replace(
    /^\s*(오늘|내일|모레)\s*(오전|오후)?\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?\s*(까지|에)?\s*/i,
    ''
  );
  out = out.replace(
    /^\s*(이번주|다음주|다다음주)?\s*[월화수목금토일]요일?\s*(까지|에)?\s*/i,
    ''
  );
  out = out.replace(/^\s*\d{1,2}\s*월\s*\d{1,2}\s*일?\s*(까지|까진)?\s*/i, '');
  out = out.replace(/^\s*(오전|오후)\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?\s*(까지|에)?\s*/i, '');
  out = out.replace(/^\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}\s*(까지|까진)?\s*/i, '');
  return out.trim();
}

function cleanupTitle(title, sourceText = '') {
  if (!title || typeof title !== 'string') return '할 일';
  let out = stripLeadingDateTimePhrases(title).replace(/\s+/g, ' ').trim();
  out = out.replace(/\s*(해서|하려고|하려|하려면|하려니|하려함|하고|하고자|하고싶|하고싶어|하고싶다|싶어|싶다)\s.*$/g, '').trim();
  const metaIdx = out.search(META_INFO_REGEX);
  if (metaIdx !== -1) {
    out = out.slice(0, metaIdx).trim();
  }
  out = out.replace(/(을|를|은|는|이|가|와|과)\s*$/g, '').trim();
  if (sourceText) {
    const foundVerb = ACTION_VERBS.find(v => sourceText.includes(v));
    if (foundVerb && !out.includes(foundVerb)) {
      out = `${out} ${foundVerb}`.trim();
    }
  }
  if (out.length > 50) {
    out = out.substring(0, 50).trim();
  }
  if (!out || out.length < 2 || ['오늘','내일','모레','이번주','다음주','다음','주말'].includes(out)) {
    return '할 일';
  }
  return out;
}

/**
 * 사용자 입력에서 task title을 정제하여 추출합니다.
 * 서버의 extractTaskTitle과 동일한 로직입니다.
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
  const normalizedLines = text.replace(/[.!?]/g, '\n');
  const lines = normalizedLines.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length > 1) {
    const priorityRegex = /(해야|만들어야|준비해야|작성해야|필요|정리|준비|작성|완성|검토|리뷰|외워야|완료)/;
    let picked = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (META_INFO_REGEX.test(lines[i])) continue;
      if (priorityRegex.test(lines[i])) {
        picked = lines[i];
        break;
      }
    }
    if (!picked) {
      picked = lines.find(line => !META_INFO_REGEX.test(line)) || lines[lines.length - 1];
    }
    text = picked;
  }

  const actionSourceText = text;

  text = stripLeadingDateTimePhrases(text);

  // 🔹 0-1) 먼저 "회의/미팅/발표/프로젝트/과제" 같은 키워드를 우선적으로 잡기
  //  - "오늘 오후 4시 20분에 회의 일정 추가해줘" -> "회의"
  const meetingOrTaskKeywordRegex =
    /([가-힣A-Za-z0-9\s]{0,80}?)(회의|미팅|화상\s*미팅|면담|인터뷰|진료|상담|발표회|발표|수업|강의|세미나|프로젝트|과제|콜|예약)(\s*(일정|미팅))?/;

  const kwMatch = text.match(meetingOrTaskKeywordRegex);
  if (kwMatch) {
    let cand = (kwMatch[1] + kwMatch[2]).trim(); // 앞+키워드
    cand = stripLeadingDateTimePhrases(cand);
    cand = cand.replace(/\s*일정$/, '');         // '회의 일정' -> '회의'
    cand = cand.replace(/(을|를|은|는|이|가|와|과|및)\s*$/g, '').trim();
    cand = cand.replace(/\s+/g, ' ').trim();
    if (cand) {
      return cleanupTitle(cand, actionSourceText);
    }
  }

  // 1) "마감일", "기한", "데드라인" 이후 전부 제거 (선택된 한 줄에만 적용)
  text = text.split(/마감일|마감|기한|데드라인/)[0].trim();

  // 2) "해야 해/돼/됨/함", "만들어야 해", "~준비해야 해" 등 제거
  text = text
    .replace(/만들어야\s*해/g, '')
    .replace(/준비해야\s*해/g, '')
    .replace(/작성해야\s*해/g, '')
    .replace(/해야\s*(해|돼|됨|함)/g, '')
    .replace(/해야\s*돼/g, '')
    .replace(/해야\s*함/g, '')
    .replace(/일정\s*(추가|등록)\s*해줘?/g, '')
    .replace(/추가해줘/g, '')
    .replace(/등록해줘/g, '')
    .trim();

  // 3) 종결 조사 제거 (문장 끝의 조사만)
  text = text.replace(/(을|를|은|는|이|가)\s*$/g, '').trim();

  // 4) 문장 부호 제거
  text = text.replace(/[.!?。，,]/g, '').trim();

  // 5) 앞부분 명사구 추출 (한글/영문/숫자/공백만)
  const match = text.match(/^[가-힣A-Za-z0-9\s]+/);
  let title = match ? match[0].trim() : text.trim();

  // 6) 혹시 문장 앞에 조사만 남아 있으면 제거 (예: "은 학술제 발표 PPT")
  title = title.replace(/^(은|는|을|를|이|가)\s+/, '').trim();

  // 7) 최종 정제: 앞뒤 공백 제거 및 빈 문자열 체크
  if (!title || title.length < 2 || ['오늘','내일','모레','이번주','다음주','다음','주말'].includes(title)) {
    let verbMatch = input.match(/([가-힣A-Za-z0-9\s]{2,60})\s*(만들어야|준비해야|해야|작성해야)/);
    if (verbMatch && verbMatch[1]) {
      title = verbMatch[1].trim();
      title = stripLeadingDateTimePhrases(title);
      title = title.replace(/(을|를|은|는|이|가)\s*$/g, '').trim();
      const metaIdx3 = title.search(META_INFO_REGEX);
      if (metaIdx3 !== -1) {
        title = title.slice(0, metaIdx3).trim();
      }
    }
  }

  return cleanupTitle(title, actionSourceText);
}

export function parseKoreanTaskSentence(input, baseDate = new Date()) {
  if (!input || typeof input !== 'string') return null;

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

  // 제목 정제: extractTaskTitle 함수 사용
  const cleanTitle = extractTaskTitle(input);

  if (!cleanTitle || cleanTitle === '할 일' || !deadline) return null;

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

// extractTaskTitle을 export하여 다른 곳에서도 사용 가능하도록
export { extractTaskTitle };
