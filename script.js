/* =========================================================
   PLI / RPLI Endowment Assurance Calculator
   Amrabera Branch Post Office – PIN 723127 – 7602067110
   Plain vanilla JavaScript. No dependencies.

   SECTIONS
   1. CONFIGURATION  (bonus rates, eligibility rules)   <-- edit here
   2. PREMIUM DATA   (official tables)                   <-- add here
   3. Helpers
   4. Validation
   5. Bonus & maturity module
   6. Premium module (separate from bonus)
   7. Rendering
   8. Actions: calculate, reset, compare, print, WhatsApp
   ========================================================= */
'use strict';

/* =========================================================
   1. CONFIGURATION  –  EDIT THIS SECTION TO UPDATE RATES
   ========================================================= */
const CONFIG = {

  office: {
    name: 'AMRABERA BRANCH POST OFFICE',
    pin: '723127',
    state: 'West Bengal, India',
    phone: '7602067110',
    whatsappNumber: '917602067110'     // India country code 91 + number
  },

  schemes: {
    PLI: {
      name: 'PLI Endowment Assurance — Santosh',
      // Rate supplied for this calculator. Verify against the latest official bonus declaration.
      bonusRatePer1000: 52,            // ₹ per ₹1,000 sum assured per year

      // Eligibility limits: VERIFY each against current official PLI rules before public use.
      minAge: 19,
      maxAge: 55,
      minSumAssured: 20000,
      maxSumAssured: 5000000,
      minTerm: 5,
      maxMaturityAge: 60,              // age at entry + term must not exceed this
      allowedMaturityAges: null        // e.g. [35,40,45,50,55,58,60] to enforce specific maturity ages; null = no restriction
    },
    RPLI: {
      name: 'RPLI Endowment Assurance — Gram Santosh',
      // Rate supplied for this calculator. Verify against the latest official bonus declaration.
      bonusRatePer1000: 48,            // ₹ per ₹1,000 sum assured per year

      // Eligibility limits: VERIFY each against current official RPLI rules before public use.
      minAge: 19,
      maxAge: 55,
      minSumAssured: 10000,
      maxSumAssured: 1000000,
      minTerm: 5,
      maxMaturityAge: 60,
      allowedMaturityAges: null
    }
  },

  // Premium payment frequencies (instalments per year).
  frequencies: {
    monthly:    { label: 'Monthly',     perYear: 12 },
    quarterly:  { label: 'Quarterly',   perYear: 4 },
    halfYearly: { label: 'Half-yearly', perYear: 2 },
    yearly:     { label: 'Yearly',      perYear: 1 }
  }
};

/* =========================================================
   2. PREMIUM DATA  –  OFFICIAL TABLES GO HERE
   ---------------------------------------------------------
   NO PREMIUM DATA IS INCLUDED. Do not enter estimated or
   derived values. Add only figures copied from the official
   India Post PLI / RPLI Endowment Assurance premium tables.

   Structure:   PREMIUM_TABLES[scheme][ageAtEntry][termYears][frequency]
   Value:       official premium per ₹1,000 sum assured, for ONE
                instalment of that frequency.

   Example of the format only (NOT real data – do not use):
     PREMIUM_TABLES.PLI = {
       30: { 20: { monthly: X, quarterly: X, halfYearly: X, yearly: X } }
     };
   ========================================================= */
const PREMIUM_TABLES = {
  PLI: {},
  RPLI: {}
};

const PREMIUM_UNAVAILABLE_MSG =
  'Premium calculation unavailable: official premium-rate data must be configured.';

/* =========================================================
   3. HELPERS
   ========================================================= */

