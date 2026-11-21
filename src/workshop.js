import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

import {bench,partsTray} from './bench.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {luminaire,receiveAreaShadows,configureFinishQuality} from './finishes.js';

function addFixture(scene, depth = false, software = false) {
  const fixture=new T.Group();
  scene.add(fixture);
  if(depth && software){
    // Single lower-cost top lamp for CPU rasterizers. Keep the same lamp centre,
    // colour, exit direction and indirect capture as the full area emitter.
    const softLight=new T.SpotLight(0xfff8ed,17,luminaire.shadowFar,.9,.55);
    softLight.position.set(0,luminaire.height,0);softLight.castShadow=true;
    softLight.shadow.mapSize.set(384,384);softLight.shadow.radius=2.5;
    softLight.shadow.intensity=.67;softLight.shadow.camera.near=luminaire.shadowNear;
    softLight.shadow.camera.far=luminaire.shadowFar;softLight.shadow.bias=-.00012;
    softLight.name='机身顶灯';fixture.add(softLight,softLight.target);
    return fixture;
  }

  const lamp = new T.RectAreaLight(0xfff8ed,luminaire.radiance,luminaire.width,luminaire.length);
  lamp.name='机身顶灯';
  lamp.position.set(0,luminaire.height,0);lamp.rotation.x=-Math.PI/2;
  fixture.add(lamp);
  if(!depth)return fixture;
  // A shadow camera colocated with the rectangular lamp supplies depth only.
  const visibility=new T.SpotLight(0xffffff,0,luminaire.shadowFar,luminaire.shadowAngle);
  visibility.name='顶灯深度采样';visibility.position.copy(lamp.position);
  visibility.up.set(0,0,-1);
  visibility.target.position.set(0,0,0);
  visibility.castShadow=true;
  visibility.shadow.mapSize.set(1024,1024);
  visibility.shadow.radius=10;visibility.shadow.blurSamples=24;visibility.shadow.intensity=.69;
  visibility.shadow.bias=-.00016;
  visibility.shadow.camera.near=luminaire.shadowNear;
  visibility.shadow.camera.far=luminaire.shadowFar;
  visibility.shadow.normalBias=.00022;
  fixture.add(visibility,visibility.target);
  return fixture;
}

// Capture the indirect reflection of the work bay under the same fixture.
// Only light reflected off wall panels, machines and the bench enters this probe.
// The finite emitter contributes its specular highlight separately through LTC.
function captureReflections(renderer,reference) {
  const bay=new T.Scene();bay.background=new T.Color(0x0b0e11);
  function panel(w,h,color,x,y,z,rx,ry) {
    const material=new T.MeshStandardMaterial({color,roughness:1,metalness:0,side:T.DoubleSide});
    if(reference){
      // Project the photographed workshop onto diffuse wall proxies. Removing the
      // sky/lamp hotspots from this albedo keeps the capture purely reflective.
      material.onBeforeCompile=shader=>{
        shader.uniforms.bayAlbedo={value:reference};
        shader.vertexShader='varying vec3 rayToSurface;\n'+shader.vertexShader.replace('#include <project_vertex>',
          '#include <project_vertex>\nrayToSurface=(modelMatrix*vec4(position,1.)).xyz-vec3(0.,.16,0.);');
        shader.fragmentShader='varying vec3 rayToSurface;uniform sampler2D bayAlbedo;\n'+shader.fragmentShader.replace('#include <color_fragment>',
          `#include <color_fragment>
           vec3 d=normalize(rayToSurface);
           float angle=atan(d.z,d.x)-1.4;
           vec2 uv=vec2(fract(angle/6.283185+.5),asin(clamp(d.y,-1.,1.))/3.14159+.5);
           vec3 sampleRGB=texture2D(bayAlbedo,uv).rgb;
           float luma=dot(sampleRGB,vec3(.2126,.7152,.0722));
           float reflectance=clamp(pow(max(luma,.005),.50)*1.30,.12,.86);
           diffuseColor.rgb*=mix(vec3(1.),clamp(sampleRGB/max(luma,.005),.74,1.20),.62)*reflectance;`);
      };
    }
    const mesh=new T.Mesh(new T.PlaneGeometry(w,h),material);
    mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,0);bay.add(mesh);
  }
  panel(6,6,0x838b8c,0,1.64,0,Math.PI/2,0);
  panel(7,7,0xb9b7af,0,-.33,0,-Math.PI/2,0);
  panel(5,3.3,0xf8f4e8,-.2,.42,-1.18,0,0);
  panel(5,3.3,0xa8babc,.2,.42,1.30,0,Math.PI);
  panel(5,3.3,0xf1f1e9,-.97,.42,0,0,Math.PI/2);
  panel(5,3.3,0xb4c0c4,1.15,.42,0,0,-Math.PI/2);
  // Light grey sheet panels and darker cabinet frames around the working bay.
  for(const x of [-.81,-.16,.52,.73])panel(.044,1.4,0x233033,x,.4,-1.16,0,0);
  for(const z of [-.66,.10,.89])panel(.055,1.42,0x475255,-.95,.43,z,0,Math.PI/2);
  panel(.81,.48,0x303e42,.33,.05,1.26,0,Math.PI);
  panel(1.2,.14,0x9c8e7a,-.93,.44,.1,0,Math.PI/2);
  addFixture(bay);
  const generator=new T.PMREMGenerator(renderer);
  const result=generator.fromScene(bay,0,.03,9,{size:256,position:new T.Vector3(0,.16,0)});
  generator.dispose();
  bay.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
  return result;
}

