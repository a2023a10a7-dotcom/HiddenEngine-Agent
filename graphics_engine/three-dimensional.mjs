import * as THREE from "three";

const W=1920,H=1080;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const palette={metal:0x8797a5,bright:0xc6d0d8,dark:0x394956,gold:0xd6a36b,red:0x9e6251,black:0x202b35};

function box(group, size, pos, color=palette.metal, bevel=0) {
  const geo=new THREE.BoxGeometry(...size);
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.55}));
  mesh.position.set(...pos); group.add(mesh); return mesh;
}
function cylinder(group, radiusTop, radiusBottom, height, pos, color=palette.bright, radial=24, axis="y") {
  const geo=new THREE.CylinderGeometry(radiusTop,radiusBottom,height,radial);
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.4,metalness:.7}));
  mesh.position.set(...pos);
  if(axis==="x") mesh.rotation.z=Math.PI/2;
  if(axis==="z") mesh.rotation.x=Math.PI/2;
  group.add(mesh); return mesh;
}
function rod(group,a,b,r,color) {
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
  const mesh=cylinder(group,r,r,delta.length(),start.clone().add(end).multiplyScalar(.5).toArray(),color,16);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()); return mesh;
}
function buildEngine() {
  const parts=[];
  const add=(id,label,detail,offset,build)=>{
    const g=new THREE.Group(); build(g); g.position.set(...offset); parts.push({id,label,detail,group:g});
  };
  add("head","CYLINDER HEAD","Valves · intake · exhaust",[0,3.3,0],g=>{
    box(g,[4.7,.48,2.5],[0,0,0],palette.bright);
    for(let x=-1.5;x<=1.5;x+=1){cylinder(g,.22,.22,.32,[x,.38,0],palette.gold);cylinder(g,.12,.12,.38,[x,.38,.72],palette.red);}
  });
  add("pistons","PISTON ASSEMBLIES","Four pistons · connecting rods",[0,1.85,0],g=>{
    for(let x=-1.5;x<=1.5;x+=1){
      cylinder(g,.42,.42,.68,[x,0,0],palette.bright,32);
      for(let y=-.2;y<=.2;y+=.16)cylinder(g,.435,.435,.035,[x,y,0],palette.gold,32);
      rod(g,[x,-.35,0],[x*.72,-1.1,.05],.105,palette.red);
    }
  });
  add("block","ENGINE BLOCK","Cast alloy · four cylinder bores",[0,0,0],g=>{
    box(g,[4.9,1.5,2.7],[0,0,0],palette.dark);
    for(let x=-1.5;x<=1.5;x+=1)cylinder(g,.48,.48,1.56,[x,.03,0],palette.black,32);
    box(g,[5.1,.18,2.9],[0,-.83,0],palette.metal);
  });
  add("crank","CRANKSHAFT","Main journals · crank pins",[0,-1.8,0],g=>{
    rod(g,[-2.1,0,0],[2.1,0,0],.16,palette.bright);
    for(let x=-1.5;x<=1.5;x+=1){
      cylinder(g,.31,.31,.34,[x,0,0],palette.gold,24,"x");
      cylinder(g,.13,.13,.55,[x,-.3,0],palette.red,20,"x");
    }
  });
  add("pan","OIL SUMP","Lubrication reservoir",[0,-3.2,0],g=>{
    box(g,[4.5,.62,2.35],[0,0,0],palette.dark);
    box(g,[4.1,.12,2.05],[0,-.37,0],palette.gold);
  });
  return parts;
}
function projectMesh(mesh,camera,light) {
  const geo=mesh.geometry, pos=geo.attributes.position, index=geo.index;
  const world=mesh.matrixWorld;
  const triangles=[];
  const count=index?index.count:pos.count;
  for(let i=0;i<count;i+=3){
    const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
    const vs=ids.map(id=>new THREE.Vector3().fromBufferAttribute(pos,id).applyMatrix4(world));
    const center=vs[0].clone().add(vs[1]).add(vs[2]).multiplyScalar(1/3);
    const normal=vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).normalize();
    const view=camera.position.clone().sub(center).normalize();
    if(normal.dot(view)<-.12) continue;
    const shade=Math.max(.25,Math.abs(normal.dot(light))*.72+.28);
    const base=mesh.material.color;
    const col=new THREE.Color(base).multiplyScalar(shade);
    const pts=vs.map(v=>{v.project(camera);return [960+v.x*410,535-v.y*410,v.z];});
    triangles.push({z:pts.reduce((s,p)=>s+p[2],0)/3,points:pts,color:"#"+col.getHexString()});
  }
  return triangles;
}
export function createThreeDEngine({title="Inside a Four-Cylinder Engine"}={}) {
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-4.7,4.7,2.65,-2.65,.1,100);
  camera.position.set(9,8,12);camera.lookAt(0,0,0);
  const light=new THREE.Vector3(-.4,.8,.6).normalize();
  const parts=buildEngine();
  for(const p of parts)scene.add(p.group);
  scene.updateMatrixWorld(true);
  const triangles=[];
  for(const p of parts)p.group.traverse(o=>{if(o.isMesh)triangles.push(...projectMesh(o,camera,light));});
  triangles.sort((a,b)=>b.z-a.z);
  const drawing=triangles.map(t=>`<polygon points="${t.points.map(p=>p.slice(0,2).map(n=>n.toFixed(1)).join(",")).join(" ")}" fill="${t.color}" stroke="#18232c" stroke-width="1.2" stroke-linejoin="round"/>`).join("");
  const labels=parts.map((p,i)=>{
    const y=360+i*112, x=1350;
    return `<path d="M1260 ${y-12}H1315" stroke="#D6A36B" stroke-width="2"/><circle cx="1260" cy="${y-12}" r="5" fill="#F0C58F"/><text x="${x}" y="${y-8}" fill="#F0C58F" font-size="21" font-weight="bold" font-family="DejaVu Sans">${esc(p.label)}</text><text x="${x}" y="${y+24}" fill="#AAB4BE" font-size="16" font-family="DejaVu Sans">${esc(p.detail)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="bg3" x2="1" y2="1"><stop stop-color="#111923"/><stop offset="1" stop-color="#090D12"/></linearGradient><radialGradient id="gl3"><stop stop-color="#D6A36B" stop-opacity=".15"/><stop offset="1" stop-color="#D6A36B" stop-opacity="0"/></radialGradient></defs>
  <rect width="1920" height="1080" fill="url(#bg3)"/><ellipse cx="1500" cy="180" rx="500" ry="300" fill="url(#gl3)"/>
  <text x="110" y="100" fill="#F0C58F" font-size="22" letter-spacing="6" font-family="DejaVu Sans" font-weight="bold">THE HIDDEN ENGINE</text>
  <path d="M110 145H1810" stroke="#34414d"/><text x="110" y="225" fill="#F3F0E9" font-size="49" font-family="DejaVu Sans" font-weight="bold">${esc(title)}</text>
  <rect x="80" y="270" width="1760" height="650" rx="24" fill="#151e27" stroke="#34414d"/>
  <g>${drawing}</g><g>${labels}</g>
  <text x="110" y="970" fill="#AAB4BE" font-size="17" font-family="DejaVu Sans">ILLUSTRATIVE 3D ASSEMBLY · COMPONENT GEOMETRY IS SCHEMATIC</text>
  <text x="1810" y="1020" text-anchor="end" fill="#74818D" font-size="15" letter-spacing="3" font-family="DejaVu Sans">THE HIDDEN ENGINE / VISUAL RESEARCH</text></svg>`;
}
