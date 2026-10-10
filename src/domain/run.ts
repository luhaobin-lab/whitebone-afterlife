import {
  UNITS, RELICS, ITEMS, EVENTS, ENEMIES, getUnit, getRelic, getItem, makeUnit,
  levelForXp, xpForLevel, specializationsFor,
} from '../content';
import { Rng, hashSeed } from './random';
import { analyzeBoard, rollBoard, validateWeights, interventionBoard } from './slot';
import type { SlotIntervention } from './slot';
import { generateCampaignMap } from './campaignMap';
import type {
  FamilyId, UnitInstance, SlotWin, NodeKind, EnemySpawn, WaveBuff,
  CombatInput, BattleState, BattleStats, ActionResult,
} from './types';

export type RunPhase = 'map'|'prep'|'battle'|'waveResult'|'reward'|'shop'|'grave'|'workshop'|'event'|'victory'|'defeat';
export type StarterId = 'legion'|'plague'|'cavalry';
export interface FamilyWeight { family:FamilyId; weight:number }
export interface StarterDefinition {id:StarterId;name:string;description:string;families:FamilyId[];units:string[]}
export interface MapNode {
  id:string;act:number;layer:number;lane:number;kind:NodeKind;name:string;
  links:string[];visited:boolean;completed:boolean;seed:number;waves:EnemySpawn[][];
  preview:string;rewardPreview:string;
}
export interface SlotState {
  id:string;board:FamilyId[];wins:SlotWin[];settled:boolean;paidCost:number;free:boolean;
  interventions:number;usedSources:string[];boostFamily:FamilyId|null;
  /** Absent in legacy saves. A materialized but unsettled board owns reversible births. */
  materialized?:boolean;provisionalUids?:string[];provisionalSnapshot?:UnitInstance[];
  birthBranches?:Partial<Record<FamilyId,string>>;revision?:number;sealedRevision?:number;
}
export interface RewardChoice {id:string;kind:'relic'|'bones';relicId?:string;amount?:number;label:string}
export interface ShopOffer {id:string;kind:'relic'|'item';contentId:string;price:number;sold:boolean}
export interface WaveSummary {result:'win'|'loss'|'retreat';hpLost:number;bones:number;duration:number;stats:BattleStats;nodeComplete:boolean;message:string}
export interface RunStats {spins:number;wavesWon:number;wavesPlayed:number;nodesCompleted:number;unitsSummoned:number;sacrificed:number;fusions:number;bonesEarned:number;bonesSpent:number;kills:number;totalDamage:number;totalHealing:number}
export interface WaveBookkeeping {
  spins:number;paidSpins:number;itemUses:number;battleItemUses:number;usedItemTargets:string[];
  refundUsed:boolean;queuedFamily:FamilyId|null;queuedOil:boolean;newUnits:string[];
}
export interface NodeBookkeeping {
  machineLocked:boolean;temporaryShift:{from:FamilyId;to:FamilyId;amount:number}|null;
  serviceUsed:boolean;shopRefreshes:number;shopWeightUsed:boolean;phylacteryItemUsed:boolean;
  eventBuffs:WaveBuff[];
}
export interface RunState {
  schemaVersion:1;id:string;seed:string;rngState:number;phase:RunPhase;starterId:StarterId;act:number;
  bones:number;hp:number;maxHp:number;capacity:number;reserveCapacity:number;machineCapacity:number;armyRelicCapacity:number;
  army:UnitInstance[];staging:UnitInstance[];familyWeights:FamilyWeight[];ownedRelics:string[];
  machineRelics:string[];armyRelics:string[];items:Record<string,number>;map:MapNode[];
  currentNodeId:string|null;wave:number;slot:SlotState|null;rewardChoices:RewardChoice[];
  shopStock:ShopOffer[];eventId:string|null;waveBuffs:WaveBuff[];battleResult:WaveSummary|null;runStats:RunStats;
  waveState:WaveBookkeeping;nodeState:NodeBookkeeping;nextUid:number;nextSpin:number;
  completedWaveKeys:string[];claimedNodeKeys:string[];seenEvents:string[];
  pendingBossBuffs:WaveBuff[];pendingBossBones:number;pendingCombatInput:CombatInput|null;
  battleSnapshot:BattleState|null;
  lastMessage:string;
}
export interface ItemUseOptions {uid?:string;family?:FamilyId;index?:number;a?:number;b?:number;battle?:BattleState}
export interface InterventionOption {sourceId:string;kind:string;label:string;cost:number;available:boolean;reason?:string}

export const STARTERS:readonly StarterDefinition[] = [
  {id:'legion',name:'骨潮承包商',description:'骨盾守前、棺仆接力、骨铃续航，先体验召唤与保护。',families:['SK','CF','BL','HD'],units:['U_SK_1','U_CF_1','U_BL_1']},
  {id:'plague',name:'瘟疫会计师',description:'双腐尸拖住前排，断手累计命中，向尸毒和死亡传播发展。',families:['ZM','HD','BL','SK'],units:['U_ZM_1','U_ZM_1','U_HD_1']},
  {id:'cavalry',name:'送葬骑行队',description:'丧马冲锋、断手远射、骨铃治疗，向冲锋和暴击切后排发展。',families:['HR','HD','BL','SK'],units:['U_HR_1','U_HD_1','U_BL_1']},
];
const FAMILY_IDS:FamilyId[]=['SK','ZM','HR','HD','BL','CF'];
const MANAGE_PHASES:RunPhase[]=['map','prep','reward','shop','grave','workshop','event'];
const SERVICE_PHASES:RunPhase[]=['shop','grave','workshop','event'];
const PAID_COSTS=[3,5,8,11,14];
const EXPANSION_COSTS=[16,24,32,42];
const SACRIFICE_BASE=[0,2,5,12,25];

