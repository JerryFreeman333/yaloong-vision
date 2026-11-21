import * as T from 'three';
import {bench,onWalkingSurface} from './bench.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {applyFinish} from './finishes.js';
import {createCollisionGuard} from './collisions.js';
import {createDynamics} from './dynamics.js';
import {createTray} from './tray.js';
import {createSolidOverlay} from './solid-overlay.js';
import {createPartSolids} from './part-solids.js';
import {createArticulationGuard} from './articulation.js';
import {createMovement,fittingRoute,handleTransform} from './movement.js';
import {rigidRoute,toolHead} from './manipulator.js';
import {createStationUI} from './station-ui.js';
import {createUI} from './ui.js';
import {createWorkshop} from './workshop.js';
import {createMechanics,poseAngles} from './mechanics.js';
import {addFasteners} from './fasteners.js';
import {addBatteryBody} from './battery.js';
import {createProcedures} from './procedures.js';
import {embeddedCourse,embeddedStation,connectCourse,connectStation,reportCourseFailure} from './whole-guide-bridge.js';
import './whole-guide.css';
import {createBenchPlacement,createCourseFixture} from './bench-placement.js';
if (embeddedCourse || embeddedStation) document.documentElement.classList.add('whole-course-embedded');
if (embeddedStation) document.documentElement.classList.add('process-station-embedded');

const ui=createUI((action,payload)=>dispatch?.(action,payload));
let dispatch=null;
const json=async name=>{
  const response=await fetch('./assets/'+name);
  if(!response.ok) throw new Error(name+' '+response.status);
  return response.json();
};

