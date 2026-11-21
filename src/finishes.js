import * as T from 'three';

// Reference finishes for BPX. The assembly book identifies the product appearance;
// colour, texture depth and roughness are visual estimates pending physical samples.
const finishes = {
  extrusion: {label:'型材 · 纵向缎面',color:0xa6b0b9,metalness:.89,roughness:.35,anisotropy:.43,family:'extrusion'},
  milled: {label:'铝合金 · 铣削面',color:0xaeb7bb,metalness:.91,roughness:.30,anisotropy:.32,family:'milled'},
  turned: {label:'关节壳 · 车削端面与喷砂外圆',color:0xbfc5c8,metalness:.92,roughness:.24,anisotropy:.45,family:'turned'},
  glassBead: {label:'铝合金 · 细喷砂',color:0x949fa4,metalness:.85,roughness:.47,family:'blast'},
  steel: {label:'钢 · 磨削',color:0x9ba7af,metalness:.97,roughness:.24,anisotropy:.26,family:'turned'},
  bolt: {label:'钢 · 深色表面处理',color:0x737d86,metalness:.87,roughness:.31,anisotropy:.22,family:'turned'},
  bronze: {label:'铜合金 · 机加工',color:0xbc965c,metalness:.94,roughness:.31,anisotropy:.25,family:'turned'},
  rubber: {label:'弹性体 · 模压细纹',color:0x292c2d,metalness:0,roughness:.86,family:'rubber'},
  cable: {label:'线束 · 绝缘护套',color:0x282b2d,metalness:0,roughness:.55,family:'mold'},
  molded: {label:'壳体 · 模塑细纹',color:0x303538,metalness:0,roughness:.49,family:'mold'},
  coating: {label:'控制盒 · 细纹涂层',color:0x373d40,metalness:.13,roughness:.46,family:'mold'},
  graphite: {label:'护盖 · 深灰半哑光',color:0x484d50,metalness:.30,roughness:.42,family:'mold'},
  pcb: {label:'电路板 · 阻焊层',color:0x31534d,metalness:.06,roughness:.43,family:'mold'},
  silicon: {label:'电子元件 · 封装',color:0x383e41,metalness:.13,roughness:.54,family:'mold'},
  lens: {label:'透光片 · 聚合物',color:0x778084,metalness:0,roughness:.18,family:'mold'},
};

// CAD part number is primary. Three STEP solids share the code 048; distinguish
// the soft pad from its carrier with the full designation before consulting codes.
const assignments = new Map();
function bind(type, numbers) { for (const n of numbers.split(' ')) assignments.set(n,type); }
bind('extrusion','C2-3-0-018 C2-3-0-009');
bind('milled','C2-3-2-023 C2-3-2-028 C2-3-2-029 C2-3-2-043 C2-3-2-044 C2-3-2-045 C2-3-2-048 C2-3-2-055 C2-3-2-058 C2-3-0-064 C2-3-0-071 C2-3-2-019');
bind('glassBead','C2-3-0-003 C2-3-0-005 C2-3-0-010 C2-3-2-056 C2-3-2-059');
bind('turned','C2-3-2-033 C2-3-2-034 C2-3-2-035 C2-3-2-041 C2-3-2-047 C2-3-2-049');
bind('steel','C2-3-2-024 C2-3-2-025 C2-3-2-027 C1-2-178');
bind('rubber','C2-2-2-077 C2-2-0-026 C1-2-195');
bind('graphite','C2-3-0-015 C1-3-134 C2-2-0-092 C2-2-0-093');
bind('molded','C2-2-0-084 C2-2-0-085 C2-2-0-086 C2-2-0-087 C2-2-0-088 C1-2-191');
bind('coating','C2-2-0-079 C2-2-0-080');
bind('lens','C1-2-192');

