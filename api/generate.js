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

  const prompt = `너는 Threads 바이럴 전문가다. 주제:${topic} 목적:${purpose} 훅:${hook}
조건: 서로 다른 3개, 각 150자 내외, 숫자1개, 이모지1개, Gen-Z말투, 설명금지
JSON으로만 출력: {"posts": [{"template":"공감","text":"글1"},{"template":"정보","text":"글2"},{"template":"반전","text":"글3"}]}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 2000 }
      })
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log("GEMINI RAW:", text.slice(0,500)); // Vercel 로그에 남음

    text = text.replace(/```json|```/g,'').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: 'NO_JSON', raw: text.slice(0,500) });

    const parsed = JSON.parse(m[0]);
    return res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
