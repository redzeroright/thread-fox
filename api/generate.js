export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });
  const { topic } = req.body;
  const GEMINI_KEY = process.env.GEMINI_KEY;
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`;

  const makePrompt = (style) => `주제 "${topic}"로 ${style} 스타일 스레드 1개, 150자, 이모지 1개. 주제 외 잡담 금지. 반복 금지. 본문만.`;

  try {
    // 3개를 따로 생성해야 절대 안 겹친다 - 이게 핵심
    const styles = ["공감 실패담", "실용 꿀팁", "반전 인사이트"];
    const posts = [];
    for (let i=0; i<3; i++) {
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts:[{text: makePrompt(styles[i])}]}], generationConfig:{temperature:0.85, maxOutputTokens:400}}) });
      const d = await r.json();
      let t = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      t = t.replace(/TEMPLATE|Q:|A:|#\d/g,'').trim().slice(0,280);
      posts.push({ template: styles[i], text: t });
    }
    return res.status(200).json({ posts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
