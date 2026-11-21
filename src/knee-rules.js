import {screwAxesFit} from './screw-fit.js';

// The six station hole numbers follow the bolt circle clockwise on the output face.
export const COURSE_VERSION = 'BPX-K01.1';
const MANUAL = 'C2P20724 改1';
const MODES = ['practice', 'exam', 'demo'];
const DEFECTS = ['normal', 'loose', 'missing'];
const STATES = ['empty', 'preloaded', 'tight'];
const HOLE_TEXT = {empty:'空孔，未见螺钉', preloaded:'有预装签记，尚无终紧签记', tight:'已预装，终紧签记齐全'};
const UNDO = Symbol('committed steps');

const good = (code, message) => ({ok:true, code, message});
const bad = (code, message) => ({ok:false, code, message});
const isHole = value => Number.isInteger(value) && value >= 1 && value <= 6;
const pairNumber = hole => (hole - 1) % 3 + 1;
export const oppositeHole = hole => isHole(hole) ? (hole + 2) % 6 + 1 : null;

function makeAttempt({id, mode, student, defect, defectHole, createdAt}) {
  const inspectionHoles = Array(6).fill('tight');
  if (defect !== 'normal') inspectionHoles[defectHole - 1] = defect === 'missing' ? 'empty' : 'preloaded';
  const attempt = {
    id, version:COURSE_VERSION, manualVersion:MANUAL, mode, student, leg:mode === 'exam' ? 'RF' : 'LF',
    createdAt, submittedAt:null, stage:'kit', holes:Array(6).fill('empty'), aligned:false, pendingOpposite:null,
    inspection:{defect, hole:defect === 'normal' ? null : defectHole, holes:inspectionHoles, checked:[], verified:false},
    events:[],
  };
  Object.defineProperty(attempt, UNDO, {value:[]});
  return attempt;
}

export function createAttempt(options = {}) {
  const mode = MODES.includes(options.mode) ? options.mode : 'practice';
  const defect = DEFECTS.includes(options.defect) ? options.defect : 'loose';
  return makeAttempt({
    id:options.id || globalThis.crypto.randomUUID(), mode, student:String(options.student ?? '').trim().slice(0, 80),
    defect, defectHole:isHole(options.defectHole) ? options.defectHole : 1 + Math.floor(Math.random() * 6),
    createdAt:new Date().toISOString(),
  });
}

// Only workshop state is reversible. First attempts and rejected operations remain in the event log.
function checkpoint(a) {
  return {
    stage:a.stage, aligned:a.aligned, pendingOpposite:a.pendingOpposite, holes:a.holes.slice(),
    inspection:{...a.inspection, holes:a.inspection.holes.slice(), checked:a.inspection.checked.slice()},
  };
}

function kitChecks(a, input) {
  return [
    input.side === (a.leg === 'LF' ? 'L' : 'R'), input.motor === 'KNEE',
    input.spec === 'M3×8', input.count === 6,
  ];
}

const ACTION_FIELDS = {
  kit:['side','motor','spec','count'], seat:['face','slot','blocked'], preload:['hole','tool','blocked','lateralMm','tiltDeg'],
  align:[], tighten:['hole','tool'], check:['hole'], judge:['decision','hole','reason'], repair:['hole'],
  recheck:[], submit:[], undo:[], hint:['level'],
};

function cleanAction(input) {
  if (!input || !Object.hasOwn(ACTION_FIELDS, input.type)) return null;
  const action = {type:input.type};
  for (const key of ACTION_FIELDS[input.type]) {
    const value = input[key];
    if (value == null) continue;
    if ((key === 'lateralMm' || key === 'tiltDeg') && !Number.isFinite(value)) return null;
    if (key === 'blocked' && typeof value !== 'boolean') return null;
    if (typeof value === 'string' && value.length <= 80 || Number.isFinite(value) || typeof value === 'boolean') {
      action[key] = value;
    } else return null;
  }
  return action;
}

