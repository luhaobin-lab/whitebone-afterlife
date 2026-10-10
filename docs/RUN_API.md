# Campaign API v1

`src/domain/run.ts` exports the interfaces and functions below. All actions mutate the supplied run **only on success**, and return the shared `ActionResult` (`{ok,message?,sound?,newlySpecializableUids?}`). Getters do not mutate RNG. State is JSON-serializable. UI should display `message` when an action fails, then render from the same state. Successful transactions replace nested state objects, so retain UIDs rather than stale unit object references.

```ts
export type RunPhase = 'map'|'prep'|'battle'|'waveResult'|'reward'|'shop'|'grave'|'workshop'|'event'|'victory'|'defeat';
export type StarterId = 'legion'|'plague'|'cavalry';
export interface FamilyWeight { family: FamilyId; weight: number }
export interface StarterDefinition { id:StarterId; name:string; description:string; families:FamilyId[]; units:string[] }
export interface MapNode {
 id:string; act:number; layer:number; lane:number; kind:NodeKind; name:string;
 links:string[]; visited:boolean; completed:boolean; seed:number;
 waves:EnemySpawn[][]; preview:string; rewardPreview:string;
}
export interface SlotState {
 id:string; board:FamilyId[]; wins:SlotWin[]; settled:boolean;
 paidCost:number; free:boolean; interventions:number; usedSources:string[];
 boostFamily:FamilyId|null;
 materialized?:boolean; provisionalUids?:string[]; provisionalSnapshot?:UnitInstance[];
 birthBranches?:Partial<Record<FamilyId,string>>; revision?:number; sealedRevision?:number;
}
export interface RewardChoice { id:string; kind:'relic'|'bones'; relicId?:string; amount?:number; label:string }
export interface ShopOffer { id:string; kind:'relic'|'item'; contentId:string; price:number; sold:boolean }
export interface WaveSummary {
 result:'win'|'loss'|'retreat'; hpLost:number; bones:number; duration:number;
 stats:BattleStats; nodeComplete:boolean; message:string;
}
export interface RunStats {
 spins:number; wavesWon:number; wavesPlayed:number; nodesCompleted:number;
 unitsSummoned:number; sacrificed:number; fusions:number; bonesEarned:number;
 bonesSpent:number; kills:number; totalDamage:number; totalHealing:number;
}
export interface RunState {
 schemaVersion:1; id:string; seed:string; rngState:number; phase:RunPhase;
 starterId:StarterId; act:number; bones:number; hp:number; maxHp:number;
 capacity:number; reserveCapacity:number; machineCapacity:number; armyRelicCapacity:number;
 army:UnitInstance[]; staging:UnitInstance[]; familyWeights:FamilyWeight[];
 ownedRelics:string[]; machineRelics:string[]; armyRelics:string[]; items:Record<string,number>;
 map:MapNode[]; currentNodeId:string|null; wave:number; slot:SlotState|null;
 rewardChoices:RewardChoice[]; shopStock:ShopOffer[]; eventId:string|null;
 waveBuffs:WaveBuff[]; battleResult:WaveSummary|null; runStats:RunStats;
 battleSnapshot:BattleState|null;
 // Additional serializable internal counters are owned by run.ts. UI need not write them.
 [key:string]:unknown;
}
export interface ItemUseOptions {
 uid?:string; family?:FamilyId; index?:number; a?:number; b?:number;
 battle?:BattleState; // Required only for I11/I12 to validate the live target/corpse.
}
export const STARTERS:readonly StarterDefinition[];
export function createRun(seed:string|number=Date.now(), starter:StarterId='legion'):RunState;
export function currentNode(run:RunState):MapNode|null;
export function availableNodes(run:RunState):MapNode[];
export function activeWeights(run:RunState):FamilyWeight[];
export function deployedUnits(run:RunState):UnitInstance[];
export function reserveUnits(run:RunState):UnitInstance[];
export function findUnit(run:RunState, uid:string):UnitInstance|undefined;
export function spinCost(run:RunState):number|null; // 0=free; null=no additional spin allowed.
export function canSpin(run:RunState):ActionResult; // Includes the current board's deferred refund on seal.
export function expansionCost(run:RunState):number|null; // 16/24/32/42; null at capacity8.
export function refreshCost(run:RunState):number|null;
export function canStartWave(run:RunState):ActionResult;
export function getSlotWins(run:RunState):SlotWin[]; // Includes I01 final-rank/M14 training effects.
export function unequippedRelics(run:RunState):string[];
export function pendingSpecializations(run:RunState):UnitInstance[];
export function interventionOptions(run:RunState):InterventionOption[];
// InterventionOption={sourceId,kind,label,cost,available,reason?}; both equipped machines and owned tools.
export function chooseNode(run:RunState,nodeId:string):ActionResult;
export function spin(run:RunState):ActionResult;
export function materializeSpin(run:RunState):ActionResult;
export function sealSpin(run:RunState):ActionResult;
export function chooseBirthBranch(run:RunState,uid:string,choice:'A'|'B'):ActionResult;
export function intervene(run:RunState,action:SlotIntervention,sourceId?:string):ActionResult;
export function claimSpin(run:RunState,branches?:Partial<Record<FamilyId,string>>):ActionResult;
// branches maps each R2/R3 winning family to 'A'/'B' or a permitted full template ID.
export function deployUnit(run:RunState,uid:string,slot:number):ActionResult;
export function benchUnit(run:RunState,uid:string):ActionResult;
export function dismissUnit(run:RunState,uid:string):ActionResult;
export function sacrifice(run:RunState,donorUid:string,recipientUid:string):ActionResult;
export function fuseBodies(run:RunState,recipientUid:string,bodyUid:string):ActionResult;
export function chooseSpecialization(run:RunState,uid:string,choice:'A'|'B'):ActionResult;
export function expandCapacity(run:RunState):ActionResult;
export function buyShop(run:RunState,offerId:string,replaceRelicId?:string):ActionResult;
export function refreshShop(run:RunState):ActionResult;
export function transferWeight(run:RunState,from:FamilyId,to:FamilyId,amount?:number,source?:'shop'|'relic'):ActionResult;
export function reconfigureWeights(run:RunState,weights:FamilyWeight[]):ActionResult;
export function replaceFamily(run:RunState,from:FamilyId,to:FamilyId):ActionResult;
export function restAtGrave(run:RunState,choice:'heal'|'train',uid?:string):ActionResult;
export function chooseEvent(run:RunState,choice:'a'|'b'|'c',uid?:string,options?:{uids?:string[];from?:FamilyId;to?:FamilyId}):ActionResult;
export function leaveService(run:RunState):ActionResult;
export function getCombatInput(run:RunState):CombatInput;
export function startWave(run:RunState):ActionResult;
export function finishWave(run:RunState,battle:BattleState):ActionResult;
export function continueAfterWave(run:RunState):ActionResult;
export function chooseReward(run:RunState,choiceId:string,replaceRelicId?:string):ActionResult;
// choiceId='voucher' is ordinary-node skip-all-for-I01; 'skip' always allows leaving reward.
export function equipRelic(run:RunState,relicId:string,replaceId?:string):ActionResult;
export function unequipRelic(run:RunState,relicId:string):ActionResult;
export function useItem(run:RunState,itemId:string,options?:ItemUseOptions):ActionResult;
export function cancelQueuedItems(run:RunState):ActionResult;
export function serializeRun(run:RunState,battle?:BattleState):string;
export function deserializeRun(text:string):RunState|null;
export function validateRun(run:unknown):ActionResult;
```