class RuleError extends Error {}
function requireRule(condition:unknown,message:string):asserts condition {if(!condition)throw new RuleError(message)}
function success(message:string,sound='confirm'):ActionResult{return {ok:true,message,sound}}
function transaction(run:RunState,action:(draft:RunState)=>ActionResult):ActionResult {
  try {
    const pendingBefore=new Set(pendingSpecializations(run).map(u=>u.uid));
    const draft=structuredClone(run);
    const result=action(draft);
    if(!result.ok)return result;
    const newlySpecializableUids=pendingSpecializations(draft).filter(u=>!pendingBefore.has(u.uid)).map(u=>u.uid);
    if(newlySpecializableUids.length)result.newlySpecializableUids=newlySpecializableUids;
    draft.lastMessage=result.message??'';
    Object.assign(run,draft);
    return result;
  } catch(error) {
    if(error instanceof RuleError)return {ok:false,message:error.message,sound:'deny'};
    return {ok:false,message:error instanceof Error?error.message:'操作未完成',sound:'deny'};
  }
}
function withRng<T>(run:RunState,fn:(rng:Rng)=>T):T {const rng=new Rng(run.rngState);const out=fn(rng);run.rngState=rng.state;return out}
function spend(run:RunState,amount:number):void {requireRule(Number.isFinite(amount)&&amount>=0,'费用无效');requireRule(run.bones>=amount,`骨头不足，需要${amount}，现有${run.bones}`);run.bones-=amount;run.runStats.bonesSpent+=amount}
function earn(run:RunState,amount:number):void {run.bones+=amount;run.runStats.bonesEarned+=amount}
function payHp(run:RunState,amount:number):void {requireRule(run.hp>amount,`命匣不足，支付后至少保留1点`);run.hp-=amount}
function newWaveState():WaveBookkeeping{return {spins:0,paidSpins:0,itemUses:0,battleItemUses:0,usedItemTargets:[],refundUsed:false,queuedFamily:null,queuedOil:false,newUnits:[]}}
function newNodeState():NodeBookkeeping{return {machineLocked:false,temporaryShift:null,serviceUsed:false,shopRefreshes:0,shopWeightUsed:false,phylacteryItemUsed:false,eventBuffs:[]}}
function waveKey(run:RunState):string{return `${run.currentNodeId}:W${run.wave}`}
function hasMachine(run:RunState,id:string):boolean{return run.machineRelics.includes(id)}
function requireManage(run:RunState):void {requireRule(MANAGE_PHASES.includes(run.phase),'当前阶段不能整理军队')}
function requirePrep(run:RunState):void {requireRule(run.phase==='prep','只能在战斗波次的准备阶段使用')}
function permanentUnits(run:RunState):UnitInstance[]{return [...run.army,...run.staging]}
function removeUnit(run:RunState,uid:string):void {run.army=run.army.filter(u=>u.uid!==uid);run.staging=run.staging.filter(u=>u.uid!==uid)}
function addXp(unit:UnitInstance,amount:number):number {const before=unit.xp;unit.xp=Math.min(150,unit.xp+amount);return unit.xp-before}
function itemCount(run:RunState,id:string):number{return run.items[id]??0}
function itemSpace(run:RunState,id:string,amount=1):boolean {
  return itemCount(run,id)+amount<=3&&(itemCount(run,id)>0||Object.keys(run.items).filter(k=>run.items[k]>0).length<3);
}
function addItem(run:RunState,id:string,amount=1):void {getItem(id);requireRule(itemSpace(run,id,amount),'道具袋最多3种，每种最多3份；先使用已有道具');run.items[id]=itemCount(run,id)+amount}
function consumeItem(run:RunState,id:string):void {requireRule(itemCount(run,id)>0,'没有这件道具');requireRule(run.waveState.itemUses<2,'每波最多使用2份道具');run.items[id]--;if(!run.items[id])delete run.items[id];run.waveState.itemUses++}
function addBuffOnce(run:RunState,buff:WaveBuff):void {if(!run.waveBuffs.some(b=>b.source===buff.source&&b.type===buff.type&&b.uid===buff.uid))run.waveBuffs.push(buff)}
function clearWave(run:RunState):void {run.waveState=newWaveState();run.slot=null;run.waveBuffs=[];run.battleResult=null;run.pendingCombatInput=null;run.battleSnapshot=null}
function pickTrainingUnit(run:RunState,uid?:string):UnitInstance {
  const u=uid?run.army.find(x=>x.uid===uid):[...run.army].sort((a,b)=>a.xp-b.xp)[0];
  requireRule(u,'请选择一名正式兵');requireRule(u.xp<150,'该兵已经达到Lv8');return u;
}
function getSlotType(id:string):'machine'|'army'{return getRelic(id).type}
function equipment(run:RunState,type:'machine'|'army'):string[]{return type==='machine'?run.machineRelics:run.armyRelics}
function equipmentCapacity(run:RunState,type:'machine'|'army'):number{return type==='machine'?run.machineCapacity:run.armyRelicCapacity}
function machineEditable(run:RunState):boolean{return run.phase!=='battle'&&(run.phase!=='prep'||!run.nodeState.machineLocked)}
function equipInternal(run:RunState,id:string,replaceId?:string):void {
  const def=getRelic(id);requireRule(run.ownedRelics.includes(id),'尚未拥有这件遗物');
  if(def.type==='machine')requireRule(machineEditable(run),'本节点首次拉杆后机器配置锁定');
  else requireRule(run.phase!=='battle','战斗中不能更换军团遗物');
  const equipped=equipment(run,def.type);requireRule(!equipped.includes(id),'已经装备');
  if(replaceId){const i=equipped.indexOf(replaceId);requireRule(i>=0,'替换目标不在该类装备槽');equipped[i]=id;if(replaceId==='R_M17')run.nodeState.temporaryShift=null;}
  else {requireRule(equipped.length<equipmentCapacity(run,def.type),'装备槽已满，请选择替换一件已装备遗物');equipped.push(id)}
}
function acquireRelic(run:RunState,id:string,replaceId?:string):void {
  const d=getRelic(id);requireRule(!run.ownedRelics.includes(id),'已经拥有这件遗物');run.ownedRelics.push(id);
  if(replaceId||equipment(run,d.type).length<equipmentCapacity(run,d.type))equipInternal(run,id,replaceId);
}
function createShop(run:RunState):ShopOffer[] {
  const node=currentNode(run)!;
  return withRng(run,rng=>{
    const relicPool=RELICS.filter(r=>r.unlock_act<=run.act&&!run.ownedRelics.includes(r.id));
    const relics=rng.shuffle(relicPool).slice(0,3);
    const items=rng.shuffle(ITEMS).slice(0,2);
    return [...relics.map(r=>({kind:'relic' as const,contentId:r.id,price:r.price})),...items.map(i=>({kind:'item' as const,contentId:i.id,price:i.price}))]
      .map((offer,i)=>({...offer,id:`${node.id}:S${run.nodeState.shopRefreshes}:${i}`,sold:false}));
  });
}
function makeRewards(run:RunState):RewardChoice[] {
  const kind=currentNode(run)!.kind;
  const rarities=kind==='boss'?['legendary','legendary','legendary']:kind==='elite'?['rare','rare','legendary']:['common','common','rare'];
  return withRng(run,rng=>{
    const used=new Set<string>();const choices:RewardChoice[]=[];let bonesAdded=false;
    for(const rarity of rarities){
      const pool=RELICS.filter(r=>r.rarity===rarity&&r.unlock_act<=run.act&&!run.ownedRelics.includes(r.id)&&!used.has(r.id));
      if(pool.length){const r=rng.pick(pool);used.add(r.id);choices.push({id:r.id,kind:'relic',relicId:r.id,label:r.name})}
      else if(!bonesAdded){choices.push({id:'bones',kind:'bones',amount:6,label:'回收6根骨头'});bonesAdded=true}
    }
    return choices.length?choices:[{id:'bones',kind:'bones',amount:6,label:'回收6根骨头'}];
  });
}

export function createRun(seed:string|number=Date.now(),starter:StarterId='legion'):RunState {
  const start=STARTERS.find(s=>s.id===starter)??STARTERS[0];const rng=new Rng(hashSeed(seed));
  const map=generateCampaignMap(rng);
  const army=start.units.map((id,i)=>({...makeUnit(id,`u${i+1}`,0,i),acquiredAt:0}));
  return {
    schemaVersion:1,id:`run-${hashSeed(seed).toString(16)}-${start.id}`,seed:String(seed),rngState:rng.state,
    phase:'map',starterId:start.id,act:1,bones:12,hp:60,maxHp:60,capacity:4,reserveCapacity:8,machineCapacity:2,armyRelicCapacity:6,
    army,staging:[],familyWeights:start.families.map(family=>({family,weight:5})),ownedRelics:['R_M01'],machineRelics:['R_M01'],armyRelics:[],items:{},
    map,currentNodeId:null,wave:1,slot:null,rewardChoices:[],shopStock:[],eventId:null,waveBuffs:[],battleResult:null,
    runStats:{spins:0,wavesWon:0,wavesPlayed:0,nodesCompleted:0,unitsSummoned:3,sacrificed:0,fusions:0,bonesEarned:12,bonesSpent:0,kills:0,totalDamage:0,totalHealing:0},
    waveState:newWaveState(),nodeState:newNodeState(),nextUid:4,nextSpin:1,completedWaveKeys:[],claimedNodeKeys:[],seenEvents:[],pendingBossBuffs:[],pendingBossBones:0,pendingCombatInput:null,battleSnapshot:null,
    lastMessage:'选择第一个据点。三名亡灵已经报到，命匣60，初始骨头12。',
  };
}
export function currentNode(run:RunState):MapNode|null{return run.map.find(n=>n.id===run.currentNodeId)??null}
export function availableNodes(run:RunState):MapNode[]{
  if(run.phase!=='map')return [];
  const previous=currentNode(run);
  if(!previous)return run.map.filter(n=>n.act===1&&n.layer===1&&!n.visited);
  return run.map.filter(n=>previous.links.includes(n.id)&&!n.visited);
}
export function activeWeights(run:RunState):FamilyWeight[]{
  const weights=run.familyWeights.map(w=>({...w}));const shift=run.nodeState.temporaryShift;
  if(shift){const from=weights.find(w=>w.family===shift.from),to=weights.find(w=>w.family===shift.to);if(from&&to){from.weight-=shift.amount;to.weight+=shift.amount}}
  return weights;
}
export function deployedUnits(run:RunState):UnitInstance[]{return run.army.filter(u=>u.slot!==null).sort((a,b)=>a.slot!-b.slot!)}
export function reserveUnits(run:RunState):UnitInstance[]{return run.army.filter(u=>u.slot===null)}
export function findUnit(run:RunState,uid:string):UnitInstance|undefined{return run.army.find(u=>u.uid===uid)??run.staging.find(u=>u.uid===uid)}
export function spinCost(run:RunState):number|null {
  if(run.phase!=='prep')return null;
  if(run.waveState.spins===0)return 0;
  const max=hasMachine(run,'R_M18')?5:3;if(run.waveState.paidSpins>=max)return null;
  let cost=PAID_COSTS[run.waveState.paidSpins];
  if(run.waveState.paidSpins===0&&hasMachine(run,'R_M10'))cost--;
  if(run.waveState.queuedOil)cost-=2;return Math.max(1,cost);
}
export function expansionCost(run:RunState):number|null{return run.capacity>=8?null:EXPANSION_COSTS[run.capacity-4]??null}
export function refreshCost(run:RunState):number|null{return run.phase==='shop'&&run.nodeState.shopRefreshes<3?4+3*run.nodeState.shopRefreshes:null}
export function unequippedRelics(run:RunState):string[]{return run.ownedRelics.filter(id=>!run.machineRelics.includes(id)&&!run.armyRelics.includes(id))}
export function getSlotWins(run:RunState):SlotWin[]{
  if(!run.slot)return [];
  return analyzeBoard(run.slot.board).map(win=>{
    const rank=run.slot!.boostFamily===win.family&&win.lineCount===1?2:win.rank;
    const level=rank===1&&hasMachine(run,'R_M14')?2:rank!==win.rank?1:win.level;
    return {...win,rank,level,templateIds:UNITS.filter(u=>u.family===win.family&&u.rank===rank).map(u=>u.id)};
  });
}