const STAGE_FOR = {
  kit:'kit', seat:'seat', preload:'fasten', align:'fasten', tighten:'fasten', judge:'inspect',
  repair:'repair', recheck:'repair', submit:'done',
};

function transition(a, input, at) {
  const {type, hole} = input;
  if (a.submittedAt) return type === 'submit' ? good('submitted', '工单已经提交。') : bad('closed', '已提交的工单已归档。');
  if (STAGE_FOR[type] && a.stage !== STAGE_FOR[type]) return bad('stage', '请先完成当前工序。');
  if (['preload','tighten','check','repair'].includes(type) && !isHole(hole)) return bad('hole', '请先选择一个孔位。');
  const index = hole - 1;
  switch (type) {
    case 'kit': {
      if (!['side','motor','spec'].every(k => typeof input[k] === 'string' && input[k]) || !Number.isInteger(input.count)) {
        return bad('incomplete', '请填写腿件、电机、紧固件规格与数量。');
      }
      const checks = kitChecks(a, input);
      if (!checks.every(Boolean)) {
        const labels = ['腿件钢印','电机类型','螺钉规格','领料数量'];
        return bad('kit', a.mode === 'exam' ? '领料单与本工单不符，请查图复核。' :
          '请对照工艺图检查' + labels.filter((_, i) => !checks[i]).join('、') + '。');
      }
      a.stage = 'seat';
      return good('kit', '备料齐套，可选择安装面和安装槽。');
    }
    case 'seat':
      if (!input.face || !input.slot) return bad('incomplete', '请选择安装面与目标安装槽。');
      if (input.face !== 'arrow' || input.slot !== 'lower') return bad('orientation', '工件无法按当前朝向入座，请核对安装面与槽位。');
      if (input.blocked) return bad('blocked', '入座路径受阻，请退回并重新对正。');
      a.stage = 'fasten';
      return good('seat', '膝电机已入座，开始逐孔预装。');
    case 'preload':
      if (a.holes[index] !== 'empty') return bad('occupied', '该孔已有螺钉。');
      if (input.tool !== 'hex') return bad('tool', '刀头与螺钉不匹配。');
      if (input.blocked || !screwAxesFit('M3×8', input.lateralMm ?? 0, input.tiltDeg ?? 0)) {
        return bad('blocked', '螺钉轴线与安装孔未对正。退出并调整后重试。');
      }
      a.holes[index] = 'preloaded';
      return good('preload', hole + ' 号孔已预装。');
    case 'align':
      if (a.holes.includes('empty')) return bad('empty', '尚有空孔，需先完成所有孔位的预装。');
      if (a.aligned) return good('aligned', '配合面已复核。');
      a.aligned = true;
      return good('align', '六孔已预装，配合面复核完成。');
    case 'tighten': {
      if (a.holes.includes('empty') || !a.aligned) return bad('early', '终紧条件未齐，请检查六孔预装和对齐记录。');
      if (a.holes[index] === 'tight') return bad('occupied', '该孔已经终紧。');
      if (input.tool != null && input.tool !== 'hex') return bad('tool', '刀头与螺钉不匹配。');
      if (a.pendingOpposite && hole !== a.pendingOpposite) {
        return {...bad('order', '当前对孔组尚未完成，请复核紧固顺序。'), pair:pairNumber(a.pendingOpposite)};
      }
      const completedPair = a.pendingOpposite !== null;
      a.pendingOpposite = completedPair ? null : oppositeHole(hole);
      a.holes[index] = 'tight';
      if (a.holes.every(state => state === 'tight')) a.stage = 'inspect';
      const message = a.stage === 'inspect' ? '六孔固定完成。下一步请独立检查一件交接工件。' : hole + ' 号孔已终紧。';
      return {...good(completedPair ? 'pair' : 'tighten', message), pair:pairNumber(hole)};
    }
    case 'check':
      if (!['inspect','repair'].includes(a.stage)) return bad('stage', '交检工件尚未发放。');
      if (!a.inspection.checked.includes(hole)) a.inspection.checked.push(hole);
      return good('check', hole + ' 号孔 · ' + HOLE_TEXT[a.inspection.holes[index]] + '。');
    case 'judge': {
      const {decision, reason} = input;
      if (!['pass','repair'].includes(decision)) return bad('incomplete', '请选择移交或返修。');
      if (decision === 'repair' && (!isHole(hole) || !['loose','missing'].includes(reason))) {
        return bad('incomplete', '请填写返修孔位与缺陷类型。');
      }
      const task = a.inspection;
      if (!task.checked.length || (decision === 'repair' && !task.checked.includes(hole))) {
        return bad('evidence', '请先查看拟判定孔位的工件记录。');
      }
      if (decision === 'pass' && task.checked.length !== 6) return bad('evidence', '放行前请逐孔复核六处记录。');
      if (decision === 'pass' ? task.defect !== 'normal' : hole !== task.hole || reason !== task.defect) {
        if (a.mode !== 'exam' && decision === 'pass') {
          const state = task.holes[task.hole - 1];
          const finding = state === 'empty' ? '缺少螺钉' : '已预装，尚未终紧';
          return bad('diagnosis', task.hole + ' 号孔' + finding + '。请选中该孔，选择「返修」并填写原因。');
        }
        return bad('diagnosis', '请对照各孔已查记录，复核整件交检结论和返修项。');
      }
      a.stage = 'repair';
      return good('judge', decision === 'pass' ? '六孔交检记录齐全，可完成复检。' : '缺陷定位正确，请执行返修。');
    }
    case 'repair': {
      const state = a.inspection.holes[index];
      if (state === 'tight') return bad('intact', '该孔已终紧，未产生返修动作。');
      a.inspection.holes[index] = STATES[STATES.indexOf(state) + 1];
      return good('repair', hole + (state === 'empty' ? ' 号孔已补钉预装，还需终紧。' : ' 号孔已补紧。'));
    }
    case 'recheck':
      if (!a.inspection.holes.every(state => state === 'tight')) return bad('unfinished', '工件尚有未完成的固定点，继续返修后复检。');
      a.inspection.verified = true;
      a.stage = 'done';
      return good('recheck', '复检通过，可以提交工单。');
    case 'submit':
      a.submittedAt = at;
      return good('submitted', '工单已提交。');
    case 'hint':
      if (a.mode === 'exam') return bad('exam', '独立考核可查阅工艺图。');
      if (![1,2,3].includes(input.level)) return bad('incomplete', '请选择提示级别。');
      return good('hint', '已查看第 ' + input.level + ' 级提示。');
    case 'undo': {
      const prior = a[UNDO].pop();
      if (!prior) return bad('nothing', '当前没有可撤销的操作。');
      Object.assign(a, prior);
      return good('undo', '已撤销上一次成功操作。');
    }
  }
}

