// src/hooks/useLifestyleManagement.js
import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import firestoreService from '../services/firestoreService';

export function useLifestyleManagement() {
  const { user } = useAuth();
  const [lifestyleList, setLifestyleList] = useState([]);
  const [lifestyleInput, setLifestyleInput] = useState("");
  const [isClearing, setIsClearing] = useState(false);

  // 사용자 데이터 로드 (초기 로딩만)
  useEffect(() => {
    const loadLifestylePatterns = async () => {
      if (!user?.uid) return;
      
      try {
        const userData = await firestoreService.getUserDataForAI(user.uid, user);
        if (userData?.lifestylePatterns && userData.lifestylePatterns.length > 0) {
          // DB에 데이터가 있고, 현재 UI가 비어있을 때만 로드
          if (lifestyleList.length === 0) {
            setLifestyleList(userData.lifestylePatterns);
          }
        } else {
          // DB에 데이터가 없으면 UI도 비우기
          if (lifestyleList.length > 0) {
            setLifestyleList([]);
          }
        }
      } catch (error) {
        console.error('생활패턴 로드 실패:', error);
      }
    };

    loadLifestylePatterns();
  }, [user?.uid]); // lifestyleList.length 제거하여 무한 루프 방지

  // 생활패턴 추가 (UI에만 표시, DB 저장 안함)
  const handleAddLifestyle = useCallback(() => {
    console.log('handleAddLifestyle 호출됨, 입력:', lifestyleInput);
    if (!lifestyleInput.trim()) {
      console.log('입력이 비어있음');
      return;
    }
    
    const newPatterns = lifestyleInput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const allPatterns = [...lifestyleList, ...newPatterns];
    const uniquePatterns = Array.from(new Set(allPatterns.map(s => {
      if (typeof s === 'string') {
        return s.trim();
      }
      return '';
    }).filter(Boolean)));
    
    
    // 실제로 변경된 것이 있는지 확인
    if (uniquePatterns.length === lifestyleList.length) {
      console.log('변경사항 없음, 입력만 초기화');
      setLifestyleInput("");
      return;
    }
    
    // 즉시 UI 업데이트만 (DB 저장 안함)
    setLifestyleList(uniquePatterns);
    setLifestyleInput("");
  }, [lifestyleInput, lifestyleList]);

  // 생활패턴 삭제 (UI와 DB에서 모두 삭제)
  const handleDeleteLifestyle = useCallback(async (index) => {
    console.log('handleDeleteLifestyle 호출됨, 인덱스:', index);
    if (!user?.uid) return;
    
    const patternToDelete = lifestyleList[index];
    if (!patternToDelete) return;
    
    try {
      // DB에서 삭제
      await firestoreService.deleteLifestylePattern(user.uid, patternToDelete);
      
      // UI에서 제거
      const updatedPatterns = lifestyleList.filter((_, i) => i !== index);
      setLifestyleList(updatedPatterns);
    } catch (error) {
      console.error('생활패턴 삭제 실패:', error);
      alert('생활패턴 삭제에 실패했습니다: ' + error.message);
    }
  }, [lifestyleList, user?.uid]);

  // 모든 생활패턴 삭제 (DB에서 완전히 삭제, 그 다음 UI 업데이트)
  const handleClearAllLifestyles = useCallback(async () => {
    console.log('handleClearAllLifestyles 호출됨');
    if (!user?.uid) {
      console.log('user.uid가 없음');
      return;
    }
    
    console.log('확인 대화상자 표시');
    if (window.confirm("모든 생활 패턴을 삭제하시겠습니까?")) {
      console.log('사용자가 확인함');
      
      setIsClearing(true); // 로딩 시작
      
      try {
        // DB에서 완전히 삭제
        await firestoreService.deleteAllLifestylePatterns(user.uid);
        setLifestyleList([]);
        
      } catch (error) {
        alert('생활패턴 전체 삭제에 실패했습니다: ' + error.message);
      } finally {
        setIsClearing(false); 
      }
    } else {
      console.log('사용자가 취소함');
    }
  }, [user?.uid]);

  // 생활패턴 저장 + 스케줄 생성
  const handleSaveAndGenerateSchedule = useCallback(async (onSuccess) => {
    if (!user?.uid) {
      console.log('user.uid가 없음');
      return;
    }
    
    if (lifestyleList.length === 0) {
      alert('저장할 생활패턴이 없습니다.');
      return;
    }
    
    try {
      await firestoreService.saveLifestylePatterns(user.uid, lifestyleList);
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('생활패턴 저장 실패:', error);
      alert('생활패턴 저장에 실패했습니다: ' + error.message);
    }
  }, [lifestyleList, user?.uid]);

  return {
    lifestyleList,
    setLifestyleList,
    lifestyleInput,
    setLifestyleInput,
    isClearing,
    handleAddLifestyle,
    handleDeleteLifestyle,
    handleClearAllLifestyles,
    handleSaveAndGenerateSchedule
  };
}
