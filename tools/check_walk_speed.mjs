// Exercise the actual walking controller in simulation time. Pass --cad to
// replay its poses against the same swept mesh-pair guard used by the viewer.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Group, Vector3} from 'three';
import {addBatteryBody} from '../src/battery.js';
import {addFasteners} from '../src/fasteners.js';
import {createDynamics} from '../src/dynamics.js';
import {createMechanics, poseAngles} from '../src/mechanics.js';
import {onWalkingSurface, bench} from '../src/bench.js';
import {forwardSpeedRange} from '../src/walk.js';

const asset=name=>JSON.parse(readFileSync(new URL('../public/assets/'+name,import.meta.url)));
const assembly=asset('assembly.json'), calibration=asset('kinematics.json'), frame=new Group();
addBatteryBody(assembly,frame);
addFasteners(assembly,frame,asset('fasteners.json'));
const mechanism=createMechanics(assembly,calibration);
const dynamics=await createDynamics(assembly,calibration,mechanism);
const goal=poseAngles(), datum=new Vector3(...assembly.nodes[0].center);
const footIds=assembly.nodes.filter(p=>p.name.includes('077 足端')).map(p=>p.id);
const feet=new Set(footIds);
const {min,max,default:usual}=forwardSpeedRange;
const mixed=[1/60,1/120,1/30,1/60,.05,1/90,1/60];
const trace=[], cad=process.argv.includes('--cad');
let state,home,heading,lateral,ticks=0;
let lowestMargin=Infinity,highestTraction=0,sideways=0;
const center=()=>datum.clone().applyMatrix4(state.bodyMatrix);

function tick(dt,options,allowBlock=false){
  state=dynamics.step(dt,goal,options);
  if(!allowBlock)assert(!state.walkBlock,JSON.stringify({options,ticks,hit:state.walkBlock}));
  if(state.walkBalance){
    const {supportCount,marginMm,frictionRatio}=state.walkBalance;
    assert(supportCount>=3 && marginMm>0 && frictionRatio<=1,'infeasible balance');
    lowestMargin=Math.min(lowestMargin,marginMm);
    highestTraction=Math.max(highestTraction,frictionRatio);
  }
  for(const contact of state.contacts.filter(c=>feet.has(c.id) && c.source==='table')){
    assert(onWalkingSurface(contact.point[0],contact.point[2]),'loaded sole left the work surface');
  }
  if(cad && ticks%4===0)trace.push({angles:structuredClone(state.angles),bodyMatrix:state.bodyMatrix.toArray()});
  ticks++;
}

function fourFeet(){
  assert.equal(new Set(state.contacts.filter(c=>feet.has(c.id) && c.normalN>.5).map(c=>c.id)).size,4);
}

function forward(request,previous){
  const samples=[], speedMm=request*1000;
  let elapsed=0,transitionPeak=0,prior=previous;
  while(elapsed<8){
    const dt=mixed[ticks%mixed.length], before=center();
    tick(dt,{gait:'forward',forwardSpeed:request});
    assert(state.gaitActive && state.walkBalance,'speed change interrupted gait');
    const velocity=center().sub(before).dot(heading)/dt;
    if(previous!==undefined && elapsed<2){
      transitionPeak=Math.max(transitionPeak,Math.abs(velocity-prior)/dt);
    }
    prior=velocity;
    if(elapsed>=5)samples.push(velocity);
    elapsed+=dt;
    sideways=Math.max(sideways,Math.abs(center().sub(home).dot(lateral)));
  }
  const average=samples.reduce((sum,v)=>sum+v,0)/samples.length;
  assert(Math.abs(average-speedMm)<Math.max(1,speedMm*.05),'failed to track speed '+speedMm+' mm/s, measured '+average);
  assert(transitionPeak<1500,'abrupt speed jump, acceleration '+transitionPeak+' mm/s²');
  console.log('commanded / measured mm/s',speedMm.toFixed(1),average.toFixed(1),
    'peak transition acceleration mm/s²',transitionPeak.toFixed(1));
  return samples.at(-1);
}

function stop(){
  for(let i=0;i<180 && state.gaitActive;i++)tick(mixed[ticks%mixed.length],{});
  assert(!state.gaitActive,'timed out braking');
  fourFeet();
}

try{
  assert(min>0 && min<usual && usual<max);
  for(let i=0;i<150;i++)tick(1/60,{});
  home=center();
  heading=new Vector3(0,0,1).transformDirection(state.bodyMatrix).setY(0).normalize();
  lateral=new Vector3(heading.z,0,-heading.x);
  let prior;
  // Move the slider at four different points without stopping the gait.
  for(const request of [min,max,min,usual,max])prior=forward(request,prior);
  assert(sideways<8,'excessive lateral excursion while varying speed: '+sideways+' mm');
  const brakingStart=center();stop();
  assert(center().distanceTo(brakingStart)<bench.brakingMargin*1000,'stop exceeds available table-edge lookahead');
  const reached=center().sub(home).dot(heading);
  let returnSeconds=0;
  while(returnSeconds<reached/20+30 && !state.atWalkOrigin){
    const dt=mixed[ticks%mixed.length];tick(dt,{gait:'return',forwardSpeed:max});returnSeconds+=dt;
  }
  assert(state.atWalkOrigin && !state.gaitActive,'return to origin');
  fourFeet();
  const offset=center().sub(home);
  assert(Math.hypot(offset.x,offset.z)<3,'return accuracy');
  console.log('minimum support margin mm',lowestMargin.toFixed(2),'peak traction utilization',highestTraction.toFixed(3),
    'max sideways mm',sideways.toFixed(2),'return error mm',Math.hypot(offset.x,offset.z).toFixed(2));
  if(cad){
    const temp=mkdtempSync(join(tmpdir(),'bpx-speed-sweep-'));
    try{
      const file=join(temp,'poses.json');
      writeFileSync(file,JSON.stringify(trace));
      execFileSync(process.execPath,[fileURLToPath(new URL('check_articulation.mjs',import.meta.url)),'--trace='+file],{stdio:'inherit'});
    }finally{rmSync(temp,{recursive:true,force:true});}
  }
  // Deliberately keep requesting the highest speed to exercise the solver's
  // own foot-placement guard beyond the viewer's earlier braking trigger.
  let edge;
  for(let i=0;i<Math.ceil((bench.length/max+10)*30);i++){
    tick(1/30,{gait:'forward',forwardSpeed:max},true);
    if(state.walkBlock){edge=state.walkBlock;break;}
  }
  assert(edge && /台面|托盘/.test(edge.message),'expected blocked step at far table edge: '+JSON.stringify(edge));
  assert(center().sub(home).dot(heading)>3000,'stopped before reaching the far end');
  stop();
  console.log('maximum-speed forward step refused at the table edge; stopped on four feet');
}finally{dynamics.dispose();}
