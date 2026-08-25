// =============================================================================
// Thread-Fox  ·  /api/generate  (Vercel Serverless Function, zero-dependency)
// REV: v5  (모델: gemini-3.7-flash · 프롬프트 품질 강화판)
// -----------------------------------------------------------------------------
// 스레드(Threads) 글 자동 생성 API.
// 프론트엔드가 { topic, purpose, hook } 를 POST 하면, 지정된 목적/훅에 맞춘
// 서로 다른 스레드 글 여러 개를 JSON 으로 반환한다.
//
// [배포 위치]  이 파일은 반드시  api/generate.js  경로에 있어야
//             프론트엔드의 fetch("/api/generate") 와 매칭된다.
//             (루트에 두려면 vercel.json 에 rewrite 필요)
//
// [필수 환경변수]
//   GEMINI_KEY            Gemini API 키  (기존 이름 유지. GEMINI_API_KEY 도 인식)
//
// [선택 환경변수 — 코드 수정 없이 튜닝/업그레이드 가능]
//   GEMINI_MODEL         사용할 모델      (기본: gemini-3.5-flash-lite)
//                        └ 더 똑똑하게: gemini-3.7-flash / gemini-3.6-flash 등으로 교체만
//   GEMINI_API_VERSION   API 버전         (기본: v1beta)
//   GEMINI_TEMPERATURE   샘플링 온도      (미설정 시 전송 안 함 — 신형 모델 호환)
//   ALLOWED_ORIGINS      허용 도메인      (쉼표구분. 미설정 시 '*' — 운영에선 반드시 지정)
//   POSTS_PER_REQUEST    생성 글 개수     (기본: 3)
//   RATE_LIMIT_MAX       분당 요청 상한   (기본: 20, IP 기준·best-effort)
//   REQUEST_TIMEOUT_MS   Gemini 호출 타임아웃 (기본: 20000)
// =============================================================================

// ---------------------------------------------------------------------------
// 1. 설정 (한 곳에서 관리 → 유지보수/업그레이드 용이)
// ---------------------------------------------------------------------------
const CONFIG = {
  model:        process.env.GEMINI_MODEL        || 'gemini-3.7-flash',
  apiVersion:   process.env.GEMINI_API_VERSION  || 'v1beta',
  apiKey:       process.env.GEMINI_KEY          || process.env.GEMINI_API_KEY || '',
  postsPerReq:  clampInt(process.env.POSTS_PER_REQUEST, 3, 1, 5),
  timeoutMs:    clampInt(process.env.REQUEST_TIMEOUT_MS, 20000, 3000, 60000),
  maxRetries:   2,                       // 일시적 오류(429/5xx/네트워크) 재시도 횟수
  maxTopicLen:  200,                     // 프롬프트 인젝션·비용 폭주 방지
  rateLimitMax: clampInt(process.env.RATE_LIMIT_MAX, 20, 1, 1000),
  rateWindowMs: 60_000,                  // 1분 슬라이딩 윈도우
};

// 프론트엔드가 보내는 목적/훅의 "의미"를 모델에게 명확히 전달하기 위한 사전.
// 프론트 UI에 옵션이 추가되면 여기에만 한 줄 추가하면 된다.
const PURPOSE_GUIDE = {
  '공감/소통':   '독자가 "내 얘기다" 하고 느껴 댓글·공감을 남기게 만드는 것',
  '정보제공':    '핵심 정보를 짧고 명확하게 정리해 저장·공유하고 싶게 만드는 것',
  '팔로워증가':  '다음 편이 궁금해서 팔로우를 누르게 만드는 것 (연재감·이득 강조)',
  '브랜딩':      '작성자의 관점·전문성·태도가 드러나 신뢰가 쌓이게 만드는 것',
};

const HOOK_GUIDE = {
  '의문형 훅':  '독자에게 질문을 던지며 시작 (예: "혹시 ~해본 적 있어?")',
  '숫자 훅':    '숫자로 정리 예고하며 시작 (예: "~하는 3가지 방법")',
  '반전 훅':    '통념을 뒤집으며 시작 (예: "다들 ~라는데, 사실은 반대였어")',
  '공감 훅':    '공감대를 건드리며 시작 (예: "이거 나만 그런 거 아니지?")',
  '도발 훅':    '단정적·도발적으로 시작 (예: "솔직히 90%는 이거 잘못 알고 있어")',
  '스토리 훅':  '구체적 장면·경험담으로 시작 (예: "어제 새벽 2시에 있었던 일인데")',
};

const DEFAULT_PURPOSE = '공감/소통';
const DEFAULT_HOOK    = '스토리 훅';

