import {Box3, BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Matrix4, PlaneGeometry, SRGBColorSpace, Vector3} from 'three';

// Positions come from the same CAD occurrences and transforms as the working model.
// The preview meshes are visual references and never enter the contact solver.
export function createBenchPlacement({frame, workshop, entriesFor, fitted, pick, install}) {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.hidden = true;
  document.querySelector('#scene').append(marker);
  const guide = new Group();
  frame.add(guide);
  const material = new MeshBasicMaterial({color:0x76e8bc,transparent:true,opacity:.37,
    depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  const anchor = new Vector3(), point = new Vector3(), box = new Box3(), partBox = new Box3(), pose = new Matrix4();
  const canvas = workshop.renderer.domElement;
  const carried = new Group();
  frame.add(carried);
  const carryMaterial = new MeshBasicMaterial({color:0xffb682,transparent:true,opacity:.56,depthWrite:false});
  const cursor = new Vector3();
  let drag = null, suppressClick = false;
  let current = null;
  marker.style.touchAction = 'none';
  marker.onclick = event => {
    if (suppressClick && event.detail) return;
    if (!current || marker.hidden) return;
    if (current.install) install(); else pick(current.id);
  };
  marker.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    if (!current?.draggable) return;
    drag = {pointer:event.pointerId, id:current.id, x:event.clientX, y:event.clientY, moving:false};
    marker.setPointerCapture(event.pointerId);
  };
  function movePreview(event) {
    const bounds = canvas.getBoundingClientRect();
    const depth = point.copy(anchor).applyMatrix4(frame.matrixWorld).project(workshop.camera).z;
    cursor.set((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2,depth);
    frame.worldToLocal(cursor.unproject(workshop.camera));
    carried.position.copy(cursor).sub(anchor);
    workshop.invalidate(false);
  }
  marker.onpointermove = event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.moving) {
      if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6) return;
      drag.moving = true;
      suppressClick = true;
      pick(drag.id);
      if (!current?.seat || current.id !== drag.id) return;
      // Move a placement preview on the camera-facing plane through the CAD seat.
      // The real part stays on its fixture until the solver accepts the installation.
      for (const target of guide.children) {
        const preview = new Mesh(target.geometry,carryMaterial);
        preview.matrixAutoUpdate=false;
        preview.matrix.copy(target.matrix);
        carried.add(preview);
      }
    }
    if (current?.seat && current.id===drag.id) movePreview(event);
  };
  function endDrag(event) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const placing = drag.moving && current?.seat && current.id===drag.id && !marker.hidden;
    drag = null;
    carried.clear();
    carried.position.set(0,0,0);
    if (marker.hasPointerCapture(event.pointerId)) marker.releasePointerCapture(event.pointerId);
    if (!placing) return;
    workshop.invalidate(false);
    if (event.type!=='pointerup') return;
    const bounds = marker.getBoundingClientRect();
    const center = (bounds.left+bounds.right)/2;
    const onLabel = event.clientX>=bounds.left && event.clientX<=bounds.right && event.clientY>=bounds.top && event.clientY<=bounds.bottom;
    const onSeat = Math.hypot(event.clientX-center,event.clientY-(bounds.bottom+12))<=24;
    if (onLabel || onSeat) install();
    else marker.textContent='未对准 · 点此装入';
  }
  marker.onpointerup = marker.onpointercancel = marker.onlostpointercapture = endDrag;
  function configure(action) {
    current = action;
    guide.clear();
    guide.visible = false;
    marker.hidden = true;
    if (!action) return;
    marker.textContent = action.label;
    marker.title = action.draggable ? '点击取件，或按住并拖到绿色安装位' : action.label;
    marker.style.cursor = action.draggable ? 'grab' : 'pointer';
    marker.className = 'bench-pin ' + (action.install ? 'bench-place' : 'bench-pick');
    marker.setAttribute('aria-label', action.label);
    const parts = entriesFor(action.id).filter(entry=>entry.mesh.visible);
    box.makeEmpty();
    for (const entry of parts) {
      const mesh = entry.mesh;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (action.seat) {
        fitted(entry,pose);
        const target = new Mesh(mesh.geometry,material);
        target.matrixAutoUpdate=false;target.matrix.copy(pose);target.renderOrder=1;
        guide.add(target);
      } else pose.copy(mesh.matrix);
      box.union(partBox.copy(mesh.geometry.boundingBox).applyMatrix4(pose));
    }
    if (box.isEmpty()) {current=null;return;}
    box.getCenter(anchor);
    guide.visible = Boolean(action.seat);
  }
  function update(busy) {
    if (!current || busy) {marker.hidden=true;guide.visible=false;return;}
    guide.visible=Boolean(current.seat);
    frame.updateWorldMatrix(true,false);
    point.copy(anchor).applyMatrix4(frame.matrixWorld).project(workshop.camera);
    // If a student pans away, the off-screen marker must not suggest a false seat.
    marker.hidden = Math.abs(point.x)>.98 || Math.abs(point.y)>.97 || point.z>1 || point.z< -1;
    if (!marker.hidden) {
      marker.style.left = ((point.x+1)*.5*canvas.clientWidth)+'px';
      marker.style.top = ((1-point.y)*.5*canvas.clientHeight)+'px';
    }
  }
  return {configure,update};
}