/** Format a number as ₹ in Indian grouping, e.g. ₹1,00,000 */
function inr(value) {
  const n = Math.round(value * 100) / 100;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Shorthand for getElementById */
const $ = (id) => document.getElementById(id);

/** Last successful calculation (used for WhatsApp / compare) */
let lastResult = null;

/* =========================================================
   4. VALIDATION
   ========================================================= */

/** Read raw values from the form. */
function readForm() {
  return {
    scheme: $('scheme').value,
    age: $('age').value.trim(),
    sa: $('sa').value.trim(),
    term: $('term').value.trim(),
    freq: $('freq').value
  };
}

/**
 * Validate inputs for one scheme.
 * Returns { errors: {field: message}, values: {...} }.
 */
function validate(raw, schemeKey) {
  const errors = {};
  const rules = CONFIG.schemes[schemeKey];
  const values = {};

  if (!rules) {
    errors.scheme = 'Please select a valid insurance scheme.';
    return { errors, values };
  }

  // Age at entry
  const age = Number(raw.age);
  if (raw.age === '' || isNaN(age)) {
    errors.age = 'Enter the age at entry.';
  } else if (!Number.isInteger(age)) {
    errors.age = 'Age must be in completed whole years.';
  } else if (age < rules.minAge || age > rules.maxAge) {
    errors.age = `Age at entry must be between ${rules.minAge} and ${rules.maxAge} years for this scheme.`;
  } else {
    values.age = age;
  }

  // Sum assured
  const sa = Number(raw.sa);
  if (raw.sa === '' || isNaN(sa)) {
    errors.sa = 'Enter the sum assured.';
  } else if (sa <= 0) {
    errors.sa = 'Sum assured must be greater than zero.';
  } else if (!Number.isInteger(sa)) {
    errors.sa = 'Enter the sum assured in whole rupees.';
  } else if (sa < rules.minSumAssured || sa > rules.maxSumAssured) {
    errors.sa = `Sum assured must be between ${inr(rules.minSumAssured)} and ${inr(rules.maxSumAssured)} for this scheme.`;
  } else {
    values.sa = sa;
  }

  // Policy term
  const term = Number(raw.term);
  if (raw.term === '' || isNaN(term)) {
    errors.term = 'Enter the policy term in years.';
  } else if (!Number.isInteger(term) || term <= 0) {
    errors.term = 'Policy term must be a positive whole number of years.';
  } else if (term < rules.minTerm) {
    errors.term = `Policy term must be at least ${rules.minTerm} years.`;
  } else if (values.age !== undefined) {
    const maturityAge = values.age + term;
    if (maturityAge > rules.maxMaturityAge) {
      errors.term = `Age at maturity (${maturityAge}) cannot exceed ${rules.maxMaturityAge}. Maximum term for age ${values.age} is ${rules.maxMaturityAge - values.age} years.`;
    } else if (Array.isArray(rules.allowedMaturityAges) && !rules.allowedMaturityAges.includes(maturityAge)) {
      errors.term = `Maturity age ${maturityAge} is not allowed. Allowed maturity ages: ${rules.allowedMaturityAges.join(', ')}.`;
    } else {
      values.term = term;
    }
  }

  // Frequency
  if (!CONFIG.frequencies[raw.freq]) {
    errors.freq = 'Select a valid premium payment frequency.';
  } else {
    values.freq = raw.freq;
  }

  return { errors, values };
}

/** Show or clear field-level error messages. */
function showErrors(errors) {
  ['scheme', 'age', 'sa', 'term', 'freq'].forEach((f) => {
    const msg = errors[f] || '';
    $('err-' + f).textContent = msg;
    $(f).classList.toggle('invalid', Boolean(msg));
    $(f).setAttribute('aria-invalid', msg ? 'true' : 'false');
  });
}

/* =========================================================
   5. BONUS & MATURITY MODULE
   Simple reversionary bonus. No compounding. Sum assured is
   added to maturity exactly once. Not a premium discount.
   ========================================================= */
function calculateBonus(schemeKey, sumAssured, term) {
  const rate = CONFIG.schemes[schemeKey].bonusRatePer1000;
  const annualBonus = (sumAssured * rate) / 1000;         // (SA ÷ 1000) × rate
  const totalBonus = annualBonus * term;                  // annual bonus × term
  const maturity = sumAssured + totalBonus;               // SA + total bonus
  return { rate, annualBonus, totalBonus, maturity };
}

/* =========================================================
   6. PREMIUM MODULE  (independent of bonus module)
   Uses only verified data in PREMIUM_TABLES.
   ========================================================= */

/** Rounding rule for an instalment. VERIFY against the official rounding convention. */
function roundPremium(amount) {
  return Math.round(amount);
}

function calculatePremium(schemeKey, age, term, sumAssured, freqKey) {
  const table = PREMIUM_TABLES[schemeKey];
  const ratePer1000 =
    table && table[age] && table[age][term] ? table[age][term][freqKey] : undefined;

  if (typeof ratePer1000 !== 'number' || !isFinite(ratePer1000) || ratePer1000 <= 0) {
    return { available: false, message: PREMIUM_UNAVAILABLE_MSG };
  }

  const perYear = CONFIG.frequencies[freqKey].perYear;
  const instalment = roundPremium((sumAssured / 1000) * ratePer1000);
  const totalPremiums = instalment * perYear * term;

  return {
    available: true,
    frequencyLabel: CONFIG.frequencies[freqKey].label,
    instalment,
    totalPremiums
  };
}

/* =========================================================
   7. RENDERING
   ========================================================= */

function row(label, value, cls) {
  return `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td><td>${value}</td></tr>`;
}

function renderResults(r) {
  $('quote-date').textContent = 'Date: ' + new Date().toLocaleDateString('en-IN');

  $('tbl-details').innerHTML =
    row('Selected scheme', CONFIG.schemes[r.scheme].name) +
    row('Age at entry', r.age + ' years') +
    row('Sum assured', inr(r.sa)) +
    row('Policy term', r.term + ' years') +
    row('Age at maturity', (r.age + r.term) + ' years') +
    row('Premium payment frequency', CONFIG.frequencies[r.freq].label);

  $('tbl-maturity').innerHTML =
    row('Annual bonus rate (as supplied)', `${inr(r.bonus.rate)} per ₹1,000 sum assured per year`) +
    row('1. Sum assured', inr(r.sa)) +
    row('2. Estimated annual bonus', inr(r.bonus.annualBonus)) +
    row(`3. Estimated accumulated bonus (${r.term} years)`, inr(r.bonus.totalBonus)) +
    row('4. Estimated total maturity benefit', inr(r.bonus.maturity), 'total');

  $('bonus-note').textContent =
    'Simplified estimate assuming the specified annual bonus rate applies for the entire term, ' +
    'without compounding. Actual maturity benefits depend on official bonus declarations, policy ' +
    'conditions, eligibility, and applicable rules.';

  if (r.premium.available) {
    $('premium-box').innerHTML =
      '<table class="table">' +
      row('Payment frequency', r.premium.frequencyLabel) +
      row('Premium per instalment', inr(r.premium.instalment)) +
      row('Estimated total premiums', inr(r.premium.totalPremiums)) +
      '</table>';
  } else {
    $('premium-box').innerHTML = `<p class="premium-unavailable">${r.premium.message}</p>`;
  }

  $('results').hidden = false;
}

/** Build the PLI vs RPLI comparison table for the current inputs. */
function renderComparison() {
  const raw = readForm();
  const keys = ['PLI', 'RPLI'];
  const out = {};

  keys.forEach((k) => {
    const v = validate(raw, k);
    const hasErrors = Object.keys(v.errors).length > 0;
    out[k] = hasErrors
      ? { ok: false, errors: Object.values(v.errors) }
      : { ok: true, ...calculateBonus(k, v.values.sa, v.values.term) };
  });

  const cell = (k, fn) =>
    out[k].ok ? fn(out[k]) : `<span class="cell-error">Not eligible: ${out[k].errors.join(' ')}</span>`;

  let html =
    '<tr><th>Item</th><th>PLI – Santosh</th><th>RPLI – Gram Santosh</th></tr>' +
    `<tr><td>Annual bonus rate</td><td>${cell('PLI', (o) => inr(o.rate) + ' / ₹1,000')}</td><td>${cell('RPLI', (o) => inr(o.rate) + ' / ₹1,000')}</td></tr>` +
    `<tr><td>Estimated annual bonus</td><td>${cell('PLI', (o) => inr(o.annualBonus))}</td><td>${cell('RPLI', (o) => inr(o.annualBonus))}</td></tr>` +
    `<tr><td>Estimated total bonus</td><td>${cell('PLI', (o) => inr(o.totalBonus))}</td><td>${cell('RPLI', (o) => inr(o.totalBonus))}</td></tr>` +
    `<tr class="total"><td>Estimated maturity benefit</td><td>${cell('PLI', (o) => inr(o.maturity))}</td><td>${cell('RPLI', (o) => inr(o.maturity))}</td></tr>`;

  if (out.PLI.ok && out.RPLI.ok) {
    html += `<tr><td>Difference in total bonus (PLI − RPLI)</td><td colspan="2">${inr(out.PLI.totalBonus - out.RPLI.totalBonus)}</td></tr>`;
  }

  $('tbl-compare').innerHTML = html;
  $('compare-card').hidden = false;
  $('compare-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* =========================================================
   8. ACTIONS
   ========================================================= */

/** Calculate button / form submit */
function handleCalculate(event) {
  if (event) event.preventDefault();

  const raw = readForm();
  const { errors, values } = validate(raw, raw.scheme);
  showErrors(errors);

  if (Object.keys(errors).length > 0) {
    lastResult = null;
    $('results').hidden = true;
    const first = ['scheme', 'age', 'sa', 'term', 'freq'].find((f) => errors[f]);
    if (first) $(first).focus();
    return;
  }

  const bonus = calculateBonus(raw.scheme, values.sa, values.term);
  const premium = calculatePremium(raw.scheme, values.age, values.term, values.sa, values.freq);

  lastResult = { scheme: raw.scheme, age: values.age, sa: values.sa, term: values.term, freq: values.freq, bonus, premium };
  renderResults(lastResult);
  $('compare-card').hidden = true;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Reset button */
function handleReset() {
  $('calc-form').reset();
  showErrors({});
  $('results').hidden = true;
  $('compare-card').hidden = true;
  lastResult = null;
  updateHints();
}

/** Print / Save as PDF */
function handlePrint() {
  if (!lastResult) { alert('Please calculate first.'); return; }
  window.print();
}

/** Share on WhatsApp (message goes to 917602067110) */
function handleWhatsApp() {
  if (!lastResult) { alert('Please calculate first.'); return; }
  const r = lastResult;
  const o = CONFIG.office;

  const lines = [
    'Hello, I would like to enquire about the following policy estimate:',
    '',
    `Policy: ${CONFIG.schemes[r.scheme].name}`,
    `Sum assured: ${inr(r.sa)}`,
    `Age at entry: ${r.age} years`,
    `Policy term: ${r.term} years`,
    `Annual bonus rate: ${inr(r.bonus.rate)} per ₹1,000 per year`,
    `Estimated total bonus: ${inr(r.bonus.totalBonus)}`,
    `Estimated maturity benefit: ${inr(r.bonus.maturity)}`
  ];
  if (r.premium.available) {
    lines.push(`Premium (${r.premium.frequencyLabel}): ${inr(r.premium.instalment)}`);
  }
  lines.push(
    '',
    '(Indicative estimate only. Please confirm with the post office.)',
    '',
    o.name,
    `PIN – ${o.pin}`,
    `Contact: ${o.phone}`
  );

  const url = `https://wa.me/${o.whatsappNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
  window.open(url, '_blank', 'noopener');
}

/** Compare button: validates first, so errors show in the form */
function handleCompare() {
  renderComparison();
}

/** Update the hint text under inputs for the selected scheme */
function updateHints() {
  const r = CONFIG.schemes[$('scheme').value];
  $('hint-age').textContent = `Allowed: ${r.minAge}–${r.maxAge} years.`;
  $('hint-sa').textContent = `Allowed: ${inr(r.minSumAssured)} to ${inr(r.maxSumAssured)}.`;
  $('hint-term').textContent = `Minimum ${r.minTerm} years; age at maturity cannot exceed ${r.maxMaturityAge}.`;
}

/* ---------- Wire up events once the page is ready ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $('calc-form').addEventListener('submit', handleCalculate);
  $('btn-reset').addEventListener('click', handleReset);
  $('btn-print').addEventListener('click', handlePrint);
  $('btn-whatsapp').addEventListener('click', handleWhatsApp);
  $('btn-compare').addEventListener('click', handleCompare);
  $('scheme').addEventListener('change', () => {
    updateHints();
    $('results').hidden = true;     // avoid showing results for a previous scheme
    $('compare-card').hidden = true;
    lastResult = null;
  });
  updateHints();
});
