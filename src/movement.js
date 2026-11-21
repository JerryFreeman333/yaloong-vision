import {Matrix4,Vector3} from 'three';

// A single owner writes each manipulated mesh until the operation either reaches
// its fitted position or retraces its accepted path. Animation FPS never selects
// which path segments are checked.
export function createMovement(guard,byId,station,highlight,gripper,invalidate){
  let job=null;
  function write(f){
    for(const id of job.ids){
      const e=byId.get(id);
      job.at(f,id,e.mesh.matrix);e.mesh.matrixWorldNeedsUpdate=true;
    }
    if(job.grip!==false)gripper.show(job.ids.map(id=>byId.get(id)));
    invalidate();
  }
  function finish(rolledBack){
    const last=job;job=null;gripper.hide();station.feedback();highlight([]);
    if(rolledBack)last.cancelled?.();else last.commit();
  }
  function start(config){
    if(job)return false;
    const report=guard.sweep(config);
    if(!report.ok)console.info('[BPX contact]',config.kind,report.partId,report.blockerId,report.fraction);
    job={...config,pos:0,end:report.ok?1:Math.max(0,report.fraction),back:false,blocked:!report.ok,report};
    station.feedback(config.label||'正在执行装配操作');
    if(!report.ok)highlight([report.blockerId,report.partId]);
    return true;
  }
  function tick(dt){
    if(!job)return false;
    if(job.halted)return true;
    const step=dt/(job.duration||.55);
    job.pos=job.back?Math.max(0,job.pos-step):Math.min(job.end,job.pos+step);
    job.progress?.(job.pos,dt);
    write(job.pos);
    if(job.back&&job.pos===0){finish(true);return true;}
    if(!job.back&&job.pos>=job.end){
      if(job.blocked){
        job.halted=true;
        station.feedback(job.report.message||'路径受阻，请退回后调整。',true);
      }else finish(false);
    }
    return true;
  }
  function rollback(){if(job){job.back=true;job.halted=false;station.feedback('夹具沿原路径退出');}}
  function reset(){
    if(!job)return;
    write(0);finish(true);
  }
  return {start,tick,rollback,reset,get busy(){return !!job;},get halted(){return !!job?.halted;}};
}

export function fittingRoute(start,end,fastener,approachDistance=0,inserting=true){
  const rot=new Matrix4();
  const pitch=fastener?.spec?.startsWith('M3')?.5:1;
  const nominal=Number(fastener?.spec?.split('×')[1])||0;
  return (t,id,out)=>{
    const a=start.get(id),b=end.get(id);
    if(t===0)return out.copy(a);
    if(t===1)return out.copy(b);
    // Docking orientations are fixed. A screw rotates only over its engagement
    // length. After it has cleared the mating thread it translates without spin.
    out.copy(a);
    const e=out.elements,x=a.elements,y=b.elements;
    for(let j=12;j<=14;j++)e[j]=x[j]+(y[j]-x[j])*t;
    if(fastener){
      const progress=inserting?1-t:t;
      const travel=Math.min(approachDistance*progress,nominal);
      out.multiply(rot.makeRotationY(travel/pitch*Math.PI*2));
    }
    return out;
  };
}

export function handleTransform(description,fraction,out=new Matrix4()){
  const p=new Vector3().fromArray(description.origin);
  const rotated=p.clone().applyMatrix4(out.makeRotationAxis(new Vector3(...description.axis).normalize(),description.openDegrees*Math.PI/180*fraction));
  return out.setPosition(p.sub(rotated));
}