// Locating rails and parking blocks belong to the teaching jig. All heights
// are taken from the lower faces of the displayed CAD kit, in its mm frame.
export function createCourseFixture(frame, workshop, floorY, rails, feet, modelPose) {
  const jig=new Group();
  frame.add(jig);
  const metal=new MeshStandardMaterial({color:0x6d7774,metalness:.65,roughness:.4});
  const rubber=new MeshStandardMaterial({color:0x282e2a,roughness:.82});
  const datum=new MeshStandardMaterial({color:0xd8a84a,roughness:.52});
  const unit=new BoxGeometry(1,1,1);
  function bar(parent,material,x,y,z,w,h,d){
    const m=new Mesh(unit,material);
    m.position.set(x,y,z);m.scale.set(w,h,d);m.receiveShadow=true;m.castShadow=true;parent.add(m);
    return m;
  }
  const [a,b]=rails, cx=(a.center[0]+b.center[0])/2, cz=a.center[2];
  const top=a.min[1], posts=[], deck=new Group();jig.add(deck);
  const pinRows=[cz-87,cz+87];
  for(const z of pinRows){
    bar(deck,metal,cx,top-11,z,352,13,28);
    bar(deck,rubber,cx,top-2.35,z,352,4.7,24);
    for(const r of rails){
      // Paint on each side of the 20 mm channel remains visible when seated.
      for(const side of [-1,1])bar(deck,datum,r.center[0]+side*12,top+.14,z,3,.28,24);
      posts.push(new Vector3(r.center[0],top-17.5,z));
    }
  }
  const signCanvas=document.createElement('canvas');
  signCanvas.width=320;signCanvas.height=80;
  const ctx=signCanvas.getContext('2d');
  ctx.fillStyle='#22362e';ctx.fillRect(0,0,320,80);
  ctx.fillStyle='#ffdf88';ctx.font='bold 54px system-ui';ctx.textAlign='center';ctx.fillText('机头  →',158,59);
  const signMap=new CanvasTexture(signCanvas);signMap.colorSpace=SRGBColorSpace;
  const sign=new Mesh(new PlaneGeometry(100,25),new MeshBasicMaterial({map:signMap}));
  // View the label from the outer side; its arrow follows the CAD +Z axis.
  sign.rotation.y=-Math.PI/2;sign.position.set(cx-176.2,top-17,cz+87);
  bar(deck,metal,cx-172.5,top-17,cz+87,7,27,104);
  deck.add(sign);
  const footRests=feet.map(({tag,node})=>{
    const cradle=new Group();jig.add(cradle);
    bar(cradle,metal,0,-4,0,63,8,74);
    for(const side of [-1,1])bar(cradle,rubber,side*24,3.5,0,8,9,54);
    return {tag,node,cradle};
  });
  const point=new Vector3(),head=new Vector3(),pads=posts.map(()=>[0,0,0]);
  return function update(chapter,parked) {
    jig.visible=chapter!=='battery';
    if(!jig.visible)return;
    deck.matrixAutoUpdate=false;deck.matrix.copy(modelPose(a.id));deck.matrixWorldNeedsUpdate=true;
    for(let i=0;i<posts.length;i++){
      point.copy(posts[i]).applyMatrix4(deck.matrix);
      // The existing four jack posts expect support points in workshop metres.
      point.multiplyScalar(.001).add(frame.position).toArray(pads[i]);
    }
    workshop.setServiceStand({pads});
    for(const {tag,node,cradle} of footRests){
      cradle.visible=parked.has(tag);
      if(!cradle.visible)continue;
      head.set(node.center[0],node.min[1],node.center[2]).applyMatrix4(modelPose(node.id));
      cradle.position.set(head.x+(tag[0]==='L'?210:-210),head.y,head.z);
      // Extend its foot to the tabletop rather than letting the rack float.
      cradle.children[0].scale.y=Math.max(2,head.y-floorY);
      cradle.children[0].position.y=-cradle.children[0].scale.y/2;
    }
  };
}
