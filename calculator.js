// ---- Mortgage Calculator (standalone) ----

// Deposit £ / % toggle — converts the current amount so switching modes doesn't lose the value
const depositModeSwitch = document.getElementById('calcDepositIsPercent');
depositModeSwitch.addEventListener('change', () => {
  const propertyValue = getNum('calcPropertyValue') || 0;
  const isPercent = depositModeSwitch.checked;
  if(isPercent){
    const currentValue = getNum('calcDepositValue') || 0;
    const pct = propertyValue > 0 ? (currentValue/propertyValue*100) : 0;
    document.getElementById('calcDepositPct').value = pct ? (Math.round(pct*10)/10) : '';
  } else {
    const currentPct = getNum('calcDepositPct') || 0;
    const val = propertyValue * currentPct/100;
    document.getElementById('calcDepositValue').value = val ? Math.round(val).toLocaleString('en-GB') : '';
  }
  document.getElementById('calcDepositValueWrap').style.display = isPercent ? 'none' : 'block';
  document.getElementById('calcDepositPctWrap').style.display = isPercent ? 'block' : 'none';
  calcRecalc();
});

function calcGetDepositAmount(propertyValue){
  if(depositModeSwitch.checked){
    const pct = getNum('calcDepositPct');
    return isNaN(pct) ? NaN : propertyValue * pct/100;
  }
  return getNum('calcDepositValue');
}

// UK SDLT (England & Northern Ireland) residential rate bands, effective from April 2025.
// Each entry: [lowerBound, upperBound, rate]. upperBound of Infinity for the top band.
const SDLT_BANDS = {
  next: [
    [0, 125000, 0.00],
    [125000, 250000, 0.02],
    [250000, 925000, 0.05],
    [925000, 1500000, 0.10],
    [1500000, Infinity, 0.12]
  ],
  additional: [
    [0, 125000, 0.05],
    [125000, 250000, 0.07],
    [250000, 925000, 0.10],
    [925000, 1500000, 0.15],
    [1500000, Infinity, 0.17]
  ],
  firstTimeBuyer: [
    [0, 300000, 0.00],
    [300000, 500000, 0.05]
  ]
};

// Returns {tax, breakdown:[{from, to, rate, amount}]}. First-time buyer relief only applies
// up to £500,000 — above that, standard "next home" rates apply to the whole price.
function calculateStampDuty(price, buyerType){
  let bands;
  if(buyerType === 'first'){
    bands = price <= 500000 ? SDLT_BANDS.firstTimeBuyer : SDLT_BANDS.next;
  } else if(buyerType === 'additional'){
    bands = SDLT_BANDS.additional;
  } else {
    bands = SDLT_BANDS.next;
  }

  let tax = 0;
  const breakdown = [];
  bands.forEach(([lower, upper, rate]) => {
    if(price > lower){
      const taxable = Math.min(price, upper) - lower;
      const amount = taxable * rate;
      tax += amount;
      if(taxable > 0){
        breakdown.push({from: lower, to: Math.min(price, upper), rate, amount});
      }
    }
  });
  return {tax, breakdown};
}

function calcRecalc(){
  const propertyValue = getNum('calcPropertyValue');
  const rate = getNum('calcRate');
  const term = getNum('calcTerm');
  const deposit = calcGetDepositAmount(propertyValue || 0);
  const loanAmount = (!isNaN(propertyValue) && !isNaN(deposit)) ? Math.max(propertyValue - deposit, 0) : NaN;

  document.getElementById('calcLoanAmountDisplay').value = !isNaN(loanAmount) ? fmt(loanAmount) : '';

  const valid = !isNaN(loanAmount) && loanAmount > 0 && !isNaN(rate) && rate >= 0 && !isNaN(term) && term > 0;

  document.getElementById('calcEmptyNote').style.display = valid ? 'none' : 'block';

  if(!valid){
    document.getElementById('calcMonthlyPayment').textContent = '--';
    document.getElementById('calcTotalRepaid').textContent = '--';
    document.getElementById('calcTotalInterest').textContent = '--';
  } else {
    const months = Math.round(term*12);
    const payment = monthlyPayment(loanAmount, rate, months);
    const totalRepaid = payment*months;
    const totalInterest = totalRepaid - loanAmount;

    document.getElementById('calcMonthlyPayment').textContent = fmt(payment);
    document.getElementById('calcTotalRepaid').textContent = fmt(totalRepaid);
    document.getElementById('calcTotalInterest').textContent = fmt(totalInterest);
  }

  // Stamp duty depends only on property value & buyer type, so it's shown even if the
  // loan details above aren't fully filled in yet.
  const buyerType = document.getElementById('calcBuyerType').value;
  const breakdownWrap = document.getElementById('calcStampDutyBreakdownWrap');
  const breakdownBody = document.getElementById('calcStampDutyTableBody');
  if(!isNaN(propertyValue) && propertyValue > 0){
    const {tax, breakdown} = calculateStampDuty(propertyValue, buyerType);
    document.getElementById('calcStampDuty').textContent = fmt(tax);
    const subLabel = buyerType === 'first' ? 'first-time buyer relief applied' : (buyerType === 'additional' ? 'includes 5% additional property surcharge' : 'standard residential rates');
    document.getElementById('calcStampDutySub').textContent = subLabel;
    breakdownBody.innerHTML = breakdown.map(b => `<tr><td>${fmt(b.from)} \u2013 ${fmt(b.to)}</td><td>${Math.round(b.rate*1000)/10}%</td><td>${fmt(b.amount)}</td></tr>`).join('');
    breakdownWrap.style.display = breakdown.length ? 'block' : 'none';
  } else {
    document.getElementById('calcStampDuty').textContent = '--';
    document.getElementById('calcStampDutySub').textContent = 'enter a property value above';
    breakdownWrap.style.display = 'none';
  }
}
document.querySelectorAll('#calculatorView input, #calculatorView select').forEach(inp => {
  inp.addEventListener('input', calcRecalc);
  inp.addEventListener('change', calcRecalc);
});

