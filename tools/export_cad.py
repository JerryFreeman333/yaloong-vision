"""Convert a SolidWorks STEP assembly to instanced GLB plus a selectable assembly manifest.
Usage: python tools/export_cad.py /path/to/BPX.step public/assets
Requires cadquery-ocp-novtk and numpy.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import struct
import tempfile

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepLib import BRepLib_ToolTriangulatedShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence, TDF_Tool
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_DocumentTool


def read_cad(path):
    # Older SolidWorks exports may use raw GBK characters in Part 21 strings.
    raw = path.read_bytes()
    try:
        src = raw.decode("utf-8")
    except UnicodeDecodeError:
        src = raw.decode("gb18030")
    src = re.sub(r"[^\x00-\x7f]+", lambda m: "\\X2\\" + m[0].encode("utf-16be").hex().upper() + "\\X0\\", src)
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    reader = STEPCAFControl_Reader()
    with tempfile.NamedTemporaryFile(suffix=".step") as tmp:
        tmp.write(src.encode("ascii"))
        tmp.flush()
        if reader.ReadFile(tmp.name) != IFSelect_RetDone or not reader.Transfer(doc):
            raise RuntimeError("STEP transfer failed")
    return doc


def label_key(label):
    entry = TCollection_AsciiString()
    TDF_Tool.Entry_s(label, entry)
    return entry.ToCString()


def label_name(label):
    attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
        return attr.Get().ToExtString()
    return label_key(label)


def matrix(loc):
    tr = loc.Transformation()
    mat = np.eye(4)
    for i in range(3):
        for j in range(4):
            mat[i,j] = tr.Value(i+1,j+1)
    return mat


def triangulate(shape):
    BRepMesh_IncrementalMesh(shape, 0.16, False, 0.24, True)
    coords, normals, indices = [], [], []
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    while faces.More():
        face = TopoDS.Face_s(faces.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri and tri.NbTriangles():
            transform = loc.Transformation()
            reverse = face.Orientation() == TopAbs_REVERSED
            offset = len(coords)
            BRepLib_ToolTriangulatedShape.ComputeNormals_s(face, tri)
            for i in range(1,tri.NbNodes()+1):
                p = tri.Node(i).Transformed(transform)
                normal = tri.Normal(i).Transformed(transform)
                if reverse:
                    normal.Reverse()
                coords.append(p.Coord())
                normals.append(normal.Coord())
            for i in range(1,tri.NbTriangles()+1):
                a,b,c = tri.Triangle(i).Get()
                indices.extend((offset+a-1,offset+(c if reverse else b)-1,offset+(b if reverse else c)-1))
        faces.Next()
    return np.asarray(coords,dtype="<f4"),np.asarray(normals,dtype="<f4"),indices


def finish_glb(doc, binary, path):
    doc["buffers"] = [{"byteLength":len(binary)}]
    metadata=json.dumps(doc,separators=(",",":"),ensure_ascii=True).encode()
    metadata += b" "*(-len(metadata)%4)
    binary += b"\0"*(-len(binary)%4)
    header=struct.pack("<4sII",b"glTF",2,12+8+len(metadata)+8+len(binary))
    path.write_bytes(header+struct.pack("<I4s",len(metadata),b"JSON")+metadata+struct.pack("<I4s",len(binary),b"BIN\0")+binary)


def material_for(name):
    for category,pattern in [
        ("elastomer",r"软垫|软胶|缓冲垫|077 足端"),
        ("wire",r"连接线|线束|髋膝连接线|侧摆到髋线"),
        ("brass",r"铜螺母|铜套"),
        ("black-shell",r"电池|电控盒|电池把手|按[钮键]"),
        ("steel",r"关节销|塞打|齿圈|减速器|关节定子组件|轴承"),
        ("electronics",r"PCB|COMPONENT|RJ45|TWR25|BOARD|^\d+_|SOT|^CAP|^0[68]0[35]"),
        ("graphite",r"线扣|固定块|驱动器盖|足端固定件"),
        ("machined",r"连杆|舵臂|膝关节定子壳|髋关节定子壳|减速机壳"),
    ]:
        if re.search(pattern,name,re.I): return category
    return "aluminum"


def export(source, output):
    doc=read_cad(source)
    st=XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    roots=TDF_LabelSequence()
    st.GetFreeShapes(roots)
    materials={"aluminum":([.65,.69,.72],.88,.28),"machined":([.52,.57,.61],.94,.23),"steel":([.32,.37,.42],.94,.23),"brass":([.60,.36,.12],.86,.31),"black-shell":([.035,.043,.05],.27,.34),"elastomer":([.025,.03,.034],.02,.78),"wire":([.015,.02,.024],.04,.62),"electronics":([.052,.09,.074],.38,.48),"graphite":([.095,.11,.12],.58,.36)}
    glb={"asset":{"version":"2.0","generator":"BPX Studio / Open CASCADE XDE"},"scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"name":"CADFrame","children":[],"scale":[.001,.001,.001]}],"meshes":[],"accessors":[],"bufferViews":[],"materials":[]}
    for name,(color,metal,rough) in materials.items():
        glb["materials"].append({"name":name,"doubleSided":True,"pbrMetallicRoughness":{"baseColorFactor":[*color,1],"metallicFactor":metal,"roughnessFactor":rough}})
    binary=bytearray()
    def accessor(arr,kind,component,target,extrema=False):
        binary.extend(b"\0"*(-len(binary)%4)); start=len(binary); binary.extend(arr.tobytes())
        view={"buffer":0,"byteOffset":start,"byteLength":arr.nbytes,"target":target}
        acc={"bufferView":len(glb["bufferViews"]),"componentType":component,"count":len(arr),"type":kind}
        if extrema: acc.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        glb["bufferViews"].append(view); glb["accessors"].append(acc)
        return len(glb["accessors"])-1

    cache={}; records=[]; counts=Counter()
    def visit(label,parent_id,path,world):
        master=TDF_Label()
        if st.IsReference_s(label):
            world=world@matrix(st.GetLocation_s(label))
            st.GetReferredShape_s(label,master)
        else: master=label
        key=label_key(master)
        name=label_name(master)
        row={"id":path,"parent":parent_id,"name":name,"part":key}
        records.append(row)
        children=TDF_LabelSequence()
        st.GetComponents_s(master,children,False)
        if children.Length():
            boxes=[visit(children.Value(i),path,path+"_"+str(i),world) for i in range(1,children.Length()+1)]
            boxes=[b for b in boxes if b is not None]
            if not boxes: return None
            lo=np.min([b[0] for b in boxes],axis=0);hi=np.max([b[1] for b in boxes],axis=0)
        else:
            if key not in cache:
                xyz,norm,idx=triangulate(st.GetShape_s(master))
                if not idx: cache[key]=None
                else:
                    mat=material_for(name)
                    index_type="<u2" if len(xyz)<65536 else "<u4"
                    primitive={"attributes":{"POSITION":accessor(xyz,"VEC3",5126,34962,True),"NORMAL":accessor(norm,"VEC3",5126,34962)},"indices":accessor(np.array(idx,dtype=index_type),"SCALAR",5123 if index_type=="<u2" else 5125,34963),"material":list(materials).index(mat)}
                    cache[key]=(len(glb["meshes"]),xyz,len(idx)//3)
                    glb["meshes"].append({"name":name,"primitives":[primitive]})
            mesh=cache[key]
            if mesh is None: row["geometry"]=False;return None
            index,xyz,tris=mesh
            transformed=xyz@world[:3,:3].T+world[:3,3]
            lo=transformed.min(axis=0);hi=transformed.max(axis=0)
            glb["nodes"][0]["children"].append(len(glb["nodes"]))
            glb["nodes"].append({"name":path,"extras":{"instanceId":path},"mesh":index,"matrix":np.round(world.T.flatten(),10).tolist()})
            row.update(geometry=True,material=material_for(name))
            counts["trianglesInScene"]+=tris;counts["meshInstances"]+=1
        row.update(min=lo.round(3).tolist(),max=hi.round(3).tolist(),center=((lo+hi)/2).round(3).tolist())
        return lo,hi

    for i in range(1,roots.Length()+1):
        visit(roots.Value(i),None,"bpx"+str(i),np.eye(4))
    # Author root's Y-up conversion after measuring STEP coordinate system.
    output.mkdir(exist_ok=True,parents=True)
    assembly={"source":"BPX.step","schema":"AP203","unit":"mm","nodes":records,"stats":dict(counts,uniqueMeshes=len(glb["meshes"]))}
    (output/"assembly.json").write_text(json.dumps(assembly,ensure_ascii=False,separators=(",",":")))
    finish_glb(glb,binary,output/"bpx.glb")
    print(assembly["stats"],records[0],flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("source",type=Path);parser.add_argument("output",type=Path)
    args=parser.parse_args()
    export(args.source,args.output)
