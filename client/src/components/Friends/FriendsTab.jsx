// components/Friends/FriendsTab.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  findUserByEmail,
  getFriends,
  sendFriendRequest,
  acceptFriendRequest,
  getIncomingRequests,
  removeFriend,
} from '../../services/friendService';
import './FriendsTab.css';

const FriendsTab = ({ onSelectFriend, selectedFriendUid }) => {
  const { user } = useAuth();
  const [emailInput, setEmailInput] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [friends, setFriends] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reqLoading, setReqLoading] = useState(false);
  const [error, setError] = useState('');

  // 내 친구 목록 + 받은 친구 요청 목록 로드
  const loadFriendsAndRequests = useCallback(async () => {
    if (!user?.uid) return;
    try {
      setLoading(true);
      const [friendsList, requests] = await Promise.all([
        getFriends(user.uid),
        getIncomingRequests(user.uid),
      ]);
      setFriends(friendsList || []);
      setIncomingRequests(requests || []);
    } catch (e) {
      console.error('[FriendsTab] 친구/요청 로드 오류:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadFriendsAndRequests();
  }, [loadFriendsAndRequests]);

  // 이메일로 사용자 검색
  const handleSearchUser = async () => {
    setError('');
    setSearchResult(null);

    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) {
      setError('이메일을 입력하세요.');
      return;
    }
    if (!user?.uid) {
      setError('로그인이 필요합니다.');
      return;
    }

    try {
      setReqLoading(true);
      const result = await findUserByEmail(trimmed);
      if (!result) {
        setError('해당 이메일로 등록된 사용자가 없습니다.');
        return;
      }
      if (result.id === user.uid) {
        setError('자기 자신은 친구로 추가할 수 없습니다.');
        return;
      }
      setSearchResult(result);
    } catch (e) {
      console.error('[FriendsTab] 사용자 검색 오류:', e);
      setError(e.message || '사용자 검색 중 오류가 발생했습니다.');
    } finally {
      setReqLoading(false);
    }
  };

  // 친구 요청 보내기
  const handleSendFriendRequest = async () => {
    if (!user?.uid || !searchResult?.id) return;
    try {
      setReqLoading(true);
      await sendFriendRequest(user.uid, searchResult.id);
      alert('친구 요청을 보냈습니다!');
      setSearchResult(null);
      setEmailInput('');
      // 요청 목록 새로고침
      await loadFriendsAndRequests();
    } catch (e) {
      console.error('[FriendsTab] 친구 요청 오류:', e);
      alert(e.message || '친구 요청 중 오류가 발생했습니다.');
    } finally {
      setReqLoading(false);
    }
  };

  // 친구 요청 수락
  const handleAcceptRequest = async (request) => {
    if (!user?.uid) return;
    try {
      setReqLoading(true);
      // 현재 로그인한 사용자 UID를 명시적으로 사용
      await acceptFriendRequest(request.fromUid, user.uid);
      alert('친구로 추가되었습니다.');

      // 요청 목록 및 친구 목록 새로고침
      await loadFriendsAndRequests();
    } catch (e) {
      console.error('[FriendsTab] 친구 요청 수락 오류:', e);
      alert(e.message || '친구 요청 수락 중 오류가 발생했습니다.');
    } finally {
      setReqLoading(false);
    }
  };

  // 친구 삭제
  const handleRemoveFriend = async (friend, e) => {
    e?.stopPropagation();
    if (!user?.uid || !friend?.friendUid) return;
    if (!window.confirm(`${friend.displayName || friend.email}님을 친구에서 삭제하시겠습니까?`)) return;

    try {
      setReqLoading(true);
      await removeFriend(user.uid, friend.friendUid);
      // 리스트 갱신 (방어적으로 friendUid || id로 처리)
      const friendId = friend.friendUid || friend.id;
      setFriends((prev) => prev.filter((f) => (f.friendUid || f.id) !== friendId));
      // 선택되어 있던 친구라면 선택 해제
      if (selectedFriendUid === friendId) {
        onSelectFriend?.(null);
      }
    } catch (e) {
      console.error('[FriendsTab] 친구 삭제 오류:', e);
      alert(e.message || '친구 삭제 중 오류가 발생했습니다.');
    } finally {
      setReqLoading(false);
    }
  };

  const handleSelectFriendClick = (friend) => {
    onSelectFriend?.(friend);
  };

  return (
    <div className="friends-tab">
      <h3 className="friends-tab-title">친구</h3>

      {/* 친구 검색/요청 영역 */}
      <div className="friends-search-section">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSearchUser();
          }}
          className="friends-add-form"
        >
          <input
            type="email"
            placeholder="이메일로 친구 찾기"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="friends-email-input"
            disabled={reqLoading}
          />
          <button
            type="submit"
            disabled={reqLoading}
            className="friends-add-button"
          >
            {reqLoading ? '검색 중...' : '검색'}
          </button>
        </form>

        {error && (
          <div className="friends-message error">
            {error}
          </div>
        )}

        {searchResult && (
          <div className="friends-search-result">
            <div className="friends-search-result-info">
              <strong>{searchResult.displayName || searchResult.email}</strong>
              {searchResult.email && (
                <span className="friends-search-result-email">({searchResult.email})</span>
              )}
            </div>
            <button
              onClick={handleSendFriendRequest}
              disabled={reqLoading}
              className="friends-send-request-button"
            >
              {reqLoading ? '요청 중...' : '친구 요청 보내기'}
            </button>
          </div>
        )}
      </div>

      {/* 받은 친구 요청 목록 */}
      {incomingRequests.length > 0 && (
        <div className="friends-requests-section">
          <h4 className="friends-list-title">받은 친구 요청</h4>
          {loading ? (
            <p className="friends-loading-text">로딩 중...</p>
          ) : (
            <ul className="friends-requests-list">
              {incomingRequests.map((req) => (
                <li key={req.id} className="friends-request-item">
                  <div className="friends-request-info">
                    <strong>{req.fromDisplayName || req.fromEmail || req.fromUid}</strong>
                    {req.fromEmail && (
                      <span className="friends-request-email">({req.fromEmail})</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleAcceptRequest(req)}
                    disabled={reqLoading}
                    className="friends-accept-button"
                  >
                    {reqLoading ? '수락 중...' : '수락'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 내 친구 목록 */}
      <div className="friends-list-section">
        <h4 className="friends-list-title">내 친구</h4>
        {loading ? (
          <p className="friends-loading-text">로딩 중...</p>
        ) : friends.length === 0 ? (
          <div className="friends-empty">등록된 친구가 없습니다.</div>
        ) : (
          <ul className="friends-list">
            {friends.map((friend) => (
              <li
                key={friend.friendUid || friend.id}
                className={`friends-item ${selectedFriendUid === (friend.friendUid || friend.id) ? 'selected' : ''}`}
                onClick={() => handleSelectFriendClick(friend)}
              >
                <div className="friends-item-content">
                  <strong className="friends-item-name">
                    {friend.displayName || friend.email || friend.friendUid}
                  </strong>
                  {friend.email && (
                    <span className="friends-item-email">({friend.email})</span>
                  )}
                </div>
                <button
                  className="friends-remove-button"
                  onClick={(e) => handleRemoveFriend(friend, e)}
                  disabled={reqLoading}
                  title="친구 삭제"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FriendsTab;
