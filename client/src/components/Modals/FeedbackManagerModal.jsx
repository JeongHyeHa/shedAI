// 피드백 관리 모달
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import firestoreService from '../../services/firestoreService';
import '../../styles/modal.css';

const FeedbackManagerModal = ({ isOpen, onClose, onSelectFeedback }) => {
  const { user } = useAuth();
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && user?.uid) {
      loadFeedbacks();
    }
  }, [isOpen, user?.uid]);

  const loadFeedbacks = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      const data = await firestoreService.getFeedbacks(user.uid);
      // createdAt 기준으로 최신순 정렬
      const sorted = data.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return dateB - dateA;
      });
      setFeedbacks(sorted);
    } catch (error) {
      // alert 제거 - 피드백이 없으면 그냥 빈 화면 표시
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (feedbackId) => {
    if (!window.confirm('이 피드백을 삭제하시겠습니까?')) return;
    if (!user?.uid) return;

    try {
      await firestoreService.deleteFeedback(user.uid, feedbackId);
      setFeedbacks(prev => prev.filter(f => f.id !== feedbackId));
      alert('피드백이 삭제되었습니다.');
    } catch (error) {
      console.error('피드백 삭제 실패:', error);
      alert('피드백 삭제에 실패했습니다.');
    }
  };

  const handleSelect = (feedback) => {
    const text = getFeedbackText(feedback);
    if (onSelectFeedback && text && text !== '내용 없음') {
      onSelectFeedback(text);
      onClose();
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '날짜 없음';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '날짜 없음';
    }
  };

  const getFeedbackText = (feedback) => {
    if (feedback.userMessage) {
      return typeof feedback.userMessage === 'string' 
        ? feedback.userMessage 
        : String(feedback.userMessage);
    }
    if (feedback.feedbackText) {
      return typeof feedback.feedbackText === 'string'
        ? feedback.feedbackText
        : String(feedback.feedbackText);
    }
    if (feedback.text) {
      if (typeof feedback.text === 'object' && feedback.text !== null) {
        if (feedback.text.text && typeof feedback.text.text === 'string') {
          return feedback.text.text;
        }
        return JSON.stringify(feedback.text);
      }
      if (typeof feedback.text === 'string') {
        return feedback.text;
      }
      return String(feedback.text);
    }
    return '내용 없음';
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal feedback-manager-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0 }}>내 피드백 관리</h2>
          <button className="close-btn" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#666' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>피드백을 불러오는 중...</div>
          ) : feedbacks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <p style={{ margin: 0, color: '#333' }}>아직 입력한 피드백이 없습니다.</p>
              <p style={{ fontSize: '14px', color: '#666', marginTop: '8px', margin: '8px 0 0 0' }}>
                피드백을 입력하면 여기에 표시됩니다.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {feedbacks.map((feedback) => {
                const text = getFeedbackText(feedback);
                return (
                  <div 
                    key={feedback.id} 
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '16px',
                      background: '#f5f5f5',
                      borderRadius: '8px',
                      border: '1px solid #e0e0e0'
                    }}
                  >
                    <div 
                      onClick={() => handleSelect(feedback)}
                      style={{ 
                        cursor: 'pointer', 
                        flex: 1,
                        minWidth: 0
                      }}
                    >
                      <div style={{ color: '#333', marginBottom: '4px', wordBreak: 'break-word' }}>{text}</div>
                      <div style={{ fontSize: '12px', color: '#666' }}>{formatDate(feedback.createdAt)}</div>
                    </div>
                    <button 
                      onClick={() => handleDelete(feedback.id)}
                      title="삭제"
                      style={{
                        marginLeft: '12px',
                        padding: '6px 12px',
                        background: '#ff4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: '#6C8AE4',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackManagerModal;

