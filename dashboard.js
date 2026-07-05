const fmt = n => '£' + Math.round(n).toLocaleString('en-GB');
const pct = n => (Math.round(n*10)/10) + '%';

// ---- Local storage persistence ----
const LS_KEY = 'mortgageDashboard.v1';
let restoringFromStorage = false;

function collectFieldValues(ids){
  const out = {};
  ids.forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    out[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}
function applyFieldValues(vals){
  if(!vals) return;
  Object.keys(vals).forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    if(el.type === 'checkbox') el.checked = vals[id];
    else el.value = vals[id];
  });
}

const SAVED_FIELD_IDS = [
  'startMonth','startYear','propertyValue','loanBalance','yearsRemaining','currentRate','fixedEndYear','variableRate',
  'regularOverpay','overpayCap','bonusMonth','bonusAmount','remortgageEnabled',
  'startingSavings','monthlySavings','bonusSavingsEnabled','annualBonusSavings','bonusSavingsMonth'
];

function saveToStorage(){
  if(restoringFromStorage) return;
  try{
    const state = {
      fields: collectFieldValues(SAVED_FIELD_IDS),
      lumpSums, remortgages, goals,
      trackingStartYear, trackingStartMonth, trackingWindowMonths, trackingActuals,
      allocationMode, splitAllocations, splitStartAllocations, nextPaletteIndex
    };
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }catch(e){ console.warn('Could not save to localStorage:', e); }
}

function loadFromStorage(){
  let raw;
  try{ raw = localStorage.getItem(LS_KEY); }
  catch(e){ console.warn('Could not read localStorage:', e); return; }
  if(!raw) return;
  let state;
  try{ state = JSON.parse(raw); } catch(e){ return; }

  restoringFromStorage = true;
  applyFieldValues(state.fields);
  if(Array.isArray(state.lumpSums)) lumpSums = state.lumpSums;
  if(Array.isArray(state.remortgages)) remortgages = state.remortgages;
  if(Array.isArray(state.goals)) goals = state.goals;
  if(typeof state.trackingStartYear === 'number') trackingStartYear = state.trackingStartYear;
  if(typeof state.trackingStartMonth === 'number') trackingStartMonth = state.trackingStartMonth;
  if(typeof state.trackingWindowMonths === 'number') trackingWindowMonths = state.trackingWindowMonths;
  if(state.trackingActuals) trackingActuals = state.trackingActuals;
  if(state.allocationMode) allocationMode = state.allocationMode;
  if(state.splitAllocations) splitAllocations = state.splitAllocations;
  if(state.splitStartAllocations) splitStartAllocations = state.splitStartAllocations;
  if(typeof state.nextPaletteIndex === 'number') nextPaletteIndex = state.nextPaletteIndex;

  // Backfill paletteIndex for goals saved before this feature existed
  goals.forEach((g, idx) => {
    if(typeof g.paletteIndex !== 'number'){
      g.paletteIndex = nextPaletteIndex;
      nextPaletteIndex++;
    }
  });

  if(state.fields){
    const remoChecked = !!state.fields.remortgageEnabled;
    document.getElementById('remortgageFields').style.opacity = remoChecked ? '1' : '.4';
    document.getElementById('remortgageFields').style.pointerEvents = remoChecked ? 'auto' : 'none';
    const bonusChecked = !!state.fields.bonusSavingsEnabled;
    document.getElementById('bonusSavingsFields').style.opacity = bonusChecked ? '1' : '.4';
    document.getElementById('bonusSavingsFields').style.pointerEvents = bonusChecked ? 'auto' : 'none';
  }
  restoringFromStorage = false;
}

// ---- Comma-formatted money inputs ----
function formatMoneyValue(raw, allowNegative){
  const isNegative = !!(allowNegative && raw.trim().startsWith('-'));
  const digits = raw.replace(/[^0-9]/g,'');
  if(!digits) return isNegative ? '-' : '';
  return (isNegative ? '-' : '') + Number(digits).toLocaleString('en-GB');
}
function attachMoneyFormatting(){
  document.querySelectorAll('input[data-money="1"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const cursorFromEnd = inp.value.length - inp.selectionStart;
      inp.value = formatMoneyValue(inp.value);
      const pos = Math.max(0, inp.value.length - cursorFromEnd);
      inp.setSelectionRange(pos, pos);
      recalc();
    });
  });
}

// Adds a small "×" clear button to any .prefix-wrap containing a money input, so the field
// can be emptied in one click instead of click-then-backspace. Safe to call repeatedly —
// skips wraps that already have a button. Call again after any dynamic re-render that adds
// new money inputs (lump sums, remortgages, tracking rows, split allocation modal, etc.)
function injectClearButtons(root){
  (root || document).querySelectorAll('.prefix-wrap').forEach(wrap => {
    const inp = wrap.querySelector('input[data-money="1"]');
    if(!inp || wrap.querySelector('.clear-money-btn')) return;
    wrap.classList.add('has-clear-btn');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clear-money-btn';
    btn.setAttribute('aria-label', 'Clear');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      inp.value = '';
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      inp.focus();
    });
    wrap.appendChild(btn);
  });
}
function getNum(id){
  const el = document.getElementById(id);
  if(!el) return NaN;
  const raw = el.value.replace(/,/g,'').trim();
  if(raw === '') return NaN;
  const n = parseFloat(raw);
  return isNaN(n) ? NaN : n;
}
function hasVal(id){ return !isNaN(getNum(id)); }

let lumpSums = [];
let goals = [];
let nextPaletteIndex = 0;
let trackingStartYear = null;
let trackingStartMonth = null;
let trackingWindowMonths = 36;
let trackingActuals = {};
let allocationMode = 'sequential'; // 'split' or 'sequential'
let splitAllocations = {};
let splitStartAllocations = {};

