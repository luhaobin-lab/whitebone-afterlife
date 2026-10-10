/** Legal campaign policies. No state fixtures, seed peeking, rerolls on failure,
 * reward injection, or edits to combat results. Run with npm run balance -- --seeds 30. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as R from '../src/domain/run';
import { simulateBattle, createBattle, stepBattle } from '../src/domain/combat';
import { analyzeBoard, interventionBoard, isAdjacent } from '../src/domain/slot';
import type { SlotIntervention } from '../src/domain/slot';
import { Rng } from '../src/domain/random';
import { getUnit, getStats, getRelic, getEnemy, levelForXp } from '../src/content';
import type { ActionResult, FamilyId, UnitInstance, BattleState, EnemySpawn, CombatInput } from '../src/domain/types';

type Strategy = 'balanced'|'plague'|'cavalry';
interface Policy {id:Strategy;starter:R.StarterId;main:FamilyId;weights:Partial<Record<FamilyId,number>>;tags:string[];paidLimit:number}
const POLICIES:Policy[]=[
 {id:'balanced',starter:'legion',main:'CF',weights:{SK:6,CF:7,BL:5,HD:2},tags:['shield','summon','heal','corpse'],paidLimit:1},
 {id:'plague',starter:'plague',main:'ZM',weights:{ZM:10,BL:5,HD:3,SK:2},tags:['poison','heal','shield'],paidLimit:2},
 {id:'cavalry',starter:'cavalry',main:'HR',weights:{HR:9,HD:5,BL:4,SK:2},tags:['dash','crit','physical','haste','carry'],paidLimit:2},
];
const args=process.argv.slice(2),arg=(key:string,fallback:string)=>args.includes(key)?args[args.indexOf(key)+1]??fallback:fallback;
const count=Number(arg('--seeds','30')),offset=Number(arg('--offset','0')),selection=arg('--strategy','all'),prefix=arg('--prefix','campaign-v1');
const roundTrip=args.includes('--roundtrip');
if(!Number.isInteger(count)||count<1||count>1000||!Number.isInteger(offset)||offset<0)throw new Error('--seeds must be 1..1000; --offset must be nonnegative integer');
const policies=selection==='all'?POLICIES:POLICIES.filter(p=>p.id===selection);
if(!policies.length)throw new Error('--strategy must be all, balanced, plague, or cavalry');
const output=resolve(arg('--out',`artifacts/balance/${selection}-${count}-${offset}.json`));
const sources=['src/domain/run.ts','src/domain/combat.ts','src/domain/slot.ts','src/domain/campaignMap.ts','src/domain/random.ts','src/content/index.ts','src/content/units.json','src/content/systems.json','src/content/world.json','scripts/balance.ts'];
const hashSources=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashes=hashSources();
const round=(n:number)=>Math.round(n*1000)/1000;
const mean=(n:number[])=>round(n.length?n.reduce((a,b)=>a+b,0)/n.length:0);
const check=(a:ActionResult,label:string)=>{if(!a.ok)throw new Error(`${label}: ${a.message}`)};
const all=(r:R.RunState)=>[...r.army,...r.staging];
const healer=(u:UnitInstance)=>/治疗|修复|补给|支援/.test(getUnit(u.templateId).role)&&getUnit(u.templateId).family!=='SK';
const frontline=(u:UnitInstance)=>getStats(u).range<=3&&getStats(u).hp>=130;
function scoreUnit(u:UnitInstance,p:Policy){const s=getStats(u),d=getUnit(u.templateId);return d.rank*25+s.level*5+s.hp*.06+s.atk*s.aps*.5+(d.family===p.main?10:0)+(healer(u)?4:0)}
function branches(r:R.RunState,p:Policy):Partial<Record<FamilyId,string>> {
 const b:Partial<Record<FamilyId,string>>={SK:'A',ZM:'A',HR:'A',BL:'A',CF:'A',HD:p.id==='balanced'?'A':'B'};
 // One poison healer if a bell has not appeared; later poison bodies keep spreading.
 if(p.id==='plague'&&!all(r).some(healer)&&all(r).some(u=>u.templateId==='U_ZM_2A'))b.ZM='B';
 if(p.id==='balanced'&&all(r).some(u=>u.templateId==='U_CF_3A'||u.templateId==='U_CF_2A'))b.CF='B';
 return b;
}
function specialize(u:UnitInstance,p:Policy):'A'|'B' {
 const key=u.templateId.replace('U_','');
 const fixed:Record<string,'A'|'B'>={SK_1:'B',SK_2A:'A',SK_2B:'B',SK_3A:'B',SK_3B:'B',SK_4:'A',ZM_1:'B',ZM_2A:'B',ZM_2B:'B',ZM_3A:'B',ZM_3B:'B',ZM_4:'B',HR_1:'A',HR_2A:'B',HR_2B:'A',HR_3A:'B',HR_3B:'B',HR_4:'B',HD_1:'A',HD_2A:'A',HD_2B:'B',HD_3A:'B',HD_3B:'A',HD_4:'B',BL_1:'A',BL_2A:'B',BL_2B:'A',BL_3A:'B',BL_3B:'B',BL_4:'B',CF_1:'B',CF_2A:'B',CF_2B:'B',CF_3A:'B',CF_3B:'B',CF_4:'B'};
 return fixed[key]??(p.id==='plague'?'B':'A');
}
function organize(r:R.RunState,p:Policy) {
 // Fuse only surplus bodies, preserving the experienced soldier and legal count.
 for(let guard=0;guard<20&&all(r).length>r.capacity;guard++) {
  let pair:[string,string]|undefined;
  for(const body of [...r.staging].sort((a,b)=>getUnit(b.templateId).rank-getUnit(a.templateId).rank)) {
   const bd=getUnit(body.templateId),recipient=r.army.filter(u=>getUnit(u.templateId).family===bd.family&&getUnit(u.templateId).rank<bd.rank).sort((a,b)=>b.xp-a.xp)[0];
   if(recipient&&recipient.xp>0){pair=[recipient.uid,body.uid];break}
  }
  if(!pair)break;check(R.fuseBodies(r,...pair),'fuse');
 }
 const selected:UnitInstance[]=[];let pool=[...all(r)];
 const take=(predicate:(u:UnitInstance)=>boolean)=>{const u=pool.filter(predicate).sort((a,b)=>scoreUnit(b,p)-scoreUnit(a,p)||a.uid.localeCompare(b.uid))[0];if(u){selected.push(u);pool=pool.filter(v=>v.uid!==u.uid)}};
 take(healer);take(frontline);take(frontline);
 while(selected.length<r.capacity&&pool.length)take(()=>true);
 const keep=new Set(selected.map(u=>u.uid));
 for(const donor of all(r).filter(u=>!keep.has(u.uid))) {
  const recipient=all(r).filter(u=>keep.has(u.uid)&&u.xp<150).sort((a,b)=>levelForXp(a.xp)-levelForXp(b.xp)||scoreUnit(b,p)-scoreUnit(a,p))[0];
  if(recipient)check(R.sacrifice(r,donor.uid,recipient.uid),'sacrifice');else check(R.dismissUnit(r,donor.uid),'dismiss');
 }
 // Front row is x=12; low-range durable units enter first, bell behind the line.
 const formation=all(r).sort((a,b)=>(frontline(b)?1:0)-(frontline(a)?1:0)||getStats(a).range-getStats(b).range||getStats(b).hp-getStats(a).hp);
 for(let slot=0;slot<formation.length;slot++){const uid=formation[slot].uid;if(R.findUnit(r,uid)?.slot!==slot)check(R.deployUnit(r,uid,slot),'deploy')}
 for(const u of R.pendingSpecializations(r))check(R.chooseSpecialization(r,u.uid,specialize(u,p)),'specialize');
}
function relicScore(id:string,p:Policy) {
 const d=getRelic(id),machine:Record<string,number>={R_M01:6,R_M02:9,R_M03:12,R_M04:8,R_M05:8,R_M06:5,R_M07:5,R_M08:13,R_M09:7,R_M10:10,R_M11:5,R_M12:1,R_M13:2,R_M14:10,R_M15:3,R_M16:3,R_M17:12,R_M18:0};
 return d.type==='machine'?machine[id]??0:6+d.tags.filter(t=>p.tags.includes(t)).length*4+(id==='R_A04'?5:0);
}
function equip(r:R.RunState,p:Policy) {
 if(r.phase==='victory'||r.phase==='defeat')return;
 for(const id of R.unequippedRelics(r).sort((a,b)=>relicScore(b,p)-relicScore(a,p))) {
  const d=getRelic(id),list=d.type==='army'?r.armyRelics:r.machineRelics,cap=d.type==='army'?r.armyRelicCapacity:r.machineCapacity;
  if(d.type==='machine'&&r.nodeState.machineLocked)continue;
  const worst=[...list].sort((a,b)=>relicScore(a,p)-relicScore(b,p))[0];
  if(list.length<cap)check(R.equipRelic(r,id),'equip');else if(worst&&relicScore(id,p)>relicScore(worst,p))check(R.equipRelic(r,id,worst),'replace relic');
 }
}
function boardScore(board:FamilyId[],p:Policy){return analyzeBoard(board).reduce((sum,w)=>sum+[0,1,2.8,5.5,9][w.rank]+(w.family===p.main?.2:0)+(w.level-1)*.7,0)}
function candidates(kind:string,source:string):SlotIntervention[] {
 if(kind==='rotateCorners')return [{kind:'rotateCorners'}];
 if(kind==='swapColumns')return [{kind:'swapColumns',a:0,b:1},{kind:'swapColumns',a:0,b:2},{kind:'swapColumns',a:1,b:2}];
 if(kind==='swap'||kind==='copy'){
  const out:SlotIntervention[]=[];
  for(let a=0;a<9;a++)for(let b=0;b<9;b++)if(a!==b&&(source==='R_M08'?b===4:isAdjacent(a,b)))out.push({kind,a,b});
  return out;
 }
 return Array.from({length:kind==='rerollCell'?9:3},(_,index)=>({kind,index}) as SlotIntervention);
}
function improveBoard(r:R.RunState,p:Policy,metrics:Metrics) {
 for(let pass=0;pass<2;pass++) {
  const initial=boardScore(r.slot!.board,p);let best:{action:SlotIntervention;source:string;gain:number}|null=null;
  for(const opt of R.interventionOptions(r).filter(o=>o.available)) {
   // Keep one bone when nearly bankrupt; a free source remains usable.
   if(r.bones-opt.cost<1&&opt.cost>0)continue;
   for(const action of candidates(opt.kind,opt.sourceId)) {
    const random=['lockColumn','rerollCell','rerollRow'].includes(action.kind),trials=random?24:1;let value=0;
    // Probability estimates have their own fixed sampler, never the campaign RNG.
    const sampler=new Rng(70001);
    for(let trial=0;trial<trials;trial++)value+=boardScore(interventionBoard(r.slot!.board,action,R.activeWeights(r),sampler),p);
    const gain=value/trials-initial-opt.cost*.28;
    if(gain>.07&&(!best||gain>best.gain))best={action,source:opt.sourceId,gain};
   }
  }
  if(!best)break;const before=r.bones;check(R.intervene(r,best.action,best.source),'intervene');metrics.interventions++;metrics.interventionSpend+=before-r.bones;
 }
}
function maybeExpand(r:R.RunState,m:Metrics) {
 const cost=R.expansionCost(r);if(cost===null)return;
 if(r.bones>=cost+4&&all(r).length>=r.capacity){decision(r,m,'capacity','expand',2,'army filled and four bones remain',cost);check(R.expandCapacity(r),'expand');m.expansions.push({wave:m.waves.length+1,capacity:r.capacity,cost,bones:r.bones})}
 else if(all(r).length>=r.capacity&&r.bones<cost)m.expansionUnaffordable++;
}
function prepare(r:R.RunState,p:Policy,m:Metrics):PrepCadence {
 const before={units:structuredClone(all(r)),stats:{...r.runStats},bones:r.bones,capacity:r.capacity,paid:m.paidSpend,edits:m.interventionSpend,interventions:m.interventions};
 let stopReason='';
 equip(r,p);maybeExpand(r,m);
 if(r.machineRelics.includes('R_M17')&&!r.nodeState.machineLocked&&!r.nodeState.temporaryShift){const from=r.familyWeights.filter(w=>w.family!==p.main&&w.weight>=4).sort((a,b)=>a.weight-b.weight)[0],to=r.familyWeights.find(w=>w.family===p.main);if(from&&to&&to.weight<=8)check(R.transferWeight(r,from.family,p.main,2,'relic'),'temporary weights')}
 let paid=0;
 do {
  if((r.items.I01??0)>0&&r.waveState.itemUses<2)check(R.useItem(r,'I01',{family:p.main}),'recruit voucher');
  if((R.spinCost(r)??0)>0&&(r.items.I02??0)>0&&r.waveState.itemUses+(r.waveState.queuedFamily?1:0)<2)check(R.useItem(r,'I02'),'oil');
  const cost=R.spinCost(r)!;if(cost>0){decision(r,m,'pull','paid',2,'fill army or improve the active build',cost);paid++;m.paidSpins++;m.paidSpend+=cost}
  check(R.spin(r),'spin');improveBoard(r,p,m);
  for(const win of R.getSlotWins(r))m.recruitRanks[win.rank]++;
  check(R.claimSpin(r,branches(r,p)),'claim');maybeExpand(r,m);organize(r,p);
  const next=R.spinCost(r),short=R.deployedUnits(r).length<r.capacity;
  // Regular paid pull, second only to fill a seat or build an unfinished core.
  const desired=p.paidLimit===1?1:(short||!r.army.some(u=>getUnit(u.templateId).family===p.main&&getUnit(u.templateId).rank>=2)?2:1);
  const saving=R.expansionCost(r),reserve=r.capacity<8?Math.min(10,Math.floor((saving??0)*.3)):5;
  if(next===null||paid>=desired||r.bones<next+(short?1:reserve)){stopReason=next===null?'spin-cap':paid>=desired?'policy-limit':r.bones<next?'insufficient-bones':'save-for-expansion';decision(r,m,'pull','stop',next===null?1:2,stopReason);break}
 } while(true);
 const team=R.deployedUnits(r),train=team.filter(u=>u.xp<150).sort((a,b)=>a.xp-b.xp)[0];
 if((r.items.I06??0)>0&&train&&r.waveState.itemUses<2)check(R.useItem(r,'I06',{uid:train.uid}),'training item');
 const tank=team.filter(frontline).sort((a,b)=>getStats(b).hp-getStats(a).hp)[0]??team[0];
 for(const id of ['I10','I08','I07','I09'])if((r.items[id]??0)>0&&r.waveState.itemUses<2&&(id!=='I10'||r.hp<r.maxHp))check(R.useItem(r,id,{uid:tank.uid}),'prep item');
 organize(r,p);m.prepSpend+=r.runStats.bonesSpent-before.stats.bonesSpent;
 const final=R.deployedUnits(r),old=new Map(before.units.map(u=>[u.uid,u])),previous=before.units.filter(u=>u.slot!==null);
 const fresh=final.filter(u=>!old.has(u.uid)).length,bodyUpgrades=final.filter(u=>old.has(u.uid)&&old.get(u.uid)!.templateId!==u.templateId).length;
 if(fresh+bodyUpgrades>r.runStats.unitsSummoned-before.stats.unitsSummoned)throw new Error('Effective recruit metric exceeds actual recruitment; inspect roster churn');
 return {bonesBefore:before.bones,bonesAfter:r.bones,recruits:r.runStats.unitsSummoned-before.stats.unitsSummoned,retainedNewUnits:fresh,retainedBodyUpgrades:bodyUpgrades,effectiveRecruits:fresh+bodyUpgrades,fusions:r.runStats.fusions-before.stats.fusions,sacrifices:r.runStats.sacrificed-before.stats.sacrificed,slotsChanged:final.filter(u=>!previous.some(v=>v.slot===u.slot&&v.uid===u.uid&&v.templateId===u.templateId)).length,retainedXpGain:final.reduce((sum,u)=>sum+Math.max(0,u.xp-(old.get(u.uid)?.xp??0)),0),levelIncreases:final.reduce((sum,u)=>sum+Math.max(0,levelForXp(u.xp)-(old.has(u.uid)?levelForXp(old.get(u.uid)!.xp):1)),0),specializationsChosen:final.filter(u=>u.specialization&&(old.get(u.uid)?.specialization!==u.specialization||old.get(u.uid)?.templateId!==u.templateId)).length,capacityGain:r.capacity-before.capacity,paidSpend:m.paidSpend-before.paid,interventionSpend:m.interventionSpend-before.edits,interventions:m.interventions-before.interventions,totalSpend:r.runStats.bonesSpent-before.stats.bonesSpent,stopReason,maxedUnits:final.filter(u=>u.xp>=150).length};
}
function service(r:R.RunState,p:Policy,m:Metrics) {
 const serviceType=r.phase,startBones=r.bones,ownedBefore=r.ownedRelics.length,weightsBefore=JSON.stringify(r.familyWeights);
 const train=R.deployedUnits(r).filter(u=>u.xp<150).sort((a,b)=>a.xp-b.xp)[0];
 if(r.phase==='grave'&&(r.hp<r.maxHp||train)){const choice=r.hp<=r.maxHp-9||!train?'heal':'train';decision(r,m,'grave',choice,r.hp<r.maxHp&&train?2:1,'heal meaningful damage, otherwise train');check(R.restAtGrave(r,choice,train?.uid),'grave')}
 if(r.phase==='workshop'&&r.bones>=10){const target=r.familyWeights.map(w=>({family:w.family,weight:p.weights[w.family]??5}));if(target.some(w=>w.weight!==r.familyWeights.find(v=>v.family===w.family)!.weight)){check(R.reconfigureWeights(r,target),'weights');m.weightServices++}}
 if(r.phase==='shop'){
  maybeExpand(r,m);
  for(const offer of [...r.shopStock].filter(o=>o.kind==='relic').sort((a,b)=>relicScore(b.contentId,p)-relicScore(a.contentId,p))) {
   const d=getRelic(offer.contentId),list=d.type==='machine'?r.machineRelics:r.armyRelics,cap=d.type==='machine'?r.machineCapacity:r.armyRelicCapacity;
   const useful=list.length<cap||list.some(id=>relicScore(id,p)<relicScore(offer.contentId,p));
   const reserve=r.capacity<6?12:r.capacity<8?8:5;
   if(useful&&relicScore(offer.contentId,p)>=8&&r.bones>=offer.price+reserve){decision(r,m,'shop',offer.contentId,r.shopStock.filter(o=>!o.sold&&o.price<=r.bones).length+1,'buy synergy while retaining expansion cash',offer.price);check(R.buyShop(r,offer.id),'buy relic');m.shopSpend+=offer.price;equip(r,p)}
  }
  if(r.capacity>=7&&r.bones>18)for(const offer of [...r.shopStock].filter(o=>o.kind==='item'&&['I01','I06','I08','I11','I12'].includes(o.contentId))){if(r.bones<offer.price+10)break;const got=R.buyShop(r,offer.id);if(got.ok)m.shopSpend+=offer.price}
 }
 if(r.phase==='event') {
  const costs:Record<string,number>={EV01:4,EV02:5,EV03:8,EV04:6,EV05:5,EV06:5,EV07:4,EV08:0};
  const from=r.familyWeights.filter(w=>w.family!==p.main&&w.weight>2).sort((a,b)=>a.weight-b.weight)[0];
  let choice:'a'|'b'|'c'=r.bones>=(costs[r.eventId!]??0)+4?'a':'c';
  if(r.eventId==='EV02'&&r.hp>r.maxHp-8)choice='c';
  if(r.eventId==='EV07'&&(!from||r.familyWeights.find(w=>w.family===p.main)!.weight>=10))choice='c';
  if(r.eventId==='EV06'&&r.army.filter(u=>u.xp<150).length<3)choice='c';
  if(['EV01','EV03'].includes(r.eventId!)&&!train)choice='c';
  decision(r,m,'event',`${r.eventId}:${choice}`,3,choice==='c'?'preserve resources or no effective benefit':'apply event benefit');
  const result=R.chooseEvent(r,choice,train?.uid,{from:from?.family,to:p.main});
  if(!result.ok)check(R.chooseEvent(r,'c'),'leave unusable event');
 }
 decision(r,m,'service',serviceType,1,`spent=${startBones-r.bones}; relics=${r.ownedRelics.length-ownedBefore}; weightsChanged=${weightsBefore!==JSON.stringify(r.familyWeights)}`);
 equip(r,p);organize(r,p);check(R.leaveService(r),'leave service');
}
function nodeScore(n:R.MapNode,r:R.RunState,p:Policy){
 if(n.kind==='normal')return 20;
 if(n.kind==='elite')return R.deployedUnits(r).length>=r.capacity&&r.capacity>=6&&r.hp>45?21:5;
 if(n.kind==='grave')return r.hp<45?60:25;
 if(n.kind==='workshop')return r.bones>=10&&r.familyWeights.some(w=>w.weight!==p.weights[w.family])?45:3;
 if(n.kind==='shop')return r.bones>=20?35:5;
 if(n.kind==='event')return 22;return 10;
}
interface PrepCadence {bonesBefore:number;bonesAfter:number;recruits:number;retainedNewUnits:number;retainedBodyUpgrades:number;effectiveRecruits:number;fusions:number;sacrifices:number;slotsChanged:number;retainedXpGain:number;levelIncreases:number;specializationsChosen:number;capacityGain:number;paidSpend:number;interventionSpend:number;interventions:number;totalSpend:number;stopReason:string;maxedUnits:number}
interface Decision {act:number;node:string|null;wave:number;type:string;choice:string;options:number;reason:string;bonesBefore:number;cost:number;expansionCost:number|null}
function decision(r:R.RunState,m:Metrics,type:string,choice:string,options:number,reason:string,cost=0){m.decisions.push({act:r.act,node:r.currentNodeId,wave:m.waves.length+1,type,choice,options,reason,bonesBefore:r.bones,cost,expansionCost:R.expansionCost(r)})}
interface WaveRecord {number:number;node:string;act:number;layer:number;wave:number;kind:string;nodeProfile:string|null;enemySpawns:EnemySpawn[];result:string;time:number;hp:number;hpLost:number;bones:number;capacity:number;paidSpins:number;ranks:number[];team:{uid:string;id:string;level:number;xp:number;spec:string|null;slot:number|null}[];prep:PrepCadence;aliveAllies:number;aliveEnemies:number;stats:{damage:number;healing:number;shield:number;summons:number;crits:number;poisonDamage:number;explosionDamage:number;skillTriggers:number;combos:Record<string,number>}}
interface Metrics {waves:WaveRecord[];decisions:Decision[];saveRestores:number;battleResumes:number;paidSpins:number;paidSpend:number;interventions:number;interventionSpend:number;prepSpend:number;shopSpend:number;weightServices:number;expansionUnaffordable:number;expansions:{wave:number;capacity:number;cost:number;bones:number}[];recruitRanks:number[]}
function fight(r:R.RunState,m:Metrics):BattleState {
 const input=R.getCombatInput(r);
 if(!roundTrip&&!(r.items.I11||r.items.I12))return simulateBattle(input);
 let battle=createBattle(input),resumed=false;
 while(!battle.result&&battle.time<75){
  if(r.waveState.battleItemUses<1&&r.waveState.itemUses<2){
   const weak=battle.units.find(u=>u.side==='ally'&&!u.temporary&&u.alive&&u.hp/u.maxHp<.6);
   if(weak&&r.items.I11)check(R.useItem(r,'I11',{uid:weak.sourceUid,battle}),'battle heal');
   else if(r.items.I12){const owner=battle.units.find(u=>u.side==='ally'&&!u.temporary&&u.alive&&battle.corpses.some(c=>!c.consumed&&Math.hypot(c.x-u.x,c.y-u.y)<=2));if(owner)check(R.useItem(r,'I12',{uid:owner.sourceUid,battle}),'battle explosion')}
  }
  stepBattle(battle,.25);
  if(roundTrip&&!resumed&&!battle.result&&battle.time>=3.25){
   const loaded=R.deserializeRun(R.serializeRun(r,battle));if(!loaded?.battleSnapshot)throw new Error('Live battle snapshot did not reload');
   battle=loaded.battleSnapshot;resumed=true;m.battleResumes++;
  }
 }
 return battle;
}
function runCampaign(seed:string,p:Policy) {
 let r=R.createRun(seed,p.starter);
 const m:Metrics={waves:[],decisions:[],saveRestores:0,battleResumes:0,paidSpins:0,paidSpend:0,interventions:0,interventionSpend:0,prepSpend:0,shopSpend:0,weightServices:0,expansionUnaffordable:0,expansions:[],recruitRanks:[0,0,0,0,0]};
 let error:string|null=null,actions=0;
 try {
  while(r.phase!=='victory'&&r.phase!=='defeat'&&actions++<300) {
   if(r.phase==='map'){const options=R.availableNodes(r).sort((a,b)=>nodeScore(b,r,p)-nodeScore(a,r,p)||a.id.localeCompare(b.id));if(!options.length)throw new Error('No legal forward map node');decision(r,m,'route',options[0].id,options.length,'visible node kinds and current army economy');check(R.chooseNode(r,options[0].id),'choose node')}
   else if(r.phase==='prep'){
    const prep=prepare(r,p,m),n=R.currentNode(r)!,ranks=[0,0,0,0,0],team=R.deployedUnits(r).map(u=>{ranks[getUnit(u.templateId).rank]++;return{uid:u.uid,id:u.templateId,level:levelForXp(u.xp),xp:u.xp,spec:u.specialization,slot:u.slot}});
    check(R.startWave(r),'start');const battle=fight(r,m);check(R.finishWave(r,battle),'finish');
    m.waves.push({number:m.waves.length+1,node:n.id,act:n.act,layer:n.layer,wave:r.wave,kind:n.kind,nodeProfile:n.preview.match(/第3波【([^】]+)】/)?.[1]??null,enemySpawns:structuredClone(n.waves[r.wave-1]),result:r.battleResult!.result,time:round(battle.time),hp:r.hp,hpLost:r.battleResult!.hpLost,bones:r.bones,capacity:r.capacity,paidSpins:r.waveState.paidSpins,ranks,team,prep,aliveAllies:battle.units.filter(u=>u.side==='ally'&&u.alive&&!u.temporary).length,aliveEnemies:battle.units.filter(u=>u.side==='enemy'&&u.alive).length,stats:{damage:round(battle.stats.damage),healing:round(battle.stats.healing),shield:round(battle.stats.shield),summons:battle.stats.summons,crits:battle.stats.crits,poisonDamage:round(battle.stats.poisonDamage),explosionDamage:round(battle.stats.explosionDamage),skillTriggers:Object.entries(battle.stats.comboCounts).filter(([k])=>/:(P|V)$/.test(k)).reduce((s,[,v])=>s+v,0),combos:battle.stats.comboCounts}});
    check(R.continueAfterWave(r),'continue');
   } else if(r.phase==='reward'){
    const choices=[...r.rewardChoices].sort((a,b)=>(b.relicId?relicScore(b.relicId,p):3)-(a.relicId?relicScore(a.relicId,p):3));decision(r,m,'reward',choices[0]?.id??'skip',choices.length+1,'highest build synergy including equipment opportunity cost');check(R.chooseReward(r,choices[0]?.id??'skip'),'reward');equip(r,p);
   }else if(['shop','grave','workshop','event'].includes(r.phase))service(r,p,m);
   else throw new Error('Unexpected phase '+r.phase);
   check(R.validateRun(r),'validate invariant');
   if(roundTrip){const saved=R.serializeRun(r),loaded=R.deserializeRun(saved);if(!loaded||R.serializeRun(loaded)!==saved)throw new Error('Campaign save round-trip changed state');r=loaded;m.saveRestores++}
  }
  if(actions>=300)throw new Error('Campaign policy exceeded 300 phase transitions');
 }catch(e){error=e instanceof Error?e.stack??e.message:String(e)}
 return {seed,strategy:p.id,outcome:r.phase,error,full36:r.phase==='victory'&&r.runStats.wavesWon===36,wavesWon:r.runStats.wavesWon,wavesPlayed:r.runStats.wavesPlayed,lastNode:r.currentNodeId,lastWave:r.wave,hp:r.hp,bones:r.bones,capacity:r.capacity,weights:r.familyWeights,machineRelics:r.machineRelics,armyRelics:r.armyRelics,runStats:r.runStats,...m};
}
type Result=ReturnType<typeof runCampaign>;
function cadence(runs:Result[]) {
 const ratio=(waves:WaveRecord[],predicate:(w:WaveRecord)=>boolean)=>round(waves.filter(predicate).length/Math.max(1,waves.length));
 const longest=(waves:WaveRecord[],predicate:(w:WaveRecord)=>boolean)=>{let streak=0,max=0;for(const w of waves){streak=predicate(w)?streak+1:0;max=Math.max(max,streak)}return max};
 return [1,2,3].map(act=>{
  const entered=runs.filter(r=>r.waves.some(w=>w.act===act)),waves=entered.flatMap(r=>r.waves.filter(w=>w.act===act)),choices=entered.flatMap(r=>r.decisions.filter(d=>d.act===act)),times=waves.map(w=>w.time).sort((a,b)=>a-b);
  const pct=(p:number)=>times[Math.max(0,Math.ceil(times.length*p)-1)]??0;
  return {act,runsReached:entered.length,waves:waves.length,battleSeconds:{mean:mean(times),p10:pct(.1),p50:pct(.5),p90:pct(.9)},ordinaryLosses:waves.filter(w=>w.kind!=='boss'&&w.result!=='win').length,bossLosses:waves.filter(w=>w.kind==='boss'&&w.result!=='win').length,meanRecruits:mean(waves.map(w=>w.prep.recruits)),meanEffectiveRecruits:mean(waves.map(w=>w.prep.effectiveRecruits)),wavesWithEffectiveRecruit:ratio(waves,w=>w.prep.effectiveRecruits>0),wavesWithRosterChange:ratio(waves,w=>w.prep.slotsChanged>0),wavesWithPrepProgress:ratio(waves,w=>w.prep.effectiveRecruits>0||w.prep.retainedXpGain>0||w.prep.specializationsChosen>0||w.prep.capacityGain>0),meanPrepXpGain:mean(waves.map(w=>w.prep.retainedXpGain)),meanLevelIncreases:mean(waves.map(w=>w.prep.levelIncreases)),meanSpecializationsChosen:mean(waves.map(w=>w.prep.specializationsChosen)),meanFusions:mean(waves.map(w=>w.prep.fusions)),meanSacrifices:mean(waves.map(w=>w.prep.sacrifices)),meanOccupiedSlots:mean(waves.map(w=>w.team.length)),meanCapacity:mean(waves.map(w=>w.capacity)),meanMaxedUnitShare:mean(waves.map(w=>w.prep.maxedUnits/w.team.length)),meanBonesBeforePrep:mean(waves.map(w=>w.prep.bonesBefore)),meanBonesAfterPrep:mean(waves.map(w=>w.prep.bonesAfter)),meanPrepSpend:mean(waves.map(w=>w.prep.totalSpend)),meanPaidSpend:mean(waves.map(w=>w.prep.paidSpend)),meanInterventionSpend:mean(waves.map(w=>w.prep.interventionSpend)),stopForEconomyShare:ratio(waves,w=>['insufficient-bones','save-for-expansion'].includes(w.prep.stopReason)),longestNoRosterChange:Math.max(0,...entered.map(r=>longest(r.waves.filter(w=>w.act===act),w=>w.prep.slotsChanged===0))),longestNoPrepProgress:Math.max(0,...entered.map(r=>longest(r.waves.filter(w=>w.act===act),w=>w.prep.effectiveRecruits===0&&w.prep.retainedXpGain===0&&w.prep.specializationsChosen===0&&w.prep.capacityGain===0))),multiOptionDecisionsPerRun:round(choices.filter(d=>d.options>1).length/Math.max(1,entered.length)),paidWhileExpansionAffordable:choices.filter(d=>d.type==='pull'&&d.choice==='paid'&&d.expansionCost!==null&&d.bonesBefore>=d.expansionCost).length,shopPurchases:choices.filter(d=>d.type==='shop').length};
 });
}
function summarize(runs:Result[]) {
 const waves=runs.flatMap(r=>r.waves),failures:Record<string,number>={},ranks=[0,0,0,0,0],recruitRanks=[0,0,0,0,0];
 for(const r of runs){if(r.outcome!=='victory'){const key=`${r.lastNode}/W${r.lastWave}`;failures[key]=(failures[key]??0)+1}for(let i=1;i<=4;i++)recruitRanks[i]+=r.recruitRanks[i]}
 for(const w of waves)for(let i=1;i<=4;i++)ranks[i]+=w.ranks[i];
 const totalRanks=ranks.reduce((a,b)=>a+b,0);
 return {runs:runs.length,victories:runs.filter(r=>r.outcome==='victory').length,winRate:mean(runs.map(r=>r.outcome==='victory'?1:0)),full36:runs.filter(r=>r.full36).length,errors:runs.filter(r=>r.error).length,meanWavesWon:mean(runs.map(r=>r.wavesWon)),meanWavesPlayed:mean(runs.map(r=>r.wavesPlayed)),meanFinalBones:mean(runs.map(r=>r.bones)),meanFinalHp:mean(runs.map(r=>r.hp)),meanCapacity:mean(runs.map(r=>r.capacity)),capacity8:runs.filter(r=>r.capacity===8).length,meanPaidSpins:mean(runs.map(r=>r.paidSpins)),meanPaidSpend:mean(runs.map(r=>r.paidSpend)),meanInterventions:mean(runs.map(r=>r.interventions)),meanInterventionSpend:mean(runs.map(r=>r.interventionSpend)),meanBonesEarned:mean(runs.map(r=>r.runStats.bonesEarned)),meanBonesSpent:mean(runs.map(r=>r.runStats.bonesSpent)),meanExpansionUnaffordableObservations:mean(runs.map(r=>r.expansionUnaffordable)),meanBattleSeconds:mean(waves.map(w=>w.time)),meanTotalBattleSeconds:mean(runs.map(r=>r.waves.reduce((s,w)=>s+w.time,0))),meanSkillTriggers:mean(waves.map(w=>w.stats.skillTriggers)),meanPoisonDamage:mean(waves.map(w=>w.stats.poisonDamage)),meanSummons:mean(waves.map(w=>w.stats.summons)),meanCrits:mean(waves.map(w=>w.stats.crits)),meanExplosionDamage:mean(waves.map(w=>w.stats.explosionDamage)),deployedRankShares:ranks.map(n=>round(n/Math.max(1,totalRanks))),recruitRanks,failures};
}

/** Isolated encounter experiment, explicitly separate from the lawful full-run
 * evidence above. Existing campaign armies are held fixed; production is untouched. */
