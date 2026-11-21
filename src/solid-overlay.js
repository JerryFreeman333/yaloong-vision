import {BoxGeometry, BufferGeometry, CylinderGeometry, EdgesGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Vector3} from 'three';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';

// The inspection display reads the same local millimetre shapes used to build
// the physical colliders. Parenting to the occurrence keeps picking, motion,
// assembly staging and detached-part placement in the same coordinate frame.
export function createSolidOverlay(solids){
  const material=new LineBasicMaterial({color:0x38f3db,transparent:true,opacity:.83,depthTest:false,depthWrite:false,toneMapped:false});
  const geometryCache=new WeakMap();
  let visible=[];
  function outline(pieces){
    if(geometryCache.has(pieces))return geometryCache.get(pieces);
    const lines=[];
    for(const piece of pieces){
      let hull;
      if(piece.type==='box')hull=new BoxGeometry(...piece.half.map(h=>h*2));
      else if(piece.type==='cylinder')hull=new CylinderGeometry(piece.radius,piece.radius,piece.halfHeight*2,20);
      else if(piece.type==='hull'){
        const points=[];
        for(let i=0;i<piece.points.length;i+=3)points.push(new Vector3().fromArray(piece.points,i));
        hull=new ConvexGeometry(points);
      }else throw Error('未知碰撞体形状 '+piece.type);
      hull.translate(...piece.center);
      const wire=new EdgesGeometry(hull,12), positions=wire.getAttribute('position');
      for(let i=0;i<positions.count;i++)lines.push(positions.getX(i),positions.getY(i),positions.getZ(i));
      hull.dispose();wire.dispose();
    }
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(lines,3));
    geometryCache.set(pieces,geometry);
    return geometry;
  }
  function show(entries){
    for(const line of visible)line.removeFromParent();
    visible=entries.map(e=>{
      const wire=new LineSegments(outline(solids.pieces(e.id)),material);
      wire.name='碰撞体 · '+e.id;wire.renderOrder=4;e.mesh.add(wire);
      return wire;
    });
  }
  return {show};
}