function renderLumpSumRows(){
  const list = document.getElementById('lumpSumList');
  list.innerHTML = '';
  if(lumpSums.length === 0){
    const p = document.createElement('div');
    p.style.cssText = 'font-size:12.5px;color:var(--muted);padding:4px 2px;';
    p.textContent = 'No one-off lump sums added yet.';
    list.appendChild(p);
  }
  lumpSums.forEach((ls, i) => {
    const row = document.createElement('div');
    row.className = 'overpay-row';
    row.innerHTML = `
      <span style="font-size:12px;color:var(--muted);white-space:nowrap;">Month</span>
      <input type="number" value="${ls.month ?? ''}" placeholder="e.g. 6" style="width:60px;" data-idx="${i}" data-field="month">
      <span style="font-size:12px;color:var(--muted);white-space:nowrap;">Amount £</span>
      <input type="text" inputmode="numeric" value="${ls.amount ? ls.amount.toLocaleString('en-GB') : ''}" placeholder="e.g. 3,000" style="width:100px;" data-idx="${i}" data-field="amount" data-money="1">
      <button class="rm" data-idx="${i}" title="Remove">&times;</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('input[data-field="month"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = +e.target.dataset.idx;
      lumpSums[idx].month = e.target.value === '' ? null : (+e.target.value || 0);
      recalc();
    });
  });
  list.querySelectorAll('input[data-field="amount"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const cursorFromEnd = e.target.value.length - e.target.selectionStart;
      e.target.value = formatMoneyValue(e.target.value);
      const pos = Math.max(0, e.target.value.length - cursorFromEnd);
      e.target.setSelectionRange(pos, pos);
      const idx = +e.target.dataset.idx;
      lumpSums[idx].amount = +e.target.value.replace(/,/g,'') || 0;
      recalc();
    });
  });
  list.querySelectorAll('.rm').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.target.dataset.idx;
      lumpSums.splice(idx, 1);
      renderLumpSumRows();
      recalc();
    });
  });
  injectClearButtons(list);
}

document.getElementById('addLumpSum').addEventListener('click', () => {
  lumpSums.push({month: null, amount: 0});
  renderLumpSumRows();
  recalc();
});

// ---- Remortgages (multiple, year-based) ----
let remortgages = [];

function renderRemortgageRows(){
  const list = document.getElementById('remortgageList');
  list.innerHTML = '';
  if(remortgages.length === 0){
    const p = document.createElement('div');
    p.style.cssText = 'font-size:12.5px;color:var(--muted);padding:4px 2px;';
    p.textContent = 'No remortgages added yet.';
    list.appendChild(p);
  }
  remortgages.forEach((rm, i) => {
    const entry = document.createElement('div');
    entry.className = 'remortgage-entry';
    entry.innerHTML = `
      <div class="remortgage-entry-head">
        <b>Remortgage ${i+1}</b>
        <button class="rm" data-idx="${i}" title="Remove">&times;</button>
      </div>
      <div class="field-grid">
        <div class="field"><label>Year</label><input type="number" value="${rm.year ?? ''}" placeholder="e.g. 2028" data-idx="${i}" data-field="year"></div>
        <div class="field">
          <label>New rate</label>
          <div class="suffix-wrap"><input type="number" value="${rm.rate ?? ''}" placeholder="e.g. 4.40" step="0.01" min="0" data-idx="${i}" data-field="rate"><span class="suffix">%</span></div>
        </div>
        <div class="field"><label>New term (years)</label><input type="number" value="${rm.term ?? ''}" placeholder="e.g. 22" step="1" min="1" data-idx="${i}" data-field="term"></div>
        <div class="field">
          <label>Release / borrow extra</label>
          <div class="prefix-wrap"><span class="prefix">£</span><input type="text" inputmode="numeric" value="${rm.release ? rm.release.toLocaleString('en-GB') : ''}" placeholder="0" data-idx="${i}" data-field="release" data-money="1"></div>
        </div>
        <div class="field">
          <label>Product/arrangement fee</label>
          <div class="prefix-wrap"><span class="prefix">£</span><input type="text" inputmode="numeric" value="${rm.fee ? rm.fee.toLocaleString('en-GB') : ''}" placeholder="e.g. 999" data-idx="${i}" data-field="fee" data-money="1"></div>
        </div>
      </div>
    `;
    list.appendChild(entry);
  });

  list.querySelectorAll('input[data-field="year"], input[data-field="rate"], input[data-field="term"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = +e.target.dataset.idx;
      const field = e.target.dataset.field;
      remortgages[idx][field] = e.target.value === '' ? null : (+e.target.value);
      recalc();
    });
  });
  list.querySelectorAll('input[data-field="release"], input[data-field="fee"]').forEach(inp => {
    inp.addEventListener('input', e => {
      const cursorFromEnd = e.target.value.length - e.target.selectionStart;
      e.target.value = formatMoneyValue(e.target.value);
      const pos = Math.max(0, e.target.value.length - cursorFromEnd);
      e.target.setSelectionRange(pos, pos);
      const idx = +e.target.dataset.idx;
      const field = e.target.dataset.field;
      remortgages[idx][field] = +e.target.value.replace(/,/g,'') || 0;
      recalc();
    });
  });
  list.querySelectorAll('.remortgage-entry-head .rm').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.target.dataset.idx;
      remortgages.splice(idx, 1);
      renderRemortgageRows();
      recalc();
    });
  });
  injectClearButtons(list);
}

document.getElementById('addRemortgage').addEventListener('click', () => {
  remortgages.push({year: null, rate: null, term: null, release: 0, fee: 0});
  renderRemortgageRows();
  recalc();
});

function monthlyPayment(balance, annualRatePct, months){
  const r = annualRatePct/100/12;
  if(months <= 0) return balance;
  if(r === 0) return balance/months;
  return balance * r / (1 - Math.pow(1+r, -months));
}

// Groups simulation rows by the real calendar year they fall in (not rolling 12-month blocks).
// Returns an array sorted ascending: [{yearIndex, calYear, rows}, ...]
function groupRowsByCalendarYear(rows){
  const now = new Date();
  const startYear = now.getFullYear();
  const startMonthIdx = now.getMonth();
  const map = new Map();
  rows.forEach(r => {
    const d = new Date(startYear, startMonthIdx + (r.month - 1), 1);
    const y = d.getFullYear();
    if(!map.has(y)) map.set(y, []);
    map.get(y).push(r);
  });
  return [...map.keys()].sort((a,b)=>a-b).map((y,i) => ({yearIndex:i+1, calYear:y, rows:map.get(y)}));
}

// Back-fills the already-elapsed months of the current calendar year (Jan by default, or the
// mortgage start month/year if provided) so "Year 1" shows the full year, not just from today.
// Estimated at the current rate (we don't have historical rate data), overpayments assumed £0
// since they only start from today. Mutates the first group of each groups array in place.
function applyHistoryBackfill(withOPGroups, baselineGroups, startBalance, currentRate, totalMonths){
  if(!withOPGroups.length || !baselineGroups.length) return;

  const now = new Date();
  const todayMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const startMonthVal = document.getElementById('startMonth').value;
  const startYearVal = getNum('startYear');
  let anchorDate;
  if(startMonthVal && !isNaN(startYearVal)){
    anchorDate = new Date(startYearVal, +startMonthVal - 1, 1);
  } else {
    anchorDate = new Date(now.getFullYear(), 0, 1); // January of the current real year
  }
  const janThisYear = new Date(now.getFullYear(), 0, 1);
  const effectiveStart = anchorDate > janThisYear ? anchorDate : janThisYear;

  const backfillMonths = (todayMonthStart.getFullYear()-effectiveStart.getFullYear())*12 + (todayMonthStart.getMonth()-effectiveStart.getMonth());
  if(backfillMonths <= 0) return;

  const r = currentRate/100/12;
  const payment0 = monthlyPayment(startBalance, currentRate, totalMonths);

  const pastRowsReversed = [];
  let runningEndBalance = startBalance;
  for(let i=0; i<backfillMonths; i++){
    const balPrev = (runningEndBalance + payment0) / (1+r);
    const interestThisMonth = balPrev * r;
    const principalThisMonth = payment0 - interestThisMonth;
    const rowDate = new Date(todayMonthStart.getFullYear(), todayMonthStart.getMonth() - (i+1), 1);
    pastRowsReversed.push({
      balance: runningEndBalance, interest: interestThisMonth, principal: principalThisMonth,
      overpay: 0, rate: currentRate, isHistory: true, dateOverride: rowDate
    });
    runningEndBalance = balPrev;
  }
  const pastRowsChronological = pastRowsReversed.reverse();

  withOPGroups[0].rows = [...pastRowsChronological, ...withOPGroups[0].rows];
  withOPGroups[0].historyStartBalance = runningEndBalance;
  baselineGroups[0].rows = [...pastRowsChronological, ...baselineGroups[0].rows];
  baselineGroups[0].historyStartBalance = runningEndBalance;
}

function hasRequiredInputs(){
  return hasVal('propertyValue') && hasVal('loanBalance') && hasVal('yearsRemaining') && hasVal('currentRate');
}

// Simulates month by month. If withOverpayments=false, ignores lump sums, regular & bonus overpay.
function simulate(withOverpayments){
  const propertyValue = getNum('propertyValue') || 0;
  const startBalance = getNum('loanBalance') || 0;
  const yearsRemaining = getNum('yearsRemaining') || 0;
  const currentRate = getNum('currentRate') || 0;
  const variableRate = hasVal('variableRate') ? getNum('variableRate') : currentRate;
  const fixedEndYear = getNum('fixedEndYear');
  const regularOverpay = withOverpayments ? (getNum('regularOverpay') || 0) : 0;
  const overpayCapPct = hasVal('overpayCap') ? getNum('overpayCap') : 100;

  const bonusMonthSel = document.getElementById('bonusMonth').value;
  const bonusMonth = withOverpayments && bonusMonthSel ? +bonusMonthSel : null;
  const bonusAmount = withOverpayments ? (getNum('bonusAmount') || 0) : 0;

  const remortgageEnabled = document.getElementById('remortgageEnabled').checked;

  // convert "fixed rate ends in year X" / remortgage "year X" to months-from-now
  const now = new Date();
  function yearToMonthsFromNow(year){
    let months = Math.round((year - now.getFullYear())*12 - now.getMonth());
    if(months < 0) months = 0;
    return months;
  }

  let fixedMonths;
  if(!isNaN(fixedEndYear)){
    fixedMonths = yearToMonthsFromNow(fixedEndYear);
  } else {
    fixedMonths = Math.round(yearsRemaining*12); // never leaves fixed rate if not specified
  }

  // Build a sorted list of valid remortgage events (each with year, rate, term all set)
  const remoEvents = remortgageEnabled ? remortgages
    .filter(r => r.year != null && r.rate != null && r.term != null && !isNaN(r.year) && !isNaN(r.rate) && !isNaN(r.term))
    .map(r => ({
      month: yearToMonthsFromNow(r.year),
      rate: r.rate,
      term: r.term,
      release: r.release || 0,
      fee: r.fee || 0,
      year: r.year
    }))
    .sort((a,b) => a.month - b.month) : [];

  let balance = startBalance;
  let totalMonths = Math.round(yearsRemaining*12);
  let rate = currentRate;
  let payment = monthlyPayment(balance, rate, totalMonths);

  let monthsLeftOnPlan = totalMonths;
  const lumps = withOverpayments ? lumpSums.filter(l => l.month) : [];
  const lumpMap = {};
  lumps.forEach(l => { lumpMap[l.month] = (lumpMap[l.month]||0) + (l.amount||0); });

  const rows = [];
  let cumInterest = 0;
  let capRemainingThisYear = balance * overpayCapPct/100;
  let m = 0;
  const maxMonths = 600;
  let hasRemortgaged = false;
  let nextRemoIdx = 0;

  while(balance > 1 && m < maxMonths){
    m++;
    const calendarMonth = ((now.getMonth() + m - 1) % 12) + 1; // 1-12

    // Fixed -> variable rate transition (skipped if a remortgage already took over by this point)
    if(fixedMonths !== undefined && m === fixedMonths+1 && !hasRemortgaged){
      rate = variableRate;
      monthsLeftOnPlan = totalMonths - (m-1);
      if(monthsLeftOnPlan > 0) payment = monthlyPayment(balance, rate, monthsLeftOnPlan);
    }

    // Apply any remortgage events scheduled for this month
    while(nextRemoIdx < remoEvents.length && m === remoEvents[nextRemoIdx].month + 1){
      const ev = remoEvents[nextRemoIdx];
      balance += ev.release;
      rate = ev.rate;
      monthsLeftOnPlan = Math.round(ev.term*12);
      payment = monthlyPayment(balance, rate, monthsLeftOnPlan);
      hasRemortgaged = true;
      nextRemoIdx++;
    }

    if((m-1) % 12 === 0){
      capRemainingThisYear = balance * overpayCapPct/100;
    }

    const r = rate/100/12;
    const interest = balance * r;
    let principalPortion = payment - interest;
    if(principalPortion > balance) principalPortion = balance;
    if(principalPortion < 0) principalPortion = 0;
    balance -= principalPortion;
    cumInterest += interest;

    let overpayThisMonth = 0;
    if(withOverpayments){
      let extra = regularOverpay;
      if(lumpMap[m]) extra += lumpMap[m];
      if(bonusMonth && calendarMonth === bonusMonth) extra += bonusAmount;
      extra = Math.min(extra, Math.max(capRemainingThisYear,0), balance);
      if(extra > 0){
        balance -= extra;
        capRemainingThisYear -= extra;
        overpayThisMonth = extra;
      }
    }
    if(balance < 0) balance = 0;

    rows.push({ month: m, balance, interest, principal: principalPortion, overpay: overpayThisMonth, rate });
    if(balance <= 0) break;
  }

  return {rows, cumInterest, propertyValue, startBalance};
}

let balanceChart, donutChart, balanceModalChart, donutModalChart;
let lastSim = null;

function setEmptyState(isEmpty){
  document.getElementById('chartEmpty').style.display = isEmpty ? 'block' : 'none';
  document.getElementById('chartWrap').style.display = isEmpty ? 'none' : 'block';
  document.getElementById('donutEmpty').style.display = isEmpty ? 'block' : 'none';
  document.getElementById('donutWrap').style.display = isEmpty ? 'none' : 'flex';
  document.getElementById('tableEmpty').style.display = isEmpty ? 'block' : 'none';
  document.getElementById('tableWrap').style.display = isEmpty ? 'none' : 'block';
  document.getElementById('donutYearSelect').style.display = isEmpty ? 'none' : 'inline-block';
  document.querySelector('.donut-filter-row label').style.display = isEmpty ? 'none' : 'inline';

  document.getElementById('addMortgageBtn').style.display = isEmpty ? 'inline-flex' : 'none';
  document.getElementById('dashboardBody').style.display = isEmpty ? 'none' : 'block';
  document.getElementById('emptyStateMessage').style.display = isEmpty ? 'block' : 'none';
  const rr = document.querySelector('.rightrail');
  if(rr) rr.style.display = isEmpty ? 'none' : '';

  document.getElementById('panel-details').style.display = isEmpty ? 'none' : '';
  document.getElementById('panel-overpay').style.display = isEmpty ? 'none' : '';
  document.getElementById('panel-remortgage').style.display = isEmpty ? 'none' : '';

  if(!isEmpty) updateMortgageSummaryPanel();
}

function updateMortgageSummaryPanel(){
  const grid = document.getElementById('mortgageSummaryGrid');
  if(!grid) return;
  const startMonthSel = document.getElementById('startMonth');
  const startMonthText = startMonthSel.selectedIndex > 0 ? startMonthSel.options[startMonthSel.selectedIndex].text : null;
  const startYearVal = getNum('startYear');
  const propertyValue = getNum('propertyValue');
  const loanBalance = getNum('loanBalance');
  const yearsRemaining = getNum('yearsRemaining');
  const currentRate = getNum('currentRate');
  const fixedEndYear = getNum('fixedEndYear');
  const variableRate = getNum('variableRate');

  function stat(label, value){
    return `<div class="modal-stat" style="border-bottom:none;padding-bottom:0;min-width:120px;"><div class="m-label">${label}</div><div class="m-value" style="font-size:16px;">${value}</div></div>`;
  }

  let html = '';
  if(startMonthText && !isNaN(startYearVal)) html += stat('Started', `${startMonthText} ${startYearVal}`);
  html += stat('Property value', fmt(propertyValue));
  html += stat('Current balance', fmt(loanBalance));
  html += stat('Years remaining', isNaN(yearsRemaining) ? '--' : yearsRemaining);
  html += stat('Current rate', isNaN(currentRate) ? '--' : currentRate + '%');
  html += stat('Fixed rate ends', !isNaN(fixedEndYear) ? Math.round(fixedEndYear) : 'Not set');
  if(!isNaN(variableRate)) html += stat('Variable rate', variableRate + '%');
  grid.innerHTML = html;
}

function recalc(){
  if(!hasRequiredInputs()){
    setEmptyState(true);
    document.getElementById('statBalance').textContent = '--';
    document.getElementById('statBalanceSub').textContent = 'of original loan';
    document.getElementById('statEquity').textContent = '--';
    document.getElementById('statEquitySub').textContent = '-- of property value';
    document.getElementById('statPayoff').textContent = '--';
    document.getElementById('statPayoffSub').textContent = 'on current plan';
    document.getElementById('statSaved').textContent = '--';
    document.getElementById('statSavedSub').textContent = 'vs. no overpayments';
    document.getElementById('paymentBanner').textContent = 'Fill in the fields above to see your monthly payment.';
    document.getElementById('paymentBanner').className = 'banner neutral';
    ['ltvNow','ltv5','ltvRemo'].forEach(id => document.getElementById(id).textContent = '--');
    ['ltvBarNow','ltvBar5','ltvBarRemo'].forEach(id => document.getElementById(id).style.width = '0%');
    document.getElementById('baselineYears').innerHTML = '--<span>yrs</span>';
    document.getElementById('newYears').innerHTML = '--<span>yrs</span>';
    document.getElementById('monthsSaved').innerHTML = '--<span>mo</span>';
    document.getElementById('interestSaved').textContent = '--';
    ['yr1Principal','yr1Interest','yr1Overpay','legPrincipal','legInterest','legOverpay'].forEach(id => document.getElementById(id).textContent = '--');
    ['yr1PrincipalBar','yr1InterestBar','yr1OverpayBar'].forEach(id => document.getElementById(id).style.width = '0%');
    if(balanceChart){ balanceChart.destroy(); balanceChart = null; }
    if(donutChart){ donutChart.destroy(); donutChart = null; }
    lastSim = null;
    document.getElementById('donutYearSelect').innerHTML = '';
    saveToStorage();
    return;
  }
  setEmptyState(false);

  const withOP = simulate(true);
  const baseline = simulate(false);
  const withOPGroups = groupRowsByCalendarYear(withOP.rows);
  const baselineGroups = groupRowsByCalendarYear(baseline.rows);
  applyHistoryBackfill(withOPGroups, baselineGroups, withOP.startBalance, getNum('currentRate'), Math.round(getNum('yearsRemaining')*12));

  const propertyValue = withOP.propertyValue;
  const startBalance = withOP.startBalance;
  const currentEquity = propertyValue - startBalance;

  document.getElementById('statBalance').textContent = fmt(startBalance);
  document.getElementById('statBalanceSub').textContent = propertyValue ? `of ${fmt(propertyValue)} property` : 'of original loan';
  document.getElementById('statEquity').textContent = fmt(currentEquity);
  document.getElementById('statEquitySub').textContent = propertyValue ? pct(100*currentEquity/propertyValue) + ' of property value' : '--';

  const payoffMonths = withOP.rows.length;
  const payoffDate = new Date();
  payoffDate.setMonth(payoffDate.getMonth() + payoffMonths);
  document.getElementById('statPayoff').textContent = payoffDate.toLocaleDateString('en-GB', {month:'short', year:'numeric'});
  document.getElementById('statPayoffSub').textContent = `${Math.floor(payoffMonths/12)}y ${payoffMonths%12}m from now`;

  const monthsSaved = baseline.rows.length - withOP.rows.length;
  const interestSaved = baseline.cumInterest - withOP.cumInterest;
  document.getElementById('statSaved').textContent = (monthsSaved>0? Math.floor(monthsSaved/12)+'y '+(monthsSaved%12)+'m' : '0');
  document.getElementById('statSavedSub').textContent = interestSaved>0 ? fmt(interestSaved) + ' interest saved' : 'vs. no overpayments';

  document.getElementById('baselineYears').innerHTML = (Math.round(baseline.rows.length/12*10)/10) + '<span>yrs</span>';
  document.getElementById('newYears').innerHTML = (Math.round(withOP.rows.length/12*10)/10) + '<span>yrs</span>';
  document.getElementById('monthsSaved').innerHTML = monthsSaved + '<span>mo</span>';
  document.getElementById('interestSaved').innerHTML = fmt(interestSaved);

  const ltvNow = propertyValue ? 100*startBalance/propertyValue : 0;
  document.getElementById('ltvNow').textContent = pct(ltvNow);
  document.getElementById('ltvBarNow').style.width = Math.min(ltvNow,100)+'%';

  const idx5y = Math.min(60, withOP.rows.length-1);
  const bal5 = withOP.rows[idx5y] ? withOP.rows[idx5y].balance : 0;
  const ltv5 = propertyValue ? 100*bal5/propertyValue : 0;
  document.getElementById('ltv5').textContent = pct(ltv5);
  document.getElementById('ltvBar5').style.width = Math.min(ltv5,100)+'%';

  const remortgageEnabled = document.getElementById('remortgageEnabled').checked;
  const validRemos = remortgageEnabled ? remortgages
    .filter(r => r.year != null && r.rate != null && r.term != null && !isNaN(r.year) && !isNaN(r.rate) && !isNaN(r.term))
    .sort((a,b) => a.year - b.year) : [];
  const nextRemo = validRemos[0] || null;

  let ltvRemo = ltvNow;
  if(nextRemo){
    const monthsUntil = Math.round((nextRemo.year - new Date().getFullYear())*12 - new Date().getMonth());
    const idxR = Math.min(Math.max(monthsUntil,0), withOP.rows.length-1);
    const balR = withOP.rows[idxR] ? withOP.rows[idxR].balance : 0;
    ltvRemo = propertyValue ? 100*(balR+(nextRemo.release||0))/propertyValue : 0;
  }
  document.getElementById('ltvRemo').textContent = nextRemo ? pct(ltvRemo) : '—';
  document.getElementById('ltvBarRemo').style.width = nextRemo ? Math.min(ltvRemo,100)+'%' : '0%';

  const yr1 = withOPGroups[0] ? withOPGroups[0].rows : [];
  const yr1Principal = yr1.reduce((s,r)=>s+r.principal,0);
  const yr1Interest = yr1.reduce((s,r)=>s+r.interest,0);
  const yr1Overpay = yr1.reduce((s,r)=>s+r.overpay,0);
  const yr1Total = yr1Principal+yr1Interest+yr1Overpay || 1;
  document.getElementById('yr1Principal').textContent = fmt(yr1Principal);
  document.getElementById('yr1Interest').textContent = fmt(yr1Interest);
  document.getElementById('yr1Overpay').textContent = fmt(yr1Overpay);
  document.getElementById('yr1PrincipalBar').style.width = (100*yr1Principal/yr1Total)+'%';
  document.getElementById('yr1InterestBar').style.width = (100*yr1Interest/yr1Total)+'%';
  document.getElementById('yr1OverpayBar').style.width = (100*yr1Overpay/yr1Total)+'%';

  const rate = getNum('currentRate');
  const bal0 = getNum('loanBalance');
  const yrs = getNum('yearsRemaining');
  const pmt = monthlyPayment(bal0, rate, yrs*12);
  const fixedEndYearVal = getNum('fixedEndYear');
  const variableRateVal = getNum('variableRate');
  document.getElementById('paymentBanner').className = 'banner';
  let bannerHtml = `Monthly payment: <b>${fmt(pmt)}</b> at ${rate}% APR.`;
  if(!isNaN(fixedEndYearVal)){
    if(!isNaN(variableRateVal)){
      bannerHtml += ` Your rate switches to <b>${variableRateVal}%</b> from <b>${Math.round(fixedEndYearVal)}</b>, when payments recalculate.`;
    } else {
      bannerHtml += ` Add a variable rate above to see what happens after your fixed period ends in <b>${Math.round(fixedEndYearVal)}</b>.`;
    }
  }
  const startMonthVal = document.getElementById('startMonth').value;
  const startYearVal = getNum('startYear');
  if(startMonthVal && !isNaN(startYearVal)){
    const startDate = new Date(startYearVal, +startMonthVal - 1, 1);
    const now = new Date();
    let elapsedMonths = (now.getFullYear()-startDate.getFullYear())*12 + (now.getMonth()-startDate.getMonth());
    if(elapsedMonths < 0) elapsedMonths = 0;
    const elapsedYears = Math.floor(elapsedMonths/12);
    const elapsedRemMonths = elapsedMonths%12;
    const originalTermYears = Math.round((elapsedMonths/12 + yrs)*10)/10;
    bannerHtml += ` You're <b>${elapsedYears}y ${elapsedRemMonths}m</b> into this mortgage, on an original term of roughly <b>${originalTermYears} years</b>.`;
  }
  document.getElementById('paymentBanner').innerHTML = bannerHtml;

  const remoBanner = document.getElementById('remortgageBanner');
  if(validRemos.length){
    remoBanner.style.display = 'block';
    let runningBalance = startBalance;
    const lines = validRemos.map((rm, i) => {
      const monthsUntil = Math.round((rm.year - new Date().getFullYear())*12 - new Date().getMonth());
      const idxR = Math.min(Math.max(monthsUntil,0), withOP.rows.length-1);
      const balAtRemo = withOP.rows[idxR] ? withOP.rows[idxR].balance : runningBalance;
      const newBal = balAtRemo + (rm.release||0);
      const newPmt = monthlyPayment(newBal, rm.rate, rm.term*12);
      return `<div style="${i>0?'margin-top:8px;':''}"><b>Remortgage ${i+1} (${Math.round(rm.year)}):</b> balance will be ~<b>${fmt(balAtRemo)}</b>. Moving to <b>${rm.rate}%</b> over <b>${rm.term} years</b>${rm.release>0?` and releasing <b>${fmt(rm.release)}</b>`:''} gives a new balance of <b>${fmt(newBal)}</b> and a new monthly payment of <b>${fmt(newPmt)}</b>${rm.fee>0?` (plus a ${fmt(rm.fee)} fee)`:''}.</div>`;
    });
    remoBanner.innerHTML = lines.join('');
  } else {
    remoBanner.style.display = 'none';
  }

  const tbody = document.getElementById('yearTableBody');
  tbody.innerHTML = '';

  withOPGroups.forEach(g => {
    const slice = g.rows;
    const endBal = slice[slice.length-1].balance;
    const yrInterest = slice.reduce((s,r)=>s+r.interest,0);
    const yrOverpay = slice.reduce((s,r)=>s+r.overpay,0);
    const equity = propertyValue - endBal;
    const rateAtEnd = slice[slice.length-1].rate;
    const tr = document.createElement('tr');
    tr.className = 'year-row';
    tr.dataset.yearIndex = g.yearIndex;
    tr.innerHTML = `<td>Year ${g.yearIndex}</td><td>${g.calYear}</td><td>${fmt(endBal)}</td><td>${fmt(equity)}</td><td>${fmt(yrInterest)}</td><td>${fmt(yrOverpay)}</td><td>${(Math.round(rateAtEnd*100)/100)}%</td>`;
    tr.addEventListener('click', () => {
      openModal('yearDetailModalOverlay');
      document.getElementById('yearDetailYearSelect').value = String(g.yearIndex);
      renderYearDetailModal();
    });
    tbody.appendChild(tr);
  });

  // Store latest simulation state for the modals & donut card filter
  lastSim = { withOP, baseline, propertyValue, withOPGroups, baselineGroups };
  populateYearSelects();
  updateDonutCardForSelectedYear();

  updateCharts(withOP, baseline, propertyValue);
  saveToStorage();
}

function updateCharts(withOP, baseline, propertyValue){
  const years = Math.ceil(Math.max(withOP.rows.length, baseline.rows.length)/12);
  const labels = [];
  const balWith = [];
  const balBase = [];
  const equityWith = [];
  for(let y=0;y<=years;y++){
    labels.push('Yr ' + y);
    const idx = Math.min(y*12, withOP.rows.length-1);
    const idxB = Math.min(y*12, baseline.rows.length-1);
    const bw = idx>=0 ? (withOP.rows[idx] ? withOP.rows[idx].balance : 0) : withOP.startBalance;
    const bb = idxB>=0 ? (baseline.rows[idxB] ? baseline.rows[idxB].balance : 0) : baseline.startBalance;
    balWith.push(y===0 ? withOP.startBalance : bw);
    balBase.push(y===0 ? baseline.startBalance : bb);
    equityWith.push(propertyValue - (y===0?withOP.startBalance:bw));
  }

  const ctx = document.getElementById('balanceChart');
  const data = {
    labels,
    datasets:[
      {label:'Balance (with overpayments)', data: balWith, borderColor:'#0e8f6f', backgroundColor:'rgba(14,143,111,0.08)', fill:true, tension:.3, pointRadius:0, borderWidth:2.5},
      {label:'Balance (baseline, no overpayments)', data: balBase, borderColor:'#e8823a', backgroundColor:'transparent', borderDash:[5,4], fill:false, tension:.3, pointRadius:0, borderWidth:2},
      {label:'Equity', data: equityWith, borderColor:'#e0b23a', backgroundColor:'transparent', tension:.3, pointRadius:0, borderWidth:2}
    ]
  };
  if(balanceChart){
    balanceChart.data = data;
    balanceChart.update();
  } else {
    balanceChart = new Chart(ctx, {
      type:'line',
      data,
      options:{
        responsive:true,
        interaction:{mode:'index', intersect:false},
        plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:11}, usePointStyle:true}}},
        scales:{
          y:{ticks:{callback:v=>'£'+(v/1000)+'k'}, grid:{color:'var(--track-bg)'}},
          x:{grid:{display:false}}
        }
      }
    });
  }


}

