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
너는 한국 Threads 바이럴 작가다. 주제: "${topic}", 목적: ${purpose}, 훅: ${hook}

[절대 규칙 - 어기면 실패]
- 절대 "TEMPLATE", "T1", "T3", "T5", "Q:", "A:" 쓰지 마.
- 3개 글은 서로 다른 이야기, 다른 숫자, 다른 표현을 써. 같은 문장 반복 금지.
- 각 글은 2~3문단, 첫 문장은 15자 이내로 짧고 강하게.
- 각 글 150~180자, 이모지 1개, 구체적 숫자 1개 포함.
- 말투: 친구에게 카톡하듯.

[출력 - JSON만]
{"posts": [{"template":"공감 스토리","text":"..."}, {"template":"꿀팁 정보","text":"..."}, {"template":"반전 인사이트","text":"..."}]}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-3.6-flash:generateContent?key=${GEMINI_KEY}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.75, topP: 0.9, maxOutputTokens: 2000 }
      })
    });

    const data = await geminiRes.json();
    if(data.error) return res.status(500).json({ error: `Gemini API 에러: ${data.error.message}` });
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json/g,'').replace(/```/g,'').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 없음: ' + text.slice(0,300));
    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
