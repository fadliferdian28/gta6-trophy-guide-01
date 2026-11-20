// Leonida Trophy Ledger — an offline companion for the 55 PS5 trophies of GTA VI.
// Everything is computed from data/trophies.json at runtime: source numbering, audit
// counts, roadmap order, filter counts and PSN points. Optional fields are treated as
// optional everywhere, so this runs equally well on the starter list and the full guide.

const EARNED_KEY = 'gta6-ledger-earned-v1';
const COUNTS_KEY = 'gta6-ledger-counts-v1';
const SHIELD_KEY = 'gta6-ledger-shield-v1';
const REVEAL_KEY = 'gta6-ledger-revealed-v1';
const GRADES = ['platinum', 'gold', 'silver', 'bronze'];
const GRADE_POINTS = { platinum: 300, gold: 90, silver: 30, bronze: 15 };
const GRADE_LETTER = { platinum: 'P', gold: 'G', silver: 'S', bronze: 'B' };
const CATEGORIES = ['Platinum', 'Story', 'Side', 'Collectibles', 'Activities', 'Crime', 'World', 'Money', 'Misc', 'Completion'];

const state = {
  trophies: [],
  registry: [],
  byKey: new Map(),
  byUrl: new Map(),
  earned: new Set(),
  counts: {},
  revealed: new Set(),
  shield: true,
  view: 'tracker',
  selectedId: 28,
  filters: { chips: new Set(), search: '' },
  sort: 'roadmap',
  error: '',
};

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be disabled: the session still works in memory */
  }
}

function loadState() {
  const ids = readJSON(EARNED_KEY, []);
  if (Array.isArray(ids)) state.earned = new Set(ids.map((id) => String(id)));
  const counts = readJSON(COUNTS_KEY, {});
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) state.counts = counts;
  const revealed = readJSON(REVEAL_KEY, []);
  if (Array.isArray(revealed)) state.revealed = new Set(revealed.map((id) => String(id)));
  const shield = localStorage.getItem(SHIELD_KEY);
  state.shield = shield === null ? true : shield === 'on';
}

function saveEarned() { writeJSON(EARNED_KEY, [...state.earned]); }
function saveCounts() { writeJSON(COUNTS_KEY, state.counts); }
function saveRevealed() { writeJSON(REVEAL_KEY, [...state.revealed]); }
function saveShield() {
  try { localStorage.setItem(SHIELD_KEY, state.shield ? 'on' : 'off'); } catch { /* ignore */ }
}

const keyOf = (t) => String(t.id);
const gradeOf = (t) => (GRADES.includes(t.grade) ? t.grade : '');
const isEarned = (t) => state.earned.has(keyOf(t));
const isMissable = (t) => t.missable === 'yes' || t.missable === 'possibly';
const isHidden = (t) => t.hidden === true;
const stageOf = (t) => (Number.isInteger(t.stage) && t.stage >= 1 ? t.stage : null);

function userCount(t) {
  if (!Number.isFinite(t.count)) return 0;
  const raw = state.counts[keyOf(t)];
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(Math.trunc(raw), Math.trunc(t.count)));
}

function roadmapCompare(a, b) {
  const sa = stageOf(a) ?? 99;
  const sb = stageOf(b) ?? 99;
  if (sa !== sb) return sa - sb;
  return a._file - b._file;
}

function nextUp(limit) {
  return state.trophies.filter((t) => !isEarned(t)).sort(roadmapCompare).slice(0, limit);
}

/* ---------- source registry ---------- */

function registryFor(url) {
  return state.byUrl.get(url) ?? null;
}

function resolveRef(ref, ownSources) {
  if (ref === undefined || ref === null || ref === '') return null;
  const needle = String(ref);
  if (state.byKey.has(needle)) return state.byKey.get(needle);
  const lowered = needle.toLowerCase();
  for (const source of state.registry) {
    if (source.site && source.site.toLowerCase() === lowered) return source;
  }
  for (const source of state.registry) {
    if (source.url && source.url.toLowerCase().includes(lowered)) return source;
  }
  if (Array.isArray(ownSources)) {
    for (const source of ownSources) {
      if (source && (source.key === needle || source.site === needle)) {
        const registered = source.url ? registryFor(source.url) : null;
        if (registered) return registered;
      }
    }
  }
  return null;
}

function buildRegistry(trophies) {
  const registry = [];
  const byKey = new Map();
  const byUrl = new Map();
  for (const trophy of trophies) {
    for (const source of trophy.sources ?? []) {
      if (!source || typeof source !== 'object') continue;
      const url = typeof source.url === 'string' ? source.url : '';
      let entry = url ? byUrl.get(url) : null;
      if (!entry) {
        entry = {
          n: registry.length + 1,
          key: source.key ?? '',
          site: source.site ?? '',
          title: source.title ?? '',
          url,
          read: source.read ?? '',
          guides: new Set(),
          claims: 0,
        };
        registry.push(entry);
        if (url) byUrl.set(url, entry);
      }
      if (source.key) byKey.set(source.key, entry);
      entry.guides.add(keyOf(trophy));
    }
  }
  for (const trophy of trophies) {
    for (const source of trophy.sources ?? []) {
      if (!source) continue;
      const entry = (source.url && byUrl.get(source.url)) || (source.key && byKey.get(source.key)) || null;
      if (entry) entry.guides.add(keyOf(trophy));
    }
  }
  state.registry = registry;
  state.byKey = byKey;
  state.byUrl = byUrl;
  return { registry, byKey, byUrl };
}

