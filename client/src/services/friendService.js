// services/friendService.js
import { db } from '../config/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

/**
 * 이메일로 사용자 찾기
 * @param {string} email - 찾을 사용자 이메일
 * @returns {Promise<Object|null>} 사용자 정보 또는 null
 */
export async function findUserByEmail(email) {
  try {
    const q = query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;

    // 이메일은 유니크라고 가정
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  } catch (error) {
    console.error('[friendService] findUserByEmail 오류:', error);
    throw new Error('사용자 검색 중 오류가 발생했습니다.');
  }
}

/**
 * 서로 친구로 등록하기 (양방향)
 * @param {string} currentUid - 현재 사용자 UID
 * @param {string} email - 친구로 추가할 사용자 이메일
 * @returns {Promise<Object>} 추가된 친구 정보
 */
export async function addFriendByEmail(currentUid, email) {
  if (!currentUid) throw new Error('로그인이 필요합니다.');
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) throw new Error('이메일을 입력하세요.');

  try {
    const targetUser = await findUserByEmail(trimmed);
    if (!targetUser) {
      throw new Error('해당 이메일로 등록된 사용자가 없습니다.');
    }
    if (targetUser.id === currentUid) {
      throw new Error('자기 자신은 친구로 추가할 수 없습니다.');
    }

    // 이미 친구인지 확인
    const myFriendRef = doc(db, 'users', currentUid, 'friends', targetUser.id);
    const existingFriend = await getDoc(myFriendRef);
    if (existingFriend.exists()) {
      throw new Error('이미 친구로 등록된 사용자입니다.');
    }

    const now = serverTimestamp();

    // 현재 사용자의 정보 가져오기 (상대방 친구 목록에 저장하기 위해)
    const currentUserRef = doc(db, 'users', currentUid);
    const currentUserSnap = await getDoc(currentUserRef);
    const currentUserData = currentUserSnap.exists() ? currentUserSnap.data() : {};
    const targetFriendRef = doc(db, 'users', targetUser.id, 'friends', currentUid);

    // 서로에게 친구 정보 저장 (양방향)
    await Promise.all([
      setDoc(myFriendRef, {
        friendUid: targetUser.id,
        email: targetUser.email,
        displayName: targetUser.displayName || targetUser.email,
        createdAt: now,
      }, { merge: true }),
      setDoc(targetFriendRef, {
        friendUid: currentUid,
        email: currentUserData.email || null,
        displayName: currentUserData.displayName || currentUserData.email || null,
        createdAt: now,
      }, { merge: true }),
    ]);

    return {
      id: targetUser.id,
      friendUid: targetUser.id,
      email: targetUser.email,
      displayName: targetUser.displayName || targetUser.email,
    };
  } catch (error) {
    console.error('[friendService] addFriendByEmail 오류:', error);
    throw error;
  }
}

/**
 * 내 친구 목록 조회
 * @param {string} currentUid - 현재 사용자 UID
 * @returns {Promise<Array>} 친구 목록
 */
export async function getFriends(currentUid) {
  if (!currentUid) return [];
  
  try {
    const friendsCol = collection(db, 'users', currentUid, 'friends');
    const snap = await getDocs(friendsCol);
    return snap.docs.map(d => ({ 
      id: d.id, 
      friendUid: d.id,
      ...d.data() 
    }));
  } catch (error) {
    console.error('[friendService] getFriends 오류:', error);
    return [];
  }
}

/**
 * 친구 삭제 (양방향)
 * @param {string} currentUid - 현재 사용자 UID
 * @param {string} friendUid - 삭제할 친구 UID
 */
export async function removeFriend(currentUid, friendUid) {
  if (!currentUid || !friendUid) throw new Error('필수 파라미터가 없습니다.');

  try {
    const myFriendRef = doc(db, 'users', currentUid, 'friends', friendUid);
    const targetFriendRef = doc(db, 'users', friendUid, 'friends', currentUid);

    // 양방향 삭제
    await Promise.all([
      deleteDoc(myFriendRef),
      deleteDoc(targetFriendRef),
    ]);
  } catch (error) {
    console.error('[friendService] removeFriend 오류:', error);
    throw new Error('친구 삭제 중 오류가 발생했습니다.');
  }
}

/**
 * 친구 요청 보내기
 * @param {string} fromUid - 요청을 보내는 사용자 UID
 * @param {string} toUid - 요청을 받는 사용자 UID
 * @returns {Promise<boolean>}
 */