function sameUnit(a:UnitInstance,b:UnitInstance):boolean {
  return a.uid===b.uid&&a.templateId===b.templateId&&a.xp===b.xp&&a.specialization===b.specialization&&a.slot===b.slot&&a.acquiredAt===b.acquiredAt;
}
function provisionalIntegrity(run:RunState):void {
  const slot=run.slot;requireRule(slot?.materialized&&!slot.settled,'没有可修改的本盘新兵');
  const uids=slot.provisionalUids,snapshots=slot.provisionalSnapshot,wins=getSlotWins(run);
  requireRule(Array.isArray(uids)&&Array.isArray(snapshots)&&uids.length===wins.length&&snapshots.length===uids.length&&new Set(uids).size===uids.length,'本盘新兵记录不完整');
  const seen=new Set<FamilyId>();
  for(let i=0;i<uids.length;i++){
    const u=findUnit(run,uids[i]),snapshot=snapshots[i];
    requireRule(u&&snapshot&&snapshot.uid===uids[i]&&sameUnit(u,snapshot),'本盘新兵已经改变，不能撤销重建');
    const def=getUnit(u.templateId),win=wins.find(w=>w.family===def.family);
    requireRule(win&&!seen.has(def.family)&&win.templateIds.includes(u.templateId)&&u.xp===xpForLevel(win.level)&&u.specialization===null&&u.acquiredAt===run.runStats.wavesPlayed,'本盘新兵与盘面不一致');
    requireRule(slot.birthBranches?.[def.family]===u.templateId,'本盘职业分支记录不一致');seen.add(def.family);
  }
}
function materializeInternal(run:RunState):void {
  const slot=run.slot;requireRule(slot&&!slot.settled,'没有待出生的盘面');
  if(slot.materialized){provisionalIntegrity(run);return}
  const wins=getSlotWins(run),choices=slot.birthBranches??{};
  slot.materialized=true;slot.revision??=0;slot.birthBranches={};slot.provisionalUids=[];slot.provisionalSnapshot=[];
  for(const win of wins){
    const id=win.templateIds.includes(choices[win.family]??'')?choices[win.family]!:win.templateIds[0];
    const free=Array.from({length:run.capacity},(_,i)=>i).find(i=>!run.army.some(u=>u.slot===i));
    const u=makeUnit(id,`u${run.nextUid++}`,xpForLevel(win.level),free??null);u.acquiredAt=run.runStats.wavesPlayed;
    if(free===undefined)run.staging.push(u);else run.army.push(u);
    slot.birthBranches[win.family]=id;slot.provisionalUids.push(u.uid);slot.provisionalSnapshot.push(structuredClone(u));
  }
  slot.wins=wins;
}
function applyBirthBranch(run:RunState,uid:string,choice:string):void {
  provisionalIntegrity(run);const slot=run.slot!;
  requireRule(slot.provisionalUids!.includes(uid),'只能调整当前未锁盘的新兵职业');
  const u=findUnit(run,uid)!,def=getUnit(u.templateId),win=getSlotWins(run).find(w=>w.family===def.family)!;
  requireRule(win.templateIds.length>1,'这名新兵没有A/B出生职业');
  const id=choice==='A'||choice==='B'?`U_${win.family}_${win.rank}${choice}`:choice;
  requireRule(win.templateIds.includes(id),'出生职业分支无效');
  u.templateId=id;slot.birthBranches![win.family]=id;
  slot.provisionalSnapshot![slot.provisionalUids!.indexOf(uid)]=structuredClone(u);
}
function awardSpin(run:RunState,births:UnitInstance[]):void {
  const slot=run.slot!,wins=getSlotWins(run);
  for(const u of births){
    const win=wins.find(w=>w.family===getUnit(u.templateId).family)!;
    run.waveState.newUnits.push(u.uid);run.runStats.unitsSummoned++;
    if(hasMachine(run,'R_M13')&&win.lineCount>=2)addBuffOnce(run,{type:'openingShield',value:15,uid:u.uid,source:'R_M13'});
    if(hasMachine(run,'R_M16')&&win.lineCount>=3)addBuffOnce(run,{type:'damageMultiplier',value:.15,uid:u.uid,source:'R_M16'});
  }
  if(!wins.length){
    if(hasMachine(run,'R_M11')&&!run.waveState.refundUsed&&slot.paidCost>1){earn(run,1);run.waveState.refundUsed=true}
    if(hasMachine(run,'R_M15'))addBuffOnce(run,{type:'phylacteryBarrier',value:6,source:'R_M15'});
  }else if(wins.length>=2&&hasMachine(run,'R_M12'))addBuffOnce(run,{type:'openingMove',value:.15,source:'R_M12'});
  slot.settled=true;slot.wins=wins;
}
function sealPendingSpin(run:RunState):void {
  const slot=run.slot;if(!slot?.materialized||slot.settled)return;
  provisionalIntegrity(run);awardSpin(run,slot.provisionalUids!.map(uid=>findUnit(run,uid)!));
  slot.sealedRevision=slot.revision??0;slot.provisionalUids=[];slot.provisionalSnapshot=[];
}
/** Emits real units immediately; repeated calls neither reroll nor duplicate them. */
export function materializeSpin(run:RunState):ActionResult{return transaction(run,d=>{
  requirePrep(d);materializeInternal(d);
  const count=d.slot!.provisionalUids!.length;
  return success(count?`${count}名亡灵已到场；整理军团或继续拉杆后，本盘停止改动`:'空盘已停下；仍可改盘，也可继续追加或进攻',count?'reward':'empty');
})}
/** Finalizes this board once. Callers may safely retry an already sealed board. */
export function sealSpin(run:RunState):ActionResult{return transaction(run,d=>{
  requirePrep(d);requireRule(d.slot,'当前没有盘面');
  requireRule(d.slot.settled||d.slot.materialized,'请等待本盘新兵到场');
  sealPendingSpin(d);return success('本盘已确定，可以继续整理军团或进攻');
})}
export function chooseBirthBranch(run:RunState,uid:string,choice:'A'|'B'):ActionResult{return transaction(run,d=>{
  requirePrep(d);applyBirthBranch(d,uid,choice);return success(`出生职业改为${getUnit(findUnit(d,uid)!.templateId).name}`);
})}
/** Checks the real next-pull budget, including an empty-board refund earned on seal. */
export function canSpin(run:RunState):ActionResult {
  try {
    const d=structuredClone(run);requirePrep(d);sealPendingSpin(d);
    requireRule(!d.slot||d.slot.settled,'先等待当前轮盘停下');
    const cost=spinCost(d);requireRule(cost!==null,'本波追加次数已用完');
    requireRule(d.bones>=cost,`骨头不足，需要${cost}，现有${d.bones}`);
    const queued=Number(Boolean(d.waveState.queuedFamily))+Number(d.waveState.queuedOil);
    requireRule(d.waveState.itemUses+queued<=2,'本波最多使用2份道具');
    if(d.waveState.queuedFamily)requireRule(itemCount(d,'I01')>0,'没有这件道具');
    if(d.waveState.queuedOil){requireRule(itemCount(d,'I02')>0,'没有这件道具');requireRule(cost>0,'折扣不能用于免费抽')}
    return {ok:true};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:'当前不能拉杆'}}
}

export function chooseNode(run:RunState,nodeId:string):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='map','先完成当前节点');requireRule(availableNodes(d).some(n=>n.id===nodeId),'该节点不与当前路线相连');
  const node=d.map.find(n=>n.id===nodeId)!;node.visited=true;d.currentNodeId=nodeId;d.act=node.act;d.wave=1;d.nodeState=newNodeState();clearWave(d);d.rewardChoices=[];d.shopStock=[];d.eventId=null;
  if(['normal','elite','boss'].includes(node.kind)){
    d.phase='prep';if(node.kind==='boss'){d.nodeState.eventBuffs=d.pendingBossBuffs;d.pendingBossBuffs=[]}
  } else {
    d.phase=node.kind as RunPhase;
    if(node.kind==='shop')d.shopStock=createShop(d);
    if(node.kind==='event'){
      const pool=EVENTS.filter(e=>!d.seenEvents.includes(e.id));const chosen=withRng(d,rng=>rng.pick(pool.length?pool:EVENTS));
      d.eventId=chosen.id;d.seenEvents.push(chosen.id);
    }
  }
  return success(`进入${node.name}`,'travel');
})}

export function spin(run:RunState):ActionResult{return transaction(run,d=>{
  requirePrep(d);sealPendingSpin(d);requireRule(!d.slot||d.slot.settled,'先确认当前盘面并收兵');
  const cost=spinCost(d);requireRule(cost!==null,'本波追加次数已用完');
  const queued=(d.waveState.queuedFamily?1:0)+(d.waveState.queuedOil?1:0);
  requireRule(d.waveState.itemUses+queued<=2,'本波最多使用2份道具');
  spend(d,cost);
  const family=d.waveState.queuedFamily;
  if(family)consumeItem(d,'I01');
  if(d.waveState.queuedOil){requireRule(cost>0,'折扣不能用于免费抽');consumeItem(d,'I02')}
  const board=withRng(d,rng=>rollBoard(activeWeights(d),rng));
  d.slot={id:`${d.id}:spin${d.nextSpin++}`,board,wins:[],settled:false,paidCost:cost,free:cost===0,interventions:0,usedSources:[],boostFamily:family};
  d.waveState.spins++;if(cost>0)d.waveState.paidSpins++;
  d.waveState.queuedFamily=null;d.waveState.queuedOil=false;d.nodeState.machineLocked=true;d.runStats.spins++;
  d.slot.wins=getSlotWins(d);return success(cost?`支付${cost}骨头，盘面已停下`:'使用本波免费拉杆','spin');
})}

