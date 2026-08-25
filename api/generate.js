export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { topic } = req.body;
  const KEY = process.env.GEMINI_KEY;
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${KEY}`;
  const styles = ["공감 실패담","실용 꿀팁","반전 인사이트"];
  try {
    const posts = [];
    for (let s of styles) {
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts:[{text: `주제 "${topic}"로 ${s} 스레드 글 1개, 170자, 이모지 1개, 본문만.`}]}], generationConfig:{temperature:0.9, maxOutputTokens:500}}) });
      const d = await r.json();
      let t = d.candidates?.[0]?.content?.parts?.[0]?.text || '생성 실패 재시도';
      posts.push({ template: s, text: t.trim() });
    }
    return res.status(200).json({ posts });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
