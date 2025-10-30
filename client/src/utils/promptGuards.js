// Guard to detect schedule prompts/specs so they are never mis-saved as tasks

export function looksLikeSystemPrompt(text) {
  if (!text) return false;
  const s = String(text);
  if (s.length > 600) return true; // overly long → spec/prompt most likely
  const jsonHints = /```json|"\s*schedule"\s*:|\{\s*"schedule"\s*:/i.test(s);
  const specWords = /(출력 형식|반드시|JSON 형식|activities|type"\s*:\s*"(task|lifestyle)|day:\s*\d|weekday|notes)/i.test(s);
  const sections = /(\[생활 패턴\]|\[할 일 목록\]|\[반드시 지켜야 할 규칙\])/i.test(s);
  return jsonHints || specWords || sections;
}