function finishFor(row,code) {
  if (row.fastener) return 'bolt';
  if (/软垫|软胶/.test(row.name)) return 'rubber';
  if (assignments.has(code)) return assignments.get(code);
  if (/铜/.test(row.name)) return 'bronze';
  if (/线束|连接线|到髋线/.test(row.name)) return 'cable';
  if (/电池|线扣|固定块/.test(row.name)) return 'molded';
  if (/BOARD|^PCB|^MASK|^C1_USB_PCB/.test(row.name)) return 'pcb';
  if (/RJ45|USB-C-SMD/.test(row.name)) return 'steel';
  return 'silicon';
}

const X=new T.Vector3(1,0,0),Y=new T.Vector3(0,1,0),Z=new T.Vector3(0,0,1);
function surfaceAxis(row,code,size,type) {
  // Local directions of the large coaxial STEP cylindrical surfaces on these parts.
  if (/C2-3-2-03[345]/.test(code)) return X;
  if (/C2-3-2-(041|047|049|025|027)/.test(code) || row.fastener) return Y;
  if (/C2-3-2-024|C1-2-178/.test(code) || type==='bronze') return Z;
  return size.x>=size.y && size.x>=size.z ? X : size.y>=size.z ? Y : Z;
}

const surfaceData = new WeakMap();
function makeCoordinates(geometry,axis,type) {
  if (surfaceData.has(geometry)) return;
  geometry.computeBoundingBox();
  const center=geometry.boundingBox.getCenter(new T.Vector3());
  const position=geometry.getAttribute('position'), normal=geometry.getAttribute('normal');
  const coords=new Float32Array(position.count*3);
  const tangents=new Float32Array(position.count*4);
  const side = Math.abs(axis.z)>.8 ? X : Z;
  const u=new T.Vector3().crossVectors(axis,side).normalize();
  const v=new T.Vector3().crossVectors(axis,u).normalize();
  const p=new T.Vector3(), n=new T.Vector3(), tangent=new T.Vector3();
  const turned=['turned','steel','bolt','bronze'].includes(type);
  // Measured axes of the named motor, pin and screw parts pass through the CAD
  // local origin. Extrusions carry large CAD offsets; centre them for texture precision.
  const lathe = turned && !/RJ45|USB/.test(geometry.name);
  if (lathe) center.set(0,0,0);
  for(let i=0;i<position.count;i++){
    p.fromBufferAttribute(position,i).sub(center);n.fromBufferAttribute(normal,i).normalize();
    coords[3*i]=p.dot(u); coords[3*i+1]=p.dot(v); coords[3*i+2]=p.dot(axis);
    if (lathe) tangent.crossVectors(axis,p);
    else tangent.copy(axis);
    tangent.addScaledVector(n,-tangent.dot(n));
    if (tangent.lengthSq()<1e-8) tangent.copy(u).addScaledVector(n,-u.dot(n));
    if (tangent.lengthSq()<1e-8) tangent.copy(v).addScaledVector(n,-v.dot(n));
    tangent.normalize().toArray(tangents,4*i);tangents[4*i+3]=1;
  }
  geometry.setAttribute('finishMm',new T.BufferAttribute(coords,3));
  if(finishes[type].anisotropy)geometry.setAttribute('tangent',new T.BufferAttribute(tangents,4));
  surfaceData.set(geometry,true);
}