Immediate-birth UI integration: call `spin`, play the stopping animation, then call `materializeSpin` once. There is no result-claim panel. The three states are rolled (`!materialized && !settled`), materialized (`materialized && !settled`), and finalized (`settled`). Materialization places real units into available deployed slots, with excess units in real `staging`; it never replaces or benches an older unit. Repeat materialization is idempotent. A/B professions initially use A; `chooseBirthBranch` changes only a current provisional unit's profession, preserving its UID, XP and slot, and does not finalize the board. A small inline choice is sufficient; a forced claim dialog is unnecessary.

While materialized, normal board interventions and I03/I04/I05 atomically validate the saved new-unit snapshots, remove only this board's provisional UIDs, apply the existing payment/item/RNG operation, and materialize the new result. A previous A/B choice survives only if still valid for that family and rank. New UIDs remain strictly increasing; old drag/selection UIDs cannot accidentally refer to new bodies. The UI should clear an obsolete selected UID after successful editing. `revision` counts edits after the initial materialization. The global two-intervention and per-source limits are unchanged.

Every successful deployment, bench, dismissal, absorption, body fusion, specialization, expansion, relic equipment change, non-board-edit item use, next pull or battle start finalizes an outstanding materialized board **inside the same transaction**. A failed operation leaves the board editable and does not consume payment, items, UIDs or RNG. Selecting a unit, viewing details, opening a codex, and other read-only UI actions must not call `sealSpin`. Explicit `sealSpin` is safe to retry after finalization. Finalization ends A/B birth switching for that board.

