import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun, STARTERS, availableNodes, currentNode, chooseNode, spin, claimSpin, getSlotWins,
  deployedUnits, reserveUnits, deployUnit, benchUnit, dismissUnit, sacrifice, fuseBodies,
  chooseSpecialization, expandCapacity, expansionCost, spinCost, intervene, interventionOptions,
  transferWeight, activeWeights, reconfigureWeights, replaceFamily, restAtGrave, chooseEvent,
  leaveService, buyShop, refreshShop, refreshCost, equipRelic, unequipRelic, unequippedRelics,
  canStartWave, startWave, getCombatInput, finishWave, continueAfterWave, chooseReward,
  useItem, cancelQueuedItems, serializeRun, deserializeRun, validateRun,
  materializeSpin, sealSpin, chooseBirthBranch, canSpin, findUnit,
  type RunState,
} from '../src/domain/run';
import { getUnit, getEnemy, makeUnit, RELICS, xpForLevel } from '../src/content';
import type { ActionResult, BattleState, BattleStats, FamilyId, NodeKind, CombatUnit } from '../src/domain/types';
import type { SlotIntervention } from '../src/domain/slot';
import { createBattle, stepBattle } from '../src/domain/combat';

function ok(result:ActionResult):void {assert.equal(result.ok,true,result.message??'action should succeed')}
function prep(seed:string|number='campaign-tests',starter:'legion'|'plague'|'cavalry'='legion'):RunState {
  const run=createRun(seed,starter);ok(chooseNode(run,availableNodes(run)[0].id));return run;
}
function setBoard(run:RunState,board:FamilyId[]):void {assert.ok(run.slot);run.slot.board=board;}
const emptyBoard:FamilyId[]=['SK','ZM','HD','BL','CF','HR','ZM','HD','SK'];
const rank1Board:FamilyId[]=['SK','SK','SK','ZM','HD','BL','CF','ZM','HD'];
const rank3Board:FamilyId[]=['SK','SK','SK','SK','SK','SK','ZM','SK','HD'];
function claimDefault(run:RunState):void {
  const branches:Partial<Record<FamilyId,string>>={};for(const w of getSlotWins(run))if(w.templateIds.length>1)branches[w.family]='A';ok(claimSpin(run,branches));
}
function settleStaging(run:RunState):void {
  for(const u of [...run.staging]){
    const occupied=new Set(deployedUnits(run).map(x=>x.slot));const slot=Array.from({length:run.capacity},(_,i)=>i).find(i=>!occupied.has(i));
    if(slot!==undefined)ok(deployUnit(run,u.uid,slot));
    else {const recipient=[...run.army].sort((a,b)=>a.xp-b.xp).find(x=>x.xp<150);if(recipient)ok(sacrifice(run,u.uid,recipient.uid));else ok(dismissUnit(run,u.uid))}
  }
  for(const u of deployedUnits(run))if(u.xp>=30&&!u.specialization)ok(chooseSpecialization(run,u.uid,'A'));
}
function stats():BattleStats{return {damage:100,healing:5,shield:5,summons:0,crits:0,poisonDamage:0,explosionDamage:0,kills:3,comboCounts:{},unitStats:{}}}
/** Campaign unit-test fixture only: combat correctness/balance are tested by the combat agent. */
function resultFixture(run:RunState,result:'win'|'loss'|'retreat'='win',hpLoss=0):BattleState {
  const input=getCombatInput(run);
  return {time:15,rngState:1,units:[],corpses:[],effects:[],nextEffectId:1,nextUnitId:1,result,
    phylacteryHp:Math.max(0,run.hp-hpLoss),phylacteryLoss:hpLoss,timeLimit:75,stats:stats(),input,eventCount:0,log:[]};
}
function readyWave(run:RunState):void {ok(spin(run));claimDefault(run);settleStaging(run);ok(startWave(run))}
function fixtureService(run:RunState,kind:NodeKind):void {
  const node=run.map.find(n=>n.act===run.act&&n.kind===kind&&run.map.some(p=>p.links.includes(n.id)));assert.ok(node,`map has ${kind}`);
  const previous=run.map.find(n=>n.links.includes(node.id));assert.ok(previous);previous.visited=true;previous.completed=true;
  run.currentNodeId=previous.id;run.phase='map';ok(chooseNode(run,node.id));
}
function owned(run:RunState,id:string):void {if(!run.ownedRelics.includes(id))run.ownedRelics.push(id)}

test('three starters contain three R1 undead; same seeds create identical full random maps',()=>{
  for(const s of STARTERS){const r=createRun('fixed',s.id);assert.equal(r.army.length,3);assert.equal(r.capacity,4);assert.equal(r.reserveCapacity,8);assert.equal(r.map.length,57);assert.ok(r.army.every(u=>getUnit(u.templateId).rank===1));assert.deepEqual(r.machineRelics,['R_M01']);assert.equal(validateRun(r).ok,true)}
  assert.equal(serializeRun(createRun('equal')),serializeRun(createRun('equal')));
  assert.notDeepEqual(createRun('a').map,createRun('b').map);
  const r=createRun(18);for(const n of r.map){if(n.act===3&&n.layer===7)assert.equal(n.links.length,0);else assert.ok(n.links.length>0);for(const id of n.links){const m=r.map.find(x=>x.id===id)!;assert.ok(m);if(n.layer<7){assert.equal(m.layer,n.layer+1);assert.ok(Math.abs(m.lane-n.lane)<=1)}}}
});

test('non-combat services never permit spinning and can always be left',()=>{
  for(const kind of ['shop','grave','workshop','event'] as const){const r=createRun('service-'+kind);fixtureService(r,kind);const before=serializeRun(r);assert.equal(spin(r).ok,false);assert.equal(serializeRun(r),before);ok(leaveService(r));assert.equal(r.phase,'map');assert.ok(availableNodes(r).length)}
});

test('1000 campaign seeds contain no unreachable drawn nodes or backward links',()=>{
  for(let seed=0;seed<1000;seed++){
    const r=createRun(`mapaudit-${seed}`),reachable=new Set(r.map.filter(n=>n.act===1&&n.layer===1).map(n=>n.id));
    for(const node of r.map){
      if(node.layer<7)assert.ok(node.links.length>=1&&node.links.length<=2,`${node.id} forward choices`);
      for(const id of node.links){const next=r.map.find(n=>n.id===id)!;assert.ok(next);assert.ok(next.act>node.act||next.act===node.act&&next.layer===node.layer+1);if(reachable.has(node.id))reachable.add(id)}
    }
    assert.equal(reachable.size,r.map.length,`seed${seed} has isolated nodes`);
  }
});