// ---- Year selects (donut card filter + both modals) ----
function populateYearSelects(){
  const selects = [
    document.getElementById('donutYearSelect'),
    document.getElementById('balanceModalYearSelect'),
    document.getElementById('donutModalYearSelect'),
    document.getElementById('yearDetailYearSelect')
  ];
  if(!lastSim){ selects.forEach(el => el.innerHTML = ''); return; }
  const groups = lastSim.withOPGroups;
  selects.forEach(el => {
    const prevValue = el.value;
    el.innerHTML = groups.map(g => `<option value="${g.yearIndex}">Year ${g.yearIndex} (${g.calYear})</option>`).join('');
    if(prevValue && groups.some(g => String(g.yearIndex) === prevValue)){
      el.value = prevValue;
    } else {
      el.value = groups.length ? '1' : '';
    }
  });
}

function getGroupByIndex(groups, yearIndex){
  return groups.find(g => g.yearIndex === yearIndex) || null;
}

// ---- Donut card (on-dashboard, per-year breakdown, not cumulative) ----
function updateDonutCardForSelectedYear(){
  if(!lastSim) return;
  const sel = document.getElementById('donutYearSelect');
  const yearIndex = parseInt(sel.value || '1', 10);
  const group = getGroupByIndex(lastSim.withOPGroups, yearIndex) || lastSim.withOPGroups[0];
  if(!group) return;

  const rows = group.rows;
  const p = rows.reduce((s,r)=>s+r.principal,0);
  const i = rows.reduce((s,r)=>s+r.interest,0);
  const o = rows.reduce((s,r)=>s+r.overpay,0);

  const dctx = document.getElementById('donutChart');
  const ddata = {
    labels:['Principal','Interest','Overpayments'],
    datasets:[{data:[p,i,o], backgroundColor:['#0e8f6f','#e8823a','#e0b23a'], borderWidth:0}]
  };
  if(donutChart){
    donutChart.data = ddata;
    donutChart.update();
  } else {
    donutChart = new Chart(dctx, {
      type:'doughnut',
      data: ddata,
      options:{cutout:'68%', maintainAspectRatio:true, aspectRatio:1, plugins:{legend:{display:false}, tooltip:{callbacks:{label: c => c.label+': £'+Math.round(c.raw).toLocaleString('en-GB')}}}}
    });
  }
  document.getElementById('legPrincipal').textContent = fmt(p);
  document.getElementById('legInterest').textContent = fmt(i);
  document.getElementById('legOverpay').textContent = fmt(o);
}

