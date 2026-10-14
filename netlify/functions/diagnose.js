/* ===== কৃষি সাথী: AI ফাংশন (ছবি শনাক্ত + প্রশ্ন-উত্তর) =====
   API key কোডে নয়। Netlify > Site configuration > Environment variables-এ
   GEMINI_API_KEY নামে বসান। চাইলে GEMINI_MODEL নামে মডেলও বদলাতে পারবেন। */
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const DIAG_PROMPT = `তুমি বাংলাদেশের অভিজ্ঞ কৃষি রোগতত্ত্ববিদ ও কীটতত্ত্ববিদ। ছবির ফসল, রোগ বা পোকা শনাক্ত করো।
শুধু একটি JSON অবজেক্ট দাও, অন্য কিছু নয়। সব লেখা সহজ বাংলায়, কৃষক যেন বুঝতে পারেন:
{"photo_ok":true/false,"crop":"","problem":"রোগ/পোকা/ঘাটতির নাম, সুস্থ হলে 'সুস্থ'","healthy":true/false,"confidence":0-100,"cause":"","symptoms":[""],"steps":["চিকিৎসার ধাপ, আগে ওষুধ-ছাড়া উপায়"],"medicines":[{"name":"সক্রিয় উপাদানের নাম","type":"ছত্রাকনাশক/কীটনাশক ইত্যাদি","effect":"উচ্চ/মাঝারি","how":"প্রতি লিটার পানিতে মাত্রা, কতদিন পর পর, সর্বোচ্চ কতবার"}],"prevention":[""]}
নিয়ম: medicines-এ ২-৩টি বাংলাদেশে প্রচলিত সক্রিয় উপাদান দাও। কোনো ওষুধকে ১০০% কার্যকর বলবে না।
ছবি অস্পষ্ট বা ফসল না হলে photo_ok false দাও। নিশ্চিত না হলে confidence কম দাও এবং কারণ লেখো।`;

const ASK_PROMPT = `তুমি বাংলাদেশের অভিজ্ঞ কৃষি পরামর্শদাতা (BARI, BRRI, কৃষি সম্প্রসারণ অধিদপ্তরের নির্দেশনা অনুযায়ী)।
সহজ বাংলায়, সংক্ষেপে, ধাপে ধাপে উত্তর দাও। ওষুধের কথা বললে সক্রিয় উপাদানের নাম দাও এবং শেষে স্থানীয় উপ-সহকারী কৃষি কর্মকর্তার পরামর্শ নিতে বলো।`;

const reply = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(obj),
});
const clean = (v, n) => String(v || '').slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'শুধু POST চলবে' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(500, { error: 'GEMINI_API_KEY সেট করা নেই' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'ভুল অনুরোধ' }); }

  const ctx = `\nকৃষকের ফসল: ${clean(b.crops, 120)}\nএলাকা: ${clean(b.place, 80)}\nকৃষক যে ফসলের ছবি বলেছেন: ${clean(b.crop, 40)}`;
  let parts, cfg = { maxOutputTokens: 2048 };

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
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: cfg }),
    });
    const j = await r.json();
    if (!r.ok) return reply(502, { error: (j.error && j.error.message) || 'AI সেবা সাড়া দেয়নি' });
    const text = ((j.candidates || [])[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return reply(200, { text });
  } catch (e) {
    return reply(502, { error: 'AI সংযোগ ব্যর্থ' });
  }
};
