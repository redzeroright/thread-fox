export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { topic } = req.body;
  const KEY = process.env.GEMINI_KEY;
  if(!KEY) return res.status(500).json({error: 'KEY 없음'});

  const prompt = `주제 "${topic}"로 Threads 글 3개. 각각 다른 스타일(공감/정보/반전), 160자, 이모지 1개. JSON만: {"posts":[{"template":"공감","text":"..."},{"template":"정보","text":"..."},{"template":"반전","text":"..."}]}`;

  try {
    // 가장 빠르고 확실한 모델
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${KEY}`;
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.8, maxOutputTokens:1200}}) });
    const data = await r.json();
    if(data.error) throw new Error(data.error.message);
    let t = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    t = t.replace(/```json|```/g,'').trim();
    const json = JSON.parse(t.match(/\{[\s\S]*\}/)[0]);
    return res.status(200).json(json);
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
}
