// =============================================================================
// Thread-Fox  ·  /api/generate  (FIXED - 판매용 버전)
// -----------------------------------------------------------------------------
// [고친 것]
// 1. 존재하는 모델로 변경: gemini-2.0-flash (저렴 + 빠름, 무제한 9,900원도 마진 95%)
// 2. 3개를 한 번에 -> 3번 따로 호출 (중복 버그 완전 해결)
// 3. TEMPLATE 라벨 제거 -> "공감형", "반전형" 같은 짧은 라벨만
// 4. 마지막은 무조건 질문형 + 숫자 1개 이상 포함 (저장/댓글 유도)
// =============================================================================

const CONFIG = {
  model:        process.env.GEMINI_MODEL        || 'gemini-2.0-flash',
  apiVersion:   process.env.GEMINI_API_VERSION  || 'v1beta',
  apiKey:       process.env.GEMINI_KEY          || process.env.GEMINI_API_KEY || '',
  postsPerReq:  3,
  timeoutMs:    20000,
  maxRetries:   2,
  maxTopicLen:  200,
  rateLimitMax: 20,
  rateWindowMs: 60_000,
};

const PURPOSE_GUIDE = {
  '공감/소통':   '독자가 "내 얘기다" 하고 느껴 댓글·공감을 남기게 만드는 것. 마지막은 반드시 질문형.',
  '정보제공':    '핵심 정보를 짧고 명확하게 정리해 저장·공유하고 싶게 만드는 것. 숫자를 1개 이상 포함.',
  '팔로워증가':  '다음 편이 궁금해서 팔로우를 누르게 만드는 것. 궁금증을 남기고 질문으로 끝내기.',
  '브랜딩':      '작성자의 관점·전문성·태도가 드러나 신뢰가 쌓이게. 본인 경험을 숫자와 함께.',
  '논쟁유발':    '댓글이 폭발하게 만드는 것. 단정적 주장 + 마지막에 "너는 어떻게 생각해?" 같은 논쟁 유도 질문.',
  '위트':        '웃기게 만드는 것. 반전 유머 1개 포함.',
};

const HOOK_GUIDE = {
  '의문형 훅':  '독자에게 질문을 던지며 시작 (예: "혹시 ~해본 적 있어?")',
  '숫자 훅':    '숫자로 정리 예고하며 시작 (예: "~하는 3가지 방법")',
  '반전 훅':    '통념을 뒤집으며 시작 (예: "다들 ~라는데, 사실은 반대였어")',
  '공감 훅':    '공감대를 건드리며 시작 (예: "이거 나만 그런 거 아니지?")',
  '도발 훅':    '단정적·도발적으로 시작 (예: "솔직히 90%는 이거 잘못 알고 있어")',
  '스토리 훅':  '구체적 장면·경험담으로 시작 (예: "어제 새벽 2시에 있었던 일인데")',
};

const ANGLES = [
  '각도1: 어제 겪은 실제 에피소드 1개를 구체적으로 (시간, 장소, 숫자 포함) 이야기하며 시작해.',
  '각도2: 모두가 오해하는 통념 1개를 깨고, 네가 발견한 반대 진실로 시작해.',
  '각도3: 독자의 고통을 공감하며 시작하고, 너만 아는 꿀팁 1개를 마지막에 공개해.',
];

const DEFAULT_PURPOSE = '공감/소통';
const DEFAULT_HOOK    = '공감 훅';

