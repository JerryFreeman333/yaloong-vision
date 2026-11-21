// The perforated carry handle has intersecting ribs and slots on all three axes.
// Fill a CAD-local occupancy grid by even-odd ray intersections, then join
// only filled neighbours. This preserves the through-slots beside the motors.
export function occupiedCells(vertices,indices,size,cellSize=1.3,inscribe=false){
  const [nx,ny,nz]=size.map(d=>Math.ceil(d/cellSize));
  const [sx,sy,sz]=size.map((d,i)=>d/[nx,ny,nz][i]);
  const [ox,oy,oz]=size.map(d=>-d/2);
  const cuts=Array.from({length:nx*ny},()=>[]);
  for(let t=0;t<indices.length;t+=3){
    const a=indices[t]*3,b=indices[t+1]*3,c=indices[t+2]*3;
    const ax=vertices[a],ay=vertices[a+1],az=vertices[a+2];
    const bx=vertices[b],by=vertices[b+1],cx=vertices[c],cy=vertices[c+1];
    const ux=bx-ax,uy=by-ay,vx=cx-ax,vy=cy-ay,det=ux*vy-uy*vx;
    if(Math.abs(det)<1e-9)continue;
    const left=Math.max(0,Math.floor((Math.min(ax,bx,cx)-ox)/sx));
    const right=Math.min(nx-1,Math.floor((Math.max(ax,bx,cx)-ox)/sx));
    const bottom=Math.max(0,Math.floor((Math.min(ay,by,cy)-oy)/sy));
    const top=Math.min(ny-1,Math.floor((Math.max(ay,by,cy)-oy)/sy));
    for(let y=bottom;y<=top;y++)for(let x=left;x<=right;x++){
      const px=ox+(x+.50003)*sx-ax,py=oy+(y+.49997)*sy-ay;
      const u=(px*vy-py*vx)/det,v=(ux*py-uy*px)/det;
      if(u>=0&&v>=0&&u+v<=1)cuts[y*nx+x].push(az+u*(vertices[b+2]-az)+v*(vertices[c+2]-az));
    }
  }
  const filled=new Uint8Array(nx*ny*nz),index=(x,y,z)=>(z*ny+y)*nx+x;
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const hits=cuts[y*nx+x].sort((a,b)=>a-b).filter((v,i,arr)=>!i||v-arr[i-1]>.00001);
    for(let h=0;h+1<hits.length;h+=2){
      const first=Math.max(0,Math.ceil((hits[h]-oz)/sz-.5));
      const last=Math.min(nz-1,Math.floor((hits[h+1]-oz)/sz-.5));
      for(let z=first;z<=last;z++)filled[index(x,y,z)]=1;
    }
  }
  // For the two sub-mm close-fitting components only, retain cells whose
  // six face-neighbour centres are also inside the shell. This inscribes
  // the collision surface instead of protruding into the neighbouring part.
  if(inscribe){
    const mask=filled.slice();
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const i=index(x,y,z);
      if(!mask[i])continue;
      if(!x||!y||!z||x===nx-1||y===ny-1||z===nz-1||
        !mask[i-1]||!mask[i+1]||!mask[i-nx]||!mask[i+nx]||!mask[i-nx*ny]||!mask[i+nx*ny])filled[i]=0;
    }
  }
  const boxes=[];
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    if(!filled[index(x,y,z)])continue;
    let w=1,h=1,d=1;
    while(x+w<nx&&filled[index(x+w,y,z)])w++;
    function fullRow(yy,zz){
      return filled.subarray(index(x,yy,zz),index(x,yy,zz)+w).every(bit=>bit===1);
    }
    while(y+h<ny&&fullRow(y+h,z))h++;
    depth:while(z+d<nz){
      for(let yy=y;yy<y+h;yy++)if(!fullRow(yy,z+d))break depth;
      d++;
    }
    for(let zz=z;zz<z+d;zz++)for(let yy=y;yy<y+h;yy++){
      const start=index(x,yy,zz);filled.fill(0,start,start+w);
    }
    boxes.push([ox+(x+w/2)*sx,oy+(y+h/2)*sy,oz+(z+d/2)*sz,w*sx/2,h*sy/2,d*sz/2].map(v=>+v.toFixed(4)));
  }
  return boxes;
}
