import {MathUtils, Matrix4, Vector3} from 'three';

const {clamp, degToRad} = MathUtils;
const LEG_CODES = ['LF', 'RF', 'LR', 'RR'];
const ROLL_AXIS = new Vector3(0, 0, 1);
const PITCH_AXIS = new Vector3(1, 0, 0);
const ORIGIN = new Vector3();
const IDENTITY = new Matrix4();

export function poseAngles(pose = 'stand') {
  const result = {};
  for (const leg of LEG_CODES) {
    let sway = 0;
    let hip = 0;
    let knee = 0;
    if (pose === 'crouch' || pose === 'liftRF') {
      // This folding range clears the side plates and the cassette entry.
      hip = 2;
      knee = 45;
      if (pose === 'liftRF' && leg === 'RF') {
        sway = 5;
        hip = -15;
        knee = 45;
      }
    }
    result[leg] = {sway, hip, knee};
  }
  return result;
}

function revolve(target, pivot, axis, radians) {
  target.makeRotationAxis(axis, radians);
  // Translation p - R*p makes p a fixed point of the rotation.
  const e = target.elements;
  const {x, y, z} = pivot;
  e[12] = x - (e[0]*x + e[4]*y + e[8]*z);
  e[13] = y - (e[1]*x + e[5]*y + e[9]*z);
  e[14] = z - (e[2]*x + e[6]*y + e[10]*z);
  return target;
}

function memberGroup(path,part) {
  if (path.includes('侧摆电机组件')) {
    return path.includes('减速器组件') ? 'roll' : 'fixed';
  }
  // The run along the stator is fixed with the driver-side plug.
  if(part==='0:1:1:20' || part==='0:1:1:52')return 'fixed';
  if (path.includes('侧摆到髋连接') && !path.includes('软垫')) {
    return path.includes('驱动器端固定块') || part==='0:1:1:50' ? 'fixed' : 'roll';
  }
  if(path.includes('髋膝连接线') && path.includes('驱动器端固定块'))return 'roll';
  if (path.includes('髋关节电机组件')) {
    return path.includes('减速器组件') ? 'thigh' : 'roll';
  }
  if (path.includes('膝关节电机组件')) {
    return path.includes('减速器组件') ? 'crank' : 'thigh';
  }
  if (path.includes('小腿连杆')) return 'link';
  if (/大腿舵臂|舵臂塞打/.test(path)) return 'crank';
  if (/小腿|足端/.test(path)) return 'shin';
  if (/大腿|侧面上盖|膝关节销|髋膝|转子线扣/.test(path)) return 'thigh';
  return 'roll';
}

function explodeVector(node, leg, group, machineCenter) {
  const n = node.name;
  const p = new Vector3().fromArray(node.center || machineCenter);
  if (leg) {
    const side = leg[0] === 'L' ? 1 : -1;
    const front = leg[1] === 'F' ? 1 : -1;
    const v = new Vector3(side*175, 48, front*112);
    if (group === 'fixed') v.z += front*42;
    if (group === 'thigh') v.x += side*52;
    if (group === 'crank') v.x += side*85;
    if (group === 'link') v.x += side*122;
    if (group === 'shin') v.add(new Vector3(side*72, 3, front*50));
    if (/足端/.test(n)) v.z += front*48;
    if (/外侧|侧面上盖/.test(n)) v.x += side*62;
    return v;
  }
  const dx = p.x-machineCenter[0], dz = p.z-machineCenter[2];
  if (/电池/.test(n)) return new Vector3(-158, 190, 0);
  if (/电控|主板|PCB|控制器|驱动板/i.test(n)) return new Vector3(0, 170, 0);
  if (/缓冲垫/.test(n)) return new Vector3(dx*.25, 2, dz*.38);
  return new Vector3(dx*.55, 38+Math.max(0,(p.y-machineCenter[1])*.6), dz*.42);
}

