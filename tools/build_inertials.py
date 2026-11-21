"""Compute occurrence mass distribution from the source B-rep and estimated material density.
Usage: python tools/build_inertials.py /path/to/BPX.step
The battery cells are absent from the CAD; their mass is added to the teaching cassette at runtime.
"""
import json
import sys
from pathlib import Path
import numpy as np
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from export_cad import read_cad, label_key, matrix

density = {"aluminum":2700,"machined":2700,"steel":7800,"brass":8400,"black-shell":1330,
           "elastomer":1120,"wire":1850,"electronics":1900,"graphite":1550}
base=Path(__file__).resolve().parents[1]
assembly=json.loads((base/'public/assets/assembly.json').read_text())
nodes={row['id']:row for row in assembly['nodes']}
doc=read_cad(Path(sys.argv[1]))
tool=XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
roots=TDF_LabelSequence()
tool.GetFreeShapes(roots)
cache={};parts={}
def visit(label, id, transform):
    master=TDF_Label()
    if tool.IsReference_s(label):
        transform=transform@matrix(tool.GetLocation_s(label))
        tool.GetReferredShape_s(label,master)
    else: master=label
    children=TDF_LabelSequence()
    tool.GetComponents_s(master,children,False)
    if children.Length():
        for i in range(1,children.Length()+1):visit(children.Value(i),id+'_'+str(i),transform)
        return
    node=nodes[id]
    if not node.get('geometry'):return
    key=label_key(master)
    if key not in cache:
        p=GProp_GProps()
        BRepGProp.VolumeProperties_s(tool.GetShape_s(master),p,True)
        vol=p.Mass()
        I=np.array([[p.MatrixOfInertia().Value(i,j) for j in range(1,4)] for i in range(1,4)])
        cache[key]=(vol,np.array(p.CentreOfMass().Coord()),I)
    vol,c,I=cache[key]
    dims=np.array(node['max'])-np.array(node['min'])
    center=transform[:3,:3]@c+transform[:3,3]
    source="BREP"
    if vol < 0.001 or np.any(center<np.array(node['min'])-1) or np.any(center>np.array(node['max'])+1):
        # Open shell presentations have no volume; a labelled hollow box approximation.
        source="shell"
        vol=np.prod(dims)*.16
        center=np.array(node['center'])
        xx,yy,zz=dims*dims
        normI=np.diag([yy+zz,xx+zz,xx+yy])/12
    else: normI=transform[:3,:3]@I@transform[:3,:3].T/vol
    mass=max(.00005,vol*1e-9*density[node['material']])
    parts[id]={"m":round(mass,8),"c":center.round(4).tolist(),"i":(normI*1e-6).round(9)[np.triu_indices(3)].tolist(),"source":source}
for i in range(1,roots.Length()+1):visit(roots.Value(i),'bpx'+str(i),np.eye(4))
out={"units":"kg, CAD mm, kg-normalized tensor in m²","densityKgM3":density,"parts":parts,
     "note":"Closed STEP solid volumes and inertia. Density, hollow-shell mass, missing battery cells and actuator ratings are nominal teaching estimates."}
(base/'src/inertials.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
print(len(parts),sum(v['m'] for v in parts.values()),sum(v['source']=='shell' for v in parts.values()))

# Samples accessible underside points of each part for the repositionable
# assembly nest. All samples come from the unsimplified STEP tessellation.
import struct
raw=(base/'public/assets/bpx.glb').read_bytes()
length=struct.unpack_from("<I",raw,12)[0]
glb=json.loads(raw[20:20+length])
buf=memoryview(raw)[28+length:]
for node in glb['nodes']:
    if 'mesh' not in node:continue
    row=parts.get(node.get('name'))
    if not row:continue
    pos=glb['meshes'][node['mesh']]['primitives'][0]['attributes']['POSITION']
    acc=glb['accessors'][pos];view=glb['bufferViews'][acc['bufferView']]
    xyz=np.frombuffer(buf,dtype='<f4',count=acc['count']*3,offset=view.get('byteOffset',0)+acc.get('byteOffset',0)).reshape(-1,3)
    mat=np.array(node['matrix']).reshape(4,4).T
    xyz=xyz@mat[:3,:3].T+mat[:3,3]
    mn=xyz.min(0);delta=np.maximum(xyz.max(0)-mn,0.01)
    cells=np.minimum(((xyz-mn)/delta*3).astype('int'),2)
    sites=[]
    for x in range(3):
      for z in range(3):
        pts=xyz[(cells[:,0]==x)&(cells[:,2]==z)]
        if len(pts):sites.append(pts[np.argmin(pts[:,1])].round(3).tolist())
    row['supports']=sites
(base/'src/inertials.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