function buildFurniture(scene,renderer,invalidate) {
  function finish(color,roughness,metalness,extra={}) {
    return receiveAreaShadows(new T.MeshStandardMaterial({color,roughness,metalness,...extra}));
  }
  function block(parent,w,h,d,rad,material,x,y,z){
    const mesh=new T.Mesh(new RoundedBoxGeometry(w,h,d,2,rad),material);
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.position.set(x,y,z);
    parent.add(mesh);return mesh;
  }
  const benchTex=new T.TextureLoader().load('./assets/bench.webp',()=>invalidate(false));
  benchTex.colorSpace=T.SRGBColorSpace;benchTex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  benchTex.wrapT=T.MirroredRepeatWrapping;
  benchTex.repeat.y=bench.length/1.62;
  const surface=finish(0xbac1c3,.64,.25,{map:benchTex});
  const frame=finish(0x3e4a50,.45,.55);
  block(scene,bench.width,bench.thickness,bench.length,.008,surface,0,-bench.thickness/2,bench.centerZ);
  const legX=bench.width/2-.14;
  const frameLength=bench.length-.24;
  for(const x of [-legX,legX])block(scene,.06,.08,frameLength,.003,frame,x,-bench.thickness-.04,bench.centerZ);
  const startZ=bench.minZ+.16,endZ=bench.maxZ-.16,bays=Math.ceil((endZ-startZ)/1.4);
  for(let i=0;i<=bays;i++){
    const z=startZ+(endZ-startZ)*i/bays;
    block(scene,2*legX-.06,.08,.06,.003,frame,0,-bench.thickness-.04,z);
    for(const x of [-legX,legX])block(scene,.06,.82,.06,.003,frame,x,-bench.thickness-.49,z);
  }
  // Flush graduations beside the walking lane remain visible in a following
  // camera, including after the assembly tray has passed out of view.
  const ruler=document.createElement('canvas');
  ruler.width=4096;ruler.height=48;
  const ink=ruler.getContext('2d');
  ink.fillStyle='#415156';ink.font='23px sans-serif';
  const pixelsPerMetre=ruler.width/bench.length;
  for(let cm=0;cm*.01<bench.maxZ-.06;cm+=10){
    const x=(cm*.01-bench.minZ)*pixelsPerMetre;
    const major=cm%50===0;
    ink.fillRect(x,0,2,major?21:10);
    if(major)ink.fillText((cm/100).toString()+' m',x+5,37);
  }
  const scaleMap=new T.CanvasTexture(ruler);scaleMap.colorSpace=T.SRGBColorSpace;
  scaleMap.anisotropy=benchTex.anisotropy;
  const scale=new T.Mesh(new T.PlaneGeometry(bench.length,.053),finish(0xffffff,.75,.05,{
    map:scaleMap,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1
  }));
  scale.rotation.order='YXZ';scale.rotation.y=-Math.PI/2;scale.rotation.x=-Math.PI/2;
  scale.position.set(-.31,.00012,bench.centerZ);scale.receiveShadow=true;scene.add(scale);
  const stainless=finish(0xacb7bf,.32,.84);
  const tray=new T.Group();tray.name='零件托盘';tray.position.set(partsTray.x,0,partsTray.z);scene.add(tray);
  block(tray,partsTray.width,.007,partsTray.length,.0028,stainless,0,.0035,0);
  for(const x of [-.138,.138])block(tray,.004,.018,.675,.0018,stainless,x,.013,0);
  for(const z of [-.338,.338])block(tray,.274,.018,.004,.0018,stainless,0,.013,z);
  const stand=new T.Group();stand.name='维修支架';stand.visible=false;scene.add(stand);
  const pad=finish(0x323633,.77,.015);
  const post=finish(0x87959c,.25,.92);
  const safetyMetal=finish(0xb59154,.39,.57);
  const supports=Array.from({length:4},()=>{
    const group=new T.Group();stand.add(group);
    const foot=block(group,.074,.012,.065,.005,frame,0,.006,0);
    const sleeve=block(group,.025,1,.025,.002,safetyMetal,0,0,0);
    const shaft=block(group,.014,1,.014,.002,post,0,0,0);
    const cap=block(group,.056,.009,.052,.0022,pad,0,0,0);
    return {group,foot,sleeve,shaft,cap};
  });
  return function setServiceStand(state){
    const points=state?.pads||[];
    let changed=stand.visible!==!!points.length;
    stand.visible=!!points.length;
    supports.forEach((s,i)=>{
      const p=points[i];s.group.visible=!!p;
      if(!p)return;
      const [x,y,z]=p;
      changed ||= Math.abs(s.cap.position.y-(y-.0045))>1e-5 || s.group.position.x!==x || s.group.position.z!==z;
      s.group.position.set(x,0,z);
      s.cap.position.y=y-.0045;
      const sleeveH=Math.max(.002,(y-.021)*.58),shaftH=Math.max(.001,y-.020-sleeveH);
      s.sleeve.scale.y=sleeveH;s.sleeve.position.y=.011+sleeveH/2;
      s.shaft.scale.y=shaftH;s.shaft.position.y=.011+sleeveH+shaftH/2;
    });
    if(changed)invalidate();
  };
}

