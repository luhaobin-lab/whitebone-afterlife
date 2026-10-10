/** Passive, deliberately simple policy. Every campaign mutation uses run.ts APIs.
 * It is a reproducible low-intervention comparison, not a model of real novices. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import * as R from '../src/domain/run';
import {simulateBattle} from '../src/domain/combat';
import {getUnit,getRelic,levelForXp} from '../src/content';
import type {ActionResult,FamilyId} from '../src/domain/types';
const args=process.argv.slice(2),arg=(k:string,f:string)=>args.includes(k)?args[args.indexOf(k)+1]??f:f;
const count=Number(arg('--seeds','10')),offset=Number(arg('--offset','0')),prefix=arg('--prefix','campaign-v1');
if(!Number.isInteger(count)||count<1||count>50||!Number.isInteger(offset)||offset<0)throw new Error('Bounded sample requires seeds 1..50 and nonnegative offset');
const output=resolve(arg('--out','artifacts/balance/novice-10x3.json'));
const productionSources=['src/domain/run.ts','src/domain/combat.ts','src/domain/slot.ts','src/domain/campaignMap.ts','src/domain/random.ts','src/content/index.ts','src/content/units.json','src/content/systems.json','src/content/world.json'];
const hashes=()=>Object.fromEntries([...productionSources,'scripts/novice-policy.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const sourceHashes=hashes(),domainHash=createHash('sha256').update(JSON.stringify(productionSources.map(p=>[p,sourceHashes[p]]))).digest('hex');
const check=(result:ActionResult,label:string)=>{if(!result.ok)throw new Error(label+': '+result.message)};
const round=(n:number)=>Math.round(n*1000)/1000;
function equipFreeSlots(r:R.RunState){
 for(const id of R.unequippedRelics(r)){
  const relic=getRelic(id),list=relic.type==='army'?r.armyRelics:r.machineRelics,cap=relic.type==='army'?r.armyRelicCapacity:r.machineCapacity;
  if(list.length>=cap||relic.type==='machine'&&r.nodeState.machineLocked)continue;
  check(R.equipRelic(r,id),'equip free slot');
 }
}
function fillAndAbsorb(r:R.RunState){
 // A visible birth-rank comparison when filling the only open seat; existing
 // soldiers keep their positions and bodies, with no role scoring or fusion.
 const staged=[...r.staging].sort((a,b)=>getUnit(b.templateId).rank-getUnit(a.templateId).rank||a.uid.localeCompare(b.uid));
 for(const draft of staged){
  const unit=R.findUnit(r,draft.uid);if(!unit)continue;
  const open=Array.from({length:r.capacity},(_,i)=>i).find(slot=>!r.army.some(u=>u.slot===slot));
  if(open!==undefined){check(R.deployUnit(r,unit.uid,open),'fill empty slot');continue}
  const recipient=R.deployedUnits(r).filter(u=>u.xp<150).sort((a,b)=>a.xp-b.xp||a.slot!-b.slot!)[0];
  if(recipient)check(R.sacrifice(r,unit.uid,recipient.uid),'absorb spare recruit');else check(R.dismissUnit(r,unit.uid),'dismiss surplus after all trained');
 }
 for(const unit of R.pendingSpecializations(r))check(R.chooseSpecialization(r,unit.uid,'A'),'choose first specialization');
}
const nodeOrder:Record<string,number>={normal:0,grave:1,event:2,shop:3,workshop:4,elite:5,boss:6};
function reward(r:R.RunState){
 const choices=[...r.rewardChoices].sort((a,b)=>{
  const score=(x:R.RewardChoice)=>{if(!x.relicId)return 3;const d=getRelic(x.relicId),list=d.type==='army'?r.armyRelics:r.machineRelics,cap=d.type==='army'?r.armyRelicCapacity:r.machineCapacity;return list.length<cap?(d.type==='army'?0:1):2};
  return score(a)-score(b)||a.id.localeCompare(b.id);
 });check(R.chooseReward(r,choices[0]?.id??'skip'),'take reward');if(r.phase!=='victory')equipFreeSlots(r);
}
function runOne(seed:string,starter:R.StarterId){
 const r=R.createRun(seed,starter);const initialWeights=JSON.stringify(r.familyWeights),waves=[];let error:string|null=null,actions=0,graveHealing=0,graveTraining=0,emptyBoards=0;
 try{
  while(r.phase!=='victory'&&r.phase!=='defeat'&&actions++<250){
   if(r.phase==='map'){
    const next=R.availableNodes(r).sort((a,b)=>nodeOrder[a.kind]-nodeOrder[b.kind]||a.id.localeCompare(b.id))[0];if(!next)throw new Error('No forward map node');check(R.chooseNode(r,next.id),'choose ordinary-preferred node');
   }else if(r.phase==='prep'){
    equipFreeSlots(r);if(R.spinCost(r)!==0)throw new Error('Expected one free pull per wave');check(R.spin(r),'free pull');if(!R.getSlotWins(r).length)emptyBoards++;
    check(R.claimSpin(r,Object.fromEntries(['SK','ZM','HR','HD','BL','CF'].map(f=>[f,'A'])) as Partial<Record<FamilyId,string>>),'take first birth branch');fillAndAbsorb(r);
    const node=R.currentNode(r)!,team=R.deployedUnits(r).map(u=>({id:u.templateId,level:levelForXp(u.xp),xp:u.xp,spec:u.specialization,slot:u.slot})),hpBefore=r.hp;
    const scheduledWave=(node.act-1)*12+({1:0,3:3,5:6,7:9}[node.layer]??0)+r.wave;
    check(R.startWave(r),'start wave');const battle=simulateBattle(R.getCombatInput(r));check(R.finishWave(r,battle),'finish actual battle');
    waves.push({attempt:waves.length+1,scheduledWave,node:node.id,act:node.act,layer:node.layer,wave:r.wave,kind:node.kind,result:r.battleResult!.result,seconds:round(battle.time),hpBefore,hpAfter:r.hp,hpLost:r.battleResult!.hpLost,army:team,alivePermanent:battle.units.filter(u=>u.side==='ally'&&!u.temporary&&u.alive).length,aliveEnemies:battle.units.filter(u=>u.side==='enemy'&&u.alive).length,armyRelics:[...r.armyRelics],machineRelics:[...r.machineRelics],stats:{damage:round(battle.stats.damage),healing:round(battle.stats.healing),shield:round(battle.stats.shield),summons:battle.stats.summons,poisonDamage:round(battle.stats.poisonDamage)}});
    check(R.continueAfterWave(r),'continue after battle');
   }else if(r.phase==='reward')reward(r);
   else if(['shop','grave','workshop','event'].includes(r.phase)){
    if(r.phase==='grave'){
     if(r.hp<r.maxHp){const old=r.hp;check(R.restAtGrave(r,'heal'),'free grave heal');graveHealing+=r.hp-old}
     else {const u=R.deployedUnits(r).filter(u=>u.xp<150).sort((a,b)=>a.xp-b.xp||a.slot!-b.slot!)[0];if(u){const old=u.xp;check(R.restAtGrave(r,'train',u.uid),'free grave training');graveTraining+=R.findUnit(r,u.uid)!.xp-old}}
    }
    if(r.phase==='event')check(R.chooseEvent(r,'c'),'leave event for free');
    fillAndAbsorb(r);equipFreeSlots(r);check(R.leaveService(r),'leave service');
   }else throw new Error('Unexpected phase '+r.phase);
   check(R.validateRun(r),'validate run');
   if(r.runStats.bonesSpent!==0||r.capacity!==4||r.runStats.fusions!==0||JSON.stringify(r.familyWeights)!==initialWeights)throw new Error('Simple-policy constraint breached');
  }
  if(actions>=250)throw new Error('Phase loop exceeded bound');
 }catch(e){error=e instanceof Error?e.stack??e.message:String(e)}
 const failures=waves.filter(w=>w.result!=='win');return{seed,starter,outcome:r.phase,error,wavesPlayed:r.runStats.wavesPlayed,wavesWon:r.runStats.wavesWon,firstFailure:failures[0]??null,fatalFailure:r.phase==='defeat'?waves.at(-1)??null:null,totalPhylacteryLoss:waves.reduce((n,w)=>n+w.hpLost,0),graveHealing,graveTraining,finalHp:r.hp,finalBones:r.bones,finalCapacity:r.capacity,emptyBoards,runStats:r.runStats,ownedRelics:r.ownedRelics,armyRelics:r.armyRelics,machineRelics:r.machineRelics,waves};
}
const started=Date.now(),runs:ReturnType<typeof runOne>[]=[];
for(const starter of ['legion','plague','cavalry'] as const)for(let i=offset;i<offset+count;i++){
 const run=runOne(`${prefix}-${String(i).padStart(3,'0')}`,starter);runs.push(run);console.log(`${starter} ${run.seed}: ${run.outcome}, ${run.wavesWon}/${run.wavesPlayed}, HP loss ${run.totalPhylacteryLoss}${run.error?' ERROR':''}`);
}
const mean=(a:number[])=>round(a.reduce((n,v)=>n+v,0)/Math.max(1,a.length));
const summary=Object.fromEntries((['legion','plague','cavalry'] as const).map(starter=>{
 const group=runs.filter(r=>r.starter===starter),waves=group.flatMap(r=>r.waves),fatal=group.filter(r=>r.fatalFailure),histogram:Record<string,number>={};
 for(const r of fatal){const w=r.fatalFailure!,k=`A${w.act}/L${w.layer}/${w.kind}/W${w.wave}`;histogram[k]=(histogram[k]||0)+1}
 return[starter,{runs:group.length,victories:group.filter(r=>r.outcome==='victory').length,errors:group.filter(r=>r.error).length,meanWavesPlayed:mean(group.map(r=>r.wavesPlayed)),meanWavesWon:mean(group.map(r=>r.wavesWon)),meanTotalHpLost:mean(group.map(r=>r.totalPhylacteryLoss)),meanGraveHealing:mean(group.map(r=>r.graveHealing)),meanFinalHp:mean(group.map(r=>r.finalHp)),meanFinalBones:mean(group.map(r=>r.finalBones)),fatalBossRuns:fatal.filter(r=>r.fatalFailure!.kind==='boss').length,fatalOtherRuns:fatal.filter(r=>r.fatalFailure!.kind!=='boss').length,ordinaryRetreats:waves.filter(w=>w.kind==='normal'&&w.result==='retreat').length,eliteRetreats:waves.filter(w=>w.kind==='elite'&&w.result==='retreat').length,ordinaryHpLost:waves.filter(w=>w.kind==='normal').reduce((n,w)=>n+w.hpLost,0),eliteHpLost:waves.filter(w=>w.kind==='elite').reduce((n,w)=>n+w.hpLost,0),bossHpLost:waves.filter(w=>w.kind==='boss').reduce((n,w)=>n+w.hpLost,0),fatalHistogram:histogram}];
}));
const report={schemaVersion:1,generatedAt:new Date().toISOString(),elapsedSeconds:round((Date.now()-started)/1000),domainHash,sourceHashes,sourcesUnchangedDuringRun:JSON.stringify(sourceHashes)===JSON.stringify(hashes()),config:{seeds:count,offset,prefix,policy:'One free pull per wave; choose A branches; fill existing seats by visible birth rank; absorb all spare recruits into lowest-XP deployed soldier; A specialization; prefer ordinary nodes; free grave heal/train; skip events; take and fill relic slots; no purchases, capacity expansion, fusion, formation changes, paid pulls, board intervention, weight changes or item use.'},summary,runs};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,domainHash,sourcesUnchangedDuringRun:report.sourcesUnchangedDuringRun,summary},null,2));
if(runs.some(r=>r.error)||!report.sourcesUnchangedDuringRun)process.exitCode=1;
