import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {applyFinish} from './finishes.js';
import {addFasteners} from './fasteners.js';

const asset = name => './assets/' + name;
async function readAsset(name) {
  const response = await fetch(asset(name));
  if (!response.ok) throw new Error('无法读取 ' + name);
  return response.json();
}

const vec = values => new THREE.Vector3(...values);
const localAxes = new THREE.Vector3(0, 1, 0);
const fullTurn = 2 * Math.PI;
const displayHoles = phase => ['fasten', 'inspect', 'done'].includes(phase);

function buildLeg(tag, assembly, manual, fasteners, meshes) {
  const side = manual.legs.find(item => item.id === tag);
  const leg = assembly.nodes.find(item => item.name.includes(side.label + '腿组件'));
  const parts = assembly.nodes.filter(item => item.parent === leg.id);
  const knee = parts.find(item => item.name.includes(manual.selectors.kneeMotor));
  const slot = parts.find(item => item.name.includes('大腿舵臂'));
  const frame = new THREE.Group(), motor = new THREE.Group();
  const motorCenter = vec(knee.center);
  motor.position.copy(motorCenter);
  frame.add(motor);

  const children = new Map();
  for (const row of assembly.nodes) {
    if (!children.has(row.parent)) children.set(row.parent, []);
    children.get(row.parent).push(row);
  }
  const pickable = [];
  function addPart(row, owner) {
    const mesh = meshes.get(row.id);
    if (mesh) {
      owner.add(mesh);
      if (owner === motor) mesh.position.sub(motorCenter);
      mesh.userData.pickPart = owner === motor ? 'motor' : 'leg';
      pickable.push(mesh);
    }
    for (const child of children.get(row.id) || []) if (!child.fastener) addPart(child, owner);
  }
  addPart(knee, motor);
  // The upper clamp belongs to the next work order. The front linkage and foot
  // arrive with the thigh, as shown in the manufacturer's kit illustration.
  for (const part of parts) {
    if (/大腿内侧|大腿外侧|大腿舵臂|小腿|舵臂塞打|膝关节销|足端/.test(part.name)) addPart(part, frame);
  }
  const items = fasteners.filter(item => item.leg === tag && item.role === 'kneeMotor');
  if (items.length !== 6) throw new Error('膝电机六孔数据不完整');
  const axis = vec(items[0].axis).normalize();
  const center = items.reduce((sum, row) => sum.add(vec(row.seat)), new THREE.Vector3()).divideScalar(items.length);
  // Clockwise seen from the screw heads. The right side is a mirror occurrence.
  const holes = items.map(item => {
    const mesh = meshes.get(item.id);
    frame.add(mesh);
    const seat = vec(item.seat);
    const angle = Math.atan2(-axis.x * (seat.z - center.z), seat.y - center.y);
    return {mesh, seat, angle, base:mesh.quaternion.clone(), depth:12, from:12, to:12, status:0};
  }).sort((a,b) => a.angle - b.angle);
  // The manual identifies the arrow side of the motor. Render a local teaching
  // mark on this face so it turns with the case when the student flips the motor.
  const ink = new THREE.Shape();
  ink.moveTo(-1.6, 4); ink.lineTo(1.6, 4); ink.lineTo(1.6, .3);
  ink.lineTo(3.7, .3); ink.lineTo(0,-4); ink.lineTo(-3.7,.3); ink.lineTo(-1.6,.3); ink.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(ink), new THREE.MeshBasicMaterial({color:0xe56f3a}));
  const face = axis.x > 0 ? knee.max[0] : knee.min[0];
  arrow.position.set(face - motorCenter.x + axis.x*.6, -24, 0);
  arrow.rotation.y = axis.x * Math.PI/2;
  motor.add(arrow);
  const first = holes.indexOf(holes.reduce((a,b) => a.seat.y > b.seat.y ? a : b));
  holes.push(...holes.splice(0, first));
  holes.forEach((hole, index) => { hole.mesh.userData.pickHole = index + 1; pickable.push(hole.mesh); });

  frame.position.copy(center).multiplyScalar(-1);
  frame.visible = false;
  const sidePlate = parts.find(row => row.name.includes('大腿外侧'));
  const plateCenter = vec(sidePlate.center).sub(center);
  const otherPivot = parts.find(row => row.name.includes('膝关节销'));
  const otherSlot = vec(otherPivot.center).sub(vec(slot.center));
  const foot = parts.find(row => row.name.includes(manual.selectors.foot));
  const sole = vec(foot.center).sub(center);
  sole.y = foot.min[1] - center.y;
  return {frame, motor, motorCenter, plateCenter, sole, center, axis, holes, pickable,
    mark:side.side, arrow, otherSlot, slotCenter:vec(slot.center).sub(center)};
}