M11 refund, M12 multi-family movement, M13/M16 recruit buffs, M15 empty-board barrier, `runStats.unitsSummoned`, and `waveState.newUnits` are recorded only at finalization. This prevents an empty-board refund or a replaced recruit's buffs from surviving an edit. The persisted `slot.id` plus `settled` and `sealedRevision` is the finalization receipt; repeated finalization cannot pay twice. A pending M11 refund may fund the next pull: use `canSpin` for disabled-state validation and `spinCost` for the displayed price, rather than comparing current bones directly with the price.

`newlySpecializableUids` lists units that became eligible for a specialization during the successful transaction, including absorption, training, body fusion, and high-level automatic birth. `pendingSpecializations` remains the full current query. The UI can show a lightweight badge for a provisional Lv5/Lv8 birth and a contextual prompt for an XP upgrade; automatically opening a blocking modal on materialization would interfere with the remaining board-edit opportunity. The domain never chooses a training specialization automatically.

Battle integration: `canStartWave` accepts a materialized unfinalized board once staging and specialization requirements are resolved. `startWave` finalizes the board and builds `pendingCombatInput` from that same state. After successful `startWave`, use `getCombatInput`, create the battle once and keep its seed. Before battle start, `getCombatInput` returns a pure projection including deferred finalization buffs; it does not mutate the run. Do not retain an older preview input across board edits. On result, call `finishWave` once, then show `waveResult`. The primary button calls `continueAfterWave`, advancing to next prep, reward, map or defeat. After reward, `chooseReward` advances automatically to map/next act/victory. Ordinary/elite defeat with surviving phylactery retreats; any Boss-wave failure ends the run. Service buttons must always expose `leaveService`.

Legacy compatibility: calling `claimSpin` on a non-materialized board retains the old behavior: explicit A/B choices are required and all recruits go to `staging`. Existing simulations need no change. Calling it on a materialized board applies any explicit valid A/B choices and finalizes the already existing units; it does not spawn them again. All staged units still require deployment, benching, absorption or explicit dismissal before combat. Deployed units have `slot` 0..capacity-1; bench units have null slots. Existing deployed-unit drops swap positions; dropping a staged unit onto an occupied slot moves the displaced unit to reserve only if space exists. `fuseBodies` requires same family, strictly higher birth rank body, keeps the recipient UID and max(oldXP,newXP), replaces template and resets specialization if the profession changes.

Relics are owned independently of slots. A reward or purchase always enters owned inventory; if the relevant equipment type has a free slot it auto-equips. Otherwise UI can pass `replaceRelicId` when acquiring, or show `unequippedRelics` with a replacement picker. Machine configuration locks at the node's first spin; army equipment locks only during battle. No reward must softlock when equipment is full.

