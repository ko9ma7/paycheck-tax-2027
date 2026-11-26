(() => {
  const STORAGE_KEY_CURRENT = 'ko9ma_2027_current_state_v1';
  const STORAGE_KEY_VAULT = 'ko9ma_2027_profile_vault_v1';
  const STORAGE_KEY_THEME = 'ko9ma_2027_theme_v1';

  const fmt = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const fmtSigned = (n) => (n >= 0 ? '+' : '-') + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';

  function formatKoreanMoney(won) {
    if (!won || won <= 0) return '0원';
    const eok = Math.floor(won / 100000000);
    const man = Math.floor((won % 100000000) / 10000);
    const parts = [];
    if (eok > 0) parts.push(`${eok}억`);
    if (man > 0) parts.push(`${man.toLocaleString('ko-KR')}만`);
    return parts.length ? parts.join(' ') + ' 원' : fmt(won);
  }

  // ==================== TAX & SALARY CORE ENGINES (2027) ====================
  function calcEarnedIncomeDeduction(gross) {
    if (gross <= 5000000) return gross * 0.7;
    if (gross <= 15000000) return 3500000 + (gross - 5000000) * 0.4;
    if (gross <= 45000000) return 7500000 + (gross - 15000000) * 0.15;
    if (gross <= 100000000) return 12000000 + (gross - 45000000) * 0.05;
    const raw = 14750000 + (gross - 100000000) * 0.02;
    return Math.min(20000000, raw);
  }

  function calcProgressiveTax(taxBase) {
    if (taxBase <= 0) return 0;
    const brackets = [
      [14000000, 0.06, 0],
      [50000000, 0.15, 1260000],
      [88000000, 0.24, 5760000],
      [150000000, 0.35, 15440000],
      [300000000, 0.38, 19940000],
      [500000000, 0.40, 25940000],
      [1000000000, 0.42, 35940000],
      [Infinity, 0.45, 65940000]
    ];
    for (const [limit, rate, prog] of brackets) {
      if (taxBase <= limit) {
        return Math.max(0, taxBase * rate - prog);
      }
    }
    return 0;
  }

  function calcEarnedIncomeTaxCredit(calcTax, gross) {
    if (calcTax <= 0) return 0;
    const rawCredit = calcTax <= 1300000
      ? calcTax * 0.55
      : 715000 + (calcTax - 1300000) * 0.30;

    let limit = 740000;
    if (gross > 120000000) {
      limit = Math.max(200000, 500000 - (gross - 120000000) * 0.5);
    } else if (gross > 70000000) {
      limit = Math.max(500000, 660000 - (gross - 70000000) * 0.5);
    } else if (gross > 33000000) {
      limit = Math.max(660000, 740000 - (gross - 33000000) * 0.008);
    }
    return Math.min(rawCredit, limit);
  }

  function calcChildTaxCredit(childrenCount) {
    if (childrenCount <= 0) return 0;
    if (childrenCount === 1) return 150000;
    if (childrenCount === 2) return 350000;
    return 350000 + (childrenCount - 2) * 300000;
  }

  function computeSalary(params) {
    const {
      basis, // 'annual' | 'monthly'
      sev,   // 'separate' | 'included'
      amount,
      monthlyNonTax,
      dependents,
      children,
      ratePension,
      rateHealth,
      rateLtc,
      rateEmp
    } = params;

    let annualGross = basis === 'annual' ? amount : amount * 12;
    if (sev === 'included') {
      annualGross = annualGross * (12 / 13);
    }
    const monthlyGross = annualGross / 12;
    const monthlyTaxable = Math.max(0, monthlyGross - monthlyNonTax);
    const annualTaxable = monthlyTaxable * 12;

    // 2027 4대보험 (국민연금 기준소득월액 상·하한: 40만원 ~ 637만원 근사 반영)
    const pensionBase = monthlyTaxable > 0 ? Math.min(6370000, Math.max(400000, monthlyTaxable)) : 0;
    const pension = Math.floor((pensionBase * (ratePension / 100)) / 10) * 10;
    const health = Math.floor((monthlyTaxable * (rateHealth / 100)) / 10) * 10;
    const ltc = Math.floor((health * (rateLtc / 100)) / 10) * 10;
    const emp = Math.floor((monthlyTaxable * (rateEmp / 100)) / 10) * 10;
    const totalInsuranceMonthly = pension + health + ltc + emp;

    // 근로소득세 간이세액 근사 (표준세액공제/인적공제/연금보험료 공제 반영)
    const earnedDed = calcEarnedIncomeDeduction(annualTaxable);
    const earnedIncome = Math.max(0, annualTaxable - earnedDed);
    const personalDed = Math.max(1, dependents) * 1500000;
    const annualPensionPaid = pension * 12;
    const standardDed = 130000;

    // 간이세액표 특별소득공제(근로소득 간이세액표 산식 기반 근사)
    const specialDed = annualTaxable <= 30000000
      ? 3100000 + annualTaxable * 0.04
      : 3100000 + 1200000 + (annualTaxable - 30000000) * 0.015;

    const taxBase = Math.max(0, earnedIncome - personalDed - annualPensionPaid - specialDed);
    const calcTax = calcProgressiveTax(taxBase);
    const taxCredit = calcEarnedIncomeTaxCredit(calcTax, annualTaxable);
    const childCredit = calcChildTaxCredit(children);

    const annualIncomeTax = Math.max(0, calcTax - taxCredit - childCredit - standardDed * 0);
    const monthlyIncomeTax = Math.floor((annualIncomeTax / 12) / 10) * 10;
    const monthlyLocalTax = Math.floor((monthlyIncomeTax * 0.1) / 10) * 10;

    const totalDeductMonthly = totalInsuranceMonthly + monthlyIncomeTax + monthlyLocalTax;
    const monthlyNet = Math.max(0, monthlyGross - totalDeductMonthly);
    const annualNet = monthlyNet * 12;
    const ratio = monthlyGross > 0 ? (monthlyNet / monthlyGross) * 100 : 0;

    return {
      annualGross,
      monthlyGross,
      monthlyTaxable,
      annualTaxable,
      pension,
      health,
      ltc,
      emp,
      totalInsuranceMonthly,
      monthlyIncomeTax,
      monthlyLocalTax,
      totalDeductMonthly,
      monthlyNet,
      annualNet,
      ratio
    };
  }

  function computeYearEndTax(p) {
    const gross = Math.max(0, p.gross);
    const earnedDed = calcEarnedIncomeDeduction(gross);
    const earnedIncome = Math.max(0, gross - earnedDed);

    // 1. 인적공제
    const personalDed = Math.max(1, p.dependents) * 1500000;

    // 2. 4대보험 공제
    const insDed = Math.max(0, p.insPaid);

    // 3. 주택청약종합저축 (총급여 7,000만 이하, 연 300만 한도 내 40%)
    const housingSubBase = gross <= 70000000 ? Math.min(3000000, Math.max(0, p.housingSub)) : 0;
    const housingSubDed = housingSubBase * 0.4;

    // 4. 신용카드 등 소득공제 (총급여 25% 초과분부터: 신용 15%, 체크/현금 30%, 전통/대중교통 40%)
    const threshold = gross * 0.25;
    const totalCardSpend = p.cardCredit + p.cardDebit + p.cardSpecial;
    let cardDed = 0;
    if (totalCardSpend > threshold) {
      // 최저사용금액은 공제율이 낮은 신용카드부터 소진
      let rem = threshold;
      const usedCredit = Math.max(0, p.cardCredit - rem);
      rem = Math.max(0, rem - p.cardCredit);
      const usedDebit = Math.max(0, p.cardDebit - rem);
      rem = Math.max(0, rem - p.cardDebit);
      const usedSpecial = Math.max(0, p.cardSpecial - rem);

      const rawBaseDed = usedCredit * 0.15 + usedDebit * 0.30;
      const childBonus = p.children >= 2 ? (gross <= 70000000 ? 1000000 : 500000)
        : (p.children === 1 ? (gross <= 70000000 ? 500000 : 250000) : 0);
      const baseLimit = (gross <= 70000000 ? 3000000 : 2500000) + childBonus;
      const specialDed = Math.min(3000000, usedSpecial * 0.40);
      cardDed = Math.min(baseLimit, rawBaseDed) + specialDed;
    }

    const totalIncomeDed = personalDed + insDed + housingSubDed + cardDed;
    const taxBase = Math.max(0, earnedIncome - totalIncomeDed);
    const calcTax = calcProgressiveTax(taxBase);

    // 세액공제
    const earnedCredit = calcEarnedIncomeTaxCredit(calcTax, gross);
    const childCredit = calcChildTaxCredit(p.children);

    // 연금저축 + IRP (합산 900만 원 한도, 5,500만 이하 15%, 초과 12% -> 지방소득세 포함 16.5%/13.2%)
    const pensionLimit = Math.min(9000000, Math.max(0, p.pensionSave));
    const pensionRate = gross <= 55000000 ? 0.15 : 0.12;
    const pensionCredit = pensionLimit * pensionRate;

    // 월세 세액공제 (2027 기준 총급여 8,000만 이하, 한도 1,200만 원)
    let rentCredit = 0;
    if (gross <= 80000000 && p.rent > 0) {
      const rentBase = Math.min(12000000, p.rent);
      const rentRate = gross <= 55000000 ? 0.17 : 0.15;
      rentCredit = rentBase * rentRate;
    }

    // 의료비 (총급여 3% 초과분 15%)
    const medThreshold = gross * 0.03;
    const medCredit = p.medical > medThreshold ? (p.medical - medThreshold) * 0.15 : 0;

    // 교육비/기부금/보장성보험 (평균 15% 근사)
    const etcCredit = Math.max(0, p.eduDon) * 0.15;

    const specialTaxCredit = pensionCredit + rentCredit + medCredit + etcCredit;
    const totalTaxCredit = earnedCredit + childCredit + Math.max(130000, specialTaxCredit);

    const finalIncomeTax = Math.max(0, calcTax - totalTaxCredit);
    const finalTotalTax = finalIncomeTax * 1.1; // 지방소득세 10% 포함
    const refund = p.prepaid - finalTotalTax;

    return {
      gross,
      earnedDed,
      earnedIncome,
      personalDed,
      insDed,
      housingSubDed,
      cardDed,
      threshold,
      totalCardSpend,
      taxBase,
      calcTax,
      earnedCredit,
      childCredit,
      pensionCredit,
      rentCredit,
      medCredit,
      etcCredit,
      totalTaxCredit,
      finalTotalTax,
      refund
    };
  }

  // ==================== STATE & DOM BINDING ====================
  const state = {
    activeTab: 'salary',
    salBasis: 'annual',
    salSev: 'separate'
  };

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('view-salary').classList.toggle('active', tab === 'salary');
    $('view-tax').classList.toggle('active', tab === 'tax');
    history.replaceState(null, '', '#' + tab);
  }

  function readAllInputs() {
    return {
      salBasis: state.salBasis,
      salSev: state.salSev,
      salAmount: Number($('sal-amount').value) || 0,
      salNonTax: Number($('sal-nontax').value) || 0,
      salDependents: Number($('sal-dependents').value) || 1,
      salChildren: Number($('sal-children').value) || 0,
      rateEmp: Number($('sal-emp-rate').value) || 0,
      ratePension: Number($('rate-pension').value) || 0,
      rateHealth: Number($('rate-health').value) || 0,
      rateLtc: Number($('rate-ltc').value) || 0,
      taxGross: Number($('tax-gross').value) || 0,
      taxPrepaid: Number($('tax-prepaid').value) || 0,
      taxDependents: Number($('tax-dependents').value) || 1,
      taxChildren: Number($('tax-children').value) || 0,
      taxInsPaid: Number($('tax-ins-paid').value) || 0,
      taxCardCredit: Number($('tax-card-credit').value) || 0,
      taxCardDebit: Number($('tax-card-debit').value) || 0,
      taxCardSpecial: Number($('tax-card-special').value) || 0,
      taxPensionSave: Number($('tax-pension-save').value) || 0,
      taxRent: Number($('tax-rent').value) || 0,
      taxHousingSub: Number($('tax-housing-sub').value) || 0,
      taxMedical: Number($('tax-medical').value) || 0,
      taxEduDon: Number($('tax-edu-don').value) || 0
    };
  }

  function applyAllInputs(data) {
    if (!data) return;
    if (data.salBasis) {
      state.salBasis = data.salBasis;
      document.querySelectorAll('#sal-basis-group .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === state.salBasis));
    }
    if (data.salSev) {
      state.salSev = data.salSev;
      document.querySelectorAll('#sal-sev-group .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === state.salSev));
    }
    const map = {
      'sal-amount': data.salAmount,
      'sal-nontax': data.salNonTax,
      'sal-dependents': data.salDependents,
      'sal-children': data.salChildren,
      'sal-emp-rate': data.rateEmp,
      'rate-pension': data.ratePension,
      'rate-health': data.rateHealth,
      'rate-ltc': data.rateLtc,
      'tax-gross': data.taxGross,
      'tax-prepaid': data.taxPrepaid,
      'tax-dependents': data.taxDependents,
      'tax-children': data.taxChildren,
      'tax-ins-paid': data.taxInsPaid,
      'tax-card-credit': data.taxCardCredit,
      'tax-card-debit': data.taxCardDebit,
      'tax-card-special': data.taxCardSpecial,
      'tax-pension-save': data.taxPensionSave,
      'tax-rent': data.taxRent,
      'tax-housing-sub': data.taxHousingSub,
      'tax-medical': data.taxMedical,
      'tax-edu-don': data.taxEduDon
    };
    for (const [id, val] of Object.entries(map)) {
      if (val !== undefined && $(id)) $(id).value = val;
    }
    renderAll();
  }

  function saveCurrentState() {
    localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(readAllInputs()));
  }

  function renderSalary() {
    const inp = readAllInputs();
    $('sal-amount-label').textContent = state.salBasis === 'annual' ? '세전 연봉 (원)' : '세전 월급 (원)';
    $('sal-amount-kr').textContent = formatKoreanMoney(inp.salAmount);

    const res = computeSalary({
      basis: state.salBasis,
      sev: state.salSev,
      amount: inp.salAmount,
      monthlyNonTax: inp.salNonTax,
      dependents: inp.salDependents,
      children: inp.salChildren,
      ratePension: inp.ratePension,
      rateHealth: inp.rateHealth,
      rateLtc: inp.rateLtc,
      rateEmp: inp.rateEmp
    });

    $('res-monthly-net').textContent = fmt(res.monthlyNet);
    $('res-annual-net').textContent = fmt(res.annualNet);
    $('res-monthly-deduct').textContent = fmt(res.totalDeductMonthly);
    $('sal-takehome-ratio').textContent = `실수령률 ${res.ratio.toFixed(1)}%`;

    const insPct = res.monthlyGross > 0 ? (res.totalInsuranceMonthly / res.monthlyGross) * 100 : 0;
    const taxPct = res.monthlyGross > 0 ? ((res.monthlyIncomeTax + res.monthlyLocalTax) / res.monthlyGross) * 100 : 0;
    const netPct = Math.max(0, 100 - insPct - taxPct);
    $('bar-net').style.width = `${netPct}%`;
    $('bar-ins').style.width = `${insPct}%`;
    $('bar-tax').style.width = `${taxPct}%`;

    const rows = [
      ['국민연금', `과세급여 ${inp.ratePension}% (상한 637만)`, res.pension, res.pension * 12],
      ['건강보험', `과세급여 ${inp.rateHealth}%`, res.health, res.health * 12],
      ['장기요양보험', `건강보험의 ${inp.rateLtc}%`, res.ltc, res.ltc * 12],
      ['고용보험', `과세급여 ${inp.rateEmp}%`, res.emp, res.emp * 12],
      ['근로소득세', `부양 ${inp.salDependents}명 · 자녀 ${inp.salChildren}명`, res.monthlyIncomeTax, res.monthlyIncomeTax * 12],
      ['지방소득세', '소득세의 10%', res.monthlyLocalTax, res.monthlyLocalTax * 12]
    ];

    $('sal-breakdown-body').innerHTML = rows.map(([name, rule, m, y]) => `
      <tr>
        <td><strong>${name}</strong></td>
        <td class="hint">${rule}</td>
        <td class="num">${fmt(m)}</td>
        <td class="num">${fmt(y)}</td>
      </tr>
    `).join('') + `
      <tr class="total-row">
        <td colspan="2">공제 합계</td>
        <td class="num">${fmt(res.totalDeductMonthly)}</td>
        <td class="num">${fmt(res.totalDeductMonthly * 12)}</td>
      </tr>
    `;

    // Comparison table
    const baseAnnual = res.annualGross;
    const deltas = [-5000000, 0, 5000000, 10000000];
    $('sal-compare-body').innerHTML = deltas.map((d) => {
      const target = Math.max(0, baseAnnual + d);
      const c = computeSalary({
        basis: 'annual',
        sev: 'separate',
        amount: target,
        monthlyNonTax: inp.salNonTax,
        dependents: inp.salDependents,
        children: inp.salChildren,
        ratePension: inp.ratePension,
        rateHealth: inp.rateHealth,
        rateLtc: inp.rateLtc,
        rateEmp: inp.rateEmp
      });
      const label = d === 0 ? `${formatKoreanMoney(target)} (현재)` : `${formatKoreanMoney(target)} (${d > 0 ? '+' : ''}${d / 10000}만)`;
      return `
        <tr class="${d === 0 ? 'highlight-row' : ''}">
          <td>${label}</td>
          <td class="num">${fmt(c.monthlyNet)}</td>
          <td class="num">${fmt(c.totalDeductMonthly)}</td>
          <td class="num">${c.ratio.toFixed(1)}%</td>
        </tr>
      `;
    }).join('');
  }

  function renderTax() {
    const inp = readAllInputs();
    $('tax-gross-kr').textContent = formatKoreanMoney(inp.taxGross);

    const res = computeYearEndTax({
      gross: inp.taxGross,
      prepaid: inp.taxPrepaid,
      dependents: inp.taxDependents,
      children: inp.taxChildren,
      insPaid: inp.taxInsPaid,
      cardCredit: inp.taxCardCredit,
      cardDebit: inp.taxCardDebit,
      cardSpecial: inp.taxCardSpecial,
      pensionSave: inp.taxPensionSave,
      rent: inp.taxRent,
      housingSub: inp.taxHousingSub,
      medical: inp.taxMedical,
      eduDon: inp.taxEduDon
    });

    $('card-threshold-banner').innerHTML = `최저사용금액(총급여 25%): <strong>${fmt(res.threshold)}</strong> 초과분부터 공제 시작 (현재 총 사용액: ${fmt(res.totalCardSpend)})`;

    const heroCard = $('tax-hero-card');
    heroCard.classList.remove('refund-positive', 'refund-negative');
    if (res.refund >= 0) {
      heroCard.classList.add('refund-positive');
      $('tax-status-badge').textContent = '13월의 월급 환급 예상';
      $('res-tax-refund').textContent = fmtSigned(res.refund);
    } else {
      heroCard.classList.add('refund-negative');
      $('tax-status-badge').textContent = '추가 납부 예상';
      $('res-tax-refund').textContent = fmtSigned(res.refund);
    }
    $('res-tax-final').textContent = fmt(res.finalTotalTax);
    $('res-tax-prepaid').textContent = fmt(inp.taxPrepaid);

    const steps = [
      ['연간 총급여액', '비과세 제외', res.gross],
      ['(-) 근로소득공제', '구간별 자동 공제 (최대 2,000만)', -res.earnedDed],
      ['(=) 근로소득금액', '총급여 - 근로소득공제', res.earnedIncome],
      ['(-) 인적·4대보험·청약·카드 공제', `인적 ${fmt(res.personalDed)} + 보험 ${fmt(res.insDed)} + 청약 ${fmt(res.housingSubDed)} + 카드 ${fmt(res.cardDed)}`, -(res.personalDed + res.insDed + res.housingSubDed + res.cardDed)],
      ['(=) 과세표준', '세율 적용 기준 금액', res.taxBase],
      ['산출세액', '8단계 누진세율 적용', res.calcTax],
      ['(-) 세액공제 합계', `근로 ${fmt(res.earnedCredit)} + 연금 ${fmt(res.pensionCredit)} + 월세 ${fmt(res.rentCredit)} + 기타`, -res.totalTaxCredit],
      ['(=) 최종 결정세액 (지방세 포함)', '결정소득세 × 1.1', res.finalTotalTax]
    ];

    $('tax-waterfall-body').innerHTML = steps.map(([name, rule, val], idx) => `
      <tr class="${idx === steps.length - 1 ? 'total-row' : ''}">
        <td><strong>${name}</strong></td>
        <td class="hint">${rule}</td>
        <td class="num">${val < 0 ? '-' + fmt(Math.abs(val)) : fmt(val)}</td>
      </tr>
    `).join('');

    // Diagnostics & Tips
    const pensionRemain = Math.max(0, 9000000 - inp.taxPensionSave);
    const pensionExtraRate = inp.taxGross <= 55000000 ? 0.165 : 0.132;
    if (pensionRemain > 0) {
      $('tax-advice-box').innerHTML = `💡 연금저축·IRP 세액공제 한도가 <strong>${fmt(pensionRemain)}</strong> 남았습니다. 연말 전 추가 납입 시 최대 <strong>${fmt(pensionRemain * pensionExtraRate)}</strong> 절세 효과가 있습니다.`;
    } else {
      $('tax-advice-box').innerHTML = `✅ 연금저축·IRP 합산 900만 원 세액공제 한도를 100% 채우셨습니다!`;
    }

    const diags = [];
    if (res.totalCardSpend <= res.threshold) {
      diags.push(`<strong>1. 카드 공제 미달 (${fmt(res.threshold - res.totalCardSpend)} 부족)</strong>총급여 25%까지는 혜택 좋은 신용카드를 쓰시고, 25% 초과분부터 체크카드·현금영수증(30%)으로 전환하세요.`);
    } else {
      diags.push(`<strong>1. 카드 소득공제 적용 중 (+${fmt(res.cardDed)} 공제)</strong>최저사용금액을 넘겨 공제가 시작되었습니다. 추가 소비는 공제율이 2배인 체크카드·지역화폐를 권장합니다.`);
    }
    if (inp.taxGross <= 80000000 && inp.taxRent === 0) {
      diags.push(`<strong>2. 월세 세액공제 체크</strong>무주택 세대주(또는 주말부부)라면 2027년 확대된 연 1,200만 원 한도 내에서 15~17% 세액공제를 받을 수 있습니다.`);
    } else if (inp.taxRent > 0) {
      diags.push(`<strong>2. 월세 세액공제 반영됨 (+${fmt(res.rentCredit)} 세액공제)</strong>임대차계약서 사본과 계좌이체 내역을 미리 준비해 두세요.`);
    }
    $('tax-diagnostic-list').innerHTML = diags.map((d) => `<div class="diag-item">${d}</div>`).join('');
  }

  function renderAll() {
    renderSalary();
    renderTax();
    saveCurrentState();
  }

  // ==================== VAULT (LOCALSTORAGE PROFILES) ====================
  function getVault() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_VAULT) || '[]');
    } catch {
      return [];
    }
  }

  function setVault(list) {
    localStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(list));
    $('saved-count-badge').textContent = list.length;
    renderVaultList();
  }

  function renderVaultList() {
    const list = getVault();
    $('saved-count-badge').textContent = list.length;
    if (list.length === 0) {
      $('vault-list').innerHTML = '<p class="hint" style="text-align:center;padding:24px 0;">아직 저장된 내 정보 프로필이 없습니다. 상단에서 이름을 입력해 저장해 보세요.</p>';
      return;
    }
    $('vault-list').innerHTML = list.map((item, i) => `
      <div class="vault-item">
        <div>
          <div class="vault-item-title">${item.name}</div>
          <div class="vault-item-meta">${item.date} · 연봉 ${formatKoreanMoney(item.data.salAmount)} · 예상 ${item.summary}</div>
        </div>
        <div class="vault-item-actions">
          <button type="button" class="btn-sm btn-primary" data-load="${i}">불러오기</button>
          <button type="button" class="btn-sm btn-danger-outline" data-del="${i}">삭제</button>
        </div>
      </div>
    `).join('');
  }

  function saveSnapshot(defaultLabel) {
    const name = defaultLabel || `기록 ${new Date().toLocaleDateString('ko-KR')}`;
    const data = readAllInputs();
    const sal = computeSalary({
      basis: data.salBasis,
      sev: data.salSev,
      amount: data.salAmount,
      monthlyNonTax: data.salNonTax,
      dependents: data.salDependents,
      children: data.salChildren,
      ratePension: data.ratePension,
      rateHealth: data.rateHealth,
      rateLtc: data.rateLtc,
      rateEmp: data.rateEmp
    });
    const list = getVault();
    list.unshift({
      id: Date.now(),
      name,
      date: new Date().toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      summary: `월 ${fmt(sal.monthlyNet)}`,
      data
    });
    setVault(list);
    showToast(`"${name}" 프로필이 브라우저에 저장되었습니다.`);
  }

  // ==================== EVENT LISTENERS ====================
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('#sal-basis-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.salBasis = btn.dataset.val;
      document.querySelectorAll('#sal-basis-group .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });

  document.querySelectorAll('#sal-sev-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.salSev = btn.dataset.val;
      document.querySelectorAll('#sal-sev-group .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });

  document.querySelectorAll('.quick-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const el = $('sal-amount');
      if (chip.dataset.set) el.value = Number(chip.dataset.set);
      if (chip.dataset.add) el.value = (Number(el.value) || 0) + Number(chip.dataset.add);
      renderAll();
    });
  });

  document.querySelectorAll('input[type="number"]').forEach((inp) => {
    inp.addEventListener('input', renderAll);
  });

  $('btn-sync-to-tax').addEventListener('click', () => {
    const inp = readAllInputs();
    const sal = computeSalary({
      basis: state.salBasis,
      sev: state.salSev,
      amount: inp.salAmount,
      monthlyNonTax: inp.salNonTax,
      dependents: inp.salDependents,
      children: inp.salChildren,
      ratePension: inp.ratePension,
      rateHealth: inp.rateHealth,
      rateLtc: inp.rateLtc,
      rateEmp: inp.rateEmp
    });
    $('tax-gross').value = Math.round(sal.annualTaxable);
    $('tax-dependents').value = inp.salDependents;
    $('tax-children').value = inp.salChildren;
    $('tax-ins-paid').value = Math.round(sal.totalInsuranceMonthly * 12);
    $('tax-prepaid').value = Math.round((sal.monthlyIncomeTax + sal.monthlyLocalTax) * 12);
    renderAll();
    switchTab('tax');
    showToast('연봉 계산기 정보가 연말정산 계산기로 연동되었습니다.');
  });

  $('btn-estimate-prepaid').addEventListener('click', () => {
    const gross = Number($('tax-gross').value) || 0;
    const sal = computeSalary({
      basis: 'annual',
      sev: 'separate',
      amount: gross,
      monthlyNonTax: 0,
      dependents: Number($('tax-dependents').value) || 1,
      children: Number($('tax-children').value) || 0,
      ratePension: Number($('rate-pension').value) || 5.0,
      rateHealth: Number($('rate-health').value) || 3.595,
      rateLtc: Number($('rate-ltc').value) || 13.9,
      rateEmp: Number($('sal-emp-rate').value) || 1.0
    });
    $('tax-ins-paid').value = Math.round(sal.totalInsuranceMonthly * 12);
    $('tax-prepaid').value = Math.round((sal.monthlyIncomeTax + sal.monthlyLocalTax) * 12);
    renderAll();
    showToast('총급여 기준 예상 기납부세액과 4대보험을 자동 추정했습니다.');
  });

  // Vault Modal
  $('btn-open-vault').addEventListener('click', () => {
    renderVaultList();
    $('vault-modal').hidden = false;
  });
  $('btn-close-vault').addEventListener('click', () => { $('vault-modal').hidden = true; });
  $('vault-modal').addEventListener('click', (e) => {
    if (e.target === $('vault-modal')) $('vault-modal').hidden = true;
  });

  $('btn-save-profile').addEventListener('click', () => {
    const label = $('profile-name-input').value.trim();
    saveSnapshot(label || undefined);
    $('profile-name-input').value = '';
  });

  $('btn-save-salary-snapshot').addEventListener('click', () => {
    saveSnapshot(`연봉 ${formatKoreanMoney(Number($('sal-amount').value) || 0)}`);
  });
  $('btn-save-tax-snapshot').addEventListener('click', () => {
    saveSnapshot(`연말정산 ${formatKoreanMoney(Number($('tax-gross').value) || 0)}`);
  });

  $('vault-list').addEventListener('click', (e) => {
    const loadIdx = e.target.dataset.load;
    const delIdx = e.target.dataset.del;
    const list = getVault();
    if (loadIdx !== undefined) {
      const item = list[Number(loadIdx)];
      if (item) {
        applyAllInputs(item.data);
        $('vault-modal').hidden = true;
        showToast(`"${item.name}" 프로필을 불러왔습니다.`);
      }
    } else if (delIdx !== undefined) {
      list.splice(Number(delIdx), 1);
      setVault(list);
      showToast('저장된 프로필을 삭제했습니다.');
    }
  });

  $('btn-export-json').addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      current: readAllInputs(),
      vault: getVault()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ko9ma-2027-salary-tax-backup.json`;
    a.click();
    showToast('JSON 백업 파일이 다운로드되었습니다.');
  });

  $('input-import-json').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.vault && Array.isArray(parsed.vault)) setVault(parsed.vault);
        if (parsed.current) applyAllInputs(parsed.current);
        showToast('백업 데이터를 성공적으로 불러왔습니다.');
      } catch {
        showToast('올바른 JSON 백업 파일이 아닙니다.');
      }
    };
    reader.readAsText(file);
  });

  $('btn-clear-all').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY_CURRENT);
    localStorage.removeItem(STORAGE_KEY_VAULT);
    renderVaultList();
    showToast('브라우저 저장 기록을 모두 초기화했습니다.');
  });

  // Theme
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('btn-theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem(STORAGE_KEY_THEME, theme);
  }

  $('btn-theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // Init
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'light';
  setTheme(savedTheme);

  const savedCurrent = localStorage.getItem(STORAGE_KEY_CURRENT);
  if (savedCurrent) {
    try { applyAllInputs(JSON.parse(savedCurrent)); } catch { renderAll(); }
  } else {
    renderAll();
  }
  renderVaultList();

  if (location.hash === '#tax') switchTab('tax');
})();