test('late encounter replacements are seed-fixed, mutually exclusive, publicly previewed and lower HP',()=>{
  const variants=new Set<string>();
  for(let seed=0;seed<100;seed++){
    const r=createRun(`profiles-${seed}`),copy=createRun(`profiles-${seed}`);assert.deepEqual(r.map,copy.map);
    for(const node of r.map){
      const profile=node.preview.includes('第3波【');
      assert.equal(profile,node.act===3&&node.layer===5&&(node.kind==='normal'||node.kind==='elite'));
      if(!profile)continue;
      const wave=node.waves[2],count=(id:string)=>wave.find(e=>e.templateId===id)?.count??0,light=node.kind==='elite'&&node.seed%2===0;
      variants.add(node.kind==='normal'?'normal':light?'light':'elite-lightning');
      if(light){assert.equal(count('E07'),2);assert.equal(count('E09'),2);assert.equal(count('E14'),0);assert.equal(wave.reduce((n,e)=>n+e.count,0),8)}
      else {assert.equal(count('E14'),2);assert.equal(count('E07'),0);assert.equal(count('E09'),0)}
      for(const spawn of wave)assert.ok(node.preview.includes(`${getEnemy(spawn.templateId).name}×${spawn.count}`));
      assert.ok(node.preview.includes('危险'));assert.ok(node.preview.includes(light?'提前1秒':'法术'));
      const replacementHp=light?2*getEnemy('E07').hp+2*getEnemy('E09').hp:2*getEnemy('E14').hp;
      assert.ok(replacementHp<2*getEnemy('E11').hp);
      assert.ok(wave.every(e=>e.hpScale===wave[0].hpScale&&e.atkScale===wave[0].atkScale));
    }
  }
  assert.deepEqual([...variants].sort(),['elite-lightning','light','normal']);
});

test('campaign saves cross all chapter boundaries with new profiles and cannot replay boss rewards',()=>{
  let r=createRun('cross-chapter-save');const transitions:number[]=[];let guard=0;
  while(r.phase!=='victory'&&guard++<250){
    if(r.phase==='map')ok(chooseNode(r,availableNodes(r)[0].id));
    else if(r.phase==='prep'){readyWave(r);ok(finishWave(r,resultFixture(r)))}
    else if(r.phase==='waveResult')ok(continueAfterWave(r));
    else if(r.phase==='reward'){
      const boss=currentNode(r)!.kind==='boss';ok(chooseReward(r,'skip'));
      if(boss){transitions.push(r.act);const before=serializeRun(r);assert.equal(chooseReward(r,'skip').ok,false);assert.equal(serializeRun(r),before)}
    }else if(['shop','grave','workshop','event'].includes(r.phase))ok(leaveService(r));
    const text=serializeRun(r),loaded=deserializeRun(text);assert.ok(loaded);assert.equal(serializeRun(loaded),text);r=loaded;
  }
  assert.equal(r.phase,'victory');assert.equal(r.runStats.wavesWon,36);assert.deepEqual(transitions,[2,3,3]);assert.equal(r.machineCapacity,4);
  for(const node of r.map.filter(n=>n.act===3&&n.layer===5))assert.ok(node.preview.includes('第3波【'));
});

test('final board settles each family exactly once, with explicit branch selection and no replay',()=>{
  const r=prep();ok(spin(r));setBoard(r,rank3Board);assert.equal(getSlotWins(r)[0].lineCount,3);
  const before=serializeRun(r);assert.equal(claimSpin(r).ok,false);assert.equal(serializeRun(r),before);
  ok(claimSpin(r,{SK:'A'}));assert.equal(r.staging.length,1);assert.equal(r.staging[0].templateId,'U_SK_3A');
  const after=serializeRun(r);assert.equal(claimSpin(r,{SK:'A'}).ok,false);assert.equal(serializeRun(r),after);
});

test('paid spin failure is atomic including RNG; free roll and paid caps stay separate',()=>{
  const r=prep();r.bones=0;ok(spin(r));setBoard(r,emptyBoard);claimDefault(r);const saved=serializeRun(r);assert.equal(spin(r).ok,false);assert.equal(serializeRun(r),saved);
  r.bones=100;for(const expected of [3,5,8]){assert.equal(spinCost(r),expected);ok(spin(r));setBoard(r,emptyBoard);claimDefault(r)}assert.equal(spinCost(r),null);assert.equal(spin(r).ok,false);
});

test('all machine board tools obey ownership, costs, source-once and two-intervention cap',()=>{
  const cases:[string,SlotIntervention][]=[
    ['R_M01',{kind:'lockColumn',index:1}],['R_M02',{kind:'swap',a:0,b:1}],['R_M03',{kind:'copy',a:0,b:1}],
    ['R_M04',{kind:'rotateColumn',index:0}],['R_M05',{kind:'rerollCell',index:0}],['R_M06',{kind:'swapColumns',a:0,b:2}],
    ['R_M07',{kind:'rotateCorners'}],['R_M08',{kind:'copy',a:0,b:4}],['R_M09',{kind:'rerollRow',index:0}],
  ];
  for(const [id,action]of cases){const r=prep(id);r.bones=100;r.machineRelics=[id];owned(r,id);ok(spin(r));const old=r.slot!.board.slice();ok(intervene(r,action,id));assert.equal(r.slot!.interventions,1);assert.equal(r.staging.length,0);if(action.kind==='lockColumn')for(const i of [1,4,7])assert.equal(r.slot!.board[i],old[i]);const before=serializeRun(r);assert.equal(intervene(r,action,id).ok,false);assert.equal(serializeRun(r),before)}
  const r=prep('limit');r.bones=100;owned(r,'R_M05');r.machineRelics.push('R_M05');r.items.I04=1;ok(spin(r));ok(intervene(r,{kind:'lockColumn',index:0},'R_M01'));ok(intervene(r,{kind:'rerollCell',index:8},'R_M05'));assert.equal(useItem(r,'I04',{a:0,b:1}).ok,false);assert.equal(r.items.I04,1);assert.ok(interventionOptions(r).every(o=>!o.available));
});

test('training cannot raise birth rank; same-family better-body fusion transfers max XP without duplication',()=>{
  const r=prep();const recipient=r.army[0];const donor=makeUnit('U_SK_2A',`u${r.nextUid++}`,30);r.staging.push(donor);ok(sacrifice(r,donor.uid,recipient.uid));assert.equal(getUnit(recipient.templateId).rank,1);
  const current=r.army.find(u=>u.uid===recipient.uid)!;assert.equal(current.xp,27);current.xp=50;current.specialization='A';
  const body=makeUnit('U_SK_3B',`u${r.nextUid++}`,76);r.staging.push(body);ok(fuseBodies(r,current.uid,body.uid));const fused=r.army.find(u=>u.uid===current.uid)!;assert.equal(fused.templateId,'U_SK_3B');assert.equal(fused.xp,76);assert.equal(fused.specialization,null);assert.equal(r.staging.length,0);ok(chooseSpecialization(r,fused.uid,'B'));assert.equal(chooseSpecialization(r,fused.uid,'A').ok,false);
});