const RESPONSE_SCHEMA_SINGLE = {
  type: 'OBJECT',
  properties: {
    posts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          template: { type: 'STRING', description: '짧은 한글 라벨 2~4글자 (예: 공감형, 반전형, 정보형). TEMPLATE라는 단어 절대 금지.' },
          text:     { type: 'STRING', description: '완성된 스레드 글 본문 120~200자' },
        },
        required: ['template', 'text'],
        propertyOrdering: ['template', 'text'],
      },
    },
  },
  required: ['posts'],
  propertyOrdering: ['posts'],
};

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  if (!CONFIG.apiKey) return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });
  if (isRateLimited(getClientIp(req))) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });

  let input;
  try { input = parseInput(req.body); } 
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    const posts = await generatePostsParallel(input);
    if (!posts.length) throw new Error('EMPTY_RESULT');
    return res.status(200).json({ posts });
  } catch (e) {
    console.error('[generate] 생성 실패:', e?.message || e);
    return res.status(502).json({ error: '글 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}

function parseInput(body) {
  const b = typeof body === 'string' ? safeJson(body) : (body || {});
  const topic = String(b.topic ?? '').trim();
  if (!topic) throw new Error('주제(topic)를 입력해 주세요.');
  if (topic.length > CONFIG.maxTopicLen) throw new Error(`주제는 ${CONFIG.maxTopicLen}자 이내로 입력해 주세요.`);
  const purpose = PURPOSE_GUIDE[b.purpose] ? b.purpose : DEFAULT_PURPOSE;
  const hook    = HOOK_GUIDE[b.hook]       ? b.hook    : DEFAULT_HOOK;
  // purpose/hook 키값 그대로 유지 (한글 키)
  return { topic, purpose: b.purpose || DEFAULT_PURPOSE, hook: b.hook || DEFAULT_HOOK };
}

// 3개를 병렬로 따로 호출 -> 중복 0%
async function generatePostsParallel(input) {
  const promises = ANGLES.slice(0, CONFIG.postsPerReq).map((angle, idx) => 
    generateSinglePost(input, angle, idx)
  );
  const results = await Promise.all(promises);
  return results.flat().slice(0, CONFIG.postsPerReq);
}

async function generateSinglePost(input, angle, idx) {
  const url = `https://generativelanguage.googleapis.com/${CONFIG.apiVersion}/models/${CONFIG.model}:generateContent`;

  const prompt = [
    '너는 한국어 소셜미디어 "스레드(Threads)" 전문 카피라이터야. 20대 여성 말투, 반말 구어체.',
    `주제: "${input.topic}"`,
    `목적: ${input.purpose} - ${PURPOSE_GUIDE[input.purpose] || ''}`,
    `훅 스타일: ${input.hook} - ${HOOK_GUIDE[input.hook] || ''}`,
    `이번 글의 특별 각도: ${angle}`,
    '',
    '작성 규칙 (반드시 지켜):',
    '1) 딱 1개의 글만 만들어. (posts 배열에 1개만)',
    '2) 120~200자, 줄바꿈 1~2회, 이모지 1개만.',
    '3) 본문에 구체적인 숫자(시간, 돈, 조회수, 일수 등)를 1개 이상 꼭 포함해.',
    '4) 마지막 문장은 반드시 질문형으로 끝나서 댓글을 유도해. 예: "너는 어때?", "이거 공감돼?"',
    '5) 해시태그, 따옴표 제목, [정보] 같은 머리말 절대 금지.',
    '6) template 필드는 2~4글자 한글 라벨만. 예: 공감형, 도발형, 경험담. 절대 TEMPLATE, T1, #1 같은 영어/기호 쓰지 마.',
    '7) 다른 글과 겹치지 않게, 이 각도에만 집중해서 써.',
    '',
    'JSON으로만 응답.',
  ].join('\n');

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA_SINGLE,
    maxOutputTokens: 800,
    temperature: 1.1,
    topP: 0.95,
    topK: 64,
  };

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  };

  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.apiKey },
    body: JSON.stringify(payload),
  });

  return extractPosts(data);
}

async function fetchWithRetry(url, options) {
  let lastErr;
  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) lastErr = new Error(`HTTP ${r.status}`);
      else {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${r.status}`);
      }
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') lastErr = new Error('TIMEOUT');
      else if (!lastErr) lastErr = e;
      if (e.message && /HTTP 4\d\d/.test(e.message)) throw e;
    }
    if (attempt < CONFIG.maxRetries) await sleep(400 * Math.pow(2, attempt));
  }
  throw lastErr || new Error('UNKNOWN_FETCH_ERROR');
}

function extractPosts(data) {
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) return [];
  const parsed = safeJson(raw) ?? safeJson(stripFence(raw));
  const list = Array.isArray(parsed?.posts) ? parsed.posts : [];
  return list.map((p, i) => ({
    template: String(p?.template ?? `스타일${i+1}`).replace(/TEMPLATE/gi,'').replace(/T\d+/gi,'').trim().slice(0,10) || '공감형',
    text: String(p?.text ?? '').trim(),
  })).filter(p => p.text.length > 0);
}

function applyCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.length === 0) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary','Origin'); }
  else res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const rateStore = new Map();
function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const windowStart = now - CONFIG.rateWindowMs;
  const hits = (rateStore.get(ip) || []).filter(t=>t>windowStart);
  hits.push(now); rateStore.set(ip,hits);
  if (rateStore.size>5000) for(const [k,v] of rateStore) if(!v.some(t=>t>windowStart)) rateStore.delete(k);
  return hits.length > CONFIG.rateLimitMax;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff==='string'&&xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress||'';
}
function stripFence(s){return s.replace(/```json/gi,'').replace(/```/g,'').trim();}
function safeJson(s){try{return JSON.parse(s);}catch{return null;}}
function clampInt(val,def,min,max){const n=parseInt(val,10); if(Number.isNaN(n))return def; return Math.min(max,Math.max(min,n));}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
