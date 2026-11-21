import {Mesh, MeshStandardMaterial} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// The exported pack consists of the faceplate, the handle and the switch. The
// manual shows a dark ribbed cassette behind that face (page 26). Bound the
// teaching model by the measured opening and end plate in STEP world mm.
export function addBatteryBody(assembly, cadFrame) {
  const pack = assembly.nodes.find(node => node.name.startsWith('C2-8-0-024 '));
  const front = assembly.nodes.find(node => node.name.startsWith('C2-2-0-084 '));
  const rear = assembly.nodes.find(node => node.name.startsWith('C2-2-0-085 '));
  if (!pack || !front || !rear) return null;
  const id = pack.id + '_manual_cassette';
  const existing = assembly.nodes.find(node => node.id === id);
  if (existing) return existing;

  const depth = rear.min[0] - front.max[0] - 10;
  const height = Math.min(front.max[1],rear.max[1]) - Math.max(front.min[1],rear.min[1]) - 10;
  // The rounded guide mouth narrows near its four corners. The usable opening
  // was checked throughout the insertion stroke against the original CAD shell.
  const width = Math.min(front.max[2],rear.max[2]) - Math.max(front.min[2],rear.min[2]) - 13;
  if (Math.min(depth,height,width) < 15) return null;
  const center = [
    front.max[0] + depth/2,
    (Math.min(front.max[1],rear.max[1]) + Math.max(front.min[1],rear.min[1]))/2,
    (Math.min(front.max[2],rear.max[2]) + Math.max(front.min[2],rear.min[2]))/2,
  ];
  const ribHeight = 1.4;
  const body = new RoundedBoxGeometry(depth, height-ribHeight, width, 2, 3);
  body.translate(0,-ribHeight/2,0);
  const surfaces = [body];
  for (const fraction of [-0.30,0,0.30]) {
    const rib = new RoundedBoxGeometry(depth*0.73,1.9,3.7,2,0.75);
    rib.translate(0,height/2-0.95,width*fraction);
    surfaces.push(rib);
  }
  const geometry = mergeGeometries(surfaces);
  for (const surface of surfaces) surface.dispose();
  const material = new MeshStandardMaterial({color:0x30373d,metalness:0.12,roughness:0.44});
  material.name = 'black-shell';
  const mesh = new Mesh(geometry,material);
  mesh.name = id;
  mesh.userData.instanceId = id;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.position.fromArray(center);
  mesh.updateMatrix();
  cadFrame.add(mesh);
  const dims = [depth,height,width];
  const row = {
    id,parent:pack.id,part:'manual-battery-cassette',name:'电池盒体（说明书补形）',
    geometry:true,supplemental:true,material:'black-shell',center,
    min:center.map((v,axis) => v - dims[axis]/2),max:center.map((v,axis) => v + dims[axis]/2),
    source:'说明书第 26 页外形示意，尺寸依据 CAD 前板与壳内间隙估算。',
  };
  assembly.nodes.push(row);

  // Original CAD bounds stop at the faceplate. Include the reconstructed shell
  // so focusing the pack and its ancestors also frames the full teaching model.
  for (let parent = pack; parent?.min; parent = assembly.nodes.find(node => node.id === parent.parent)) {
    parent.min = parent.min.map((v,k) => Math.min(v,row.min[k]));
    parent.max = parent.max.map((v,k) => Math.max(v,row.max[k]));
    parent.center = parent.min.map((v,k) => (v+parent.max[k])/2);
  }
  return row;
}
