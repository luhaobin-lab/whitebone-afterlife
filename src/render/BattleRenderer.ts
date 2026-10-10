import Phaser from 'phaser';
import { ENEMIES, FAMILY_COLORS, UNITS, getStats, getUnit } from '../content';
import type { BattleEffect, BattleState, CombatStatus, EnemySpawn, FamilyId, UnitInstance } from '../domain/types';
import { ACTOR_FRAMES, ACTOR_H, ACTOR_W, paintActorAtlas, paintNecromancer } from './actorArt';
import { paintLandscape, paintMist } from './scenery';
import { insideRect, preparationLayout, type CampRegion, type PreparationLayout } from './prepLayout';

export interface BattleView {
  battle: BattleState | null;
  team: UnitInstance[];
  reserve?: UnitInstance[];
  staging?: UnitInstance[];
  freshUids?: string[];
  enemies: EnemySpawn[];
  act: number;
  phase: string;
  selectedUid?: string;
  capacity: number;
  paused?: boolean;
}
export interface BattleCallbacks {
  onUnitClick?: (id: string) => void;
  onSlotClick?: (slot: number) => void;
  onUnitDrop?: (uid: string, slot: number) => void;
  onUnitMerge?: (donorUid:string,targetUid:string) => void;
  onUnitBench?: (uid:string) => void;
}
interface ActorSnapshot {
  id: string; uid?: string; templateId: string; family?: FamilyId; side:'ally'|'enemy';
  x:number;y:number;hp:number;maxHp:number;shield:number;rank:number;level:number;
  alive:boolean;temporary:boolean;boss:boolean;action:string;facing:number;
  statuses:CombatStatus[];range:number;aps:number;
  region?:'field'|CampRegion;order?:number;slot?:number;name?:string;
}
interface ActorVisual { image:Phaser.GameObjects.Image; label:Phaser.GameObjects.Text|null;snapshot:ActorSnapshot; x:number;y:number; seed:number; bornAt:number }
type DropTarget={kind:'merge';uid:string}|{kind:'slot';slot:number}|{kind:'bench';region:CampRegion}|null;
interface DragState {uid:string;actorId:string;startX:number;startY:number;x:number;y:number;moved:boolean;target:DropTarget;offsetX:number;offsetY:number}
const ENEMY_BY_ID=new Map(ENEMIES.map(e=>[e.id,e]));
const UNIT_BY_ID=new Map(UNITS.map(u=>[u.id,u]));
const PREPARATION=new Set(['prep','prepare','preparation','formation']);
// The requested redesign was cancelled before integration. Keep its draft layout
// dormant; the published interface continues to use the verified legacy gestures.
const CAMP_INTERACTION_ENABLED=false;
const CLAMP=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const FAMILY_HEX:Record<FamilyId,number>=Object.fromEntries(Object.entries(FAMILY_COLORS).map(([k,v])=>[k,Number.parseInt(v.slice(1),16)])) as Record<FamilyId,number>;
const STATUS_COLORS:Record<string,number>={POISON:0x9ec77a,CHILL:0x93cddd,FROZEN:0xc4eced,BURN:0xe5a363,WET:0x7cb6c9,SHOCK:0xc7c2ec,BONE_ARMOR:0x98c9c2,EXPOSED:0xce927a,HASTE:0xbcc489,REGEN:0x7ec8a1,TAUNTED:0xdcb873,SOUL_BRAND:0xc29bd6};
const EFFECT_COLORS:Record<string,number>={hit:0xf2debb,crit:0xf8c874,heal:0x8cddb2,shield:0x91cec6,shieldBreak:0xa3d9d6,death:0xd4c5a5,summon:0x8ad1ad,dash:0xe6bf88,projectile:0xdfd1ae,poison:0xa0c473,lightning:0xa2dce4,taunt:0xdbba78,bone:0xdccdac,text:0xeee3cb,cast:0xe6a969,freeze:0xb3e3ed,burn:0xe69b56,breach:0xed9380};
function color(value:string|undefined,fallback:number){return value?.startsWith('#')?Number.parseInt(value.slice(1),16):fallback;}
function hash(text:string){let h=0;for(let i=0;i<text.length;i++)h=(Math.imul(h,31)+text.charCodeAt(i))|0;return Math.abs(h);}