function perform(a, action, at) {
  const before = checkpoint(a);
  const previousEvent = a.events.at(-1);
  const result = transition(a, action, at);
  if (a.submittedAt && (action.type !== 'submit' || previousEvent?.type === 'submit')) return result;
  if (result.code === 'incomplete' || result.code === 'hole' || result.code === 'stage' || result.code === 'exam') return result;
  if (result.code === 'aligned' || result.code === 'occupied') return result;
  if (result.code === 'check' && before.inspection.checked.includes(action.hole)) return result;
  // Double clicks and held keys must not produce duplicate submissions or duplicate penalties.
  if (!result.ok && previousEvent?.code === result.code && previousEvent.stage === before.stage &&
      JSON.stringify(previousEvent.action) === JSON.stringify(action)) return result;
  if (result.ok && !['undo','hint','submit'].includes(action.type)) a[UNDO].push(before);
  a.events.push({seq:a.events.length + 1, at, stage:before.stage, type:action.type, action, ...result});
  return result;
}

export function applyAction(attempt, input) {
  const action = cleanAction(input);
  if (!action) return bad('invalid', '操作格式无效。');
  const previousTime = attempt.events.at(-1)?.at ?? attempt.createdAt;
  const now = new Date().toISOString();
  return perform(attempt, action, now < previousTime ? previousTime : now);
}

