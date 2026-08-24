export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  const { topic, purpose, hook } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  const GEMINI_KEY = process.env.GEMINI_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_KEY not set in Vercel env' });

  // Purpose x Hook Matrix System Prompt - 20년차 프롬프트 엔지니어링
  const systemPrompt = `
당신은 Threads 바이럴 글쓰기 전문가 Thread Fox입니다. 주제: ${topic}, 목적: ${purpose}, 훅 스타일: ${hook}

목적 정의 (반드시 지키세요):
- 정보제공: 숫자, 데이터, 계산, 리스트, 저장 유도
- 공감/소통: 혼자 아니야, 나도 그랬어, 댓글 유도, 위로
- 팔로워증가: 다음 편 예고, 팔로우 유도, 시리즈
- 브랜딩: 내 일관된 기록, 시행착오, 프로필 유도
- 논쟁유발: 90%가 틀림, 반박 환영, 도발
- 위로: 잘하고 있어, 괜찮아, 천천히

훅 스타일 정의 (첫 문장이어야 함):
- 의문형 훅: 혹시 ~해본 적 있어? 로 시작
- 숫자 훅: 3가지로 요약, 숫자 리스트로 시작
- 반전 훅: 다들 좋다는데 나는 반대였어 로 시작
- 공감 훅: 이거 나만 그래? 로 시작
- 도발 훅: 솔직히 90%가 잘못 알고 있어 로 시작
- 스토리 훅: 어제 새벽 2시, ~때문에 로 시작

규칙:
1. 3개 글은 첫 문장부터 완전히 다르게
2. 주제 단어를 5번 이상 반복하지 마, 대명사 써
3. 실제 한국 생활 숫자 넣어 (예: 월세 55만원, FSD 904만원 등)
4. 각 글 120~220자, Gen-Z 말투, 이모지 1~2개
5. JSON으로만 출력

출력 형식 (JSON만, 다른 말 금지):
{"posts": [{"template":"T1","text":"..."},{"template":"T2","text":"..."},{"template":"T3","text":"..."}]}
`;

  try {
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + `\n\n주제: ${topic}\n목적: ${purpose}\n훅: ${hook}\n3개 생성해.` }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 2000 }
      })
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // JSON 파싱 (Gemini가 ```json으로 감싸는 경우 처리)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Gemini returned no JSON: ' + text.slice(0,200));
    
    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
