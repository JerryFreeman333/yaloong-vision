import {alignServiceDatums} from './service-datums.js';
import {
  BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Vector3
} from 'three';

const dimensions = {
  'M3×8': {diameter: 3, length: 8, pitch: 0.5, head: 5.5, socket: 2.5, socketDepth: 1.4},
  'M6×16': {diameter: 6, length: 16, pitch: 1, head: 10, socket: 5, socketDepth: 3},
  'M6×22': {diameter: 6, length: 22, pitch: 1, head: 10, socket: 5, socketDepth: 3}
};

const roleNames = {
  frameBase: '底架', controlBox: '电控盒', frameBracket: '框架支撑件', buffer: '缓冲垫',
  kneeMotor: '膝电机输出端', thighClamp: '大腿抱箍', hipKneeClamp: '髋膝抱箍',
  hipRoll: '侧摆与髋关节', legClamp: '躯干抱箍', handle: '把手', bodyWire: '躯干线束', hipWire: '髋关节线束'
};

const legs = {LF: '左前', RF: '右前', LR: '左后', RR: '右后'};

// The head sits on Y=0. The shaft enters the bore along -Y and the socket opens toward +Y.
function screwGeometry({diameter, length, pitch, head, socket, socketDepth}) {
  const positions = [];
  const indices = [];
  const segments = 24;
  const radius = diameter / 2;
  const minor = radius - 0.54 * pitch;
  const headRadius = head / 2;

  function ring(height, radiusAtAngle) {
    const first = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const angle = i * Math.PI * 2 / segments;
      const r = typeof radiusAtAngle === 'number' ? radiusAtAngle : radiusAtAngle(angle);
      positions.push(r * Math.cos(angle), height, -r * Math.sin(angle));
    }
    return first;
  }

  function join(lower, upper) {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      indices.push(lower + i, lower + j, upper + j, lower + i, upper + j, upper + i);
    }
  }

  const tip = ring(-length, minor * .89);
  const capCenter = positions.length / 3;
  positions.push(0, -length, 0);
  for (let i = 0; i < segments; i++) indices.push(capCenter, tip + (i + 1) % segments, tip + i);

  let previous = tip;
  const slices = Math.ceil(length / pitch * 5);
  for (let row = 1; row <= slices; row++) {
    const y = -length + row / slices * length;
    const next = ring(y, angle => {
      const phase = (y / pitch - angle / (2 * Math.PI) + length / pitch + 1) % 1;
      const flank = Math.min(1, Math.max(0, (0.51 - Math.abs(phase - .5)) * 2.55));
      const lead = Math.min(1, (y + length) / pitch);
      return minor + (radius - minor) * flank * lead;
    });
    join(previous, next);
    previous = next;
  }

  function band(y1, r1, y2, r2) {
    join(ring(y1, r1), ring(y2, r2));
  }

  const bevel = diameter * .075;
  band(0, radius, 0, headRadius - bevel);
  band(0, headRadius - bevel, bevel, headRadius);
  band(bevel, headRadius, diameter - bevel, headRadius);
  band(diameter - bevel, headRadius, diameter, headRadius - bevel);

  function hexRadius(angle) {
    const sector = Math.PI / 3;
    return (socket / 2) / Math.cos((angle + sector / 2) % sector - sector / 2);
  }

  band(diameter, headRadius - bevel, diameter, hexRadius);
  band(diameter, hexRadius, diameter - socketDepth, hexRadius);
  const socketBase = ring(diameter - socketDepth, hexRadius);
  const socketCenter = positions.length / 3;
  positions.push(0, diameter - socketDepth, 0);
  for (let i = 0; i < segments; i++) indices.push(socketCenter, socketBase + i, socketBase + (i + 1) % segments);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function addFasteners(assembly, cadFrame, document) {
  const calibrated=alignServiceDatums(assembly,cadFrame);
  const meshes = new Map();
  const geometryBySpec = new Map();
  const usedIds = new Set(assembly.nodes.map(node => node.id));
  const steel = new MeshStandardMaterial({name:'fastener-steel', color:0x65717b, metalness:.93, roughness:.29});
  const up = new Vector3(0, 1, 0);

  for (const item of document.items) {
    if (usedIds.has(item.id)) throw new Error('紧固件编号重复 ' + item.id);
    if (!usedIds.has(item.hostId)) throw new Error('紧固件安装部件缺失 ' + item.hostId);
    usedIds.add(item.id);
    if (!geometryBySpec.has(item.spec)) geometryBySpec.set(item.spec, screwGeometry(dimensions[item.spec]));
    const mesh = new Mesh(geometryBySpec.get(item.spec), steel);
    mesh.name = item.id;
    mesh.userData.instanceId = item.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const axis = new Vector3().fromArray(item.axis).normalize();
    mesh.quaternion.setFromUnitVectors(up, axis);
    mesh.position.fromArray(item.seat);
    if(calibrated[item.hostId])mesh.position.fromArray(item.seatLocal).applyMatrix4(calibrated[item.hostId]);
    mesh.updateMatrix();
    cadFrame.add(mesh);
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix);
    const sequence = item.id.slice(item.id.lastIndexOf('bolt') + 4);
    assembly.nodes.push({
      id:item.id, parent:item.hostId, hostId:item.hostId, name:item.spec + ' 内六角螺钉 · ' + (legs[item.leg] || '') + roleNames[item.role] + ' ' + sequence,
      part:item.spec, material:'steel', geometry:true, fastener:true, supplemental:true, role:item.role, leg:item.leg, spec:item.spec,
      sourcePage:item.page, removalAxis:item.axis, center:bounds.getCenter(new Vector3()).toArray(),
      min:bounds.min.toArray(), max:bounds.max.toArray()
    });
    meshes.set(item.id, mesh);
  }
  return meshes;
}