export async function sendFriendRequest(fromUid, toUid) {
  if (!fromUid || !toUid || fromUid === toUid) {
    throw new Error('유효하지 않은 UID입니다.');
  }

  try {
    // 이미 친구인지 확인
    const friendRef = doc(db, 'users', fromUid, 'friends', toUid);
    const existingFriend = await getDoc(friendRef);
    if (existingFriend.exists()) {
      throw new Error('이미 친구로 등록된 사용자입니다.');
    }

    // 이미 요청을 보냈는지 확인
    const requestId = `${fromUid}_${toUid}`;
    const requestRef = doc(db, 'friendRequests', requestId);
    const existingRequest = await getDoc(requestRef);
    
    if (existingRequest.exists()) {
      const requestData = existingRequest.data();
      if (requestData.status === 'pending') {
        throw new Error('이미 친구 요청을 보냈습니다.');
      }
    }

    // 요청 보낸 사용자 정보 가져오기
    const fromUserRef = doc(db, 'users', fromUid);
    const fromUserSnap = await getDoc(fromUserRef);
    const fromUserData = fromUserSnap.exists() ? fromUserSnap.data() : {};

    // 친구 요청 저장
    await setDoc(requestRef, {
      fromUid,
      toUid,
      fromEmail: fromUserData.email || null,
      fromDisplayName: fromUserData.displayName || fromUserData.email || null,
      status: 'pending',
      createdAt: serverTimestamp(),
    });

    return true;
  } catch (error) {
    console.error('[friendService] sendFriendRequest 오류:', error);
    throw error;
  }
}

/**
 * 친구 요청 수락
 * @param {string} fromUid - 요청을 보낸 사용자 UID
 * @param {string} toUid - 요청을 받은 사용자 UID (현재 사용자)
 * @returns {Promise<Object>} 추가된 친구 정보
 */
export async function acceptFriendRequest(fromUid, toUid) {
  if (!fromUid || !toUid) {
    throw new Error('필수 파라미터가 없습니다.');
  }

  try {
    const requestId = `${fromUid}_${toUid}`;
    const requestRef = doc(db, 'friendRequests', requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('친구 요청을 찾을 수 없습니다.');
    }

    const requestData = requestSnap.data();
    if (requestData.status !== 'pending') {
      throw new Error('이미 처리된 요청입니다.');
    }

    // 요청 상태를 accepted로 변경
    await setDoc(requestRef, {
      status: 'accepted',
      acceptedAt: serverTimestamp(),
    }, { merge: true });

    // 양방향 친구 관계 생성
    const now = serverTimestamp();

    // 요청 보낸 사용자 정보
    const fromUserRef = doc(db, 'users', fromUid);
    const fromUserSnap = await getDoc(fromUserRef);
    const fromUserData = fromUserSnap.exists() ? fromUserSnap.data() : {};

    // 요청 받은 사용자 정보
    const toUserRef = doc(db, 'users', toUid);
    const toUserSnap = await getDoc(toUserRef);
    const toUserData = toUserSnap.exists() ? toUserSnap.data() : {};

    const fromFriendRef = doc(db, 'users', fromUid, 'friends', toUid);
    const toFriendRef = doc(db, 'users', toUid, 'friends', fromUid);

    await Promise.all([
      setDoc(fromFriendRef, {
        friendUid: toUid,
        email: toUserData.email || null,
        displayName: toUserData.displayName || toUserData.email || null,
        createdAt: now,
      }, { merge: true }),
      setDoc(toFriendRef, {
        friendUid: fromUid,
        email: fromUserData.email || null,
        displayName: fromUserData.displayName || fromUserData.email || null,
        createdAt: now,
      }, { merge: true }),
    ]);

    return {
      id: fromUid,
      friendUid: fromUid,
      email: fromUserData.email,
      displayName: fromUserData.displayName || fromUserData.email,
    };
  } catch (error) {
    console.error('[friendService] acceptFriendRequest 오류:', error);
    throw error;
  }
}

/**
 * 받은 친구 요청 목록 조회
 * @param {string} currentUid - 현재 사용자 UID
 * @returns {Promise<Array>} 받은 친구 요청 목록
 */
export async function getIncomingRequests(currentUid) {
  if (!currentUid) return [];

  try {
    const q = query(
      collection(db, 'friendRequests'),
      where('toUid', '==', currentUid),
      where('status', '==', 'pending')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
  } catch (error) {
    console.error('[friendService] getIncomingRequests 오류:', error);
    return [];
  }
}