document.getElementById('donutYearSelect').addEventListener('change', updateDonutCardForSelectedYear);

// ---- Modal open/close plumbing ----
function openModal(id){
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id){
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if(e.target === overlay) closeModal(overlay.id); });
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o.id));
  }
});

document.getElementById('balancePanel').addEventListener('click', () => {
  if(!lastSim) return;
  openModal('balanceModalOverlay');
  renderBalanceModal();
});
document.getElementById('donutPanel').addEventListener('click', () => {
  if(!lastSim) return;
  openModal('donutModalOverlay');
  renderDonutModal();
});
document.getElementById('balanceModalYearSelect').addEventListener('change', renderBalanceModal);
document.getElementById('donutModalYearSelect').addEventListener('change', renderDonutModal);

function statBlock(label, value, sub, colorClass){
  return `<div class="modal-stat"><div class="m-label">${label}</div><div class="m-value${colorClass?' '+colorClass:''}">${value}</div>${sub?`<div class="m-sub">${sub}</div>`:''}</div>`;
}

// ---- Balance & Equity modal ----
function renderBalanceModal(){
  if(!lastSim) return;
  const sel = document.getElementById('balanceModalYearSelect');
  const yearIndex = parseInt(sel.value || '1', 10);
  const { withOP, baseline, propertyValue, withOPGroups, baselineGroups } = lastSim;

  const years = Math.ceil(Math.max(withOP.rows.length, baseline.rows.length)/12);
  const labels = [];
  const balWith = [];
  const balBase = [];
  const equityWith = [];
  for(let y=0;y<=years;y++){
    labels.push('Yr ' + y);
    const idx = Math.min(y*12, withOP.rows.length-1);
    const idxB = Math.min(y*12, baseline.rows.length-1);
    const bw = idx>=0 ? (withOP.rows[idx] ? withOP.rows[idx].balance : 0) : withOP.startBalance;
    const bb = idxB>=0 ? (baseline.rows[idxB] ? baseline.rows[idxB].balance : 0) : baseline.startBalance;
    balWith.push(y===0 ? withOP.startBalance : bw);
    balBase.push(y===0 ? baseline.startBalance : bb);
    equityWith.push(propertyValue - (y===0?withOP.startBalance:bw));
  }
  const data = {
    labels,
    datasets:[
      {label:'Balance (with overpayments)', data: balWith, borderColor:'#0e8f6f', backgroundColor:'rgba(14,143,111,0.08)', fill:true, tension:.3, pointRadius:0, borderWidth:2.5},
      {label:'Balance (baseline, no overpayments)', data: balBase, borderColor:'#e8823a', backgroundColor:'transparent', borderDash:[5,4], fill:false, tension:.3, pointRadius:0, borderWidth:2},
      {label:'Equity', data: equityWith, borderColor:'#e0b23a', backgroundColor:'transparent', tension:.3, pointRadius:0, borderWidth:2}
    ]
  };
  const ctx = document.getElementById('balanceModalChart');
  if(balanceModalChart){
    balanceModalChart.data = data;
    balanceModalChart.update();
  } else {
    balanceModalChart = new Chart(ctx, {
      type:'line',
      data,
      options:{
        responsive:true, maintainAspectRatio:false,
        interaction:{mode:'index', intersect:false},
        plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:11}, usePointStyle:true}}},
        scales:{
          y:{ticks:{callback:v=>'£'+(v/1000)+'k'}, grid:{color:'var(--track-bg)'}},
          x:{grid:{display:false}}
        }
      }
    });
  }

  const group = getGroupByIndex(withOPGroups, yearIndex) || withOPGroups[0];
  const baseGroup = getGroupByIndex(baselineGroups, yearIndex);
  const endBalWith = group.rows[group.rows.length-1].balance;
  const endBalBase = baseGroup ? baseGroup.rows[baseGroup.rows.length-1].balance : endBalWith;
  const equity = propertyValue - endBalWith;
  const lastRow = group.rows[group.rows.length-1];
  const monthlyPmt = lastRow.principal + lastRow.interest;

  const cumThroughWithOP = withOPGroups.slice(0, group.yearIndex).flatMap(g=>g.rows);
  const cumThroughBaseline = baselineGroups.slice(0, group.yearIndex).flatMap(g=>g.rows);
  const cumInterestWith = cumThroughWithOP.reduce((s,r)=>s+r.interest,0);
  const cumInterestBase = cumThroughBaseline.reduce((s,r)=>s+r.interest,0);
  const interestSavedToDate = cumInterestBase - cumInterestWith;
  const cumOverpaid = cumThroughWithOP.reduce((s,r)=>s+r.overpay,0);
  const ltv = propertyValue ? 100*endBalWith/propertyValue : 0;

  const html = [
    statBlock('Calendar year', group.calYear),
    statBlock('Balance (with overpayments)', fmt(endBalWith), 'current plan', 'teal'),
    statBlock('Balance (without overpayments)', fmt(endBalBase), baseGroup ? 'baseline scenario' : 'mortgage already repaid by this point', 'orange'),
    statBlock('Equity', fmt(equity), propertyValue ? pct(100*equity/propertyValue) + ' of property value' : ''),
    statBlock('Loan-to-value', pct(ltv)),
    statBlock('Monthly mortgage payment', fmt(monthlyPmt), 'contractual payment that year, excludes overpayments'),
    statBlock('Interest paid to date', fmt(cumInterestWith)),
    statBlock('Interest saved to date', fmt(Math.max(interestSavedToDate,0)), 'vs. no overpayments'),
    statBlock('Overpaid to date', fmt(cumOverpaid))
  ].join('');
  document.getElementById('balanceModalStats').innerHTML = html;
}

// ---- Where Your Payment Goes modal (cumulative through selected year) ----
function renderDonutModal(){
  if(!lastSim) return;
  const sel = document.getElementById('donutModalYearSelect');
  const yearIndex = parseInt(sel.value || '1', 10);
  const { withOPGroups, propertyValue } = lastSim;

  const group = getGroupByIndex(withOPGroups, yearIndex) || withOPGroups[0];
  const cumRows = withOPGroups.slice(0, group.yearIndex).flatMap(g=>g.rows);
  const p = cumRows.reduce((s,r)=>s+r.principal,0);
  const i = cumRows.reduce((s,r)=>s+r.interest,0);
  const o = cumRows.reduce((s,r)=>s+r.overpay,0);
  const total = p+i+o || 1;
  const endBal = cumRows.length ? cumRows[cumRows.length-1].balance : 0;

  const ddata = {
    labels:['Principal','Interest','Overpayments'],
    datasets:[{data:[p,i,o], backgroundColor:['#0e8f6f','#e8823a','#e0b23a'], borderWidth:0}]
  };
  const dctx = document.getElementById('donutModalChart');
  if(donutModalChart){
    donutModalChart.data = ddata;
    donutModalChart.update();
  } else {
    donutModalChart = new Chart(dctx, {
      type:'doughnut',
      data: ddata,
      options:{cutout:'68%', maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:11}, usePointStyle:true}}, tooltip:{callbacks:{label: c => c.label+': £'+Math.round(c.raw).toLocaleString('en-GB')}}}}
    });
  }

  const html = [
    statBlock('Calendar year', group.calYear),
    statBlock('Cumulative principal paid', fmt(p), pct(100*p/total)+' of total paid', 'teal'),
    statBlock('Cumulative interest paid', fmt(i), pct(100*i/total)+' of total paid', 'orange'),
    statBlock('Cumulative overpayments', fmt(o), pct(100*o/total)+' of total paid'),
    statBlock('Total paid to date', fmt(total)),
    statBlock('Remaining balance', fmt(endBal))
  ].join('');
  document.getElementById('donutModalStats').innerHTML = html;
}

// ---- Year Detail modal (12-month breakdown for a single calendar year) ----
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabelForRow(row){
  if(row.dateOverride){
    return MONTH_NAMES[row.dateOverride.getMonth()] + ' ' + row.dateOverride.getFullYear();
  }
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + (row.month - 1), 1);
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}

document.getElementById('yearDetailYearSelect').addEventListener('change', renderYearDetailModal);

function renderYearDetailModal(){
  if(!lastSim) return;
  const sel = document.getElementById('yearDetailYearSelect');
  const yearIndex = parseInt(sel.value || '1', 10);
  const { withOP, baseline, propertyValue, withOPGroups, baselineGroups } = lastSim;

  const group = getGroupByIndex(withOPGroups, yearIndex) || withOPGroups[0];
  const rows = group.rows;

  const tbody = document.getElementById('yearDetailTableBody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const equity = propertyValue - r.balance;
    const tr = document.createElement('tr');
    if(r.isHistory) tr.style.color = 'var(--muted)';
    const label = monthLabelForRow(r) + (r.isHistory ? ' <span style="font-size:10px;">(est.)</span>' : '');
    tr.innerHTML = `<td>${label}</td><td>${fmt(r.balance)}</td><td>${fmt(equity)}</td><td>${fmt(r.principal)}</td><td>${fmt(r.overpay)}</td><td>${fmt(r.interest)}</td>`;
    tbody.appendChild(tr);
  });

  // Stats for the right panel
  const firstRow = rows[0];
  const lastRow = rows[rows.length-1];
  const startOfYearBalance = (group.historyStartBalance !== undefined)
    ? group.historyStartBalance
    : (firstRow.month > 1 ? withOP.rows[firstRow.month-2].balance : withOP.startBalance);
  const endOfYearBalance = lastRow.balance;
  const startEquity = propertyValue - startOfYearBalance;
  const endEquity = propertyValue - endOfYearBalance;

  const contractualPayments = rows.map(r => r.principal + r.interest);
  const minPmt = Math.min(...contractualPayments);
  const maxPmt = Math.max(...contractualPayments);
  const paymentDisplay = (maxPmt - minPmt < 1) ? fmt(minPmt) : `${fmt(minPmt)} – ${fmt(maxPmt)}`;

  const totalOverpaidThisYear = rows.reduce((s,r)=>s+r.overpay,0);
  const avgTotalMonthlyOutlay = (rows.reduce((s,r)=>s+r.principal+r.interest+r.overpay,0)) / rows.length;
  const interestThisYear = rows.reduce((s,r)=>s+r.interest,0);

  const cumThroughWithOP = withOPGroups.slice(0, group.yearIndex).flatMap(g=>g.rows);
  const cumThroughBaseline = baselineGroups.slice(0, group.yearIndex).flatMap(g=>g.rows);
  const cumInterestWithOP = cumThroughWithOP.reduce((s,r)=>s+r.interest,0);
  const cumInterestBaseline = cumThroughBaseline.reduce((s,r)=>s+r.interest,0);
  const interestSavedCumulative = cumInterestBaseline - cumInterestWithOP;

  const historyMonthCount = rows.filter(r => r.isHistory).length;
  const monthsSubLabel = `${rows.length} month${rows.length!==1?'s':''} shown` + (historyMonthCount ? ` (${historyMonthCount} estimated, before today)` : '');

  const html = [
    statBlock('Calendar year', group.calYear, monthsSubLabel),
    statBlock('Balance: start → end of year', `${fmt(startOfYearBalance)} → ${fmt(endOfYearBalance)}`, '', 'teal'),
    statBlock('Equity: start → end of year', `${fmt(startEquity)} → ${fmt(endEquity)}`, propertyValue ? pct(100*endEquity/propertyValue)+' of property value by year end' : ''),
    statBlock('Monthly mortgage payment', paymentDisplay, 'contractual payment, excludes overpayments'),
    statBlock('Total overpaid this year', fmt(totalOverpaidThisYear)),
    statBlock('Avg. total monthly outlay', fmt(avgTotalMonthlyOutlay), 'payment + overpayment, averaged over the year', 'orange'),
    statBlock('Interest paid this year', fmt(interestThisYear)),
    statBlock('Interest saved to date', fmt(Math.max(interestSavedCumulative,0)), 'vs. no overpayments, cumulative through this year')
  ].join('');
  document.getElementById('yearDetailStats').innerHTML = html;
}