function citeNodes(refs, ownSources) {
  const frag = document.createDocumentFragment();
  const seen = new Set();
  for (const ref of refs ?? []) {
    const source = resolveRef(ref, ownSources);
    if (!source || seen.has(source.n)) continue;
    seen.add(source.n);
    frag.append(el('span', 'cite', `[${source.n}]`));
  }
  return frag;
}

/* ---------- derived numbers ---------- */

function derive() {
  const trophies = state.trophies;
  const grades = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  let hidden = 0;
  let points = 0;
  let totalPoints = 0;
  let missableYes = 0;
  let missablePossible = 0;
  let atRisk = 0;
  let disputes = 0;
  let unconfirmed = 0;
  let completeRecords = 0;
  let steps = 0;
  let citedSteps = 0;
  let multiSteps = 0;
  let guidesWithSources = 0;
  let chaptersWithGuides = 0;

  for (const trophy of trophies) {
    const grade = gradeOf(trophy);
    if (typeof trophy.name === 'string' && trophy.name.trim()
      && typeof trophy.description === 'string' && trophy.description.trim()
      && grade) completeRecords += 1;
    if (grade) {
      grades[grade] += 1;
      totalPoints += GRADE_POINTS[grade];
      if (isEarned(trophy)) points += GRADE_POINTS[grade];
    }
    if (isHidden(trophy)) hidden += 1;
    if (trophy.missable === 'yes') missableYes += 1;
    if (trophy.missable === 'possibly') missablePossible += 1;
    if (trophy.at_risk === true) atRisk += 1;
    if (Array.isArray(trophy.sources) && trophy.sources.length > 0) guidesWithSources += 1;
    if (trophy.guide) chaptersWithGuides += 1;
    const ownDisputes = Array.isArray(trophy.disputes) ? trophy.disputes : [];
    disputes += ownDisputes.length;
    for (const dispute of ownDisputes) {
      if (!dispute || typeof dispute.call !== 'string' || dispute.call.trim() === '') unconfirmed += 1;
    }
    for (const step of Array.isArray(trophy.steps) ? trophy.steps : []) {
      if (!step) continue;
      steps += 1;
      const refs = Array.isArray(step.src) ? step.src : [];
      if (refs.length > 0) citedSteps += 1;
      const distinct = new Set();
      for (const ref of refs) {
        const source = resolveRef(ref, trophy.sources);
        if (source) distinct.add(source.n);
      }
      if (distinct.size >= 2) multiSteps += 1;
    }
  }

  const earnedCount = trophies.filter(isEarned).length;
  const sites = new Set(state.registry.map((s) => (s.site || '').toLowerCase()).filter(Boolean));
  const earnedGrades = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  for (const trophy of trophies) {
    if (isEarned(trophy) && gradeOf(trophy)) earnedGrades[gradeOf(trophy)] += 1;
  }
  return {
    total: trophies.length,
    completeRecords,
    grades,
    earnedGrades,
    totalPoints,
    points,
    hidden,
    missableYes,
    missablePossible,
    atRisk,
    disputes,
    unconfirmed,
    steps,
    citedSteps,
    multiSteps,
    guidesWithSources,
    chaptersWithGuides,
    earnedCount,
    earnedPoints: points,
    pages: state.registry.length,
    sites: sites.size,
  };
}

/* ---------- small view helpers ---------- */

function gradeBadge(grade, large) {
  const known = GRADES.includes(grade) ? grade : 'unknown';
  return el('span', `grade-badge grade-${known}${large ? ' lg' : ''}`, GRADE_LETTER[known] ?? '?');
}

function tag(text, cls) { return el('span', `row-tag${cls ? ` ${cls}` : ''}`, text); }

function trophyTitle(t) {
  if (t && typeof t.name === 'string' && t.name.trim()) return t.name;
  return `Trophy #${t?.id ?? '?'}`;
}

function chapterText(t) {
  const parts = [];
  if (t.chapter) parts.push(String(t.chapter));
  const stage = stageOf(t);
  if (stage !== null) parts.push(`Stage ${stage}`);
  return parts.join(' · ');
}

function lockedRow(t) {
  // Spoiler shield: conceal the identity of an unearned hidden trophy until revealed.
  return state.shield && isHidden(t) && !isEarned(t) && !state.revealed.has(keyOf(t));
}

function statusWord(t) {
  return isHidden(t) ? 'PSN-hidden' : 'visible on PSN';
}

function selectedTrophy() {
  const found = state.trophies.find((t) => keyOf(t) === String(state.selectedId));
  return found ?? state.trophies[0] ?? null;
}

function setSelected(id) {
  state.selectedId = id;
  renderChecklist();
  renderDetail();
  renderRail();
  renderNextUp();
}

/* ---------- header + audit ---------- */

