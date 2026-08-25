export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });
  const { topic, purpose, hook } = req.body;
  const GEMINI_KEY = process.env.GEMINI_KEY;

  const prompt = `주제 "${topic}"로 스레드 3개. JSON만. 반복 금지. 각 160자.
  {"posts": [{"template":"공감","text":"..."},{"template":"정보","text":"..."},{"template":"반전","text":"..."}]}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.7, maxOutputTokens:800}}) });
    const data = await r.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json|```/g,'').trim();
    const j = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);

    // 강제 후처리: TEMPLATE, Q/A, V3/V4 반복 강제 제거
    j.posts = j.posts.map(p => ({
      template: p.template.replace(/TEMPLATE.*|T\d/g,'').trim(),
      text: p.text.replace(/Q:.*|A:.*|TEMPLATE.*/g,'').replace(/V3까지 2개월, V4 벽에 4주.*/g,'').slice(0,300).trim()
    }));
    return res.status(200).json(j);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
