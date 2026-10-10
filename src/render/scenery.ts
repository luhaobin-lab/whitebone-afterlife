/** Three original night landscapes, generated once and cached as textures. */
const W=1440,H=640;
type Pt=[number,number];
function polygon(c:CanvasRenderingContext2D,p:Pt[],fill:string){c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();}
function rng(seed:number){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function tree(c:CanvasRenderingContext2D,x:number,y:number,size:number,color:string){
  c.strokeStyle=color;c.lineWidth=size*.085;c.lineCap='square';c.beginPath();c.moveTo(x,y);c.lineTo(x-size*.05,y-size);c.stroke();
  for(let i=0;i<5;i++){let z=y-size*(.2+i*.15),d=(i%2?1:-1);c.lineWidth=size*.05;c.beginPath();c.moveTo(x,z);c.lineTo(x+d*size*.3,z-size*.22);c.lineTo(x+d*size*.43,z-size*.48);c.stroke();}
}
function cottage(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,roof:string,lit:boolean){
  c.fillStyle='#263630';c.fillRect(x,y-h,w,h);
  polygon(c,[[x-9,y-h],[x+w*.48,y-h-h*.55],[x+w+10,y-h]],roof);
  c.fillStyle='#192823';c.fillRect(x+w*.45,y-h*.56,w*.19,h*.56);
  c.fillStyle='#4c5540';c.fillRect(x+5,y-h*.22,w-10,4);
  c.strokeStyle='#182a23';c.lineWidth=4;c.strokeRect(x+2,y-h+2,w-4,h-3);
  c.beginPath();c.moveTo(x+5,y-h+5);c.lineTo(x+w*.4,y-6);c.moveTo(x+w*.95,y-h+5);c.lineTo(x+w*.62,y-7);c.stroke();
  c.fillStyle=lit?'#9a8051':'#101e1b';c.fillRect(x+w*.14,y-h*.64,w*.17,h*.25);
  if(lit){c.fillStyle='#bf9a56';c.fillRect(x+w*.2,y-h*.6,3,h*.18);}
}
function tower(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,roof:boolean,color:string){
  c.fillStyle=color;c.fillRect(x,y-h,w,h);
  if(roof)polygon(c,[[x-7,y-h+3],[x+w/2,y-h-w*.85],[x+w+7,y-h+3]],'#253a34');
  else for(let i=0;i<4;i++){c.fillStyle=color;c.fillRect(x+i*w/4,y-h-w*.17,w*.15,w*.2);}
  c.fillStyle='#192923';for(let row=0;row<3;row++)for(let col=0;col<2;col++)c.fillRect(x+w*(.2+col*.43),y-h+h*(.2+row*.23),w*.14,h*.13);
  c.strokeStyle='#4a5544';c.lineWidth=1;for(let i=1;i<8;i++){c.beginPath();c.moveTo(x,y-h+h*i/8);c.lineTo(x+w,y-h+h*i/8);c.stroke();}
}
export function paintLandscape(act:number):HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const c=canvas.getContext('2d')!,r=rng(807+act*157);c.imageSmoothingEnabled=false;
  const sky=c.createLinearGradient(0,0,0,H);sky.addColorStop(0,act===3?'#101c23':'#132722');sky.addColorStop(.5,act===3?'#334440':'#3c5046');sky.addColorStop(1,'#28392e');c.fillStyle=sky;c.fillRect(0,0,W,H);
  // Fine stars and a muted moon do not compete with health bars.
  for(let i=0;i<65;i++){c.fillStyle=`rgba(185,199,169,${.12+r()*.25})`;c.fillRect(r()*W,r()*210,1+r()*1.5,1+r()*1.5);}
  c.fillStyle='#6d8070';c.beginPath();c.arc(1098,99,38,0,Math.PI*2);c.fill();
  c.fillStyle='#263c34';c.beginPath();c.arc(1114,89,36,0,Math.PI*2);c.fill();
  for(let layer=0;layer<3;layer++){
    const points:Pt[]=[[0,320]];for(let x=0;x<=W;x+=80)points.push([x,235+layer*23-r()*70]);points.push([W,400],[0,400]);
    polygon(c,points,['#20352f','#2b4137','#334b3d'][layer]);
  }
  for(let i=0;i<14;i++)tree(c,i*115+20,324,45+r()*65,'#293d33');
  if(act===1){
    const homes=[[170,318,90,52],[308,310,70,58],[427,323,110,68],[713,312,106,62],[862,319,92,79],[1060,311,120,66],[1226,317,86,62]];
    homes.forEach(([x,y,w,h],i)=>cottage(c,x,y,w,h,i%2?'#364535':'#4a4b35',i===2||i===5));
    // Village palisade and its open, broken gate.
    for(let x=622;x<1084;x+=19){if(x>870&&x<960)continue;c.fillStyle='#384632';c.fillRect(x,267,10,64);polygon(c,[[x,267],[x+5,256],[x+10,267]],'#46523a');}
    c.fillStyle='#556044';c.fillRect(633,290,450,5);c.fillRect(633,310,450,5);
    tree(c,122,332,145,'#25392e');tree(c,1346,335,119,'#26382c');
  }else if(act===2){
    for(let x=165;x<1310;x+=78)cottage(c,x,309,64,64+r()*35,'#394c43',r()>.66);
    c.fillStyle='#435448';c.fillRect(532,250,790,86);
    for(let x=532;x<1322;x+=29)c.fillRect(x,237,19,19);
    for(let x=542;x<1320;x+=49){c.fillStyle='#506052';c.fillRect(x,270,25,3);c.fillRect(x+12,298,25,3);}
    tower(c,643,335,64,151,true,'#45594c');tower(c,1158,335,74,171,true,'#45594c');
    c.fillStyle='#172b25';c.fillRect(964,278,88,58);c.beginPath();c.arc(1008,277,44,Math.PI,Math.PI*2);c.fill();
    c.strokeStyle='#768064';c.lineWidth=5;c.strokeRect(967,284,80,52);
    tree(c,109,333,134,'#263c30');
  }else{
    c.fillStyle='#334940';c.fillRect(264,256,1090,82);
    for(let x=264;x<1354;x+=32)c.fillRect(x,242,20,22);
    tower(c,496,335,84,202,true,'#40554c');tower(c,802,335,76,251,true,'#3c5149');tower(c,1173,335,90,221,true,'#40554c');
    c.fillStyle='#384e45';c.fillRect(588,197,202,136);polygon(c,[[566,204],[690,114],[809,204]],'#2b443d');
    for(let i=0;i<4;i++){c.fillStyle=i===2?'#8d8e64':'#192e28';c.fillRect(612+i*43,229,18,54);}
    tower(c,983,335,75,161,false,'#4d6050');
    c.fillStyle='#1b3029';c.fillRect(1065,259,90,78);c.beginPath();c.arc(1110,260,45,Math.PI,Math.PI*2);c.fill();
    for(const x of [541,841,1220]){c.fillStyle='#825d4d';polygon(c,[[x,171],[x+22,171],[x+22,226],[x+10,216],[x,226]],'#745548');c.fillStyle='#b09b6b';c.fillRect(x+9,177,3,23);}
  }
  // Ground is a shallow arena, not a UI card: track marks and debris follow perspective.
  const ground=c.createLinearGradient(0,315,0,H);ground.addColorStop(0,'#3b4b37');ground.addColorStop(.6,'#35402c');ground.addColorStop(1,'#253327');c.fillStyle=ground;c.fillRect(0,332,W,H-332);
  polygon(c,[[0,427],[W,377],[W,519],[0,577]],'#494b34');
  polygon(c,[[0,441],[W,398],[W,433],[0,491]],'#53533b');
  for(let i=0;i<270;i++){
    const x=r()*W,y=343+r()*296,sz=1+(y-340)/80;
    c.fillStyle=r()>.52?'#596044':'#283b2c';c.fillRect(x,y,2+r()*sz*3,1+r()*2);
  }
  // Stone verge, broken spears, exposed roots, and a tiny skull pile.
  for(let i=0;i<22;i++){
    const x=30+i*64+r()*20,y=579+r()*35;
    polygon(c,[[x,y],[x+8,y-6],[x+18,y-3],[x+22,y+3],[x+4,y+5]],i%2?'#434d39':'#526047');
    c.strokeStyle='#647054';c.lineWidth=2;c.beginPath();c.moveTo(x+30,y);c.lineTo(x+27,y-12);c.moveTo(x+30,y);c.lineTo(x+37,y-9);c.stroke();
  }
  for(const [x,y] of [[199,497],[559,585],[907,542],[1260,462]]){
    c.fillStyle='#92947a';c.fillRect(x,y,10,7);c.fillRect(x+2,y+7,6,3);c.fillStyle='#384232';c.fillRect(x+1,y+2,3,3);c.fillRect(x+6,y+2,3,3);
  }
  // Allied necromancer's ritual stones, enemy lantern posts.
  for(const x of [31,91]){polygon(c,[[x,390],[x+6,370],[x+17,374],[x+23,400],[x+19,474],[x-2,474]],'#2e483a');c.fillStyle='#709580';c.fillRect(x+8,395,4,14);c.fillRect(x+5,403,10,3);}
  for(const x of [1327,1372]){c.fillStyle='#454937';c.fillRect(x,293,6,74);c.fillStyle='#9f8651';c.fillRect(x-3,289,12,16);c.fillStyle='#d0ad65';c.fillRect(x,291,6,9);}
  const haze=c.createLinearGradient(0,280,0,373);haze.addColorStop(0,'rgba(135,156,129,0)');haze.addColorStop(.55,'rgba(135,156,129,0.14)');haze.addColorStop(1,'rgba(135,156,129,0)');c.fillStyle=haze;c.fillRect(0,280,W,93);
  const vignette=c.createRadialGradient(W*.5,H*.5,H*.2,W*.5,H*.5,W*.65);vignette.addColorStop(0,'rgba(9,22,17,0)');vignette.addColorStop(1,'rgba(9,22,17,0.55)');c.fillStyle=vignette;c.fillRect(0,0,W,H);
  return canvas;
}

export function paintMist():HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=128;const c=canvas.getContext('2d')!;
  const r=rng(61);
  for(let i=0;i<13;i++){
    const x=r()*640,y=50+r()*30;const g=c.createRadialGradient(x,y,0,x,y,40+r()*40);g.addColorStop(0,'rgba(168,190,160,.17)');g.addColorStop(1,'rgba(168,190,160,0)');c.fillStyle=g;c.fillRect(0,0,640,128);
  }
  return canvas;
}