export function claimSpin(run:RunState,branches:Partial<Record<FamilyId,string>>={}):ActionResult{return transaction(run,d=>{
  requirePrep(d);requireRule(d.slot&&!d.slot.settled,'没有待确认的盘面');
  if(d.slot.materialized){
    for(const uid of d.slot.provisionalUids??[]){const family=getUnit(findUnit(d,uid)!.templateId).family,choice=branches[family];if(choice&&getSlotWins(d).find(w=>w.family===family)!.templateIds.length>1)applyBirthBranch(d,uid,choice)}
    sealPendingSpin(d);return success('本盘新兵已确定，不再重复出生','reward');
  }
  const wins=getSlotWins(d);const selections=wins.map(win=>{
    let id=win.templateIds[0];
    if(win.templateIds.length>1){const choice=branches[win.family];requireRule(choice,'请选择所有R2/R3兵种的A/B分支');id=choice==='A'||choice==='B'?`U_${win.family}_${win.rank}${choice}`:choice;requireRule(win.templateIds.includes(id),'出生职业分支无效')}
    return {win,id};
  });
  const births:UnitInstance[]=[];
  for(const {win,id} of selections){
    const u=makeUnit(id,`u${d.nextUid++}`,xpForLevel(win.level));u.acquiredAt=d.runStats.wavesPlayed;
    d.staging.push(u);births.push(u);
  }
  awardSpin(d,births);
  return success(wins.length?`招募${wins.length}名亡灵，请安置招募暂存中的新兵`:'空盘已确认；可以调整军队或决定是否追加',wins.length?'reward':'empty');
})}

export function deployUnit(run:RunState,uid:string,slot:number):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);requireRule(Number.isInteger(slot)&&slot>=0&&slot<d.capacity,'该部署位置尚未解锁');
  const u=findUnit(d,uid);requireRule(u,'找不到这名士兵');requireRule(u.slot!==slot,'已经在该位置');
  const occupied=d.army.find(x=>x.slot===slot);const inArmy=d.army.some(x=>x.uid===uid);const oldSlot=u.slot;
  if(occupied){
    if(inArmy){occupied.slot=oldSlot}
    else {requireRule(reserveUnits(d).length<d.reserveCapacity,'后备已满，无法安置被换下的士兵');occupied.slot=null}
  }
  if(!inArmy){d.staging=d.staging.filter(x=>x.uid!==uid);d.army.push(u)}
  u.slot=slot;return success(`${getUnit(u.templateId).name}已部署`);
})}
export function benchUnit(run:RunState,uid:string):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);const u=findUnit(d,uid);requireRule(u,'找不到这名士兵');
  requireRule(!(d.army.includes(u)&&u.slot===null),'已经在后备');requireRule(reserveUnits(d).length<d.reserveCapacity,'后备已满');
  if(!d.army.includes(u)){d.staging=d.staging.filter(x=>x.uid!==uid);d.army.push(u)}u.slot=null;return success('士兵已进入后备');
})}
export function dismissUnit(run:RunState,uid:string):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);requireRule(findUnit(d,uid),'找不到这名士兵');requireRule(permanentUnits(d).length>1,'至少保留一名永久士兵');removeUnit(d,uid);return success('士兵已明确遣散，不获得骨头或经验');
})}
export function sacrifice(run:RunState,donorUid:string,recipientUid:string):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);requireRule(donorUid!==recipientUid,'不能献祭给自己');const donor=findUnit(d,donorUid),recipient=findUnit(d,recipientUid);
  requireRule(donor&&recipient,'请选择献祭材料和接受经验的士兵');requireRule(recipient.xp<150,'接受者已达到Lv8');
  const gain=SACRIFICE_BASE[getUnit(donor.templateId).rank]+Math.floor(donor.xp*.75);const actual=addXp(recipient,gain);removeUnit(d,donorUid);d.runStats.sacrificed++;
  return success(`吸收完成：训练经验+${actual}，出生阶级保持R${getUnit(recipient.templateId).rank}`,'sacrifice');
})}
export function fuseBodies(run:RunState,recipientUid:string,bodyUid:string):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);requireRule(recipientUid!==bodyUid,'不能使用自己的身体换壳');const recipient=findUnit(d,recipientUid),body=findUnit(d,bodyUid);
  requireRule(recipient&&body,'请选择保留者和更高阶身体');const a=getUnit(recipient.templateId),b=getUnit(body.templateId);
  requireRule(a.family===b.family,'换壳只接受同家族身体');requireRule(b.rank>a.rank,'新身体出生阶必须严格更高');
  recipient.templateId=body.templateId;recipient.xp=Math.max(recipient.xp,body.xp);recipient.specialization=null;removeUnit(d,bodyUid);d.runStats.fusions++;
  return success(`换壳为${b.name}；保留较高训练经验，职业专精需重新选择`,'sacrifice');
})}
export function chooseSpecialization(run:RunState,uid:string,choice:'A'|'B'):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);const u=findUnit(d,uid);requireRule(u,'找不到这名士兵');requireRule(levelForXp(u.xp)>=4,'训练Lv4解锁专精');requireRule(u.specialization===null,'该身体已选择专精，不能反复切换');
  requireRule(specializationsFor(u.templateId).some(s=>s.choice===choice),'无效的专精');u.specialization=choice;return success('专精已确定');
})}
export function expandCapacity(run:RunState):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='prep'||d.phase==='shop','请在准备阶段或黑市扩容');sealPendingSpin(d);const cost=expansionCost(d);requireRule(cost!==null,'已经拥有8个正式兵位');spend(d,cost);d.capacity++;return success(`正式兵位扩展到${d.capacity}格`,'upgrade');
})}

