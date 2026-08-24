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
주제: "${topic}"
너는 Threads 바이럴 작가. 아래 JSON만 출력.

규칙: TEMPLATE,Q:,A: 절대 금지. 3개 글은 서로 다른 문장/다른 숫자 써야 함. 같은 문장 반복하면 실패.
각각 160자, 첫줄 15자 훅, 이모지 1개.
스타일: 1=공감 실패담, 2=정보 꿀팁, 3=반전 인사이트

출력:
{"posts": [{"template":"공감","text":"..."}, {"template":"정보","text":"..."}, {"template":"반전","text":"..."}]}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-3.6-flash:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.7, topP: 0.85, maxOutputTokens: 2000 }
      })
    });
    const data = await r.json();
    if(data.error) throw new Error(data.error.message);
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json|```/g,'').trim();
    const m = text.match(/\{[\s\S]*\}/);
    return res.status(200).json(JSON.parse(m[0]));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
