// Secondary broad phase for long perforated parts whose overall AABBs overlap.
// A rejection is valid only if *all* pairs of occupied cell blocks are separated.
import {Box3,Vector3} from 'three';
const EPS=.12; // mm
export function createOccupiedBounds(pieces) {
  const leaves=pieces.map(p=>{
    const c=new Vector3(...p.center),h=new Vector3(...p.half);
    return {c,h};
  });
  function build(items){
    if(items.length===1)return items[0];
    const box=new Box3();
    for(const {c,h} of items){box.expandByPoint(c.clone().sub(h));box.expandByPoint(c.clone().add(h));}
    const c=box.getCenter(new Vector3()),h=box.getSize(new Vector3()).multiplyScalar(.5);
    const axis=h.x>=h.y&&h.x>=h.z?'x':h.y>=h.z?'y':'z';
    items.sort((a,b)=>a.c[axis]-b.c[axis]);
    const n=items.length>>1;
    return {c,h,a:build(items.slice(0,n)),b:build(items.slice(n))};
  }
  return build(leaves);
}
export function occupiedPairTest(treeA,treeB){
  const cache=new Map();let gen=0;
  function bounds(n,m){
    let t=cache.get(n);if(!t){t={c:new Vector3(),h:new Vector3()};cache.set(n,t);}
    if(t.gen!==gen){
      t.gen=gen;t.c.copy(n.c).applyMatrix4(m);
      const a=m.elements,{x,y,z}=n.h;
      t.h.set(Math.abs(a[0])*x+Math.abs(a[4])*y+Math.abs(a[8])*z,Math.abs(a[1])*x+Math.abs(a[5])*y+Math.abs(a[9])*z,Math.abs(a[2])*x+Math.abs(a[6])*y+Math.abs(a[10])*z);
    }
    return t;
  }
  function visit(a,b,m){
    const t=bounds(b,m),h=a.h,c=a.c;
    if(Math.abs(c.x-t.c.x)>h.x+t.h.x+EPS||Math.abs(c.y-t.c.y)>h.y+t.h.y+EPS||Math.abs(c.z-t.c.z)>h.z+t.h.z+EPS)return false;
    if(!a.a&&!b.a)return true;
    if(!b.a||(a.a&&h.lengthSq()>t.h.lengthSq()))return visit(a.a,b,m)||visit(a.b,b,m);
    return visit(a,b.a,m)||visit(a,b.b,m);
  }
  return matrix=>{gen++;return visit(treeA,treeB,matrix);};
}
