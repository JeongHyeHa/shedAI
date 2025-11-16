// components/Friends/FriendScheduleModal.jsx
import React from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import '../../styles/fullcalendar-custom.css';
import './FriendScheduleModal.css';

const FriendScheduleModal = ({ visible, onClose, events, friend, loading }) => {
  if (!visible) return null;

  return (
    <div className="friend-schedule-modal-overlay" onClick={onClose}>
      <div
        className="friend-schedule-modal-content"
        onClick={(e) => e.stopPropagation()} // 모달 안 클릭 시 닫히지 않게
      >
        <div className="friend-schedule-modal-header">
          <h2 className="friend-schedule-modal-title">
            {friend?.displayName || friend?.email || '친구'}님의 일정
          </h2>
          <button className="friend-schedule-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="friend-schedule-modal-body">
          {loading ? (
            <div className="friend-schedule-loading">
              <div className="spinner-ring">
                <div className="circular-spinner"></div>
              </div>
              <p>일정을 불러오는 중...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="friend-schedule-empty">
              <p>등록된 일정이 없습니다.</p>
            </div>
          ) : (
            <div className="friend-calendar-container">
              <FullCalendar
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView="timeGridWeek"
                initialDate={new Date()}
                headerToolbar={{
                  start: 'prev,next today',
                  center: 'title',
                  end: 'dayGridMonth,timeGridWeek,timeGridDay',
                }}
                height="auto"
                aspectRatio={1.8}
                allDaySlot={true}
                navLinks={true}
                nowIndicator={true}
                editable={false}
                eventStartEditable={false}
                eventDurationEditable={false}
                events={events}
                eventClassNames={(arg) => {
                  const classes = [];
                  const source = arg.event.extendedProps?.source;
                  const type = arg.event.extendedProps?.type;
                  if (source === 'friend') {
                    classes.push('friend-event');
                  }
                  if (type === 'lifestyle') {
                    classes.push('friend-lifestyle');
                  }
                  if (type === 'task') {
                    classes.push('friend-task');
                  }
                  if (type === 'appointment') {
                    classes.push('friend-appointment');
                  }
                  return classes;
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FriendScheduleModal;