// Small contact occlusion patches use only load-bearing manifold points. The
// larger cast shadow is generated independently from the moving CAD meshes.
function makeContactPatches(scene){
  const patches=new Map(),geometry=new T.PlaneGeometry(1,1);
  const material=new T.ShaderMaterial({
    transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,
    vertexShader:`varying vec2 disk;void main(){
      disk=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    }`,
    fragmentShader:`varying vec2 disk;void main(){
      float d=dot(disk,disk);
      if(d>=1.)discard;
      float shade=.58*exp(-5.8*d)*(1.-smoothstep(.38,1.,d));
      gl_FragColor=vec4(.026,.030,.033,shade);
      #include <colorspace_fragment>
    }`
  });
  return function setContacts(contacts=[]) {
    for(const patch of patches.values())patch.visible=false;
    for(const contact of contacts){
      if(!Array.isArray(contact.point)||contact.normalN<.35)continue;
      const key=contact.supportKey || contact.id+':'+contact.source;
      let patch=patches.get(key);
      if(!patch){patch=new T.Mesh(geometry,material);patch.name='接触遮蔽';patch.rotation.x=-Math.PI/2;
        patch.renderOrder=1;patches.set(key,patch);scene.add(patch);}
      const [x,y,z]=contact.point;
      patch.position.set(x,Math.max(.00016,y+.0003),z);
      const scale=T.MathUtils.clamp(.72+contact.normalN*.006,.7,1.12);
      patch.scale.set(.095*scale,.082*scale,1);patch.visible=true;
    }
  };
}

