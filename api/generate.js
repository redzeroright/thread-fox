export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  const { topic, purpose, hook } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  const GEMINI_KEY = process.env.GEMINI_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_KEY not set' });

  const systemPrompt = `
너는 한국 Threads 팔로워 10만 바이럴 작가다.
주제: "${topic}"
목적: ${purpose || '공감/소통'}
훅 스타일: ${hook || '스토리 훅'}

[필수 규칙]
1. 서로 완전히 다른 3개 글을 써. 같은 문장, 같은 숫자(V3,V4 등) 반복 절대 금지.
2. 각 글은 150-200자, 첫 문장은 21자 이내 강렬한 훅, 숫자 1개, 이모지 1개만.
3. Q:, A:, TEMPLATE, 설명, 해설 절대 금지. 그냥 스레드 본문만.
4. ${purpose} 목적에 맞게, ${hook} 스타일로 써.
5. 말투는 친구에게 말하듯 짧고 찐 경험담처럼.

[출력 형식 - 이 JSON만 출력]
{"posts": [{"template":"공감형","text":"..."}, {"template":"정보형","text":"..."}, {"template":"반전형","text":"..."}]}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-3.6-flash:generateContent?key=${GEMINI_KEY}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 2000, responseMimeType: "application/json" }
      })
    });

    const data = await geminiRes.json();
    if(data.error){
      return res.status(500).json({ error: `Gemini API 에러: ${data.error.message}` });
    }
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if(!text) return res.status(500).json({ error: 'Gemini empty response', raw: JSON.stringify(data).slice(0,500) });

    text = text.replace(/```json/g,'').replace(/```/g,'').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Gemini returned no JSON: ' + text.slice(0,300));

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
