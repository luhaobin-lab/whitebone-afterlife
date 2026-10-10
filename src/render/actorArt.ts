import type { FamilyId } from '../domain/types';

/** Original small-scale silhouettes. No gameplay state is read or modified here. */
export interface ActorArtSpec {
  id: string;
  family?: FamilyId;
  rank: number;
  branch?: string;
  enemy?: boolean;
  temporary?: boolean;
}

export const ACTOR_W = 96;
export const ACTOR_H = 112;
export const ACTOR_FRAMES = 6;
const INK = '#101b19';
const BONE = '#ded4b5';
const BONE_LIT = '#fff0ce';
const IRON = '#687a72';
const GOLD = '#bca068';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
const rect = (c: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
function poly(c: Ctx, p: Pt[], color: string, edge = INK, width = 2) {
  c.beginPath(); p.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.fillStyle = color; c.fill();
  if (width) { c.strokeStyle = edge; c.lineWidth = width; c.stroke(); }
}
function line(c: Ctx, p: Pt[], color: string, width = 3) {
  c.beginPath(); p.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function oval(c: Ctx, x: number, y: number, rx: number, ry: number, color: string, edge = INK, width = 2) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  if (width) { c.strokeStyle = edge; c.lineWidth = width; c.stroke(); }
}
function limb(c: Ctx, points: Pt[], color = BONE, width = 4) {
  line(c, points, INK, width + 3); line(c, points, color, width);
  points.slice(1, -1).forEach(([x,y]) => oval(c,x,y,width*.6,width*.6,BONE_LIT,INK,1));
}
function skull(c: Ctx, x: number, y: number, size = 18, glow = '#85c7b6') {
  const q = size/18;
  c.save(); c.translate(x,y); c.scale(q,q);
  poly(c,[[-8,-8],[5,-9],[10,-4],[9,5],[5,7],[5,12],[-4,12],[-5,6],[-9,4]],BONE);
  poly(c,[[-7,-6],[3,-7],[6,-3],[-7,-2]],BONE_LIT,INK,0);
  rect(c,-5,0,4,5,INK); rect(c,4,0,4,5,INK);
  rect(c,-4,1,2,2,glow); rect(c,5,1,2,2,glow);
  poly(c,[[1,4],[-1,7],[3,7]],INK,INK,0);
  line(c,[[-3,8],[4,8]],'#776f59',1);
  for(let i=-2;i<5;i+=2) line(c,[[i,9],[i,12]],INK,1);
  c.restore();
}
function crown(c: Ctx, x: number, y: number, width = 24) {
  poly(c,[[x-width/2,y],[x-width/2-2,y-12],[x-5,y-7],[x,y-17],[x+5,y-7],[x+width/2+2,y-12],[x+width/2,y]],GOLD);
  rect(c,x-width/2+2,y-3,width-4,2,'#edd294'); rect(c,x-2,y-7,4,4,'#69ad9a');
}
function blade(c: Ctx, x: number, y: number, attack: boolean, color = '#cbd5ce') {
  c.save(); c.translate(x,y); c.rotate(attack ? Math.PI*.47 : .12);
  rect(c,-2,-4,4,12,'#574534'); line(c,[[-8,-5],[8,-5]],GOLD,3);
  poly(c,[[-4,-8],[-3,-35],[0,-44],[4,-35],[4,-8]],color);
  line(c,[[0,-35],[0,-10]],'#eef1de',1); c.restore();
}
function shield(c: Ctx, x: number, y: number, size: number, color = '#526858', boss = false) {
  const w = size*.65;
  poly(c,[[x-w/2,y-size/2],[x+w/2,y-size/2],[x+w*.56,y+size*.2],[x,y+size*.6],[x-w*.56,y+size*.2]],color);
  line(c,[[x,y-size*.38],[x,y+size*.42]],BONE,3);
  line(c,[[x-w*.32,y-size*.05],[x+w*.32,y-size*.05]],BONE,3);
  if (boss) { skull(c,x,y-1,11,'#d6be79'); line(c,[[x-w*.4,y-size*.4],[x+w*.4,y-size*.4]],GOLD,3); }
  for(const dx of [-1,1]) oval(c,x+dx*w*.35,y-size*.32,1.6,1.6,GOLD,INK,0);
}
function bell(c: Ctx, x: number, y: number, size: number, color = GOLD) {
  line(c,[[x,y-size*.75],[x,y-size*.45]],BONE,2);
  poly(c,[[x-size*.32,y-size*.5],[x+size*.32,y-size*.5],[x+size*.45,y+size*.2],[x+size*.63,y+size*.4],[x-size*.63,y+size*.4],[x-size*.45,y+size*.2]],color);
  line(c,[[x-size*.45,y+size*.16],[x+size*.45,y+size*.16]],'#e5cf92',2);
  oval(c,x,y+size*.5,size*.16,size*.16,BONE,INK,1);
}
function drawSkeleton(c: Ctx, s: ActorArtSpec, frame: number) {
  const step=frame===1?-3:frame===3?3:0, swing=frame===4, cast=frame===5;
  const rank=s.rank, ranged=s.branch==='B';
  if(rank>=3) poly(c,[[34,46],[54,44],[63,89],[51,83],[41,92],[24,86]],rank===4?'#294a3d':'#415245');
  limb(c,[[40,72],[36-step,83],[36-step*1.5,96]],BONE,5);
  limb(c,[[49,72],[53+step,83],[56+step*1.5,96]],BONE,5);
  line(c,[[31-step,97],[40-step,97]],'#a39676',4); line(c,[[52+step,97],[61+step,97]],'#a39676',4);
  oval(c,44,71,10,6,BONE); line(c,[[44,45],[44,70]],BONE_LIT,4);
  for(let i=0;i<4;i++) { line(c,[[35,49+i*5],[44,52+i*5],[53,48+i*5]],BONE,3); }
  if(rank>=2) { poly(c,[[28,46],[34,39],[42,43],[39,50]],IRON); poly(c,[[49,42],[58,41],[62,49],[51,51]],IRON); }
  skull(c,44,31,rank===4?22:19);
  if(rank===2) poly(c,[[33,24],[37,18],[50,18],[55,27],[46,24]],'#607666');
  if(rank===3) { line(c,[[32,25],[26,20],[30,34]],BONE,4); line(c,[[56,25],[63,20],[59,34]],BONE,4); }
  if(rank===4) crown(c,44,22,25);
  if(ranged) {
    const y=swing?52:61;
    limb(c,[[32,47],[33,62],[60,y]],BONE,4); limb(c,[[55,48],[61,57],[67,y]],BONE,4);
    line(c,[[56,y],[87,y-3]],'#74583d',7); line(c,[[67,y-16],[73,y],[68,y+15]],BONE,5);
    line(c,[[68,y-15],[81,y],[69,y+14]],'#b0a082',1);
    line(c,[[69,y-2],[94,y-2]],'#eef0da',2); poly(c,[[94,y-2],[88,y-5],[89,y+1]],BONE_LIT,INK,0);
    rect(c,37,62,11,8,'#98774b'); for(let j=0;j<3;j++)line(c,[[40+j*3,63],[40+j*3,69]],INK,1);
  } else {
    limb(c,[[32,47],[28,60],[33,65]],BONE,4);
    limb(c,[[56,48],[63,56],[67,cast?36:58]],BONE,4);
    blade(c,67,cast?39:58,swing);
    shield(c,31,66,rank===4?48:rank>=2?38:29,rank===4?'#465c4c':'#6c7763',rank>=3);
    if(rank===3) { shield(c,21,45,18,'#667d71'); shield(c,64,41,16,'#667d71'); }
  }
}
function drawZombie(c: Ctx, s: ActorArtSpec, frame: number) {
  const step=frame===1?-4:frame===3?4:0, swing=frame===4, cast=frame===5;
  const healer=s.branch==='B', large=s.rank>=3, skin=large?'#789660':'#90a970';
  line(c,[[35,73],[34-step,85],[29-step,97]],INK,12); line(c,[[54,74],[55+step,86],[60+step,97]],INK,12);
  line(c,[[35,73],[34-step,85],[29-step,95]],'#61775b',8); line(c,[[54,74],[55+step,86],[60+step,95]],'#61775b',8);
  rect(c,22-step,94,14,6,'#4a5140'); rect(c,53+step,94,15,6,'#4a5140');
  oval(c,44,62,large?24:20,27,skin);
  poly(c,[[25,47],[35,44],[35,72],[51,74],[65,47],[65,79],[48,87],[28,82]],healer?'#7c9481':'#5f6550');
  oval(c,52,65,10,13,'#a6b07c',INK,1); line(c,[[48,57],[52,70]],'#555c43',2);
  for(let i=0;i<3;i++)line(c,[[47+i,59+i*4],[54+i,59+i*4]],'#d1c495',1);
  limb(c,[[27,49],[19,64],[swing?43:23,cast?38:78]],skin,8);
  limb(c,[[61,48],[72,60],[swing?86:76,cast?40:72]],skin,8);
  oval(c,43,32,13,15,skin); poly(c,[[33,40],[50,39],[49,47],[36,46]],'#b1ba86');
  rect(c,34,28,7,5,INK); rect(c,45,29,5,4,'#dde8a9'); rect(c,47,30,2,2,'#466f32');
  line(c,[[36,41],[47,41]],'#3b4131',2); rect(c,38,41,3,4,'#e9dfb2'); rect(c,45,41,2,3,'#e9dfb2');
  line(c,[[33,23],[35,17],[38,22],[44,17],[47,23]],'#334a3d',4);
  rect(c,28,51,8,12,'#cab98c'); rect(c,30,54,4,1,'#66725d'); rect(c,30,57,4,1,'#66725d');
  if(healer) { poly(c,[[36,19],[37,13],[51,14],[54,21]],'#c8c6a1'); rect(c,43,14,3,6,'#78967a'); line(c,[[76,70],[86,47]],BONE,3); oval(c,25,67,6,8,'#9da786'); }
  else if(s.rank>=2) { poly(c,[[49,39],[57,30],[65,34],[61,47]],'#738064'); oval(c,68,35,10,7,'#a7b48b'); oval(c,70,35,5,4,'#293e30',INK,1); }
  if(s.rank===3 && !healer) { poly(c,[[17,41],[25,34],[27,85],[18,80]],'#564e36'); poly(c,[[66,36],[75,42],[73,86],[65,81]],'#564e36'); }
  if(s.rank===3 && healer) { for(let i=0;i<3;i++)oval(c,48+i*6,73-i*3,5,7,['#9faf56','#849650','#d1a364'][i]); }
  if(s.rank===4) { crown(c,44,19,32); oval(c,22,58,8,12,'#8a9a67'); oval(c,69,58,9,14,'#8a9a67'); rect(c,31,69,29,13,'#555d48'); skull(c,47,71,12,'#a8d37e'); }
}
function drawHorse(c: Ctx, s: ActorArtSpec, frame: number) {
  const stride=frame===1?-6:frame===3?6:0, attack=frame===4, cold=s.branch==='B';
  const hide=cold?'#788e87':'#8d7861';
  line(c,[[23,60],[13,61],[8,73]],'#635948',6);
  for(let i=0;i<4;i++) {
    const x=26+i*10, shift=(i%2?1:-1)*stride;
    limb(c,[[x,70],[x+shift,82],[x+shift+(i<2?-3:3),97]],i%2?BONE:'#a79e85',5);
    rect(c,x+shift+(i<2?-8:-1),96,11,5,'#3c443b');
  }
  oval(c,44,62,27,15,hide);
  for(let i=0;i<5;i++)line(c,[[27+i*7,52],[31+i*7,66],[28+i*7,70]],BONE,3);
  poly(c,[[58,58],[58,36],[66,26],[77,30],[74,57],[66,66]],hide);
  poly(c,[[62,28],[66,19],[69,28],[75,23],[77,30],[87,32],[89,45],[77,48],[68,40]],BONE);
  rect(c,76,32,5,4,INK); rect(c,77,32,3,2,cold?'#8ce3e9':'#dca377');
  line(c,[[79,41],[88,40]],INK,2); rect(c,82,42,2,4,'#f3e2b5');
  line(c,[[60,33],[53,34],[57,42],[51,45],[56,51]],'#3d5550',6);
  if(s.rank>=2) {
    poly(c,[[23,46],[49,42],[61,52],[58,73],[28,74]],cold?'#527b7b':'#795343');
    line(c,[[30,49],[53,48],[52,66],[29,65]],GOLD,2);
    skull(c,40,56,11,cold?'#91e0e4':'#deba8c');
  }
  if(cold) {
    poly(c,[[26,44],[29,29],[49,29],[54,44]],'#526f6b');
    line(c,[[31,34],[46,34]],'#a0c7bb',2); rect(c,34,25,9,5,'#768d80');
    if(s.rank>=3) { line(c,[[37,30],[37,11]],GOLD,3); poly(c,[[31,11],[45,10],[48,22],[28,22]],'#799e9e'); }
  } else if(s.rank>=2) {
    line(c,[[30,54],[attack?94:86,attack?49:16]],'#b1a683',4);
    poly(c,attack?[[94,49],[84,43],[84,54]]:[[86,16],[79,26],[87,28]],'#dde5d9');
    poly(c,[[47,37],[53,40],[48,51],[41,48]],'#b17d66');
  }
  if(s.rank>=3) { poly(c,[[66,26],[72,18],[80,27],[82,32],[65,31]],IRON); line(c,[[70,19],[65,12]],BONE,4); }
  if(s.rank===4) {
    poly(c,[[10,40],[34,31],[49,40],[47,75],[11,77]],'#354c45');
    line(c,[[14,40],[14,70],[43,69],[43,40]],GOLD,3);
    for(const x of [18,42]) { oval(c,x,86,11,11,'#2d3c34',GOLD,3); for(let i=0;i<4;i++){const a=i*Math.PI/2;line(c,[[x,86],[x+Math.cos(a)*8,86+Math.sin(a)*8]],GOLD,1);} }
    crown(c,29,36,25);
  }
}
function drawHand(c: Ctx, s: ActorArtSpec, frame: number) {
  const step=frame===1?-4:frame===3?4:0, attack=frame===4, electric=s.branch==='B' && s.rank===2, assassin=s.id==='U_HD_3B';
  if(assassin) poly(c,[[17,52],[34,29],[58,39],[66,79],[46,91],[23,84]],'#342d43');
  if(s.rank>=3&&!assassin) {
    for(let i=0;i<6;i++) {const a=(i/6)*Math.PI*2;const x=45+Math.cos(a)*24,y=61+Math.sin(a)*23;limb(c,[[43,62],[x,y],[x+Math.cos(a)*12,y+Math.sin(a)*12]],'#b9adc2',5);}
  }
  for(let i=0;i<4;i++) {
    const x=36+i*10, y=66+(i%2)*2;
    const dx=i%2?step:-step;
    limb(c,[[x,y],[x+8,y+14],[x+dx+7,96]],s.rank>=3?BONE_LIT:'#c7bccc',5);
    poly(c,[[x+dx+5,94],[x+dx+15,98],[x+dx+5,100]],'#ddd1df',INK,1);
  }
  poly(c,[[15,59],[24,50],[34,56],[39,46],[59,47],[69,56],[69,77],[58,83],[35,76],[22,72]],'#b2a1bc');
  for(let i=0;i<3;i++) line(c,[[36+i*9,55],[37+i*9,72]],BONE,3);
  limb(c,[[33,60],[attack?67:38,attack?41:39],[attack?87:51,attack?38:35]],BONE,6);
  rect(c,16,56,9,18,'#7f6b8c'); line(c,[[19,57],[19,72]],GOLD,2);
  oval(c,49,65,6,5,INK); oval(c,50,65,3,3,electric?'#8ee3e2':'#d8bce7',INK,0);
  if(s.rank===2&&!electric) {for(let i=0;i<3;i++){rect(c,34+i*9,77,5,7,'#cfc0a4');rect(c,35+i*9,78,2,2,'#647264');}}
  if(electric) {line(c,[[30,48],[42,38],[49,48],[62,37]],'#8ad6da',3); oval(c,69,60,5,7,'#65999d');}
  if(assassin) {blade(c,attack?83:69,attack?50:69,attack,'#ece8de');poly(c,[[29,34],[52,26],[62,45],[49,42],[34,50]],'#342d43');rect(c,45,40,10,3,'#bf9bdd');}
  if(s.rank===4) { crown(c,47,36,29); for(let i=0;i<4;i++){const x=19+i*17;limb(c,[[45,55],[x,34],[x,21]],BONE,4);rect(c,x-4,16,8,7,'#bba6c6');} }
}
function drawBell(c: Ctx, s: ActorArtSpec, frame: number) {
  const casting=frame===5, swing=frame===4, cold=s.branch==='B';
  const robe=cold?'#315860':'#3b625d';
  poly(c,[[38,38],[53,38],[64,72],[62,91],[54,85],[49,95],[39,86],[28,92],[31,67]],robe);
  poly(c,[[42,45],[50,46],[55,79],[46,86],[37,78]],'#658c7f');
  line(c,[[36,43],[29,56],[casting?20:23,casting?35:69]],BONE,5);
  line(c,[[56,43],[64,53],[casting?77:72,casting?34:59]],BONE,5);
  poly(c,[[28,32],[35,15],[49,12],[62,33],[56,46],[34,46]],'#243e3b');
  skull(c,46,32,17,cold?'#a0e0ec':'#9ed9be');
  poly(c,[[29,31],[35,18],[46,14],[56,23],[34,30]],robe);
  line(c,[[72,78],[72,29]],'#8b8063',3); bell(c,72,casting?24:32,s.rank>=3?15:11,cold?'#9dbac1':GOLD);
  bell(c,casting?20:23,casting?36:65,s.rank>=3?14:10);
  rect(c,39,60,15,11,'#b7c3a7'); line(c,[[43,63],[51,63]],'#51685b',1);line(c,[[43,67],[50,67]],'#51685b',1);
  if(s.rank>=2){poly(c,[[30,42],[38,38],[38,51],[26,53]],'#729a8e');poly(c,[[54,38],[63,41],[67,52],[55,49]],'#729a8e');}
  if(s.rank===3&&!cold) {for(let i=0;i<2;i++){limb(c,[[36,49+i*8],[18,49+i*10],[12,casting?33+i*8:61+i*10]],BONE,3);bell(c,12,casting?33+i*8:63+i*10,7);}}
  if(s.rank===3&&cold) {line(c,[[77,19],[69,11],[77,5],[70,1]],'#98d9e0',3);oval(c,26,45,6,6,'#89c0c8');}
  if(s.rank===4){poly(c,[[19,36],[24,17],[67,17],[78,38],[75,84],[66,90],[65,33],[30,33],[29,86],[20,84]],'#59736a');bell(c,47,61,27,'#95ac92');skull(c,46,31,17);crown(c,46,23,29);}
  if(swing) line(c,[[22,69],[33,64]],'#bed8c3',2);
}
function drawCoffin(c: Ctx, s: ActorArtSpec, frame: number) {
  const step=frame===1?-3:frame===3?3:0, fire=s.branch==='B', casting=frame===5;
  limb(c,[[34,78],[30-step,88],[26-step,99]],'#a7a288',5); limb(c,[[59,79],[66+step,88],[70+step,99]],'#a7a288',5);
  limb(c,[[25,47],[16,64],[frame===4?36:18,casting?36:76]],BONE,5); limb(c,[[67,47],[79,62],[frame===4?93:80,casting?35:77]],BONE,5);
  poly(c,[[34,24],[59,24],[73,46],[64,84],[29,84],[20,46]],'#65573e');
  poly(c,[[37,30],[56,30],[66,48],[60,77],[33,77],[27,48]],fire?'#6c4b34':'#897451');
  line(c,[[39,31],[36,75]],'#ac9469',2);line(c,[[53,31],[57,75]],'#4b4633',2);
  for(const p of [[33,38],[61,38],[32,71],[62,71]] as Pt[])oval(c,p[0],p[1],2,2,'#c7b98b',INK,0);
  skull(c,46,46,18,fire?'#e9ae68':'#accab0');
  line(c,[[38,61],[55,61]],'#dac9a1',3);line(c,[[46,58],[46,70]],'#dac9a1',3);
  if(s.rank>=2&&!fire){poly(c,[[12,48],[23,40],[26,79],[16,75]],'#817050');line(c,[[17,48],[20,71]],GOLD,2);}
  if(fire){poly(c,[[61,44],[64,27],[72,39],[79,24],[80,45],[74,57]],'#c4774e');poly(c,[[67,44],[70,32],[75,46],[71,52]],'#efbb65');}
  if(s.rank===3&&!fire){shield(c,20,64,33,'#706345',true);line(c,[[68,32],[83,40],[74,46]],BONE,4);}
  if(s.rank===3&&fire){oval(c,79,69,11,14,'#9f865d');oval(c,79,56,9,4,'#c7ad76');skull(c,79,66,10);}
  if(s.rank===4){poly(c,[[17,27],[47,7],[79,27],[72,33],[46,18],[23,33]],'#a18a59');crown(c,47,14,23);poly(c,[[13,34],[20,30],[21,88],[13,91]],'#6c684e');poly(c,[[74,32],[83,35],[82,90],[74,85]],'#6c684e');skull(c,46,48,24,'#f0d090');}
}
function humanFace(c: Ctx, x: number, y: number, hood: boolean, king: boolean) {
  if(hood)poly(c,[[x-13,y+9],[x-11,y-10],[x,y-17],[x+13,y-4],[x+11,y+12]],'#4f5750');
  oval(c,x,y,9,12,'#c1a17f'); rect(c,x+3,y-2,3,2,INK); line(c,[[x+4,y+5],[x+8,y+5]],'#684d3e',1);
  if(king)crown(c,x,y-9,24);
}
function drawHuman(c: Ctx, s: ActorArtSpec, frame: number) {
  const n=Number(s.id.replace(/\D/g,'')) || 1, step=frame===1?-3:frame===3?3:0;
  const attack=frame===4, cast=frame===5, boss=[5,10,15].includes(n), priest=[4,8,13].includes(n);
  const heavy=[2,5,6,10,11,14,15].includes(n), ranged=[3,7,12].includes(n);
  const cloth=n>=11?'#758489':n>=6?'#78695a':'#747253';
  if(boss)poly(c,[[27,39],[47,38],[57,88],[38,97],[20,87]],n===15?'#7d4440':'#894f40');
  line(c,[[38,73],[34-step,85],[32-step,98]],'#303b37',10);line(c,[[50,73],[56+step,85],[57+step,98]],'#303b37',10);
  rect(c,24-step,94,13,7,'#3b3b30');rect(c,53+step,94,14,7,'#3b3b30');
  if(priest)poly(c,[[31,40],[56,40],[64,94],[51,91],[43,98],[24,95]],n===13?'#c8c8b0':'#a69e7f');
  else poly(c,[[31,42],[56,42],[61,70],[52,79],[34,78],[27,64]],heavy?'#7c8880':cloth);
  if(heavy) {poly(c,[[33,45],[53,45],[57,66],[47,74],[34,68]],n>=11?'#a4ada1':'#92988a');line(c,[[43,45],[43,68]],'#d3d0b9',2);}
  line(c,[[32,45],[23,60],[cast?24:30,cast?31:69]],cloth,9);
  line(c,[[55,45],[64,58],[attack?79:68,cast?34:65]],cloth,9);
  oval(c,cast?24:30,cast?31:69,4,5,'#c5a17c');oval(c,attack?79:68,cast?34:65,4,5,'#c5a17c');
  humanFace(c,44,29,[3,4,8,12,13].includes(n),boss);
  if(heavy&&!boss){poly(c,[[32,27],[35,15],[48,14],[57,24],[57,29],[32,29]],n>=11?'#a3aaa0':'#687c77');rect(c,48,25,11,4,'#485957');}
  if(n===1){poly(c,[[26,20],[60,20],[49,14],[47,8],[35,11],[33,17]],'#a68e55');line(c,[[69,92],[72,27]],'#89724a',4);for(let i=0;i<3;i++)line(c,[[66+i*6,32],[66+i*6,17]],IRON,2);line(c,[[66,31],[78,31]],IRON,3);}
  else if([2,10,11].includes(n)){shield(c,30,65,n===11?47:36,n>=10?'#5c7180':'#727456',n>=10);blade(c,attack?79:68,cast?34:65,attack);}
  else if(n===3){line(c,[[74,40],[84,62],[73,83]],'#bdac79',4);line(c,[[74,40],[74,83]],'#d4c9a5',1);line(c,[[64,61],[91,61]],BONE,2);poly(c,[[24,43],[31,40],[27,72],[21,74]],'#795a40');}
  else if([7,12].includes(n)){line(c,[[59,60],[88,58]],'#72523b',6);line(c,[[76,43],[83,60],[77,77]],'#a3a895',4);line(c,[[77,43],[89,58],[77,77]],'#c1bfa4',1);if(n===12){poly(c,[[29,19],[58,19],[49,3],[35,5]],'#3c4548');rect(c,38,27,15,6,'#d2cabb');}}
  else if(priest){line(c,[[73,93],[73,22]],GOLD,4);line(c,[[66,29],[80,29]],'#dbc88d',4);oval(c,73,20,4,5,'#e7dcb5');rect(c,22,55,14,17,'#595443');rect(c,25,58,9,11,'#d0c49b');if(n===13)poly(c,[[33,21],[43,5],[54,20]],'#dfd4af');}
  else if([6,14].includes(n)){line(c,[[67,94],[76,9]],'#746850',4);poly(c,[[75,8],[69,28],[81,24]],'#ccd4c7');if(n===6)poly(c,[[77,21],[89,21],[87,34],[77,37]],'#899990');if(n===14){line(c,[[73,17],[81,24],[71,32]],'#9bcbdf',3);poly(c,[[29,43],[36,39],[40,57],[28,57]],'#6c91a1');}}
  else if(n===9){oval(c,24,57,10,20,'#755738');line(c,[[20,43],[29,42],[30,75]],'#ab8a56',3);oval(c,70,65,7,8,'#b89057');poly(c,[[68,58],[69,44],[73,51],[77,45],[76,60]],'#edac5b');}
  else blade(c,attack?79:68,65,attack);
  if(boss){line(c,[[30,42],[43,48],[55,40]],GOLD,4);oval(c,43,49,3,4,'#dfbe7b');}
}

export function paintActorAtlas(spec: ActorArtSpec): HTMLCanvasElement {
  const canvas=document.createElement('canvas'); canvas.width=ACTOR_W*ACTOR_FRAMES;canvas.height=ACTOR_H;
  const c=canvas.getContext('2d')!;c.imageSmoothingEnabled=false;
  for(let frame=0;frame<ACTOR_FRAMES;frame++){
    c.save();c.translate(frame*ACTOR_W,0);
    if(spec.enemy)drawHuman(c,spec,frame);
    else switch(spec.family){
      case 'SK':drawSkeleton(c,spec,frame);break;
      case 'ZM':drawZombie(c,spec,frame);break;
      case 'HR':drawHorse(c,spec,frame);break;
      case 'HD':drawHand(c,spec,frame);break;
      case 'BL':drawBell(c,spec,frame);break;
      case 'CF':drawCoffin(c,spec,frame);break;
      default:drawSkeleton(c,{...spec,family:'SK'},frame);
    }
    c.restore();
  }
  return canvas;
}

export function paintNecromancer():HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=112;const c=canvas.getContext('2d')!;
  poly(c,[[34,36],[60,35],[69,97],[55,92],[44,101],[21,93]],'#263f3c');
  poly(c,[[40,42],[51,41],[56,89],[35,90]],'#436c5c');
  poly(c,[[28,34],[34,13],[47,6],[62,22],[63,42],[51,46]],'#172d2a');
  skull(c,47,30,18,'#a0e1bf');poly(c,[[31,27],[38,13],[48,11],[58,22]],'#315046');
  limb(c,[[59,48],[68,58],[76,46]],BONE,4);limb(c,[[34,47],[26,61],[33,69]],BONE,4);
  line(c,[[77,99],[79,24]],'#8b7952',4);poly(c,[[71,24],[75,12],[85,11],[91,22],[84,29]],'#829d7e');
  oval(c,80,19,5,7,'#a2dfb2');line(c,[[38,64],[56,64]],'#b6a16b',3);skull(c,45,65,11);
  rect(c,26,64,14,15,'#736243');rect(c,29,67,8,9,'#cbbb8e');
  return canvas;
}