test('capacity expands4 to8 with full costs; staging and occupied drops never silently destroy soldiers',()=>{
  const r=prep();r.bones=200;for(const cost of [16,24,32,42]){assert.equal(expansionCost(r),cost);ok(expandCapacity(r))}assert.equal(r.capacity,8);assert.equal(r.bones,86);assert.equal(expandCapacity(r).ok,false);
  const u=makeUnit('U_SK_1',`u${r.nextUid++}`);r.staging.push(u);ok(deployUnit(r,u.uid,0));assert.equal(r.army.length,4);assert.equal(reserveUnits(r).length,1);
  while(reserveUnits(r).length<8)r.army.push(makeUnit('U_SK_1',`u${r.nextUid++}`));const extra=makeUnit('U_SK_1',`u${r.nextUid++}`);r.staging.push(extra);const before=serializeRun(r);assert.equal(deployUnit(r,extra.uid,0).ok,false);assert.equal(serializeRun(r),before);assert.equal(benchUnit(r,extra.uid).ok,false);ok(dismissUnit(r,extra.uid));
});

test('I01 and M14 do not stack promotion into extra XP; armed items consume only when spinning',()=>{
  const r=prep();owned(r,'R_M14');r.machineRelics.push('R_M14');r.items.I01=2;
  ok(useItem(r,'I01',{family:'SK'}));assert.equal(r.items.I01,2);ok(cancelQueuedItems(r));assert.equal(r.items.I01,2);
  ok(useItem(r,'I01',{family:'SK'}));ok(spin(r));assert.equal(r.items.I01,1);setBoard(r,rank1Board);ok(claimSpin(r,{SK:'A'}));assert.equal(r.staging[0].templateId,'U_SK_2A');assert.equal(r.staging[0].xp,0);
});

test('M10 discount and I02 combine with a minimum1 bone; M18 enables only costly extra spins',()=>{
  const r=prep();r.bones=100;owned(r,'R_M10');owned(r,'R_M18');r.machineCapacity=4;r.machineRelics.push('R_M10','R_M18');r.items.I02=1;
  ok(spin(r));setBoard(r,emptyBoard);claimDefault(r);ok(useItem(r,'I02'));assert.equal(spinCost(r),1);ok(spin(r));setBoard(r,emptyBoard);claimDefault(r);assert.equal(r.items.I02,undefined);
  for(const expected of [5,8,11,14]){assert.equal(spinCost(r),expected);ok(spin(r));setBoard(r,emptyBoard);claimDefault(r)}assert.equal(spinCost(r),null);
});

test('M11 empty refund is paid-only and once per wave, M15 barrier never stacks',()=>{
  const r=prep();r.bones=100;r.machineRelics=['R_M11','R_M15'];owned(r,'R_M11');owned(r,'R_M15');
  ok(spin(r));setBoard(r,emptyBoard);claimDefault(r);assert.equal(r.bones,100);assert.equal(r.waveBuffs.filter(b=>b.type==='phylacteryBarrier').length,1);
  ok(spin(r));setBoard(r,emptyBoard);claimDefault(r);assert.equal(r.bones,98);
  ok(spin(r));setBoard(r,emptyBoard);claimDefault(r);assert.equal(r.bones,93);assert.equal(r.waveBuffs.filter(b=>b.type==='phylacteryBarrier').length,1);
});

test('temporary weighting is valid, node-only and locks at first spin',()=>{
  const r=prep();owned(r,'R_M17');r.machineRelics.push('R_M17');const from=r.familyWeights[0].family,to=r.familyWeights[1].family;
  ok(transferWeight(r,from,to,2,'relic'));assert.deepEqual(r.familyWeights.map(w=>w.weight),[5,5,5,5]);assert.deepEqual(activeWeights(r).map(w=>w.weight),[3,7,5,5]);ok(spin(r));assert.equal(transferWeight(r,to,from,2,'relic').ok,false);
});

test('shop stock is seeded, refreshes cost money, no double buys, and every service can exit',()=>{
  const a=createRun('shop-stock'),b=createRun('shop-stock');fixtureService(a,'shop');fixtureService(b,'shop');assert.deepEqual(a.shopStock,b.shopStock);a.bones=200;
  const offer=a.shopStock[0];ok(buyShop(a,offer.id));const cash=a.bones;assert.equal(buyShop(a,offer.id).ok,false);assert.equal(a.bones,cash);const stock=a.shopStock.map(x=>x.id);assert.equal(refreshCost(a),4);ok(refreshShop(a));assert.notDeepEqual(a.shopStock.map(x=>x.id),stock);ok(leaveService(a));
});

test('shop refresh cap and unique offer receipts cannot be replayed into free stock or money',()=>{
  const r=createRun('shop-refresh-audit');fixtureService(r,'shop');r.bones=100;
  const purchased=r.shopStock.find(o=>o.kind==='relic')!;ok(buyShop(r,purchased.id));
  const afterPurchase=r.bones,ids=new Set(r.shopStock.map(o=>o.id));
  for(const cost of [4,7,10]){assert.equal(refreshCost(r),cost);const before=r.bones;ok(refreshShop(r));assert.equal(r.bones,before-cost);assert.ok(r.shopStock.every(o=>!ids.has(o.id)));r.shopStock.forEach(o=>ids.add(o.id));assert.ok(r.shopStock.every(o=>o.contentId!==purchased.contentId))}
  assert.equal(r.bones,afterPurchase-21);const snapshot=serializeRun(r);
  assert.equal(refreshCost(r),null);assert.equal(refreshShop(r).ok,false);assert.equal(buyShop(r,purchased.id).ok,false);assert.equal(serializeRun(r),snapshot);
  const oldNode=r.currentNodeId!;ok(leaveService(r));const afterLeave=serializeRun(r);assert.equal(chooseNode(r,oldNode).ok,false);assert.equal(serializeRun(r),afterLeave);
});

test('grave training and workshop changes are once-only, paid atomically, and preserve existing army',()=>{
  const r=createRun('workshop-grave');fixtureService(r,'grave');const uid=r.army[0].uid;ok(restAtGrave(r,'train',uid));assert.equal(r.army[0].xp,12);assert.equal(restAtGrave(r,'heal').ok,false);ok(leaveService(r));
  fixtureService(r,'workshop');r.bones=30;const oldTemplates=r.army.map(u=>u.templateId);const inactive:FamilyId[]=['SK','ZM','HR','HD','BL','CF'].filter(f=>!r.familyWeights.some(w=>w.family===f)) as FamilyId[];ok(replaceFamily(r,r.familyWeights[0].family,inactive[0]));assert.deepEqual(r.army.map(u=>u.templateId),oldTemplates);assert.equal(r.bones,22);assert.equal(reconfigureWeights(r,r.familyWeights).ok,false);ok(leaveService(r));
});

