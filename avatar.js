import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

export const RIGS={
  JU7:{name:"JU7",joints:["root","torso","head","armL","armR","legL","legR"]},
  JU20:{name:"JU20",joints:["root","hips","spine","chest","neck","head","clavL","upperArmL","lowerArmL","handL","clavR","upperArmR","lowerArmR","handR","upperLegL","lowerLegL","footL","upperLegR","lowerLegR","footR"]}
};

const limb=(color,a,b,r=.12)=>{
  const d=b.clone().sub(a),len=d.length(),g=new THREE.Group();
  const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(r,Math.max(0,len-r),4,8),new THREE.MeshStandardMaterial({color,roughness:.8}));
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
  g.add(mesh);return g;
};
const cube=(color,s)=>new THREE.Mesh(new THREE.BoxGeometry(...s),new THREE.MeshStandardMaterial({color,roughness:.75}));

export function createAvatar3D(avatar={},opts={}){
  const rig=avatar.rig||"JU7",root=new THREE.Group();root.userData.isAvatar=true;
  const colors={skin:avatar.skin||0xe5b48a,shirt:avatar.shirtColor||0x2877b8,pants:avatar.pantsColor||0x2c3440,hair:avatar.hairColor||0x3b2a20};
  const joints={};
  const add=(name,parent,pos)=>{const j=new THREE.Group();j.name=name;j.position.set(...pos);parent.add(j);joints[name]=j;return j};
  const rootJ=add("root",root,[0,0,0]);
  if(rig==="JU20"){
    const hips=add("hips",rootJ,[0,.85,0]),spine=add("spine",hips,[0,.35,0]),chest=add("chest",spine,[0,.35,0]),neck=add("neck",chest,[0,.38,0]),head=add("head",neck,[0,.22,0]);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(.34,16,12),new THREE.MeshStandardMaterial({color:colors.skin,roughness:.8})));
    const hair=new THREE.Mesh(new THREE.SphereGeometry(.355,16,8,0,Math.PI*2,0,Math.PI*.48),new THREE.MeshStandardMaterial({color:colors.hair,roughness:.9}));hair.position.y=.03;head.add(hair);
    chest.add(cube(colors.shirt,[.72,.62,.38]));hips.add(cube(colors.pants,[.62,.35,.36]));
    for(const [sgn,s] of [[-1,"L"],[1,"R"]]){
      const clav=add("clav"+s,chest,[.43*sgn,.18,0]),up=add("upperArm"+s,clav,[.38*sgn,-.05,0]);
      up.add(limb(colors.shirt,new THREE.Vector3(),new THREE.Vector3(.32*sgn,-.28,0),.13));
      const lo=add("lowerArm"+s,up,[.32*sgn,-.28,0]);lo.add(limb(colors.skin,new THREE.Vector3(),new THREE.Vector3(.28*sgn,-.28,0),.105));
      const hand=add("hand"+s,lo,[.28*sgn,-.28,0]);hand.add(new THREE.Mesh(new THREE.SphereGeometry(.11,10,8),new THREE.MeshStandardMaterial({color:colors.skin})));
      const ul=add("upperLeg"+s,hips,[.22*sgn,-.2,0]);ul.add(limb(colors.pants,new THREE.Vector3(),new THREE.Vector3(0,-.43,0),.16));
      const ll=add("lowerLeg"+s,ul,[0,-.43,0]);ll.add(limb(colors.pants,new THREE.Vector3(),new THREE.Vector3(0,-.42,.03),.13));
      const foot=add("foot"+s,ll,[0,-.42,.05]);foot.add(cube(0x20252a,[.25,.12,.4]));foot.children[0].position.z=.08;
    }
  }else{
    const torso=add("torso",rootJ,[0,.9,0]);torso.add(cube(colors.shirt,[.7,.8,.4]));
    const head=add("head",torso,[0,.65,0]);head.add(new THREE.Mesh(new THREE.SphereGeometry(.34,16,12),new THREE.MeshStandardMaterial({color:colors.skin,roughness:.8})));
    const hair=new THREE.Mesh(new THREE.SphereGeometry(.355,16,8,0,Math.PI*2,0,Math.PI*.5),new THREE.MeshStandardMaterial({color:colors.hair,roughness:.9}));hair.position.y=.05;head.add(hair);
    for(const [sgn,s] of [[-1,"L"],[1,"R"]]){
      const arm=add("arm"+s,torso,[.5*sgn,.2,0]);arm.add(limb(colors.shirt,new THREE.Vector3(),new THREE.Vector3(.32*sgn,-.3,0),.13));
      const leg=add("leg"+s,rootJ,[.22*sgn,0,0]);leg.add(limb(colors.pants,new THREE.Vector3(),new THREE.Vector3(0,-.55,.02),.16));
    }
    rootJ.position.y=.65;
  }
  root.scale.setScalar(opts.scale||1);root.userData.joints=joints;root.userData.rig=rig;return root;
}
export function poseAvatar3D(model,phase=0,moving=false,jump=false){
  const j=model.userData.joints||{},a=Math.sin(phase*10)*.55*(moving?1:0),set=(n,z)=>{if(j[n])j[n].rotation.z=z};
  if(model.userData.rig==="JU20"){
    set("upperArmL",a);set("lowerArmL",-a*.35);set("upperArmR",-a);set("lowerArmR",a*.35);
    set("upperLegL",-a*.8);set("lowerLegL",a*.35);set("upperLegR",a*.8);set("lowerLegR",-a*.35);
    if(j.chest)j.chest.rotation.z=Math.sin(phase*10)*.05;
  }else{set("armL",a);set("armR",-a);set("legL",-a);set("legR",a)}
  if(j.root)j.root.position.y=(jump?.08:0)+Math.abs(Math.sin(phase*10))*(moving?.015:0);
}
export function drawAvatar2D(ctx,x,y,scale=1,avatar={},phase=0,moving=false){
  const rig=avatar.rig||"JU7",skin=avatar.skin||"#e5b48a",shirt=avatar.shirtColor||"#2877b8",pants=avatar.pantsColor||"#2c3440",hair=avatar.hairColor||"#3b2a20",swing=Math.sin(phase*10)*16*(moving?1:0);
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.lineCap="round";
  const line=(a,b,c,d,w,col)=>{ctx.strokeStyle=col;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.stroke()};
  if(rig==="JU20"){
    line(-8,30,-18,58,9,pants);line(8,30,18,58,9,pants);line(-18,58,-20,70,7,pants);line(18,58,20,70,7,pants);
    line(-19,3,-35+swing*.5,25,8,shirt);line(19,3,35-swing*.5,25,8,shirt);line(-35+swing*.5,25,-38+swing*.6,43,6,skin);line(35-swing*.5,25,38-swing*.6,43,6,skin);
    ctx.fillStyle=shirt;ctx.fillRect(-19,-4,38,38);
  }else{
    line(-8,28,-15,60,10,pants);line(8,28,15,60,10,pants);line(-15,60,-16,70,7,pants);line(15,60,16,70,7,pants);
    line(-18,3,-34+swing*.5,27,9,shirt);line(18,3,34-swing*.5,27,9,shirt);ctx.fillStyle=shirt;ctx.fillRect(-19,-5,38,38);
  }
  ctx.fillStyle=skin;ctx.beginPath();ctx.arc(0,-25,16,0,Math.PI*2);ctx.fill();ctx.fillStyle=hair;ctx.beginPath();ctx.arc(0,-29,17,Math.PI,Math.PI*2);ctx.fill();ctx.restore();
}
