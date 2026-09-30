// "Skin check before the cut": turn YouCam AI Skin Analysis scores into plain,
// cautious barbershop suggestions (guard/finish, service nudge, aftercare).
//
// What the API returns (docs/API-NOTES.md, "AI Skin Analysis"): for each requested
// concern a raw_score and a ui_score from 1 to 100, where HIGHER means healthier skin.
// ui_score is deliberately flattered by YouCam ("a psychological motivator"), so the
// thresholds below read raw_score. They are our own cautious cut-offs, not YouCam's
// and not clinical: see THRESHOLDS and the TODO in docs/API-NOTES.md.
//
// Nothing here is a diagnosis. Every summary carries DISCLAIMER.

// SD concerns we ask for. Four concerns is the cheapest tier (9 units); a fifth would
// move to 12. We skip pores: it doesn't change anything a barber does.
export const SKIN_ACTIONS = ['redness', 'acne', 'texture', 'oiliness'];

// Unit cost per skin check, from the docs' Unit Consumption table (SD, 1-4 concerns).
export const SKIN_UNITS = 9;

// raw_score below `noticeable` -> noticeable; below `some` -> some; otherwise low.
// Calibrated on live results (30 Sep 2026): a clear-skinned test face scored 88-97,
// a face with visible razor redness and bumps scored 70-71 (oiliness 41). Scores
// cluster high, so 40/60 flagged nothing; 65/80 separates the two. See API-NOTES.
export const THRESHOLDS = { noticeable: 65, some: 80 };

export const LEVELS = ['low', 'some', 'noticeable'];

export const DISCLAIMER = 'This is not a medical assessment. If your skin is sore, broken or infected, see a pharmacist or GP before a close shave.';

const LABELS = {
  redness: 'redness',
  acne: 'spots or bumps',
  texture: 'uneven texture',
  oiliness: 'oiliness',
};

export function levelFor(rawScore) {
  if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return null;
  if (rawScore < THRESHOLDS.noticeable) return 'noticeable';
  if (rawScore < THRESHOLDS.some) return 'some';
  return 'low';
}

// Accepts both documented result shapes:
//   format=json: { output: [{ type, region?, raw_score, ui_score, mask_urls }] }
//   score_info.json (zip): { redness: { raw_score, ui_score, output_mask_name }, ... }
// Returns { redness: 34.2, acne: 51.9, ... } for the concerns we asked for. Mask URLs,
// skin age and the overall score are dropped: we don't use or keep them.
export function readScores(results) {
  const scores = {};
  const put = (type, value) => {
    const key = String(type || '').replace(/^hd_/, '');
    if (SKIN_ACTIONS.includes(key) && typeof value === 'number' && Number.isFinite(value)) scores[key] = value;
  };
  if (Array.isArray(results?.output)) {
    for (const row of results.output) {
      if (row.region && row.region !== 'whole') continue;
      put(row.type, row.raw_score);
    }
  } else if (results && typeof results === 'object') {
    for (const [type, v] of Object.entries(results)) put(type, v?.raw_score ?? v?.whole?.raw_score);
  }
  return scores;
}

function worst(...levels) {
  return levels.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), 'low');
}

function hasService(services, pattern) {
  return (services || []).find((s) => pattern.test(s.name)) || null;
}

// levels: { redness: 'low'|'some'|'noticeable', ... } (missing concerns count as unknown).
// services: the live price list, so we only suggest services the shop actually sells.
export function assess(levels, services = []) {
  const clean = {};
  for (const k of SKIN_ACTIONS) if (LEVELS.includes(levels?.[k])) clean[k] = levels[k];
  if (Object.keys(clean).length === 0) return null;

  // Irritation = redness or bumps: the two signals that make razor work a bad idea today.
  const irritation = worst(clean.redness || 'low', clean.acne || 'low');
  const flagged = SKIN_ACTIONS.filter((k) => clean[k] && clean[k] !== 'low');

  let headline;
  let finish;
  if (irritation === 'noticeable') {
    const what = [clean.redness === 'noticeable' && 'redness', clean.acne === 'noticeable' && 'spots or bumps'].filter(Boolean).join(' and ');
    headline = `Your photo showed noticeable ${what}.`;
    finish = { guard: '#1', razor: false, text: 'Consider a #1 guard instead of a foil or razor finish today.' };
  } else if (irritation === 'some') {
    headline = 'Your photo showed some redness or bumps.';
    finish = { guard: '#0.5', razor: false, text: 'A #0.5 finish is a gentler choice than a razor today. Ask Marcus to go lightly on any red patches.' };
  } else {
    headline = 'No strong irritation signals in your photo.';
    // A camera can miss redness on darker skin (NHS, "Ingrown hairs"), and that's the
    // group razor bumps affect most, so "low" never reads as an all-clear.
    finish = { guard: null, razor: true, text: 'Nothing in the photo argues against your usual finish. A camera can miss irritation, especially on darker skin, so tell Marcus if your skin often reacts after a close shave.' };
  }

  const nudges = [];
  if (irritation !== 'low') {
    const trim = hasService(services, /beard trim/i);
    if (trim) nudges.push(`If you were thinking of a clean shave, a ${trim.name} (£${trim.price}) is easier on the skin today.`);
    const towel = hasService(services, /hot towel/i);
    if (towel) nudges.push(`Add a ${towel.name} (£${towel.price}) before the clippers to soften the hair.`);
  }

  const aftercare = ['Rinse with cool water and pat dry; don\'t rub.', 'Use a plain, fragrance-free moisturiser for a day or two.'];
  if (clean.acne && clean.acne !== 'low') aftercare.push("Don't pick at bumps; let ingrown hairs grow out.");
  else if (clean.oiliness === 'noticeable') aftercare.push('Wash the area once in the evening to keep pores clear.');
  else aftercare.push('Avoid hot showers and tight collars on the neck for the rest of the day.');

  return {
    levels: clean,
    flagged,
    irritation,
    headline,
    finish,
    nudges,
    aftercare: aftercare.slice(0, 3),
    note: barberNote(clean, irritation, finish),
    disclaimer: DISCLAIMER,
  };
}

// One line for Marcus's Incoming looks page, e.g.
// "Skin check: noticeable redness. Suggested #1 guard, no razor."
export function barberNote(levels, irritation, finish) {
  const flagged = SKIN_ACTIONS.filter((k) => levels[k] && levels[k] !== 'low').map((k) => `${levels[k]} ${LABELS[k]}`);
  const found = flagged.length ? flagged.join(', ') : 'no strong signals';
  const plan = irritation === 'low' ? 'Usual finish.' : `Suggested ${finish.guard} guard, no razor.`;
  return `Skin check: ${found}. ${plan}`.slice(0, 160);
}

export function summarise(scores, services) {
  const levels = {};
  for (const [k, v] of Object.entries(scores)) levels[k] = levelFor(v);
  return assess(levels, services);
}