// Capture a stationary workbench light field. The shop photograph supplies broad
// reflected colour; the diffusers and black flags describe the machined edges.
function stationReflections(renderer, panorama) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x62676a);
  if (panorama) {
    panorama.mapping = THREE.EquirectangularReflectionMapping;
    panorama.colorSpace = THREE.SRGBColorSpace;
    studio.background = panorama;
    studio.backgroundRotation.y = -.65;
    studio.backgroundIntensity = .82;
  }
  const panels = [];
  function card(width, height, position, tint, radiance, roll = 0) {
    const mat = new THREE.MeshBasicMaterial({color:new THREE.Color(tint).multiplyScalar(radiance),toneMapped:false});
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width,height),mat);
    panel.position.fromArray(position); panel.lookAt(0,0,0); panel.rotateZ(roll);
    studio.add(panel); panels.push(panel);
  }
  card(4.0, 1.65, [2.9,2.5,-1.6], 0xfffaf2, 4.65, -.20);
  card(1.1, 4.8, [-3.2,1.1,1.1], 0xe7f2ff, 3.9, -.24);
  card(3.7, .65, [.3,2.0,3.4], 0xfffaf1, 3.55, .08);
  card(.8, 3.2, [2.6,-.35,1.5], 0x273237, .50, -.20);
  card(2.2, 1.1, [-2.5,-1.1,-1.7], 0x27292a, .64, .22);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio,0,.1,12,{size:256});
  generator.dispose();
  for (const panel of panels) {panel.geometry.dispose(); panel.material.dispose();}
  panorama?.dispose();
  return target;
}

function makeMarkers(container, onHole) {
  return Array.from({length:6}, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bpx-hole-mark';
    button.textContent = String(index + 1);
    button.setAttribute('aria-label', '选择 ' + (index + 1) + ' 号孔');
    button.addEventListener('click', () => onHole?.(index + 1));
    container.append(button);
    return button;
  });
}

const styles = `
.bpx-knee-vp{position:relative;isolation:isolate;width:100%;height:100%;min-height:inherit;overflow:hidden;
 background:radial-gradient(ellipse at 46% 37%,#455652 0%,#2f403d 47%,#192925 100%)}
.bpx-knee-vp canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.bpx-knee-vp .bpx-hole-mark,.bpx-knee-vp .bpx-part-mark{position:absolute;z-index:2;left:0;top:0;transform:translate(-50%,-50%);
 box-sizing:border-box;margin:0;min-width:0;min-height:0;line-height:1;white-space:nowrap;cursor:pointer}
.bpx-knee-vp .bpx-hole-mark{border:1.5px solid #e1e8e4;background:#263632e8;color:white;border-radius:50%;
 width:25px;height:25px;font:600 12px/1 "IBM Plex Mono",monospace;padding:0;box-shadow:0 1px 5px #12252077}
.bpx-knee-vp .bpx-hole-mark[aria-pressed=true]{border-color:#fff2d9;background:#b64520}
.bpx-knee-vp button:focus-visible{outline:3px solid #ffc782;outline-offset:2px}
.bpx-knee-vp .bpx-part-mark{border:1px solid #adbbb3bb;border-radius:3px;background:#1d2f2ce8;color:white;
 font:500 12px/1.25 system-ui,sans-serif;padding:5px 9px;text-align:center}
.bpx-knee-vp [hidden]{display:none!important}
`;

