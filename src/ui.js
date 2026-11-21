import {forwardSpeedRange} from './walk.js';

const paths = {
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.8a2.7 2.7 0 0 1 5.1 1.2c0 1.9-2.6 2.2-2.6 4"/><path d="M12 17h.01"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  motion: '<path d="m5.6 16.6 3.1-8.2m3.2-1.2 5.8 4.6m.4 3.2-2.1 3M4 20h5"/><circle cx="5.2" cy="18.2" r="2"/><circle cx="10" cy="6.5" r="2.4"/><circle cx="19" cy="13.1" r="2.2"/>',
  explode: '<path d="m12 3 8 4.2-8 4.3-8-4.3zM4 12l8 4.2 8-4.2M4 16.6l8 4.4 8-4.4"/>',
  book: '<path d="M12 6C9 4.6 5.8 4.2 3 5v13c2.8-.9 5.9-.4 9 1.4 3.1-1.8 6.2-2.3 9-1.4V5c-2.8-.8-6-.4-9 1zm0 0v13.3"/>',
  camera: '<path d="m12 3 8 4.6v8.8L12 21l-8-4.6V7.6zM4 7.6l8 4.5 8-4.5M12 12v9M8.2 5.4l7.8 4.4"/>',
  frame: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/><circle cx="12" cy="12" r="3"/>',
  expand: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  cursor: '<path d="m5 3 14 9-7 1.8L9 20z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.6V16m0-8.7h.01"/>',
  restart: '<path d="M4 10a8 8 0 1 1 .8 7M4 4v6h6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  assembly: '<path d="m12 2.7 5 2.8-5 2.9-5-2.9zm-5 3v5.6l5 2.9 5-2.9V5.7M7 12l-5 2.9 5 2.8 5-2.8m-10 0v5.3L7 23l5-2.8v-5.3m5-2.9 5 2.9-5 2.8-5-2.8m5 2.8v5.2l5-2.8v-5.2"/>'
};

const query = (selector, parent = document) => parent.querySelector(selector);
const all = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const icon = (name, css = '') => '<svg aria-hidden="true" class="' + css + '" viewBox="0 0 24 24">' + (paths[name] ?? '') + '</svg>';

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}

function actionButton(label, className, onClick) {
  const button = element('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function markPressed(selector, key, value) {
  for (const button of all(selector)) button.setAttribute('aria-pressed', String(button.dataset[key] === value));
}

function rangeFill(range) {
  const fraction = (Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min));
  range.style.setProperty('--fill', Math.max(0, Math.min(100, fraction * 100)) + '%');
}

const jointLabels = { sway: '侧摆关节', hip: '髋关节', knee: '膝关节' };
const initialBounds = { sway: [-15, 15], hip: [-25, 25], knee: [-30, 30] };

