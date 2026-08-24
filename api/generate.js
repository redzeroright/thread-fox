export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  const { topic, purpose, hook } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  const GEMINI_KEY = process.env.GEMINI_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_KEY not set in Vercel env' });

  // Purpose x Hook Matrix System Prompt - 20년차 프롬프트 엔지니어링
 const systemPrompt = `
주제: ${topic}, 목적: ${purpose}, 훅: ${hook}

너는 Threads 10만 팔로워를 만든 카피라이터다. 
목적: ${purpose} = 정보제공은 저장, 공감은 댓글, 브랜딩은 팔로우 유도
훅: ${hook} 스타일로 첫 문장 시작

조건:
- 각 글 3개는 서로 다른 훅으로 시작, 150자 내외
- 주제(${topic})에 대한 찐 한국인 경험담처럼 써. 숫자 1개 포함.
- 이모지 1개만
- 설명하지 마. 바로 글만 써.

JSON만 출력:
{"posts": [{"template":"공감","text":"글1"},{"template":"정보","text":"글2"},{"template":"반전","text":"글3"}]}
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
