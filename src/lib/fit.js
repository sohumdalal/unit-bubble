// Fit profiles and verdicts.
//
// A chest measurement that's right for a tee is wrong for a jacket you layer
// under, so measurements are kept per garment type rather than as one set. Each
// profile lists the fields that actually appear on that kind of chart, and the
// verdict thresholds are per measurement family: a shoulder seam 1" out is a
// different problem from a sleeve 1" out.
(function (root) {
  const UB = (root.UB = root.UB || {});

  const FIELDS = {
    chest: { label: 'Chest', hint: 'armpit to armpit, laid flat', family: 'girth' },
    shoulders: { label: 'Shoulders', hint: 'seam to seam across the back', family: 'width' },
    sleeve: { label: 'Sleeve', hint: 'shoulder seam to cuff', family: 'length' },
    length: { label: 'Body length', hint: 'below the collar to the hem', family: 'length' },
    neck: { label: 'Neck', hint: 'collar, laid flat', family: 'neck' },
    waist: { label: 'Waist', hint: 'flat across the waistband', family: 'girth' },
    hips: { label: 'Hips / seat', hint: 'flat across the seat', family: 'girth' },
    inseam: { label: 'Inseam', hint: 'crotch seam to hem', family: 'length' },
    thigh: { label: 'Thigh', hint: 'flat across, just under the crotch', family: 'girth' },
    rise: { label: 'Rise', hint: 'crotch seam to waistband', family: 'length' },
    legOpening: { label: 'Leg opening', hint: 'flat across the hem', family: 'width' },
  };

  const PROFILES = [
    {
      id: 'tops',
      label: 'Shirts & tees',
      short: 'Tops',
      fields: ['chest', 'shoulders', 'sleeve', 'length', 'neck'],
      primary: ['chest', 'shoulders'],
    },
    {
      id: 'jackets',
      label: 'Jackets & outerwear',
      short: 'Jackets',
      fields: ['chest', 'shoulders', 'sleeve', 'length'],
      primary: ['chest', 'shoulders'],
    },
    {
      id: 'pants',
      label: 'Pants & shorts',
      short: 'Pants',
      fields: ['waist', 'hips', 'inseam', 'thigh', 'rise', 'legOpening'],
      primary: ['waist', 'hips'],
    },
  ];

  const profile = (id) => PROFILES.find((p) => p.id === id) || PROFILES[0];

  // Thresholds in mm, smallest first. Compared against (chart value − yours).
  const SCALES = {
    girth: [
      [-12, 'tight', 'too tight'],
      [-4, 'snug', 'snug'],
      [18, 'good', 'spot on'],
      [45, 'relaxed', 'roomy'],
      [Infinity, 'boxy', 'boxy'],
    ],
    width: [
      [-10, 'tight', 'too narrow'],
      [-3, 'snug', 'slightly narrow'],
      [10, 'good', 'spot on'],
      [28, 'relaxed', 'wide'],
      [Infinity, 'boxy', 'dropped shoulder'],
    ],
    length: [
      [-20, 'tight', 'too short'],
      [-6, 'snug', 'a touch short'],
      [12, 'good', 'spot on'],
      [30, 'relaxed', 'a touch long'],
      [Infinity, 'boxy', 'too long'],
    ],
    neck: [
      [-5, 'tight', 'too tight'],
      [-1, 'snug', 'snug'],
      [8, 'good', 'spot on'],
      [20, 'relaxed', 'loose'],
      [Infinity, 'boxy', 'very loose'],
    ],
  };

  function verdict(role, diffMm) {
    const field = FIELDS[role];
    if (!field) return null;
    for (const [limit, tone, text] of SCALES[field.family]) {
      if (diffMm <= limit) return { tone, text, family: field.family };
    }
    return null;
  }

  // "+1.6″" / "−0.4 cm" — the sign is the point, so it is always shown. The
  // precision matches what the cells themselves print: showing "+0.04″" next to
  // two values that both read 22.4″ looks like an arithmetic bug, when it is
  // really a 1mm difference below the display precision.
  function formatDiff(diffMm, unit) {
    const abs = Math.abs(diffMm);
    const shown = unit === 'in' ? UB.format.num(abs / 25.4, 1) : UB.format.num(abs / 10, 1);
    if (Number(shown.replace(/[^\d.]/g, '')) === 0) return unit === 'in' ? '±0″' : '±0 cm';
    const sign = diffMm > 0 ? '+' : '−';
    return unit === 'in' ? `${sign}${shown}″` : `${sign}${shown} cm`;
  }

  // True when the difference is smaller than the chart's own precision, so the
  // panel can say "same as yours" instead of implying a measurable gap.
  function isSameSize(diffMm, unit) {
    return Math.abs(diffMm) < (unit === 'in' ? 25.4 / 20 : 0.5);
  }

  // Which profile a chart belongs to. Chart headers are the strongest signal —
  // an inseam column means pants whatever the page says — then the page's own
  // words for outerwear.
  function detectProfile(headers = [], pageText = '') {
    const roles = headers.join(' ').toLowerCase();
    if (/inseam|rise|leg opening|thigh|entrejambe/.test(roles)) return 'pants';
    if (/waist/.test(roles) && /hip|seat/.test(roles) && !/chest|bust/.test(roles)) return 'pants';
    const text = pageText.toLowerCase();
    if (/jacket|coat|parka|blazer|overshirt|puffer|anorak|gilet|vest|bomber|manteau|veste/.test(text)) return 'jackets';
    if (/pant|trouser|jean|chino|short|cargo|denim|pantalon|jogger/.test(text)) return 'pants';
    return 'tops';
  }

  // Values for one profile, in mm, dropping anything left blank.
  function valuesFor(settings, profileId) {
    const stored = (settings.profiles || {})[profileId] || {};
    const out = {};
    for (const role of profile(profileId).fields) {
      const cm = Number(stored[role]);
      if (cm > 0) out[role] = cm * 10;
    }
    return out;
  }

  function hasAny(settings, profileId) {
    return Object.keys(valuesFor(settings, profileId)).length > 0;
  }

  UB.fit = { FIELDS, PROFILES, profile, verdict, formatDiff, isSameSize, detectProfile, valuesFor, hasAny };
})(typeof self !== 'undefined' ? self : globalThis);