const INTERVENTIONS:{sourceId:string;kind:string;cost:number}[]=[
  {sourceId:'R_M01',kind:'lockColumn',cost:1},{sourceId:'R_M02',kind:'swap',cost:1},
  {sourceId:'R_M03',kind:'copy',cost:2},{sourceId:'R_M04',kind:'rotateColumn',cost:0},
  {sourceId:'R_M05',kind:'rerollCell',cost:1},{sourceId:'R_M06',kind:'swapColumns',cost:0},
  {sourceId:'R_M07',kind:'rotateCorners',cost:0},{sourceId:'R_M08',kind:'copy',cost:2},
  {sourceId:'R_M09',kind:'rerollRow',cost:1},
  {sourceId:'I03',kind:'lockColumn',cost:0},{sourceId:'I04',kind:'swap',cost:0},{sourceId:'I05',kind:'copy',cost:0},
];
function adjacent(a:number,b:number):boolean{return Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&a<9&&b>=0&&b<9&&Math.abs(Math.floor(a/3)-Math.floor(b/3))+Math.abs(a%3-b%3)===1}
function sourceFitsAction(sourceId:string,action:SlotIntervention):boolean {
  const entry=INTERVENTIONS.find(i=>i.sourceId===sourceId&&i.kind===action.kind);if(!entry)return false;
  if(action.kind==='copy')return sourceId==='R_M08'?action.b===4&&action.a!==4:adjacent(action.a,action.b);
  if(action.kind==='swap')return adjacent(action.a,action.b);
  return true;
}
function interventionInternal(run:RunState,action:SlotIntervention,sourceId?:string):void {
  requirePrep(run);requireRule(run.slot&&!run.slot.settled,'本盘已确定；请在整理军团、追加或进攻前改盘');requireRule(run.slot.interventions<2,'每盘最多2次干预');
  const materialized=Boolean(run.slot.materialized);
  if(materialized)provisionalIntegrity(run);
  const candidates=INTERVENTIONS.filter(i=>sourceFitsAction(i.sourceId,action)&&(i.sourceId.startsWith('I')?itemCount(run,i.sourceId)>0:hasMachine(run,i.sourceId)));
  const selected=sourceId?candidates.find(i=>i.sourceId===sourceId):candidates.find(i=>!run.slot!.usedSources.includes(i.sourceId));
  requireRule(selected,'未装备对应机器部件，或目标不符合此操作的限制');
  requireRule(!run.slot.usedSources.includes(selected.sourceId),'同一部件或道具每盘最多使用1次');
  if(selected.sourceId.startsWith('I'))consumeItem(run,selected.sourceId);else spend(run,selected.cost);
  if(materialized){
    for(const uid of run.slot.provisionalUids!)removeUnit(run,uid);
    run.slot.materialized=false;run.slot.provisionalUids=[];run.slot.provisionalSnapshot=[];
    run.slot.revision=(run.slot.revision??0)+1;
  }
  run.slot.board=withRng(run,rng=>interventionBoard(run.slot!.board,action,activeWeights(run),rng));
  run.slot.interventions++;run.slot.usedSources.push(selected.sourceId);run.slot.wins=getSlotWins(run);
  if(materialized)materializeInternal(run);
}
export function interventionOptions(run:RunState):InterventionOption[]{
  return INTERVENTIONS.filter(i=>i.sourceId.startsWith('I')?itemCount(run,i.sourceId)>0:hasMachine(run,i.sourceId)).map(i=>{
    const item=i.sourceId.startsWith('I');
    const reason=run.phase!=='prep'?'只能在准备阶段使用':!run.slot||run.slot.settled?'本盘已确定，下一次拉杆后可改盘':run.slot.interventions>=2?'每盘干预上限2次':run.slot.usedSources.includes(i.sourceId)?'本盘已使用':item&&run.waveState.itemUses>=2?'本波道具已用满':run.bones<i.cost?'骨头不足':undefined;
    return {...i,label:item?getItem(i.sourceId).name:getRelic(i.sourceId).name,available:!reason,reason};
  });
}
export function intervene(run:RunState,action:SlotIntervention,sourceId?:string):ActionResult{return transaction(run,d=>{
  interventionInternal(d,action,sourceId);return success(d.slot?.materialized?'盘面与本盘新兵已同步更新':'盘面已更新，尚未发放任何士兵','slot-edit');
})}
export function equipRelic(run:RunState,relicId:string,replaceId?:string):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);equipInternal(d,relicId,replaceId);return success(`已装备${getRelic(relicId).name}`);
})}
export function unequipRelic(run:RunState,relicId:string):ActionResult{return transaction(run,d=>{
  requireManage(d);sealPendingSpin(d);const type=getSlotType(relicId);if(type==='machine')requireRule(machineEditable(d),'本节点首次拉杆后机器配置锁定');
  const equipped=equipment(d,type);const index=equipped.indexOf(relicId);requireRule(index>=0,'这件遗物没有装备');equipped.splice(index,1);if(relicId==='R_M17')d.nodeState.temporaryShift=null;return success('遗物已卸下，仍保留在库存');
})}
export function buyShop(run:RunState,offerId:string,replaceRelicId?:string):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='shop','只有黑市售卖物品');const offer=d.shopStock.find(o=>o.id===offerId);requireRule(offer&&!offer.sold,'该商品不存在或已经售出');
  spend(d,offer.price);
  if(offer.kind==='relic')acquireRelic(d,offer.contentId,replaceRelicId);else addItem(d,offer.contentId);
  offer.sold=true;return success(offer.kind==='relic'&&unequippedRelics(d).includes(offer.contentId)?'遗物已收入库存；装备槽已满，可选择替换':'购买完成','purchase');
})}
export function refreshShop(run:RunState):ActionResult{return transaction(run,d=>{
  const cost=refreshCost(d);requireRule(cost!==null,'本次黑市刷新次数已用完，或当前不在黑市');spend(d,cost);d.nodeState.shopRefreshes++;d.shopStock=createShop(d);return success('黑市库存已刷新','purchase');
})}
function validWeightArray(weights:FamilyWeight[]):boolean {
  if(weights.length!==4||new Set(weights.map(w=>w.family)).size!==4||weights.some(w=>!FAMILY_IDS.includes(w.family)||!Number.isInteger(w.weight)||w.weight<2||w.weight>10)||weights.reduce((s,w)=>s+w.weight,0)!==20)return false;
  const result:unknown=validateWeights(weights);
  if(typeof result==='boolean')return result;
  if(result&&typeof result==='object'&&'ok' in result)return Boolean((result as {ok:boolean}).ok);
  return result===undefined;
}
export function transferWeight(run:RunState,from:FamilyId,to:FamilyId,amount=1,source:'shop'|'relic'='shop'):ActionResult{return transaction(run,d=>{
  requireRule(from!==to,'请选择两个不同家族');const base=d.familyWeights.map(w=>({...w}));const a=base.find(w=>w.family===from),b=base.find(w=>w.family===to);requireRule(a&&b,'两个家族都必须在当前轮盘');
  if(source==='relic'){
    requirePrep(d);requireRule(hasMachine(d,'R_M17'),'需要装备偏心配重');requireRule(!d.nodeState.machineLocked&&!d.nodeState.temporaryShift,'仅本节点首次拉杆前可设置一次');requireRule(amount===2,'偏心配重固定转移2份权重');
    a.weight-=2;b.weight+=2;requireRule(validWeightArray(base),'调整后每族须2–10且总和20');d.nodeState.temporaryShift={from,to,amount:2};
    return success('本节点临时配重已设置，离开节点后还原');
  }
  requireRule(d.phase==='shop','永久微调仅在黑市进行');requireRule(!d.nodeState.shopWeightUsed,'本次黑市只能微调一次');requireRule(amount===1,'黑市微调固定转移1份');
  a.weight--;b.weight++;requireRule(validWeightArray(base),'调整后每族须2–10且总和20');spend(d,4);d.familyWeights=base;d.nodeState.shopWeightUsed=true;return success('权重微调已永久保存');
})}
export function reconfigureWeights(run:RunState,weights:FamilyWeight[]):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='workshop','请到邪术工坊重配');requireRule(!d.nodeState.serviceUsed,'本次工坊服务已经使用');requireRule(validWeightArray(weights),'需要四个不同家族，各2–10且总和20');
  requireRule(weights.every(w=>d.familyWeights.some(old=>old.family===w.family)),'重配不能更换活跃家族，请使用换族服务');
  requireRule(weights.some(w=>d.familyWeights.find(old=>old.family===w.family)!.weight!==w.weight),'权重没有改变');spend(d,6);d.familyWeights=weights.map(w=>({...w}));d.nodeState.serviceUsed=true;return success('权重重配完成');
})}
export function replaceFamily(run:RunState,from:FamilyId,to:FamilyId):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='workshop','请到邪术工坊更换家族');requireRule(!d.nodeState.serviceUsed,'本次工坊服务已经使用');requireRule(FAMILY_IDS.includes(to)&&!d.familyWeights.some(w=>w.family===to),'请选择当前未装入轮盘的家族');
  const old=d.familyWeights.find(w=>w.family===from);requireRule(old,'被替换家族不在轮盘');spend(d,8);old.family=to;d.nodeState.serviceUsed=true;return success('轮盘家族已更换，已有军队不变');
})}
export function restAtGrave(run:RunState,choice:'heal'|'train',uid?:string):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='grave','当前不是墓园');requireRule(!d.nodeState.serviceUsed,'本次墓园服务已经选择');
  if(choice==='heal'){requireRule(d.hp<d.maxHp,'命匣已满，可选择训练');const amount=Math.min(15,d.maxHp-d.hp);d.hp+=amount;d.nodeState.serviceUsed=true;return success(`命匣恢复${amount}点`,'heal')}
  requireRule(choice==='train','无效的墓园服务');const u=pickTrainingUnit(d,uid);const amount=addXp(u,12);d.nodeState.serviceUsed=true;return success(`训练经验+${amount}，不会提高出生阶`,'upgrade');
})}

export function chooseEvent(run:RunState,choice:'a'|'b'|'c',uid?:string,options:{uids?:string[];from?:FamilyId;to?:FamilyId}={}):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='event'&&d.eventId,'当前没有事件');requireRule(!d.nodeState.serviceUsed,'事件已经作出选择');requireRule(['a','b','c'].includes(choice),'无效的事件选项');
  if(choice==='c'){d.nodeState.serviceUsed=true;return success('离开这件怪事，不支付任何代价')}
  const train=(amount:number)=>addXp(pickTrainingUnit(d,uid),amount);
  const heal=(amount:number)=>{requireRule(d.hp<d.maxHp,'命匣已满，此选项没有恢复效果');d.hp=Math.min(d.maxHp,d.hp+amount)};
  switch(d.eventId){
    case 'EV01': if(choice==='a'){spend(d,4);train(8)}else{payHp(d,6);train(12)}break;
    case 'EV02': if(choice==='a'){spend(d,5);heal(12)}else{payHp(d,4);earn(d,6)}break;
    case 'EV03': if(choice==='a'){spend(d,8);d.pendingBossBones+=12}else{spend(d,6);train(14)}break;
    case 'EV04': if(choice==='a'){spend(d,6);addItem(d,'I01')}else{payHp(d,5);train(10)}break;
    case 'EV05':
      if(choice==='a'){spend(d,5);d.pendingBossBuffs.push({type:'enemyAttackSpeedMultiplier',value:.92,source:'EV05a'})}
      else{payHp(d,6);d.pendingBossBuffs.push({type:'allyMaxHpMultiplier',value:1.10,source:'EV05b'})}break;
    case 'EV06':
      if(choice==='a'){
        const targets=options.uids??[...d.army].filter(u=>u.xp<150).sort((a,b)=>a.xp-b.xp).slice(0,3).map(u=>u.uid);
        requireRule(targets.length===3&&new Set(targets).size===3,'需要选择三名不同的未满级正式兵');
        const units=targets.map(id=>pickTrainingUnit(d,id));spend(d,5);units.forEach(u=>addXp(u,6));
      }else{spend(d,4);heal(9)}break;
    case 'EV07':{
      requireRule(options.from&&options.to&&options.from!==options.to,'请选择权重转出的家族和转入家族');
      const weights=d.familyWeights.map(w=>({...w}));const a=weights.find(w=>w.family===options.from),b=weights.find(w=>w.family===options.to);requireRule(a&&b,'两个家族都须在当前轮盘');a.weight--;b.weight++;requireRule(validWeightArray(weights),'调整后每族须2–10且总和20');
      if(choice==='a')spend(d,4);else payHp(d,6);d.familyWeights=weights;break;
    }
    case 'EV08':
      if(choice==='a'){d.pendingBossBuffs.push({type:'allDamageMultiplier',value:1.10,source:'EV08a'});d.pendingBossBones+=6}
      else{spend(d,8);heal(18)}break;
    default: throw new RuleError('未知事件，仍可直接离开');
  }
  d.nodeState.serviceUsed=true;return success('事件选择已结算；不会重复扣款或发放奖励','event');
})}
export function leaveService(run:RunState):ActionResult{return transaction(run,d=>{
  requireRule(SERVICE_PHASES.includes(d.phase),'当前不是可离开的服务节点');const node=currentNode(d);requireRule(node,'节点记录丢失');
  node.completed=true;d.runStats.nodesCompleted++;d.nodeState=newNodeState();d.phase='map';d.shopStock=[];d.eventId=null;return success('服务结束，选择下一条路线','travel');
})}