const grainShader = `
float surfaceHash(vec3 q) {
  q = fract(q*vec3(.1031,.1030,.0973));
  q += dot(q, q.yxz+33.33);
  return fract((q.x+q.y)*q.z);
}
float filteredNoise(vec3 p) {
  vec3 q=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  vec4 a=vec4(surfaceHash(q),surfaceHash(q+vec3(1,0,0)),surfaceHash(q+vec3(0,1,0)),surfaceHash(q+vec3(1,1,0)));
  vec4 b=vec4(surfaceHash(q+vec3(0,0,1)),surfaceHash(q+vec3(1,0,1)),surfaceHash(q+vec3(0,1,1)),surfaceHash(q+vec3(1)));
  vec4 z=mix(a,b,f.z);
  float value=mix(mix(z.x,z.y,f.x),mix(z.z,z.w,f.x),f.y)-.5;
  return value*(1.0-smoothstep(.32,1.5,max(max(fwidth(p.x),fwidth(p.y)),fwidth(p.z))));
}
`;
const grainByFamily = {
  extrusion:`float endCut=smoothstep(.68,.91,abs(dot(normalize(vSurfaceNormal),vLatheAxis)));
    float drawing=filteredNoise(vec3(vMm.xy*3.8,vMm.z*.050));
    float saw=filteredNoise(vec3(vMm.x*.08,vMm.y*3.5,vMm.z*.7));
    finishRelief=mix(drawing*.000012,saw*.000021,endCut);
    roughnessFactor+=mix(drawing*.12,.09+saw*.14,endCut);
    diffuseColor.rgb*=mix(1.+drawing*.03,.94+saw*.04,endCut);`,
  milled:`float broadFace=smoothstep(.82,.96,abs(dot(normalize(vSurfaceNormal),vThinAxis)));
    float machining=filteredNoise(vec3(vMm.xy*2.1,vMm.z*.043));
    float bead=filteredNoise(vMm*4.1);
    finishRelief=mix(machining*.000012,bead*.000007,broadFace);
    roughnessFactor+=mix(-.055+machining*.09,.055+bead*.12,broadFace);
    diffuseColor.rgb*=1.+mix(machining*.028,bead*.055,broadFace);`,
  turned:`float r=length(vMm.xy);
    float endFace=smoothstep(.60,.88,abs(dot(normalize(vSurfaceNormal),vLatheAxis)));
    float coordinate=mix(vMm.z,r,endFace);
    float bands=filteredNoise(vec3(coordinate*6.4,coordinate*.28,0.0));
    float blast=filteredNoise(vMm*5.2);
    finishRelief=mix(blast*.000007,bands*.000009,endFace);
    roughnessFactor+=mix(.105+blast*.11,bands*.08-.035,endFace); 
    diffuseColor.rgb*=1.0+blast*.035;`,
  blast:`float blast=filteredNoise(vMm*4.25); finishRelief=blast*.000009; roughnessFactor+=blast*.18; diffuseColor.rgb*=1.0+blast*.11;`,
  mold:`float grain=filteredNoise(vMm*3.2); finishRelief=grain*.000007; roughnessFactor+=grain*.11; diffuseColor.rgb*=1.0+grain*.10;`,
  rubber:`float microTexture=filteredNoise(vMm*3.6)+.35*filteredNoise(vMm*.56);
    finishRelief=microTexture*.000018; roughnessFactor+=microTexture*.12; diffuseColor.rgb*=1.0+microTexture*.20;`
};

// The close inspection station shows a single manufactured part at millimetre scale.
// Keep the face grain finer than the cutter feed seen on the narrow machined edges.
const inspectionGrain = {
  milled:`float broadFace = smoothstep(.76, .97, abs(dot(normalize(vSurfaceNormal),vThinAxis)));
    float satin = filteredNoise(vec3(vMm.xy*3.6, vMm.z*.072));
    float longPass = filteredNoise(vec3(vMm.xy*.83, vMm.z*.036));
    float edgeCuts = filteredNoise(vec3(vMm.xy*1.25, vMm.z*.38));
    finishRelief = mix(edgeCuts*.000006, satin*.000006+longPass*.000002, broadFace);
    roughnessFactor += mix(-.045+edgeCuts*.065, .025+satin*.10+longPass*.033, broadFace);
    diffuseColor.rgb *= 1.+satin*.026+longPass*.016;`,
  turned:`float face = smoothstep(.59, .9, abs(dot(normalize(vSurfaceNormal),vLatheAxis)));
    float radiusMm = length(vMm.xy);
    float cycles = radiusMm*3.7;
    float fineFeed = sin(6.2831853*cycles)*(1.-smoothstep(.16,.49,fwidth(cycles)));
    float feeds = filteredNoise(vec3(radiusMm*1.85,radiusMm*.17,0.));
    float bead = filteredNoise(vMm*3.2);
    finishRelief = mix(bead*.000004, fineFeed*.000003+feeds*.000005, face);
    roughnessFactor += mix(.095+bead*.055, -.026+feeds*.095+fineFeed*.017, face);
    diffuseColor.rgb *= 1.+mix(bead*.025, feeds*.033, face);`,
};
const inspectionMetals = {
  milled: {color:0xc0c6c6,metalness:.95,roughness:.31,anisotropy:.51},
  turned: {color:0xc8cdd0,metalness:.96,roughness:.27,anisotropy:.53},
  steel: {color:0xa1a9b0,metalness:.97,roughness:.25,anisotropy:.3},
  bolt: {color:0x5e6469,metalness:.82,roughness:.33,anisotropy:.22},
};

