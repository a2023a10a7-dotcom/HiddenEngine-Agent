import * as THREE from "three";

const W=1920,H=1080;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MATERIALS={metal:0x8797a5,bright:0xc6d0d8,dark:0x394956,gold:0xd6a36b,red:0x9e6251,black:0x202b35,blue:0x477b9c,green:0x658b72};
function material(color){return new THREE.MeshStandardMaterial({color:new THREE.Color(color??"#8797a5"),roughness:.58,metalness:.48});}
function geometry(part){
 const s=part.size??[1,1,1], r=part.radius??.5, h=part.height??1;
 switch(part.shape??"box"){
  case "box":return new THREE.BoxGeometry(...s);
  case "cylinder":return new THREE.CylinderGeometry(part.radiusTop??r,part.radiusBottom??r,h,part.segments??32);
  case "sphere":return new THREE.SphereGeometry(r,24,16);
  case "torus":return new THREE.TorusGeometry(r,part.tube??.12,12,48);
  case "cone":return new THREE.ConeGeometry(r,h,32);
  default:throw new Error("Unsupported 3D component shape: "+part.shape);
 }
}
function buildComponent(part){
 const mesh=new THREE.Mesh(geometry(part),material(part.color));
 mesh.position.set(...(part.position??[0,0,0]));
 mesh.rotation.set(...(part.rotation??[0,0,0]));
 return mesh;
}
function project(mesh,camera,light){
 const pos=mesh.geometry.attributes.position,index=mesh.geometry.index,world=mesh.matrixWorld,out=[];
 const count=index?index.count:pos.count;
 for(let i=0;i<count;i+=3){
  const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
  const v=ids.map(id=>new THREE.Vector3().fromBufferAttribute(pos,id).applyMatrix4(world));
  const c=v[0].clone().add(v[1]).add(v[2]).multiplyScalar(1/3);
  const n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
  if(n.dot(camera.position.clone().sub(c).normalize())<-.15)continue;
  const shade=Math.max(.3,Math.abs(n.dot(light))*.72+.28), col=mesh.material.color.clone().multiplyScalar(shade);
  const pts=v.map(p=>{p.project(camera);return [960+p.x*400,535-p.y*400,p.z];});
  out.push({z:pts.reduce((a,p)=>a+p[2],0)/3,pts,color:"#"+col.getHexString()});
 }
 return out;
}
function validate(spec){
 if(!spec||!Array.isArray(spec.components)||!spec.components.length||spec.components.length>30)throw new Error("3D scene requires 1–30 components.");
 const ids=new Set();
 for(const p of spec.components){
  if(!p.id||!p.label||ids.has(p.id))throw new Error("Every 3D component needs a unique id and label.");
  ids.add(p.id);
  for(const key of ["position","rotation","size","explode"])if(p[key]&&(!Array.isArray(p[key])||p[key].length!==3||p[key].some(n=>!Number.isFinite(n))))throw new Error("Invalid "+key+" for "+p.id);
 }
}
export function createThreeDScene(spec){
 validate(spec);
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-5,5,2.82,-2.82,.1,100);
 camera.position.set(...(spec.camera??[9,8,12]));camera.lookAt(0,0,0);
 const light=new THREE.Vector3(-.4,.8,.6).normalize(),meshes=[],labels=[];
 for(const part of spec.components){
  const group=new THREE.Group(),mesh=buildComponent(part);
  group.add(mesh);
  const explode=part.explode??[0,0,0];
  group.position.set(...(part.position??[0,0,0]));
  group.position.add(new THREE.Vector3(...explode));
  mesh.position.set(0,0,0);mesh.rotation.set(...(part.rotation??[0,0,0]));
  scene.add(group);meshes.push(mesh);
  labels.push({label:part.label,detail:part.detail??""});
 }
 scene.updateMatrixWorld(true);
 const tris=meshes.flatMap(m=>project(m,camera,light)).sort((a,b)=>b.z-a.z);
 const drawing=tris.map(t=>`<polygon points="${t.pts.map(p=>p.slice(0,2).map(n=>n.toFixed(1)).join(",")).join(" ")}" fill="${t.color}" stroke="#18232c" stroke-width="1.1" stroke-linejoin="round"/>`).join("");
 const rows=labels.slice(0,7).map((p,i)=>{const y=350+i*78;return `<circle cx="1330" cy="${y-8}" r="5" fill="#F0C58F"/><text x="1350" y="${y}" fill="#F0C58F" font-size="19" font-weight="bold" font-family="DejaVu Sans">${esc(p.label)}</text><text x="1350" y="${y+25}" fill="#AAB4BE" font-size="14" font-family="DejaVu Sans">${esc(p.detail)}</text>`;}).join("");
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="bg3" x2="1" y2="1"><stop stop-color="#111923"/><stop offset="1" stop-color="#090D12"/></linearGradient><radialGradient id="gl3"><stop stop-color="#D6A36B" stop-opacity=".15"/><stop offset="1" stop-color="#D6A36B" stop-opacity="0"/></radialGradient></defs><rect width="1920" height="1080" fill="url(#bg3)"/><ellipse cx="1500" cy="180" rx="500" ry="300" fill="url(#gl3)"/><text x="110" y="100" fill="#F0C58F" font-size="22" letter-spacing="6" font-family="DejaVu Sans" font-weight="bold">THE HIDDEN ENGINE</text><path d="M110 145H1810" stroke="#34414d"/><text x="110" y="225" fill="#F3F0E9" font-size="47" font-family="DejaVu Sans" font-weight="bold">${esc(spec.title??"3D Technical Visualization")}</text><rect x="80" y="270" width="1760" height="650" rx="24" fill="#151e27" stroke="#34414d"/><g>${drawing}</g><g>${rows}</g><text x="110" y="970" fill="#AAB4BE" font-size="16" font-family="DejaVu Sans">SCHEMA-DRIVEN 3D COMPONENT VISUALIZATION · SCHEMATIC MODEL</text><text x="1810" y="1020" text-anchor="end" fill="#74818D" font-size="15" letter-spacing="3" font-family="DejaVu Sans">THE HIDDEN ENGINE / VISUAL RESEARCH</text></svg>`;
}
// Backwards-compatible export for existing engine-specific scene data.
export function createThreeDEngine({title="Inside a Four-Cylinder Engine"}={}){
 return createThreeDScene({title,components:[
  {id:"head",label:"CYLINDER HEAD",detail:"Valves · intake · exhaust",shape:"box",size:[4.7,.48,2.5],position:[0,3.3,0],color:"#c6d0d8"},
  {id:"pistons",label:"PISTON ASSEMBLIES",detail:"Four pistons · connecting rods",shape:"cylinder",radius:.42,height:.68,position:[0,1.85,0],explode:[0,0,0],color:"#d6a36b"},
  {id:"block",label:"ENGINE BLOCK",detail:"Cast alloy · four cylinder bores",shape:"box",size:[4.9,1.5,2.7],position:[0,0,0],color:"#394956"},
  {id:"crank",label:"CRANKSHAFT",detail:"Main journals · crank pins",shape:"cylinder",radius:.16,height:4.2,rotation:[0,0,Math.PI/2],position:[0,-1.8,0],color:"#c6d0d8"},
  {id:"pan",label:"OIL SUMP",detail:"Lubrication reservoir",shape:"box",size:[4.5,.62,2.35],position:[0,-3.2,0],color:"#394956"}
 ]});
}