export function pendingSpecializations(run:RunState):UnitInstance[]{return permanentUnits(run).filter(u=>levelForXp(u.xp)>=4&&u.specialization===null)}
export function canStartWave(run:RunState):ActionResult {
  if(run.phase!=='prep')return {ok:false,message:'当前不在准备阶段'};
  if(run.waveState.spins===0)return {ok:false,message:'先使用本波免费拉杆'};
  if(run.slot&&!run.slot.settled&&!run.slot.materialized)return {ok:false,message:'先等待当前轮盘停下'};
  if(run.staging.length)return {ok:false,message:'请先安置、吸收或明确遣散招募暂存中的士兵'};
  const team=deployedUnits(run);if(!team.length)return {ok:false,message:'至少部署一名亡灵'};
  if(team.some(u=>levelForXp(u.xp)>=4&&!u.specialization))return {ok:false,message:'请为达到Lv4的上阵兵选择专精'};
  if(run.hp<=0)return {ok:false,message:'命匣已破碎'};
  return {ok:true};
}
export function getCombatInput(run:RunState):CombatInput {
  if(run.phase==='battle'&&run.pendingCombatInput)return structuredClone(run.pendingCombatInput);
  if(run.slot?.materialized&&!run.slot.settled){const projected=structuredClone(run);sealPendingSpin(projected);return getCombatInput(projected)}
  const node=currentNode(run);if(!node||!node.waves.length)throw new Error('当前不是战斗据点');
  const team=deployedUnits(run);const activeIds=new Set(team.map(u=>u.uid));
  let crownRecipients=0;
  const buffs=[...run.nodeState.eventBuffs,...run.waveBuffs].filter(b=>!b.uid||activeIds.has(b.uid))
    .filter(b=>b.source!=='R_M13'||++crownRecipients<=2);
  return {
    seed:hashSeed(`${run.seed}:${node.id}:wave${run.wave}`),team:structuredClone(team),enemies:structuredClone(node.waves[run.wave-1]),
    relics:[...run.machineRelics,...run.armyRelics],buffs:structuredClone(buffs),
    act:run.act,wave:run.wave,nodeKind:node.kind,phylacteryHp:run.hp,timeLimit:75,
  };
}
export function startWave(run:RunState):ActionResult{return transaction(run,d=>{
  sealPendingSpin(d);
  const result=canStartWave(d);requireRule(result.ok,result.message??'当前不能开战');
  // A prepared pull item is only consumed by spin(). Starting combat abandons
  // that unperformed pull and must not keep reserving the battle-item quota.
  const released=Boolean(d.waveState.queuedFamily||d.waveState.queuedOil);
  d.waveState.queuedFamily=null;d.waveState.queuedOil=false;
  d.pendingCombatInput=getCombatInput(d);d.battleSnapshot=null;d.phase='battle';d.runStats.wavesPlayed++;
  return success(released?'亡灵军团进攻；未使用的拉杆预备已取消，道具仍在背包':'亡灵军团进攻','battle');
})}
export function finishWave(run:RunState,battle:BattleState):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='battle'&&d.pendingCombatInput,'当前没有待结算战斗');
  requireRule(battle.result!==null,'战斗尚未结束');requireRule(battle.input.seed===d.pendingCombatInput.seed,'战斗结果与当前波次不匹配');
  const key=waveKey(d);requireRule(!d.completedWaveKeys.includes(key),'本波已经结算');
  const node=currentNode(d)!;const hpLost=Math.max(0,Math.min(20,Number(battle.phylacteryLoss)||0));d.hp=Math.max(0,d.hp-hpLost);
  let result:'win'|'loss'|'retreat'=battle.result;
  if(d.hp===0||node.kind==='boss'&&result!=='win')result='loss';
  if(result==='win'&&node.kind==='boss'&&d.wave===3&&battle.units.some(u=>u.side==='enemy'&&u.boss&&u.alive))result='loss';
  if(result==='loss'&&d.hp>0&&node.kind!=='boss')result='retreat';
  const bones=result==='win'?d.act+3+(node.kind==='elite'?1:node.kind==='boss'?2:0):0;
  if(result==='win'){
    earn(d,bones);d.runStats.wavesWon++;
    // Small participation XP keeps support units progressing without changing their birth profession.
    deployedUnits(d).forEach(u=>addXp(u,2));
  }
  d.runStats.kills+=battle.stats.kills;d.runStats.totalDamage+=battle.stats.damage;d.runStats.totalHealing+=battle.stats.healing;
  d.completedWaveKeys.push(key);d.phase='waveResult';d.battleSnapshot=null;
  d.battleResult={result,hpLost,bones,duration:battle.time,stats:structuredClone(battle.stats),nodeComplete:result==='win'&&d.wave===3,
    message:result==='win'?`第${d.wave}波获胜：${bones}骨头，上阵兵训练经验+2`:result==='retreat'?'守军仍在，军团撤退；保留已完成波的收入':'命匣远征结束'};
  return success(d.battleResult.message,result==='win'?'win':'loss');
})}
export function continueAfterWave(run:RunState):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='waveResult'&&d.battleResult,'当前没有波结算');const summary=d.battleResult;const node=currentNode(d)!;
  if(summary.result==='loss'){d.phase='defeat';return success('这次远征结束，可以用新种子再开局','loss')}
  if(summary.result==='retreat'){
    d.nodeState.temporaryShift=null;d.pendingCombatInput=null;d.waveBuffs=[];d.phase='map';return success('选择下一条路线；本节点没有占领奖励','travel');
  }
  if(d.wave<3){d.wave++;clearWave(d);d.phase='prep';return success(`准备第${d.wave}波：免费拉杆已补充`)}
  requireRule(!d.claimedNodeKeys.includes(node.id),'节点完成奖励已经结算');
  const completion=node.kind==='boss'?12:node.kind==='elite'?8:6;earn(d,completion);
  if(node.kind==='boss'&&d.pendingBossBones>0){earn(d,d.pendingBossBones);d.pendingBossBones=0}
  node.completed=true;d.runStats.nodesCompleted++;d.claimedNodeKeys.push(node.id);
  if(node.kind==='boss'&&d.act<3)d.machineCapacity=Math.min(4,d.machineCapacity+1);
  d.nodeState.temporaryShift=null;d.nodeState.machineLocked=false;d.rewardChoices=makeRewards(d);d.phase='reward';d.pendingCombatInput=null;
  return success(`据点占领：${completion}骨头，选择一项主要奖励`,'reward');
})}
export function chooseReward(run:RunState,choiceId:string,replaceRelicId?:string):ActionResult{return transaction(run,d=>{
  requireRule(d.phase==='reward','当前没有主要奖励');const node=currentNode(d)!;
  if(choiceId==='voucher'){
    requireRule(node.kind==='normal','只有普通据点可放弃整组换引魂券');addItem(d,'I01');
  }else if(choiceId!=='skip'){
    const choice=d.rewardChoices.find(r=>r.id===choiceId);requireRule(choice,'请选择当前候选奖励');
    if(choice.kind==='relic'){requireRule(choice.relicId,'奖励记录无效');acquireRelic(d,choice.relicId,replaceRelicId)}
    else earn(d,choice.amount??6);
  }
  d.rewardChoices=[];d.nodeState=newNodeState();d.waveBuffs=[];d.slot=null;
  if(node.kind==='boss'&&d.act===3){d.phase='victory';return success('王都陷落，白骨军团完成远征','victory')}
  if(node.kind==='boss')d.act++;
  d.phase='map';return success(choiceId==='skip'?'已放弃奖励，继续远征':'奖励已领取，继续远征','travel');
})}