export function previewAction(attempt, input) {
  const action = cleanAction(input);
  if (!action) return bad('invalid', '操作格式无效。');
  const trial = {...attempt, ...checkpoint(attempt)};
  Object.defineProperty(trial, UNDO, {value:attempt[UNDO].slice()});
  return transition(trial, action, new Date().toISOString());
}

export function scoreAttempt(a) {
  const evidence = a.events;
  const first = type => evidence.find(e => e.type === type);
  const firstKit = first('kit')?.action;
  const kit = firstKit ? 5 * kitChecks(a, firstKit).filter(Boolean).length : 0;
  const firstSeat = first('seat')?.action;
  let seat = 0;
  if (firstSeat) {
    const face = firstSeat.face === 'arrow', slot = firstSeat.slot === 'lower';
    seat = 5 * (Number(face) + Number(slot) + Number(face && slot) + Number(!['kit','seat'].includes(a.stage)));
  }
  let fasten = a.holes.filter(s => s !== 'empty').length * 2;
  const firstTighten = first('tighten');
  if (a.aligned && firstTighten && firstTighten.code !== 'early') fasten += 8;
  for (const pair of [1,2,3]) {
    const finished = a.holes[pair-1] === 'tight' && a.holes[pair+2] === 'tight';
    if (finished && !evidence.some(e => e.code === 'order' && e.pair === pair)) fasten += 5;
  }
  const firstJudgment = evidence.find(e => e.type === 'judge' && e.code !== 'evidence')?.action;
  let inspection = 0;
  if (firstJudgment) {
    const normal = a.inspection.defect === 'normal';
    const decisionCorrect = firstJudgment.decision === (normal ? 'pass' : 'repair');
    const locationCorrect = normal ? decisionCorrect : decisionCorrect && firstJudgment.hole === a.inspection.hole && firstJudgment.reason === a.inspection.defect;
    inspection = 5 * Number(decisionCorrect) + 10 * Number(locationCorrect) + 10 * Number(a.inspection.verified);
  }
  const total = kit + seat + fasten + inspection;
  return {kit,seat,fasten,inspection,total,passed:a.inspection.verified && total >= 80};
}

function isDate(value) {
  return typeof value === 'string' && value.length === 24 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

// Reconstruct only from original task metadata and logged actions. Ignore cached scores, flags and workpiece state.
export function restoreAttempt(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.version !== COURSE_VERSION || data.manualVersion !== MANUAL || !MODES.includes(data.mode) ||
        typeof data.id !== 'string' || !data.id.length || data.id.length > 100 ||
        typeof data.student !== 'string' || data.student.length > 80 || !isDate(data.createdAt) ||
        !Array.isArray(data.events)) return null;
    const {defect,hole} = data.inspection || {};
    if (!DEFECTS.includes(defect) || (defect === 'normal' ? hole !== null : !isHole(hole))) return null;
    const a = makeAttempt({...data, defect, defectHole:hole});
    for (const entry of data.events) {
      const action = cleanAction(entry.action);
      const expectedSeq = a.events.length + 1;
      const precedingTime = a.events.at(-1)?.at ?? a.createdAt;
      if (!action || entry.seq !== expectedSeq || entry.type !== action.type || !isDate(entry.at) || entry.at < precedingTime) return null;
      perform(a, action, entry.at);
      const generated = a.events.at(-1);
      if (generated?.seq !== expectedSeq || generated.ok !== entry.ok || generated.code !== entry.code || generated.stage !== entry.stage) return null;
    }
    return a;
  } catch {
    return null;
  }
}