/** DOM owns menus and rules. This adapter owns exactly one disposable Phaser canvas. */
export class BattleRenderer {
  private game:Phaser.Game;
  private scene:BattleScene|null=null;
  private observer:ResizeObserver;
  private view:BattleView={battle:null,team:[],enemies:[],act:1,phase:'prep',capacity:4};
  private dead=false;
  constructor(private parent:HTMLElement,private callbacks:BattleCallbacks={}){
    const width=Math.max(320,parent.clientWidth||1100),height=Math.max(240,parent.clientHeight||390);
    const scene=new BattleScene(this);
    this.game=new Phaser.Game({
      type:Phaser.AUTO,parent,width,height,backgroundColor:'#172821',banner:false,
      autoFocus:false,audio:{noAudio:true},scene:[scene],
      render:{antialias:false,pixelArt:true,roundPixels:true,preserveDrawingBuffer:true},
      scale:{mode:Phaser.Scale.NONE},fps:{target:60,min:15},
      input:{activePointers:1},
    });
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(parent);
  }
  setView(view:BattleView){if(this.dead)return;this.view=view;this.scene?.setView(view);}
  /** Convert a native DOM drag pointer to a currently available preparation slot. */
  slotAtClient(clientX:number,clientY:number):number|null{
    if(this.dead||!this.scene)return null;
    const rect=this.game.canvas.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||clientX<rect.left||clientX>rect.right||clientY<rect.top||clientY>rect.bottom)return null;
    return this.scene.slotAtCanvas((clientX-rect.left)*this.game.scale.width/rect.width,(clientY-rect.top)*this.game.scale.height/rect.height);
  }
  resize(){
    if(this.dead)return;
    const w=Math.round(this.parent.clientWidth),h=Math.round(this.parent.clientHeight);
    if(w<1||h<1)return;
    const width=Math.max(320,w),height=Math.max(220,h);
    if(this.game.scale.width!==width||this.game.scale.height!==height)this.game.scale.resize(width,height);
    this.scene?.relayout();
  }
  destroy(){if(this.dead)return;this.dead=true;this.observer.disconnect();this.game.destroy(true);this.scene=null;}
  getDebugStats(){return this.scene?.debugStats()??{ready:false,actors:0,canvasCount:this.parent.querySelectorAll('canvas').length};}
  /** @internal Reserved opt-in for the unfinished camp interaction draft. */
  hasMergeCallback(){return typeof this.callbacks.onUnitMerge==='function';}
  /** @internal Scene boot handshake, not gameplay state. */
  sceneReady(scene:BattleScene){this.scene=scene;scene.setView(this.view);this.resize();}
  /** @internal Input is delegated, never applied to the snapshot. */
  dispatch(kind:'unit'|'slot'|'drop'|'merge'|'bench',id:string|number,target?:number|string){
    if(kind==='unit')this.callbacks.onUnitClick?.(String(id));
    if(kind==='slot')this.callbacks.onSlotClick?.(Number(id));
    if(kind==='drop'&&typeof target==='number')this.callbacks.onUnitDrop?.(String(id),target);
    if(kind==='merge'&&typeof target==='string')this.callbacks.onUnitMerge?.(String(id),target);
    if(kind==='bench')this.callbacks.onUnitBench?.(String(id));
  }
}