// 구조화 출력 스키마 — 프론트엔드가 기대하는 형태와 정확히 일치:
//   { posts: [ { template, text }, ... ] }
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    posts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          template: { type: 'STRING', description: '이 글의 접근 방식을 나타내는 짧은 한국어 라벨' },
          text:     { type: 'STRING', description: '완성된 스레드 글 본문' },
        },
        required: ['template', 'text'],
        propertyOrdering: ['template', 'text'],
      },
    },
  },
  required: ['posts'],
  propertyOrdering: ['posts'],
};

// ---------------------------------------------------------------------------
// 2. 메인 핸들러
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  applyCors(req, res);

  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(204).end();

  // POST 외 차단
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }

  // API 키 확인
  if (!CONFIG.apiKey) {
    console.error('[generate] GEMINI_KEY(또는 GEMINI_API_KEY) 환경변수가 없습니다.');
    return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });
  }

  // 레이트 리밋 (best-effort, 인스턴스 단위)
  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
  }

  // 입력 검증·정규화
  let input;
  try {
    input = parseInput(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // 생성
  try {
    const posts = await generatePosts(input);
    if (!posts.length) throw new Error('EMPTY_RESULT');
    return res.status(200).json({ posts });
  } catch (e) {
    // 상세 사유는 서버 로그에만. 프론트엔드는 이 실패를 감지해 자체 폴백으로 넘어간다.
    console.error('[generate] 생성 실패:', e?.message || e);
    return res.status(502).json({ error: '글 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}

// ---------------------------------------------------------------------------
// 3. 입력 파싱·검증
// ---------------------------------------------------------------------------
function parseInput(body) {
  const b = typeof body === 'string' ? safeJson(body) : (body || {});

  const topic = String(b.topic ?? '').trim();
  if (!topic) throw new Error('주제(topic)를 입력해 주세요.');
  if (topic.length > CONFIG.maxTopicLen) {
    throw new Error(`주제는 ${CONFIG.maxTopicLen}자 이내로 입력해 주세요.`);
  }

  // purpose / hook 은 알려진 값이면 사용, 아니면 안전한 기본값으로.
  const purpose = PURPOSE_GUIDE[b.purpose] ? b.purpose : DEFAULT_PURPOSE;
  const hook    = HOOK_GUIDE[b.hook]       ? b.hook    : DEFAULT_HOOK;

  return { topic, purpose, hook };
}

// ---------------------------------------------------------------------------
// 4. 프롬프트 빌더 (topic + purpose + hook 를 모두 반영)
// ---------------------------------------------------------------------------
function buildPrompt({ topic, purpose, hook }) {
  const n = CONFIG.postsPerReq;
  return [
    '너는 조회수 잘 나오는 한국어 "스레드(Threads)" 글을 쓰는 베테랑 카피라이터야.',
    '아래 조건에 맞춰, 실제 인기 계정이 올릴 법한 자연스러운 스레드 글을 작성해.',
    '',
    `- 주제: "${topic}"`,
    `- 글의 목적: ${purpose} (${PURPOSE_GUIDE[purpose]})`,
    `- 시작 훅 스타일: ${hook} (${HOOK_GUIDE[hook]})`,
    '',
    '작성 규칙:',
    `1) 총 ${n}개의 글. ${n}개 모두 위 "시작 훅 스타일"로 시작하되, 서로 다른 각도·소재로 접근해 절대 겹치지 않게 해.`,
    '2) 각 글은 위 "글의 목적"을 확실히 달성하도록 써.',
    '3) 자연스러운 반말 구어체. 진짜 사람이 즉흥적으로 쓴 것처럼, 구체적인 상황·디테일·감정을 담아. AI가 쓴 티가 나면 안 돼.',
    '4) 첫 문장(훅)에서 바로 시선을 끌어. 밋밋한 도입 금지.',
    '5) 각 글은 한국어 기준 대략 120~200자. 줄바꿈(\\n)을 1~2회 넣어 가독성을 살려.',
    '6) 이모지는 상황에 어울리는 걸로 딱 1개만. 남발 금지.',
    '',
    '금지 사항:',
    '- 해시태그, 따옴표로 감싼 제목·머리말("[정보]", "꿀팁:" 등).',
    '- 뻔하고 상투적인 표현("바쁜 현대인", "많은 분들이", "~하는 시대", "결론부터 말하면" 등).',
    '- 광고·홍보 문구 같은 인위적인 느낌.',
    '',
    '좋은 예시(톤 참고용, 이 내용을 그대로 쓰지는 마):',
    '"어제 새벽 2시에 갑자기 깨달았어.\\n내가 그동안 붙잡고 있던 게 사실 별거 아니었더라. 놓으니까 오히려 편해졌어 🌙"',
    '',
    'template 필드에는 그 글의 접근 방식을 나타내는 짧은 한국어 라벨을 넣어 (예: "공감형", "정보형", "반전형", "경험담형").',
    '',
    '반드시 지정된 JSON 스키마 형식으로만 응답해.',
  ].join('\n');
}


// ---------------------------------------------------------------------------
// 5. Gemini 호출 (구조화 출력 + 타임아웃 + 재시도)
// ---------------------------------------------------------------------------
async function generatePosts(input) {
  const url =
    `https://generativelanguage.googleapis.com/${CONFIG.apiVersion}` +
    `/models/${CONFIG.model}:generateContent`;

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
    maxOutputTokens: 2048,
    candidateCount: 1,
  };
  // temperature 는 신형 모델(3.5 Flash-Lite / 3.6 Flash 이후)에서 미지원.
  // 명시적으로 설정된 경우에만 전송해 하위 호환을 유지한다. (다양성은 프롬프트로 유도)
  const temp = process.env.GEMINI_TEMPERATURE;
  if (temp !== undefined && temp !== '') generationConfig.temperature = Number(temp);

  const payload = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
    generationConfig,
  };

  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': CONFIG.apiKey, // 키를 URL 쿼리 대신 헤더로 전달 (로그 노출↓)
    },
    body: JSON.stringify(payload),
  });

  return extractPosts(data);
}

