import { useState, useCallback } from 'react';
import apiService from '../services/apiService';

export const useVoiceRecording = () => {
  const [isRecording, setIsRecording] = useState(false);

  // Whisper API로 음성 처리
  const processAudioWithWhisper = useCallback(async (audioBlob) => {
    try {
      const result = await apiService.transcribeAudio(audioBlob);
      console.log('Whisper 음성 인식 결과:', result.text);
      return result.text;
    } catch (error) {
      console.error('Whisper 음성 인식 실패:', error);
      alert('음성 인식에 실패했습니다. 다시 시도해주세요.');
      throw error;
    }
  }, []);

  // 음성 녹음 시작
  const startVoiceRecording = useCallback(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('이 브라우저는 음성 녹음을 지원하지 않습니다.');
      return Promise.reject(new Error('음성 녹음을 지원하지 않는 브라우저입니다.'));
    }

    return new Promise((resolve, reject) => {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          setIsRecording(true);
          
          const mediaRecorder = new MediaRecorder(stream);
          const audioChunks = [];
          
          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };
          
          mediaRecorder.onstop = async () => {
            try {
              const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
              const text = await processAudioWithWhisper(audioBlob);
              stream.getTracks().forEach(track => track.stop());
              setIsRecording(false);
              resolve(text);
            } catch (error) {
              setIsRecording(false);
              reject(error);
            }
          };
          
          mediaRecorder.start();
          setTimeout(() => {
            mediaRecorder.stop();
          }, 5000);
        })
        .catch(error => {
          console.error('마이크 접근 오류:', error);
          alert('마이크 접근 권한이 필요합니다.');
          setIsRecording(false);
          reject(error);
        });
    });
  }, [processAudioWithWhisper]);

  return {
    isRecording,
    startVoiceRecording,
    processAudioWithWhisper
  };
};