test('full equipment and full item inventory never softlock reward departure',()=>{
  const r=prep();const node=currentNode(r)!;r.phase='reward';node.completed=true;
  const armyRelics=RELICS.filter(x=>x.type==='army').slice(0,7).map(x=>x.id);r.ownedRelics.push(...armyRelics.slice(0,6));r.armyRelics=armyRelics.slice(0,6);r.rewardChoices=[{id:armyRelics[6],kind:'relic',relicId:armyRelics[6],label:'test'}];
  ok(chooseReward(r,armyRelics[6]));assert.ok(unequippedRelics(r).includes(armyRelics[6]));assert.equal(r.phase,'map');ok(equipRelic(r,armyRelics[6],armyRelics[0]));
  r.phase='reward';r.items={I02:3,I03:3,I04:3};r.rewardChoices=[];const before=serializeRun(r);assert.equal(chooseReward(r,'voucher').ok,false);assert.equal(serializeRun(r),before);ok(chooseReward(r,'skip'));assert.equal(r.phase,'map');
});

test('every event is a single atomic transaction and leave remains possible',()=>{
  const r=createRun('events');fixtureService(r,'event');r.eventId='EV02';r.hp=30;r.bones=10;ok(chooseEvent(r,'b'));assert.equal(r.hp,26);assert.equal(r.bones,16);const before=serializeRun(r);assert.equal(chooseEvent(r,'a').ok,false);assert.equal(serializeRun(r),before);ok(leaveService(r));
});

test('all eight event transactions reject every repeat choice including leaving and re-entering',()=>{
  for(let number=1;number<=8;number++){
    const r=createRun('events');fixtureService(r,'event');r.eventId=`EV${String(number).padStart(2,'0')}`;r.bones=100;r.hp=35;
    const options={from:r.familyWeights[0].family,to:r.familyWeights[1].family,uids:r.army.map(u=>u.uid)};
    ok(chooseEvent(r,'a',r.army[0].uid,options));const snapshot=serializeRun(r);
    for(const choice of ['a','b','c'] as const){assert.equal(chooseEvent(r,choice,r.army[0].uid,options).ok,false);assert.equal(serializeRun(r),snapshot)}
    const oldNode=r.currentNodeId!;ok(leaveService(r));const afterLeave=serializeRun(r);assert.equal(chooseNode(r,oldNode).ok,false);assert.equal(serializeRun(r),afterLeave);
  }
});

test('wave payout cannot replay; ordinary retreat preserves earlier rewards but no completion reward',()=>{
  const r=prep();readyWave(r);const battle=resultFixture(r);ok(finishWave(r,battle));const after=serializeRun(r);assert.equal(finishWave(r,battle).ok,false);assert.equal(serializeRun(r),after);ok(continueAfterWave(r));assert.equal(r.wave,2);const beforeSecond=r.bones;
  readyWave(r);ok(finishWave(r,resultFixture(r,'retreat',8)));assert.equal(r.bones,beforeSecond);ok(continueAfterWave(r));assert.equal(r.phase,'map');assert.equal(r.claimedNodeKeys.length,0);assert.equal(currentNode(r)!.completed,false);
});

test('all three chapters can traverse36 legal campaign waves and21 nodes without UI softlocks',()=>{
  const r=createRun('full-campaign');let safety=0;
  while(r.phase!=='victory'&&r.phase!=='defeat'&&safety++<250){
    if(r.phase==='map')ok(chooseNode(r,availableNodes(r)[0].id));
    else if(r.phase==='prep'){readyWave(r);ok(finishWave(r,resultFixture(r)))}
    else if(r.phase==='waveResult')ok(continueAfterWave(r));
    else if(r.phase==='reward')ok(chooseReward(r,'skip'));
    else if(['shop','grave','workshop','event'].includes(r.phase))ok(leaveService(r));
    else assert.fail('unexpected phase '+r.phase);
  }
  assert.equal(r.phase,'victory');assert.equal(r.runStats.wavesWon,36);assert.equal(r.runStats.wavesPlayed,36);assert.equal(r.runStats.nodesCompleted,21);assert.equal(r.machineCapacity,4);assert.equal(validateRun(r).ok,true);
});

test('save round-trip includes deterministic open board and rejects malformed state',()=>{
  const r=prep('save');ok(spin(r));ok(intervene(r,{kind:'lockColumn',index:1},'R_M01'));const saved=serializeRun(r);const loaded=deserializeRun(saved);assert.ok(loaded);assert.equal(serializeRun(loaded),saved);assert.deepEqual(getSlotWins(loaded),getSlotWins(r));
  const broken=JSON.parse(saved);broken.bones=-1;assert.equal(deserializeRun(JSON.stringify(broken)),null);assert.equal(deserializeRun('{'),null);
});

test('partial saves reject missing ledgers, invalid counters, offers, enemy IDs, and snapshot stats',()=>{
  const r=prep('partial-save');readyWave(r);const live=createBattle(getCombatInput(r));stepBattle(live,.75);const text=serializeRun(r,live);
  const mutations:((d:RunState)=>void)[]=[d=>{delete (d as Partial<RunState>).runStats},d=>{delete (d.waveState as Partial<typeof d.waveState>).itemUses},d=>{d.waveState.paidSpins=-1},d=>{d.nodeState.shopRefreshes=4},d=>{d.map[0].waves[0][0].templateId='NO_ENEMY'},d=>{d.shopStock=[{id:'bad',kind:'item',contentId:'NO_ITEM',price:1,sold:false}]},d=>{delete (d.battleSnapshot as Partial<BattleState>).stats}];
  for(const mutate of mutations){const parsed=JSON.parse(text) as RunState;mutate(parsed);assert.equal(deserializeRun(JSON.stringify(parsed)),null)}
});

test('a real live battle resumes from save with identical positions, RNG, effects and cooldowns',()=>{
  const r=prep('exact-resume');readyWave(r);const a=createBattle(getCombatInput(r));stepBattle(a,11.35);
  const loaded=deserializeRun(serializeRun(r,a));assert.ok(loaded?.battleSnapshot);const b=loaded!.battleSnapshot!;
  for(let i=0;i<50;i++){stepBattle(a,.05);stepBattle(b,.05)}
  // JSON saves omit undefined optional effect fields; compare the persisted form.
  assert.deepEqual(JSON.parse(JSON.stringify(b)),JSON.parse(JSON.stringify(a)));
});