document.querySelectorAll('.panel-head[data-toggle]').forEach(head => {
  head.addEventListener('click', () => {
    const panel = document.getElementById(head.dataset.toggle);
    panel.classList.toggle('collapsed');
  });
});

document.getElementById('remortgageEnabled').addEventListener('change', e => {
  document.getElementById('remortgageFields').style.opacity = e.target.checked ? '1' : '.4';
  document.getElementById('remortgageFields').style.pointerEvents = e.target.checked ? 'auto' : 'none';
  recalc();
});

document.querySelectorAll('#setupSection input:not([data-money="1"]), #setupSection select').forEach(inp => {
  inp.addEventListener('input', recalc);
  inp.addEventListener('change', recalc);
});

document.querySelectorAll('#mortgageDetailsModalOverlay input:not([data-money="1"]), #mortgageDetailsModalOverlay select').forEach(inp => {
  inp.addEventListener('input', recalc);
  inp.addEventListener('change', recalc);
});

document.getElementById('addMortgageBtn').addEventListener('click', () => openModal('mortgageDetailsModalOverlay'));
document.getElementById('editMortgageBtn').addEventListener('click', () => openModal('mortgageDetailsModalOverlay'));
document.getElementById('mortgageDetailsDoneBtn').addEventListener('click', () => {
  closeModal('mortgageDetailsModalOverlay');
  recalc();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  document.querySelectorAll('#setupSection input, #mortgageDetailsModalOverlay input').forEach(inp => inp.value = '');
  document.getElementById('bonusMonth').value = '';
  document.getElementById('startMonth').value = '';
  document.getElementById('remortgageEnabled').checked = false;
  document.getElementById('remortgageFields').style.opacity = '.4';
  document.getElementById('remortgageFields').style.pointerEvents = 'none';
  lumpSums = [];
  renderLumpSumRows();
  remortgages = [];
  renderRemortgageRows();
  closeModal('mortgageDetailsModalOverlay');
  try{ localStorage.removeItem(LS_KEY); }catch(e){}
  recalc();
});

loadFromStorage();
attachMoneyFormatting();
injectClearButtons(document);
renderLumpSumRows();
renderRemortgageRows();
recalc();