export function cancelQueuedItems(run:RunState):ActionResult{return transaction(run,d=>{
  requirePrep(d);requireRule(d.waveState.queuedFamily||d.waveState.queuedOil,'没有待拉杆消耗的道具');d.waveState.queuedFamily=null;d.waveState.queuedOil=false;return success('已取消预备道具，库存未消耗');
})}
export function useItem(run:RunState,itemId:string,options:ItemUseOptions={}):ActionResult {
  let battleCommand:WaveBuff|null=null;
  const result=transaction(run,d=>{
    getItem(itemId);requireRule(itemCount(d,itemId)>0,'没有这件道具');
    const reserved=(d.waveState.queuedFamily?1:0)+(d.waveState.queuedOil?1:0);
    requireRule(d.waveState.itemUses+reserved<2,'每波道具使用与预备合计最多2份');
    if(itemId==='I01'||itemId==='I02'){
      requirePrep(d);sealPendingSpin(d);requireRule(!d.slot||d.slot.settled,'请先收取当前盘面');requireRule(spinCost(d)!==null,'本波没有剩余拉杆次数');
      if(itemId==='I01'){
        requireRule(!d.waveState.queuedFamily,'已预备引魂券，可先取消');requireRule(options.family&&d.familyWeights.some(w=>w.family===options.family),'请选择当前轮盘的一个家族');d.waveState.queuedFamily=options.family;
      }else {requireRule(!d.waveState.queuedOil,'已预备骨脂，可先取消');requireRule((spinCost(d)??0)>0,'骨脂只用于付费追加，不能用于免费抽');d.waveState.queuedOil=true}
      return success('道具已预备，下一次拉杆开始时才消耗库存');
    }
    if(['I03','I04','I05'].includes(itemId)){
      const action:SlotIntervention=itemId==='I03'?{kind:'lockColumn',index:options.index??-1}:itemId==='I04'?{kind:'swap',a:options.a??-1,b:options.b??-1}:{kind:'copy',a:options.a??-1,b:options.b??-1};
      interventionInternal(d,action,itemId);return success(d.slot?.materialized?'道具改盘完成，本盘新兵已同步更新':'道具已用于当前盘面，尚未结算士兵','slot-edit');
    }
    if(itemId==='I11'||itemId==='I12'){
      requireRule(d.phase==='battle'&&d.pendingCombatInput,'只能在正在进行的战斗中使用');requireRule(d.waveState.battleItemUses<1,'每波战内道具最多1份');
      const battle=options.battle;requireRule(battle&&battle.result===null&&battle.input.seed===d.pendingCombatInput.seed,'需要当前正在运行的战斗');
      const target=battle.units.find(u=>u.sourceUid===options.uid&&u.side==='ally'&&!u.temporary&&u.alive&&u.hp>0);requireRule(target,'请选择存活的永久上阵兵');
      if(itemId==='I11')requireRule(target.hp<target.maxHp,'该兵生命已满');
      if(itemId==='I12')requireRule(battle.corpses.some(c=>!c.consumed&&Math.hypot(c.x-target.x,c.y-target.y)<=2),'所选兵2米内没有可用尸骸');
      consumeItem(d,itemId);d.waveState.battleItemUses++;
      battleCommand={type:itemId==='I11'?'itemHeal':'itemCorpseExplosion',uid:options.uid,value:itemId==='I11'?10:14,source:`${itemId}:${waveKey(d)}:${d.waveState.itemUses}`};
      d.waveBuffs.push(battleCommand);d.pendingCombatInput.buffs.push(battleCommand);
      return success(itemId==='I11'?'急救骨胶已投入战场':'尸爆命令已送入战场','item');
    }
    requirePrep(d);sealPendingSpin(d);
    if(itemId==='I10'){
      requireRule(!d.nodeState.phylacteryItemUsed,'每节点只能使用一次命匣碎片');requireRule(d.hp<d.maxHp,'命匣已满');consumeItem(d,itemId);d.hp=Math.min(d.maxHp,d.hp+4);d.nodeState.phylacteryItemUsed=true;return success('命匣恢复4生命','heal');
    }
    const u=d.army.find(x=>x.uid===options.uid);requireRule(u,'请选择一名正式兵');
    const targetKey=`${itemId}:${u.uid}`;requireRule(!d.waveState.usedItemTargets.includes(targetKey),'同一目标本波已使用这件道具');
    if(itemId==='I06'){
      requireRule(u.xp<150,'该兵已经达到Lv8');consumeItem(d,itemId);const amount=addXp(u,6);d.waveState.usedItemTargets.push(targetKey);return success(`训练经验+${amount}`,'upgrade');
    }
    requireRule(u.slot!==null,'这件战备道具需要选择上阵兵');
    const kinds:Record<string,{type:string;value:number}>={I07:{type:'openingShield',value:12},I08:{type:'firstHalfRegen',value:5},I09:{type:'poisonFirstHits',value:3}};
    const effect=kinds[itemId];requireRule(effect,'此道具使用方式无效');consumeItem(d,itemId);d.waveState.usedItemTargets.push(targetKey);
    addBuffOnce(d,{...effect,uid:u.uid,source:`${itemId}:${waveKey(d)}:${u.uid}`});return success('战备道具已绑定该兵，本波有效','item');
  });
  if(result.ok&&battleCommand&&options.battle&&!options.battle.input.buffs.some(b=>b.source===battleCommand!.source))options.battle.input.buffs.push(battleCommand);
  return result;
}