test('starting combat releases unspent pull reservations without consuming inventory or blocking live items',()=>{
  const r=prep('release-queued');ok(spin(r));claimDefault(r);settleStaging(r);r.items={I01:1,I02:1,I11:1};
  ok(useItem(r,'I01',{family:'SK'}));ok(useItem(r,'I02'));assert.equal(r.waveState.itemUses,0);ok(startWave(r));
  assert.equal(r.waveState.queuedFamily,null);assert.equal(r.waveState.queuedOil,false);assert.deepEqual(r.items,{I01:1,I02:1,I11:1});
  const b=liveBattleFixture(r);ok(useItem(r,'I11',{uid:r.army[0].uid,battle:b}));assert.equal(r.waveState.itemUses,1);
});

test('full item bags and invalid relic replacement fail shop purchases without payment or sold flags',()=>{
  const r=createRun('shop-atomic');fixtureService(r,'shop');r.bones=100;const item=r.shopStock.find(o=>o.kind==='item')!;
  r.items={[item.contentId]:3};const before=serializeRun(r);assert.equal(buyShop(r,item.id).ok,false);assert.equal(serializeRun(r),before);
  const relic=r.shopStock.find(o=>o.kind==='relic')!;assert.equal(buyShop(r,relic.id,'NO_RELIC').ok,false);assert.equal(serializeRun(r),before);
});

test('battle snapshot and prep consumables preserve source, UID and per-wave limits',()=>{
  const r=prep();r.items={I07:1,I08:1,I11:1};const uid=r.army[0].uid;ok(useItem(r,'I07',{uid}));ok(useItem(r,'I08',{uid}));assert.equal(r.waveBuffs.length,2);readyWave(r);const battle=resultFixture(r);battle.result=null;
  const revived=deserializeRun(serializeRun(r,battle));assert.ok(revived?.battleSnapshot);assert.equal(revived!.battleSnapshot!.input.seed,battle.input.seed);assert.equal(useItem(r,'I11',{uid,battle}).ok,false);assert.equal(r.items.I11,1);
});

test('all prep consumables target valid units and I10 remains once per node across waves',()=>{
  const training=prep('training-item');training.items={I06:2,I09:1};const uid=training.army[0].uid;
  ok(useItem(training,'I06',{uid}));assert.equal(training.army[0].xp,6);assert.equal(useItem(training,'I06',{uid}).ok,false);ok(useItem(training,'I09',{uid}));assert.ok(training.waveBuffs.some(b=>b.type==='poisonFirstHits'&&b.uid===uid));
  const healing=prep('hp-item');healing.hp=50;healing.items={I10:2};ok(useItem(healing,'I10'));assert.equal(healing.hp,54);readyWave(healing);ok(finishWave(healing,resultFixture(healing)));ok(continueAfterWave(healing));assert.equal(useItem(healing,'I10').ok,false);assert.equal(healing.items.I10,1);
});

test('I03 I04 I05 edit only pending boards and consume their actual inventory',()=>{
  const cases:[string,{index?:number;a?:number;b?:number}][]=[['I03',{index:0}],['I04',{a:0,b:1}],['I05',{a:0,b:1}]];
  for(const [id,args]of cases){const r=prep(id);r.items={[id]:1};assert.equal(useItem(r,id,args).ok,false);ok(spin(r));ok(useItem(r,id,args));assert.equal(r.items[id],undefined);assert.equal(r.slot!.interventions,1);assert.equal(r.staging.length,0)}
});

function liveBattleFixture(run:RunState):BattleState {
  const battle=resultFixture(run);battle.result=null;const source=run.army[0];const def=getUnit(source.templateId);
  battle.units=[{id:'ally-test',sourceUid:source.uid,templateId:source.templateId,name:def.name,family:def.family,side:'ally',x:10,y:4,hp:50,maxHp:100,atk:10,armor:0,aps:1,range:1,move:2,critRate:0,critMult:1.5,blockRate:0,blockReduction:0,lifesteal:0,regen:0,damageType:'PHY',shield:0,alive:true,temporary:false,boss:false,rank:1,level:1,specialization:null,action:'idle',facing:1,statuses:[],attackTimer:0,age:0,counters:{},cooldowns:{},damageDone:0,healingDone:0,shieldGiven:0,kills:0,summons:0}];
  return battle;
}
test('battle items validate live target and corpse, enqueue once, and never spend on invalid use',()=>{
  const heal=prep('battle-heal');heal.items={I11:2};readyWave(heal);const battle=liveBattleFixture(heal),uid=heal.army[0].uid;
  ok(useItem(heal,'I11',{uid,battle}));assert.equal(heal.items.I11,1);assert.equal(battle.input.buffs.filter(b=>b.type==='itemHeal').length,1);assert.equal(useItem(heal,'I11',{uid,battle}).ok,false);
  const blast=prep('battle-blast');blast.items={I12:1};readyWave(blast);const b=liveBattleFixture(blast),id=blast.army[0].uid;const saved=serializeRun(blast);assert.equal(useItem(blast,'I12',{uid:id,battle:b}).ok,false);assert.equal(serializeRun(blast),saved);
  b.corpses.push({id:'corpse-test',x:11,y:4,side:'enemy',consumed:false,createdAt:0,templateId:'E01'});ok(useItem(blast,'I12',{uid:id,battle:b}));assert.equal(blast.items.I12,undefined);assert.equal(b.input.buffs.filter(x=>x.type==='itemCorpseExplosion').length,1);
});

test('relic pool exhaustion falls back to one bone option and can settle only once',()=>{
  const r=prep('exhausted');r.ownedRelics=RELICS.map(x=>x.id);
  for(let i=0;i<3;i++){readyWave(r);ok(finishWave(r,resultFixture(r)));ok(continueAfterWave(r))}
  assert.equal(r.phase,'reward');assert.deepEqual(r.rewardChoices.map(x=>x.id),['bones']);const old=r.bones;ok(chooseReward(r,'bones'));assert.equal(r.bones,old+6);assert.equal(chooseReward(r,'bones').ok,false);
});

test('boss failure in the first wave ends the run rather than skipping the chapter',()=>{
  const r=createRun('boss-failure');fixtureService(r,'boss');readyWave(r);ok(finishWave(r,resultFixture(r,'retreat',2)));ok(continueAfterWave(r));assert.equal(r.phase,'defeat');assert.equal(r.act,1);assert.equal(r.machineCapacity,2);
});

test('M17 temporary weights vanish when its source is removed before node lock',()=>{
  const r=prep('weight-source');owned(r,'R_M17');r.machineRelics.push('R_M17');const [a,b]=r.familyWeights;
  ok(transferWeight(r,a.family,b.family,2,'relic'));ok(unequipRelic(r,'R_M17'));assert.deepEqual(activeWeights(r),r.familyWeights);ok(spin(r));assert.equal(equipRelic(r,'R_M17').ok,false);
});