Save continuation: optional materialization fields are absent in older schema-v1 saves and remain absent when loaded. An old unsettled board can be materialized once when its resumed UI displays the stopped wheel. `deserializeRun` itself never spawns units or pays rewards. New saves retain exact provisional UIDs, snapshots, branches and revision; changed/missing provisional units or inconsistent finalization receipts are rejected. Pass the live battle as the second argument to serializeRun while fighting. A loaded run's battleSnapshot can be used directly to resume exact movement, random state, effects and consumed-item timing. Without a supplied snapshot, a battle-phase run preserves its pending CombatInput and can restart that wave without additional costs; exact mid-wave resumption requires the snapshot. Completed-wave bookkeeping and reward IDs prevent duplicate payouts. `deserializeRun` checks schema and invariants and rejects invalid JSON. It does not silently start a new game.

WaveBuff names emitted to combat: `openingShield` (uid,value,duration implicit6s), `openingMove` (value=.15,duration6s), `damageMultiplier` (uid,value=.15), `phylacteryBarrier` (value=6), `firstHalfRegen` (uid,value=5), `poisonFirstHits` (uid,value=3), `enemyAttackSpeedMultiplier` (value=.92), `allyMaxHpMultiplier` (value=1.10), `allDamageMultiplier` (value=1.10), `itemHeal` (uid,value=10), `itemCorpseExplosion` (uid,value=14). `source` uniquely identifies consumable commands; combat executes each once. I11/I12 validate against `options.battle` then append command to its input buffs, so the engine must consume newly appended command buffs during ticking.

Slot integration uses the pure action helpers in `src/domain/slot.ts`. The complete machine set includes `rotateColumn` and `swapColumns`; M08 uses `copy` with destination4. Interventions validate relic/item ownership, adjacency where applicable, per-source-per-board use, global two-action cap and full cost before mutating board/RNG.

I01/I02 are armed before a spin and consume inventory only when the paid/free transaction actually begins. `cancelQueuedItems` releases them at no cost. Armed items reserve this wave's two-item quota. I11/I12 add uniquely sourced commands to `battle.input.buffs`; all other item buffs are supplied with the wave's initial CombatInput.

If the player starts combat without taking the armed pull, `startWave` releases I01/I02 reservations automatically, preserves their inventory, and reports this in its success message. They do not occupy the battle-item quota. R_M13 records every qualifying new recruit as a candidate, but `getCombatInput` grants its shield to only the first two surviving deployed candidates; sacrificed or benched candidates do not consume that limit, and the buff is not inherited by an XP or body-fusion recipient.

Implementation tuning to record in the central balance log: every won wave awards each deployed permanent soldier 2 training XP. This rewards participation by support roles across 36 waves without changing birth rank, and requires combat testing rather than treating it as balanced. Map layer1 enemy base scales are0.90, layer3 1.00, layer5 1.08, with seeded ±3% variation; bosses use1.00. Late ordinary groups can vary by one visible unit. These are visible encounter data, not hidden player-dependent correction. Black-market refreshes cost4/7/10 and stop after three. Each act's first service layer excludes events, so at most six unique events are visited across three acts and the authored pool of eight never exhausts.

Map reachability: all57 drawn nodes have at least one legal path from the first act's entry layer. Non-Boss nodes retain one or two forward links to adjacent lanes, and each Boss links to the next act's three entry choices. The generator repairs missing incoming edges deterministically before returning; no drawn lane is permanently isolated. Existing serialized saves retain their recorded maps.

Late encounter profiles: only act3/layer5/wave3 replaces two E11 guards. Normal nodes receive two E14; elite nodes with even node seeds receive two E07 plus two E09, while odd seeds receive two E14. These profiles are mutually exclusive, consume no new RNG draw, inherit the original wave's visible HP/ATK scales, and reduce total base HP/entry shields. Ordinary seeded guard-count variation is preserved by replacing exactly two guards rather than replacing the entire old wave. `node.preview` gives the exact resulting enemy counts and warning/counterplay text. Saved maps are not regenerated on loading.