function makeOutlines(scene,renderer){
  const pixels=new T.Vector2(1,1);
  const materials=[0xdbbd83,0xff7842,0xff4242].map(color=>new T.ShaderMaterial({
    side:T.BackSide,depthWrite:false,toneMapped:false,
    uniforms:{edge:{value:new T.Color(color)},viewport:{value:pixels}},
    vertexShader:`
      uniform vec2 viewport;
      void main(){
        vec4 view=modelViewMatrix*vec4(position,1.);
        vec4 clip=projectionMatrix*view;
        vec3 n=normalize(normalMatrix*normal);
        vec2 screen=n.xy;
        float magnitude=length(screen);
        if(magnitude>.0001)clip.xy+=screen/magnitude*3.6*clip.w/viewport;
        gl_Position=clip;
      }`,
    fragmentShader:`uniform vec3 edge;
    void main(){gl_FragColor=vec4(edge,1.);
    #include <colorspace_fragment>
    }`
  }));
  const outlines=new Map();
  function setHighlights(selected=[],targets=[],blockers=[]){
    const requested=new Map();
    [targets,selected,blockers].forEach((items,priority)=>{for(const item of items)if(item?.isMesh)requested.set(item,priority);});
    for(const [mesh,proxy] of outlines)if(!requested.has(mesh)){scene.remove(proxy);outlines.delete(mesh);}
    for(const [mesh,priority] of requested){
      let proxy=outlines.get(mesh);
      if(!proxy){
        proxy=new T.Mesh(mesh.geometry,materials[priority]);proxy.matrixAutoUpdate=false;
        proxy.castShadow=false;proxy.receiveShadow=false;proxy.renderOrder=9;scene.add(proxy);outlines.set(mesh,proxy);
      }
      proxy.material=materials[priority];
    }
  }
  function update(){
    renderer.getDrawingBufferSize(pixels);
    for(const [mesh,proxy] of outlines){
      mesh.updateWorldMatrix(true,false);
      proxy.matrix.copy(mesh.matrixWorld);proxy.matrixWorldNeedsUpdate=true;proxy.visible=mesh.visible;
    }
  }
  return {setHighlights,update};
}

