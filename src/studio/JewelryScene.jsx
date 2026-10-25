import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MATERIALS } from './templates.js'
import StudioCanvas from './StudioCanvas.jsx'

const colorOf = (element) => element.color || MATERIALS.find((m) => m.id===element.materialId)?.color || '#dbc6a4'

function pendantGeometry() {
  const shape=new THREE.Shape()
  for(let i=0;i<10;i++){
    const angle=-Math.PI/2+i*Math.PI/5,r=i%2===0?.7:.32
    const x=Math.cos(angle)*r,y=Math.sin(angle)*r
    if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y)
  }
  shape.closePath()
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.16,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.07,bevelThickness:.07})
  geometry.center()
  return geometry
}

function addJewelry(group,document,template) {
  const bracelet=template.id==='bead-bracelet'
  const count=document.elements.length
  const metal=new THREE.MeshStandardMaterial({color:'#c7a96c',metalness:.83,roughness:.24})
  const radius=bracelet?2.35:2.15
  let path
  if(bracelet){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.055,10,100),metal)
    group.add(ring)
  } else {
    const points=[]
    for(let i=0;i<=48;i++){
      const t=i/48,angle=Math.PI*(.82+t*1.36)
      points.push(new THREE.Vector3(Math.cos(angle)*radius*1.35,Math.sin(angle)*radius*1.3+.8,0))
    }
    path=new THREE.CatmullRomCurve3(points)
    group.add(new THREE.Mesh(new THREE.TubeGeometry(path,100,.045,8,false),metal))
    for(const end of [path.getPoint(0),path.getPoint(1)]){
      const cap=new THREE.Mesh(new THREE.SphereGeometry(.12,12,10),metal)
      cap.position.copy(end);group.add(cap)
    }
  }
  document.elements.forEach((element,index) => {
    const material=new THREE.MeshPhysicalMaterial({color:colorOf(element),metalness:element.materialId==='pendant'?.75:.16,roughness:.24,clearcoat:.5,clearcoatRoughness:.2})
    const size=Math.max(.16,Math.min(.6,element.widthMm*.045))
    const geometry=element.materialId==='pendant'?pendantGeometry():element.materialId==='stone'
      ? new THREE.IcosahedronGeometry(size,1) : new THREE.SphereGeometry(size,20,16)
    const mesh=new THREE.Mesh(geometry,material)
    if(bracelet){
      const angle=2*Math.PI*(index+.5)/Math.max(count,1)
      mesh.position.set(Math.cos(angle)*radius,Math.sin(angle)*radius,0)
      mesh.rotation.z=angle
    }else{
      const t=count===1?.5:.08+.84*index/(count-1)
      mesh.position.copy(path.getPoint(t))
      if(element.materialId==='pendant')mesh.position.y-=.22
    }
    group.add(mesh)
  })
}

export default function JewelryScene({template,document}) {
  const host=useRef(null),sceneRef=useRef(null),[failed,setFailed]=useState(false)
  useEffect(() => {
    const node=host.current
    if(!node)return
    let renderer
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'}) }
    catch { setFailed(true);return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))
    renderer.outputColorSpace=THREE.SRGBColorSpace
    renderer.toneMapping=THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure=1.35
    node.appendChild(renderer.domElement)
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,100)
    camera.position.set(0,0,11)
    scene.add(new THREE.HemisphereLight('#fff7e7','#86715f',2))
    const key=new THREE.DirectionalLight('#fff8e7',3.5);key.position.set(-3,5,7);scene.add(key)
    const rim=new THREE.DirectionalLight('#a8d0c3',2);rim.position.set(4,-2,-5);scene.add(rim)
    const model=new THREE.Group();scene.add(model)
    const controls=new OrbitControls(camera,renderer.domElement)
    controls.enableDamping=true;controls.enablePan=false;controls.minDistance=7;controls.maxDistance=17
    const resize=() => {const width=Math.max(1,node.clientWidth),height=Math.max(1,node.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix()}
    const observer=new ResizeObserver(resize);observer.observe(node);resize()
    let frame
    const draw=() => {frame=requestAnimationFrame(draw);controls.update();renderer.render(scene,camera)}
    draw()
    sceneRef.current={model}
    return () => {
      cancelAnimationFrame(frame);observer.disconnect();controls.dispose()
      model.traverse((item) => {item.geometry?.dispose();if(Array.isArray(item.material))item.material.forEach((m) => m.dispose());else item.material?.dispose()})
      renderer.dispose();renderer.domElement.remove();sceneRef.current=null
    }
  },[])
  useEffect(() => {
    const model=sceneRef.current?.model
    if(!model)return
    while(model.children.length){
      const item=model.children[0];model.remove(item)
      item.traverse((child) => {child.geometry?.dispose();if(Array.isArray(child.material))child.material.forEach((m) => m.dispose());else child.material?.dispose()})
    }
    addJewelry(model,document,template)
  },[document,template])
  return failed ? <div className="studio-3d-fallback"><p>此设备暂不支持 3D 预览，设计顺序仍可继续编辑。</p><StudioCanvas template={template} document={document} surfaceId={template.surfaces[0].id} readOnly/></div>
    : <div ref={host} className="studio-3d-scene" role="img" aria-label={`${template.name}的可旋转 3D 珠串模型`}><div className="studio-3d-label">DRAG TO ROTATE · SCROLL TO ZOOM</div></div>
}