function probeEncounters() {
 const path=arg('--campaign','artifacts/balance/cadence-30.json'),baseline=JSON.parse(readFileSync(path,'utf8')) as {runs:Result[]};
 const recipes=[
  {id:'A2-oil-mix',act:2,nodeKind:'elite' as const,base:[['E06',3],['E07',2],['E08',1]],candidate:[['E06',2],['E07',2],['E08',1],['E09',1]],intent:'replace one pike with existing telegraphed fire oil'},
  {id:'A3-lightning-mix',act:3,nodeKind:'elite' as const,base:[['E11',3],['E12',2],['E13',1]],candidate:[['E11',1],['E12',2],['E13',1],['E14',2]],intent:'replace two armor guards with existing two-target magic pressure'},
  {id:'A3-support-battery',act:3,nodeKind:'normal' as const,base:[['E11',3],['E12',1],['E13',1]],candidate:[['E11',1],['E12',2],['E13',2]],intent:'one frontline with more ranged support as a target for backline access'},
  {id:'A3-light-flanks',act:3,nodeKind:'elite' as const,base:[['E11',3],['E12',2],['E13',1]],candidate:[['E11',1],['E12',2],['E13',1],['E07',2],['E09',2]],intent:'split two heavy guards into four lighter ranged/oil threats; HP and entry shields decrease while target count increases'},
  {id:'A3-normal-lightning',act:3,nodeKind:'normal' as const,base:[['E11',3],['E12',1],['E13',1]],candidate:[['E11',1],['E12',1],['E13',1],['E14',2]],intent:'late ordinary introduction to two-target magic instead of three armor guards'},
 ].filter(r=>arg('--recipe','all')==='all'||r.id===arg('--recipe','all'));
 if(!recipes.length)throw new Error('Unknown --recipe for encounter probe');
 const spawns=(pairs:(string|number)[][]):EnemySpawn[]=>pairs.map(([id,n])=>({templateId:String(id),count:Number(n),hpScale:1.08,atkScale:1.08}));
 const budget=(pairs:(string|number)[][])=>({units:pairs.reduce((n,[,count])=>n+Number(count),0),baseHp:pairs.reduce((n,[id,count])=>n+getEnemy(String(id)).hp*Number(count),0),baseBasicDps:round(pairs.reduce((n,[id,count])=>{const e=getEnemy(String(id));return n+e.atk*e.aps*Number(count)},0))});
 const results:{recipe:string;strategy:string;seed:string;formation:string;version:string;capacity:number;team:UnitInstance[];win:boolean;seconds:number;permanentKOs:number;remainingHpShare:number;enemyDamage:number;temporaryTargetHitEvents:number;enemySkillTriggers:number;skills:Record<string,number>}[]=[];
 for(const recipe of recipes)for(const p of policies){
  const samples=baseline.runs.filter(r=>r.strategy===p.id&&r.waves.some(w=>w.act===recipe.act&&w.layer===5&&w.wave===3)).slice(offset,offset+count);
  for(const sample of samples){
   const wave=sample.waves.find(w=>w.act===recipe.act&&w.layer===5&&w.wave===3)!;
   for(const formation of ['recorded','mirror-lanes'])for(const version of ['base','candidate']){
    const team=wave.team.map(u=>({uid:u.uid,templateId:u.id,xp:u.xp,specialization:u.spec as 'A'|'B'|null,slot:formation==='mirror-lanes'&&u.slot!==null&&(u.slot^1)<wave.capacity?u.slot^1:u.slot,acquiredAt:0}));
    const input:CombatInput={seed:new Rng(`${sample.seed}:${recipe.id}`).state,team,enemies:spawns(version==='base'?recipe.base:recipe.candidate),relics:[],buffs:[],act:recipe.act,wave:3,nodeKind:recipe.nodeKind,phylacteryHp:60,timeLimit:75};
    const battle=createBattle(input);let temporaryTargetHitEvents=0,lastEffect=0;
    while(!battle.result&&battle.time<75){stepBattle(battle,.05);for(const e of battle.effects.filter(e=>e.id>lastEffect)){
      const source=battle.units.find(u=>u.id===e.sourceId),target=battle.units.find(u=>u.id===e.targetId);
      if(source?.side==='enemy'&&target?.side==='ally'&&target.temporary&&e.amount&&['hit','crit','burn','poison','lightning'].includes(e.kind))temporaryTargetHitEvents++;
     }lastEffect=battle.nextEffectId-1;
    }
    const permanent=battle.units.filter(u=>u.side==='ally'&&!u.temporary),skills=Object.fromEntries(Object.entries(battle.stats.comboCounts).filter(([id])=>/^E\d+:/.test(id)));
    results.push({recipe:recipe.id,strategy:p.id,seed:sample.seed,formation,version,capacity:wave.capacity,team,win:battle.result==='win',seconds:battle.time,permanentKOs:permanent.filter(u=>!u.alive).length,remainingHpShare:round(permanent.reduce((n,u)=>n+u.hp,0)/permanent.reduce((n,u)=>n+u.maxHp,0)),enemyDamage:round(battle.units.filter(u=>u.side==='enemy').reduce((n,u)=>n+u.damageDone,0)),temporaryTargetHitEvents,enemySkillTriggers:Object.entries(skills).filter(([id])=>id.endsWith(':skill')).reduce((n,[,v])=>n+v,0),skills});
   }
  }
 }
 const groups=recipes.flatMap(recipe=>policies.flatMap(p=>['base','candidate'].map(version=>{
  const rows=results.filter(r=>r.recipe===recipe.id&&r.strategy===p.id&&r.version===version);
  return {recipe:recipe.id,strategy:p.id,version,battles:rows.length,winRate:mean(rows.map(r=>Number(r.win))),seconds:mean(rows.map(r=>r.seconds)),permanentKOs:mean(rows.map(r=>r.permanentKOs)),remainingHpShare:mean(rows.map(r=>r.remainingHpShare)),enemyDamage:mean(rows.map(r=>r.enemyDamage)),temporaryTargetHitEvents:mean(rows.map(r=>r.temporaryTargetHitEvents)),enemySkillTriggers:mean(rows.map(r=>r.enemySkillTriggers))};
 })));
 const report={schemaVersion:1,generatedAt:new Date().toISOString(),experiment:'isolated encounter composition substitutions, not complete legal campaigns',cohort:path,config:{samplesPerStrategy:count,offset,formations:['recorded','mirror-lanes'],relics:'omitted equally in both arms to isolate enemy composition; no claim to reproduce original campaign battles',scales:{hp:1.08,atk:1.08},timeLimit:75},sourceHashes,sourcesUnchangedDuringRun:JSON.stringify(sourceHashes)===JSON.stringify(hashSources()),recipes:recipes.map(r=>({...r,budgets:{base:budget(r.base),candidate:budget(r.candidate)}})),summary:groups,results};
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,battles:results.length,sourceStable:report.sourcesUnchangedDuringRun,summary:groups},null,2));
 if(!report.sourcesUnchangedDuringRun)process.exitCode=1;
}
if(args.includes('--probe-encounters')){probeEncounters();process.exit(process.exitCode??0)}
const started=Date.now(),runs:Result[]=[];
for(const p of policies)for(let i=offset;i<offset+count;i++){
 const result=runCampaign(`${prefix}-${String(i).padStart(3,'0')}`,p);runs.push(result);
 console.log(`${p.id} ${i+1-offset}/${count}: ${result.outcome} ${result.wavesWon}/${result.wavesPlayed} waves, cap${result.capacity}, bones${result.bones}${result.error?' ERROR '+result.error.split('\n')[0]:''}`);
}
const report={schemaVersion:2,generatedAt:new Date().toISOString(),elapsedSeconds:round((Date.now()-started)/1000),config:{seeds:count,offset,prefix,selection,policies,combatStep:.05,policyVersion:2,roundTripSaves:roundTrip,playerPolicy:'public board and state; fixed independent probability sampler; all mutations through run actions; fusion bodies come only from newly recruited staging soldiers',cadenceDefinitions:{effectiveRecruit:'new deployed UID or retained UID with a higher-rank body at the end of this prep',prepProgress:'effective recruit, XP gained by retained soldiers, specialization choice or capacity growth; excludes battle participation XP',rosterChange:'at least one deployed slot changes its occupant UID or profession',resourceDecisions:'observed policy choice among available actions, not evidence of human deliberation'}},sourceHashes,sourcesUnchangedDuringRun:JSON.stringify(sourceHashes)===JSON.stringify(hashSources()),summary:Object.fromEntries(policies.map(p=>[p.id,summarize(runs.filter(r=>r.strategy===p.id))])),cadence:Object.fromEntries(policies.map(p=>[p.id,cadence(runs.filter(r=>r.strategy===p.id))])),runs};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,elapsedSeconds:report.elapsedSeconds,summary:report.summary},null,2));
if(runs.some(r=>r.error)||!report.sourcesUnchangedDuringRun)process.exitCode=1;
