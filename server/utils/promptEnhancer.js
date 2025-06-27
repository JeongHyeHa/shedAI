// 사용자 데이터를 바탕으로 AI 프롬프트 강화 유틸리티

class PromptEnhancer {
    constructor() {
        this.preferenceTypeMapping = {
            'time_preference': '시간대 선호도',
            'activity_preference': '활동 선호도', 
            'workload_preference': '작업량 선호도'
        };
    }

    // 사용자 선호도를 프롬프트에 통합
    enhancePromptWithPreferences(basePrompt, userData) {
        if (!userData.preferences || userData.preferences.length === 0) {
            return basePrompt;
        }

        const preferenceSection = this.buildPreferenceSection(userData.preferences);
        const feedbackSection = this.buildFeedbackSection(userData.recentFeedbacks);
        const adviceSection = this.buildAdviceSection(userData.aiAdvice);

        return `${basePrompt}

[사용자 개인화 정보]
${preferenceSection}
${feedbackSection}
${adviceSection}

[개인화 지침]
- 위의 사용자 선호도와 피드백을 반드시 고려하여 스케줄을 설계하세요.
- 사용자가 선호하지 않는 시간대나 활동은 가능한 피하세요.
- 과거 피드백에서 지적된 문제점들을 해결하세요.
- AI 조언을 참고하여 사용자의 건강과 생산성을 고려하세요.`;
    }

    // 선호도 섹션 구성
    buildPreferenceSection(preferences) {
        if (!preferences || preferences.length === 0) return '';

        const groupedPreferences = this.groupPreferencesByType(preferences);
        let section = '📊 사용자 선호도 분석:\n';

        Object.entries(groupedPreferences).forEach(([type, prefs]) => {
            const typeName = this.preferenceTypeMapping[type] || type;
            section += `\n${typeName}:\n`;
            
            prefs.forEach(pref => {
                const confidence = Math.round(pref.confidence_score * 100);
                section += `- ${pref.preference_key}: ${pref.preference_value} (신뢰도: ${confidence}%)\n`;
            });
        });

        return section;
    }

    // 피드백 섹션 구성
    buildFeedbackSection(feedbacks) {
        if (!feedbacks || feedbacks.length === 0) return '';

        let section = '\n📝 최근 피드백 요약:\n';
        
        feedbacks.slice(0, 3).forEach(feedback => {
            const type = this.getFeedbackTypeEmoji(feedback.feedback_type);
            const date = new Date(feedback.created_at).toLocaleDateString('ko-KR');
            section += `${type} ${date}: ${feedback.feedback_text}\n`;
        });

        return section;
    }

    // AI 조언 섹션 구성
    buildAdviceSection(advice) {
        if (!advice || advice.length === 0) return '';

        let section = '\n💡 AI 조언:\n';
        
        advice.slice(0, 2).forEach(item => {
            section += `- ${item.advice_title}: ${item.advice_content}\n`;
        });

        return section;
    }

    // 선호도를 타입별로 그룹화
    groupPreferencesByType(preferences) {
        const grouped = {};
        
        preferences.forEach(pref => {
            if (!grouped[pref.preference_type]) {
                grouped[pref.preference_type] = [];
            }
            grouped[pref.preference_type].push(pref);
        });

        return grouped;
    }

    // 피드백 타입에 따른 이모지 반환
    getFeedbackTypeEmoji(type) {
        const emojis = {
            'positive': '✅',
            'negative': '❌',
            'suggestion': '💡',
            'complaint': '⚠️',
            'neutral': '📝'
        };
        return emojis[type] || '📝';
    }

    // 특정 활동에 대한 선호도 추출
    getActivityPreferences(preferences, activityType) {
        return preferences.filter(pref => 
            pref.preference_type === 'activity_preference' && 
            pref.preference_key === activityType
        );
    }

    // 시간대 선호도 추출
    getTimePreferences(preferences) {
        return preferences.filter(pref => 
            pref.preference_type === 'time_preference'
        );
    }

    // 작업량 선호도 추출
    getWorkloadPreferences(preferences) {
        return preferences.filter(pref => 
            pref.preference_type === 'workload_preference'
        );
    }

    // 사용자 패턴 기반 맞춤 지침 생성
    generateCustomGuidelines(userData) {
        const guidelines = [];

        // 시간대 선호도 기반 지침
        const timePrefs = this.getTimePreferences(userData.preferences);
        timePrefs.forEach(pref => {
            if (pref.preference_key === 'morning_work' && pref.preference_value === 'prefer') {
                guidelines.push('중요한 작업은 아침 시간대에 우선 배치하세요.');
            }
            if (pref.preference_key === 'evening_work' && pref.preference_value === 'prefer') {
                guidelines.push('야간 작업을 선호하므로 저녁 시간대에 집중 작업을 배치하세요.');
            }
            if (pref.preference_key === 'weekend_work' && pref.preference_value === 'prefer') {
                guidelines.push('주말 작업을 선호하므로 주말을 적극 활용하세요.');
            }
        });

        // 작업량 선호도 기반 지침
        const workloadPrefs = this.getWorkloadPreferences(userData.preferences);
        workloadPrefs.forEach(pref => {
            if (pref.preference_key === 'workload' && pref.preference_value === 'reduce') {
                guidelines.push('과부하를 피하기 위해 하루에 충분한 휴식 시간을 확보하세요.');
            }
        });

        // 최근 피드백 기반 지침
        if (userData.recentFeedbacks && userData.recentFeedbacks.length > 0) {
            const negativeFeedbacks = userData.recentFeedbacks.filter(
                f => f.feedback_type === 'negative' || f.feedback_type === 'complaint'
            );
            
            if (negativeFeedbacks.length > 0) {
                guidelines.push('최근 부정적 피드백을 고려하여 일정을 조정하세요.');
            }
        }

        return guidelines;
    }

    // 프롬프트에 맞춤 지침 추가
    addCustomGuidelinesToPrompt(basePrompt, userData) {
        const guidelines = this.generateCustomGuidelines(userData);
        
        if (guidelines.length === 0) {
            return basePrompt;
        }

        const guidelinesSection = '\n[맞춤 지침]\n' + guidelines.map(g => `- ${g}`).join('\n');
        
        return basePrompt + guidelinesSection;
    }
}

module.exports = new PromptEnhancer(); 