export function createUI(onAction) {
  let parts = new Map();
  let groupedParts = new Map();
  const expanded = new Set();
  const collapsedSearchGroups = new Set();
  let currentPart = null;
  let currentLeg = 'LF';
  let messageTimer;
  const search = query('#part-search');
  const partTree = query('#part-tree');
  const selectedPanel = query('#selection');
  const loadingPanel = query('#loading-panel');
  const systemState = query('#system-state');
  const scene = query('#scene');
  const jointRows = new Map();

  for (const placeholder of all('[data-icon]')) placeholder.innerHTML = icon(placeholder.dataset.icon);
  const emit = (action, payload = {}) => onAction?.(action, payload);

  function setMode(mode) {
    if (!query('[data-page="' + mode + '"]')) return;
    markPressed('[data-mode]', 'mode', mode);
    for (const page of all('[data-page]')) page.hidden = page.dataset.page !== mode;
  }

  for (const button of all('[data-mode]')) {
    button.addEventListener('click', () => {
      setMode(button.dataset.mode);
      emit('mode', {mode: button.dataset.mode});
    });
  }

  for (const button of all('[data-view]')) {
    button.addEventListener('click', () => {
      markPressed('[data-view]', 'view', button.dataset.view);
      emit('view', {view: button.dataset.view});
    });
  }
  query('#reset-view').addEventListener('click', () => {
    markPressed('[data-view]', 'view', 'iso');
    emit('resetView');
  });

  const help = query('#help');
  const popover = query('#help-popover');
  function toggleHelp(show) {
    popover.hidden = !show;
    help.setAttribute('aria-expanded', String(show));
  }
  help.addEventListener('click', () => toggleHelp(popover.hidden));
  document.addEventListener('pointerdown', event => {
    if (!popover.hidden && !popover.contains(event.target) && !help.contains(event.target)) toggleHelp(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !popover.hidden) {
      toggleHelp(false);
      help.focus();
    }
  });

  const fullscreen = query('#full-screen');
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await scene.requestFullscreen();
    } catch {
      status('浏览器当前无法切换全屏。');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const label = document.fullscreenElement ? '退出全屏' : '全屏显示视口';
    fullscreen.setAttribute('aria-label', label);
    fullscreen.title = label;
  });

  function status(message) {
    const notice = query('#scene-message');
    clearTimeout(messageTimer);
    notice.hidden = !message;
    notice.textContent = message || '';
    if (message) messageTimer = setTimeout(() => { notice.hidden = true; }, 3700);
  }

  function renderTree() {
    const keywords = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const fragment = document.createDocumentFragment();
    for (const [group, members] of groupedParts) {
      const filtered = !keywords.length ? members : members.filter(part => {
        const searchable = [part.name, part.code, part.id, group].join(' ').toLocaleLowerCase();
        return keywords.every(word => searchable.includes(word));
      });
      if (!filtered.length) continue;
      const open = keywords.length ? !collapsedSearchGroups.has(group) : expanded.has(group);
      const summary = actionButton('', 'group-row', () => {
        if (keywords.length) {
          if (open) collapsedSearchGroups.add(group);
          else collapsedSearchGroups.delete(group);
        } else if (open) expanded.delete(group);
        else expanded.add(group);
        renderTree();
        all('.group-row', partTree).find(button => button.dataset.group === group)?.focus({preventScroll: true});
      });
      summary.setAttribute('aria-expanded', String(open));
      summary.dataset.group = group;
      summary.innerHTML = icon('assembly');
      summary.append(element('span', null, group), element('span', 'group-count', filtered.length));
      summary.insertAdjacentHTML('beforeend', icon('chevron', 'chevron'));
      fragment.append(summary);
      if (!open) continue;
      for (const part of filtered) {
        const row = actionButton('', 'part-row', () => emit('select', {id: part.id}));
        row.dataset.id = String(part.id);
        row.setAttribute('aria-pressed', String(currentPart === part.id));
        row.title = [part.name, part.code].filter(Boolean).join(' · ');
        row.innerHTML = icon('box');
        row.append(element('span', null, part.name || part.id));
        fragment.append(row);
      }
    }
    if (!fragment.childNodes.length && parts.size) fragment.append(element('div', 'search-empty', '没有找到匹配的零件。'));
    partTree.replaceChildren(fragment);
  }
  search.addEventListener('input', () => {
    collapsedSearchGroups.clear();
    renderTree();
  });

  function select(id, state = {}) {
    currentPart = id;
    const part = parts.get(id);
    selectedPanel.replaceChildren();
    const heading = element('div', 'selection-heading');
    heading.innerHTML = icon('cursor');
    heading.append(document.createTextNode(part ? '已选零件' : '选择零件'));
    selectedPanel.append(heading);
    if (!part) {
      selectedPanel.append(element('p', null, '点击三维模型或列表中的零件，可查看和拆装。'));
    } else {
      selectedPanel.append(element('div', 'selection-name', part.name));
      const detail = [part.group, part.code].filter(Boolean).join(' · ');
      if (detail) selectedPanel.append(element('p', null, detail));
      if (state.hint) selectedPanel.append(element('p', null, state.hint));
      const action = state.removed ? 'restore' : 'remove';
      const button = actionButton(state.removed ? '装回原位' : '拆下零件', 'primary', () => emit(action, {id}));
      button.disabled = state.removed ? state.canRestore === false : state.canRemove === false;
      selectedPanel.append(button);
      if (!expanded.has(part.group)) {
        expanded.add(part.group);
        renderTree();
      }
    }
    for (const row of all('.part-row', partTree)) row.setAttribute('aria-pressed', String(part && row.dataset.id === String(part.id)));
  }

  function ready({parts: partList = [], joints = 12} = {}) {
    parts = new Map(partList.map(part => [part.id, {...part, group: String(part.group || '其他部件')}]));
    groupedParts = new Map();
    for (const part of parts.values()) {
      if (!groupedParts.has(part.group)) groupedParts.set(part.group, []);
      groupedParts.get(part.group).push(part);
    }
    query('#part-count').textContent = parts.size.toLocaleString();
    query('#joint-count').textContent = String(joints);
    loadingPanel.hidden = true;
    systemState.className = 'system-state ready';
    query('span', systemState).textContent = '模型就绪';
    renderTree();
    select(null);
  }

  function loading(message = '正在读取装配模型') {
    loadingPanel.hidden = false;
    query('.loader', loadingPanel).hidden = false;
    query('#loading-text').textContent = message;
    systemState.className = 'system-state';
    query('span', systemState).textContent = '正在加载';
  }

  function error(message) {
    loadingPanel.hidden = false;
    query('.loader', loadingPanel).hidden = true;
    query('#loading-text').textContent = message || '模型加载失败';
    systemState.className = 'system-state error';
    query('span', systemState).textContent = '加载失败';
  }

  for (const button of all('[data-leg]')) {
    button.addEventListener('click', () => {
      currentLeg = button.dataset.leg;
      markPressed('[data-leg]', 'leg', currentLeg);
      emit('leg', {leg: currentLeg});
    });
  }

  for (const [joint, name] of Object.entries(jointLabels)) {
    const row = element('div', 'range-row');
    const labelRow = element('div', 'range-title');
    const label = element('label', null, name);
    label.htmlFor = 'joint-' + joint;
    const output = element('output', null, '0°');
    output.htmlFor = label.htmlFor;
    labelRow.append(label, output);
    const range = element('input');
    range.id = label.htmlFor;
    range.type = 'range';
    range.min = initialBounds[joint][0];
    range.max = initialBounds[joint][1];
    range.step = '1';
    range.value = '0';
    const limits = element('div', 'range-limits');
    const min = element('span');
    const max = element('span');
    limits.append(min, max);
    row.append(labelRow, range, limits);
    query('#joint-sliders').append(row);
    jointRows.set(joint, {range, output, min, max});
    range.addEventListener('input', () => {
      output.textContent = range.value + '°';
      rangeFill(range);
      emit('joint', {leg: currentLeg, joint, value: Number(range.value)});
    });
  }

  function setJoints(values = {}, bounds = {}) {
    for (const [joint, {range, output, min, max}] of jointRows) {
      if (bounds?.[joint]) [range.min, range.max] = bounds[joint];
      if (Number.isFinite(values?.[joint])) range.value = String(values[joint]);
      output.textContent = range.value + '°';
      min.textContent = range.min + '°';
      max.textContent = range.max + '°';
      rangeFill(range);
    }
  }

  for (const button of all('[data-pose]')) button.addEventListener('click', () => emit('pose', {pose: button.dataset.pose}));

  const speedRange = query('#walk-speed');
  const speedOutput = query('#walk-speed-value');
  speedRange.min = String(forwardSpeedRange.min * 100);
  speedRange.max = String(forwardSpeedRange.max * 100);
  speedRange.value = String(forwardSpeedRange.default * 100);
  query('#walk-speed-min').textContent = speedRange.min + ' cm/s';
  query('#walk-speed-max').textContent = speedRange.max + ' cm/s';
  let forwardSpeed;
  function updateWalkSpeed() {
    const cmPerSecond = speedRange.valueAsNumber;
    forwardSpeed = cmPerSecond / 100;
    speedOutput.value = cmPerSecond.toFixed(1) + ' cm/s';
    speedRange.setAttribute('aria-valuetext', cmPerSecond.toFixed(1) + ' 厘米每秒');
    rangeFill(speedRange);
  }
  speedRange.addEventListener('input', updateWalkSpeed);
  updateWalkSpeed();

  const explodeRange = query('#explode-range');
  function setExplode(value) {
    explodeRange.value = String(Math.round(Math.min(1, Math.max(0, value)) * 100));
    query('#explode-value').textContent = explodeRange.value + '%';
    rangeFill(explodeRange);
  }
  function changeExplode(value) {
    setExplode(value);
    emit('explode', {value});
  }
  explodeRange.addEventListener('input', () => changeExplode(Number(explodeRange.value) / 100));
  for (const button of all('[data-explosion]')) button.addEventListener('click', () => changeExplode(Number(button.dataset.explosion)));

  const chapterSelect = element('select', 'chapter-select');
  chapterSelect.hidden = true;
  chapterSelect.setAttribute('aria-label', '选择装配章节');
  query('.step-card').before(chapterSelect);
  chapterSelect.addEventListener('change', () => emit('chapter', {id: chapterSelect.value}));
  function setChapters(chapters = [], activeId) {
    chapterSelect.replaceChildren(...chapters.map(chapter => {
      const option = element('option', null, chapter.title);
      option.value = chapter.id;
      return option;
    }));
    chapterSelect.hidden = !chapters.length;
    if (activeId != null) chapterSelect.value = String(activeId);
  }

  const targetList = element('div', 'guide-targets');
  query('.step-card').append(targetList);
  for (const button of all('[data-step]')) button.addEventListener('click', () => emit('step', {direction: button.dataset.step}));
  function setStep(step = {}) {
    const {index = 0, total = 0, title = '', text = '', source = '', action = '', complete = false, canNext = true, targets = []} = step;
    query('#guide-title').textContent = title;
    query('#guide-text').textContent = text;
    query('#guide-source').textContent = source;
    query('#guide-index').textContent = Math.min(index + 1, total) + ' / ' + total;
    const progress = query('#guide-progress');
    progress.max = Math.max(total, 1);
    progress.value = complete ? total : Math.min(index, total);
    query('[data-step="prev"]').disabled = index <= 0 && !complete;
    const next = query('#next-step');
    next.textContent = action || (complete ? '已完成' : '下一步');
    next.disabled = complete || !canNext;
    targetList.replaceChildren(...targets.map(target => actionButton(target.name || String(target.id), '', () => emit('select', {id: target.id}))));
  }

  select(null);
  setJoints();
  setExplode(0);
  return {ready, select, setJoints, setExplode, setStep, setChapters, status, error, loading, setMode,
    get forwardSpeed() { return forwardSpeed; }
  };
}
