"""Prepare independent collision geometry from the full-resolution XDE/OCCT master GLB.
All lengths in mm. Surface triangles are welded. Occupied interior columns produce
compound convex movers, so casting a C-shaped bracket retains its open center.
Run with the CAD conversion Python environment, from the project root.
"""
import gzip
import json
import struct
from pathlib import Path
import numpy as np

ASSETS = Path(__file__).resolve().parents[1] / "public" / "assets"


def moving_boxes(vertices, indices, fine=False):
    # Cast parallel rays along the thinnest dimension. Multiple entry/exit
    # intervals in a column keep nested shells and cavities open.
    extent = np.ptp(vertices, axis=0)
    perm = np.argsort(extent)[::-1]
    inv = np.argsort(perm)
    tri = vertices[indices][:, :, perm]
    a, b, c = np.moveaxis(tri, 1, 0)
    u, v = b-a, c-a
    det = u[:, 0]*v[:, 1] - u[:, 1]*v[:, 0]
    keep = abs(det)>1e-9
    a, u, v, det = a[keep], u[keep], v[keep], det[keep]
    limits = tri[keep, :, :2]
    lo = limits.min(axis=1)
    hi = limits.max(axis=1)
    low = vertices.min(axis=0)[perm]
    high = vertices.max(axis=0)[perm]
    pitch = max(extent.max()/18, min(3,extent.max()/6),.4)
    if fine:
        pitch = max(extent.max()/75, min(.72,extent.max()/30),.04)
    count = np.maximum(1, np.ceil((high[:2]-low[:2])/pitch).astype(int))
    widths=(high[:2]-low[:2])/count
    columns={}
    def spans_at(x, y):
        k=np.flatnonzero((lo[:,0]<=x)&(x<=hi[:,0])&(lo[:,1]<=y)&(y<=hi[:,1]))
        ax=x-a[k,0]; ay=y-a[k,1]
        r=(ax*v[k,1]-ay*v[k,0])/det[k]
        s=(u[k,0]*ay-u[k,1]*ax)/det[k]
        ok=(r>=0)&(s>=0)&(r+s<=1)
        k=k[ok]
        zs=np.sort(a[k,2]+r[ok]*u[k,2]+s[ok]*v[k,2])
        zs=zs[np.r_[True,np.diff(zs)>.015]] if len(zs) else zs
        return [(float(l),float(h)) for l,h in zip(zs[::2],zs[1::2]) if h-l>.04]
    for i in range(count[0]):
        for j in range(count[1]):
            x,y=low[:2]+(np.array([i,j])+[.49993,.50013])*widths
            spans=spans_at(x,y)
            if not spans: continue
            # Inscribe the box at four corners as well as its centre. A box
            # built from a single ray would falsely bridge an open motor bore.
            for dx,dy in ((-.36,-.36),(-.36,.36),(.36,-.36),(.36,.36)):
                probes=spans_at(x+dx*widths[0],y+dy*widths[1])
                spans=[(max(a0,b0),min(a1,b1)) for a0,a1 in spans for b0,b1 in probes if min(a1,b1)-max(a0,b0)>.04]
                if not spans: break
            if spans: columns[i,j]=spans
    # Join adjacent interior cells with the same depth profile. Use the
    # intersection of their depths; this never bridges two disconnected spans.
    blocks=[]
    for (i,j), intervals in list(columns.items()):
        if (i,j) not in columns: continue
        def similar(other):
            return other and len(other)==len(intervals) and np.max(abs(np.array(other)-intervals))<.22
        w=1
        while similar(columns.get((i+w,j))): w+=1
        h=1
        while all(similar(columns.get((i+x,j+h))) for x in range(w)): h+=1
        spans=np.array([columns.pop((i+x,j+y)) for x in range(w) for y in range(h)])
        for k in range(len(intervals)):
            z0,z1=spans[:,k,0].max(),spans[:,k,1].min()
            if z0>=z1:continue
            size=np.array([w*widths[0],h*widths[1],z1-z0])
            center=np.array([low[0]+(i+w/2)*widths[0],low[1]+(j+h/2)*widths[1],(z1+z0)/2])
            # Eliminate high-frequency near-contact chatter; local mating
            # geometry is measured separately using the obstacle surface.
            shrink=np.minimum(.16, size*.08)
            # Single-column samples at curved boundaries cover only the
            # central portion of a sample cell (avoid extending past a corner).
            shrink[:2]+=widths*np.array([.22 if w==1 else .06,.22 if h==1 else .06])
            half=np.maximum(size/2-shrink,.008)
            blocks.append(np.r_[center[inv],half[inv]].round(4).tolist())
    return blocks


def export():
    data=(ASSETS/"bpx.glb").read_bytes()
    n=struct.unpack_from("<I",data,12)[0];g=json.loads(data[20:20+n]);buf=data[28+n:]
    parts={}; binary=bytearray()
    manifest=json.loads((ASSETS/"assembly.json").read_text())
    by_id={r["id"]:r for r in manifest["nodes"]}
    mesh_to_key={node["mesh"]:by_id[node["name"]]["part"] for node in g["nodes"] if "mesh" in node}
    def array(aid):
        a=g["accessors"][aid];view=g["bufferViews"][a["bufferView"]]
        typ={5123:"<u2",5125:"<u4",5126:"<f4"}[a["componentType"]]
        return np.frombuffer(buf,dtype=typ,count=a["count"]*(3 if a["type"]=="VEC3" else 1),offset=view.get("byteOffset",0)+a.get("byteOffset",0))
    def put(a):
        binary.extend(b'\0'*(-len(binary)%4));off=len(binary);binary.extend(a.tobytes());return off
    for index,mesh in enumerate(g["meshes"]):
        prim=mesh["primitives"][0]
        xyz=array(prim["attributes"]["POSITION"]).reshape(-1,3).astype(float)
        old=array(prim["indices"]).reshape(-1,3)
        minimum=xyz.min(axis=0);extent=np.maximum(np.ptp(xyz,axis=0),.001)
        q=np.rint((xyz-minimum)*65535/extent).astype("<u2")
        q,remap=np.unique(q,axis=0,return_inverse=True)
        ii=remap[old]
        ii=ii[(ii[:,0]!=ii[:,1])&(ii[:,0]!=ii[:,2])&(ii[:,2]!=ii[:,0])]
        verts=minimum+extent*q/65535
        blocks=moving_boxes(verts,ii) or moving_boxes(verts,ii,fine=True)
        parts[mesh_to_key[index]]={"lo":minimum.round(5).tolist(),"size":extent.round(5).tolist(),"vertices":len(q),"pos":put(q),"indices":ii.size,"idx":put(ii.astype("<u4")),"boxes":blocks}
    meta=json.dumps({"unit":"mm","source":"OCCT XDE CAD master, independent of render mesh","parts":parts},separators=(',',':')).encode()
    meta+=b' '*(-len(meta)%4)
    output=ASSETS/"collision-v1.bin.gz"
    output.write_bytes(gzip.compress(struct.pack("<I",len(meta))+meta+binary,compresslevel=6,mtime=0))
    print('collision parts',len(parts),'boxes',sum(len(r['boxes']) for r in parts.values()),'empty',len([k for k,r in parts.items() if not r['boxes']]),'compressed bytes',output.stat().st_size)
if __name__=="__main__":export()