function renderHeader() {
  const d = derive();
  document.getElementById('subtitle').textContent = `GTA VI · PS5 · ${d.total} trophies`;
  document.getElementById('earned-count').textContent = `${d.earnedCount} / ${d.total}`;
  document.getElementById('grade-split').textContent = `P ${d.earnedGrades.platinum}/${d.grades.platinum} · G ${d.earnedGrades.gold}/${d.grades.gold} · S ${d.earnedGrades.silver}/${d.grades.silver} · B ${d.earnedGrades.bronze}/${d.grades.bronze}`;
  document.getElementById('psn-points').textContent = `${d.earnedPoints.toLocaleString('en-US')} / ${d.totalPoints.toLocaleString('en-US')}`;
  const bar = document.getElementById('progress-bar');
  bar.max = Math.max(1, d.total);
  bar.value = d.earnedCount;
  document.getElementById('spoiler-toggle').checked = state.shield;
}

function renderAudit() {
  const d = derive();
  const parts = [];
  parts.push(`${d.completeRecords}/${d.total} official name, description, grade`);
  parts.push(`${d.grades.platinum}P ${d.grades.gold}G ${d.grades.silver}S ${d.grades.bronze}B`);
  parts.push(`${d.hidden} PSN-hidden`);
  parts.push(`${d.guidesWithSources}/${d.total} guides cite sources`);
  parts.push(`${d.citedSteps}/${d.steps} claims cited`);
  parts.push(`${d.multiSteps} backed by 2+ sources`);
  parts.push(`${d.pages} pages`);
  parts.push(`${d.sites} sites read`);
  if (d.missableYes > 0 || d.missablePossible > 0) {
    const bits = [];
    if (d.missableYes > 0) bits.push(`${d.missableYes} missable`);
    if (d.missablePossible > 0) bits.push(`${d.missablePossible} possibly missable`);
    parts.push(bits.join(' · '));
  } else {
    parts.push('0 possibly missable');
  }
  parts.push(`${d.atRisk} at risk`);
  if (d.disputes > 0 || d.unconfirmed > 0) {
    parts.push(`${d.disputes} disputes shown both ways`);
    if (d.unconfirmed > 0) parts.push(`${d.unconfirmed} unconfirmed`);
  }
  const holder = document.getElementById('audit-content');
  holder.replaceChildren();
  parts.forEach((part, index) => {
    if (index > 0) holder.append(el('span', 'audit-sep', '·'));
    holder.append(document.createTextNode(` ${part} `));
  });
}

/* ---------- checklist ---------- */

function activeFilters() {
  return [...state.filters.chips];
}

function categoryCount(category) {
  return state.trophies.filter((t) => t.category === category).length;
}

function matchesChips(t, chips) {
  for (const chip of chips) {
    if (GRADES.includes(chip)) {
      if (gradeOf(t) !== chip) return false;
      continue;
    }
    if (CATEGORIES.includes(chip)) {
      if (t.category !== chip) return false;
      continue;
    }
    if (chip === 'missable' && !isMissable(t)) return false;
    if (chip === 'disputed' && !(Array.isArray(t.disputes) && t.disputes.length > 0)) return false;
    if (chip === 'hidden' && !isHidden(t)) return false;
    if (chip === 'unearned' && isEarned(t)) return false;
  }
  return true;
}