// ---- Savings goals ----
const GOAL_ICONS = {
  car: '<path d="M5 17h1a2 2 0 1 0 4 0h4a2 2 0 1 0 4 0h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-.29-.71L18 9l-1.5-3A2 2 0 0 0 14.7 5H9.3a2 2 0 0 0-1.8 1.1L6 9l-2.71 3.29A1 1 0 0 0 3 13v3a1 1 0 0 0 1 1z"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>',
  palm: '<path d="M12 22v-9"/><path d="M12 13c-2-3-6-4-9-2 3 1 5 3 6 5"/><path d="M12 13c2-3 6-4 9-2-3 1-5 3-6 5"/><path d="M12 13c-1-4 0-7 3-9-1 3-1 6 0 9"/><path d="M12 13c1-4 0-7-3-9 1 3 1 6 0 9"/>',
  ring: '<circle cx="9" cy="15" r="4"/><circle cx="15" cy="15" r="4"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/>',
  shield: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/>',
  hammer: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a4 4 0 0 1-5.7 5.7L6 21l-3-3 10.3-10.3a4 4 0 0 1 5.7-5.7l-3.1 3.1z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9"/><path d="M12 8c-1.5-4-6-4-6-1s4 1 6 1zM12 8c1.5-4 6-4 6-1s-4 1-6 1z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  heart: '<path d="M12 21s-7-4.35-9.5-8.5C.5 8.5 3 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 3.5 0 6 3.5 4 7.5C19 16.65 12 21 12 21z"/>',
  star: '<path d="M12 2l3 6.5 7 1-5 5 1.2 7L12 18l-6.2 3.5L7 14.5l-5-5 7-1L12 2z"/>',
  piggy: '<path d="M19 9V7a2 2 0 0 0-2-2h-1.28A5 5 0 0 0 11 3a5 5 0 0 0-4.9 4H5a2 2 0 0 0-2 2v2l-1 1v1h2v3a2 2 0 0 0 2 2h1v2h2v-2h4v2h2v-2.09A5 5 0 0 0 19 13v-1h1v-2z"/><circle cx="15" cy="9" r="1"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  laptop: '<rect x="4" y="4" width="16" height="10" rx="1"/><path d="M2 18h20"/>',
  camera: '<path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  paw: '<circle cx="6" cy="9" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14" cy="6" r="1.8"/><circle cx="18" cy="9" r="1.8"/><path d="M8 14c0-2 2-3 4-3s4 1 4 3c0 2.5-2 4-4 4s-4-1.5-4-4z"/>',
  umbrella: '<path d="M12 2a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M12 11v8a2 2 0 0 1-4 0"/>'
};
function iconSvg(key){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GOAL_ICONS[key] || GOAL_ICONS.star}</svg>`;
}
const GOAL_SUGGESTIONS = [
  {label:'Car', icon:'car'},
  {label:'Holiday', icon:'palm'},
  {label:'Wedding', icon:'heart'},
  {label:'Emergency fund', icon:'shield'},
  {label:'House deposit', icon:'home'},
  {label:'Renovations', icon:'hammer'}
];

let goalDraft = {name:'', icon:'star'};

function renderGoalSuggestions(){
  const wrap = document.getElementById('goalSuggestions');
  wrap.innerHTML = GOAL_SUGGESTIONS.map(s => `
    <div class="goal-suggestion" data-name="${s.label}" data-icon="${s.icon}">
      <div class="icon-circle">${iconSvg(s.icon)}</div>
      <span class="lbl">${s.label}</span>
    </div>`).join('');
  wrap.querySelectorAll('.goal-suggestion').forEach(el => {
    el.addEventListener('click', () => {
      goalDraft.name = el.dataset.name;
      goalDraft.icon = el.dataset.icon;
      document.getElementById('goalCustomName').value = el.dataset.name;
      wrap.querySelectorAll('.goal-suggestion').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      highlightIconPicker();
    });
  });
}

function renderIconPicker(){
  const grid = document.getElementById('iconPickerGrid');
  grid.innerHTML = Object.keys(GOAL_ICONS).map(key => `<button type="button" class="icon-picker-btn" data-icon="${key}">${iconSvg(key)}</button>`).join('');
  grid.querySelectorAll('.icon-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      goalDraft.icon = btn.dataset.icon;
      highlightIconPicker();
    });
  });
}
function highlightIconPicker(){
  document.querySelectorAll('.icon-picker-btn').forEach(b => b.classList.toggle('selected', b.dataset.icon === goalDraft.icon));
}

function renderGoalColorPicker(){
  const grid = document.getElementById('goalColorPickerGrid');
  grid.innerHTML = GOAL_PALETTE.map((c, i) => `<button type="button" class="color-swatch-btn" data-color-index="${i}" style="background:${c.bar};" title="Colour ${i+1}"></button>`).join('');
  grid.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      goalDraft.colorIndex = +btn.dataset.colorIndex;
      highlightGoalColorPicker();
      updateGoalStep2IconPreview();
    });
  });
}
function highlightGoalColorPicker(){
  document.querySelectorAll('#goalColorPickerGrid .color-swatch-btn').forEach(b => b.classList.toggle('selected', +b.dataset.colorIndex === goalDraft.colorIndex));
}
function updateGoalStep2IconPreview(){
  const wrap = document.getElementById('goalStep2IconWrap');
  const c = GOAL_PALETTE[goalDraft.colorIndex % GOAL_PALETTE.length];
  wrap.style.background = c.light;
  wrap.style.color = c.bar;
  wrap.innerHTML = iconSvg(goalDraft.icon);
}

document.getElementById('goalCustomName').addEventListener('input', e => {
  goalDraft.name = e.target.value;
  document.querySelectorAll('.goal-suggestion').forEach(x => x.classList.remove('selected'));
});

function showGoalStep(n){
  document.getElementById('goalStep1').classList.toggle('active', n === 1);
  document.getElementById('goalStep2').classList.toggle('active', n === 2);
}

function openGoalModal(){
  goalDraft = {name:'', icon:'star', colorIndex: nextPaletteIndex % GOAL_PALETTE.length};
  document.getElementById('goalCustomName').value = '';
  document.getElementById('goalAmount').value = '';
  document.querySelectorAll('.goal-suggestion').forEach(x => x.classList.remove('selected'));
  highlightIconPicker();
  highlightGoalColorPicker();
  showGoalStep(1);
  openModal('goalModalOverlay');
}

document.getElementById('goalStep1Next').addEventListener('click', () => {
  const name = document.getElementById('goalCustomName').value.trim();
  if(!name){ document.getElementById('goalCustomName').focus(); return; }
  goalDraft.name = name;
  document.getElementById('goalStep2Name').textContent = goalDraft.name;
  updateGoalStep2IconPreview();
  highlightGoalColorPicker();
  showGoalStep(2);
});
document.getElementById('goalStep2Back').addEventListener('click', () => showGoalStep(1));

document.getElementById('goalAddBtn').addEventListener('click', () => {
  const amount = getNum('goalAmount');
  if(isNaN(amount) || amount <= 0){ document.getElementById('goalAmount').focus(); return; }
  goals.push({id: Date.now(), name: goalDraft.name, icon: goalDraft.icon, amount, paletteIndex: goalDraft.colorIndex});
  nextPaletteIndex++;
  renderGoals();
  closeModal('goalModalOverlay');
});

// ---- Edit existing savings goal (target amount, icon & colour) ----
let editGoalId = null;
let editGoalIcon = 'star';
let editGoalColorIndex = 0;

function renderEditIconPicker(){
  const grid = document.getElementById('editIconPickerGrid');
  grid.innerHTML = Object.keys(GOAL_ICONS).map(key => `<button type="button" class="icon-picker-btn edit-icon-picker-btn" data-icon="${key}">${iconSvg(key)}</button>`).join('');
  grid.querySelectorAll('.edit-icon-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      editGoalIcon = btn.dataset.icon;
      highlightEditIconPicker();
      updateEditGoalIconPreview();
    });
  });
}
function highlightEditIconPicker(){
  document.querySelectorAll('.edit-icon-picker-btn').forEach(b => b.classList.toggle('selected', b.dataset.icon === editGoalIcon));
}

function renderEditColorPicker(){
  const grid = document.getElementById('editColorPickerGrid');
  grid.innerHTML = GOAL_PALETTE.map((c, i) => `<button type="button" class="color-swatch-btn" data-color-index="${i}" style="background:${c.bar};" title="Colour ${i+1}"></button>`).join('');
  grid.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      editGoalColorIndex = +btn.dataset.colorIndex;
      highlightEditColorPicker();
      updateEditGoalIconPreview();
    });
  });
}
function highlightEditColorPicker(){
  document.querySelectorAll('#editColorPickerGrid .color-swatch-btn').forEach(b => b.classList.toggle('selected', +b.dataset.colorIndex === editGoalColorIndex));
}
function updateEditGoalIconPreview(){
  const wrap = document.getElementById('editGoalIconWrap');
  const c = GOAL_PALETTE[editGoalColorIndex % GOAL_PALETTE.length];
  wrap.style.background = c.light;
  wrap.style.color = c.bar;
  wrap.innerHTML = iconSvg(editGoalIcon);
}

function openEditGoalModal(id){
  const g = goals.find(g => g.id === id);
  if(!g) return;
  editGoalId = id;
  editGoalIcon = g.icon;
  editGoalColorIndex = g.paletteIndex % GOAL_PALETTE.length;
  document.getElementById('editGoalName').textContent = g.name;
  document.getElementById('editGoalAmount').value = g.amount.toLocaleString('en-GB');
  updateEditGoalIconPreview();
  highlightEditIconPicker();
  highlightEditColorPicker();
  openModal('editGoalModalOverlay');
}

document.getElementById('editGoalSaveBtn').addEventListener('click', () => {
  const amount = getNum('editGoalAmount');
  if(isNaN(amount) || amount <= 0){ document.getElementById('editGoalAmount').focus(); return; }
  const g = goals.find(g => g.id === editGoalId);
  if(!g) return;
  g.amount = amount;
  g.icon = editGoalIcon;
  g.paletteIndex = editGoalColorIndex;
  renderGoals();
  closeModal('editGoalModalOverlay');
});

renderEditIconPicker();

const GOAL_PALETTE = [
  {bar:'#0e8f6f', light:'#e4f5f0'},
  {bar:'#e8823a', light:'#fbe9dc'},
  {bar:'#c9a227', light:'#f7ecd0'},
  {bar:'#c1503f', light:'#f6e1de'},
  {bar:'#3f6fd1', light:'#e2e9fb'},
  {bar:'#8a4fd1', light:'#ece2fb'},
  {bar:'#d1479f', light:'#fbe2f2'},
  {bar:'#4a9db0', light:'#e0f0f3'}
];
function hexToRgba(hex, alpha){
  const h = hex.replace('#','');
  const full = h.length === 3 ? h.split('').map(c => c+c).join('') : h;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let goalCharts = {};

let viewSelectsInitialized = false;

function populateMonthOptionsForYear(year){
  const monthSelect = document.getElementById('viewMonthSelect');
  const now = new Date();
  const minMonth = (year === now.getFullYear()) ? now.getMonth()+1 : 1;
  const prevValue = monthSelect.value;
  monthSelect.innerHTML = '';
  for(let m = minMonth; m <= 12; m++){
    monthSelect.innerHTML += `<option value="${m}">${MONTH_FULL[m-1]}</option>`;
  }
  monthSelect.value = (prevValue && +prevValue >= minMonth) ? prevValue : String(minMonth);
}

function populateViewAsOfSelects(){
  const yearSelect = document.getElementById('viewYearSelect');
  const now = new Date();
  const prevValue = yearSelect.value;
  yearSelect.innerHTML = '';
  for(let y = now.getFullYear(); y <= now.getFullYear() + 30; y++){
    yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
  }
  if(!viewSelectsInitialized){
    yearSelect.value = String(now.getFullYear());
    viewSelectsInitialized = true;
  } else {
    yearSelect.value = prevValue && +prevValue >= now.getFullYear() ? prevValue : String(now.getFullYear());
  }
  populateMonthOptionsForYear(+yearSelect.value);
}

function getViewDate(){
  const now = new Date();
  const m = +(document.getElementById('viewMonthSelect').value || now.getMonth()+1);
  const y = +(document.getElementById('viewYearSelect').value || now.getFullYear());
  return new Date(y, m-1, 1);
}

// Months between "now" (real today) and a target date, floored at 0
function monthsFromNow(targetDate){
  const now = new Date();
  const nowStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let months = (targetDate.getFullYear()-nowStart.getFullYear())*12 + (targetDate.getMonth()-nowStart.getMonth());
  return Math.max(0, months);
}

// Total planned savings pot at a given number of months from now. Anchored the same way as
// actualPotAtMonths: month 0 already includes everything planned for the current month (matching
// "Planned to date" in Tracking), so planned-pace and actual-pace projections start from the same
// baseline and don't disagree just because of how "now" is defined.
function plannedPotAtMonths(monthsElapsed){
  const startingLump = getNum('startingSavings') || 0;
  const baseline = startingLump + sumPlannedThroughCurrentMonth();
  if(monthsElapsed <= 0) return baseline;
  const now = new Date();
  let pot = baseline;
  for(let i=1;i<=monthsElapsed;i++){
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    pot += plannedSavingsForMonth(d.getMonth()+1);
  }
  return pot;
}

// Generic: finds the month count at which potFn(months) first reaches targetAmount (null if unreachable within 50 years)
function findMonthsToReach(targetAmount, potFn){
  if(potFn(0) >= targetAmount) return 0;
  for(let m=1; m<=600; m++){
    if(potFn(m) >= targetAmount) return m;
  }
  return null;
}

// goal.id -> monthly £ allocated / starting savings £ allocated, set via the split allocation modal

// Returns { saved:[...], completionMonths:[...] } arrays parallel to `goals`, given the mode
function computeGoalAllocations(monthsElapsed){
  const startingLump = getNum('startingSavings') || 0;

  if(goals.length <= 1 || allocationMode === 'split'){
    const n = Math.max(goals.length, 1);
    const totalMonthlyPlanned = goals.length > 1 ? Object.values(splitAllocations).reduce((s,v)=>s+(v||0),0) : (getNum('monthlySavings') || 0);
    const totalStartPlanned = goals.length > 1 ? Object.values(splitStartAllocations).reduce((s,v)=>s+(v||0),0) : startingLump;
    const saved = [];
    const completionMonths = [];
    goals.forEach(g => {
      const monthlyShare = goals.length > 1 ? (splitAllocations[g.id] || 0) : (getNum('monthlySavings') || 0);
      const startShare = goals.length > 1 ? (splitStartAllocations[g.id] || 0) : startingLump;
      const monthlyFrac = totalMonthlyPlanned > 0 ? monthlyShare/totalMonthlyPlanned : (1/n);
      const startFrac = totalStartPlanned > 0 ? startShare/totalStartPlanned : (1/n);
      const potFn = m => {
        const totalPotM = plannedPotAtMonths(m);
        const monthlyAccM = Math.max(totalPotM - startingLump, 0);
        return startFrac*startingLump + monthlyFrac*monthlyAccM;
      };
      saved.push(Math.min(potFn(monthsElapsed), g.amount));
      completionMonths.push(findMonthsToReach(g.amount, potFn));
    });
    return {saved, completionMonths};
  }
  // sequential: fully fund goals in the order they were added
  const totalAtMonths = m => plannedPotAtMonths(m);
  let remaining = totalAtMonths(monthsElapsed);
  const saved = [];
  goals.forEach(g => {
    const amt = Math.min(remaining, g.amount);
    saved.push(amt);
    remaining -= amt;
  });
  let cumTarget = 0;
  const completionMonths = goals.map(g => {
    cumTarget += g.amount;
    return findMonthsToReach(cumTarget, totalAtMonths);
  });
  return {saved, completionMonths};
}

function renderGoals(){
  const grid = document.getElementById('goalsGrid');
  const countTag = document.getElementById('goalsCountTag');
  const viewRow = document.getElementById('viewAsOfRow');
  const allocWrap = document.getElementById('allocationChoiceWrap');
  document.getElementById('panel-monthly-savings').style.display = goals.length ? '' : 'none';
  viewRow.style.display = goals.length ? 'flex' : 'none';
  allocWrap.style.display = goals.length >= 2 ? 'block' : 'none';
  document.getElementById('allocOptSplit').classList.toggle('selected', allocationMode === 'split');
  document.getElementById('allocOptSequential').classList.toggle('selected', allocationMode === 'sequential');
  countTag.innerHTML = goals.length ? `<span style="color:var(--line);margin-right:8px;">|</span>${goals.length} goal${goals.length > 1 ? 's' : ''}` : '';

  if(!goals.length){
    Object.values(goalCharts).forEach(c => c.destroy());
    goalCharts = {};
    grid.innerHTML = `<div class="empty-note">You haven't added any savings goals yet. Use "Add a savings goal" above to get started.</div>`;
    saveToStorage();
    updateTrackingDynamic();
    return;
  }

  populateViewAsOfSelects();
  const viewDate = getViewDate();
  const monthsElapsed = monthsFromNow(viewDate);
  const now = new Date();
  document.getElementById('viewPrevBtn').disabled = (viewDate.getFullYear() === now.getFullYear() && viewDate.getMonth() === now.getMonth());
  const { completionMonths: plannedCompletionArr } = computeGoalAllocations(monthsElapsed);
  const { saved: savedArr, completionMonths: actualCompletionArr } = computeGoalAllocationsActual(monthsElapsed);

  grid.innerHTML = goals.map((g, idx) => {
    const palette = GOAL_PALETTE[g.paletteIndex % GOAL_PALETTE.length];
    const saved = savedArr[idx];
    const remaining = Math.max(g.amount - saved, 0);
    const pctVal = g.amount > 0 ? Math.round((saved/g.amount)*100) : 0;
    const isComplete = saved >= g.amount;

    function labelFor(months){
      if(months === null || months === undefined) return 'Add monthly savings to estimate';
      const n = new Date();
      const cDate = new Date(n.getFullYear(), n.getMonth()+months, 1);
      return MONTH_SHORT[cDate.getMonth()] + ' ' + cDate.getFullYear();
    }
    const plannedLabel = labelFor(plannedCompletionArr[idx]);
    const actualLabel = labelFor(actualCompletionArr[idx]);
    const actualPaceIsEstimated = !hasAnyActualLogged();
    const actualPaceSub = actualPaceIsEstimated ? '<div class="m-sub">estimated from your plan \u2014 log savings in Tracking for a real figure</div>' : '';

    const isFirst = idx === 0;
    const isLast = idx === goals.length - 1;
    const reorderControls = allocationMode === 'sequential' ? `
        <div class="reorder-controls">
          <button class="reorder-btn" data-id="${g.id}" data-dir="up" title="Move up" ${isFirst ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
          </button>
          <button class="reorder-btn" data-id="${g.id}" data-dir="down" title="Move down" ${isLast ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>` : '';

    return `
    <div class="goal-panel" data-id="${g.id}">
      <div class="goal-panel-head" style="background:${palette.bar};">
        ${reorderControls}
        <div class="icon-circle-white">${iconSvg(g.icon)}</div>
        <h3>${g.name} Progress</h3>
        <button class="edit-goal-panel" data-id="${g.id}" title="Edit goal" aria-label="Edit goal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button class="rm-goal-panel" data-id="${g.id}" title="Remove goal">&times;</button>
      </div>
      <div class="goal-panel-body">
        <div class="goal-donut-wrap">
          <div class="goal-donut-canvas-wrap">
            <canvas id="goalDonut-${g.id}"></canvas>
            <div class="goal-donut-pct">${pctVal}%</div>
          </div>
          <div class="goal-donut-caption">${g.name} progress</div>
        </div>
        <div class="goal-stats">
          <div class="modal-stat"><div class="m-label">Target</div><div class="m-value">${fmt(g.amount)}</div></div>
          <div class="modal-stat"><div class="m-label">Saved so far <span style="text-transform:none;font-weight:500;">(actual)</span></div><div class="m-value" style="color:${palette.bar};">${fmt(saved)}</div></div>
          <div class="modal-stat"><div class="m-label">Remaining</div><div class="m-value" style="color:${hexToRgba(palette.bar, 0.55)};">${fmt(remaining)}</div></div>
          <div class="modal-stat"><div class="m-label">Status</div><div class="m-value" style="color:${isComplete ? 'var(--teal-dark)' : 'var(--text)'};">${isComplete ? 'Complete' : 'Incomplete'}</div></div>
          <div class="modal-stat"><div class="m-label">Completion (planned pace)</div><div class="m-value" style="font-size:15px;">${plannedLabel}</div></div>
          <div class="modal-stat"><div class="m-label">Completion (actual pace)</div><div class="m-value" style="font-size:15px;">${actualLabel}</div>${actualPaceSub}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  goals.forEach((g, idx) => {
    const palette = GOAL_PALETTE[g.paletteIndex % GOAL_PALETTE.length];
    const saved = savedArr[idx];
    const remaining = Math.max(g.amount - saved, 0);
    const ctx = document.getElementById(`goalDonut-${g.id}`);
    const data = { datasets:[{ data:[saved, remaining], backgroundColor:[palette.bar, palette.light], borderWidth:0 }] };
    if(goalCharts[g.id]){
      goalCharts[g.id].destroy();
    }
    goalCharts[g.id] = new Chart(ctx, {
      type:'doughnut',
      data,
      options:{
        cutout:'74%', maintainAspectRatio:true, aspectRatio:1,
        plugins:{legend:{display:false}, tooltip:{callbacks:{label: c => (c.dataIndex===0?'Saved: ':'Remaining: ')+'£'+Math.round(c.raw).toLocaleString('en-GB')}}}
      }
    });
  });

  // drop chart references for goals that no longer exist
  Object.keys(goalCharts).forEach(id => {
    if(!goals.some(g => String(g.id) === id)) delete goalCharts[id];
  });

  grid.querySelectorAll('.rm-goal-panel').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = +btn.dataset.id;
      goals = goals.filter(g => g.id !== id);
      if(goals.length === 0){
        trackingActuals = {};
        trackingStartYear = null;
        trackingStartMonth = null;
        trackingWindowMonths = 36;
        renderTrackingTable();
      }
      renderGoals();
    });
  });

  grid.querySelectorAll('.edit-goal-panel').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = +btn.dataset.id;
      openEditGoalModal(id);
    });
  });

  grid.querySelectorAll('.reorder-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if(btn.disabled) return;
      const id = +btn.dataset.id;
      const dir = btn.dataset.dir;
      moveGoal(id, dir);
    });
  });
  saveToStorage();
  updateTrackingDynamic();
}

function moveGoal(id, dir){
  const idx = goals.findIndex(g => g.id === id);
  if(idx === -1) return;
  const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
  if(targetIdx < 0 || targetIdx >= goals.length) return;
  [goals[idx], goals[targetIdx]] = [goals[targetIdx], goals[idx]];
  renderGoals();
}

// ---- Savings Tracking: month-by-month actual vs. projected ----
function fmtSigned(n){
  const sign = n < 0 ? '-' : '+';
  return sign + '£' + Math.round(Math.abs(n)).toLocaleString('en-GB');
}

// Returns the effective bonus amount/month, or zero/none if the toggle is off
function getBonusSavingsInputs(){
  const enabled = document.getElementById('bonusSavingsEnabled').checked;
  return {
    amount: enabled ? (getNum('annualBonusSavings') || 0) : 0,
    month: enabled ? (+document.getElementById('bonusSavingsMonth').value || null) : null
  };
}

function plannedSavingsForMonth(month){
  const monthly = getNum('monthlySavings') || 0;
  const bonus = getBonusSavingsInputs();
  return monthly + (bonus.month === month ? bonus.amount : 0);
}

function ensureTrackingStart(){
  if(trackingStartYear === null || trackingStartMonth === null){
    const now = new Date();
    trackingStartYear = now.getFullYear();
    trackingStartMonth = now.getMonth() + 1;
  }
}

function trackingKey(year, month){ return year + '-' + month; }

// Sum of logged actual amounts from tracking start through the current real month (inclusive).
// Missing/blank months count as £0.
function sumActualThroughCurrentMonth(){
  ensureTrackingStart();
  const now = new Date();
  const nowKey = new Date(now.getFullYear(), now.getMonth(), 1);
  let sum = 0;
  let d = new Date(trackingStartYear, trackingStartMonth - 1, 1);
  while(d <= nowKey){
    const v = trackingActuals[trackingKey(d.getFullYear(), d.getMonth()+1)];
    sum += (v !== undefined && v !== null && v !== '') ? (+v || 0) : 0;
    d = new Date(d.getFullYear(), d.getMonth()+1, 1);
  }
  return sum;
}

// True if the user has logged at least one real actual-savings entry from tracking start
// through the current real month (inclusive).
function hasAnyActualLogged(){
  ensureTrackingStart();
  const now = new Date();
  const nowKey = new Date(now.getFullYear(), now.getMonth(), 1);
  let d = new Date(trackingStartYear, trackingStartMonth - 1, 1);
  while(d <= nowKey){
    const v = trackingActuals[trackingKey(d.getFullYear(), d.getMonth()+1)];
    if(v !== undefined && v !== null && v !== '') return true;
    d = new Date(d.getFullYear(), d.getMonth()+1, 1);
  }
  return false;
}

function averageActualMonthlyRate(){
  ensureTrackingStart();
  // No tracking history logged yet — fall back to the planned monthly savings rate so
  // "actual pace" projections have something sensible to work with, rather than assuming £0.
  if(!hasAnyActualLogged()){
    return getNum('monthlySavings') || 0;
  }
  const now = new Date();
  const elapsed = (now.getFullYear()-trackingStartYear)*12 + (now.getMonth()-(trackingStartMonth-1)) + 1;
  const sum = sumActualThroughCurrentMonth();
  return elapsed > 0 ? sum/elapsed : 0;
}

// Cumulative planned pot through the current real month (inclusive), using the plan assumptions.
function sumPlannedThroughCurrentMonth(){
  ensureTrackingStart();
  const now = new Date();
  const nowKey = new Date(now.getFullYear(), now.getMonth(), 1);
  let sum = 0;
  let d = new Date(trackingStartYear, trackingStartMonth - 1, 1);
  while(d <= nowKey){
    sum += plannedSavingsForMonth(d.getMonth()+1);
    d = new Date(d.getFullYear(), d.getMonth()+1, 1);
  }
  return sum;
}

// Total actual-based pot (starting savings + real logged monthly amounts), at `monthsElapsed`
// months from now. For the past/present (<=0) this is purely real data. For the future,
// it extrapolates using an explicit logged entry if present for that month; otherwise it uses
// the average actual monthly rate observed so far, plus the recurring bonus in its scheduled
// month (the bonus is a known future event, not something to derive from past averages).
function actualPotAtMonths(monthsElapsed){
  const startingLump = getNum('startingSavings') || 0;
  const baseline = startingLump + sumActualThroughCurrentMonth();
  if(monthsElapsed <= 0) return baseline;
  const avgRate = averageActualMonthlyRate();
  const bonus = getBonusSavingsInputs();
  const now = new Date();
  let pot = baseline;
  for(let i=1;i<=monthsElapsed;i++){
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    const override = trackingActuals[trackingKey(d.getFullYear(), d.getMonth()+1)];
    if(override !== undefined && override !== null && override !== ''){
      pot += (+override || 0);
    } else {
      pot += avgRate + (bonus.month === (d.getMonth()+1) ? bonus.amount : 0);
    }
  }
  return pot;
}

// Mirrors computeGoalAllocations(), but driven by real tracked savings instead of the plan.
function computeGoalAllocationsActual(monthsElapsed){
  const startingLump = getNum('startingSavings') || 0;

  if(goals.length <= 1 || allocationMode === 'split'){
    const n = Math.max(goals.length, 1);
    const totalMonthlyPlanned = goals.length > 1 ? Object.values(splitAllocations).reduce((s,v)=>s+(v||0),0) : (getNum('monthlySavings') || 0);
    const totalStartPlanned = goals.length > 1 ? Object.values(splitStartAllocations).reduce((s,v)=>s+(v||0),0) : startingLump;
    const saved = [];
    const completionMonths = [];
    goals.forEach(g => {
      const monthlyShare = goals.length > 1 ? (splitAllocations[g.id] || 0) : (getNum('monthlySavings') || 0);
      const startShare = goals.length > 1 ? (splitStartAllocations[g.id] || 0) : startingLump;
      const monthlyFrac = totalMonthlyPlanned > 0 ? monthlyShare/totalMonthlyPlanned : (1/n);
      const startFrac = totalStartPlanned > 0 ? startShare/totalStartPlanned : (1/n);
      const potFn = m => {
        const totalPotM = actualPotAtMonths(m);
        const monthlyAccM = Math.max(totalPotM - startingLump, 0);
        return startFrac*startingLump + monthlyFrac*monthlyAccM;
      };
      saved.push(Math.min(potFn(monthsElapsed), g.amount));
      completionMonths.push(findMonthsToReach(g.amount, potFn));
    });
    return {saved, completionMonths};
  }

  const totalAtMonths = m => actualPotAtMonths(m);
  let remaining = totalAtMonths(monthsElapsed);
  const saved = [];
  goals.forEach(g => {
    const amt = Math.min(remaining, g.amount);
    saved.push(amt);
    remaining -= amt;
  });
  let cumTarget = 0;
  const completionMonths = goals.map(g => {
    cumTarget += g.amount;
    return findMonthsToReach(cumTarget, totalAtMonths);
  });
  return {saved, completionMonths};
}

function switchSavingsTab(tab){
  const isGoals = tab === 'goals';
  document.getElementById('goalsTabPanel').style.display = isGoals ? '' : 'none';
  document.getElementById('trackingTabPanel').style.display = isGoals ? 'none' : '';
  document.getElementById('subtabGoalsBtn').classList.toggle('active', isGoals);
  document.getElementById('subtabTrackingBtn').classList.toggle('active', !isGoals);
  if(!isGoals) updateTrackingDynamic();
}
document.getElementById('subtabGoalsBtn').addEventListener('click', () => switchSavingsTab('goals'));
document.getElementById('subtabTrackingBtn').addEventListener('click', () => switchSavingsTab('tracking'));

document.getElementById('trackingShowMoreBtn').addEventListener('click', () => {
  trackingWindowMonths += 12;
  renderTrackingTable();
  saveToStorage();
});

function toggleTrackingVisibility(){
  const emptyNote = document.getElementById('trackingEmptyNote');
  const content = document.getElementById('trackingTabContent');
  const show = goals.length > 0;
  emptyNote.style.display = show ? 'none' : 'block';
  content.style.display = show ? 'block' : 'none';
  return show;
}

// Builds the row skeleton (labels + inputs). Only call this when the row structure itself
// needs to change (initial load, extending the window) — never on every keystroke, since
// rebuilding the <input> elements would wipe whatever the user is currently typing.
function renderTrackingTable(){
  toggleTrackingVisibility();
  ensureTrackingStart();

  const now = new Date();
  const nowKey = trackingKey(now.getFullYear(), now.getMonth()+1);
  const tbody = document.getElementById('trackingTableBody');
  tbody.innerHTML = '';

  let d = new Date(trackingStartYear, trackingStartMonth - 1, 1);
  for(let i=0;i<trackingWindowMonths;i++){
    const y = d.getFullYear(), m = d.getMonth()+1;
    const key = trackingKey(y, m);
    const isToday = key === nowKey;
    const actualVal = trackingActuals[key];
    const hasActual = actualVal !== undefined && actualVal !== null && actualVal !== '';

    const tr = document.createElement('tr');
    tr.dataset.rowKey = key;
    if(isToday) tr.style.background = 'var(--teal-pale)';
    tr.innerHTML = `
      <td>${MONTH_SHORT[m-1]} ${y}${isToday ? ' <span class="muted-tag" style="margin-left:4px;">Today</span>' : ''}</td>
      <td class="col-projtotal"></td>
      <td class="col-projected"></td>
      <td>
        <div class="field" style="margin:0;max-width:150px;">
          <div class="prefix-wrap"><span class="prefix">£</span><input type="text" inputmode="numeric" data-money="1" data-key="${key}" value="${hasActual ? (+actualVal).toLocaleString('en-GB') : ''}" placeholder="0"></div>
        </div>
      </td>
      <td class="col-variance"></td>
      <td class="col-milestone"><div class="milestone-cell"></div></td>
    `;
    tbody.appendChild(tr);
    d = new Date(d.getFullYear(), d.getMonth()+1, 1);
  }

  tbody.querySelectorAll('input[data-key]').forEach(inp => {
    inp.addEventListener('input', e => {
      const cursorFromEnd = e.target.value.length - e.target.selectionStart;
      e.target.value = formatMoneyValue(e.target.value, true);
      const pos = Math.max(0, e.target.value.length - cursorFromEnd);
      e.target.setSelectionRange(pos, pos);
      const key = e.target.dataset.key;
      const raw = e.target.value.replace(/,/g,'');
      trackingActuals[key] = (raw === '' || raw === '-') ? null : (+raw || 0);
      saveToStorage();
      updateTrackingDynamic();
      renderGoals();
    });
  });
  injectClearButtons(tbody);

  updateTrackingDynamic();
}

// Maps "y-m" tracking keys to the goal(s) whose actual-pace projection completes that month.
// Uses computeGoalAllocationsActual's completionMonths, which are anchored to "now" regardless
// of the monthsElapsed argument passed in, so 0 is fine here as a throwaway view date.
function getActualCompletionsByMonth(){
  const map = {};
  if(!goals.length) return map;
  const { completionMonths } = computeGoalAllocationsActual(0);
  const now = new Date();
  goals.forEach((g, idx) => {
    const months = completionMonths[idx];
    if(months === null || months === undefined) return;
    const d = new Date(now.getFullYear(), now.getMonth()+months, 1);
    const key = trackingKey(d.getFullYear(), d.getMonth()+1);
    if(!map[key]) map[key] = [];
    map[key].push(g);
  });
  return map;
}

// Refreshes summary stats, the banner, and the per-row Projected/Projected Total/Variance
// cells — WITHOUT touching the <input> elements, so it's safe to call on every keystroke
// or whenever monthlySavings/goals change without disrupting whatever's being typed.
function updateTrackingDynamic(){
  if(!toggleTrackingVisibility()){ saveToStorage(); return; }
  ensureTrackingStart();
  const now = new Date();
  const startingLump = getNum('startingSavings') || 0;

  const actualToDate = startingLump + sumActualThroughCurrentMonth();
  const plannedToDate = startingLump + sumPlannedThroughCurrentMonth();
  const variance = actualToDate - plannedToDate;
  const avgRate = averageActualMonthlyRate();

  document.getElementById('trkActualToDate').textContent = fmt(actualToDate);
  document.getElementById('trkActualToDateSub').textContent = `as of ${MONTH_FULL[now.getMonth()]} ${now.getFullYear()}`;
  document.getElementById('trkPlannedToDate').textContent = fmt(plannedToDate);
  const varEl = document.getElementById('trkVariance');
  varEl.textContent = fmtSigned(variance);
  varEl.style.color = variance >= 0 ? 'var(--teal-dark)' : 'var(--red)';
  document.getElementById('trkAvgRate').textContent = fmt(avgRate);

  const banner = document.getElementById('trackingBanner');
  if(variance < -1){
    banner.style.display = 'block';
    banner.className = 'banner warn';
    banner.innerHTML = `<b>You're falling behind plan.</b> You've saved ${fmt(Math.abs(variance))} less than planned so far. Your goals below reflect this real progress — consider increasing your monthly savings or adjusting your goal amounts.`;
  } else if(variance > 1){
    banner.style.display = 'block';
    banner.className = 'banner';
    banner.innerHTML = `<b>Nice work.</b> You're ${fmt(variance)} ahead of your savings plan so far.`;
  } else {
    banner.style.display = 'none';
  }

  const tbody = document.getElementById('trackingTableBody');
  const milestoneMap = getActualCompletionsByMonth();
  const nowKeyForMilestones = trackingKey(now.getFullYear(), now.getMonth()+1);
  let cumProjected = startingLump;
  let d = new Date(trackingStartYear, trackingStartMonth - 1, 1);
  for(let i=0;i<trackingWindowMonths;i++){
    const y = d.getFullYear(), m = d.getMonth()+1;
    const key = trackingKey(y, m);
    const planned = plannedSavingsForMonth(m);
    cumProjected += planned;

    const row = tbody.querySelector(`tr[data-row-key="${key}"]`);
    if(row){
      const actualVal = trackingActuals[key];
      const hasActual = actualVal !== undefined && actualVal !== null && actualVal !== '';
      const varianceText = hasActual ? fmtSigned((+actualVal||0) - planned) : '—';
      const varianceColor = hasActual ? ((+actualVal||0) - planned >= 0 ? 'var(--teal-dark)' : 'var(--red)') : 'var(--muted)';

      row.querySelector('.col-projtotal').textContent = fmt(cumProjected);
      row.querySelector('.col-projected').textContent = fmt(planned);
      const varCell = row.querySelector('.col-variance');
      varCell.textContent = varianceText;
      varCell.style.color = varianceColor;

      const completedGoals = milestoneMap[key] || [];
      const milestoneCell = row.querySelector('.milestone-cell');
      if(completedGoals.length){
        milestoneCell.innerHTML = completedGoals.map(g => {
          const palette = GOAL_PALETTE[g.paletteIndex % GOAL_PALETTE.length];
          return `<span class="tracking-goal-badge" style="background:${palette.bar};">${iconSvg(g.icon)}${g.name}</span>`;
        }).join('');
        if(completedGoals.length === 1){
          const palette = GOAL_PALETTE[completedGoals[0].paletteIndex % GOAL_PALETTE.length];
          row.style.background = hexToRgba(palette.bar, 0.12);
        } else {
          const share = 100/completedGoals.length;
          const stops = completedGoals.map((g, gi) => {
            const palette = GOAL_PALETTE[g.paletteIndex % GOAL_PALETTE.length];
            const from = Math.round(gi*share), to = Math.round((gi+1)*share);
            return `${hexToRgba(palette.bar, 0.16)} ${from}%, ${hexToRgba(palette.bar, 0.16)} ${to}%`;
          }).join(', ');
          row.style.background = `linear-gradient(90deg, ${stops})`;
        }
      } else {
        milestoneCell.innerHTML = '';
        row.style.background = (key === nowKeyForMilestones) ? 'var(--teal-pale)' : '';
      }

      const inp = row.querySelector('input[data-key]');
      if(inp && document.activeElement !== inp){
        inp.value = hasActual ? (+actualVal).toLocaleString('en-GB') : '';
      }
    }
    d = new Date(d.getFullYear(), d.getMonth()+1, 1);
  }

  saveToStorage();
}