async function boot() {
  const galleryFeature = new URLSearchParams(location.search).get('feature');
  const workshop=createWorkshop(document.querySelector('#viewport'));
  const {scene}=workshop;
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [assembly,kinematics,manual,screws,approaches,gltf]=await Promise.all([
    json('assembly.json'),json('kinematics.json'),json('procedures.json'),json('fasteners.json'),json('approaches.json'),loader.loadAsync('./assets/bpx-runtime.glb')
  ]);
  const frame=gltf.scene.getObjectByName('CADFrame');
  if(!frame)throw new Error('模型缺少 CAD 坐标系');
  addBatteryBody(assembly,frame);
  addFasteners(assembly,frame,screws);
  const root=assembly.nodes[0];
  frame.position.set(-root.center[0]*.001,-root.min[1]*.001,-root.center[2]*.001);
  scene.add(gltf.scene);
  const proc=createProcedures(assembly,manual), mech=createMechanics(assembly,kinematics);
  const nodes=new Map(assembly.nodes.map(n=>[n.id,n]));
  const entries=[],byMeshId=new Map();

  frame.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const id=mesh.userData.instanceId||mesh.name;
    if(!nodes.has(id))return;
    mesh.userData.instanceId=id;mesh.updateMatrix();mesh.matrixAutoUpdate=false;
    mesh.castShadow=true;mesh.receiveShadow=true;
    const row=nodes.get(id);
    applyFinish(mesh,row,assembly);
    const entry={id,host:row.hostId||id,fastener:row.fastener,axis:row.removalAxis?new T.Vector3(...row.removalAxis):null,mesh,base:mesh.matrix.clone(),battery:proc.batteryMotion(id)};
    byMeshId.set(id,entry);entries.push(entry);
  });
  if(entries.length<assembly.stats.meshInstances) throw new Error('装配实例与网格未能完整对应');
  const pathOf=n=>{const a=[];for(let p=n;p;p=nodes.get(p.parent))a.unshift(p.name);return a;};
  const legNames={LF:'左前腿',RF:'右前腿',LR:'左后腿',RR:'右后腿'};
  const display=n=>n.name.replace(/^C[12]-(?:\d+-)*\d+[-\s]*/,'').split('^')[0].replace(/^_+/,'').trim()||n.name;
  const groupFor=n=>{
    const leg=mech.legFor(n.id);
    if(leg)return legNames[leg];
    const path=pathOf(n).join('/');
    return path.includes('电池组')?'电池模块':path.includes('电控盒模块')?'电控盒':'躯干框架';
  };
  const partRows=assembly.nodes.filter(n=>n.parent && n.center && proc.leaves(n.id).length && (n.geometry || /腿组件|电机组件|电控盒模块|C2电池组|髋膝连接线|侧摆到髋连接线/.test(n.name)))
    .map(n=>({id:n.id,name:display(n),code:n.name.match(/^C\d-[\d-]+/)?.[0]?.replace(/-$/,'')||'',group:groupFor(n)}));
  const rank=['躯干框架','左前腿','右前腿','左后腿','右后腿','电池模块','电控盒'];
  partRows.sort((a,b)=>rank.indexOf(a.group)-rank.indexOf(b.group));
  ui.loading('正在建立 CAD 碰撞体与关节约束');
  const guard=await createCollisionGuard(assembly,entries);
  const solids=createPartSolids(assembly,entries);
  const dynamics=await createDynamics(assembly,kinematics,mech,solids);
  const articulation=createArticulationGuard(assembly,kinematics,entries,guard);
  const solidOverlay=createSolidOverlay(solids);
  const tray=createTray(frame,solids),gripper=toolHead(frame);
  const free=new Map(), freeLeaf=new Map();
  const serviceVectors=new Map(Object.entries(approaches).map(([key,v])=>[key.slice(key.indexOf('/')+1),v]));
  const floorY=root.min[1];
  const footByPart=new Map();
  for(const foot of assembly.nodes.filter(n=>n.name.includes('077 足端'))){
    for(const part of assembly.nodes.filter(n=>n.parent===foot.parent&&n.name.includes(' 足端')))footByPart.set(part.id,foot.id);
  }
  const footServiceLift=.072;
  const pack=assembly.nodes.find(n=>n.name.startsWith('C2-8-0-024 ')).id;
  const batteryDescription=manual.batteryMotion;
  const limits={sway:kinematics.limits.roll,hip:kinematics.limits.hip,knee:kinematics.limits.knee};
  let courseBridge=null,stationJob=null;
  let stationAxes={lateralMm:0,tiltDeg:0};
  let indexedBatteryPose=null,poseTravel=null;
  let inspectionLeaves=new Set();
  const preloadGapMm=2;
  let activeLeg='LF', mode='inspect', returnMode='inspect', guide=proc.snapshot(),selected=null;
  let goals=poseAngles(), gait=false, detached=[], jig=false, standLift=.012, pendingPose=null;
  let physics=dynamics.step(0,goals,{}), blockers=[], activeTarget=null;
  let pull=0,handle=0,viewPull=0,viewHandle=0,explode=0,explodeGoal=0,savedExplosion=null;
  let staged=new Set(), heldRoots=new Map(), outside=new Set(), frameNo=0;
  const physicalFrame=new T.Matrix4(),batteryLocal=new T.Matrix4(), tmp=new T.Matrix4();
  const tmpV=new T.Vector3();
  const station=createStationUI({
    alignment(){ if(!movement.busy){blockers=[];styleSelections();configureStage();paint();} },
    cancel(){movement.rollback();}
  });
  const alignment=()=>embeddedStation?stationAxes:station.alignment();
  const movement=createMovement(guard,byMeshId,station,ids=>{blockers=ids;styleSelections();},gripper,()=>workshop.invalidate());
  let wire = null, wireStep = null, pickedSource = false, pickedSocket = false;
  const benchPlacement=embeddedCourse ? createBenchPlacement({frame,workshop,entriesFor:id=>partEntities(id,true),
    fitted,pick:select,install:()=>guideAction('next')}) : null;
  function meshes(ids){return ids.map(id=>byMeshId.get(id)?.mesh).filter(Boolean);}
  function styleSelections(){
    const targets=mode==='guide' && !embeddedStation?guide.targetIds:[];
    workshop.setHighlights(meshes(selected?proc.leaves(selected):[]),meshes(targets),meshes(blockers));
  }
  function focusPart(id){
    const box=new T.Box3();scene.updateMatrixWorld(true);
    for(const leaf of proc.leaves(id)){
      const e=byMeshId.get(leaf);if(!e?.mesh.visible)continue;
      if(!e.mesh.geometry.boundingBox)e.mesh.geometry.computeBoundingBox();
      box.union(e.mesh.geometry.boundingBox.clone().applyMatrix4(e.mesh.matrixWorld));
    }
    if(!box.isEmpty())workshop.focus(box);
  }
  function fitted(e,out=new T.Matrix4(),h=viewHandle,b=viewPull){
    physicalFrame.copy(mech.matrixFor(e.host));
    if(e.battery.pack){
      batteryLocal.makeTranslation(...batteryDescription.pull.map(x=>x*b*(mode==='guide'?2.05:1)));
      if(e.battery.handle && h)batteryLocal.multiply(handleTransform(batteryDescription,h,tmp));
      physicalFrame.multiply(batteryLocal);
    }
    out.multiplyMatrices(physicalFrame,e.base);
    if (embeddedCourse && mode==='guide' && guide.chapter.id==='legs') {
      // Leg subassemblies stay beside the chassis until the mounting chapter.
      const leg=mech.legFor(e.host);
      if(leg) out.elements[12]+=leg[0]==='L'?210:-210;
    }
    return out;
  }
  function partEntities(id,includeDetached=false){
    return proc.leaves(id).filter(leaf=>includeDetached||!freeLeaf.has(leaf)||freeLeaf.get(leaf)===id)
      .map(leaf=>byMeshId.get(leaf)).filter(Boolean);
  }
  function direction(id){
    const row=nodes.get(id);
    let v=mech.removalOffset(id,1);
    if(embeddedCourse && bottomRails.includes(id))v.set(nodes.get(id).center[0]>root.center[0]?84:-84,0,0);
    else if(mode==='guide'&&approaches[guide.chapter.id+'/'+id])v.fromArray(approaches[guide.chapter.id+'/'+id]);
    else if(row.fastener)v.set(...row.removalAxis).normalize().multiplyScalar(Number(row.spec.split('×')[1])+13);
    else if(serviceVectors.has(id))v.fromArray(serviceVectors.get(id));
    else if(guard.approach){const travel=v.length();v=guard.approach(id,v).multiplyScalar(travel);}
    const body=mech.matrixFor(row.hostId||id);
    const len=v.length();v.transformDirection(body).multiplyScalar(len);return v;
  }
  function stagePose(id,e,out,aligned=true){
    fitted(e,out);
    const offset=direction(id);
    out.elements[12]+=offset.x;out.elements[13]+=offset.y;out.elements[14]+=offset.z;
    if(aligned && mode==='guide' && nodes.get(id).fastener)applyAlignment(out,offset);
    return out;
  }
  function applyAlignment(out,axis,lead=1){
    const {lateralMm,tiltDeg}=alignment();
    if(!lead || (!lateralMm && !tiltDeg))return out;
    const side=new T.Vector3(0,1,0);if(Math.abs(axis.clone().normalize().dot(side))>.8)side.set(0,0,1);
    side.cross(axis).normalize();out.elements[12]+=side.x*lateralMm*lead;out.elements[13]+=side.y*lateralMm*lead;out.elements[14]+=side.z*lateralMm*lead;
    const pivot=new T.Vector3().setFromMatrixPosition(out);
    const rotation=new T.Matrix4().makeRotationAxis(side,lead*tiltDeg*Math.PI/180);
    rotation.setPosition(pivot.clone().sub(pivot.clone().applyMatrix4(rotation)));return out.premultiply(rotation);
  }
  function packOffset(out,angle,pulled,e){
    fitted(e,out,angle,pulled);
    if(mode!=='guide'||guide.step?.id!=='battery-04'||!pulled)return out;
    const {lateralMm,tiltDeg}=alignment();
    if(!lateralMm && !tiltDeg)return out;
    const pivot=new T.Vector3(...nodes.get(pack).center);
    pivot.addScaledVector(new T.Vector3(...batteryDescription.pull),pulled*2.05).applyMatrix4(mech.matrixFor(pack));
    const rx=new T.Matrix4().makeRotationY(tiltDeg*Math.PI/180);
    rx.setPosition(pivot.clone().sub(pivot.clone().applyMatrix4(rx)).add(new T.Vector3(0,0,lateralMm)));
    return out.premultiply(rx);
  }
  // The manual supplies the electronics as a boxed subassembly. Its lid and
  // circuit board become visible with the installed housing. The battery is a later operation.
  const controlBody = assembly.nodes.find(n => n.name.includes(manual.selectors.controlBody));
  const controlModuleLeaves = controlBody ? proc.leaves(controlBody.parent).filter(id => !proc.batteryMotion(id).pack) : [];
  const bottomRails=proc.chapters[0].steps[0].roots;
  const teachingFixture=embeddedCourse ? createCourseFixture(frame,workshop,floorY,bottomRails.map(id=>nodes.get(id)),
    assembly.nodes.filter(n=>n.name.includes('077 足端')).map(node=>({node,tag:mech.legFor(node.id)})),id=>mech.matrixFor(id)) : null;
  const frameLeaves = new Set(proc.chapters[0].steps.flatMap(step=>step.roots.flatMap(proc.leaves)));
  const assembledFrame = new Set([...frameLeaves,...controlModuleLeaves]);
  const legOrder = manual.legs.map(leg=>leg.id);
  const mountLegRoots = new Map(proc.chapters.find(c=>c.id==='mount').steps.filter(s=>s.role==='leg').map(s=>[s.leg,s.roots[0]]));
  const mountHardware=new Set(proc.chapters.find(c=>c.id==='mount').steps.filter(s=>s.role==='screw').flatMap(s=>s.roots));
  let parkedMountLegs = new Set(), legsOnCradles = new Set();
  function configureStage(){
    staged=new Set();heldRoots=new Map();outside=new Set();
    if(mode==='guide'){
      staged=new Set(guide.visual.stagedIds);
      const evaluating=stationJob && (stationJob.step.id!==guide.step?.id || stationJob.history.length===stationJob.required);
      if(guide.step?.stage && !evaluating){
        activeTarget=guide.targetRootIds.includes(selected)?selected:guide.targetRootIds.find(k=>proc.leaves(k).includes(selected))||guide.targetRootIds[0];
        if(activeTarget){
          const future=new Set(proc.preview('next',{selectedId:activeTarget,confirmed:true}).state.visual.stagedIds);
          for(const id of proc.stageLeaves(activeTarget))if(staged.has(id)&&!future.has(id))heldRoots.set(id,activeTarget);
        }
      }else activeTarget=null;
      if(stationJob) {
        for(const id of stationJob.preloaded){staged.delete(id);heldRoots.delete(id);}
      }
      const frameMembers=guide.chapter.id==='frame' ?
        (controlBody && !guide.visual.stagedRootIds.includes(controlBody.id)?assembledFrame:frameLeaves) : null;
      const legInJig=(stationJob?.step||guide.step)?.leg;
      parkedMountLegs=new Set();
      if(embeddedCourse && guide.chapter.id==='mount'){
        for(const [tag,rootId] of mountLegRoots){
          if(guide.visual.stagedRootIds.includes(rootId) && activeTarget!==rootId) parkedMountLegs.add(tag);
        }
      }
      const activeLegIndex=legOrder.indexOf(legInJig);
      legsOnCradles=guide.chapter.id==='legs'?new Set(legInJig?legOrder.slice(0,activeLegIndex+1):legOrder):parkedMountLegs;
      for(const e of entries){
        const tag=mech.legFor(e.host);
        const awayFromLegJig = embeddedCourse
          ? tag ? Boolean(legInJig && legOrder.indexOf(tag)>legOrder.indexOf(legInJig)) : !assembledFrame.has(e.id)
          : (legInJig?tag!==legInJig:!tag);
        if((frameMembers&&!frameMembers.has(e.id))||
          (guide.chapter.id==='legs' && awayFromLegJig)||
          (guide.chapter.id==='mount' && e.battery.pack))outside.add(e.id);
      }
    }
    detached=mode==='guide'?[...new Set([...staged,...outside])]:proc.detachedLeafIds;
    jig=mode==='guide'?guide.chapter.id!=='battery':proc.detachedIds.some(needsStand);
    standLift=mode!=='guide'&&proc.detachedIds.some(id=>footByPart.has(id))?footServiceLift:.012;
  }
  function paint(){
    teachingFixture?.(guide.chapter.id,legsOnCradles);
    if(mode==='explode' && savedExplosion){
      for(const e of entries){
        const saved=savedExplosion.get(e.id);e.mesh.visible=saved.visible;e.mesh.matrix.copy(saved.matrix);
        mech.explodeOffset(e.host,explode,tmpV);if(e.fastener)tmpV.addScaledVector(e.axis,48*explode);
        const m=e.mesh.matrix.elements;m[12]+=tmpV.x;m[13]+=tmpV.y;m[14]+=tmpV.z;e.mesh.matrixWorldNeedsUpdate=true;
      }
      return;
    }
    for(const e of entries){
      const mesh=e.mesh, held=mode==='guide'?heldRoots.get(e.id):null;
      const parked = embeddedCourse && mode==='guide' && guide.chapter.id==='mount' && parkedMountLegs.has(mech.legFor(e.host));
      // Trunk fasteners belong to the mounting step, not to the waiting leg.
      const looseLeg = parked && (!e.fastener || !mountHardware.has(e.id));
      mesh.visible=!outside.has(e.id) && (!staged.has(e.id)||!!held||looseLeg);
      if(!mesh.visible)continue;
      if(mode!=='guide' && freeLeaf.has(e.id)){
        const owner=freeLeaf.get(e.id);const parked=free.get(owner);
        if(parked && !tray.has(owner))mesh.matrix.copy(parked.held.get(e.id));
      }else if(held)stagePose(held,e,mesh.matrix);
      else if(e.battery.pack)packOffset(mesh.matrix,viewHandle,viewPull,e);
      else fitted(e,mesh.matrix);
      if(looseLeg) mesh.matrix.elements[12]+=mech.legFor(e.host)[0]==='L'?210:-210;
      if(stationJob && mode==='guide') {
        const inspection=inspectionLeaves.has(e.id)?stationJob.visual:null;
        if(inspection==='missing')mesh.visible=false;
        if(inspection==='unseated'){
          const v=direction(stationJob.targetId).multiplyScalar(.28);
          mesh.matrix.elements[12]+=v.x;mesh.matrix.elements[13]+=v.y;mesh.matrix.elements[14]+=v.z;
        }else if(e.fastener && (inspection==='loose'||(stationJob.preloaded.has(e.id)&&!stationJob.history.includes(e.id)))){
          translateAlongScrew(e.id,mesh.matrix,preloadGapMm);
        }
      }
      mesh.matrixWorldNeedsUpdate=true;
    }
    for(const [id,f] of free){if(mode==='guide'||tray.has(id))f.grip.hide();else f.grip.show(f.entities);}
    if(mode==='guide'&&activeTarget)gripper.show([...heldRoots.keys()].map(id=>byMeshId.get(id)));else gripper.hide();
    if(mode==='guide' && guide.chapter.id==='battery' && viewPull>.8 && !activeTarget)gripper.show(partEntities(pack,true));
  }
  const nowMatrices=es=>new Map(es.map(e=>[e.id,e.mesh.matrix.clone()]));
  function fittedMap(es){return new Map(es.map(e=>[e.id,fitted(e)]));}
  function translated(mats,v){return new Map([...mats].map(([id,m])=>{
    const b=m.clone();b.elements[12]+=v.x;b.elements[13]+=v.y;b.elements[14]+=v.z;return [id,b];
  }));}
  function begin(config){
    if(movement.busy||pendingPose)return false;
    blockers=[];styleSelections();
    return movement.start({...config,floorY,cancelled:()=>{config.onRollback?.();refresh(false);courseBridge?.rolledBack?.();}});
  }
  function finishGuide(direction){
    const result=direction==='prev'?{state:proc.previous()}:proc.advance({selectedId:selected,confirmed:true});
    guide=result.state;selected=null;refresh(true);
    courseBridge?.progress(direction);
  }
  function refresh(clearAlignment=false){
    guide=proc.snapshot();
    if(mode==='guide'){
      viewHandle=Number(guide.visual.handleOpen);viewPull=Number(guide.visual.batteryOut);
    }else {viewHandle=handle;viewPull=pull;}
    configureStage();
    const s=guide.step, picked=guide.targetRootIds.some(id=>selected===id||proc.leaves(id).includes(selected));
    if(embeddedCourse){
      wire = s ? proc.wireTargets(guide.chapter.id,s) : null;
      if(wireStep!==s?.id){wireStep=s?.id;pickedSource=false;pickedSocket=false;}
    }
    ui.setChapters(proc.chapters,guide.chapter.id);
    let detail = s?.detail || '可选择其他章节继续操作。';
    if (galleryFeature === 'collision' && s?.id === 'battery-01') {
      detail += ' 完成前三步后，在第四步调节电池的横向偏移，观察导向槽如何阻止错位装入。';
    }
    if (galleryFeature === 'collision' && s?.id === 'battery-04') {
      detail += ' 将「横向偏移」调到 6 mm，点击「推入电池」。受阻后点击「退回起点」，再点「回到导向轴」重新推入。';
    }
    if(embeddedCourse && s?.id==='frame-01'){
      detail='取一根 320 mm 方管，沿机身前后方向放在底框定位处。第二根与第一根平行，两端留给短梁连接。';
    }
    const action=wire?'插接线束':s?guide.uiLabel:'已完成';
    let selectable=guide.targetRootIds.map(id=>({id,name:display(nodes.get(id))+
      (s.roots.length>1?' · '+(s.roots.indexOf(id)+1):'')}));
    if(wire){
      selectable=[{id:wire.sourceId,name:'取线 · '+display(nodes.get(wire.sourceId)),type:'guide-wire-source'},
        {id:wire.targetId,name:'对接 · '+display(nodes.get(wire.targetId)),type:'guide-wire-target'}];
    }
    ui.setStep({index:guide.index,total:guide.count,title:s?.title||'本章装配完成',text:detail+
      (guide.acceptedCount?'（已完成 '+guide.acceptedCount+' / '+guide.requiredCount+'）':''),
      source:s?'拼装说明书 · 第 '+s.page+' 页':'',action,complete:guide.complete,
      canNext:wire?pickedSource&&pickedSocket:s?.kind!=='part'||picked,targets:selectable});
    if (embeddedCourse) {
      const buttons=document.querySelectorAll('.guide-targets button');
      buttons.forEach((button,i)=>{
        if(selectable[i].type)button.classList.add(selectable[i].type);
        button.setAttribute('aria-pressed',String(wire?(i===0?pickedSource:pickedSocket):selectable[i].id===selected));
      });
    }
    if(guide.acceptedCount)document.querySelector('[data-step="prev"]').disabled=false;
    station.showAlignment(mode==='guide'&&(s?.role==='screw'||s?.id==='battery-04'),clearAlignment);
    paint();styleSelections();workshop.invalidate();
    if(benchPlacement){
      let marker=null;
      if(wire) {
        marker = pickedSource ? {id:wire.targetId,label:pickedSocket?'插接线束':'点选目标接口',install:pickedSocket}
          : {id:wire.sourceId,label:'取线束'};
      }else if(s?.kind==='part'){
        const id=picked?selected:guide.targetRootIds[0];
        marker={id,label:picked?(s.role==='screw'?'旋入此孔':s.stage?'装入此处':action):(s.stage?'拿取零件':'选择工件'),
          install:picked,seat:picked&&s.stage,draggable:!picked&&!!s.stage};
      }
      benchPlacement.configure(marker);
    }
  }
  let showSolids=false;
  function inspectSolids(){
    const es=showSolids && selected && mode==='inspect'?partEntities(selected,true):[];
    solidOverlay.show(es);workshop.invalidate(false);
  }
  function extra(label,fn){
    const el=document.createElement('button');el.className='focus-part';el.type='button';el.textContent=label;
    el.onclick=fn;document.querySelector('#selection').append(el);return el;
  }
  function select(id){
    if(movement.busy||pendingPose||poseTravel)return;
    if (wire) {
      if(id===wire.sourceId){pickedSource=true;pickedSocket=false;}
      else if(id===wire.targetId && pickedSource){pickedSocket=true;}
      else {pickedSocket=false; ui.status(pickedSource?'此处不是本步的目标接口，请沿线束查找对应电机。':'请先取本步要接的线束。');}
    }
    selected=id&&nodes.has(id)?id:null;blockers=[];inspectSolids();
    const info=selected?proc.removalInfo(selected):null;
    ui.select(selected,info?{...info,hint:info.message}:{});
    if(info&&mode==='inspect'){
      extra('近看零件',()=>focusPart(selected));
      const solidButton=extra(showSolids?'隐藏碰撞体':'显示碰撞体',()=>{
        showSolids=!showSolids;inspectSolids();
        solidButton.setAttribute('aria-pressed',String(showSolids));solidButton.textContent=showSolids?'隐藏碰撞体':'显示碰撞体';
      });
      solidButton.setAttribute('aria-pressed',String(showSolids));
      if(selected===pack&&!info.removed && !handle)extra('为电池解锁',()=>drivePose('liftRF',()=>toggleHandle(true)));
      if(selected===pack && !info.removed && handle)extra('扣合电池把手',()=>toggleHandle(false));
      if(info.blockerIds.length)extra('定位待拆件',()=>{const i=info.blockerIds[0];select(i);focusPart(i);});
      if(free.has(selected)&&!tray.has(selected))extra('放入托盘并松夹',()=>transfer(selected,false));
      if(free.has(selected)&&tray.has(selected))extra('从托盘取回',()=>transfer(selected,true));
    }
    if(mode==='guide')refresh();else styleSelections();
    courseBridge?.selection();
  }
  function guideAction(dir){
    if(movement.busy||pendingPose||poseTravel)return;
    if(dir==='next' && wire && !(pickedSource&&pickedSocket)){ui.status('请先取线束，再点选目标接口。');return;}
    if(dir==='restart'){proc.reset();selected=null;goals=poseAngles();physics=dynamics.reset();refresh(true);return;}
    const preview=proc.preview(dir,{selectedId:selected,confirmed:true});
    if(!preview.ok){const message=preview.message||'已经是第一步';ui.status(message);courseBridge?.failed?.(message);return;}
    const next=preview.state,prev=guide;
    const commit=()=>finishGuide(dir);
    if(indexedBatteryPose&&prev.visual.pose!==next.visual.pose){
      const target=poseAngles(next.visual.pose);
      const hit=articulation.check(indexedBatteryPose.angles,target,{bodyMatrix:indexedBatteryPose.body});
      if(!hit.ok){const message=hit.message||'机构运动路径受阻。';ui.status(message);courseBridge?.failed?.(message);return;}
      poseTravel={start:performance.now(),source:indexedBatteryPose.angles,fromLift:indexedBatteryPose.lift,
        target,lift:next.visual.pose==='liftRF'?56:0,commit};
      return;
    }
    if(prev.visual.pose!==next.visual.pose){if(!drivePose(next.visual.pose,commit))courseBridge?.failed?.('当前姿态干涉，请调整后重新操作。');return;}
    const dh=Number(next.visual.handleOpen)-viewHandle,dp=Number(next.visual.batteryOut)-viewPull;
    if(dh||dp){
      const es=partEntities(pack,true).filter(e=>!dh||e.battery.handle),h=viewHandle,b=viewPull;
      begin({ids:es.map(e=>e.id),kind:dh?'handle':'battery',grip:!dh,segments:dh?16:1,
        progress:(t,dt)=>{
          if(indexedBatteryPose)return; // The course jig holds all four linkages during insertion.
          const insertion=b+t*dp;
          physics=dynamics.step(dt,goals,{detachedIds:detached,batteryOut:Math.min(1,insertion*2.05),batteryTravelMm:insertion*451,handleFraction:h+t*dh,serviceStand:false});
          for(const e of entries)if(!e.battery.pack){fitted(e,e.mesh.matrix);e.mesh.matrixWorldNeedsUpdate=true;}
          workshop.setContacts?.(physics.contacts);station.update(physics);
        },
        approachError:dp && !next.visual.batteryOut?{id:pack,...alignment()}:null,
        at:(t,id,out)=>packOffset(out,h+t*dh,b+t*dp,byMeshId.get(id)),label:dh?'转动电池把手':'沿导槽移动电池',commit});
      return;
    }
    const future=new Set(next.visual.stagedIds),past=new Set(prev.visual.stagedIds);
    const inserting=dir!=='prev';
    const changed=[...(inserting?past:future)].filter(id=>!(inserting?future:past).has(id));
    if(!changed.length){commit();return;}
    const roots=inserting?prev.targetRootIds:next.targetRootIds;
    const id=roots.find(id=>proc.leaves(id).some(x=>changed.includes(x)))||changed[0];
    const es=changed.map(id=>byMeshId.get(id)).filter(Boolean);
    const directionVec=direction(id),screw=nodes.get(id).fastener?nodes.get(id):null;
    const seated=fittedMap(es),stage=translated(seated,directionVec);
    const from=inserting?stage:seated,to=inserting?seated:stage;
    const dock=fittingRoute(from,to,screw,directionVec.length(),inserting);
    const at=screw?(t,k,out)=>applyAlignment(dock(t,k,out),directionVec,inserting?1-t:t):dock;
    begin({ids:es.map(e=>e.id),kind:screw?'screw':'part',at,label:inserting?'夹具送入零件':'沿安装路径退出',
      approachError:inserting&&screw?{id,...alignment()}:null,commit});
  }
  // The individual battery station uses the manual's three fixture positions.
  // Solve the four CAD linkages against the common support plane, then locate
  // the four jack heads under the rail contact points used by the normal jig.
  function setBatteryFixture(angles,lift=0){
    const ground=mech.update(angles);
    const body=new T.Matrix4().makeTranslation(0,ground+lift,0);
    mech.update(angles,{bodyMatrix:body});
    const pads=[];
    if(lift>.001){
      for(const x of [-130.209,9.791])for(const z of [942,1026]){
        pads.push([(x-root.center[0])*.001,(88.203+ground+lift-floorY)*.001,(z-root.center[2])*.001]);
      }
    }
    indexedBatteryPose={angles,lift,body};
    workshop.setServiceStand({pads});workshop.setContacts([]);
    paint();workshop.invalidate();
  }
  function translateAlongScrew(id,matrix,distance){
    const axis=direction(id).normalize();
    matrix.elements[12]+=axis.x*distance;matrix.elements[13]+=axis.y*distance;matrix.elements[14]+=axis.z*distance;
    return matrix;
  }
  function driveStationScrew(id,preload,commit){
    const screw=byMeshId.get(id);
    if(!screw?.fastener)return false;
    const approach=direction(id), depth=preloadGapMm;
    const end=fitted(screw), enter=preload?approach.length():depth, leave=preload?depth:0;
    const before=translateAlongScrew(id,end.clone(),enter);
    const after=translateAlongScrew(id,end.clone(),leave);
    const route=fittingRoute(new Map([[id,before]]),new Map([[id,after]]),nodes.get(id),enter-leave,true);
    // The invisible staged screw has no prior rendered pose when a student selects
    // a different valid hole. Make the chosen part the moving entity for this action.
    screw.mesh.visible=true;
    return begin({ids:[id],kind:'screw',segments:12,approachError:{id,...alignment()},
      at:(t,key,out)=>applyAlignment(route(t,key,out),approach,1-t),
      label:preload?'沿孔轴预装螺钉':'将已预装螺钉拧紧至接触面',commit});
  }
  function toggleHandle(open){
    const es=partEntities(pack,true).filter(e=>e.battery.handle);
    const a=handle,b=open?1:0;
    begin({ids:es.map(e=>e.id),kind:'handle',segments:16,label:open?'翻起电池把手':'扣合电池把手',
      at:(t,id,out)=>fitted(byMeshId.get(id),out,a+(b-a)*t,0),commit(){
        handle=b;refresh();select(pack);
      }});
  }
  function needsStand(id){
    const row=nodes.get(id);
    return !row.fastener && !proc.batteryMotion(id).pack &&
      /腿组件|足端|小腿|大腿|电机|方管|侧板|缓冲垫|抱箍/.test(row.name);
  }
  function freeAction(id,restore,standReady=false){
    const row=nodes.get(id),info=proc.removalInfo(id);
    if(!(restore?info.canRestore:info.canRemove)){ui.status(info.message);return;}
    if(restore&&tray.has(id)){transfer(id,true,()=>freeAction(id,true));return;}
    if(id===pack&&!restore&&!handle){ui.status('点击“为电池解锁”，抬起右前腿并翻开把手。');return;}
    if(!restore && needsStand(id) && !standReady){
      jig=true;
      const foot=footByPart.get(id);
      if(foot)standLift=footServiceLift;
      station.feedback(foot?'维修支架正在顶升，等待足端退出空间与稳定承重':'维修支架正在顶升，检测到承重后开始拆件');
      pendingPose={kind:'stand',foot,elapsed:0,supportedTime:0,commit:()=>freeAction(id,false,true)};
      return;
    }
    const es=partEntities(id), fitted=fittedMap(es), v=direction(id);
    const staged=translated(fitted,v), from=nowMatrices(es),to=restore?fitted:staged;
    // A loose part is held in world space while the mechanism may move. Bring
    // it back to the current approach pose before engaging the fitted surfaces.
    if(restore){
      const misplaced=es.some(e=>from.get(e.id).elements.some((n,i)=>Math.abs(n-staged.get(e.id).elements[i])>(i>=12&&i<=14?.10:.0001)));
      if(misplaced){
        begin({ids:es.map(e=>e.id),kind:'transfer',segments:8,at:rigidRoute(es,from,staged),
          label:'夹具对准当前安装轴',commit(){
            free.get(id).held=nowMatrices(es);freeAction(id,true);
          }});
        return;
      }
    }
    const at=row.fastener?fittingRoute(from,to,row,v.length(),restore):rigidRoute(es,from,to);
    begin({ids:es.map(e=>e.id),kind:row.fastener?'screw':id===pack?'battery':'part',at,
      label:restore?'夹具送回安装位':'沿退出方向拆件',commit(){
        if(restore){proc.restore(id);free.get(id)?.grip.hide();free.delete(id);for(const e of es)freeLeaf.delete(e.id);}
        else {proc.detach(id,{confirmed:true});free.set(id,{held:nowMatrices(es),entities:es,grip:toolHead(frame)});
          for(const e of es)freeLeaf.set(e.id,id);}
        refresh();select(id);
      }});
  }
  function transfer(id,take,done){
    if(movement.busy||!free.has(id))return;
    const detached=free.get(id),es=detached.entities,from=nowMatrices(es);
    const spot=take?null:tray.slot(id,es);
    if(!take&&!spot){ui.status('该零件超出托盘剩余空间，夹具继续支承。');return;}
    const {center,size}=tray.centerOf(es);
    const to=take?translated(fittedMap(es),direction(id)):translated(from,spot.target.clone().sub(center));
    const atCenter=matrices=>{
      const box=new T.Box3();
      for(const e of es)box.union(e.mesh.geometry.boundingBox.clone().applyMatrix4(matrices.get(e.id)));
      return box.getCenter(new T.Vector3());
    };
    const fromCenter=center,toCenter=atCenter(to),toolCenter=take?toCenter:fromCenter,binCenter=take?fromCenter:toCenter;
    const high=Math.max(root.max[1]+size.length()*.5+70,toolCenter.y+70);
    const outside=toolCenter.clone().sub(new T.Vector3(...root.center));outside.y=0;
    outside.normalize();
    const axes=[direction(id).normalize(),outside,new T.Vector3(0,0,Math.sign(outside.z)||1),
      new T.Vector3(Math.sign(outside.x)||1,0,0)];
    const ids=es.map(e=>e.id);
    let at;
    // Find a collision-free straight retreat before lifting past housings.
    // Recovery retraces the machine-side approach after lifting from the bin.
    const offsets=[new T.Vector3()];
    for(const axis of axes)for(const distance of [80,175,325])offsets.push(axis.clone().multiplyScalar(distance));
    for(const offset of offsets){
      const cleared=toolCenter.clone().add(offset),upper=cleared.clone();upper.y=high;
      const binTop=binCenter.clone();binTop.y=high;
      const intermediate=take?[binTop,upper,cleared]:[cleared,upper,binTop];
      const candidate=rigidRoute(es,from,to,high,intermediate);
      at=candidate;
      if(guard.sweep({ids,kind:'transfer',segments:42,at:candidate,floorY}).ok)break;
    }
    const started=begin({ids,kind:'transfer',segments:42,at,duration:1.1,onRollback:()=>{if(take)tray.hold(id,false);},label:take?'夹取零件并返回装配工位':'夹持转运到托盘',commit(){
      if(take){tray.pick(id);detached.held=nowMatrices(es);}else if(tray.release(id,es,spot)){detached.grip.hide();}
      else {ui.status('该零件无法在托盘建立支承，夹具继续夹持。');detached.held=nowMatrices(es);}
      refresh();select(id);if(done)done();
    }});
    if(started && take)tray.hold(id,true);
  }
  const gaitButton=document.querySelector('#walk-toggle'),walkReset=document.querySelector('#walk-reset');
  const walkDistance=document.querySelector('#walk-distance');
  const jumpButton=document.querySelector('#jump'),jumpPhase=document.querySelector('#jump-phase');
  const jumpLabels={crouch:'下蹲蓄力',push:'蹬地起跳',flight:'腾空',land:'触地缓冲',settle:'恢复站姿'};
  const postureControls=[...document.querySelectorAll('#joint-sliders input, [data-pose]')];
  const turnButtons=[...document.querySelectorAll('[data-turn]')];
  const highJumpButtons=[...document.querySelectorAll('[data-jump-turn]')];
  const heading=document.querySelector('#heading'),turnPhase=document.querySelector('#turn-phase');
  const neutralCenter=new T.Vector3(...root.center);
  const feet=Object.entries(kinematics.legs).map(([tag,leg])=>({
    id:assembly.nodes.find(n=>mech.legFor(n.id)===tag && n.name.includes('077 足端')).id,
    sole:leg.soleSupportPoints
  }));
  let maneuver=null,homeCenter=null,headingDatum=null;
  let hasWalked=false,walkDistanceCm=null,braking=false,landed=false,afterLanding=null;
  function nearBenchEdge(){
    const axis=physics.bodyMatrix.elements;
    const norm=Math.hypot(axis[8],axis[10])||1;
    const aheadX=bench.brakingMargin*axis[8]/norm,aheadZ=bench.brakingMargin*axis[10]/norm;
    return feet.some(f=>f.sole.some(p=>{
      tmpV.fromArray(p).applyMatrix4(mech.matrixFor(f.id)).sub(neutralCenter).multiplyScalar(.001);
      return !onWalkingSurface(tmpV.x+aheadX,tmpV.z+aheadZ);
    }));
  }
  function updateMotionButtons(){
    gaitButton.disabled=braking||Boolean(maneuver&&!maneuver.resume);
    gaitButton.textContent=braking?'正在收步':gait||maneuver?.resume?'停稳':'向前行走';
    gaitButton.setAttribute('aria-pressed',String(Boolean(gait||maneuver?.resume)));
    walkReset.disabled=!hasWalked||gait==='return'||Boolean(maneuver);
    walkReset.textContent=gait==='return'?'正在倒退':'倒退回原点';
    for(const el of [jumpButton,...turnButtons,...highJumpButtons,...postureControls])el.disabled=Boolean(maneuver);
  }
  function stopGait(){
    gait=false;braking=Boolean(physics.gaitActive);
    updateMotionButtons();
  }
  function chassisOffset(){
    return tmpV.copy(neutralCenter).applyMatrix4(physics.bodyMatrix).sub(neutralCenter);
  }
  function bodyYaw(){
    const m=physics.bodyMatrix.elements;
    return Math.atan2(m[8],m[10]);
  }
  function updateWalkReadout(){
    const angle=headingDatum===null?0:bodyYaw()-headingDatum;
    const yaw=Math.round(Math.atan2(Math.sin(angle),Math.cos(angle))*180/Math.PI);
    const text='朝向 '+(yaw>0?'左 ':yaw<0?'右 ':'')+Math.abs(yaw)+'°';
    if(heading.textContent!==text)heading.textContent=text;
    if(!hasWalked||!homeCenter)return;
    const p=chassisOffset(),distance=Math.round(Math.hypot(p.x-homeCenter.x,p.z-homeCenter.z)/10);
    if(distance!==walkDistanceCm){
      walkDistanceCm=distance;walkDistance.textContent='距原点 '+distance+' cm';walkDistance.hidden=false;
    }
  }
  function resetWalkReadout(){
    landed=false;afterLanding=null;hasWalked=false;homeCenter=null;headingDatum=null;walkDistanceCm=null;walkDistance.hidden=true;workshop.followTravel(0,0,true);stopGait();
  }
  function syncSliders(){ui.setJoints((landed?physics.angles:goals)[activeLeg],limits);}
  function checkCommand(target){
    return articulation.check(physics.angles,target,{bodyMatrix:physics.bodyMatrix,freeLeaf});
  }
  function command(target,commit=null,allowPartial=false){
    landed=false;
    const hit=checkCommand(target);
    if(!hit.ok){
      blockers=[hit.partId,hit.blockerId];styleSelections();
      const from=physics.angles;
      if(allowPartial){
        // Leave one degree of stopping travel for the driven joint before the CAD contact.
        const travel=Math.max(...Object.keys(target).flatMap(code=>Object.keys(target[code]).map(j=>Math.abs(target[code][j]-from[code][j]))));
        const t=Math.max(0,hit.fraction-1/Math.max(1,travel));
        goals=structuredClone(from);
        for(const code of Object.keys(goals))for(const joint of Object.keys(goals[code])){
          goals[code][joint]+=(target[code][joint]-goals[code][joint])*t;
        }
      }
      const part=nodes.get(hit.partId),other=nodes.get(hit.blockerId);
      ui.status(part&&other?display(part)+' 与 '+display(other)+' 发生干涉，已限制行程。':hit.message);
      syncSliders();return false;
    }
    blockers=[];styleSelections();goals=target;syncSliders();
    if(commit){pendingPose={commit,elapsed:0};station.feedback('关节驱动中，正在建立支撑');}
    return true;
  }
  function drivePose(pose,commit){
    stopGait();
    if(braking){afterLanding=()=>drivePose(pose,commit);return true;}
    const lifting=pose==='lift'||pose==='liftRF';
    const accepted=command(poseAngles(lifting?'liftRF':pose),commit);
    if(accepted&&pendingPose&&lifting){
      pendingPose.kind='raise';
      station.feedback('维修支架正在承重，等待右前腿抬起');
    }
    return accepted;
  }
  function changeMode(next){
    if(next===mode)return;
    if(maneuver){ui.setMode(mode);ui.status('动作结束后可切换模式。');return;}
    if(movement.busy||pendingPose){ui.setMode(mode);ui.status('请先完成当前操作或退回起点。');return;}
    afterLanding=null;station.feedback();blockers=[];selected=null;ui.select(null);inspectSolids();
    if(next==='explode'){
      returnMode=mode;savedExplosion=new Map(entries.map(e=>[e.id,{matrix:e.mesh.matrix.clone(),visible:e.mesh.visible}]));
      mode=next;gripper.hide();workshop.setContacts?.([]);for(const f of free.values())f.grip.hide();
      explode=0;explodeGoal=0;ui.setExplode(0);styleSelections();return;
    }
    if(mode==='explode'){mode=returnMode;explode=0;for(const e of entries){const p=savedExplosion.get(e.id);e.mesh.matrix.copy(p.matrix);e.mesh.visible=p.visible;}savedExplosion=null;workshop.fit('iso',0);}
    const prior=mode;
    mode=next;stopGait();
    if(prior==='guide'||mode==='guide'){
      goals=poseAngles(mode==='guide'?guide.visual.pose:'stand');
      physics=dynamics.reset();resetWalkReadout();
    }
    refresh(true);syncSliders();
  }
  function requestMotion(action,direction=null,resume=gait==='forward'&&Boolean(direction)){
    if(mode!=='motion'||movement.busy||pendingPose||maneuver)return;
    if(proc.detachedIds.length||handle||pull){ui.status('请先装回零件并锁合电池。');return;}
    if(gait||braking){
      stopGait();goals=poseAngles();
      if(braking){
        afterLanding=()=>requestMotion(action,direction,resume);
        ui.status(action==='jump'?'正在收步，站稳后起跳。':action==='turn'?'正在收步，站稳后转向。':'正在收步，站稳后倒退。');
        return;
      }
    }
    if(action==='forward'&&nearBenchEdge()){
      ui.status('前方落脚空间不足，可转向或倒退回原点。');return;
    }
    function start(){
      blockers=[];styleSelections();ui.status('');
      headingDatum??=bodyYaw();
      if(action==='jump'||action==='turn'){
        const label=action==='jump'?jumpPhase:turnPhase;
        maneuver={action,direction,resume,label,start:true};
        label.hidden=false;label.textContent=action==='jump'?'准备起跳':'踏步转向中';
      }else{
        homeCenter??=chassisOffset().clone();
        gait=action;braking=false;landed=false;hasWalked=true;
        updateWalkReadout();
      }
      updateMotionButtons();
    }
    const maxAngle=Math.max(...Object.values(physics.angles).flatMap(j=>Object.values(j).map(Math.abs)));
    if((maxAngle>6&&!landed)||physics.contacts.some(c=>c.source==='fixture'))drivePose('stand',start);
    else start();
  }
  gaitButton.onclick=()=>{
    if(maneuver){maneuver.resume=false;updateMotionButtons();return;}
    if(gait){afterLanding=null;stopGait();goals=poseAngles();syncSliders();return;}
    requestMotion('forward');
  };
  walkReset.onclick=()=>requestMotion('return');
  jumpButton.onclick=()=>requestMotion('jump');
  for(const el of turnButtons)el.onclick=()=>requestMotion('turn',el.dataset.turn);
  for(const el of highJumpButtons)el.onclick=()=>requestMotion('jump',el.dataset.jumpTurn);
  let sliderRequest=null;
  function updateJoint(p){
    if(gait)stopGait();
    if(braking){afterLanding=()=>updateJoint(p);return;}
    const target=structuredClone(landed?physics.angles:goals);target[p.leg][p.joint]=p.value;
    command(target,null,true);
  }
  dispatch=(action,p={})=>{
    if (embeddedStation && ['mode','chapter','step'].includes(action))return;
    if(action==='view'||action==='resetView'){workshop.fit(action==='view'?p.view:'iso',mode==='explode'?explodeGoal:0);return;}
    if(action==='mode'){changeMode(p.mode);return;}
    if(maneuver)return;
    if(action==='chapter' && (movement.busy||pendingPose))ui.setChapters(proc.chapters,guide.chapter.id);
    if(movement.busy||pendingPose||poseTravel){ui.status(movement.halted?'路径受阻，可退回起点。':'正在执行当前动作。');return;}
    switch(action){
      case 'select':select(p.id);break;
      case 'leg':activeLeg=p.leg;syncSliders();break;
      case 'joint':sliderRequest=p;break;
      case 'pose':drivePose(p.pose);break;
      case 'explode':explodeGoal=p.value;workshop.fit(workshop.view,explodeGoal);break;
      case 'chapter':proc.start(p.id);selected=null;goals=poseAngles();physics=dynamics.reset();refresh(true);break;
      case 'step':guideAction(p.direction);break;
      case 'remove':case 'restore':freeAction(p.id,action==='restore');break;
    }
  };
  workshop.onPick(entries.map(e=>e.mesh),id=>{
    if(mode==='guide'&&id){
      const stationWire=stationJob?.wire;
      let roots=guide.targetRootIds;
      if(stationWire) roots=[...stationWire.sourceOptions,...stationWire.targetOptions].map(p=>p.id);
      else if(wire) roots=[...wire.sourceIds,...wire.targetIds];
      id=roots.find(k=>proc.leaves(k).includes(id))||id;
    }
    select(id);
  });
  ui.ready({parts:partRows});document.querySelector('#part-count').textContent=entries.length.toLocaleString();
  syncSliders();refresh(true);

  const motionControls = new Map([
    ['walk', '#walk-toggle, #walk-reset'],
    ['turn', '[data-turn]'],
    ['jump', '[data-jump-turn]']
  ]);
  if (motionControls.has(galleryFeature)) {
    ui.setMode('motion');
    changeMode('motion');
    const panel = document.querySelector('[data-page="motion"]');
    const controls = panel.querySelectorAll(motionControls.get(galleryFeature));
    panel.querySelector('.panel-title').after(controls[0].closest('fieldset'));
    for (const control of controls) control.classList.add('gallery-control');
  } else if (galleryFeature === 'joint') {
    ui.setMode('motion');
    changeMode('motion');
    document.querySelector('[data-leg="RF"]').click();
    document.querySelector('#joint-sliders').prepend(document.querySelector('#joint-knee').closest('.range-row'));
  } else if (galleryFeature === 'explode') {
    ui.setMode('explode');
    changeMode('explode');
  } else if (galleryFeature === 'assembly' || galleryFeature === 'whole-course' || embeddedStation) {
    ui.setMode('guide');
    changeMode('guide');
  } else if (galleryFeature === 'battery' || galleryFeature === 'collision') {
    guide = proc.start('battery');
    ui.setMode('guide');
    changeMode('guide');
  } else if (galleryFeature === 'part') {
    const screw = screws.items.find(item => item.role === 'frameBracket' && item.spec === 'M6×16');
    if (screw) {
      select(screw.id);
      document.querySelector('[data-page="inspect"]').classList.add('gallery-part');
      focusPart(screw.id);
    }
  }

  if (embeddedCourse || embeddedStation) {
    const panel=document.querySelector('[data-page="guide"]');
    panel.inert=true;
    const focusButton=document.createElement('button');
    focusButton.className='focus-part';
    focusButton.type='button';
    focusButton.textContent='近看当前零件';
    function focusCurrent(){
      const id=wire?(pickedSource?wire.targetId:wire.sourceId):
        guide.targetRootIds.includes(selected)?selected:guide.targetRootIds[0];
      if(id)focusPart(id);
    }
    focusButton.onclick=focusCurrent;
    panel.querySelector('.step-card').after(focusButton);
    const hooks={procedures:proc,
      busy:()=>movement.busy||Boolean(pendingPose||poseTravel),
      state:()=>({selectedId:selected}),
      restore(chapter,history){
        if(!proc.restoreGuide(chapter,history))return false;
        guide=proc.snapshot();selected=null;blockers=[];wireStep=null;
        goals=poseAngles(guide.visual.pose);physics=dynamics.reset();
        station.feedback();ui.status('');syncSliders();refresh(true);
        if(chapter==='battery') setBatteryFixture(goals,guide.visual.pose==='liftRF'?56:0);
        else indexedBatteryPose=null;
        workshop.fit('iso',0,true);
        panel.inert=embeddedStation;
        return true;
      },
      step:guideAction,select,focus:focusCurrent,view:v=>workshop.fit(v),rollback:movement.rollback
    };
    if(embeddedCourse) courseBridge=connectCourse(hooks);
    else {
      courseBridge=connectStation({...hooks,
        describe(id){const row=nodes.get(id);return {id,name:display(row),spec:row.spec||''};},
        stage(job){
          stationJob=job;
          inspectionLeaves=new Set(job.targetId?proc.leaves(job.targetId):[]);
          refresh();workshop.invalidate();
        },
        align(lateralMm,tiltDeg){stationAxes={lateralMm,tiltDeg};},
        focus(id){
          if(id)focusPart(id);
          else if(stationJob?.step.leg){
            const leg=assembly.nodes.find(n=>n.name.includes(legNames[stationJob.step.leg]+'组件'));
            if(leg)focusPart(leg.id);
          }
        },
        step:dir=>dir==='commit'?finishGuide('next'):guideAction(dir),
        rollback(){if(!movement.busy)return false;movement.rollback();return true;},
        driveScrew:driveStationScrew
      });
    }
  }
  let last=performance.now(), initialPaint=true,stepCostMs=1;
  function checkWalk(from,to,endBodyMatrix){
    return articulation.check(from,to,{bodyMatrix:physics.bodyMatrix,endBodyMatrix,freeLeaf});
  }
  function solverStep(dt,options){
    // The quasi-static controller checks the entire interval in a single swept
    // query. Its cost is per rendered pose, independently of the 240 Hz solver.
    if(options.gait || physics.gaitActive || options.jump || physics.jumpActive || options.turn || physics.turnActive){
      const elapsed=Math.min(dt,.055);
      return [dynamics.step(elapsed,goals,options),elapsed];
    }
    // Bound catch-up work on slower GPUs/CPUs. Otherwise a long frame adds
    // more substeps to the following frame and input can stall for seconds.
    const substeps=Math.max(1,Math.floor(18/Math.max(.1,stepCostMs)));
    const elapsed=Math.min(dt,substeps/240);
    const before=performance.now();
    const result=dynamics.step(elapsed,goals,options);
    if(result.active && elapsed>=1/240){
      const cost=(performance.now()-before)/(elapsed*240);
      stepCostMs=stepCostMs*.80+cost*.20;
    }
    return [result,elapsed];
  }
  function loop(now){
    const dt=Math.min(.1,Math.max(.001,(now-last)/1000));last=now;
    if(sliderRequest){const p=sliderRequest;sliderRequest=null;if(mode==='motion')updateJoint(p);}
    if(mode==='explode'){
      const prev=explode;explode+= (explodeGoal-explode)*(1-Math.exp(-dt*9));
      if(Math.abs(explode-explodeGoal)<.001)explode=explodeGoal;
      if(prev!==explode){paint();workshop.invalidate();}
    }else if(movement.busy){
      if(mode!=='guide' && tray.tick(dt))workshop.invalidate();
      const halted=movement.halted;movement.tick(dt);
      if(movement.halted&&!halted)courseBridge?.blocked?.(document.querySelector('.contact-readout span').textContent);
    }else if(indexedBatteryPose){
      if(poseTravel){
        const job=poseTravel;
        const t=Math.min(1,(now-job.start)/850),u=t*t*(3-2*t);
        const angles={};
        for(const [leg,joints] of Object.entries(job.target)){
          angles[leg]={};
          for(const [axis,q] of Object.entries(joints))angles[leg][axis]=T.MathUtils.lerp(job.source[leg][axis],q,u);
        }
        setBatteryFixture(angles,T.MathUtils.lerp(job.fromLift,job.lift,u));
        if(t>=1){poseTravel=null;job.commit();}
      }
    }else{
      const previous=physics;
      let advanced;
      const pulse=maneuver?.start?maneuver:null;
      [physics,advanced]=solverStep(dt,{detachedIds:detached,batteryOut:Math.min(1,viewPull*(mode==='guide'?2.05:1)),batteryTravelMm:viewPull*(mode==='guide'?451:220),handleFraction:viewHandle,serviceStand:jig,serviceLift:standLift,indexedFixture:mode==='guide'&&guide.chapter.id!=='battery',gait,forwardSpeed:ui.forwardSpeed,checkWalk,
        jump:pulse?.action==='jump'&&(pulse.direction||true),turn:pulse?.action==='turn'&&pulse.direction});
      if(maneuver){
        maneuver.start=false;
        const isJump=maneuver.action==='jump',active=isJump?physics.jumpActive:physics.turnActive;
        if(active){
          let label=isJump?jumpLabels[physics.jumpPhase]:'踏步转向中';
          if(isJump&&physics.jumpPhase==='flight'&&maneuver.direction)label+=' · '+(maneuver.direction==='left'?'左转':'右转');
          if(label!==maneuver.label.textContent)maneuver.label.textContent=label;
        }else{
          const hit=isJump?physics.jumpBlock:physics.turnBlock,resume=maneuver.resume;
          maneuver.label.hidden=true;maneuver.label.textContent='';maneuver=null;
          landed=!hit;updateMotionButtons();syncSliders();
          if(hit){
            blockers=[hit.partId,hit.blockerId].filter(Boolean);styleSelections();
            ui.status(hit.message||'动作路径受阻。');
          }else if(resume)requestMotion('forward');
          else ui.status(isJump?'已落地站稳。':'已完成转向，四足站稳。');
        }
      }
      if(gait==='return'&&physics.atWalkOrigin&&!physics.gaitActive&&!physics.walkBlock){
        updateWalkReadout();hasWalked=false;stopGait();landed=true;syncSliders();
        ui.status('已倒退回原点，四足站稳。');
      }
      if((gait||braking) && physics.walkBlock){
        const hit=physics.walkBlock;
        afterLanding=null;stopGait();goals=structuredClone(physics.angles);syncSliders();
        blockers=[hit.partId,hit.blockerId].filter(Boolean);styleSelections();
        ui.status(hit.message||'当前支撑条件无法继续迈步，已停在上一个可行姿态。');
      }
      if(hasWalked||maneuver||previous.gaitActive||previous.turnActive||previous.jumpActive){
        const p=chassisOffset();workshop.followTravel(.001*p.x,.001*p.z);
      }
      if(braking && !physics.gaitActive){
        stopGait();landed=!physics.walkBlock;syncSliders();
        const queued=afterLanding;afterLanding=null;
        if(queued && landed)queued();
      }
      if(gait==='forward' && nearBenchEdge()){
        stopGait();goals=poseAngles();syncSliders();ui.status('前方落脚空间不足，正在收步停稳。');
      }
      if(pendingPose){
        pendingPose.elapsed+=advanced;
        const error=Math.max(...Object.keys(goals).flatMap(k=>Object.keys(goals[k]).map(j=>Math.abs(physics.angles[k][j]-goals[k][j]))));
        const onStand=pendingPose.kind==='stand';
        if(onStand){
          const load=physics.contacts.reduce((n,c)=>n+(c.source==='fixture'?c.normalN:0),0);
          let clear=true;
          if(pendingPose.foot){
            const id=pendingPose.foot, ankleFrame=mech.matrixFor(id);
            const soleHeight=Math.min(...kinematics.legs[mech.legFor(id)].soleSupportPoints.map(p=>tmpV.fromArray(p).applyMatrix4(ankleFrame).y));
            clear=soleHeight+Math.min(0,direction(id).y)>floorY+3;
          }
          const carrying=physics.standSettled&&clear&&load>physics.weightN*.5 && Math.abs(physics.totalSupportN-physics.weightN)<physics.weightN*.12;
          pendingPose.supportedTime=carrying?pendingPose.supportedTime+advanced:0;
        }
        const raised=pendingPose.kind==='raise';
        const fixtureLoad=raised?physics.contacts.filter(c=>c.source==='fixture').reduce((sum,c)=>sum+c.normalN,0):0;
        const ready=onStand?pendingPose.supportedTime>=.25:
          error<4.6&&(!raised||(physics.standSettled&&fixtureLoad>physics.weightN*.5));
        if(ready && pendingPose.elapsed>.22 && physics.totalSupportN>physics.weightN*.6){
          const commit=pendingPose.commit;pendingPose=null;station.feedback();commit();
        }else if(pendingPose.elapsed>5.5){
          pendingPose=null;configureStage();station.feedback();courseBridge?.failed?.('尚未达到工艺要求的姿态或承重条件，请重新操作。');
          ui.status(onStand?'支架尚未建立稳定承重或拆件空间不足，请恢复站立姿态后重试。':'目标姿态尚未稳定，请检查支撑或重新尝试。');
        }
      }
      const loose=mode!=='guide' && tray.tick(dt);
      if(initialPaint||physics.active||previous.active||gait||loose){
        paint();if(!teachingFixture || guide.chapter.id==='battery')workshop.setServiceStand({pads:physics.standPads});workshop.setContacts?.(physics.contacts);workshop.invalidate();initialPaint=false;
      }
      if(frameNo%8===0||maneuver||previous.turnActive||previous.jumpActive)updateWalkReadout();
      if(frameNo%8===0||physics.jumpPhase!==previous.jumpPhase){
        station.update(physics);
        if(gait||physics.jumpActive||physics.turnActive)ui.setJoints(physics.angles[activeLeg],limits);
      }
    }
    workshop.frame(dt);benchPlacement?.update(movement.busy||Boolean(pendingPose||poseTravel));frameNo++;requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
boot().catch(error=>{const message='无法打开仿真模型。'+error.message;console.error(error);ui.error(message);reportCourseFailure(message);});
