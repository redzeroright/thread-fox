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
너는 Threads 바이럴 전문가다. 주제: ${topic}, 목적: ${purpose}, 훅: ${hook}

규칙:
- 서로 다른 스타일 3개, 각각 140-180자
- 주제 "${topic}"를 찐 경험담처럼, 숫자 1개, 이모지 1개
- 설명 금지, 포맷 금지, Q/A 금지
- 그냥 글 본문만

반드시 이 JSON만 출력해:
{"posts": [{"template":"공감","text":"..."}, {"template":"정보","text":"..."}, {"template":"반전","text":"..."}]}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.95, maxOutputTokens: 2000, responseMimeType: "application/json" }
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