document.getElementById('addGoalBtn').addEventListener('click', openGoalModal);
document.getElementById('bonusSavingsEnabled').addEventListener('change', e => {
  document.getElementById('bonusSavingsFields').style.opacity = e.target.checked ? '1' : '.4';
  document.getElementById('bonusSavingsFields').style.pointerEvents = e.target.checked ? 'auto' : 'none';
  renderGoals();
});
document.getElementById('viewMonthSelect').addEventListener('change', renderGoals);
document.getElementById('viewYearSelect').addEventListener('change', renderGoals);

function shiftViewMonth(delta){
  const yearSelect = document.getElementById('viewYearSelect');
  const monthSelect = document.getElementById('viewMonthSelect');
  let y = +yearSelect.value;
  let m = +monthSelect.value + delta;
  if(m < 1){ m = 12; y -= 1; }
  if(m > 12){ m = 1; y += 1; }
  const now = new Date();
  const minDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const maxYear = now.getFullYear() + 30;
  const newDate = new Date(y, m-1, 1);
  if(newDate < minDate || y > maxYear) return;
  yearSelect.value = String(y);
  populateMonthOptionsForYear(y);
  monthSelect.value = String(m);
  renderGoals();
}
document.getElementById('viewPrevBtn').addEventListener('click', () => shiftViewMonth(-1));
document.getElementById('viewNextBtn').addEventListener('click', () => shiftViewMonth(1));
document.getElementById('viewResetBtn').addEventListener('click', () => {
  const now = new Date();
  const yearSelect = document.getElementById('viewYearSelect');
  yearSelect.value = String(now.getFullYear());
  populateMonthOptionsForYear(now.getFullYear());
  document.getElementById('viewMonthSelect').value = String(now.getMonth()+1);
  renderGoals();
});
document.getElementById('allocOptSplit').addEventListener('click', openSplitAllocationModal);
document.getElementById('allocOptSequential').addEventListener('click', () => { allocationMode = 'sequential'; renderGoals(); });