export function createWorkshop(canvas) {
  RectAreaLightUniformsLib.init();
  const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  const gl=renderer.getContext(),debugRenderer=gl.getExtension('WEBGL_debug_renderer_info');
  const backend=debugRenderer?gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL):'';
  const software=/swiftshader|llvmpipe|software rasterizer/i.test(backend);
  configureFinishQuality(software);
  renderer.setPixelRatio(software?.55:Math.min(devicePixelRatio,1.7));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=software?T.PCFShadowMap:T.VSMShadowMap;renderer.shadowMap.autoUpdate=false;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
  const scene=new T.Scene();
  scene.environmentIntensity=1.05;
  scene.background=new T.Color(0x303638);
  const photo=new T.TextureLoader().load('./assets/machine-shop.webp',()=>{
    photo.mapping=T.EquirectangularReflectionMapping;photo.colorSpace=T.SRGBColorSpace;
    scene.background=photo;scene.backgroundRotation.y=-1.4;scene.backgroundIntensity=.48;
    scene.environment=captureReflections(renderer,photo).texture;
    invalidate(false);
  },undefined,()=>{scene.environment=captureReflections(renderer).texture;invalidate(false);});
  const overhead=addFixture(scene,true,software);
  const setServiceStand=buildFurniture(scene,renderer,invalidate);
  const outlines=makeOutlines(scene,renderer);
  const setContacts=makeContactPatches(scene);
  const camera=new T.PerspectiveCamera(37,1,.006,25);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true; controls.dampingFactor=.13;
  controls.minDistance=.035;controls.maxDistance=bench.length*1.4;
  controls.maxPolarAngle=Math.PI*.55;
  controls.zoomToCursor=true;
  let dirty=true;
  function invalidate(shadow=true){dirty=true;if(shadow)renderer.shadowMap.needsUpdate=true;}
  controls.addEventListener('change',()=>invalidate(false));
  const target=new T.Vector3(0,.178,0);
  const directions={iso:[-1,.44,.73],front:[0,.13,1],side:[-1,.13,0],top:[0,1,.0001]};
  let view='iso',desired=null, baseDistance=1.14;
  function fit(v='iso',expand=0,instant=false) {
    view=v;
    const aspect=camera.aspect||1;
    baseDistance = Math.max(1.23,1.64/aspect);
    const radius=baseDistance*(1+expand*.65)*(v==='front'?.87:1);
    const to=target.clone();to.y+=expand*.07;
    desired={to,pos:new T.Vector3(...directions[v]).normalize().multiplyScalar(radius).add(to)};
    if(instant){camera.position.copy(desired.pos);controls.target.copy(to);desired=null;controls.update();}
    invalidate(false);
  }
  controls.addEventListener('start',()=>{desired=null;});
  const cameraTrack=new T.Vector2();
  function followTravel(x,z,instant=false){
    const dx=x-target.x,dz=z-target.z;
    const moved=Math.abs(dx)+Math.abs(dz)>1e-7;
    if(desired){
      desired.to.x+=dx;desired.to.z+=dz;
      desired.pos.x+=dx;desired.pos.z+=dz;
    }
    target.x=x;target.z=z;
    overhead.position.set(x,0,z);
    if(moved)invalidate();
    if(instant)advanceCameraTrack(1);
  }
  function advanceCameraTrack(fraction){
    const errorX=target.x-cameraTrack.x,errorZ=target.z-cameraTrack.y;
    if(Math.max(Math.abs(errorX),Math.abs(errorZ))<1e-7)return;
    const dx=errorX*fraction,dz=errorZ*fraction;
    cameraTrack.x+=dx;cameraTrack.y+=dz;
    camera.position.x+=dx;camera.position.z+=dz;
    controls.target.x+=dx;controls.target.z+=dz;
    invalidate(false);
  }
  function resize(){
    const {width,height}=canvas.getBoundingClientRect();
    if(!width||!height)return;
    renderer.setSize(width,height,false);
    camera.aspect=width/height;camera.updateProjectionMatrix();invalidate(false);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();fit('iso',0,true);
  const picker=new T.Raycaster(),mouse=new T.Vector2();
  let start=null;
  function onPick(objects,callback){
    canvas.addEventListener('pointerdown',e=>{if(e.isPrimary&&e.button===0)start=[e.clientX,e.clientY];else start=null;});
    canvas.addEventListener('pointercancel',()=>{start=null;});
    canvas.addEventListener('pointerup',e=>{
      if(!start || Math.hypot(e.clientX-start[0],e.clientY-start[1])>5){start=null;return;}
      start=null;
      const rect=canvas.getBoundingClientRect();
      mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
      picker.setFromCamera(mouse,camera);
      const hit=picker.intersectObjects(objects.filter(o=>o.visible),false)[0];
      callback(hit?.object.userData.instanceId??null);
    });
  }
  function focus(box) {
    const to=box.getCenter(new T.Vector3());
    const size=box.getSize(new T.Vector3()).length();
    const radius=Math.max(.095,size*1.9/Math.min(1,camera.aspect));
    const direction=camera.position.clone().sub(controls.target).normalize();
    desired={to,pos:to.clone().addScaledVector(direction,radius)};
    invalidate(false);
  }
  function frame(dt){
    // The lamp stays above the body. The observer follows the overall journey
    // while keeping the bench steady enough to see individual weight shifts.
    advanceCameraTrack(-Math.expm1(-dt/.36));
    if(desired){
      const fraction=1-Math.exp(-11*dt);
      camera.position.lerp(desired.pos,fraction);controls.target.lerp(desired.to,fraction);
      if(camera.position.distanceToSquared(desired.pos)<1e-7){camera.position.copy(desired.pos);controls.target.copy(desired.to);desired=null;}
      invalidate(false);
    }
    controls.update();
    if(dirty){
      outlines.update();
      renderer.render(scene,camera);
      dirty=false;
    }
  }
  return {renderer,scene,camera,controls,frame,fit,focus,followTravel,onPick,invalidate,setContacts,setServiceStand,setHighlights(selected,targets,blockers){outlines.setHighlights(selected,targets,blockers);invalidate(false);},get view(){return view;}};
}