export function validateRun(value:unknown):ActionResult {
  try {
    const record=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
    const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
    const integer=(v:unknown,max=Infinity)=>finite(v)&&Number.isInteger(v)&&Number(v)<=max;
    const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
    const buffs=(v:unknown)=>Array.isArray(v)&&v.every(b=>record(b)&&typeof b.type==='string'&&typeof b.value==='number'&&Number.isFinite(b.value)&&(!b.uid||typeof b.uid==='string')&&(!b.source||typeof b.source==='string'));
    const stats=(v:unknown)=>record(v)&&['damage','healing','shield','summons','crits','poisonDamage','explosionDamage','kills'].every(k=>finite(v[k]))&&record(v.comboCounts)&&record(v.unitStats);
    const spawns=(v:unknown)=>Array.isArray(v)&&v.every(e=>record(e)&&ENEMIES.some(t=>t.id===e.templateId)&&integer(e.count)&&Number(e.count)>0&&(e.hpScale===undefined||finite(e.hpScale))&&(e.atkScale===undefined||finite(e.atkScale)));
    const input=(v:unknown)=>record(v)&&integer(v.seed,0xffffffff)&&Array.isArray(v.team)&&spawns(v.enemies)&&strings(v.relics)&&buffs(v.buffs)&&integer(v.act,3)&&integer(v.wave,3)&&finite(v.phylacteryHp);
    requireRule(value&&typeof value==='object','存档不是有效对象');const d=value as RunState;
    requireRule(d.schemaVersion===1,'存档版本不兼容');requireRule(typeof d.seed==='string'&&typeof d.id==='string','缺少存档种子');
    requireRule(STARTERS.some(s=>s.id===d.starterId),'存档初始流派无效');
    requireRule(['map','prep','battle','waveResult','reward','shop','grave','workshop','event','victory','defeat'].includes(d.phase),'存档阶段无效');
    requireRule(Number.isFinite(d.bones)&&d.bones>=0&&Number.isFinite(d.hp)&&d.hp>=0&&d.hp<=d.maxHp&&d.maxHp===60,'存档资源无效');
    requireRule(Number.isInteger(d.capacity)&&d.capacity>=4&&d.capacity<=8&&d.reserveCapacity===8,'存档容量无效');
    requireRule(Number.isInteger(d.machineCapacity)&&d.machineCapacity>=2&&d.machineCapacity<=4&&d.armyRelicCapacity===6,'存档遗物容量无效');
    requireRule(Number.isInteger(d.act)&&d.act>=1&&d.act<=3&&Number.isInteger(d.wave)&&d.wave>=1&&d.wave<=3,'存档章节或波次无效');
    requireRule(Array.isArray(d.familyWeights)&&validWeightArray(d.familyWeights),'存档权重无效');
    requireRule(Array.isArray(d.army)&&Array.isArray(d.staging),'缺少军队记录');
    const units=permanentUnits(d);requireRule(units.length>0&&new Set(units.map(u=>u.uid)).size===units.length,'存档军队为空或含重复士兵');
    for(const u of units){
      requireRule(typeof u.uid==='string'&&UNITS.some(t=>t.id===u.templateId),'存档含未知兵种');
      requireRule(Number.isFinite(u.xp)&&u.xp>=0&&u.xp<=150&&[null,'A','B'].includes(u.specialization),'存档训练记录无效');
      requireRule(u.specialization===null||levelForXp(u.xp)>=4,'未达到Lv4却拥有专精');
      requireRule(u.slot===null||Number.isInteger(u.slot)&&u.slot>=0&&u.slot<d.capacity,'存档部署格无效');
    }
    const slots=deployedUnits(d).map(u=>u.slot);requireRule(new Set(slots).size===slots.length,'多个士兵占用同一位置');
    requireRule(reserveUnits(d).length<=8&&d.staging.every(u=>u.slot===null),'后备或招募暂存无效');
    requireRule(Array.isArray(d.map)&&d.map.length===57&&new Set(d.map.map(n=>n.id)).size===57,'地图记录不完整');
    requireRule(!d.currentNodeId||d.map.some(n=>n.id===d.currentNodeId),'存档当前节点不存在');
    requireRule(d.map.every(n=>Array.isArray(n.links)&&n.links.every(id=>d.map.some(m=>m.id===id))),'地图连边无效');
    requireRule(d.map.every(n=>integer(n.act,3)&&n.act>=1&&integer(n.layer,7)&&n.layer>=1&&integer(n.lane,2)&&['normal','elite','boss','shop','grave','workshop','event'].includes(n.kind)&&typeof n.name==='string'&&typeof n.visited==='boolean'&&typeof n.completed==='boolean'&&Array.isArray(n.waves)&&n.waves.every(spawns)),'地图节点内容无效');
    requireRule(Array.isArray(d.ownedRelics)&&new Set(d.ownedRelics).size===d.ownedRelics.length&&d.ownedRelics.every(id=>RELICS.some(r=>r.id===id)),'遗物库存无效');
    for(const type of ['machine','army'] as const){const eq=equipment(d,type);requireRule(Array.isArray(eq)&&new Set(eq).size===eq.length&&eq.length<=equipmentCapacity(d,type)&&eq.every(id=>d.ownedRelics.includes(id)&&getRelic(id).type===type),'遗物装备无效')}
    requireRule(d.items&&typeof d.items==='object'&&Object.keys(d.items).length<=3&&Object.entries(d.items).every(([id,n])=>ITEMS.some(i=>i.id===id)&&Number.isInteger(n)&&n>0&&n<=3),'道具背包无效');
    requireRule(d.waveState&&d.nodeState&&Array.isArray(d.completedWaveKeys)&&Array.isArray(d.claimedNodeKeys)&&Array.isArray(d.waveBuffs),'存档事务记录不完整');
    requireRule(record(d.runStats)&&['spins','wavesWon','wavesPlayed','nodesCompleted','unitsSummoned','sacrificed','fusions','bonesEarned','bonesSpent','kills','totalDamage','totalHealing'].every(k=>finite(d.runStats[k as keyof RunStats])),'存档统计记录不完整');
    requireRule(integer(d.waveState.spins,6)&&integer(d.waveState.paidSpins,5)&&integer(d.waveState.itemUses,2)&&integer(d.waveState.battleItemUses,1)&&strings(d.waveState.usedItemTargets)&&strings(d.waveState.newUnits)&&typeof d.waveState.refundUsed==='boolean'&&typeof d.waveState.queuedOil==='boolean','存档波次计数无效');
    requireRule((d.waveState.queuedFamily===null||FAMILY_IDS.includes(d.waveState.queuedFamily)&&itemCount(d,'I01')>0)&&(!d.waveState.queuedOil||itemCount(d,'I02')>0)&&d.waveState.itemUses+Number(Boolean(d.waveState.queuedFamily))+Number(d.waveState.queuedOil)<=2,'存档预备道具无效');
    requireRule(typeof d.nodeState.machineLocked==='boolean'&&typeof d.nodeState.serviceUsed==='boolean'&&typeof d.nodeState.shopWeightUsed==='boolean'&&typeof d.nodeState.phylacteryItemUsed==='boolean'&&integer(d.nodeState.shopRefreshes,3)&&buffs(d.nodeState.eventBuffs),'存档节点事务无效');
    requireRule(d.nodeState.temporaryShift===null||d.nodeState.temporaryShift.amount===2&&validWeightArray(activeWeights(d))&&d.machineRelics.includes('R_M17'),'存档临时配重无效');
    requireRule(strings(d.completedWaveKeys)&&strings(d.claimedNodeKeys)&&strings(d.seenEvents)&&buffs(d.waveBuffs)&&buffs(d.pendingBossBuffs)&&finite(d.pendingBossBones),'存档奖励或事件记录无效');
    requireRule(Array.isArray(d.rewardChoices)&&d.rewardChoices.every(c=>typeof c.id==='string'&&typeof c.label==='string'&&(c.kind==='bones'&&finite(c.amount)||c.kind==='relic'&&RELICS.some(t=>t.id===c.relicId))),'存档奖励候选无效');
    requireRule(Array.isArray(d.shopStock)&&d.shopStock.every(o=>typeof o.id==='string'&&typeof o.sold==='boolean'&&finite(o.price)&&(o.kind==='relic'?RELICS.some(t=>t.id===o.contentId):o.kind==='item'&&ITEMS.some(t=>t.id===o.contentId))),'存档黑市库存无效');
    requireRule(d.eventId===null||EVENTS.some(e=>e.id===d.eventId),'存档事件无效');
    requireRule(Number.isInteger(d.rngState)&&d.rngState>=0&&d.rngState<=0xffffffff,'随机状态无效');
    requireRule(Number.isInteger(d.nextUid)&&d.nextUid>0&&Number.isInteger(d.nextSpin)&&d.nextSpin>0,'实例编号无效');
    requireRule(units.every(u=>/^u\d+$/.test(u.uid)&&Number(u.uid.slice(1))<d.nextUid),'士兵实例编号可能重复');
    requireRule(d.pendingCombatInput===null||input(d.pendingCombatInput),'存档战斗输入无效');
    requireRule(d.phase!=='battle'||d.pendingCombatInput,'战斗存档缺少起始输入');
    requireRule(d.phase!=='waveResult'||d.battleResult&&['win','loss','retreat'].includes(d.battleResult.result)&&finite(d.battleResult.duration)&&stats(d.battleResult.stats),'存档波结算无效');
    if(d.battleSnapshot){const b=d.battleSnapshot;requireRule(d.phase==='battle'&&finite(b.time)&&integer(b.rngState,0xffffffff)&&Array.isArray(b.units)&&b.units.every(u=>finite(u.hp)&&finite(u.maxHp)&&Number.isFinite(u.x)&&Number.isFinite(u.y)&&Array.isArray(u.statuses)&&record(u.counters)&&record(u.cooldowns))&&Array.isArray(b.corpses)&&Array.isArray(b.effects)&&strings(b.log)&&stats(b.stats)&&input(b.input)&&b.input.seed===d.pendingCombatInput?.seed,'战斗快照无效')}
    if(d.slot){
      const slot=d.slot;
      requireRule(typeof slot.id==='string'&&typeof slot.settled==='boolean'&&finite(slot.paidCost)&&typeof slot.free==='boolean'&&integer(slot.interventions,2)&&strings(slot.usedSources)&&slot.usedSources.length===slot.interventions&&Array.isArray(slot.wins)&&Array.isArray(slot.board)&&slot.board.length===9&&slot.board.every(f=>FAMILY_IDS.includes(f)),'存档盘面无效');
      const modern=['materialized','provisionalUids','provisionalSnapshot','birthBranches','revision','sealedRevision'].some(k=>k in slot);
      if(modern){
        requireRule(slot.materialized===true&&strings(slot.provisionalUids)&&Array.isArray(slot.provisionalSnapshot)&&record(slot.birthBranches)&&integer(slot.revision,slot.interventions),'存档即时出生记录无效');
        requireRule(Object.entries(slot.birthBranches!).every(([family,id])=>FAMILY_IDS.includes(family as FamilyId)&&typeof id==='string'&&UNITS.some(u=>u.family===family&&u.id===id)),'存档出生分支无效');
        if(slot.settled){
          requireRule(slot.provisionalUids!.length===0&&slot.provisionalSnapshot!.length===0&&slot.sealedRevision===slot.revision,'存档锁盘记录无效');
        }else{
          requireRule(d.phase==='prep'&&slot.sealedRevision===undefined,'未锁盘新兵只能存在于准备阶段');
          provisionalIntegrity(d);
          requireRule(!slot.provisionalUids!.some(uid=>d.waveState.newUnits.includes(uid)||d.waveBuffs.some(b=>b.uid===uid)),'未锁盘新兵已经结算收益');
        }
      }
    }
    return {ok:true};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:'存档无效'}}
}
export function serializeRun(run:RunState,battle?:BattleState):string {
  const payload=structuredClone(run);
  if(battle&&run.phase==='battle'&&run.pendingCombatInput?.seed===battle.input.seed)payload.battleSnapshot=structuredClone(battle);
  const valid=validateRun(payload);if(!valid.ok)throw new Error(valid.message);return JSON.stringify(payload);
}
export function deserializeRun(text:string):RunState|null {
  try {const parsed:unknown=JSON.parse(text);if(!validateRun(parsed).ok)return null;return parsed as RunState}catch{return null}
}