test('M12 multi-family opening movement and M13/M16 recruit buffs reach only deployed owners',()=>{
  const multi=prep('multi-family');owned(multi,'R_M12');multi.machineRelics=['R_M12'];ok(spin(multi));setBoard(multi,['SK','SK','SK','CF','CF','CF','BL','HD','BL']);claimDefault(multi);
  assert.equal(multi.waveBuffs.filter(b=>b.type==='openingMove').length,1);
  const recruit=prep('recruit-buffs');owned(recruit,'R_M13');owned(recruit,'R_M16');recruit.machineRelics=['R_M13','R_M16'];ok(spin(recruit));setBoard(recruit,rank3Board);ok(claimSpin(recruit,{SK:'A'}));const uid=recruit.staging[0].uid;ok(deployUnit(recruit,uid,3));
  assert.ok(getCombatInput(recruit).buffs.some(b=>b.type==='openingShield'&&b.uid===uid&&b.value===15));assert.ok(getCombatInput(recruit).buffs.some(b=>b.type==='damageMultiplier'&&b.uid===uid&&b.value===.15));
  ok(benchUnit(recruit,uid));assert.equal(getCombatInput(recruit).buffs.filter(b=>b.uid===uid).length,0);
});

test('M13 two-recipient limit counts actual deployed recruits, not sacrificed or reserve candidates',()=>{
  const r=prep('crown-deployed-limit');r.bones=100;owned(r,'R_M13');r.machineRelics=['R_M13'];const oldUid=r.army[0].uid;
  for(let i=0;i<3;i++){
    ok(spin(r));setBoard(r,rank3Board);ok(claimSpin(r,{SK:'A'}));const uid=r.staging[0].uid;
    if(i<2)ok(sacrifice(r,uid,oldUid));else ok(deployUnit(r,uid,3));
  }
  const buffs=getCombatInput(r).buffs.filter(b=>b.source==='R_M13');assert.equal(buffs.length,1);assert.equal(buffs[0].uid,r.army.find(u=>u.slot===3)!.uid);assert.notEqual(buffs[0].uid,oldUid);
  const fresh=prep('crown-cap');fresh.bones=100;owned(fresh,'R_M13');fresh.machineRelics=['R_M13'];
  for(let i=0;i<3;i++){ok(spin(fresh));setBoard(fresh,rank3Board);ok(claimSpin(fresh,{SK:'A'}));ok(deployUnit(fresh,fresh.staging[0].uid,i))}
  assert.equal(getCombatInput(fresh).buffs.filter(b=>b.source==='R_M13').length,2);
});

test('eight lines grant one R4 at Lv8 and require its own specialization before combat',()=>{
  const r=prep('jackpot');ok(spin(r));setBoard(r,Array(9).fill('SK') as FamilyId[]);claimDefault(r);assert.equal(r.staging.length,1);const uid=r.staging[0].uid;assert.equal(getUnit(r.staging[0].templateId).rank,4);assert.equal(r.staging[0].xp,xpForLevel(8));ok(deployUnit(r,uid,3));assert.equal(canStartWave(r).ok,false);ok(chooseSpecialization(r,uid,'A'));assert.equal(canStartWave(r).ok,true);
});

test('stopped board materializes real units into free slots exactly once without finalizing receipts',()=>{
  const r=prep('auto-birth');const old=structuredClone(r.army);ok(spin(r));setBoard(r,rank1Board);const rng=r.rngState;
  ok(materializeSpin(r));assert.equal(r.army.length,4);assert.equal(r.staging.length,0);assert.deepEqual(r.army.slice(0,3),old);
  const uid=r.slot!.provisionalUids![0];assert.equal(findUnit(r,uid)!.slot,3);assert.equal(r.slot!.settled,false);assert.equal(r.slot!.materialized,true);
  assert.equal(r.runStats.unitsSummoned,3);assert.equal(r.waveState.newUnits.length,0);assert.equal(r.rngState,rng);
  const nextUid=r.nextUid;ok(materializeSpin(r));assert.equal(r.nextUid,nextUid);assert.deepEqual(r.slot!.provisionalUids,[uid]);assert.equal(r.army.length,4);
  ok(sealSpin(r));assert.equal(r.runStats.unitsSummoned,4);assert.deepEqual(r.waveState.newUnits,[uid]);assert.equal(r.slot!.sealedRevision,0);
  const saved=serializeRun(r);ok(sealSpin(r));assert.equal(serializeRun(r),saved);assert.equal(materializeSpin(r).ok,false);
});

test('full deployment sends every new family to visible staging and never replaces an older soldier',()=>{
  const r=prep('full-auto-birth');r.army.push(makeUnit('U_HD_1',`u${r.nextUid++}`,0,3));const old=structuredClone(r.army);
  ok(spin(r));setBoard(r,['SK','SK','SK','CF','CF','CF','BL','BL','BL']);ok(materializeSpin(r));
  assert.deepEqual(r.army,old);assert.equal(r.staging.length,3);assert.deepEqual(r.staging.map(u=>getUnit(u.templateId).family).sort(),['BL','CF','SK']);
  assert.ok(r.staging.every(u=>u.slot===null));assert.equal(canStartWave(r).ok,false);
  const saved=serializeRun(r);assert.equal(startWave(r).ok,false);assert.equal(serializeRun(r),saved);assert.equal(r.slot!.settled,false);
});

test('birth branch chips preserve identity and survive an equal-rank board edit without sealing',()=>{
  const r=prep('birth-branch');r.bones=100;r.machineRelics=['R_M06','R_M08'];owned(r,'R_M06');owned(r,'R_M08');
  ok(spin(r));setBoard(r,rank3Board);ok(materializeSpin(r));const uid=r.slot!.provisionalUids![0],before=structuredClone(findUnit(r,uid)!);
  assert.equal(before.templateId,'U_SK_3A');ok(chooseBirthBranch(r,uid,'B'));
  assert.deepEqual(findUnit(r,uid),{...before,templateId:'U_SK_3B'});assert.equal(r.slot!.settled,false);
  const saved=serializeRun(r);assert.equal(chooseBirthBranch(r,r.army[0].uid,'B').ok,false);assert.equal(serializeRun(r),saved);
  ok(intervene(r,{kind:'swapColumns',a:0,b:2},'R_M06'));
  const replacement=r.slot!.provisionalUids![0];assert.notEqual(replacement,uid);assert.equal(findUnit(r,uid),undefined);assert.equal(findUnit(r,replacement)!.templateId,'U_SK_3B');
  const afterEdit=serializeRun(r);assert.equal(deployUnit(r,uid,0).ok,false);assert.equal(serializeRun(r),afterEdit);
  ok(intervene(r,{kind:'copy',a:6,b:4},'R_M08'));assert.equal(findUnit(r,r.slot!.provisionalUids![0])!.templateId,'U_SK_1');assert.equal(r.slot!.revision,2);
  assert.equal(chooseBirthBranch(r,r.slot!.provisionalUids![0],'B').ok,false);assert.equal(r.runStats.unitsSummoned,3);
});

