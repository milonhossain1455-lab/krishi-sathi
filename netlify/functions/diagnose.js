/* ===== কৃষি সাথী: AI ফাংশন (ছবি শনাক্ত + প্রশ্ন-উত্তর) =====
   API key কোডে নয়। Netlify > Environment variables-এ GEMINI_API_KEY নামে আছে।
   দুটি মডেলকে একসঙ্গে ডাকা হয়। যেটা আগে উত্তর দেয় সেটাই নেওয়া হয়,
   তাই একটি ব্যস্ত থাকলেও অ্যাপ চলে। */
const MODELS = [process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
  .filter((m, i, a) => a.indexOf(m) === i);

const DIAG_PROMPT = `তুমি বাংলাদেশের অভিজ্ঞ কৃষি রোগতত্ত্ববিদ ও কীটতত্ত্ববিদ। ছবির ফসল, রোগ বা পোকা শনাক্ত করো।
শুধু একটি JSON অবজেক্ট দাও, অন্য কিছু নয়। সহজ বাংলায়, খুব সংক্ষেপে লেখো। প্রতিটি তালিকায় সর্বোচ্চ ৩টি ছোট বাক্য:
{"photo_ok":true/false,"crop":"","problem":"রোগ/পোকা/ঘাটতির নাম, সুস্থ হলে 'সুস্থ'","healthy":true/false,"confidence":0-100,"cause":"১ বাক্য","symptoms":[""],"steps":["আগে ওষুধ-ছাড়া উপায়"],"medicines":[{"name":"সক্রিয় উপাদানের নাম","type":"ছত্রাকনাশক/কীটনাশক","effect":"উচ্চ/মাঝারি","how":"প্রতি লিটারে মাত্রা, কতদিন পর পর, সর্বোচ্চ কতবার"}],"prevention":[""]}
নিয়ম: medicines-এ সর্বোচ্চ ২টি বাংলাদেশে প্রচলিত সক্রিয় উপাদান দাও। কোনো ওষুধকে ১০০% কার্যকর বলবে না।
ছবি অস্পষ্ট বা ফসল না হলে photo_ok false দাও। নিশ্চিত না হলে confidence কম দাও।`;

const ASK_PROMPT = `তুমি বাংলাদেশের অভিজ্ঞ কৃষি পরামর্শদাতা (BARI, BRRI, কৃষি সম্প্রসারণ অধিদপ্তরের নির্দেশনা অনুযায়ী)।
সহজ বাংলায়, সংক্ষেপে, ধাপে ধাপে উত্তর দাও। ওষুধের কথা বললে সক্রিয় উপাদানের নাম দাও এবং শেষে স্থানীয় উপ-সহকারী কৃষি কর্মকর্তার পরামর্শ নিতে বলো।`;

const reply = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(obj),
});
const clean = (v, n) => String(v || '').slice(0, n);

async function callGemini(model, key, parts, cfg, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: cfg }),
      signal: ctl.signal,
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'AI সেবা সাড়া দেয়নি');
    const text = ((j.candidates || [])[0]?.content?.parts || []).map((p) => p.text || '').join('');
    if (!text) throw new Error('AI খালি উত্তর দিয়েছে');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'শুধু POST চলবে' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(500, { error: 'GEMINI_API_KEY সেট করা নেই' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'ভুল অনুরোধ' }); }

  const ctx = `\nকৃষকের ফসল: ${clean(b.crops, 120)}\nএলাকা: ${clean(b.place, 80)}\nকৃষক যে ফসলের ছবি বলেছেন: ${clean(b.crop, 40)}`;
  let parts, cfg = { maxOutputTokens: 1024 };

  if (b.mode === 'ask') {
    const q = clean(b.q, 800);
    if (!q) return reply(400, { error: 'প্রশ্ন খালি' });
    parts = [{ text: ASK_PROMPT + ctx + '\nপ্রশ্ন: ' + q }];
  } else {
    if (!b.image) return reply(400, { error: 'ছবি নেই' });
    if (b.image.length > 4000000) return reply(413, { error: 'ছবি খুব বড়' });
    parts = [{ text: DIAG_PROMPT + ctx }, { inline_data: { mime_type: 'image/jpeg', data: b.image } }];
    cfg.responseMimeType = 'application/json';
  }

  try {
    const text = await Promise.any(MODELS.map((m) => callGemini(m, key, parts, cfg, 8000)));
    return reply(200, { text });
  } catch (e) {
    const msg = e.errors ? e.errors.map((x) => x.message).join(' | ') : String(e);
    return reply(502, { error: msg });
  }
};