// 재시도 래퍼: 네트워크 오류·429·5xx 는 지수 백오프로 재시도.
async function fetchWithRetry(url, options) {
  let lastErr;

  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (r.ok) return await r.json();

      // 재시도 가능한 상태코드
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error(`HTTP ${r.status}`);
      } else {
        // 4xx (모델명 오류·키 오류 등)는 재시도 무의미 → 즉시 중단
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${r.status}`);
      }
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') lastErr = new Error('TIMEOUT');
      else if (!lastErr) lastErr = e; // fetch 자체 실패(네트워크 등)
      // 재시도 불가로 명시된 에러는 그대로 던짐
      if (e.message && /HTTP 4\d\d/.test(e.message)) throw e;
    }

    // 마지막 시도가 아니면 백오프 후 재시도 (0.4s, 0.8s, ...)
    if (attempt < CONFIG.maxRetries) {
      await sleep(400 * Math.pow(2, attempt));
    }
  }

  throw lastErr || new Error('UNKNOWN_FETCH_ERROR');
}

// 응답에서 posts 배열을 안전하게 추출·정제.
function extractPosts(data) {
  // 안전장치: 응답이 프롬프트 안전필터 등으로 비었을 수 있음
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) return [];

  // responseMimeType=json 이면 raw 자체가 JSON. 혹시 모를 코드펜스 대비 방어적 파싱.
  const parsed = safeJson(raw) ?? safeJson(stripFence(raw));
  const list = Array.isArray(parsed?.posts) ? parsed.posts : [];

  return list
    .map((p, i) => ({
      template: String(p?.template ?? `스타일 ${i + 1}`).trim().slice(0, 20),
      text:     String(p?.text ?? '').trim(),
    }))
    .filter((p) => p.text.length > 0)
    .slice(0, CONFIG.postsPerReq);
}

// ---------------------------------------------------------------------------
// 6. CORS
// ---------------------------------------------------------------------------
function applyCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin;

  if (allowed.length === 0) {
    // 운영 환경에서는 ALLOWED_ORIGINS 지정을 강력 권장 (키 무단 사용 방지)
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // 허용 목록에 없으면 응답 헤더를 주지 않아 브라우저가 차단하도록 둔다.
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---------------------------------------------------------------------------
// 7. 레이트 리밋 (인스턴스-로컬 best-effort)
//    ⚠ 서버리스는 인스턴스가 여러 개일 수 있어 완벽하지 않다.
//    강한 보호가 필요하면 Vercel KV / Upstash Redis 로 이 함수만 교체하면 된다.
// ---------------------------------------------------------------------------
const rateStore = new Map(); // ip -> number[] (요청 타임스탬프)

function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const windowStart = now - CONFIG.rateWindowMs;

  const hits = (rateStore.get(ip) || []).filter((t) => t > windowStart);
  hits.push(now);
  rateStore.set(ip, hits);

  // 메모리 누수 방지: 가끔 오래된 IP 정리
  if (rateStore.size > 5000) {
    for (const [k, v] of rateStore) {
      if (!v.some((t) => t > windowStart)) rateStore.delete(k);
    }
  }
  return hits.length > CONFIG.rateLimitMax;
}

// ---------------------------------------------------------------------------
// 8. 유틸
// ---------------------------------------------------------------------------
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

function stripFence(s) {
  return s.replace(/```json/gi, '').replace(/```/g, '').trim();
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function clampInt(val, def, min, max) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