export function createMechanics(assembly, calibration) {
  const nodes = new Map(assembly.nodes.map(node => [node.id, node]));
  const root = assembly.nodes.find(node => !nodes.has(node.parent)) || assembly.nodes[0];
  const machineCenter = root?.center || [-60, 50, 983];
  const body = new Matrix4();
  const moving = new Map();
  const legs = {};
  let restFloor = Infinity;
  let fixedBottom = Infinity;

  for (const [code, def] of Object.entries(calibration.legs)) {
    const leg = {side: code[0] === 'L' ? 1 : -1, states: {}};
    for (const key of ['roll', 'hip', 'kneePin', 'crankPin', 'linkPin', 'ankle']) {
      leg[key] = new Vector3().fromArray(def[key]);
    }
    // Support vertices sampled on the STEP foot keep the whole body on the floor.
    leg.sole = (def.soleSupportPoints || [def.ankle]).map(p => new Vector3().fromArray(p));
    for (const p of leg.sole) restFloor = Math.min(restFloor, p.y);
    for (const group of ['roll', 'thigh', 'crank', 'link', 'shin']) leg.states[group] = new Matrix4();
    legs[code] = leg;
  }

  function ancestorNames(node) {
    const names = [];
    for (let item = node; item; item = nodes.get(item.parent)) names.unshift(item.name);
    return names.join('/');
  }
  const assemblyParents = new Set(assembly.nodes.map(node => node.parent));
  for (const node of assembly.nodes) {
    const path = ancestorNames(node);
    const code = LEG_CODES.find(key => path.includes(calibration.legs[key].name+'腿组件'));
    const group = code ? memberGroup(path,node.part) : 'fixed';
    const v = explodeVector(node, code, group, machineCenter);
    if (!code && path.includes('电池组')) v.set(-158,190,0);
    else if (!code && path.includes('电控盒模块')) v.y += 85;
    let remove;
    if (code) {
      const side = code[0] === 'L' ? 1 : -1;
      const front = code[1] === 'F' ? 1 : -1;
      remove = /侧摆电机|侧摆关节定子壳|C2侧摆驱动器盖/.test(node.name)
        ? new Vector3(0,0,front*136) : new Vector3(side*145,0,0);
    } else if (path.includes('电池组')) {
      remove = new Vector3(-220,0,0);
    } else {
      const direction = new Vector3().fromArray(node.center || machineCenter)
        .sub(new Vector3().fromArray(machineCenter));
      direction.y = Math.max(36,direction.y);
      remove = direction.normalize().multiplyScalar(145);
    }
    // The viewer can pass an authored constrained removal direction on any part.
    if (node.removalAxis) remove.fromArray(node.removalAxis).normalize().multiplyScalar(145);
    const matrix = code && group !== 'fixed' ? legs[code].states[group] : body;
    moving.set(node.id, {matrix, code, group, explode:v, remove});
    if (group === 'fixed' && Array.isArray(node.min) && (node.geometry || !assemblyParents.has(node.id))) {
      fixedBottom = Math.min(fixedBottom, node.min[1]);
    }
  }

  const temp = new Matrix4();
  const p = new Vector3();
  const q = new Vector3();
  const v = new Vector3();
  function update(angles = {}, options = {}) {
    let bottom = fixedBottom;
    for (const [code, leg] of Object.entries(legs)) {
      const state = angles[code] || {};
      const roll = clamp(state.roll ?? state.sway ?? 0, ...calibration.limits.roll);
      const hip = clamp(state.hip || 0, ...calibration.limits.hip);
      const knee = clamp(state.knee || 0, ...calibration.limits.knee);
      const m = leg.states;
      revolve(m.roll, leg.roll, ROLL_AXIS, degToRad(roll * leg.side));
      revolve(m.thigh, leg.hip, PITCH_AXIS, degToRad(hip));
      revolve(m.crank, leg.hip, PITCH_AXIS, degToRad(hip-knee));
      // Crank and lower shank remain parallel. The long rod stays parallel
      // to the thigh and translates until its upper bore coincides with the crank.
      p.copy(leg.crankPin).applyMatrix4(m.crank);
      q.copy(leg.crankPin).applyMatrix4(m.thigh);
      v.subVectors(p, q);
      m.link.copy(m.thigh);
      m.link.elements[12] += v.x;
      m.link.elements[13] += v.y;
      m.link.elements[14] += v.z;
      revolve(temp, leg.kneePin, PITCH_AXIS, degToRad(-knee));
      m.shin.multiplyMatrices(m.thigh, temp);
      for (const group of ['thigh','crank','link','shin']) m[group].premultiply(m.roll);
      for (const footPoint of leg.sole) {
        bottom = Math.min(bottom, p.copy(footPoint).applyMatrix4(m.shin).y);
      }
    }
    if (options.bodyMatrix || options.ground === false) {
      body.copy(options.bodyMatrix || IDENTITY);
      for (const leg of Object.values(legs)) {
        for (const matrix of Object.values(leg.states)) matrix.premultiply(body);
      }
      return body.elements[13];
    }
    const rise = restFloor-bottom;
    body.makeTranslation(0,rise,0);
    for (const leg of Object.values(legs)) {
      for (const matrix of Object.values(leg.states)) matrix.elements[13] += rise;
    }
    return rise;
  }

  const offset = (id, t, key, out = new Vector3()) =>
    out.copy(moving.get(id)?.[key] || ORIGIN).multiplyScalar(clamp(t,0,1));

  update();
  return {
    update,
    matrixFor: id => moving.get(id)?.matrix || body,
    legFor: id => moving.get(id)?.code,
    groupFor: id => moving.get(id)?.group,
    explodeOffset: (id, fraction, out) => offset(id, fraction, 'explode', out),
    removalOffset: (id, fraction, out) => offset(id, fraction, 'remove', out),
  };
}