function openSplitAllocationModal(){
  const monthly = getNum('monthlySavings') || 0;
  const startTotal = getNum('startingSavings') || 0;
  document.getElementById('splitMonthlyDisplay').value = fmt(monthly);
  document.getElementById('splitStartDisplay').value = fmt(startTotal);

  const n = goals.length;
  const evenMonthlyShare = n > 0 ? monthly / n : 0;
  const evenStartShare = n > 0 ? startTotal / n : 0;
  const list = document.getElementById('splitAllocationList');
  list.innerHTML = goals.map(g => {
    const existingMonthly = splitAllocations[g.id];
    const monthlyVal = (existingMonthly !== undefined ? existingMonthly : Math.round(evenMonthlyShare));
    const existingStart = splitStartAllocations[g.id];
    const startVal = (existingStart !== undefined ? existingStart : Math.round(evenStartShare));
    return `
    <div class="overpay-row" style="justify-content:space-between;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:9px;flex:1 1 140px;">
        <div class="icon-circle" style="width:30px;height:30px;border-radius:9px;background:var(--teal-pale);color:var(--teal-dark);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${iconSvg(g.icon)}</div>
        <span style="font-size:13.5px;font-weight:600;">${g.name}</span>
      </div>
      <div style="display:flex;gap:10px;">
        <div class="field" style="max-width:115px;">
          <label>Monthly</label>
          <div class="prefix-wrap"><span class="prefix">£</span><input type="text" inputmode="numeric" class="split-alloc-input" data-type="monthly" data-id="${g.id}" data-money="1" value="${monthlyVal ? monthlyVal.toLocaleString('en-GB') : ''}"></div>
        </div>
        <div class="field" style="max-width:115px;">
          <label>Starting</label>
          <div class="prefix-wrap"><span class="prefix">£</span><input type="text" inputmode="numeric" class="split-alloc-input" data-type="start" data-id="${g.id}" data-money="1" value="${startVal ? startVal.toLocaleString('en-GB') : ''}"></div>
        </div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.split-alloc-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const cursorFromEnd = e.target.value.length - e.target.selectionStart;
      e.target.value = formatMoneyValue(e.target.value);
      const pos = Math.max(0, e.target.value.length - cursorFromEnd);
      e.target.setSelectionRange(pos, pos);
      updateSplitAllocationBanner();
    });
  });
  injectClearButtons(list);

  updateSplitAllocationBanner();
  openModal('splitAllocationModalOverlay');
}

function getSplitAllocationTotal(type){
  let total = 0;
  document.querySelectorAll(`.split-alloc-input[data-type="${type}"]`).forEach(inp => {
    total += +inp.value.replace(/,/g,'') || 0;
  });
  return total;
}

function updateSplitAllocationBanner(isError){
  const monthly = getNum('monthlySavings') || 0;
  const startTotal = getNum('startingSavings') || 0;
  const monthlyTotal = getSplitAllocationTotal('monthly');
  const startAllocTotal = getSplitAllocationTotal('start');
  const monthlyPct = monthly > 0 ? Math.round((monthlyTotal/monthly)*1000)/10 : 100;
  const startPct = startTotal > 0 ? Math.round((startAllocTotal/startTotal)*1000)/10 : 100;
  const banner = document.getElementById('splitAllocationBanner');
  if(isError){
    banner.className = 'banner warn';
    banner.innerHTML = `<b>${monthlyPct}% of monthly savings</b> and <b>${startPct}% of starting savings</b> allocated. Please allocate exactly 100% of both before continuing.`;
  } else {
    banner.className = 'banner neutral';
    banner.innerHTML = `<b>${monthlyPct}% of monthly savings</b> and <b>${startPct}% of starting savings</b> allocated.`;
  }
  return {monthlyPct, startPct};
}

document.getElementById('splitAllocationDoneBtn').addEventListener('click', () => {
  const {monthlyPct, startPct} = updateSplitAllocationBanner();
  if(Math.round(monthlyPct) !== 100 || Math.round(startPct) !== 100){
    updateSplitAllocationBanner(true);
    return;
  }
  document.querySelectorAll('.split-alloc-input[data-type="monthly"]').forEach(inp => {
    splitAllocations[+inp.dataset.id] = +inp.value.replace(/,/g,'') || 0;
  });
  document.querySelectorAll('.split-alloc-input[data-type="start"]').forEach(inp => {
    splitStartAllocations[+inp.dataset.id] = +inp.value.replace(/,/g,'') || 0;
  });
  allocationMode = 'split';
  closeModal('splitAllocationModalOverlay');
  renderGoals();
});
document.querySelectorAll('#panel-monthly-savings input, #panel-monthly-savings select').forEach(el => {
  el.addEventListener('input', renderGoals);
  el.addEventListener('change', renderGoals);
});

document.getElementById('todayDateDisplay').value = new Date().toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'});

renderGoalSuggestions();
renderIconPicker();
renderGoalColorPicker();
renderEditColorPicker();
populateViewAsOfSelects();
renderTrackingTable();
renderGoals();

// ---- Sidebar view switching (Mortgage Overpayment / Mortgage Calculator / Savings) ----
const overpayMain = document.getElementById('overpayView');
const calculatorMain = document.getElementById('calculatorView');
const savingsMain = document.getElementById('savingsView');
const navMortgageToggle = document.getElementById('navMortgageToggle');
const mortgageSubmenu = document.getElementById('mortgageSubmenu');
const navMortgageCalcBtn = document.getElementById('navMortgageCalc');
const navMortgageOverpayBtn = document.getElementById('navMortgageOverpay');
const navSavingsBtn = document.getElementById('navSavings');

function showView(view){
  overpayMain.style.display = view === 'overpay' ? '' : 'none';
  calculatorMain.style.display = view === 'calculator' ? 'flex' : 'none';
  savingsMain.style.display = view === 'savings' ? 'flex' : 'none';

  const isMortgage = view === 'overpay' || view === 'calculator';
  navMortgageToggle.classList.toggle('active', isMortgage);
  navSavingsBtn.classList.toggle('active', view === 'savings');
  navMortgageOverpayBtn.classList.toggle('active', view === 'overpay');
  navMortgageCalcBtn.classList.toggle('active', view === 'calculator');

  if(isMortgage) openMortgageSubmenu();
  if(view === 'calculator') calcRecalc();
}

function openMortgageSubmenu(){
  mortgageSubmenu.classList.add('open');
  navMortgageToggle.setAttribute('aria-expanded', 'true');
}
function closeMortgageSubmenu(){
  mortgageSubmenu.classList.remove('open');
  navMortgageToggle.setAttribute('aria-expanded', 'false');
}
navMortgageToggle.addEventListener('click', () => {
  if(mortgageSubmenu.classList.contains('open')) closeMortgageSubmenu();
  else openMortgageSubmenu();
});
navMortgageCalcBtn.addEventListener('click', () => { showView('calculator'); closeSidebar(); });
navMortgageOverpayBtn.addEventListener('click', () => { showView('overpay'); closeSidebar(); });
navSavingsBtn.addEventListener('click', () => { showView('savings'); closeSidebar(); });