export async function createKneeView(host, {onHole, onPart} = {}) {
  if (!host) throw new Error('训练视口已关闭');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [gltf, assembly, manual, fasteners, panorama] = await Promise.all([
    loader.loadAsync(asset('bpx-runtime.glb')), readAsset('assembly.json'),
    readAsset('procedures.json'), readAsset('fasteners.json'),
    new THREE.TextureLoader().loadAsync(asset('machine-shop.webp')).catch(() => null)
  ]);
  const frame = gltf.scene.getObjectByName('CADFrame');
  const subset = fasteners.items.filter(item => item.role === 'kneeMotor' && ['LF','RF'].includes(item.leg));
  addFasteners(assembly, frame, {items:subset});
  const meshes = new Map(frame.children.map(mesh => [mesh.userData.instanceId || mesh.name, mesh]));
  const legs = Object.fromEntries(['LF','RF'].map(tag => [tag, buildLeg(tag, assembly, manual, subset, meshes)]));

  if (!host.isConnected) { panorama?.dispose(); throw new Error('训练视口已关闭'); }
  const sourceMaterials = new Set();
  const finishOptions = {inspection:true, worldUnitsPerMeter:1000, cache:new Map()};
  const byId = new Map(assembly.nodes.map(row => [row.id, row]));
  for (const leg of Object.values(legs)) {
    for (const mesh of leg.pickable) {
      for (const material of [].concat(mesh.material)) sourceMaterials.add(material);
      applyFinish(mesh, byId.get(mesh.userData.instanceId || mesh.name), finishOptions);
      mesh.castShadow = mesh.receiveShadow = true;
    }
  }
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, powerPreference:'low-power'});
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const view = document.createElement('div');
  view.className = 'bpx-knee-vp';
  const style = document.createElement('style');
  style.textContent = styles;
  renderer.domElement.setAttribute('aria-label','三维装配工件，可旋转、缩放和点选');
  view.append(style, renderer.domElement);
  const markers = makeMarkers(view, onHole);
  const tags = ['leg','motor'].map(part => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bpx-part-mark';
    button.addEventListener('click', () => onPart?.(part));
    view.append(button);
    return button;
  });
  host.append(view);
  const scene = new THREE.Scene();
  scene.add(legs.LF.frame, legs.RF.frame);
  const screw = legs.LF.holes[0].mesh;
  const previewScrew = new THREE.Mesh(screw.geometry, screw.material);
  previewScrew.castShadow = previewScrew.receiveShadow = true;
  previewScrew.visible = false;
  scene.add(previewScrew);
  const reflection = stationReflections(renderer, panorama);
  scene.environment = reflection.texture;
  scene.environmentIntensity = 1;
  scene.add(new THREE.HemisphereLight(0xe4edf0, 0x8a8174, .68));
  const key = new THREE.DirectionalLight(0xfff2de, 1.55);
  key.position.set(255,360,185);
  key.target.position.set(0,-100,0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024,1024);
  Object.assign(key.shadow.camera, {left:-248,right:248,top:248,bottom:-248,near:80,far:880});
  key.shadow.normalBias = .14;
  key.shadow.bias = -.00015;
  key.shadow.intensity = .72;
  scene.add(key, key.target);
  const grid = new THREE.GridHelper(1200, 48, 0x72827a, 0x586861);
  grid.material.transparent = true; grid.material.opacity = .36;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200,1200), new THREE.ShadowMaterial({opacity:.24,depthWrite:false}));
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(grid, ground);
  const camera = new THREE.PerspectiveCamera(37, 1, .5, 3200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.minDistance = 33; controls.maxDistance = 1200;
  controls.maxPolarAngle = Math.PI * .94;
  controls.enableDamping = false;
  controls.zoomToCursor = true;

  let state, current, disposed = false, pending = 0, started = 0, animate = false, focalView = 'overview';
  let finishMove = null, refreshShadows = true;
  let width = 1, height = 1;
  const motorStart = new THREE.Vector3(), motorEnd = new THREE.Vector3();
  const rotStart = new THREE.Quaternion(), rotEnd = new THREE.Quaternion();
  const scratch = new THREE.Vector3(), projected = new THREE.Vector3(), direction = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  function draw() {
    pending = 0;
    if (disposed || !state) return;
    if (animate) {
      refreshShadows = true;
      const t = Math.min(1, (performance.now() - started) / 430);
      const u = t*t*(3-2*t);
      current.motor.position.lerpVectors(motorStart, motorEnd, u);
      current.motor.quaternion.slerpQuaternions(rotStart, rotEnd, u);
      for (const h of current.holes) {
        h.depth = THREE.MathUtils.lerp(h.from, h.to, u);
        h.mesh.visible = h.status > 0 || (t < 1 && h.from < 11.99);
        h.mesh.position.copy(h.seat).addScaledVector(current.axis, h.depth);
        // M3×8 has a 0.5 mm pitch; use the same kinematics for insertion and withdrawal.
        h.mesh.quaternion.copy(h.base);
        h.mesh.rotateOnAxis(localAxes, h.depth / .5 * fullTurn);
      }
      animate = t < 1;
    }
    const selectedHole = current.holes[state.selected-1];
    previewScrew.visible = state.phase === 'fasten' && !!selectedHole && selectedHole.status === 0;
    if (previewScrew.visible) {
      previewScrew.position.copy(selectedHole.seat).sub(current.center).addScaledVector(current.axis, 12);
      previewScrew.position.z += Number(state.lateral) || 0;
      previewScrew.quaternion.copy(selectedHole.base);
      previewScrew.rotateOnWorldAxis(localAxes, THREE.MathUtils.degToRad(Number(state.tilt) || 0));
    }
    if (refreshShadows) renderer.shadowMap.needsUpdate = true;
    refreshShadows = false;
    renderer.render(scene, camera);
    const p = current.center;
    const markerFace = camera.position.dot(current.axis) > 0;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i], hole = current.holes[i];
      scratch.copy(hole.seat).sub(p);
      scratch.x += current.axis.x * 4;
      const radius = Math.hypot(scratch.y, scratch.z);
      scratch.y += scratch.y * 7 / radius;
      scratch.z += scratch.z * 7 / radius;
      place(marker, scratch, displayHoles(state.phase) && markerFace && focalView !== 'overview');
    }
    const labelMode = !displayHoles(state.phase);
    place(tags[0], scratch.copy(current.plateCenter).addScaledVector(current.axis, 12), labelMode);
    scratch.set(0, 20, 0).applyQuaternion(current.motor.quaternion)
      .add(current.motor.position).sub(p);
    place(tags[1], scratch, labelMode);
    if (animate) invalidate();
    else if (finishMove) {
      const resolve = finishMove;
      finishMove = null;
      resolve(true);
    }
  }
  function place(element, point, visible) {
    projected.copy(point).project(camera);
    const x = (projected.x+1)*width/2, y = (1-projected.y)*height/2;
    element.hidden = !visible || projected.z < -1 || projected.z > 1 || x < 14 || y < 14 || x > width-14 || y > height-14;
    if (!element.hidden) {
      element.style.left = x + 'px';
      element.style.top = y + 'px';
    }
  }
  function invalidate() {
    if (!pending && !disposed) pending = requestAnimationFrame(draw);
  }
  controls.addEventListener('change', invalidate);

  function focus(kind = 'overview') {
    if (!current) return;
    focalView = kind;
    const facing = current.axis.x;
    let radius;
    if (kind === 'holes') {
      controls.target.set(0,0,0);
      // Look down the counterbores so their walls do not hide seated screw heads.
      direction.set(facing,0,0);
      radius = 133;
    } else if (kind === 'part') {
      const part = state.part || 'motor';
      if (part === 'motor') controls.target.copy(motorEnd).sub(current.center);
      else controls.target.copy(current.slotCenter);
      direction.set(facing * .8,.22,-.6*facing);
      radius = 225;
    } else {
      controls.target.copy(current.sole).multiplyScalar(.37);
      direction.set(facing,.25,-.47*facing);
      radius = 720;
    }
    radius /= Math.min(1, camera.aspect);
    camera.position.copy(controls.target).addScaledVector(direction.normalize(), radius);
    controls.update(); invalidate();
  }

  function update(next) {
    // React may re-render the form with its last committed state while a tool is moving.
    // Complete the in-flight frame before accepting another presentation update.
    if (disposed || finishMove) return;
    const previous = state;
    state = {...state, ...next};
    const switched = !current || state.leg !== previous?.leg;
    if (switched || state.selected !== previous?.selected || state.lateral !== previous?.lateral ||
      state.tilt !== previous?.tilt) refreshShadows = true;
    if (switched) {
      if (current) current.frame.visible = false;
      current = legs[state.leg] || legs.LF;
      current.frame.visible = true;
      grid.position.set(0, current.sole.y - .6, current.sole.z);
      ground.position.copy(grid.position); ground.position.y -= .2;
    }
    const maskLabels = state.mode === 'exam' && state.phase === 'kit';
    tags[0].textContent = maskLabels ? '大腿组件' : '钢印 ' + current.mark;
    tags[1].textContent = maskLabels ? '关节电机' : '铭牌 KNEE';
    motorEnd.copy(current.motorCenter);
    // The kit is an exploded presentation, while the seat view puts the motor beside the mating slot.
    if (state.phase === 'kit') motorEnd.add(vec([-current.axis.x*82,70,20]));
    else if (state.phase === 'seat') {
      motorEnd.add(vec([-current.axis.x*11,24,3]));
      if (state.slot === 'upper') motorEnd.add(current.otherSlot);
    }
    rotEnd.identity();
    if (!displayHoles(state.phase) && state.flipped) rotEnd.setFromAxisAngle(localAxes, Math.PI);
    const physicalChange = switched || !previous || previous.phase !== state.phase || previous.flipped !== state.flipped || previous.slot !== state.slot ||
      current.holes.some((hole, i) => hole.status !== (state.holes?.[i] || 0));
    if (physicalChange) {
      // Inspection swaps in a separately prepared workpiece. Playing an extraction
      // animation here would reveal the seeded fault before the student inspects it.
      const freshWorkpiece = switched || (state.phase === 'inspect' && previous?.phase !== 'inspect');
      motorStart.copy(current.motor.position); rotStart.copy(current.motor.quaternion);
      current.holes.forEach((hole,i) => {
        hole.status = state.holes?.[i] || 0;
        hole.to = [12, 2.5, 0][hole.status] ?? 12;
        hole.from = freshWorkpiece ? hole.to : hole.depth;
      });
      if (switched) {motorStart.copy(motorEnd); rotStart.copy(rotEnd);}
      animate = true; started = performance.now();
    }
    markers.forEach((button, i) => button.setAttribute('aria-pressed', String(i + 1 === state.selected)));
    if (switched || previous?.phase !== state.phase) {
      focus(displayHoles(state.phase) ? 'holes' : state.phase === 'seat' ? 'part' : 'overview');
    } else if (state.phase === 'seat' && previous.slot !== state.slot) {
      focus('part');
    }
    invalidate();
  }
  function move(next) {
    if (disposed || finishMove) return Promise.resolve(false);
    update(next);
    if (!animate) return Promise.resolve(true);
    return new Promise(resolve => { finishMove = resolve; });
  }
  function resize() {
    width = view.clientWidth; height = view.clientHeight;
    if (!width || !height) return;
    camera.aspect = width/height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false); invalidate();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  let down;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', e => {
    down = e.isPrimary && e.button === 0 ? [e.clientX, e.clientY] : null;
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', e => {
    if (!down || !current || Math.hypot(e.clientX-down[0],e.clientY-down[1]) > 4) return;
    down = null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX-rect.left, py = e.clientY-rect.top;
    const cursor = new THREE.Vector2(px / width * 2 - 1, 1 - py / height * 2);
    if (displayHoles(state.phase) && focalView !== 'overview' && camera.position.dot(current.axis) > 0) {
      let nearest = 0, distance = 16;
      for (const [i,hole] of current.holes.entries()) {
        projected.copy(hole.seat).sub(current.center).addScaledVector(current.axis, 3).project(camera);
        const d = Math.hypot((projected.x+1)*width/2-px,(1-projected.y)*height/2-py);
        if (d < distance) { nearest = i+1; distance = d; }
      }
      if (nearest) { onHole?.(nearest); return; }
    }
    raycaster.setFromCamera(cursor, camera);
    const hit = raycaster.intersectObjects(current.pickable.filter(mesh => mesh.visible), false)[0];
    if (hit?.object.userData.pickHole) onHole?.(hit.object.userData.pickHole);
    else if (hit?.object.userData.pickPart) onPart?.(hit.object.userData.pickPart);
  });

  update({leg:'LF', phase:'kit', holes:[0,0,0,0,0,0], selected:null});
  function dispose() {
    if (disposed) return;
    disposed = true;
    finishMove?.(false);
    finishMove = null;
    cancelAnimationFrame(pending); observer.disconnect(); controls.dispose();
    const geometries = new Set(), materials = new Set(sourceMaterials);
    for (const mesh of meshes.values()) {
      if (!mesh.isMesh) continue;
      geometries.add(mesh.geometry);
      for (const material of [].concat(mesh.material)) materials.add(material);
    }
    for (const geom of geometries) geom.dispose();
    for (const material of materials) material.dispose();
    for (const leg of Object.values(legs)) { leg.arrow.geometry.dispose(); leg.arrow.material.dispose(); }
    finishOptions.cache.clear();
    ground.geometry.dispose(); ground.material.dispose(); key.shadow.dispose();
    grid.dispose(); reflection.dispose(); renderer.dispose(); renderer.forceContextLoss(); view.remove();
  }
  return {update, move, focus, dispose};
}
