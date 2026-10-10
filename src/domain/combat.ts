import { getUnit, getEnemy, getStats, UNITS } from '../content/index';
import type { BattleState, CombatInput, CombatUnit as Unit, CombatStatus, DamageType, BattleEventKind, Corpse } from './types';

// The simulation deliberately stores only JSON data. A transaction's queue and
// causal deduplication set exist only while resolving one atomic combat action.
type EventKind = 'BASIC_HIT'|'DIRECT_CRIT'|'DAMAGE_TAKEN'|'EFFECTIVE_HEAL'|'SHIELD_GAIN'|'SHIELD_BREAK'|'TAUNT'|'DASH_END'|'SUMMON'|'ALLY_KO'|'ENEMY_KO'|'CORPSE_CONSUME'|'POISON_TICK';
interface Event {kind:EventKind;source?:Unit;target:Unit;amount?:number;tag?:string;contributors?:string[];corpse?:Corpse}
interface Pending {at:number;source:string;target:string;amount:number;type:DamageType;kind?:BattleEventKind;mode?:'basic'|'direct';cancelOnSourceDeath?:boolean;pauseWithSource?:boolean}
const STEP=.05, EPS=1e-7;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const inc=(u:Unit,k:string,n=1)=>(u.counters[k]=(u.counters[k]||0)+n);
const st=(u:Unit,id:string)=>u.statuses.find(s=>s.id===id);
const stacks=(u:Unit,id:string)=>u.statuses.filter(s=>s.id===id).reduce((n,s)=>n+s.stacks,0);
const spec=(u:Unit,c:'A'|'B')=>u.level>=4&&u.specialization===c;
const key=(u:Unit)=>u.templateId.replace('U_','');
const ratio=(u:Unit)=>u.hp/u.maxHp;
const freshStats=()=>({damage:0,healing:0,shield:0,summons:0,crits:0,poisonDamage:0,explosionDamage:0,kills:0,comboCounts:{},unitStats:{}});
function bare(id:string,templateId:string,name:string,side:'ally'|'enemy'):Unit {
 return {id,templateId,name,side,x:0,y:0,hp:1,maxHp:1,atk:0,armor:0,aps:1,range:1,move:1,critRate:0,critMult:1.5,blockRate:0,blockReduction:0,lifesteal:0,regen:0,damageType:'PHY',shield:0,alive:true,temporary:false,boss:false,rank:1,level:1,specialization:null,action:'idle',facing:side==='ally'?1:-1,statuses:[],attackTimer:0,age:0,counters:{},cooldowns:{},damageDone:0,healingDone:0,shieldGiven:0,kills:0,summons:0};
}
function enemyUnit(s:BattleState,id:string,x:number,y:number,hpScale=1,atkScale=1,temporary=false):Unit {
 const d=getEnemy(id),u=bare('e'+s.nextUnitId++,id,d.name,'enemy');
 Object.assign(u,{hp:d.hp*hpScale,maxHp:d.hp*hpScale,atk:d.atk*atkScale,armor:d.armor,aps:d.aps,range:d.range,move:d.move,x,y,boss:['E05','E10','E15'].includes(id),temporary});
 u.cooldowns.enemySkill=id==='E04'?3:id==='E08'?4:id==='E15'?9:['E05','E09','E10'].includes(id)?8:7;
 u.cooldowns.enemyBuff=10;
 return u;
}
class Engine {
 s:BattleState; queue:Event[]=[];seen=new Set<string>();processing=false;chain=0;
 constructor(s:BattleState){this.s=s}
 random(){let t=this.s.rngState+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);this.s.rngState>>>=0;return ((t^t>>>14)>>>0)/4294967296}
 effect(kind:BattleEventKind,u:{x:number;y:number},v?:Unit,amount?:number,label?:string){this.s.effects.push({id:this.s.nextEffectId++,t:this.s.time,kind,x:u.x,y:u.y,toX:v?.x,toY:v?.y,amount,label,duration:kind==='death'?1.4:kind==='cast'?1.1:.65,sourceId:'id'in u?String(u.id):undefined,targetId:v?.id});if(this.s.effects.length>150)this.s.effects.splice(0,this.s.effects.length-150)}
 mark(id:string,label?:string){this.s.stats.comboCounts[id]=(this.s.stats.comboCounts[id]||0)+1;if(label){this.s.log.push(label);if(this.s.log.length>30)this.s.log.shift()}}
 tx(fn:()=>void){this.chain=++this.s.eventCount;this.seen.clear();fn();let n=0;while(this.queue.length){const e=this.queue.shift()!;this.dispatch(e);if(++n>2048)throw new Error('Combat event cascade exceeded hard bound')}this.seen.clear()}
 emit(e:Event){this.queue.push(e)}
 fire(u:Unit,id:string,cd:number,fn:()=>void,limit=Infinity){const k=u.id+':'+id;if(this.seen.has(k)||(u.cooldowns[id]||0)>EPS||(u.counters['proc:'+id]||0)>=limit)return false;this.seen.add(k);u.cooldowns[id]=cd;inc(u,'proc:'+id);this.mark(u.templateId+':'+id,id==='P'?u.name+' · '+getUnit(u.templateId).primary.name:id==='V'?u.name+' · '+getUnit(u.templateId).passive.name:id.startsWith('R_A')?u.name+'触发遗物 '+id:undefined);fn();return true}
 allies(u:Unit,r=Infinity,origin:{x:number;y:number}=u,formal=true){return this.s.units.filter(v=>v.alive&&v.hp>0&&v.side===u.side&&(!formal||!v.temporary)&&dist(origin,v)<=r+EPS).sort((a,b)=>ratio(a)-ratio(b)||a.id.localeCompare(b.id))}
 enemies(u:Unit,r=Infinity,origin:{x:number;y:number}=u){return this.s.units.filter(v=>v.alive&&v.hp>0&&v.side!==u.side&&dist(origin,v)<=r+EPS).sort((a,b)=>dist(origin,a)-dist(origin,b)||a.id.localeCompare(b.id))}
 corpses(u:Unit,r:number,side?:'ally'|'enemy'){return this.s.corpses.filter(c=>!c.consumed&&(!side||c.side===side)&&dist(u,c)<=r+EPS).sort((a,b)=>dist(u,a)-dist(u,b)||a.id.localeCompare(b.id))}
 clear(u:Unit,id:string,n=Infinity){for(const v of [...u.statuses].filter(v=>v.id===id)){const take=Math.min(n,v.stacks);v.stacks-=take;n-=take;if(v.stacks<=0)u.statuses.splice(u.statuses.indexOf(v),1);if(n<=0)break}}
 status(u:Unit,id:string,duration:number,source:Unit,amount=1,cap=1,tag=id,power=0){
  if(!u.alive||u.hp<=0)return;
  if(id==='WET')this.clear(u,'BURN');
  if(id==='BURN'&&st(u,'WET')){this.clear(u,'WET');this.mark('wet:extinguish');return}
  if(id==='CHILL'){
   if(st(u,'WET')){this.clear(u,'WET');amount++;this.mark('wet:chill')}
   const total=stacks(u,'CHILL')+amount;
   if(total>=3&&!st(u,'FROZEN')&&(u.cooldowns.freezeImmunity||0)<=0){this.clear(u,'CHILL');u.statuses.push({id:'FROZEN',stacks:1,remaining:1.5,sourceId:source.id,power:0});this.effect('freeze',u,undefined,undefined,'封骨');this.mark('chill:freeze');return}
   amount=Math.min(amount,Math.max(0,2-stacks(u,'CHILL')));cap=2;
  }
  if(id==='TAUNTED'){
   if((u.cooldowns.tauntImmunity||0)>0)return;
   const old=st(u,id),changed=!old||old.sourceId!==source.id;const elapsed=old?Number(old.elapsed||0):0;
   this.clear(u,id);u.statuses.push({id,stacks:1,remaining:Math.min(duration,4-elapsed),sourceId:source.id,power:0,elapsed});
   if(changed){this.effect('taunt',source,u);this.emit({kind:'TAUNT',source,target:u})}return;
  }
  if(id==='SOUL_BRAND'||id==='WET'||id==='SHOCK'||id==='REGEN'){this.clear(u,id);u.statuses.push({id,stacks:1,remaining:duration,sourceId:source.id,power,tag});return}
  if(id==='BURN'){const old=st(u,id);if(old&&old.sourceId!==source.id&&old.remaining*(old.power||2)>=duration*(power||2))return;this.clear(u,id);u.statuses.push({id,stacks:1,remaining:duration,sourceId:source.id,power:power||2,tag});this.effect('burn',source,u);return}
  const existing=u.statuses.find(s=>s.id===id&&s.sourceId===source.id&&s.tag===tag),globalCap=id==='POISON'?20:id==='EXPOSED'?5:id==='HASTE'?2:cap;
  const sameStack=id==='POISON'||id==='EXPOSED'||id==='CHILL'||cap>1;
  const others=stacks(u,id)-(existing?.stacks||0),wanted=sameStack?Math.min(cap,(existing?.stacks||0)+amount):Math.min(cap,amount),next=Math.min(wanted,globalCap-others);
  if(existing){existing.stacks=Math.max(0,next);existing.remaining=duration;existing.power=power}else if(next>0)u.statuses.push({id,stacks:next,remaining:duration,sourceId:source.id,power,tag});
  if(id==='POISON')this.effect('poison',source,u,amount);if(id==='HASTE')this.mark('haste:gain');
 }
 shield(source:Unit,target:Unit,amount:number,duration:number,tag:string,localCap=Infinity,accumulate=false){
  if(!target.alive||target.hp<=0||amount<=0)return 0;
  if(target.side==='ally'&&this.has('R_A08'))amount*=1.2;
  const old=target.statuses.find(v=>v.id==='BONE_ARMOR'&&v.sourceId===source.id&&v.tag===tag),oldPower=old?.power||0;
  const next=Math.max(0,Math.min(localCap,accumulate?oldPower+amount:amount,target.maxHp*.6-(target.shield-oldPower)));
  if(old){old.power=next;old.remaining=duration}else if(next>0)target.statuses.push({id:'BONE_ARMOR',stacks:1,remaining:duration,sourceId:source.id,power:next,tag});
  this.sumShield(target);const gain=Math.max(0,next-oldPower);if(gain>0){source.shieldGiven+=gain;if(source.side==='ally')this.s.stats.shield+=gain;this.effect('shield',source,target,gain);this.emit({kind:'SHIELD_GAIN',source,target,amount:gain,tag})}return gain;
 }
 sumShield(u:Unit){u.shield=u.statuses.filter(x=>x.id==='BONE_ARMOR').reduce((n,x)=>n+(x.power||0),0)}
 heal(source:Unit,target:Unit,amount:number,tag='heal'){
  if(!target.alive||target.hp<=0)return 0;const actual=Math.min(amount,target.maxHp-target.hp);if(actual<=EPS)return 0;
  target.hp+=actual;source.healingDone+=actual;if(source.side==='ally')this.s.stats.healing+=actual;this.effect('heal',source,target,actual);this.emit({kind:'EFFECTIVE_HEAL',source,target,amount:actual,tag});return actual;
 }
 damage(source:Unit,target:Unit,amount:number,type:DamageType,mode:'basic'|'direct'|'dot'|'reaction'='direct',kind:BattleEventKind='hit'){
  if(!target.alive||target.hp<=0||amount<=0)return 0;
  const initialBrand=st(target,'SOUL_BRAND'),initialShock=st(target,'SHOCK'),initialWet=!!st(target,'WET');
  if(source.side==='ally')amount*=Number(source.damageMultiplier||1)*Number(this.s.allDamageMultiplier||1);
  amount*=st(source,'ATK_UP')?1+(st(source,'ATK_UP')!.power||.2):1;
  if((mode==='basic'||mode==='direct')&&st(target,'SOUL_BRAND')?.sourceId===source.id)amount*=1.1;
  const crit=mode==='basic'&&this.random()<clamp(source.critRate+(st(source,'ASSASSIN_CRIT')?.power||0),0,.8);if(crit){amount*=source.critMult;kind='crit';if(source.side==='ally')this.s.stats.crits++}
  if(type==='PHY')amount*=100/(100+Math.max(0,target.armor-3*stacks(target,'EXPOSED')));
  if(type!=='TRUE'&&mode!=='dot'&&target.blockRate>0&&this.random()<clamp(target.blockRate,0,.65))amount*=1-clamp(target.blockReduction,0,.7);
  const hadShield=target.shield;let left=amount;
  for(const sh of target.statuses.filter(v=>v.id==='BONE_ARMOR').sort((a,b)=>a.remaining-b.remaining)){const take=Math.min(left,sh.power||0);sh.power=(sh.power||0)-take;left-=take;if(left<=0)break}
  target.statuses=target.statuses.filter(v=>v.id!=='BONE_ARMOR'||(v.power||0)>EPS);this.sumShield(target);
  const actual=Math.min(target.hp,left);target.hp=Math.max(0,target.hp-actual);source.damageDone+=actual;if(source.side==='ally'){this.s.stats.damage+=actual;if(kind==='poison')this.s.stats.poisonDamage+=actual;if(kind==='death')this.s.stats.explosionDamage+=actual}
  target.action='hurt';target.cooldowns.hurt=.15;this.effect(kind,source,target,amount);
  // KO is marked before any shield-break heal can run. No ordinary heal rescues 0 HP.
  if(target.hp<=EPS)this.kill(source,target);
  if(hadShield>0&&target.shield<=EPS)this.emit({kind:'SHIELD_BREAK',source,target});
  if(actual>0)this.emit({kind:'DAMAGE_TAKEN',source,target,amount:actual});
  if(mode==='basic'){this.emit({kind:'BASIC_HIT',source,target,amount:actual});if(crit)this.emit({kind:'DIRECT_CRIT',source,target,amount:actual,tag:initialBrand?'SOUL_BRAND':undefined});if(source.lifesteal>0)this.heal(source,source,actual*Math.min(.3,source.lifesteal),'lifesteal')}
  if((mode==='basic'||mode==='direct')&&initialShock){const owner=this.s.units.find(v=>v.id===initialShock.sourceId)||source;this.clear(target,'SHOCK');this.damage(owner,target,6,'MAG','reaction','lightning');this.mark('shock:consume');if(initialWet){const other=this.enemies(owner,3,target).find(v=>v.id!==target.id);if(other)this.damage(owner,other,4,'MAG','reaction','lightning')}}
  return actual;
 }
 kill(source:Unit,target:Unit){
  if(!target.alive)return;target.alive=false;target.action='dead';target.hp=0;target.shield=0;target.statuses=[];source.kills++;if(source.side==='ally'&&!target.temporary)this.s.stats.kills++;
  let corpse:Corpse|undefined;if(!target.temporary){corpse={id:'c'+target.id,x:target.x,y:target.y,side:target.side,family:target.family,consumed:false,createdAt:this.s.time,templateId:target.templateId};this.s.corpses.push(corpse)}
  this.effect('death',target,undefined,undefined,target.name);this.emit({kind:target.side==='ally'?'ALLY_KO':'ENEMY_KO',source,target,corpse});
 }
 consume(u:Unit,c:Corpse|undefined){if(!c||c.consumed)return false;c.consumed=true;this.effect('bone',c,u,undefined,'尸骸回收');this.emit({kind:'CORPSE_CONSUME',source:u,target:u,corpse:c});this.mark('corpse:consume');return true}
 room(u:Unit,cap:number){return Math.min(12-this.s.units.filter(v=>v.alive&&v.side===u.side&&v.temporary).length,cap-this.s.units.filter(v=>v.alive&&v.ownerId===u.id).length)}
 summon(u:Unit,name:string,hp:number,atk:number,ttl:number,cap:number,armor=0,aps=1.2,range=.7){
  if(this.room(u,cap)<1)return;const v=bare('s'+this.s.nextUnitId++,'SUMMON_'+u.family,name,u.side);Object.assign(v,{family:u.family,x:clamp(u.x+u.facing*.6,1,39),y:clamp(u.y+(this.random()-.5)*1.6,1,11),hp,maxHp:hp,atk,armor,aps,range,move:u.family==='CF'?2:3,temporary:true,ttl,ownerId:u.id});this.s.units.push(v);u.summons++;if(u.side==='ally')this.s.stats.summons++;this.effect('summon',u,v);this.emit({kind:'SUMMON',source:u,target:v});return v;
 }
 dash(u:Unit,target:Unit,max:number,coef:number,limit:number,push=0){
  const ox=u.x,oy=u.y,d=dist(u,target),travel=Math.min(max,Math.max(0,d-.75)),nx=ox+(target.x-ox)/Math.max(d,.01)*travel,ny=oy+(target.y-oy)/Math.max(d,.01)*travel;
  const path=this.enemies(u).filter(v=>{const dx=nx-ox,dy=ny-oy,len=dx*dx+dy*dy,t=clamp(((v.x-ox)*dx+(v.y-oy)*dy)/Math.max(len,.01),0,1);return Math.hypot(v.x-(ox+t*dx),v.y-(oy+t*dy))<=1.35}).slice(0,limit);
  u.x=clamp(nx,.5,39.5);u.y=clamp(ny,.5,11.5);u.action='cast';u.cooldowns.cast=.35;this.effect('dash',{x:ox,y:oy},u,undefined,'冲锋');
  for(const v of path){this.damage(u,v,u.atk*coef,'PHY');if(push&&!v.boss){v.x=clamp(v.x+(nx-ox)/Math.max(travel,.01)*push,.5,39.5);v.y=clamp(v.y+(ny-oy)/Math.max(travel,.01)*push,.5,11.5)}}
  if(travel>=1)this.emit({kind:'DASH_END',source:u,target:u});return travel;
 }
 has(id:string){return this.s.input.relics.includes(id)}
 dispatch(e:Event){
  for(const u of this.s.units.filter(v=>v.alive&&!v.temporary&&v.side==='ally'))this.passive(u,e);
  this.relics(e);
  if(e.kind==='BASIC_HIT'&&e.source?.alive&&!e.source.temporary&&e.source.side==='ally')this.onBasic(e.source,e.target);
  if(e.kind==='SHIELD_BREAK'&&e.target.templateId==='E11'&&e.target.alive&&!(e.target.counters.guardEnrage||0)){e.target.counters.guardEnrage=1;this.status(e.target,'ATK_UP',3,e.target,1,1,'guard',.2)}
 }
 onBasic(u:Unit,hit:Unit){
  const d=getUnit(u.templateId),k=key(u),A=spec(u,'A'),B=spec(u,'B');let nth=Number(d.primary.trigger.match(/每第(\d+)/)?.[1]||3),cd=d.primary.cooldown;
  if(k==='ZM_1'&&B)nth=3;if(k==='HR_1'&&A){nth=2;cd=3}if(k==='HD_1'&&B)nth=5;
  if(k==='ZM_3B'&&B)cd=5;if(k==='HR_3B'&&B)cd=6;if(k==='HD_3A'&&A)cd=2.5;if(k==='BL_1'&&A)cd=3;if(k==='BL_2B'&&B)cd=4;
  u.counters.hits=Math.min(nth,(u.counters.hits||0)+1);if(u.counters.hits<nth)return;
  if((k==='HR_2B'||k==='HR_3B')&&!this.allies(u,k==='HR_2B'?6:8).some(v=>v.hp<v.maxHp-EPS))return;
  const t=hit.alive?hit:this.enemies(u)[0];
  if(this.fire(u,'P',cd,()=>{
   u.counters.hits=0;u.action='cast';u.cooldowns.cast=.3;this.effect('cast',u,undefined,undefined,d.primary.name);
   const enemy=(r:number,n:number,origin:{x:number;y:number}=t||u)=>this.enemies(u,r,origin).slice(0,n);
   const friends=(r:number,n:number,origin:{x:number;y:number}=u)=>this.allies(u,r,origin).slice(0,n);
   const poison=(v:Unit,n:number,duration:number,cap:number)=>this.status(v,'POISON',duration,u,n,cap,'P');
   const shield=(v:Unit,n:number,duration=5)=>this.shield(u,v,n,duration,'P');
   const heal=(v:Unit,n:number)=>this.heal(u,v,n,'P');
   switch(k){
    case 'SK_1':{const v=A?friends(2,1)[0]:u;if(v)shield(v,u.maxHp*(B?.08:.12));break}
    case 'SK_2A':shield(u,u.maxHp*(A?.12:B?.26:.18));for(const v of enemy(3,A?4:B?1:2,u))this.status(v,'TAUNTED',2,u);break;
    case 'SK_2B':if(t){this.damage(u,t,u.atk*(A?.5:.9),'PHY');this.status(t,'EXPOSED',5,u,1,A?5:3,'P')}break;
    case 'SK_3A':for(const v of this.allies(u,4).sort((a,b)=>a.shield-b.shield).slice(0,A?1:3))shield(v,u.atk*(A?2.6:.9));break;
    case 'SK_3B':if(t){this.damage(u,t,u.atk*(A?1.2:1.7),'PHY');if(A||st(t,'EXPOSED'))this.damage(u,t,u.atk*.4,'TRUE')}break;
    case 'SK_4':for(const v of this.allies(u).sort((a,b)=>a.shield-b.shield).slice(0,A?6:B?2:4))shield(v,v.maxHp*(A?.12:.15),6);break;
    case 'ZM_1':if(t)poison(t,A?2:1,A?4:6,3);break;
    case 'ZM_2A':for(const v of A?(t?[t]:[]):enemy(2,3))poison(v,A?4:2,A?7:6,4);break;
    case 'ZM_2B':for(const v of friends(4,A?1:2))heal(v,u.atk*(A?2.4:B?.75:1));break;
    case 'ZM_3A':for(const v of enemy(A?4:3,A?6:B?2:4))poison(v,B?4:2,6,5);break;
    case 'ZM_3B':if(t){const n=Math.min(stacks(t,'POISON'),A?1:B?5:3);this.clear(t,'POISON',n);this.damage(u,t,u.atk*(1+n*(A?.8:.4)),'MAG');if(n)this.mark('poison:cashout')}break;
    case 'ZM_4':for(const v of friends(5,B?1:3))heal(v,u.atk*(A?1.6:1));for(const v of enemy(5,B?5:3,u))poison(v,A?1:B?3:2,6,5);break;
    case 'HR_1':if(t){const target=this.enemies(u,6).find(v=>dist(u,v)>=2)||t;this.dash(u,target,B?4:6,A?.55:B?1.3:.8,2)}break;
    case 'HR_2A':{const target=this.enemies(u,8).filter(v=>dist(u,v)>=2).at(-1)||t;if(target)this.dash(u,target,8,A?2.4:B?.85:1.2,A?1:B?5:3);break}
    case 'HR_2B':{const v=friends(6,1)[0];if(v){this.dash(u,v,6,0,0);heal(v,u.atk*(A?.9:B?.8:1.3));if(A)shield(v,u.atk*.7,4);if(B){const other=friends(2,8).find(w=>w.id!==v.id&&w.hp<w.maxHp);if(other)heal(other,u.atk*.8)}}break}
    case 'HR_3A':{const target=this.enemies(u,9).filter(v=>dist(u,v)>=2).sort((a,b)=>ratio(a)-ratio(b))[0]||t;if(target)this.dash(u,target,9,A?1.5:B?.8:1.1,B?6:4,A?0:1.5);break}
    case 'HR_3B':{const v=this.allies(u,8).filter(v=>v.hp<v.maxHp).sort((a,b)=>dist(u,b)-dist(u,a))[0];if(v){this.dash(u,v,8,0,0);for(const w of A?[v]:friends(3,3))heal(w,u.atk*(A?2.6:1))}break}
    case 'HR_4':{const target=this.enemies(u,10).filter(v=>dist(u,v)>=2).at(-1)||t;if(target)this.dash(u,target,10,A?2:B?.9:1.3,5);break}
    case 'HD_1':if(t){this.damage(u,t,u.atk*(A?.35:.45),'PHY');for(let i=1;i<(A?3:2);i++)this.pending({at:this.s.time+i*.15,source:u.id,target:t.id,amount:u.atk*(A?.35:.45),type:'PHY',cancelOnSourceDeath:true,pauseWithSource:true})}break;
    case 'HD_2A':for(let i=0;i<(A?2:1);i++)this.summon(u,'临时骨指',A?22:B?50:30,A?4:B?8:5,8,B?2:3);break;
    case 'HD_2B':if(t){this.damage(u,t,u.atk*(A?.5:.8),'MAG','direct','lightning');this.status(t,'WET',A?8:5,u);this.status(t,'SHOCK',4,u)}break;
    case 'HD_3A':{const cap=B?2:4,c=this.corpses(u,5)[0],extra=!A&&this.room(u,cap)>=2&&c&&this.consume(u,c);for(let i=0;i<(extra?2:1);i++)this.summon(u,'临时骨指',B?65:35,B?11:7,10,cap);break}
    case 'HD_3B':if(t){this.status(t,'SOUL_BRAND',5,u);const execute=ratio(t)<(A?.45:.3);this.damage(u,t,u.atk*(execute?(A?1.45:B?1.4:1.7):(B?.8:1.1)),'PHY')}break;
    case 'HD_4':for(let i=0;i<(B?3:2);i++)this.summon(u,'临时骨掌',A?90:B?35:55,A?16:B?7:10,10,A?2:B?6:4,3,1,1);break;
    case 'BL_1':for(const v of friends(5,1))heal(v,u.atk*(A?2.1:1.5));break;
    case 'BL_2A':{const v=friends(5,1)[0];if(v){let most:Unit|undefined,max=0;for(const w of A?[v]:friends(3,B?5:3,v)){const n=heal(w,u.atk*(A?2.8:B?.65:.95));if(n>max){max=n;most=w}}if(most)this.fire(u,'V',3,()=>this.status(most!,'HASTE',B?2:3,u,1,1,'V'))}break}
    case 'BL_2B':for(const v of A?(t?[t]:[]):enemy(2,B?4:2)){this.damage(u,v,u.atk*(A?.5:.7),'MAG','direct','freeze');this.status(v,'CHILL',4,u,A?2:1,2,'P')}break;
    case 'BL_3A':for(const v of friends(6,A?1:B?6:3)){heal(v,u.atk*(A?2.4:B?.65:1));this.status(v,'HASTE',B?3:4,u,A?2:1,A?2:1,'P')}break;
    case 'BL_3B':for(const v of A?(t?[t]:[]):enemy(3,B?5:3)){this.damage(u,v,u.atk*(A?2.4:B?.7:1),'MAG','direct','lightning');if(st(v,'WET'))this.status(v,'SHOCK',4,u)}break;
    case 'BL_4':for(const v of friends(Infinity,B?2:4))if(heal(v,u.atk*(A?1.6:1.1))>0)shield(v,u.atk*.6,4);break;
    case 'CF_1':shield(u,u.maxHp*(A?.22:.15));break;
    case 'CF_2A':for(let i=0;i<(B?2:1);i++)this.summon(u,'临时棺仆',A?110:B?40:60,A?12:B?5:7,10,A?1:2,4,.8,1);break;
    case 'CF_2B':for(const v of A?(t?[t]:[]):enemy(B?3:2,B?5:3)){this.damage(u,v,u.atk*(A?1.9:B?.55:.8),'MAG','direct','burn');this.status(v,'BURN',A?8:5,u,1,1,'P',2)}break;
    case 'CF_3A':shield(u,u.maxHp*(A?.35:B?.12:.22),6);for(const v of enemy(3,A?1:3,u))this.status(v,'TAUNTED',2.5,u);if(B)for(const v of friends(3,3).filter(v=>v.id!==u.id).slice(0,2))shield(v,u.atk,6);break;
    case 'CF_3B':{const targets=enemy(3,B?1:3);u.lastPrimaryTargets=targets.map(v=>v.id);const used=!A&&this.consume(u,this.corpses(u,6)[0]);for(const v of targets)this.damage(u,v,u.atk*(A?1.3:B?(used?3:1.8):(used?1.8:1)),'MAG','direct','death');break}
    case 'CF_4':{const cap=A?2:B?5:3,c=this.corpses(u,6)[0],extra=!A&&c&&this.room(u,cap)>=(B?3:2)&&this.consume(u,c);for(let i=0;i<(extra?(B?3:2):1);i++)this.summon(u,'临时棺卫',A?150:B?65:90,A?20:B?8:12,12,cap,8,.8,1.2);break}
   }
  }))this.mark(u.templateId+':primary');
 }
 passive(u:Unit,e:Event){
  const k=key(u),A=spec(u,'A'),B=spec(u,'B'),d=getUnit(u.templateId),self=e.source?.id===u.id,received=e.target.id===u.id,ally=e.target.side===u.side,formal=!e.target.temporary;
  let cd=d.passive.cooldown;if(k==='SK_2B'&&B)cd=4;if(k==='SK_3A'&&B)cd=2.5;if(k==='ZM_2A'&&B)cd=3;if(k==='CF_1'&&B)cd=3;
  const fire=(fn:()=>void)=>this.fire(u,'V',cd,fn);
  const enemies=(r:number,n:number,origin:{x:number;y:number}=u)=>this.enemies(u,r,origin).slice(0,n);
  const friends=(r:number,n:number,origin:{x:number;y:number}=u)=>this.allies(u,r,origin).slice(0,n);
  const heal=(v:Unit,n:number)=>this.heal(u,v,n,'V');const shield=(v:Unit,n:number,dur=4,cap=Infinity,acc=false)=>this.shield(u,v,n,dur,'V',cap,acc);
  if(e.kind==='SHIELD_BREAK'&&ally&&formal){
   if(k==='SK_1'&&received)fire(()=>{const v=enemies(2,1)[0];if(v)this.damage(u,v,u.atk*(B?1.1:.6),'PHY','reaction')});
   if(k==='SK_3A'&&dist(u,e.target)<=4)fire(()=>{const v=enemies(2,1,e.target)[0];if(v)for(const w of B?enemies(2,3,v):[v])this.damage(u,w,u.atk*(B?.6:1),'PHY','reaction')});
   if(k==='SK_4')fire(()=>{for(const v of enemies(3,2,e.target))this.damage(u,v,u.atk*(A?.7:B?1.7:1),'PHY','reaction')});
   if(k==='BL_3A'&&dist(u,e.target)<=6)fire(()=>heal(e.target,u.atk*.6));
  }
  if(e.kind==='TAUNT'&&self&&k==='SK_2A')fire(()=>heal(u,u.maxHp*.04));
  if(e.kind==='DIRECT_CRIT'&&self){
   if(k==='SK_2B')fire(()=>{const v=friends(3,1)[0];if(v)shield(v,u.atk*(B?1.1:.7))});
   if(k==='HD_2B')fire(()=>{for(const v of enemies(2,B?3:2,e.target).filter(v=>v.id!==e.target.id).slice(0,B?2:1)){this.damage(u,v,u.atk*(B?.4:.6),'MAG','direct','lightning');if(st(v,'WET'))this.status(v,'SHOCK',4,u)}});
   if(k==='HD_3B'&&(e.tag==='SOUL_BRAND'||st(e.target,'SOUL_BRAND')))fire(()=>heal(u,u.atk*(B?1.2:.8)));
   if(k==='BL_3B')fire(()=>{if(st(e.target,'WET'))this.damage(u,e.target,u.atk*.6,'MAG','direct','lightning');else this.status(e.target,'WET',5,u)});
  }
  if(e.kind==='EFFECTIVE_HEAL'&&ally&&formal){
   if(k==='ZM_1'&&received)fire(()=>shield(u,(e.amount||0)*(B?.6:.3),3,u.maxHp*(B?.15:.1)));
   if(k==='ZM_2B'&&self&&e.tag==='P')fire(()=>{for(const v of enemies(2,B?3:1,e.target))this.status(v,'POISON',5,u,1,1,'V')});
   if(k==='ZM_4'&&dist(u,e.target)<=5)fire(()=>{const v=enemies(2,1,e.target)[0];if(v)this.damage(u,v,Math.min((e.amount||0)*.4,u.atk*1.5),'MAG')});
   if(k==='BL_1'&&self&&e.tag==='P')fire(()=>{const v=B?friends(2,8,e.target).find(v=>v.id!==e.target.id):e.target;if(v)shield(v,(e.amount||0)*(B?.5:.25),3)});
  }
  if(e.kind==='POISON_TICK'){
   if(k==='ZM_2A'&&e.contributors?.includes(u.id)){const v=enemies(2,99,e.target).filter(v=>!st(v,'POISON')).slice(0,B?2:1);if(v.length)fire(()=>{for(const w of v)this.status(w,'POISON',4,u,1,1,'V')})}
   if(k==='ZM_3B'&&dist(u,e.target)<=5)fire(()=>{const v=friends(5,1)[0];if(v)heal(v,u.atk*.35)});
  }
  if(e.kind==='ENEMY_KO'&&!e.target.temporary){
   if(k==='SK_3B'&&self)fire(()=>{shield(u,u.atk*(B?.55:1),5);for(const v of friends(3,8).filter(v=>v.id!==u.id).slice(0,B?3:1))shield(v,u.atk*(B?.55:1),5)});
   if(k==='ZM_3A'&&dist(u,e.target)<=6&&this.corpses(u,6).length)fire(()=>{if(this.consume(u,this.corpses(u,6)[0])){heal(u,u.maxHp*.12);for(const v of enemies(3,2))this.status(v,'POISON',5,u,1,1,'V')}});
   if(k==='HD_1'&&dist(u,e.target)<=3)fire(()=>heal(u,u.maxHp*(A?.04:B?.1:.06)));
   if(k==='BL_2B'&&dist(u,e.target)<=6){const v=enemies(3,1,e.target)[0];if(v)fire(()=>this.status(v,'CHILL',4,u,1,2,'V'))}
   if(k==='CF_1'&&dist(u,e.target)<=3&&this.corpses(u,3).length)fire(()=>{if(this.consume(u,this.corpses(u,3)[0]))heal(u,u.maxHp*(B?.07:.1))});
  }
  if(e.kind==='DASH_END'&&self){
   if(k==='HR_1')fire(()=>{for(const v of enemies(2,1))this.status(v,'EXPOSED',4,u,1,1,'V')});
   if(k==='HR_2A')fire(()=>{for(const v of enemies(2,2))this.status(v,'EXPOSED',5,u,1,2,'V')});
   if(k==='HR_2B')fire(()=>{for(const v of enemies(2,2))this.status(v,'CHILL',4,u,1,2,'V')});
   if(k==='HR_3A')fire(()=>{for(const v of enemies(3,3))this.status(v,'EXPOSED',5,u,1,1,'V');shield(u,u.maxHp*.12)});
   if(k==='HR_3B')fire(()=>{for(const v of friends(3,B?6:3))this.status(v,'HASTE',B?2:4,u,1,1,'V')});
   if(k==='HR_4')fire(()=>{for(const v of A?[u]:friends(4,B?5:3)){heal(v,u.atk*(B?1.1:.9));shield(v,u.atk*(B?1.1:.9))}});
  }
  if(e.kind==='SUMMON'&&self&&k==='HD_3A')fire(()=>shield(u,u.maxHp*.05,4,u.maxHp*.15,true));
  if(e.kind==='ALLY_KO'&&ally){
   if(k==='HD_2A'&&e.target.ownerId===u.id)fire(()=>this.status(u,'HASTE',4,u,1,2,'V'));
   if(k==='HD_4'&&e.target.ownerId===u.id)fire(()=>{const v=enemies(3,99,e.target).sort((a,b)=>ratio(a)-ratio(b))[0];if(v){this.status(v,'SOUL_BRAND',5,u);this.damage(u,v,u.atk*1.1,'MAG','direct','death')}});
   if(k==='BL_4'&&dist(u,e.target)<=8&&!u.counters['mourn:'+e.target.id]){u.counters['mourn:'+e.target.id]=1;fire(()=>{for(const v of enemies(3,3,e.target)){this.status(v,'SOUL_BRAND',6,u);if(!A)this.damage(u,v,u.atk*(B?1.5:.8),'MAG','direct','death')}})}
   if(k==='CF_2A'&&e.target.ownerId===u.id)fire(()=>shield(u,u.maxHp*.12,5));
   if(k==='CF_3A'&&formal&&dist(u,e.target)<=4&&e.corpse&&!e.corpse.consumed)fire(()=>{if(this.consume(u,e.corpse))for(const v of friends(4,2))heal(v,u.atk)});
  }
  if(e.kind==='CORPSE_CONSUME'&&e.source?.side===u.side){
   if(k==='CF_2B'&&dist(u,e.source)<=5)fire(()=>this.status(u,'HASTE',4,u,1,1,'V'));
   if(k==='CF_3B'&&self&&!A)fire(()=>{const hits=(u.lastPrimaryTargets||[]) as string[];const v=this.enemies(u).find(v=>hits.includes(v.id));if(v)this.status(v,'SOUL_BRAND',6,u)});
   if(k==='CF_4'&&dist(u,e.source)<=6)fire(()=>{for(const v of this.allies(u,6).sort((a,b)=>a.shield-b.shield).slice(0,3))shield(v,u.atk*.8,5)});
  }
 }
 pending(p:Pending){(this.s.pending as Pending[]).push(p)}
 relics(e:Event){
  const a=e.source,v=e.target,formal=!v.temporary,ally=v.side==='ally',owner=this.s.units.find(u=>u.side==='ally'&&!u.temporary);if(!owner)return;
  const global=(id:string,cd:number,limit:number,fn:()=>void)=>{if(this.has(id))this.fire(owner,id,cd,fn,limit)};
  const per=(u:Unit,id:string,cd:number,limit:number,fn:()=>void)=>{if(this.has(id))this.fire(u,id,cd,fn,limit)};
  if(e.kind==='ALLY_KO'&&ally){
   inc(owner,'relicDeaths');if(owner.counters.relicDeaths%2===0)global('R_A01',1,6,()=>{const w=this.allies(owner,Infinity,owner,false)[0];if(w)this.heal(owner,w,4,'R_A01')});
   global('R_A14',1,6,()=>{for(const w of this.enemies(owner,1.8,v))this.damage(owner,w,4,'MAG','reaction','death')});
   if(formal)global('R_A18',0,2,()=>{const echo=this.summon(owner,'亡灵残影',v.maxHp*.2,v.atk*.3,6,12,0,.8,1.2);if(echo){echo.x=v.x;echo.y=v.y;echo.move=2;echo.family=v.family}});
  }
  if(e.kind==='SUMMON'&&ally)global('R_A02',.5,6,()=>this.status(v,'HASTE',4,owner,1,1,'R_A02'));
  if(e.kind==='CORPSE_CONSUME'&&a?.side==='ally'&&!a.temporary&&this.has('R_A03')&&(owner.counters.R_A03total||0)<8)per(a,'R_A03',1,8,()=>{inc(owner,'R_A03total');this.heal(a,a,6,'R_A03')});
  if(e.kind==='BASIC_HIT'&&a?.side==='ally'&&!a.temporary){
   if(inc(a,'relicHits')%3===0)per(a,'R_A04',1,8,()=>this.status(v,'POISON',4,a,1,1,'R_A04'));
   if(st(v,'CHILL')||st(v,'FROZEN'))per(a,'R_A16',.5,10,()=>this.damage(a,v,2,'MAG','reaction'));
   if(st(v,'WET'))per(a,'R_A17',3,3,()=>this.status(v,'SHOCK',5,a));
   if((a.counters.firstPoisonHits||0)>0){a.counters.firstPoisonHits--;this.status(v,'POISON',6,a,1,3,'prepPoison')}
  }
  if(e.kind==='POISON_TICK'&&!ally&&inc(v,'relicPoisonTicks')%3===0){const w=this.enemies(owner,3,v).find(w=>!st(w,'POISON'));if(w)global('R_A05',2,4,()=>this.status(w,'POISON',4,owner,1,1,'R_A05'))}
  if(e.kind==='EFFECTIVE_HEAL'&&ally){
   if(st(v,'POISON'))per(v,'R_A06',2,6,()=>this.clear(v,'POISON',1));
   if(inc(v,'relicHeals')%3===0)per(v,'R_A15',2,4,()=>this.shield(v,v,4,4,'R_A15'));
  }
  if(e.kind==='SHIELD_BREAK'&&ally)per(v,'R_A07',3,3,()=>this.heal(v,v,4,'R_A07'));
  if(e.kind==='DAMAGE_TAKEN'&&ally&&formal&&a?.side==='enemy'){
   inc(v,'relicDamage',e.amount);if(v.counters.relicDamage>=10)per(v,'R_A09',2,4,()=>{v.counters.relicDamage-=10;this.shield(v,v,3,4,'R_A09')});
  }
  if(e.kind==='TAUNT'&&a?.side==='ally')per(v,'R_A10',4,3,()=>this.status(v,'EXPOSED',4,a,5,5,'R_A10'));
  if(e.kind==='DASH_END'&&a?.side==='ally')per(a,'R_A11',3,4,()=>{for(const w of this.enemies(a,1.5))this.damage(a,w,6,'PHY','reaction')});
  if(e.kind==='ENEMY_KO'&&!v.temporary&&a?.side==='ally')per(a,'R_A12',2,4,()=>this.status(a,'HASTE',4,a,1,1,'R_A12'));
  if(e.kind==='DIRECT_CRIT'&&a?.side==='ally'&&!a.temporary)per(a,'R_A13',.75,6,()=>this.heal(a,a,a.maxHp*.02,'R_A13'));
 }
 commands(){
  const seen=this.s.commands as Record<string,boolean>;
  this.s.input.buffs.forEach((b,i)=>{const id=(b.source||'index:'+i)+':'+b.type+':'+(b.uid||b.family||'global');if(seen[id])return;seen[id]=true;
   const selected=this.s.units.filter(u=>u.side==='ally'&&!u.temporary&&(!b.uid||u.sourceUid===b.uid)&&(!b.family||u.family===b.family));
   for(const u of selected){
    if(b.type==='openingShield')this.shield(u,u,b.value,6,id);
    if(b.type==='openingMove')this.status(u,'MOVE_UP',6,u,1,1,id,b.value);
    if(b.type==='damageMultiplier')u.damageMultiplier=Number(u.damageMultiplier||1)*(1+b.value);
    if(b.type==='firstHalfRegen')u.counters.firstHalfRegen=b.value;
    if(b.type==='poisonFirstHits')u.counters.firstPoisonHits=b.value;
    if(b.type==='allyMaxHpMultiplier'){u.maxHp*=b.value;u.hp*=b.value}
    if(b.type==='itemHeal')this.heal(u,u,b.value,'itemHeal');
    if(b.type==='itemCorpseExplosion'&&u.alive){const c=this.corpses(u,Infinity)[0];if(c&&this.consume(u,c)){for(const v of this.enemies(u,3,c))this.damage(u,v,b.value,'MAG','direct','death');this.mark('item:corpseExplosion')}}
   }
   if(b.type==='phylacteryBarrier')this.s.phylacteryBarrier=Number(this.s.phylacteryBarrier||0)+b.value;
   if(b.type==='enemyAttackSpeedMultiplier')for(const u of this.s.units.filter(v=>v.side==='enemy'))u.aps*=b.value;
   if(b.type==='allDamageMultiplier')this.s.allDamageMultiplier=Number(this.s.allDamageMultiplier||1)*b.value;
  });
 }
 enemySkill(u:Unit){
  const id=u.templateId;
  const t=id==='E09'?this.enemies(u,6.5).sort((a,b)=>this.enemies(u,1.3,b).length-this.enemies(u,1.3,a).length||dist(u,a)-dist(u,b)||a.id.localeCompare(b.id))[0]:this.enemies(u)[0];if(!t)return;
  if(id==='E05'||id==='E15')for(const threshold of [.7,.35])if(ratio(u)<threshold&&!u.counters['reinforcement'+threshold]){
   u.counters['reinforcement'+threshold]=1;const child=enemyUnit(this.s,id==='E05'?'E01':'E11',clamp(u.x+1,1,39),clamp(u.y+(threshold===.7?-1:1)*1.5,1,11),1,1,true);child.ownerId=u.id;this.s.units.push(child);if(child.templateId==='E11')this.shield(child,child,80,999,'entry');this.effect('summon',u,child);this.mark('enemy:reinforcement');
  }
  if(id==='E15'&&ratio(u)<.35&&!u.counters.rage){u.counters.rage=1;u.aps*=1.15;this.effect('cast',u,undefined,undefined,'王权末路')}
  if((u.cooldowns.enemyBuff||0)<=0){
   if(id==='E10'){for(const v of this.allies(u,Infinity,u,false).filter(v=>v.id!==u.id).sort((a,b)=>dist(u,a)-dist(u,b)).slice(0,2))this.status(v,'ATK_UP',4,u,1,1,'leader',.2);u.cooldowns.enemyBuff=10;this.effect('cast',u,undefined,undefined,'征税号令');this.mark(id+':buff')}
   if(id==='E13'){for(const v of this.allies(u,5,u,false).sort((a,b)=>dist(u,a)-dist(u,b)).slice(0,2))this.status(v,'HASTE',4,u,1,1,'chant');u.cooldowns.enemyBuff=10;this.effect('cast',u,undefined,undefined,'颂歌');this.mark(id+':buff')}
  }
  if((u.cooldowns.enemySkill||0)>0)return;
  if(['E04','E08','E13'].includes(id)){
   const v=this.allies(u,id==='E13'?Infinity:6,u,false)[0];if(v&&v.hp<v.maxHp){this.heal(u,v,id==='E04'?18:id==='E08'?32:50,'enemy');if(id==='E08')this.shield(u,v,20,4,'enemy');this.effect('cast',u,v,undefined,'救护祷言');this.mark(id+':skill')}u.cooldowns.enemySkill=id==='E04'?6:7;return;
  }
  if(id==='E12'){if(t.shield>0){let left=40;for(const sh of t.statuses.filter(v=>v.id==='BONE_ARMOR')){const n=Math.min(left,sh.power||0);sh.power=(sh.power||0)-n;left-=n}t.statuses=t.statuses.filter(v=>v.id!=='BONE_ARMOR'||(v.power||0)>EPS);this.sumShield(t);this.effect('shieldBreak',u,t,40,'净骨');this.mark(id+':skill')}u.cooldowns.enemySkill=7;return}
  if(id==='E14'){this.damage(u,t,u.atk*.9,'MAG','direct','lightning');const v=this.enemies(u,1.8,t).find(v=>v.id!==t.id);if(v)this.damage(u,v,u.atk*.6,'MAG','direct','lightning');u.cooldowns.enemySkill=7;this.mark(id+':skill');return}
  if(['E05','E09','E10','E15'].includes(id)){
   const duration=id==='E15'?1.2:1;u.cast={at:this.s.time+duration,x:t.x,y:t.y,targetId:t.id};u.cooldowns.enemySkill=id==='E15'?9:8;u.cooldowns.cast=duration;u.action='cast';this.effect('cast',u,t,undefined,id==='E09'?'火油落点':'蓄力重击');this.mark(id+':telegraph');
  }
 }
 finishCast(u:Unit){
  const cast=u.cast as {at:number;x:number;y:number;targetId:string}|undefined;if(!cast||cast.at>this.s.time+EPS)return;
  u.cast=undefined;const id=u.templateId,origin=id==='E09'?cast:u,targets=this.enemies(u,id==='E09'?1.3:id==='E05'?u.range+1.5:id==='E15'?2.8:2.6,origin).slice(0,id==='E05'?2:3);
  for(const v of targets){this.damage(u,v,u.atk*(id==='E09'?.5:id==='E05'?1.3:1.4),id==='E09'?'MAG':'PHY', 'direct',id==='E09'?'burn':'hit');if(id==='E09')this.status(v,'BURN',4,u,1,1,'oil',2)}this.mark(id+':skill');
 }
 statusTick(u:Unit,dt:number){
  // Resolve a final tick on an exact expiry boundary, then remove the status.
  if((u.cooldowns.tick||0)<=EPS){
   u.cooldowns.tick=1;
   if(u.regen>0)this.heal(u,u,u.maxHp*u.regen,'regen');if(st(u,'REGEN'))this.heal(u,u,u.maxHp*.02,'regen');
   if(this.s.time<=this.s.timeLimit/2&&(u.counters.firstHalfRegen||0)>0)this.heal(u,u,u.counters.firstHalfRegen,'prepRegen');
   const poison=u.statuses.filter(v=>v.id==='POISON'),contributors:string[]=[];let actual=0;
   for(const p of poison){const source=this.s.units.find(v=>v.id===p.sourceId);if(source){const n=this.damage(source,u,p.stacks*.6,'MAG','dot','poison');actual+=n;if(n>0)contributors.push(source.id)}}
   if(actual>0)this.emit({kind:'POISON_TICK',target:u,amount:actual,contributors:[...new Set(contributors)]});
   const burn=st(u,'BURN'),source=burn&&this.s.units.find(v=>v.id===burn.sourceId);if(burn&&source)this.damage(source,u,burn.power||2,'MAG','dot','burn');
  }
  for(const s of u.statuses){s.remaining-=dt;if(s.id==='TAUNTED')s.elapsed=Number(s.elapsed||0)+dt}
  for(const s of u.statuses.filter(v=>v.remaining<=EPS)){if(s.id==='FROZEN')u.cooldowns.freezeImmunity=3;if(s.id==='TAUNTED'&&Number(s.elapsed||0)>=4-EPS)u.cooldowns.tauntImmunity=2}
  u.statuses=u.statuses.filter(s=>s.remaining>EPS&&!(s.id==='TAUNTED'&&!this.s.units.find(v=>v.id===s.sourceId&&v.alive)));this.sumShield(u);
 }
 assassin(u:Unit){
  if(u.templateId!=='U_HD_3B'||(u.cooldowns.blink||0)>0)return;
  const t=this.enemies(u).sort((a,b)=>b.range-a.range||b.x-a.x)[0];if(!t)return;
  const ox=u.x,oy=u.y;u.x=clamp(t.x+.85,.5,39.5);u.y=clamp(t.y+.3,.5,11.5);u.targetId=t.id;u.cooldowns.blink=7;u.cooldowns.cast=.3;u.action='cast';this.status(u,'ASSASSIN_CRIT',2.5,u,1,1,'blink',.4);this.effect('dash',{x:ox,y:oy},u,undefined,'切入后排');this.status(t,'SOUL_BRAND',5,u);this.mark('U_HD_3B:blink');
 }
 advance(dt:number){
  this.s.time=+(this.s.time+dt).toFixed(6);
  this.tx(()=>this.commands());
  for(const p of [...this.s.pending as Pending[]]){
   const u=this.s.units.find(v=>v.id===p.source),t=this.s.units.find(v=>v.id===p.target);
   // Aim and unfinished melee combinations are not yet projectiles in flight.
   // Freeze suspends their remaining preparation; an actual launched impact would
   // omit pauseWithSource and continue resolving normally.
   if(p.pauseWithSource&&u?.alive){if(st(u,'FROZEN'))p.at+=dt;u.cooldowns.cast=Math.max(u.cooldowns.cast||0,p.at-this.s.time+dt)}
   if(p.at>this.s.time+EPS)continue;
   (this.s.pending as Pending[]).splice((this.s.pending as Pending[]).indexOf(p),1);
   if(u&&t?.alive&&(!p.cancelOnSourceDeath||u.alive))this.tx(()=>{if(p.kind==='projectile')this.effect('projectile',u,t);this.damage(u,t,p.amount,p.type,p.mode||'direct',p.kind==='projectile'?'hit':p.kind)})
  }
  for(const u of [...this.s.units]){
   for(const k of Object.keys(u.cooldowns))u.cooldowns[k]=Math.max(0,u.cooldowns[k]-dt);if(!u.alive)continue;u.age+=dt;
   if(u.temporary&&u.ttl!==undefined&&u.age>=u.ttl){u.alive=false;u.hp=0;u.shield=0;u.statuses=[];u.action='dead';this.effect('death',u,undefined,undefined,'临时契约到期');continue}
   this.tx(()=>this.statusTick(u,dt));if(!u.alive)continue;
   if(st(u,'FROZEN')){const cast=u.cast as {at:number}|undefined;if(cast){cast.at+=dt;u.cooldowns.cast=Math.max(u.cooldowns.cast||0,cast.at-this.s.time)}u.action='idle';continue}
   this.tx(()=>this.finishCast(u));
   if(u.side==='ally')this.tx(()=>this.assassin(u));else this.tx(()=>this.enemySkill(u));
   if((u.cooldowns.cast||0)>0){u.action='cast';continue}
   const taunt=st(u,'TAUNTED'),forced=taunt&&this.s.units.find(v=>v.id===taunt.sourceId&&v.alive),previous=this.s.units.find(v=>v.id===u.targetId&&v.alive&&v.side!==u.side),nearest=this.enemies(u)[0];
   const summonTarget=u.templateId==='E12'?this.enemies(u,u.range+.25).find(v=>v.temporary):undefined;
   const backlineTarget=u.templateId==='E07'&&((u.counters.attacks||0)+1)%3===0?this.enemies(u,u.range+.25).find(v=>!v.temporary&&v.range>=4):undefined;
   const t=forced||summonTarget||backlineTarget||(u.templateId==='U_HD_3B'&&previous?previous:nearest);if(!t){u.action='idle';continue}u.targetId=t.id;u.facing=t.x>=u.x?1:-1;
   const distance=dist(u,t),chill=1-.08*stacks(u,'CHILL');
   u.attackTimer=Math.max(0,u.attackTimer-dt);
   if(distance>u.range+.25){
    u.action='move';const speed=u.move*chill*(1+(st(u,'MOVE_UP')?.power||0)),move=Math.min(speed*dt,Math.max(0,distance-u.range));u.x=clamp(u.x+(t.x-u.x)/distance*move,.4,39.6);u.y=clamp(u.y+(t.y-u.y)/distance*move,.4,11.6);
   }else if(u.attackTimer<=EPS){
    const aps=Math.min(4,u.aps*(1+.15*stacks(u,'HASTE'))*chill);u.attackTimer=1/Math.max(.1,aps);u.action='attack';u.cooldowns.attack=.2;
    this.tx(()=>{let mult=1;const n=inc(u,'attacks'),charged=u.templateId==='E03'&&n%4===0,aimed=u.templateId==='E07';if(charged)mult=1.5;if(aimed&&t.shield>0)mult=1.25;if(u.templateId==='E12'&&t.temporary)mult=1.3;
     if(charged||aimed){const delay=aimed?.5:.6;u.cooldowns.cast=delay;u.action='cast';this.effect('cast',u,t,undefined,charged?'蓄力箭':'弩手瞄准');this.pending({at:this.s.time+delay,source:u.id,target:t.id,amount:u.atk*mult,type:u.damageType,mode:'basic',kind:'projectile',cancelOnSourceDeath:true,pauseWithSource:true});this.mark(u.templateId+':skill')}
     else{if(u.range>3)this.effect('projectile',u,t);this.damage(u,t,u.atk*mult,u.damageType,'basic')}
     if(u.templateId==='E06'&&n%3===0){const other=this.enemies(u,1.4,t).find(v=>v.id!==t.id);if(other){this.damage(u,other,u.atk*.6,'PHY');this.mark('E06:skill')}}
    });
   }else if((u.cooldowns.attack||0)<=0&&(u.cooldowns.hurt||0)<=0)u.action='idle';
  }
  // Soft separation prevents overlapping actors while retaining continuous motion.
  const living=this.s.units.filter(v=>v.alive);for(let i=0;i<living.length;i++)for(let j=i+1;j<living.length;j++){const a=living[i],b=living[j];if(a.side!==b.side)continue;const d=dist(a,b);if(d<.6){const dy=d<.01?(i%2?-.02:.02):(a.y-b.y)/d*.025;a.y=clamp(a.y+dy,.4,11.6);b.y=clamp(b.y-dy,.4,11.6)}}
  this.finish();this.syncStats();
 }
 syncStats(){for(const u of this.s.units.filter(v=>v.side==='ally'))this.s.stats.unitStats[u.sourceUid||u.id]={name:u.name,damage:u.damageDone,healing:u.healingDone,shield:u.shieldGiven,kills:u.kills,summons:u.summons}}
 finish(){
  const enemies=this.s.units.filter(v=>v.alive&&v.side==='enemy'),allies=this.s.units.filter(v=>v.alive&&v.side==='ally');
  if(!enemies.length){this.s.result='win';this.s.log.push('守军已肃清');this.s.log=this.s.log.slice(-30);return}
  if(!allies.length||this.s.time>=this.s.timeLimit-EPS){
   this.s.result='loss';const raw=Math.min(20,enemies.reduce((n,u)=>n+(u.boss?10:u.temporary?1:this.s.input.nodeKind==='elite'?4:2),0));const barrier=Number(this.s.phylacteryBarrier||0),loss=Math.max(0,raw-barrier);this.s.phylacteryLoss=Math.min(this.s.phylacteryHp,loss);this.s.phylacteryHp=Math.max(0,this.s.phylacteryHp-loss);this.effect('breach',{x:1,y:6},undefined,this.s.phylacteryLoss,'命匣受损');this.s.log.push(this.s.time>=this.s.timeLimit?'进攻超时，守军突破':'上阵兵团倒地，守军突破');this.s.log=this.s.log.slice(-30);
  }
 }
}
export function createBattle(input:CombatInput):BattleState {
 const s:BattleState={time:0,rngState:input.seed>>>0,units:[],corpses:[],effects:[],nextEffectId:1,nextUnitId:1,result:null,phylacteryHp:input.phylacteryHp,phylacteryLoss:0,timeLimit:input.timeLimit??75,stats:freshStats(),input:JSON.parse(JSON.stringify(input)),eventCount:0,log:[],pending:[],commands:{},accumulator:0,allDamageMultiplier:1,originalEnemyCount:input.enemies.reduce((n,e)=>n+e.count,0)};
 for(const instance of input.team.filter(v=>v.slot!==null)){
  const d=getUnit(instance.templateId),stats=getStats(instance),u=bare('a'+s.nextUnitId++,d.id,d.name,'ally'),slot=instance.slot!;
  Object.assign(u,stats,{sourceUid:instance.uid,family:d.family,maxHp:stats.hp,x:12-Math.floor(slot/2)*3,y:slot%2===0?4:8,rank:d.rank,specialization:instance.specialization});
  if(spec(u,'A')&&key(u)==='ZM_3A')u.move*=.75;if(spec(u,'A')&&key(u)==='CF_1')u.move*=.85;u.cooldowns.blink=2;u.cooldowns.tick=1;s.units.push(u);
 }
 let n=0;for(const spawn of input.enemies)for(let i=0;i<spawn.count;i++){const u=enemyUnit(s,spawn.templateId,28+Math.floor(n/5)*2.1,2+(n%5)*2,spawn.hpScale??1,spawn.atkScale??1);u.boss=spawn.boss||u.boss;u.cooldowns.tick=1;s.units.push(u);n++}
 const e=new Engine(s);e.tx(()=>{for(const u of s.units){if(u.templateId==='E02')e.shield(u,u,30,999,'entry');if(u.templateId==='E11')e.shield(u,u,80,999,'entry')}e.commands()});e.syncStats();e.finish();return s;
}
export function stepBattle(state:BattleState,dt:number):void {
 if(state.result||!Number.isFinite(dt)||dt<=0)return;state.accumulator=Number(state.accumulator||0)+dt;
 const engine=new Engine(state);let guard=0;while(Number(state.accumulator)+EPS>=STEP&&!state.result){state.accumulator=Math.max(0,Number(state.accumulator)-STEP);engine.advance(STEP);if(++guard>24000)throw new Error('stepBattle dt exceeds 20 minutes')}
}
export function simulateBattle(input:CombatInput,maxSeconds=input.timeLimit??75):BattleState {const s=createBattle(input);while(!s.result&&s.time<maxSeconds-EPS)stepBattle(s,Math.min(.25,maxSeconds-s.time));return s}
export const COMBAT_UNIT_IDS=UNITS.map(u=>u.id);