const cached=new Map();
let softwareRenderer=false;
export function configureFinishQuality(software) { softwareRenderer=software; }

// Keep the recessed head, shank and silhouette of each fastener in software
// rendering. The high-poly screw geometry remains the source for physical queries.
function lighterFastener(mesh) {
  const geometry=mesh.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
  const index=geometry.getIndex();
  if(!index || position.count<400)return;
  const recess=geometry.clone();
  const kept=[];
  for(let i=0;i<index.count;i+=3) {
    const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
    if(Math.min(position.getY(a),position.getY(b),position.getY(c))>=-.001)kept.push(a,b,c);
  }
  const lo=geometry.boundingBox.min.y, hi=0;
  const radius=geometry.boundingBox.max.y*.47,segments=12;
  const vertices=[],normals=[],faces=[];const remapped=new Map();
  for(const old of kept){
    if(!remapped.has(old)){
      remapped.set(old,vertices.length/3);
      vertices.push(position.getX(old),position.getY(old),position.getZ(old));
      normals.push(normal.getX(old),normal.getY(old),normal.getZ(old));
    }
    faces.push(remapped.get(old));
  }
  const first=vertices.length/3;
  for(let j=0;j<segments;j++){
    const a=j*2*Math.PI/segments,c=Math.cos(a),s=Math.sin(a);
    for(const y of [lo,hi]){vertices.push(radius*c,y,radius*s);normals.push(c,0,s);}
    const i=first+j*2,next=first+((j+1)%segments)*2;
    faces.push(i,i+1,next,next,i+1,next+1);
  }
  const cap=vertices.length/3;vertices.push(0,lo,0);normals.push(0,-1,0);
  for(let j=0;j<segments;j++)faces.push(cap,first+j*2,first+((j+1)%segments)*2);
  // The authoritative part bounds and fitting axis belong to the original CAD row.
  for(const k of Object.keys(recess.attributes))recess.deleteAttribute(k);
  recess.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  recess.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  recess.setIndex(faces);recess.computeBoundingBox();recess.computeBoundingSphere();
  return recess;
}
const replacementScrews=new WeakMap();
export function applyFinish(mesh,row,options={}) {
  const code=row.name.match(/^C[12]-\d+-\d+-\d+/)?.[0];
  const type=finishFor(row,code);
  const units=options.worldUnitsPerMeter??1;
  const inspection=options.inspection===true;
  const spec=inspection && inspectionMetals[type] ? {...finishes[type],...inspectionMetals[type]} : finishes[type];
  const materials=options.cache??cached;
  const simple=softwareRenderer && !inspection;
  mesh.geometry.computeBoundingBox();
  if(simple && row.fastener){
    const original=mesh.geometry;
    if(!replacementScrews.has(original))replacementScrews.set(original,lighterFastener(mesh)||original);
    mesh.userData.collisionGeometry=original;
    mesh.geometry=replacementScrews.get(original);
  }
  const size=mesh.geometry.boundingBox.getSize(new T.Vector3());
  const axis=surfaceAxis(row,code,size,type);
  const thinAxis=size.x<=size.y && size.x<=size.z ? X : size.y<=size.z ? Y : Z;
  if(!simple)makeCoordinates(mesh.geometry,axis,type);
  const key=simple?'software-'+type:[inspection,units,type,axis.toArray(),thinAxis.toArray()].join(':');
  let material=materials.get(key);
  if(!material && simple){
    material=new T.MeshStandardMaterial({name:spec.label,color:spec.color,metalness:spec.metalness,roughness:spec.roughness,
      side:T.DoubleSide});
    materials.set(key,material);
  } else if(!material) {
    material=new T.MeshPhysicalMaterial({color:spec.color,metalness:spec.metalness,roughness:spec.roughness,
      anisotropy:spec.anisotropy || 0,side:T.DoubleSide});
    material.name=spec.label;
    material.onBeforeCompile=shader=>{
      addAreaVisibility(shader);
      shader.uniforms.finishAxis={value:axis};
      shader.uniforms.thinAxis={value:thinAxis};
      shader.uniforms.finishUnitsPerMeter={value:units};
      shader.vertexShader='attribute vec3 finishMm; uniform vec3 finishAxis; uniform vec3 thinAxis; varying vec3 vThinAxis; varying vec3 vMm; varying vec3 vSurfaceNormal; varying vec3 vLatheAxis;\n'+shader.vertexShader
        .replace('#include <begin_vertex>','#include <begin_vertex>\n vMm=finishMm; vSurfaceNormal=normal; vLatheAxis=finishAxis; vThinAxis=thinAxis;');
      const grain=inspection && inspectionGrain[spec.family] || grainByFamily[spec.family];
      shader.fragmentShader='uniform float finishUnitsPerMeter; varying vec3 vThinAxis; varying vec3 vMm; varying vec3 vSurfaceNormal; varying vec3 vLatheAxis;\n'+grainShader+'\n'+shader.fragmentShader
        .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nfloat finishRelief=0.;\n'+grain)
        .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          vec3 dpX=dFdx(-vViewPosition), dpY=dFdy(-vViewPosition);
          vec3 N=normal;
          vec3 r1=cross(dpY,N), r2=cross(N,dpX);
          float det=dot(dpX,r1);
          vec3 grad=sign(det)*(dFdx(finishRelief)*r1+dFdy(finishRelief)*r2);
          normal=normalize(max(abs(det),1e-15)*N-grad*finishUnitsPerMeter);`);
    };
    material.customProgramCacheKey=()=> 'bpx-surface-v5-'+(inspection?'inspection-':'')+spec.family;
    materials.set(key,material);
  }
  mesh.material=material;
  mesh.userData.finish={name:spec.label,partNumber:code||row.part,reference:'拼装说明书外观，光学参数待实物签样'};
  return material;
}

// The area emitter supplies the energy. Its co-located shadow camera supplies
// filtered visibility for the direct term, including the area specular highlight.
export const luminaire={width:.76,length:.35,height:1.32,radiance:46,shadowNear:.15,shadowFar:3.6,shadowAngle:.87};
function addAreaVisibility(shader) {
  const area=T.ShaderChunk.lights_fragment_begin.replace('rectAreaLight = rectAreaLights[ i ];',`rectAreaLight = rectAreaLights[ i ];
#if defined(USE_SHADOWMAP) && (NUM_SPOT_LIGHT_SHADOWS > 0)
  if(receiveShadow){
    SpotLightShadow topLamp=spotLightShadows[0];
    rectAreaLight.color*=getShadow(spotShadowMap[0],topLamp.shadowMapSize,topLamp.shadowIntensity,
      topLamp.shadowBias,topLamp.shadowRadius,vSpotLightCoord[0]);
  }
#endif`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',area);
}

export function receiveAreaShadows(material) {
  material.onBeforeCompile=addAreaVisibility;
  material.customProgramCacheKey=()=> 'bpx-lamp-occlusion-v4';
  return material;
}