test('winning to empty to winning rebuild cannot duplicate units, refunds, barriers or summon statistics',()=>{
  const r=prep('rebuild-receipts');r.bones=100;r.machineCapacity=4;r.machineRelics=['R_M02','R_M11','R_M15'];for(const id of r.machineRelics)owned(r,id);r.items.I04=1;
  ok(spin(r));setBoard(r,rank1Board);claimDefault(r);ok(sacrifice(r,r.staging[0].uid,r.army[0].uid));
  ok(spin(r));setBoard(r,rank1Board);ok(materializeSpin(r));const oldUid=r.slot!.provisionalUids![0],summoned=r.runStats.unitsSummoned,bones=r.bones;
  ok(intervene(r,{kind:'swap',a:2,b:5},'R_M02'));assert.equal(r.slot!.provisionalUids!.length,0);assert.equal(findUnit(r,oldUid),undefined);assert.equal(r.bones,bones-1);
  assert.equal(r.waveState.refundUsed,false);assert.equal(r.waveBuffs.some(b=>b.source==='R_M15'),false);
  ok(useItem(r,'I04',{a:2,b:5}));assert.equal(r.slot!.provisionalUids!.length,1);assert.ok(Number(r.slot!.provisionalUids![0].slice(1))>Number(oldUid.slice(1)));
  assert.equal(r.runStats.unitsSummoned,summoned);assert.equal(r.items.I04,undefined);assert.equal(r.slot!.settled,false);
  const beforeFailure=serializeRun(r);assert.equal(intervene(r,{kind:'swap',a:2,b:5},'R_M02').ok,false);assert.equal(serializeRun(r),beforeFailure);
  ok(sealSpin(r));assert.equal(r.runStats.unitsSummoned,summoned+1);assert.equal(r.waveState.refundUsed,false);assert.equal(r.waveBuffs.some(b=>b.source==='R_M15'),false);
});

test('a sealed empty board pays its refund and barrier once, including next-pull affordability',()=>{
  const r=prep('refund-affordability');r.bones=7;r.machineRelics=['R_M11','R_M15'];for(const id of r.machineRelics)owned(r,id);
  ok(spin(r));setBoard(r,rank1Board);claimDefault(r);ok(sacrifice(r,r.staging[0].uid,r.army[0].uid));
  ok(spin(r));setBoard(r,emptyBoard);ok(materializeSpin(r));assert.equal(r.bones,4);assert.equal(spinCost(r),5);assert.equal(r.waveState.refundUsed,false);
  const saved=serializeRun(r);assert.equal(canSpin(r).ok,true);assert.equal(serializeRun(r),saved);
  ok(spin(r));assert.equal(r.bones,0);assert.equal(r.waveState.refundUsed,true);assert.equal(r.waveBuffs.filter(b=>b.source==='R_M15').length,1);
  setBoard(r,emptyBoard);ok(materializeSpin(r));ok(sealSpin(r));assert.equal(r.bones,0);assert.equal(r.waveBuffs.filter(b=>b.source==='R_M15').length,1);
});

test('invalid management, impossible payment and invalid edits leave births and seal state untouched',()=>{
  const r=prep('failed-birth-actions');ok(spin(r));setBoard(r,rank3Board);ok(materializeSpin(r));const uid=r.slot!.provisionalUids![0];
  const failures=[()=>deployUnit(r,uid,8),()=>deployUnit(r,uid,3),()=>sacrifice(r,uid,uid),()=>fuseBodies(r,r.army[1].uid,uid),()=>chooseSpecialization(r,uid,'A'),()=>expandCapacity(r),()=>useItem(r,'I06',{uid}),()=>intervene(r,{kind:'lockColumn',index:99},'R_M01')];
  for(const action of failures){const saved=serializeRun(r);assert.equal(action().ok,false);assert.equal(serializeRun(r),saved);assert.equal(r.slot!.settled,false)}
  r.bones=0;const saved=serializeRun(r);assert.equal(canSpin(r).ok,false);assert.equal(spin(r).ok,false);assert.equal(serializeRun(r),saved);
});

test('successful management seals before touching real new soldiers and excludes later board edits',()=>{
  const actions:((r:RunState,uid:string)=>ActionResult)[]=[
    (r,uid)=>deployUnit(r,uid,0),(r,uid)=>benchUnit(r,uid),(r,uid)=>dismissUnit(r,uid),(r,uid)=>sacrifice(r,uid,r.army[0].uid),
    r=>expandCapacity(r),(r,uid)=>useItem(r,'I06',{uid}),(r,uid)=>useItem(r,'I07',{uid}),r=>useItem(r,'I01',{family:'SK'}),r=>useItem(r,'I02'),
  ];
  for(const [index,action]of actions.entries()){
    const r=prep(`manage-seal-${index}`);r.bones=100;r.items={I06:1,I07:1,I01:1};if(index===8)r.items={I02:1};
    ok(spin(r));setBoard(r,rank1Board);ok(materializeSpin(r));const uid=r.slot!.provisionalUids![0];ok(action(r,uid));
    assert.equal(r.slot!.settled,true);assert.equal(r.runStats.unitsSummoned,4);assert.equal(r.slot!.provisionalUids!.length,0);
    const saved=serializeRun(r);assert.equal(intervene(r,{kind:'lockColumn',index:0},'R_M01').ok,false);assert.equal(serializeRun(r),saved);
  }
});

test('absorption, fusion, training and high-level birth identify newly unlocked specializations',()=>{
  const absorbed=prep('absorb-specialization');absorbed.army[0].xp=20;ok(spin(absorbed));setBoard(absorbed,rank3Board);ok(materializeSpin(absorbed));
  const recipient=absorbed.army[0].uid,donor=absorbed.slot!.provisionalUids![0];const result=sacrifice(absorbed,donor,recipient);ok(result);assert.deepEqual(result.newlySpecializableUids,[recipient]);assert.equal(findUnit(absorbed,donor),undefined);
  const fused=prep('fusion-specialization');fused.army[0].xp=30;fused.army[0].specialization='A';ok(spin(fused));setBoard(fused,rank3Board);ok(materializeSpin(fused));
  const body=fused.slot!.provisionalUids![0],kept=fused.army[0].uid;ok(chooseBirthBranch(fused,body,'B'));const fusion=fuseBodies(fused,kept,body);ok(fusion);assert.deepEqual(fusion.newlySpecializableUids,[kept]);assert.equal(findUnit(fused,kept)!.templateId,'U_SK_3B');assert.equal(findUnit(fused,kept)!.xp,30);assert.equal(findUnit(fused,body),undefined);
  const trained=prep('item-specialization');trained.army[0].xp=25;trained.items.I06=1;const training=useItem(trained,'I06',{uid:trained.army[0].uid});ok(training);assert.deepEqual(training.newlySpecializableUids,[trained.army[0].uid]);
  const born=prep('birth-specialization');ok(spin(born));setBoard(born,Array(9).fill('SK'));const birth=materializeSpin(born);ok(birth);assert.deepEqual(birth.newlySpecializableUids,born.slot!.provisionalUids);assert.equal(canStartWave(born).ok,false);
  ok(chooseSpecialization(born,born.slot!.provisionalUids![0],'B'));assert.equal(born.slot!.settled,true);assert.equal(canStartWave(born).ok,true);
});

