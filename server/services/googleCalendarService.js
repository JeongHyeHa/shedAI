// server/services/googleCalendarService.js
const { google } = require('googleapis');

/**
 * Google Calendar API 클라이언트 생성
 * @param {string} accessToken - Google OAuth access token
 * @returns {object} Calendar API 클라이언트
 */
function getCalendarClient(accessToken) {
  if (!accessToken) {
    throw new Error('Google Calendar accessToken이 필요합니다.');
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * 사용자 기본 캘린더의 다가오는 이벤트 조회
 * @param {string} accessToken - Google OAuth access token
 * @param {object} options - 조회 옵션 (timeMin, maxResults 등)
 * @returns {Promise<Array>} 이벤트 배열
 */
async function listUpcomingEvents(accessToken, options = {}) {
  try {
    const calendar = getCalendarClient(accessToken);

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: options.timeMin || (new Date()).toISOString(),
      maxResults: options.maxResults || 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return res.data.items || [];
  } catch (error) {
    console.error('[GoogleCalendarService] listUpcomingEvents 오류:', error.message);
    throw new Error(`Google Calendar 이벤트 조회 실패: ${error.message}`);
  }
}

/**
 * shedAI 일정을 Google Calendar에 추가
 * @param {string} accessToken - Google OAuth access token
 * @param {object} event - Google Calendar 이벤트 객체
 * @returns {Promise<object>} 생성된 이벤트
 */
async function insertEvent(accessToken, event) {
  try {
    const calendar = getCalendarClient(accessToken);

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    return res.data;
  } catch (error) {
    console.error('[GoogleCalendarService] insertEvent 오류:', error.message);
    throw new Error(`Google Calendar 이벤트 추가 실패: ${error.message}`);
  }
}

/**
 * shedAI 이벤트 배열을 Google Calendar 이벤트 형식으로 변환
 * @param {Array} shedAIEvents - FullCalendar 이벤트 배열
 * @returns {Array} Google Calendar 이벤트 배열
 */
function convertShedAIEventsToGoogleCalendar(shedAIEvents) {
  return shedAIEvents.map(ev => {
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 60 * 60 * 1000); // 기본 1시간

    // extendedProps에서 추가 정보 추출
    const description = ev.extendedProps?.description || '';
    const type = ev.extendedProps?.type || 'task';
    const importance = ev.extendedProps?.importance || '';
    const difficulty = ev.extendedProps?.difficulty || '';

    // 설명에 메타데이터 추가
    let fullDescription = description;
    if (type || importance || difficulty) {
      const meta = [];
      if (type) meta.push(`타입: ${type}`);
      if (importance) meta.push(`중요도: ${importance}`);
      if (difficulty) meta.push(`난이도: ${difficulty}`);
      if (meta.length > 0) {
        fullDescription = (description ? description + '\n\n' : '') + meta.join(', ');
      }
    }

    return {
      summary: ev.title || '할 일',
      description: fullDescription,
      start: {
        dateTime: start.toISOString(),
        timeZone: 'Asia/Seoul',
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: 'Asia/Seoul',
      },
    };
  });
}

/**
 * 여러 shedAI 이벤트를 한 번에 Google Calendar에 추가
 * @param {string} accessToken - Google OAuth access token
 * @param {Array} shedAIEvents - FullCalendar 이벤트 배열
 * @returns {Promise<Array>} 생성된 이벤트 배열
 */
async function syncEventsToGoogleCalendar(accessToken, shedAIEvents) {
  try {
    const googleEvents = convertShedAIEventsToGoogleCalendar(shedAIEvents);
    const created = [];

    // 순차적으로 추가 (Google API rate limit 고려)
    for (const event of googleEvents) {
      try {
        const createdEvent = await insertEvent(accessToken, event);
        created.push(createdEvent);
        
        // API rate limit 방지를 위한 짧은 지연
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`[GoogleCalendarService] 이벤트 추가 실패: ${event.summary}`, error.message);
        // 개별 실패는 로그만 남기고 계속 진행
      }
    }

    return created;
  } catch (error) {
    console.error('[GoogleCalendarService] syncEventsToGoogleCalendar 오류:', error.message);
    throw error;
  }
}

module.exports = {
  listUpcomingEvents,
  insertEvent,
  syncEventsToGoogleCalendar,
  convertShedAIEventsToGoogleCalendar,
};