function visibleTrophies() {
  const chips = activeFilters();
  const needle = state.filters.search.trim().toLowerCase();
  const list = state.trophies.filter((t) => {
    if (!matchesChips(t, chips)) return false;
    if (needle) {
      const haystack = `${t.name ?? ''} ${t.description ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
  if (state.sort === 'name') {
    list.sort((a, b) => trophyTitle(a).localeCompare(trophyTitle(b), 'en'));
  } else if (state.sort === 'grade') {
    list.sort((a, b) => {
      const ga = GRADES.indexOf(gradeOf(a));
      const gb = GRADES.indexOf(gradeOf(b));
      const ra = ga === -1 ? 9 : ga;
      const rb = gb === -1 ? 9 : gb;
      if (ra !== rb) return ra - rb;
      return trophyTitle(a).localeCompare(trophyTitle(b), 'en');
    });
  } else {
    list.sort(roadmapCompare);
  }
  return list;
}

function renderChecklist() {
  const list = visibleTrophies();
  document.getElementById('shown-count').textContent = `${list.length} SHOWN`;
  const holder = document.getElementById('checklist');
  holder.replaceChildren();
  if (list.length === 0) {
    holder.append(el('p', 'empty-note', 'No trophies match these filters.'));
    return;
  }
  const current = selectedTrophy();
  for (const t of list) {
    const row = el('div', 'trophy-row');
    if (current && keyOf(current) === keyOf(t)) row.classList.add('is-selected');
    if (isEarned(t)) row.classList.add('is-earned');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = isEarned(t);
    box.setAttribute('aria-label', `Mark ${trophyTitle(t)} earned`);
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('change', () => {
      toggleEarned(t);
      renderAll();
    });
    row.append(box);
    row.append(gradeBadge(t.grade, false));

    const main = el('div', 'row-main');
    const concealed = lockedRow(t);
    const nameNode = el('div', 'row-name', concealed ? (chapterText(t) ? `Story trophy · ${chapterText(t)}` : 'Hidden trophy') : trophyTitle(t));
    main.append(nameNode);
    if (concealed) {
      main.append(el('div', 'row-desc', 'Name and description hidden by the spoiler shield.'));
    } else {
      main.append(el('div', 'row-desc', t.description ?? ''));
    }
    const meta = el('div', 'row-meta');
    if (isHidden(t) && !concealed) meta.append(tag('PSN-hidden', 'tag-hidden'));
    if (concealed) meta.append(tag('hidden', 'tag-hidden'));
    if (t.category) meta.append(tag(t.category));
    if (Number.isFinite(t.count)) meta.append(tag(`${userCount(t)}/${t.count}`, 'tag-count'));
    if (Array.isArray(t.steps) && t.steps.length > 0) {
      const cited = t.steps.filter((s) => s && Array.isArray(s.src) && s.src.length > 0).length;
      meta.append(tag(`${cited} src`, 'tag-src'));
    } else if (Array.isArray(t.sources) && t.sources.length > 0) {
      meta.append(tag(`${t.sources.length} src`, 'tag-src'));
    }
    if (isMissable(t)) meta.append(tag(t.at_risk ? 'missable' : 'missable', 'tag-missable'));
    else if (t.at_risk === true) meta.append(tag('at risk', 'tag-missable'));
    if (concealed) {
      const reveal = el('button', 'reveal-btn', 'Reveal');
      reveal.type = 'button';
      reveal.addEventListener('click', (event) => {
        event.stopPropagation();
        state.revealed.add(keyOf(t));
        saveRevealed();
        renderAll();
      });
      meta.append(reveal);
    }
    main.append(meta);
    row.append(main);
    row.addEventListener('click', () => setSelected(keyOf(t)));
    holder.append(row);
  }
}

/* ---------- detail pane ---------- */

function toggleEarned(t) {
  if (!t) return;
  const key = keyOf(t);
  if (state.earned.has(key)) state.earned.delete(key);
  else state.earned.add(key);
  saveEarned();
}

function renderDetail() {
  const pane = document.getElementById('detail-pane');
  pane.replaceChildren();
  const t = selectedTrophy();
  if (!t) {
    pane.append(el('p', 'empty-note', 'No trophy selected.'));
    return;
  }
  const concealed = lockedRow(t);

  const top = el('div', 'detail-top');
  top.append(gradeBadge(t.grade, true));
  const heading = el('div', 'detail-heading');
  heading.append(el('h2', '', concealed ? 'Hidden story trophy' : trophyTitle(t)));
  const fileIndex = state.trophies.findIndex((item) => keyOf(item) === keyOf(t));
  const bits = [];
  if (gradeOf(t) === 'platinum') bits.push('platinum');
  else if (gradeOf(t)) bits.push(`${gradeOf(t)} · #${fileIndex + 1} of ${state.trophies.length}`);
  else bits.push(`#${fileIndex + 1} of ${state.trophies.length}`);
  if (Array.isArray(t.sources) && t.sources.length > 0) bits.push(`${t.sources.length} sources`);
  heading.append(el('p', 'detail-sub', concealed ? 'Concealed by the spoiler shield' : bits.join(' · ')));
  top.append(heading);

  const earn = el('button', 'earn-btn', isEarned(t) ? 'Earned ✓' : 'Mark earned');
  earn.type = 'button';
  earn.addEventListener('click', () => {
    toggleEarned(t);
    renderAll();
  });
  if (isEarned(t)) earn.classList.add('is-earned');
  top.append(earn);
  pane.append(top);

  pane.append(el('p', 'official-quote', concealed ? 'Description hidden until you earn or reveal this trophy.' : (t.description ?? 'No official description recorded.')));
  pane.append(el('p', 'official-note', concealed ? 'Spoiler shield is on' : `${gradeOf(t) || 'grade unknown'} · #${fileIndex + 1} of ${state.trophies.length} · ${statusWord(t)}`));

  const badgeLine = el('div', 'badge-line');
  if (t.missable === 'yes') badgeLine.append(el('span', 'pill pill-missable', 'MISSABLE'));
  if (t.missable === 'possibly') badgeLine.append(el('span', 'pill pill-missable', 'POSSIBLY MISSABLE'));
  if (Array.isArray(t.disputes) && t.disputes.length > 0) badgeLine.append(el('span', 'pill pill-disputed', `SOURCES DIFFER · ${t.disputes.length}`));
  if (t.category) badgeLine.append(el('span', 'pill', t.category));
  if (stageOf(t) !== null) badgeLine.append(el('span', 'pill pill-stage', `Stage ${t.stage}`));
  if (t.chapter) badgeLine.append(el('span', 'pill', t.chapter));
  if (t.at_risk === true) badgeLine.append(el('span', 'pill pill-at-risk', 'AT RISK'));
  if (badgeLine.childNodes.length > 0) pane.append(badgeLine);

  if (Number.isFinite(t.count)) {
    const box = el('div', 'count-box');
    box.append(el('span', 'count-label', 'YOUR COUNT'));
    box.append(el('span', 'count-value', `${userCount(t)} / ${t.count}`));
    const stepper = el('div', 'stepper');
    const minus = el('button', 'step-btn', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'Decrease count');
    minus.addEventListener('click', () => {
      state.counts[keyOf(t)] = Math.max(0, userCount(t) - 1);
      saveCounts();
      renderDetail();
      renderChecklist();
    });
    const plus = el('button', 'step-btn', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Increase count');
    plus.addEventListener('click', () => {
      state.counts[keyOf(t)] = Math.min(Number(t.count), userCount(t) + 1);
      saveCounts();
      renderDetail();
      renderChecklist();
    });
    stepper.append(minus, plus);
    box.append(stepper);
    pane.append(box);
  }

  if (isMissable(t) || t.at_risk === true) {
    const box = el('div', 'missable-box');
    box.append(el('h3', '', 'Missable window'));
    const window = t.window ?? t.missable_window ?? t.missableWindow;
    let text = typeof window === 'string' && window.trim() ? window.trim() : '';
    if (!text) {
      const where = chapterText(t);
      text = where
        ? `${t.at_risk === true && !isMissable(t) ? 'At-risk trophy' : 'Missable trophy'} during ${where}${t.guide ? ` — ${t.guide}` : ''}`
        : `${t.guide ?? 'Check the roadmap before moving on to the next chapter.'}`;
    }
    box.append(el('p', '', text));
    pane.append(box);
  }

  for (const dispute of Array.isArray(t.disputes) ? t.disputes : []) {
    if (!dispute) continue;
    const box = el('div', 'dispute-box');
    box.append(el('h3', '', 'Sources differ — both versions shown'));
    if (dispute.q) box.append(el('p', 'dispute-q', dispute.q));
    const versions = el('div', 'dispute-versions');
    for (const side of ['a', 'b']) {
      const version = dispute[side];
      if (!version) continue;
      const cell = el('div', 'dispute-version');
      cell.append(el('span', 'v-label', side === 'a' ? 'VERSION A' : 'VERSION B'));
      const p = el('p', '', version.text ?? '');
      p.append(citeNodes(version.src, t.sources));
      cell.append(p);
      versions.append(cell);
    }
    box.append(versions);
    if (typeof dispute.call === 'string' && dispute.call.trim()) {
      box.append(el('p', 'dispute-call', `Our call: ${dispute.call.trim()}`));
    }
    pane.append(box);
  }

  const steps = Array.isArray(t.steps) ? t.steps.filter(Boolean) : [];
  if (steps.length > 0) {
    const block = el('div', 'guide-block');
    const title = el('h3', '', `How to earn it — ${steps.length} steps, each with its sources`);
    block.append(title);
    const list = el('ol', 'steps');
    for (const step of steps) {
      const item = document.createElement('li');
      item.append(document.createTextNode(step.text ?? ''));
      item.append(citeNodes(step.src, t.sources));
      list.append(item);
    }
    block.append(list);
    if (t.guide) block.append(el('p', 'guide-summary', t.guide));
    pane.append(block);
  } else if (t.guide) {
    const block = el('div', 'guide-block');
    block.append(el('h3', '', 'Guide'));
    block.append(el('p', 'guide-summary', t.guide));
    pane.append(block);
  } else {
    const block = el('div', 'guide-block');
    block.append(el('h3', '', 'Guide'));
    block.append(el('p', 'empty-note', 'No walkthrough has been added for this trophy yet.'));
    pane.append(block);
  }

  if (concealed) {
    const reveal = el('button', 'earn-btn', 'Reveal this trophy');
    reveal.type = 'button';
    reveal.addEventListener('click', () => {
      state.revealed.add(keyOf(t));
      saveRevealed();
      renderAll();
    });
    pane.append(reveal);
  }
}

/* ---------- rail ---------- */

function sourceMeta(source) {
  const frag = document.createDocumentFragment();
  if (source.read) frag.append(document.createTextNode(`read ${source.read} · `));
  frag.append(document.createTextNode(`${source.claims} claim${source.claims === 1 ? '' : 's'} here / in ${source.guides.size} guide${source.guides.size === 1 ? '' : 's'}`));
  return frag;
}

function renderNextUp() {
  const panel = document.getElementById('next-up-panel');
  panel.replaceChildren();
  const head = el('h3', 'rail-title', 'Next up · roadmap order');
  head.append(el('span', 'rail-count', '5'));
  panel.append(head);
  const upcoming = nextUp(5);
  if (upcoming.length === 0) {
    panel.append(el('p', 'empty-note', 'Every trophy is earned. Platinum secured.'));
    return;
  }
  for (const t of upcoming) {
    const item = el('div', 'next-item');
    item.append(gradeBadge(t.grade, false));
    const body = el('div');
    body.append(el('div', 'next-name', trophyTitle(t)));
    const meta = el('div', 'next-meta');
    const where = chapterText(t);
    if (where) meta.append(el('span', '', where));
    if (isMissable(t) || t.at_risk === true) meta.append(el('span', 'n-missable', 'MISSABLE'));
    body.append(meta);
    item.append(body);
    item.addEventListener('click', () => {
      state.selectedId = keyOf(t);
      showView('tracker');
      renderAll();
      paneScrollTop();
    });
    panel.append(item);
  }
}

function refreshClaimCounts() {
  for (const source of state.registry) source.claims = 0;
  for (const trophy of state.trophies) {
    for (const step of Array.isArray(trophy.steps) ? trophy.steps : []) {
      if (!step || !Array.isArray(step.src)) continue;
      const seen = new Set();
      for (const ref of step.src) {
        const source = resolveRef(ref, trophy.sources);
        if (source && !seen.has(source.n)) {
          source.claims += 1;
          seen.add(source.n);
        }
      }
    }
    for (const dispute of Array.isArray(trophy.disputes) ? trophy.disputes : []) {
      if (!dispute) continue;
      for (const side of ['a', 'b']) {
        const refs = dispute[side] && Array.isArray(dispute[side].src) ? dispute[side].src : [];
        const seen = new Set();
        for (const ref of refs) {
          const source = resolveRef(ref, trophy.sources);
          if (source && !seen.has(source.n)) {
            source.claims += 1;
            seen.add(source.n);
          }
        }
      }
    }
  }
}

function renderSourcesRail() {
  const t = selectedTrophy();
  const panel = document.getElementById('detail-sources-panel');
  panel.replaceChildren();
  const own = Array.isArray(t?.sources) ? t.sources : [];
  const head = el('h3', 'rail-title', 'Sources for this guide');
  head.append(el('span', 'rail-count', own.length));
  panel.append(head);
  if (own.length === 0) {
    panel.append(el('p', 'empty-note', 'No sources recorded for this trophy yet.'));
    return;
  }
  const seen = new Set();
  for (const source of own) {
    if (!source) continue;
    const entry = (source.url && registryFor(source.url)) || (source.key && state.byKey.get(source.key)) || null;
    const number = entry ? entry.n : '';
    if (entry) {
      if (seen.has(entry.n)) continue;
      seen.add(entry.n);
    }
    const item = el('div', 'source-item');
    const line = el('div', 'source-line');
    line.append(el('span', 'source-num', number ? `[${number}]` : '·'));
    const text = el('span');
    text.append(el('span', 'source-site', source.site ?? 'Source'));
    if (source.title) text.append(document.createTextNode(` — ${source.title}`));
    line.append(text);
    item.append(line);
    if (source.url) item.append(el('div', 'source-url', source.url));
    const meta = el('div', 'source-meta');
    if (entry) {
      meta.append(document.createTextNode(`${source.read ? `read ${source.read} · ` : ''}${entry.claims} claim${entry.claims === 1 ? '' : 's'} here / in ${entry.guides.size} guide${entry.guides.size === 1 ? '' : 's'}`));
    } else if (source.read) {
      meta.append(document.createTextNode(`read ${source.read}`));
    }
    item.append(meta);
    panel.append(item);
  }
}

function renderRail() {
  refreshClaimCounts();
  renderNextUp();
  renderSourcesRail();
}

function paneScrollTop() {
  const pane = document.getElementById('detail-pane');
  if (pane) pane.scrollTop = 0;
}

/* ---------- views ---------- */

function showView(view) {
  state.view = view;
  for (const button of document.querySelectorAll('.tab')) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${view}`;
  document.getElementById('filter-chips').hidden = view !== 'tracker';
}

function renderRoadmap() {
  const body = document.getElementById('roadmap-body');
  body.replaceChildren();
  const intro = el('div', 'view-intro');
  intro.append(el('h2', '', 'Roadmap to the platinum'));
  const earned = state.trophies.filter(isEarned).length;
  intro.append(el('p', '', `${earned} of ${state.trophies.length} earned · stages run in playing order`));
  body.append(intro);

  const strip = el('div', 'next-strip');
  const upcoming = nextUp(5);
  if (upcoming.length === 0) strip.append(el('p', 'empty-note', 'Nothing left: every trophy is earned.'));
  for (const t of upcoming) {
    const card = el('div', 'next-card');
    card.append(el('div', 'nc-kicker', 'Next up'));
    card.append(el('div', 'nc-name', trophyTitle(t)));
    card.append(el('div', 'nc-meta', chapterText(t) || 'Unstaged'));
    card.addEventListener('click', () => {
      state.selectedId = keyOf(t);
      showView('tracker');
      renderAll();
    });
    strip.append(card);
  }
  body.append(strip);

  const groups = new Map();
  for (const t of state.trophies) {
    const stage = stageOf(t);
    const key = stage === null ? 'unstaged' : stage;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const [key, list] of groups) { list.sort(roadmapCompare); }
  const keys = [...groups.keys()].sort((a, b) => (a === 'unstaged' ? 99 : a) - (b === 'unstaged' ? 99 : b));
  for (let stage = 1; stage <= 7; stage += 1) {
    if (!groups.has(stage)) groups.set(stage, []);
  }
  if (!groups.has('unstaged')) groups.set('unstaged', []);
  const ordered = [...Array.from({ length: 7 }, (_, i) => i + 1), ...(groups.get('unstaged').length > 0 ? ['unstaged'] : [])];

  for (const key of ordered) {
    const list = groups.get(key) ?? [];
    const section = el('section', 'stage-section');
    const head = el('div', 'stage-head');
    head.append(el('h3', '', key === 'unstaged' ? 'Unstaged' : `Stage ${key}`));
    head.append(el('span', 'stage-count', `${list.length} troph${list.length === 1 ? 'y' : 'ies'} · ${list.filter(isEarned).length} earned`));
    section.append(head);
    if (list.length === 0) {
      section.append(el('p', 'empty-note', 'No trophies are mapped to this stage yet.'));
    } else {
      const rows = el('div', 'stage-list');
      for (const t of list) rows.append(stageRow(t));
      section.append(rows);
    }
    body.append(section);
  }
}

function stageRow(t) {
  const row = el('div', 'stage-row');
  if (isEarned(t)) row.classList.add('is-earned');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = isEarned(t);
  box.setAttribute('aria-label', `Mark ${trophyTitle(t)} earned`);
  box.addEventListener('click', (event) => event.stopPropagation());
  box.addEventListener('change', () => {
    toggleEarned(t);
    renderAll();
  });
  row.append(box);
  row.append(gradeBadge(t.grade, false));
  row.append(el('span', 'sr-name', trophyTitle(t)));
  const tail = el('span', 'sr-flags');
  if (t.chapter) tail.append(el('span', 'sr-chapter', t.chapter));
  if (isMissable(t) || t.at_risk === true) tail.append(el('span', 'mini-flag f-missable', 'missable'));
  row.append(tail);
  row.addEventListener('click', () => {
    state.selectedId = keyOf(t);
    showView('tracker');
    renderAll();
  });
  return row;
}

function renderMissables() {
  const body = document.getElementById('missables-body');
  body.replaceChildren();
  const list = state.trophies
    .filter((t) => isMissable(t) || t.at_risk === true)
    .sort(roadmapCompare);
  const intro = el('div', 'view-intro');
  intro.append(el('h2', '', 'Missable and at-risk trophies'));
  intro.append(el('p', '', `${list.length} flagged · check each window before the chapter closes`));
  body.append(intro);
  if (list.length === 0) {
    body.append(el('p', 'empty-note', 'No trophy is flagged missable or at risk in this data set.'));
    return;
  }
  for (const t of list) {
    const item = el('div', 'missable-item');
    item.append(gradeBadge(t.grade, true));
    const main = el('div');
    main.append(el('div', 'mi-name', trophyTitle(t)));
    const meta = el('div', 'mi-meta');
    if (t.missable === 'yes') meta.append(el('span', 'pill pill-missable', 'MISSABLE'));
    if (t.missable === 'possibly') meta.append(el('span', 'pill pill-missable', 'POSSIBLY MISSABLE'));
    if (t.at_risk === true) meta.append(el('span', 'pill pill-at-risk', 'AT RISK'));
    const where = chapterText(t);
    if (where) meta.append(el('span', '', where));
    if (t.category) meta.append(el('span', '', t.category));
    main.append(meta);
    const window = t.window ?? t.missable_window ?? t.missableWindow;
    let text = typeof window === 'string' && window.trim() ? window.trim() : '';
    if (!text) {
      text = where
        ? `Window: ${where}. ${t.guide ?? 'Finish it before the story moves on.'}`
        : (t.guide ?? 'Check the roadmap before moving on to the next chapter.');
    }
    main.append(el('p', 'mi-window', text));
    item.append(main);
    item.append(el('span', 'mi-cta', 'Open guide'));
    item.addEventListener('click', () => {
      state.selectedId = keyOf(t);
      showView('tracker');
      renderAll();
      paneScrollTop();
    });
    body.append(item);
  }
}

function renderSourcesView() {
  const body = document.getElementById('sources-body');
  body.replaceChildren();
  refreshClaimCounts();
  const intro = el('div', 'view-intro');
  intro.append(el('h2', '', 'Source registry'));
  const sites = new Set(state.registry.map((s) => (s.site || '').toLowerCase()).filter(Boolean)).size;
  intro.append(el('p', '', `${state.registry.length} pages from ${sites} sites · numbered in citation order`));
  body.append(intro);
  if (state.registry.length === 0) {
    body.append(el('p', 'empty-note', 'No sources are registered yet. The guide session will fill the citation registry.'));
    return;
  }
  const head = el('div', 'source-table-head');
  for (const label of ['#', 'Site', 'Title', 'URL', 'Read', 'Claims']) head.append(el('span', '', label));
  body.append(head);
  for (const source of state.registry) {
    const row = el('div', 'source-row');
    row.append(el('span', 'sr-num', `[${source.n}]`));
    row.append(el('span', 'sr-site', source.site || '—'));
    row.append(el('span', 'sr-title', source.title || '—'));
    row.append(el('span', 'sr-url', source.url || '—'));
    row.append(el('span', 'sr-read', source.read || '—'));
    row.append(el('span', 'sr-claims', `cited by ${source.guides.size} of ${state.trophies.length} guides · ${source.claims} claim${source.claims === 1 ? '' : 's'}`));
    body.append(row);
  }
}

/* ---------- filters ---------- */

function chip(label, value, count, cls) {
  const button = el('button', `chip${cls ? ` ${cls}` : ''}`);
  button.type = 'button';
  button.append(document.createTextNode(label));
  if (count !== null) button.append(el('span', 'chip-count', count));
  button.setAttribute('aria-pressed', state.filters.chips.has(value) ? 'true' : 'false');
  if (state.filters.chips.has(value)) button.classList.add('is-on');
  button.addEventListener('click', () => {
    if (state.filters.chips.has(value)) state.filters.chips.delete(value);
    else state.filters.chips.add(value);
    renderChips();
    renderChecklist();
  });
  return button;
}

function renderChips() {
  const holder = document.getElementById('filter-chips');
  holder.replaceChildren();
  const all = el('button', `chip${state.filters.chips.size === 0 ? ' is-on' : ''}`);
  all.type = 'button';
  all.append(document.createTextNode('All'));
  all.append(el('span', 'chip-count', state.trophies.length));
  all.addEventListener('click', () => {
    state.filters.chips.clear();
    renderChips();
    renderChecklist();
  });
  holder.append(all);

  for (const category of CATEGORIES) {
    const count = categoryCount(category);
    if (count > 0) holder.append(chip(category, category, count));
  }
  if (state.trophies.some(isMissable)) holder.append(chip('Missable', 'missable', state.trophies.filter(isMissable).length, 'missable-chip'));
  if (state.trophies.some((t) => Array.isArray(t.disputes) && t.disputes.length > 0)) holder.append(chip('Disputed', 'disputed', state.trophies.filter((t) => Array.isArray(t.disputes) && t.disputes.length > 0).length, 'disputed-chip'));
  if (state.trophies.some(isHidden)) holder.append(chip('PSN-hidden', 'hidden', state.trophies.filter(isHidden).length, 'hidden-chip'));
  holder.append(chip('Not earned', 'unearned', state.trophies.filter((t) => !isEarned(t)).length));
  for (const grade of GRADES) {
    const count = state.trophies.filter((t) => gradeOf(t) === grade).length;
    if (count > 0) holder.append(chip(GRADE_LETTER[grade], grade, count, `grade-chip g-${grade}`));
  }

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'search-box';
  search.placeholder = 'Search name, description…';
  search.value = state.filters.search;
  search.setAttribute('aria-label', 'Search trophies');
  search.addEventListener('input', () => {
    state.filters.search = search.value;
    renderChecklist();
  });
  holder.append(search);
}

/* ---------- header actions ---------- */

function setupActions() {
  document.getElementById('spoiler-toggle').addEventListener('change', (event) => {
    state.shield = event.target.checked;
    saveShield();
    renderAll();
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    const payload = {
      app: 'gta6-trophy-guide',
      version: 1,
      earned: [...state.earned],
      counts: { ...state.counts },
      spoiler: state.shield ? 'on' : 'off',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gta6-trophy-progress.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const importInput = document.getElementById('import-input');
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') return;
      const ids = Array.isArray(parsed.earned) ? parsed.earned : (Array.isArray(parsed.ids) ? parsed.ids : null);
      if (!ids) return;
      const valid = new Set(state.trophies.map(keyOf));
      state.earned = new Set(ids.map((id) => String(id)).filter((id) => valid.has(id)));
      if (parsed.counts && typeof parsed.counts === 'object') {
        const counts = {};
        for (const [key, value] of Object.entries(parsed.counts)) {
          if (valid.has(key) && Number.isFinite(value)) counts[key] = Math.max(0, Math.trunc(value));
        }
        state.counts = counts;
      }
      if (parsed.spoiler === 'on' || parsed.spoiler === 'off') {
        state.shield = parsed.spoiler === 'on';
        saveShield();
      }
      saveEarned();
      saveCounts();
      renderAll();
    } catch {
      /* bad input is ignored silently */
    } finally {
      importInput.value = '';
    }
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      showView(tab.dataset.view);
      if (tab.dataset.view === 'roadmap') renderRoadmap();
      if (tab.dataset.view === 'missables') renderMissables();
      if (tab.dataset.view === 'sources') renderSourcesView();
    });
  }

  document.getElementById('sort-select').addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderChecklist();
  });
}

/* ---------- boot ---------- */

function renderAll() {
  renderHeader();
  renderAudit();
  renderChips();
  renderChecklist();
  renderDetail();
  renderRail();
  renderRoadmap();
  renderMissables();
  renderSourcesView();
}

function showError(message) {
  const error = document.getElementById('load-error');
  error.hidden = false;
  error.textContent = message;
}

function normalise(data) {
  const raw = Array.isArray(data) ? data : (Array.isArray(data?.trophies) ? data.trophies : []);
  return raw.filter((t) => t && typeof t === 'object').map((t, index) => ({ ...t, _file: index }));
}

async function boot() {
  loadState();
  setupActions();
  const params = new URLSearchParams(location.search);
  const override = params.get('data');
  const file = override ? `data/${override.replace(/^.*\//, '')}` : 'data/trophies.json';
  try {
    const response = await fetch(file, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    state.trophies = normalise(data);
    if (state.trophies.length === 0) throw new Error('no trophies in data file');
    buildRegistry(state.trophies);
    if (!state.trophies.some((t) => keyOf(t) === String(state.selectedId))) {
      state.selectedId = keyOf(state.trophies[0]);
    }
    renderAll();
  } catch (error) {
    state.error = String(error?.message ?? error);
    showError(`Could not load ${file}: ${state.error}.`);
    document.getElementById('audit-content').textContent = 'No data loaded.';
    document.getElementById('checklist').replaceChildren(el('p', 'empty-note', 'The trophy data could not be read.'));
    document.getElementById('detail-pane').replaceChildren(el('p', 'empty-note', 'Nothing to show until the data loads.'));
    document.getElementById('next-up-panel').replaceChildren(el('p', 'empty-note', 'No roadmap available.'));
    document.getElementById('detail-sources-panel').replaceChildren(el('p', 'empty-note', 'No sources available.'));
  }
}

boot();
