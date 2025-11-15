// server/routes/googleCalendarRoutes.js
const express = require('express');
const router = express.Router();
const { 
  listUpcomingEvents, 
  syncEventsToGoogleCalendar 
} = require('../services/googleCalendarService');

/**
 * GET /api/google-calendar/list
 * 사용자의 Google Calendar 이벤트 조회
 */
router.post('/list', async (req, res) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ 
        error: 'accessToken이 필요합니다.',
        code: 'MISSING_ACCESS_TOKEN'
      });
    }

    const events = await listUpcomingEvents(accessToken, {
      maxResults: req.body.maxResults || 10,
      timeMin: req.body.timeMin || undefined,
    });

    res.json({ 
      success: true,
      events,
      count: events.length 
    });
  } catch (error) {
    console.error('[GoogleCalendarRoutes] /list 오류:', error);
    res.status(500).json({ 
      error: error.message || 'Google Calendar 이벤트 조회 실패',
      code: 'LIST_EVENTS_FAILED'
    });
  }
});

/**
 * POST /api/google-calendar/sync-events
 * shedAI 일정을 Google Calendar에 동기화
 */
router.post('/sync-events', async (req, res) => {
  try {
    const { accessToken, scheduleEvents } = req.body;

    if (!accessToken) {
      return res.status(400).json({ 
        error: 'accessToken이 필요합니다.',
        code: 'MISSING_ACCESS_TOKEN'
      });
    }

    if (!Array.isArray(scheduleEvents)) {
      return res.status(400).json({ 
        error: 'scheduleEvents는 배열이어야 합니다.',
        code: 'INVALID_SCHEDULE_EVENTS'
      });
    }

    if (scheduleEvents.length === 0) {
      return res.status(400).json({ 
        error: '동기화할 일정이 없습니다.',
        code: 'EMPTY_SCHEDULE_EVENTS'
      });
    }

    const created = await syncEventsToGoogleCalendar(accessToken, scheduleEvents);

    res.json({ 
      success: true,
      createdCount: created.length,
      totalRequested: scheduleEvents.length,
      created: created.map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
        htmlLink: e.htmlLink, // Google Calendar에서 볼 수 있는 링크
      }))
    });
  } catch (error) {
    console.error('[GoogleCalendarRoutes] /sync-events 오류:', error);
    res.status(500).json({ 
      error: error.message || 'Google Calendar 동기화 실패',
      code: 'SYNC_EVENTS_FAILED'
    });
  }
});

/**
 * GET /api/google-calendar/health
 * Google Calendar API 연결 상태 확인
 */
router.get('/health', (req, res) => {
  res.json({ 
    ok: true,
    service: 'Google Calendar API',
    message: '서비스 정상 작동 중'
  });
});

module.exports = router;