class BattleScene extends Phaser.Scene {
  private view:BattleView={battle:null,team:[],enemies:[],act:1,phase:'prep',capacity:4};
  private actors=new Map<string,ActorVisual>();
  private background!:Phaser.GameObjects.Image;
  private ground!:Phaser.GameObjects.Graphics;
  private overlays!:Phaser.GameObjects.Graphics;
  private fx!:Phaser.GameObjects.Graphics;
  private corpses!:Phaser.GameObjects.Graphics;
  private necromancer!:Phaser.GameObjects.Image;
  private mist:Phaser.GameObjects.Image[]=[];
  private numbers:Phaser.GameObjects.Text[]=[];
  private slotLabels:Phaser.GameObjects.Text[]=[];
  private campLabels:Phaser.GameObjects.Text[]=[];
  private dragHint!:Phaser.GameObjects.Text;
  private prepLayout:PreparationLayout=preparationLayout(1100,390,0,0);
  private layoutKey='';
  private freshSeen=new Set<string>();
  private freshActive=new Set<string>();
  private birthTimes=new Map<string,number>();
  private departing:Array<{image:Phaser.GameObjects.Image;started:number}>=[];
  private drag:DragState|null=null;
  private hoverId:string|null=null;
  private width=1100;private height=390;private actorSize=58;
  private decorTime=0;private backgroundAct=0;
  private lastBattle:BattleState|null=null;private battleFinishedAt:number|null=null;
  private pointerDownUnit:string|null=null;
  private ready=false;
  constructor(private owner:BattleRenderer){super({key:'AfterlifeBattlePresentation'});}
  create(){
    for(const u of UNITS)this.installAtlas(u.id,u.family,u.rank,u.branch,false);
    for(const e of ENEMIES)this.installAtlas(e.id,undefined,e.act,'',true);
    this.textures.addCanvas('undead-necromancer',paintNecromancer());
    for(let act=1;act<=3;act++)this.textures.addCanvas(`landscape-${act}`,paintLandscape(act));
    this.textures.addCanvas('grave-mist',paintMist());
    this.background=this.add.image(0,0,'landscape-1').setOrigin(0).setDepth(0);
    this.mist=[this.add.image(0,0,'grave-mist').setAlpha(.7).setDepth(3),this.add.image(0,0,'grave-mist').setAlpha(.35).setDepth(4)];
    this.ground=this.add.graphics().setDepth(10);
    this.corpses=this.add.graphics().setDepth(15);
    this.necromancer=this.add.image(0,0,'undead-necromancer').setOrigin(.5,100/112).setDepth(270);
    this.overlays=this.add.graphics().setDepth(5000);
    this.fx=this.add.graphics().setDepth(5100);
    for(let i=0;i<30;i++)this.numbers.push(this.add.text(0,0,'',{fontFamily:'Arial, sans-serif',fontSize:'12px',fontStyle:'bold',color:'#f0e5cf',stroke:'#17251d',strokeThickness:3}).setOrigin(.5).setDepth(5200).setVisible(false));
    for(let i=0;i<8;i++)this.slotLabels.push(this.add.text(0,0,String(i+1),{fontFamily:'Arial, sans-serif',fontSize:'12px',fontStyle:'bold',color:'#b9c7aa',stroke:'#1a2923',strokeThickness:3}).setOrigin(.5).setDepth(5001));
    this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>this.pointerDown(p));
    this.input.on('pointermove',(p:Phaser.Input.Pointer)=>this.pointerMove(p));
    this.input.on('pointerup',(p:Phaser.Input.Pointer)=>this.pointerUp(p));
    this.input.on('pointerupoutside',()=>this.cancelDrag());
    this.game.events.on(Phaser.Core.Events.BLUR,()=>this.cancelDrag());
    this.scale.on('resize',()=>this.relayout());
    this.game.canvas.style.display='block';this.game.canvas.style.touchAction='none';
    this.game.canvas.setAttribute('aria-label','亡灵军团战场。准备阶段可以选择并拖动士兵到部署格。');
    this.ready=true;this.relayout();this.owner.sceneReady(this);
  }
  private installAtlas(id:string,family:FamilyId|undefined,rank:number,branch:string,enemy:boolean){
    const texture=this.textures.addCanvas(`actor:${id}`,paintActorAtlas({id,family,rank,branch,enemy}));
    if(texture)for(let f=0;f<ACTOR_FRAMES;f++)texture.add(f,0,f*ACTOR_W,0,ACTOR_W,ACTOR_H);
  }
  setView(view:BattleView){
    const prior=this.view.battle,priorPhase=this.view.phase,priorPaused=this.view.paused;
    this.view=view;
    if(priorPhase!==view.phase||view.paused&&!priorPaused)this.cancelDrag();
    if(view.phase==='title'||view.phase==='map'){this.freshSeen.clear();this.birthTimes.clear();this.freshActive.clear();}
    const fresh=new Set(view.freshUids??[]);
    for(const id of fresh)if(!this.freshActive.has(id)&&!this.freshSeen.has(id)){this.freshSeen.add(id);this.birthTimes.set(id,this.decorTime);}
    this.freshActive=fresh;
    const key=`${this.width}:${this.height}:${this.isPrep()}:${view.reserve?.length??0}:${view.staging?.length??0}`;
    if(key!==this.layoutKey){this.layoutKey=key;this.prepLayout=preparationLayout(this.width,this.height,view.reserve?.length??0,view.staging?.length??0);if(this.ready)this.relayout();}
    if(prior!==view.battle&&(!prior||!view.battle||prior.input.seed!==view.battle.input.seed)){
      this.battleFinishedAt=null;this.drag=null;this.pointerDownUnit=null;
    }
    if(view.battle&&!view.battle.result)this.battleFinishedAt=null;
    if(this.ready&&CLAMP(view.act,1,3)!==this.backgroundAct){this.backgroundAct=CLAMP(view.act,1,3);this.background.setTexture(`landscape-${this.backgroundAct}`);}
  }
  relayout(){
    if(!this.ready)return;
    this.cancelDrag();
    this.width=this.scale.width;this.height=this.scale.height;
    this.prepLayout=preparationLayout(this.width,this.height,this.view.reserve?.length??0,this.view.staging?.length??0);
    this.actorSize=this.isPrep()&&this.hasCampUi()?this.prepLayout.actorSize:CLAMP(Math.min(this.width/19,this.height*.145),32,68);
    this.background.setDisplaySize(this.width,this.height);
    const mage=this.toScreen(1.1,6.8);this.necromancer.setPosition(mage.x,mage.y).setDisplaySize(this.actorSize*1.13,this.actorSize*1.13*ACTOR_H/ACTOR_W);
    this.mist[0].setDisplaySize(this.width*.78,this.height*.25);
    this.mist[1].setDisplaySize(this.width*.94,this.height*.2);
    for(const a of this.actors.values()){const p=this.actorPosition(a.snapshot);a.x=p.x;a.y=p.y;}
  }
  debugStats(){
    const rect=this.game.canvas.getBoundingClientRect(),client=(x:number,y:number)=>({clientX:rect.left+x/this.width*rect.width,clientY:rect.top+y/this.height*rect.height});
    return{ready:this.ready,actors:this.actors.size,displayObjects:this.children.length,textureCount:this.textures.getTextureKeys().length,textureMismatches:[...this.actors.values()].filter(a=>a.image.texture.key!==this.textureFor(a.snapshot)).length,numberPool:this.numbers.length,phase:this.view.phase,width:this.width,height:this.height,departing:this.departing.length,freshAnimations:this.birthTimes.size,
      actorPositions:[...this.actors.values()].map(a=>({id:a.snapshot.id,uid:a.snapshot.uid,region:a.snapshot.region??'battle',slot:a.snapshot.slot,templateId:a.snapshot.templateId,...client(a.image.x,a.image.y-a.image.displayHeight*.38),x:a.image.x,y:a.image.y,body:{left:a.image.x-a.image.displayWidth*.42,top:a.image.y-a.image.displayHeight*.82,width:a.image.displayWidth*.84,height:a.image.displayHeight*.8},bornAt:a.bornAt})),
      slots:this.prepLayout.slots.map((s,i)=>{const foot=this.slotPosition(i),badge=this.hasCampUi()?s.badge:{x:foot.x+Math.max(35,this.actorSize*.98)*.65,y:foot.y+3};return{slot:i,open:i<this.view.capacity,...client(badge.x,badge.y),foot:client(foot.x,foot.y)};}),
      camps:this.hasCampUi()?Object.fromEntries(Object.entries(this.prepLayout.camps).map(([k,c])=>[k,{...c.rect,...client(c.rect.x+c.rect.width-12,c.rect.y+12)}])):{},safeBottom:this.hasCampUi()?64:0,dragTarget:this.drag?.target??null};
  }
  private isPrep(){return !this.view.battle&&PREPARATION.has(this.view.phase);}
  private hasCampUi(){return CAMP_INTERACTION_ENABLED&&this.owner.hasMergeCallback()&&(this.view.reserve!==undefined||this.view.staging!==undefined);}
  private canEdit(){return this.isPrep()&&!this.view.paused;}
  private cancelDrag(){this.drag=null;this.pointerDownUnit=null;this.dragHint?.setVisible(false);}
  /** @internal Native DOM drag/drop shares exactly the scene's preparation hit map. */
  slotAtCanvas(x:number,y:number):number|null{return this.isPrep()?this.slotAt(x,y):null;}
  private toScreen(x:number,y:number){return this.isPrep()&&this.hasCampUi()?{x:x>=28?this.width*(.66+(x-28)/9*.29):this.width*(.1+(x-3)/9*.33),y:this.prepLayout.fieldTop+y/12*(this.prepLayout.fieldBottom-this.prepLayout.fieldTop)}:{x:32+x/40*(this.width-64),y:this.height*.53+y/12*(this.height*.33)};}
  private slotPosition(slot:number){return this.isPrep()&&this.hasCampUi()?this.prepLayout.slots[slot].foot:this.toScreen(12-Math.floor(slot/2)*3,slot%2===0?4:8);}
  private actorPosition(s:ActorSnapshot){return this.isPrep()&&this.hasCampUi()&&s.region&&s.region!=='field'?this.prepLayout.camps[s.region].points[s.order??0]??this.toScreen(s.x,s.y):s.slot!==undefined&&this.isPrep()?this.slotPosition(s.slot):this.toScreen(s.x,s.y);}
  private slotBadgeAt(x:number,y:number){return this.hasCampUi()?this.prepLayout.slots.findIndex((p,i)=>i<this.view.capacity&&Math.hypot(x-p.badge.x,y-p.badge.y)<=14):-1;}
  private slotAt(x:number,y:number):number|null{
    const badge=this.slotBadgeAt(x,y);if(badge>=0)return badge;
    let best:number|null=null,dist=Infinity;
    for(let i=0;i<Math.min(8,this.view.capacity);i++){
      const p=this.slotPosition(i),dx=(x-p.x)/Math.max(29,this.actorSize*.62),dy=(y-p.y)/Math.max(20,this.actorSize*.45),d=dx*dx+dy*dy;
      if(d<1.65&&d<dist){best=i;dist=d;}
    }
    return best;
  }
  private actorAt(x:number,y:number,exclude?:string){
    let found:ActorVisual|null=null,best=-Infinity;
    for(const a of this.actors.values()){
      if(!a.snapshot.alive||a.snapshot.id===exclude)continue;
      if(!this.hasCampUi()){
        const size=this.sizeFor(a.snapshot);
        if(x>=a.x-size*.5&&x<=a.x+size*.5&&y>=a.y-size*.97&&y<=a.y+size*.12&&a.y>best){found=a;best=a.y;}
        continue;
      }
      const size=a.image.displayWidth,left=a.image.x-size*.43,right=a.image.x+size*.43,top=a.image.y-a.image.displayHeight*.83;
      if(x>=left&&x<=right&&y>=top&&y<=a.image.y+size*.05&&a.image.y>best){found=a;best=a.image.y;}
    }
    return found;
  }
  private pointerDown(p:Phaser.Input.Pointer){
    if(this.canEdit()&&this.slotBadgeAt(p.x,p.y)>=0){this.pointerDownUnit=null;return;}
    const actor=this.actorAt(p.x,p.y);this.pointerDownUnit=actor?.snapshot.uid??actor?.snapshot.id??null;
    if(this.canEdit()&&actor?.snapshot.side==='ally'&&actor.snapshot.uid){
      this.drag={uid:actor.snapshot.uid,actorId:actor.snapshot.id,startX:p.x,startY:p.y,x:actor.image.x,y:actor.image.y,moved:false,target:null,offsetX:actor.image.x-p.x,offsetY:actor.image.y-p.y};
    }
  }
  private pointerMove(p:Phaser.Input.Pointer){
    if(this.drag&&p.isDown){
      if(Math.hypot(p.x-this.drag.startX,p.y-this.drag.startY)>6)this.drag.moved=true;
      if(this.drag.moved){this.drag.x=this.hasCampUi()?p.x+this.drag.offsetX:p.x;this.drag.y=this.hasCampUi()?p.y+this.drag.offsetY:p.y+this.actorSize*.4;this.drag.target=this.dropTarget(p.x,p.y,this.drag);}
    }else{this.hoverId=this.actorAt(p.x,p.y)?.snapshot.id??null;this.game.canvas.style.cursor=this.hoverId?'pointer':this.isPrep()&&this.slotAt(p.x,p.y)!==null?'crosshair':'default';}
  }
  private pointerUp(p:Phaser.Input.Pointer){
    const drag=this.drag;this.drag=null;
    if(drag?.moved){
      const target=this.canEdit()?this.dropTarget(p.x,p.y,drag):null;
      if(target?.kind==='merge')this.owner.dispatch('merge',drag.uid,target.uid);
      if(target?.kind==='slot')this.owner.dispatch('drop',drag.uid,target.slot);
      if(target?.kind==='bench')this.owner.dispatch('bench',drag.uid);
      this.pointerDownUnit=null;return;
    }
    if(this.canEdit()){const badge=this.slotBadgeAt(p.x,p.y);if(badge>=0){this.owner.dispatch('slot',badge);this.pointerDownUnit=null;return;}}
    const actor=this.actorAt(p.x,p.y);
    if(actor&&this.pointerDownUnit){this.owner.dispatch('unit',this.view.battle?actor.snapshot.id:actor.snapshot.uid??actor.snapshot.id);}
    else if(this.canEdit()){const slot=this.slotAt(p.x,p.y);if(slot!==null)this.owner.dispatch('slot',slot);}
    this.pointerDownUnit=null;
  }
  private dropTarget(x:number,y:number,drag:DragState):DropTarget{
    if(!this.canEdit()||x<0||x>this.width||y<0||y>this.height-(this.hasCampUi()?64:0)||!this.actors.has(drag.actorId))return null;
    if(!this.hasCampUi()){const slot=this.slotAt(x,y+this.actorSize*.4)??this.slotAt(x,y);return slot===null?null:{kind:'slot',slot};}
    const actor=this.actorAt(x,y,drag.actorId);
    if(actor?.snapshot.side==='ally'&&actor.snapshot.uid)return{kind:'merge',uid:actor.snapshot.uid};
    const badge=this.slotBadgeAt(x,y);if(badge>=0)return{kind:'slot',slot:badge};
    const slot=this.slotAt(x,y);
    if(slot!==null&&!this.view.team.some(u=>u.slot===slot&&u.uid!==drag.uid))return{kind:'slot',slot};
    for(const region of ['staging','reserve'] as const)if(insideRect({x,y},this.prepLayout.camps[region].rect))return{kind:'bench',region};
    return null;
  }
  private snapshots():ActorSnapshot[]{
    const battle=this.view.battle;
    if(battle)return battle.units.map(u=>({id:u.id,uid:u.sourceUid,templateId:u.templateId,family:u.family,side:u.side,x:u.x,y:u.y,hp:u.hp,maxHp:u.maxHp,shield:u.shield,rank:u.rank,level:u.level,alive:u.alive,temporary:u.temporary,boss:u.boss,action:u.action,facing:u.facing,statuses:u.statuses,range:u.range,aps:u.aps}));
    const result:ActorSnapshot[]=[];
    const seen=new Set<string>();
    for(const [region,units] of [['field',this.view.team],['reserve',this.view.reserve??[]],['staging',this.view.staging??[]]] as const){
      for(let index=0;index<units.length;index++){
        const u=units[index];if(seen.has(u.uid))continue;
        if(region==='field'&&(u.slot===null||u.slot<0||u.slot>=this.view.capacity))continue;
        if(region!=='field'&&(!this.isPrep()||!this.hasCampUi()))continue;
        seen.add(u.uid);const d=getUnit(u.templateId),s=getStats(u),slot=u.slot??0;
        result.push({id:u.uid,uid:u.uid,templateId:u.templateId,family:d.family,side:'ally',x:12-Math.floor(slot/2)*3,y:slot%2===0?4:8,hp:s.hp,maxHp:s.hp,shield:0,rank:d.rank,level:s.level,alive:true,temporary:false,boss:false,action:'idle',facing:1,statuses:[],range:s.range,aps:s.aps,region,order:index,slot:region==='field'?slot:undefined,name:d.name});
      }
    }
    let index=0;
    const previewColumns=Math.ceil(this.view.enemies.reduce((sum,g)=>sum+g.count,0)/3);
    for(const group of this.view.enemies){
      const d=ENEMY_BY_ID.get(group.templateId);if(!d)continue;
      for(let i=0;i<group.count;i++){
        const lane=index%3,col=Math.floor(index/3);index++;
        result.push({id:`preview:${d.id}:${i}:${index}`,templateId:d.id,side:'enemy',x:28+col*(9/Math.max(1,previewColumns-1)),y:2.5+lane*3.5,hp:d.hp*(group.hpScale??1),maxHp:d.hp*(group.hpScale??1),shield:0,rank:d.act,level:1,alive:true,temporary:false,boss:!!group.boss||d.role.includes('首领'),action:'idle',facing:-1,statuses:[],range:d.range,aps:d.aps});
      }
    }
    return result;
  }
  private textureFor(s:ActorSnapshot){
    if(this.textures.exists(`actor:${s.templateId}`))return `actor:${s.templateId}`;
    if(s.side==='enemy')return 'actor:E01';
    return `actor:U_${s.family??'SK'}_1`;
  }
  private sizeFor(s:ActorSnapshot){const base=this.isPrep()&&this.hasCampUi()&&s.region&&s.region!=='field'?this.prepLayout.camps[s.region].size:this.actorSize;return base*(s.temporary ? .70 : 1)*(s.boss?1.3:1)*(s.side==='ally'?1+Math.max(0,s.rank-1)*.06:this.isPrep()&&this.hasCampUi()?.82:1);}
  update(_time:number,delta:number){
    if(!this.ready)return;
    if(!this.view.paused)this.decorTime+=Math.min(delta,80)/1000;
    const battle=this.view.battle;
    if(battle?.result&&this.battleFinishedAt===null)this.battleFinishedAt=this.decorTime;
    const t=battle?battle.time+(battle.result?this.decorTime-(this.battleFinishedAt??this.decorTime):0):this.decorTime;
    this.mist[0].setPosition(this.width*.5+Math.sin(this.decorTime*.04)*this.width*.16,this.height*.59);
    this.mist[1].setPosition(this.width*.42-Math.sin(this.decorTime*.055)*this.width*.18,this.height*.85);
    this.ground.clear();this.overlays.clear();this.fx.clear();this.corpses.clear();
    this.drawSlots();this.drawCorpses();
    // Domain retains combat history; presentation keeps objects only for living actors.
    // Corpses are rendered independently, and a revived actor is recreated when alive.
    const rows=this.snapshots().filter(s=>s.alive),aliveIds=new Set(rows.map(u=>u.id));
    for(const [id,a]of this.actors){if(!aliveIds.has(id)){a.label?.destroy();if(this.isPrep()&&this.hasCampUi()&&a.snapshot.side==='ally'){this.departing.push({image:a.image,started:this.decorTime});}else a.image.destroy();this.actors.delete(id);}}
    for(let i=this.departing.length-1;i>=0;i--){const d=this.departing[i],age=this.decorTime-d.started;if(age>=.32||!this.isPrep()){d.image.destroy();this.departing.splice(i,1);}else d.image.setAlpha(1-age/.32).setScale(d.image.scaleX*.985,d.image.scaleY*.985).setTint(0xadd4b2);}
    const hitTimes=new Map<string,{kind:string;age:number}>();
    if(battle)for(const e of battle.effects){if(e.targetId&&['hit','crit','heal','shield'].includes(e.kind)&&t-e.t>=0&&t-e.t<.13)hitTimes.set(e.targetId,{kind:e.kind,age:t-e.t});}
    for(const s of rows){
      let a=this.actors.get(s.id);
      const p=this.actorPosition(s);
      if(!a){a={image:this.add.image(p.x,p.y,this.textureFor(s),0).setOrigin(.5,100/112),label:null,snapshot:s,x:p.x,y:p.y,seed:hash(s.id)%1000,bornAt:this.birthTimes.get(s.id)??-999};this.actors.set(s.id,a);}
      a.snapshot=s;
      if(this.birthTimes.has(s.id))a.bornAt=this.birthTimes.get(s.id)!;
      if(this.isPrep()&&this.hasCampUi()&&s.side==='ally'&&!a.label)a.label=this.add.text(0,0,'',{fontFamily:'sans-serif',fontSize:'12px',fontStyle:'bold',color:'#dce4cb',stroke:'#14251b',strokeThickness:3,align:'center'}).setOrigin(.5,0).setDepth(5020);
      if(a.label&&!this.isPrep()){a.label.destroy();a.label=null;}
      const texture=this.textureFor(s);if(a.image.texture.key!==texture)a.image.setTexture(texture,0);
      a.image.setVisible(true);
      const distance=Math.hypot(p.x-a.x,p.y-a.y),blend=distance>this.width*.11?1:1-Math.exp(-Math.min(delta,80)*.025);
      if(!this.view.paused){a.x+=(p.x-a.x)*blend;a.y+=(p.y-a.y)*blend;}
      const size=this.sizeFor(s),floating=s.family==='BL',moving=s.action==='move';
      let frame=moving?1+Math.floor(t*7+a.seed)%3:s.action==='cast'?5:s.action==='attack'&&Math.sin(t*Math.max(.5,s.aps)*Math.PI*2)>.05?4:0;
      if(s.statuses.some(st=>st.id==='FROZEN'))frame=0;
      const bob=floating?Math.sin(t*2.1+a.seed)*2:moving?Math.sin(t*14+a.seed)*1.4:Math.sin(t*1.4+a.seed)*.5;
      const entrance=this.isPrep()&&this.hasCampUi()?CLAMP((this.decorTime-a.bornAt)/.72,0,1):1;
      let px=a.x,py=a.y;
      if(this.drag?.actorId===s.id&&this.drag.moved){px=this.drag.x;py=this.drag.y;}
      const lift=entrance<1?(1-entrance)*18:0;
      a.image.setPosition(px,py+bob+lift).setFrame(frame).setDisplaySize(size,size*ACTOR_H/ACTOR_W).setFlipX(s.facing<0).setDepth(this.drag?.actorId===s.id&&this.drag.moved?4900:100+a.y);
      a.image.setAlpha((s.temporary ? .77 : 1)*(.25+.75*entrance)).clearTint();
      if(entrance<1){this.fx.lineStyle(2,0xd9c77e,1-entrance).strokeEllipse(px,py+3,20+entrance*size,8+entrance*size*.2);this.fx.lineStyle(1,0x9acdad,(1-entrance)*.6).lineBetween(px,py+5,px,py-size*(.4+entrance));}
      if(a.label)a.label.setText(`${s.name} · ${s.level}`).setPosition(px,py+8).setVisible(!this.drag||!this.drag.moved||this.drag.actorId===s.id||this.drag.target?.kind==='merge'&&this.drag.target.uid===s.uid).setAlpha(this.drag?.actorId===s.id&&this.drag.moved?.8:1);
      const hit=hitTimes.get(s.id);
      if(hit){a.image.setTintFill(hit.kind==='heal'?0xb5f0c9:hit.kind==='shield'?0xc5efed:0xffffff);}
      else if(s.statuses.some(st=>st.id==='FROZEN'))a.image.setTint(0xaedce8);
      else if(s.statuses.some(st=>st.id==='POISON'))a.image.setTint(0xd5e2bd);
      this.drawActorOverlay(a,px,py,size,t);
    }
    if(battle)this.drawEffects(battle.effects,t);
    else for(const n of this.numbers)n.setVisible(false);
    this.lastBattle=battle;
  }
  private drawSlots(){
    const prep=this.isPrep();for(const t of this.slotLabels)t.setVisible(prep);
    if(!prep)return;
    for(let i=0;i<8;i++){
      const p=this.slotPosition(i),open=i<this.view.capacity,hot=this.drag?.target?.kind==='slot'&&this.drag.target.slot===i;
      const w=Math.max(35,this.actorSize*.98),h=Math.max(19,this.actorSize*.48);
      this.ground.fillStyle(hot?0xc3bb7a:open?0x66856e:0x243b2d,hot?.36:.14).fillEllipse(p.x,p.y+4,w,h);
      this.ground.lineStyle(hot?2:1,hot?0xe5cf89:open?0x8bad89:0x4f6653,open?.7:.36).strokeEllipse(p.x,p.y+4,w,h);
      this.slotLabels[i].setPosition(p.x+w*.65,p.y+3).setColor(open?'#c6cfb6':'#72826c').setText(open?String(i+1):'×');
      if(open){for(const sign of [-1,1])this.ground.lineBetween(p.x+sign*w*.52,p.y,p.x+sign*w*.62,p.y);}
    }
    this.ground.lineStyle(1,0xbeb182,.16).lineBetween(this.toScreen(14,0).x,this.height*.55,this.toScreen(14,0).x,this.height*.93);
  }
  private drawActorOverlay(a:ActorVisual,x:number,y:number,size:number,t:number){
    const s=a.snapshot,g=this.overlays,selected=this.view.selectedUid===s.uid||this.view.selectedUid===s.id,hover=this.hoverId===s.id;
    this.ground.fillStyle(0x0b1812,s.temporary ? .17 : .3).fillEllipse(x,y+2,size*.64,size*.18);
    if(selected||hover){g.lineStyle(selected?2:1,selected?0xebc06f:0xcbdbc4,selected?.9:.55).strokeEllipse(x,y+3,size*.75,size*.25);}
    if(selected&&this.isPrep()){
      const rx=s.range*(this.width-64)/40,ry=s.range*this.height*.33/12;
      this.ground.lineStyle(1,0xb9cbb3,.17).strokeEllipse(x,y,rx*2,ry*2);
    }
    if(s.shield>0){g.lineStyle(1.5,0x9fd5cb,.35+Math.sin(t*3)*.08).strokeEllipse(x,y-size*.41,size*.72,size*.92);}
    const width=Math.max(23,size*.65),barY=y-size*.96;
    g.fillStyle(0x12221c,.9).fillRoundedRect(x-width/2-1,barY-1,width+2,7,2);
    g.fillStyle(s.side==='ally'?0x8cb894:0xc48874,1).fillRect(x-width/2,barY,width*CLAMP(s.hp/s.maxHp,0,1),4);
    if(s.shield>0)g.fillStyle(0xa0d3d0,1).fillRect(x-width/2,barY-4,width*CLAMP(s.shield/(s.maxHp*.6),0,1),2);
    if(!s.temporary&&s.side==='ally'){
      for(let j=0;j<s.rank;j++){
        const px=x-width/2+j*5+2;
        g.fillStyle(s.rank===4?0xe3bd70:s.rank===3?0xc5a7d6:s.rank===2?0x94c7c2:0xbcbaa1,1).fillTriangle(px,barY+8,px-2,barY+5,px+2,barY+5);
      }
    }
    const statuses=s.statuses.filter(st=>st.remaining>0).slice(0,4);
    for(let i=0;i<statuses.length;i++){
      const st=statuses[i],px=x-width/2+i*9,sy=barY-11;
      g.fillStyle(0x1a2923,.9).fillRect(px-1,sy-1,8,8);
      g.fillStyle(STATUS_COLORS[st.id]??0xc3b88d,.95).fillRect(px,sy,6,6);
      if(st.id==='POISON')g.fillStyle(0x23452b).fillCircle(px+3,sy+2,1.5);
      if(st.id==='FROZEN'||st.id==='CHILL')g.lineStyle(1,0xffffff,.7).lineBetween(px+1,sy+3,px+5,sy+3);
      if(st.stacks>1)g.fillStyle(0xf0e5cf).fillRect(px+4,sy+4,2,2);
    }
    if(s.boss){g.fillStyle(0xcdb079).fillTriangle(x,barY-8,x-4,barY-3,x+4,barY-3);}
  }
  private drawCorpses(){
    const battle=this.view.battle;if(!battle)return;
    for(const body of battle.corpses){
      if(body.consumed)continue;
      const p=this.toScreen(body.x,body.y),age=Math.max(0,battle.time-body.createdAt),alpha=CLAMP(1-age/14,.15,.72);
      const c=body.side==='ally'?0xb5b69c:0x897e69;
      this.corpses.fillStyle(0x14241a,alpha*.5).fillEllipse(p.x,p.y+3,28,9);
      this.corpses.lineStyle(3,c,alpha).lineBetween(p.x-10,p.y,p.x+8,p.y+2);
      for(let i=0;i<3;i++)this.corpses.lineStyle(2,c,alpha).lineBetween(p.x-4+i*4,p.y-4,p.x-6+i*4,p.y+5);
      this.corpses.fillStyle(c,alpha).fillRoundedRect(p.x+7,p.y-5,7,7,2);
      this.corpses.fillStyle(0x27362a,alpha).fillRect(p.x+10,p.y-3,2,2);
    }
  }
  private drawEffects(effects:BattleEffect[],t:number){
    let numberIndex=0;
    for(const e of effects.slice(-150)){
      const age=t-e.t,duration=Math.max(.08,e.duration||.45);
      if(age<0||age>duration)continue;
      const p=CLAMP(age/duration,0,1),fade=1-p,from=this.toScreen(e.x,e.y),to=this.toScreen(e.toX??e.x,e.toY??e.y),c=color(e.color,EFFECT_COLORS[e.kind]??0xddc898),g=this.fx;
      const atTarget=e.toX!==undefined&&['hit','crit','heal','shield','shieldBreak','summon','poison','taunt','freeze','burn'].includes(e.kind);
      const groundY=atTarget?to.y:from.y;
      const x=atTarget?to.x:from.x,y=groundY-this.actorSize*.42,tx=to.x,ty=to.y-this.actorSize*.42;
      switch(e.kind){
        case 'projectile':{
          const bx=x+(tx-x)*p,by=y+(ty-y)*p-Math.sin(p*Math.PI)*Math.min(20,Math.abs(tx-x)*.055),angle=Math.atan2(ty-y,tx-x);
          g.lineStyle(2,c,1).lineBetween(bx-Math.cos(angle)*13,by-Math.sin(angle)*13,bx,by);
          g.fillStyle(0xf5eacb).fillTriangle(bx,by,bx-Math.cos(angle-.5)*6,by-Math.sin(angle-.5)*6,bx-Math.cos(angle+.5)*6,by-Math.sin(angle+.5)*6);break;
        }
        case 'hit':case 'crit':{
          const radius=(e.kind==='crit'?15:10)*(1+p*.5);
          for(let i=0;i<5;i++){const a=i*Math.PI*.4+e.id;g.lineStyle(e.kind==='crit'?2:1.5,c,fade).lineBetween(x+Math.cos(a)*radius*.25,y+Math.sin(a)*radius*.25,x+Math.cos(a)*radius,y+Math.sin(a)*radius);}
          break;
        }
        case 'heal':{
          g.lineStyle(2,c,fade*.8).strokeCircle(x,y-4*p,7+10*p);
          g.lineStyle(3,c,fade).lineBetween(x-5,y-17*p,x+5,y-17*p).lineBetween(x,y-5-17*p,x,y+5-17*p);break;
        }
        case 'shield':g.lineStyle(2,c,fade).strokeEllipse(x,y,this.actorSize*(.65+p*.2),this.actorSize*(.85+p*.2));break;
        case 'shieldBreak':{
          for(let i=0;i<7;i++){const a=i*Math.PI*2/7,rr=15+p*20;g.fillStyle(c,fade).fillTriangle(x+Math.cos(a)*rr,y+Math.sin(a)*rr,x+Math.cos(a+.15)*(rr+5),y+Math.sin(a+.15)*(rr+5),x+Math.cos(a+.3)*rr,y+Math.sin(a+.3)*rr);}
          break;
        }
        case 'summon':{
          g.lineStyle(2,c,fade).strokeEllipse(x,groundY,16+p*35,5+p*12);
          g.lineStyle(1,c,fade*.6).strokeEllipse(x,groundY-4,30+p*22,10+p*8);
          for(let i=0;i<4;i++){const a=(i/4)*Math.PI*2+p*4;g.fillStyle(c,fade*.6).fillCircle(x+Math.cos(a)*17,groundY-8-p*45+Math.sin(a)*4,2);}
          break;
        }
        case 'dash':{
          for(let i=0;i<5;i++){const q=CLAMP(p-i*.12,0,1);g.lineStyle(2,c,fade*(1-i*.13)).lineBetween(x+(tx-x)*q-13,y+(ty-y)*q+i*2,x+(tx-x)*q+10,y+(ty-y)*q+i*2);}
          break;
        }
        case 'lightning':{
          let px=x,py=y;
          for(let i=1;i<=8;i++){const q=i/8,nx=x+(tx-x)*q,ny=y+(ty-y)*q+(i===8?0:Math.sin(e.id*3+i*9+Math.floor(age*18))*10);g.lineStyle(3,c,fade).lineBetween(px,py,nx,ny);g.lineStyle(1,0xe9f9e7,fade).lineBetween(px,py,nx,ny);px=nx;py=ny;}
          break;
        }
        case 'poison':for(let i=0;i<4;i++){const a=e.id+i*2.1;g.fillStyle(c,fade*.7).fillCircle(x+Math.sin(a)*12,y-18*p+i*4,2+i%2);}break;
        case 'burn':for(let i=0;i<4;i++){const xx=x-11+i*7;g.fillStyle(c,fade*.8).fillTriangle(xx-4,y+10,xx+5,y+10,xx+Math.sin(age*20+i)*3,y-12-10*p);}break;
        case 'freeze':for(let i=0;i<6;i++){const a=i*Math.PI/3;g.lineStyle(2,c,fade).lineBetween(x,y,x+Math.cos(a)*(13+10*p),y+Math.sin(a)*(13+10*p));}break;
        case 'taunt':g.lineStyle(3,c,fade).lineBetween(x,y-20,x,y-11);g.fillStyle(c,fade).fillCircle(x,y-6,2);g.lineStyle(1,c,fade*.5).strokeEllipse(x,groundY,20+p*25,7+p*8);break;
        case 'death':for(let i=0;i<6;i++){const a=i*1.9+e.id,xx=x+Math.cos(a)*22*p,yy=from.y-15-Math.sin(p*Math.PI)*22+Math.sin(a)*p*9;g.lineStyle(3,c,fade*.8).lineBetween(xx,yy,xx+Math.cos(a)*5,yy+Math.sin(a)*5);}break;
        case 'cast':{
          const r=(14+Math.sin(p*Math.PI)*8);g.fillStyle(c,.09).fillEllipse(tx,to.y,r*3,r);
          g.lineStyle(2,c,.35+.4*p).strokeEllipse(tx,to.y,r*3,r);g.lineStyle(1,c,fade).strokeCircle(x,y-4,8+p*12);break;
        }
        case 'breach':g.lineStyle(4,0xde8877,fade).strokeEllipse(this.toScreen(.5,6).x,this.toScreen(.5,6).y-this.actorSize*.4,25+30*p,65+20*p);break;
        case 'bone':g.lineStyle(3,c,fade).lineBetween(x-3,y-20*p,x+4,y-6-20*p);break;
        default:break;
      }
      if(numberIndex<this.numbers.length&&e.amount!==undefined&&Math.abs(e.amount)>=1&&['hit','crit','heal','shield','breach'].includes(e.kind)){
        const number=this.numbers[numberIndex++],positive=e.kind==='heal'||e.kind==='shield';
        number.setPosition(x+(e.id%3-1)*8,y-18-p*23).setText(`${positive?'+':''}${Math.round(Math.abs(e.amount))}`).setColor(positive?e.kind==='heal'?'#9ce0b6':'#afe0db':e.kind==='crit'?'#f7ca75':'#eadfc7').setAlpha(fade).setVisible(true).setFontSize(e.kind==='crit'?16:12);
      }
    }
    for(let i=numberIndex;i<this.numbers.length;i++)this.numbers[i].setVisible(false);
  }
}
