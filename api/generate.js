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

  const systemPrompt = `주제: "${topic}" / 목적: ${purpose} / 훅: ${hook}
너는 Threads 바이럴 작가. JSON만 출력.
규칙: "TEMPLATE,T1,T2,T3" 단어 절대 금지. 3개 글은 서로 다른 스토리. 같은 문장 반복 금지. 각 160자 내외, 이모지 1개.
출력: {"posts": [{"template":"공감","text":"..."},{"template":"정보","text":"..."},{"template":"반전","text":"..."}]}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.75, topP: 0.9, maxOutputTokens: 900 }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json|```/g,'').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON');
    return res.status(200).json(JSON.parse(m[0]));
  } catch (e) {
    return res.status(500).json({ error: e.name === 'AbortError'? 'Gemini timeout 15s - 모델 과부하, lite로 재시도' : e.message });
  }
}