test('recruit buffs wait for seal and combat input is created from the same final unit snapshot',()=>{
  const r=prep('birth-combat-input');r.machineRelics=['R_M13','R_M16'];for(const id of r.machineRelics)owned(r,id);
  ok(spin(r));setBoard(r,rank3Board);ok(materializeSpin(r));const uid=r.slot!.provisionalUids![0];assert.equal(r.waveBuffs.length,0);assert.equal(canStartWave(r).ok,true);
  const saved=serializeRun(r),projected=getCombatInput(r);assert.equal(serializeRun(r),saved);assert.equal(projected.buffs.filter(b=>b.uid===uid).length,2);
  ok(startWave(r));assert.equal(r.slot!.settled,true);assert.deepEqual(r.pendingCombatInput,projected);assert.equal(r.runStats.unitsSummoned,4);assert.equal(r.waveState.newUnits.filter(id=>id===uid).length,1);
  const live=createBattle(getCombatInput(r));stepBattle(live,1);assert.ok(live.units.some(u=>u.sourceUid===uid));
});

test('multi-family boost is emitted once and obsolete preview combat inputs never become pending input',()=>{
  const r=prep('multi-auto-birth');r.machineRelics=['R_M12','R_M02'];for(const id of r.machineRelics)owned(r,id);
  ok(spin(r));setBoard(r,['SK','SK','SK','CF','CF','CF','BL','HD','BL']);ok(materializeSpin(r));assert.equal(r.waveBuffs.length,0);
  const staged=r.staging[0].uid;ok(benchUnit(r,staged));assert.equal(r.waveBuffs.filter(b=>b.source==='R_M12').length,1);ok(sealSpin(r));assert.equal(r.waveBuffs.filter(b=>b.source==='R_M12').length,1);
  const changed=prep('preview-input-replaced');changed.machineRelics=['R_M02'];owned(changed,'R_M02');ok(spin(changed));setBoard(changed,rank1Board);ok(materializeSpin(changed));const obsolete=getCombatInput(changed),uid=changed.slot!.provisionalUids![0];
  ok(intervene(changed,{kind:'swap',a:2,b:5},'R_M02'));assert.equal(obsolete.team.some(u=>u.uid===uid),true);ok(startWave(changed));assert.equal(changed.pendingCombatInput!.team.some(u=>u.uid===uid),false);assert.equal(changed.pendingCombatInput!.team.length,3);
});

test('legacy claim stays explicit and modern claim only seals existing units with optional branches',()=>{
  const legacy=prep('legacy-claim');ok(spin(legacy));setBoard(legacy,rank3Board);assert.equal(legacy.slot!.materialized,undefined);assert.equal(claimSpin(legacy).ok,false);ok(claimSpin(legacy,{SK:'B'}));assert.equal(legacy.army.length,3);assert.equal(legacy.staging[0].templateId,'U_SK_3B');
  const modern=prep('modern-claim');ok(spin(modern));setBoard(modern,rank3Board);ok(materializeSpin(modern));const uid=modern.slot!.provisionalUids![0],next=modern.nextUid;ok(claimSpin(modern,{SK:'B'}));assert.equal(modern.nextUid,next);assert.equal(modern.army.length,4);assert.equal(modern.staging.length,0);assert.equal(findUnit(modern,uid)!.templateId,'U_SK_3B');assert.equal(modern.runStats.unitsSummoned,4);assert.equal(claimSpin(modern,{SK:'A'}).ok,false);
});

test('unsealed births roundtrip with their exact identity and edits while malformed receipts are rejected',()=>{
  const r=prep('birth-save');r.machineRelics=['R_M06'];owned(r,'R_M06');ok(spin(r));setBoard(r,rank3Board);ok(materializeSpin(r));ok(chooseBirthBranch(r,r.slot!.provisionalUids![0],'B'));
  const saved=serializeRun(r),loaded=deserializeRun(saved)!;assert.ok(loaded);assert.equal(serializeRun(loaded),saved);
  for(const target of [r,loaded])ok(intervene(target,{kind:'swapColumns',a:0,b:2},'R_M06'));assert.equal(serializeRun(r),serializeRun(loaded));
  for(const breakSave of [
    (d:RunState)=>{d.slot!.provisionalUids!.push('u999')},
    (d:RunState)=>{d.slot!.provisionalSnapshot=[]},
    (d:RunState)=>{findUnit(d,d.slot!.provisionalUids![0])!.xp++},
    (d:RunState)=>{d.slot!.birthBranches={SK:'U_SK_1'}},
    (d:RunState)=>{d.waveState.newUnits.push(d.slot!.provisionalUids![0])},
  ]){const invalid=structuredClone(r);breakSave(invalid);assert.equal(deserializeRun(JSON.stringify(invalid)),null)}
  ok(sealSpin(r));const finalized=deserializeRun(serializeRun(r))!;const count=finalized.runStats.unitsSummoned;ok(sealSpin(finalized));assert.equal(finalized.runStats.unitsSummoned,count);
  finalized.slot!.sealedRevision=99;assert.equal(deserializeRun(JSON.stringify(finalized)),null);
  const old=prep('old-save');ok(spin(old));const oldText=serializeRun(old);assert.equal(serializeRun(deserializeRun(oldText)!),oldText);
});

test('automatic birth and auto-seal complete every campaign transition without a claim step',()=>{
  let r=createRun('auto-birth-campaign'),guard=0;
  while(r.phase!=='victory'&&guard++<250){
    if(r.phase==='map')ok(chooseNode(r,availableNodes(r)[0].id));
    else if(r.phase==='prep'){ok(spin(r));ok(materializeSpin(r));settleStaging(r);ok(startWave(r));ok(finishWave(r,resultFixture(r)))}
    else if(r.phase==='waveResult')ok(continueAfterWave(r));
    else if(r.phase==='reward')ok(chooseReward(r,'skip'));
    else if(['shop','grave','workshop','event'].includes(r.phase))ok(leaveService(r));
    const saved=serializeRun(r);r=deserializeRun(saved)!;assert.ok(r);
  }
  assert.equal(r.phase,'victory');assert.equal(r.runStats.wavesPlayed,36);assert.equal(r.runStats.nodesCompleted,21);
});
