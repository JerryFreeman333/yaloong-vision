import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Group,Vector3} from 'three';
import {createDynamics} from '../src/dynamics.js';
import {createMechanics,poseAngles} from '../src/mechanics.js';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';
const read=file=>JSON.parse(fs.readFileSync(new URL('../public/assets/'+file,import.meta.url)));
const a=read('assembly.json'),k=read('kinematics.json'),frame=new Group();
addBatteryBody(a,frame);addFasteners(a,frame,read('fasteners.json'));
const mech=createMechanics(a,k),solver=await createDynamics(a,k,mech);
const goal=poseAngles(),feet=a.nodes.filter(n=>n.name.includes('077 足端')).map(n=>{
  const points=k.legs[mech.legFor(n.id)].soleSupportPoints;
  const low=Math.min(...points.map(p=>p[1])),patch=points.filter(p=>p[1]<low+1);
  const local=patch.reduce((v,p)=>v.add(new Vector3(...p)),new Vector3()).multiplyScalar(1/patch.length);
  return {id:n.id,local};
});
const dt=1/60,trace=[];
let state;
const tick=(opts)=>state=solver.step(dt,goal,opts);
const heading=()=>Math.atan2(state.bodyMatrix.elements[8],state.bodyMatrix.elements[10])*180/Math.PI;
const pivot=Object.values(k.legs).reduce((p,leg)=>p.add(new Vector3(...leg.roll)),new Vector3()).multiplyScalar(.25);
const center=()=>pivot.clone().applyMatrix4(state.bodyMatrix);
const snapshot=()=>({angles:structuredClone(state.angles),bodyMatrix:state.bodyMatrix.toArray()});
function turn(side){
  const startHeading=heading(),start=center(),loaded=new Map(),swung=new Set();
  let slip=0,i=0;
  trace.push(snapshot());
  for(;i<600;i++){
    tick(i===0?{turn:side}:{});
    assert(!state.turnBlock,JSON.stringify({side,i,hit:state.turnBlock}));
    if(i%6===0||!state.turnActive)trace.push(snapshot());
    assert(state.contacts.length>=3);
    for(const foot of feet){
      const point=foot.local.clone().applyMatrix4(mech.matrixFor(foot.id));
      if(!state.contacts.some(c=>c.id===foot.id&&c.normalN>.4)){
        swung.add(foot.id);loaded.delete(foot.id);continue;
      }
      if(!loaded.has(foot.id))loaded.set(foot.id,point);
      const prev=loaded.get(foot.id);
      slip=Math.max(slip,Math.hypot(point.x-prev.x,point.z-prev.z));
    }
    if(!state.turnActive)break;
  }
  const angle=heading()-startHeading,delta=Math.atan2(Math.sin(angle*Math.PI/180),Math.cos(angle*Math.PI/180))*180/Math.PI;
  assert(Math.abs(delta-(side==='left'?30:-30))<.1,'heading '+delta);
  assert.equal(swung.size,4);
  const finish=center(),drift=Math.hypot(finish.x-start.x,finish.z-start.z);
  assert(drift<12,'horizontal drift '+drift);
  assert(slip<2,'planted sole drift '+slip);
  assert.equal(state.contacts.filter(c=>c.normalN>1).length,4);
  console.log(side,delta.toFixed(2),'deg, planted pad drift',slip.toFixed(2),'mm, final chassis offset',drift.toFixed(2),'mm');
}
try{
  for(let i=0;i<120;i++)tick({});
  const before=state.bodyMatrix.clone();
  tick({turn:'left',checkWalk:()=>({ok:false,message:'test obstacle'})});
  assert.equal(state.turnBlock?.message,'test obstacle');assert(before.equals(state.bodyMatrix));
  for(const side of ['left','right','right','left'])turn(side);
  for(const seconds of [3,8]){
    for(let i=0;i<seconds*60;i++){tick({gait:true});if(i%6===0)trace.push(snapshot());}
    for(let i=0;i<150;i++){tick({});if(i%6===0)trace.push(snapshot());}
    turn('left');turn('right');
  }
  if(process.argv.includes('--cad')){
    const dir=mkdtempSync(join(tmpdir(),'bpx-turn-'));
    try{
      const file=join(dir,'trace.json');fs.writeFileSync(file,JSON.stringify(trace));
      execFileSync(process.execPath,[new URL('check_articulation.mjs',import.meta.url).pathname,'--trace='+file],{stdio:'inherit'});
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
}finally{solver.dispose();}
