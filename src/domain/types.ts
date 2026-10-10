export type FamilyId = 'SK'|'ZM'|'HR'|'HD'|'BL'|'CF';
export type DamageType = 'PHY'|'MAG'|'TRUE';
export type SpecializationChoice = 'A'|'B'|null;
export interface SkillDefinition { id:string; name:string; trigger:string; target:string; effect:string; coefficient:number; cooldown:number; max_targets:number; proc_policy:string }
export interface UnitDefinition {
 id:string; family:FamilyId; rank:number; branch:string; name:string; role:string; undead_form:string;
 hp:number; atk:number; armor:number; aps:number; move:number; range:number; crit_rate:number; crit_mult:number;
 regen:number; block_rate:number; block_reduction:number; lifesteal:number; basic_damage_type:DamageType;
 primary:SkillDefinition; passive:SkillDefinition; needs:string[]; provides:string[]; weakness:string; visual:string; scope:string;
}
export interface FamilyDefinition {id:FamilyId;name:string;symbol:string;humor:string;role:string;branch_a:string;branch_b:string}
export interface SpecializationDefinition {id:string;unit_id:string;unlock_level:number;choice:'A'|'B';name:string;effect:string;mechanical_change:string;tradeoff:string}
export interface RelicDefinition {id:string;name:string;type:'machine'|'army';rarity:'common'|'rare'|'legendary';price:number;unlock_act:number;trigger:string;effect:string;limits:string;tags:string[];tradeoff:string;scope:string}
export interface ItemDefinition {id:string;name:string;price:number;use_phase:string;effect:string;limit:string;tags:string[];scope:string}
export interface EnemyDefinition {id:string;name:string;act:number;role:string;hp:number;atk:number;armor:number;aps:number;move:number;range:number;skill:string;threat:string;counterplay:string;bone_rule:string}
export interface UnitInstance {uid:string;templateId:string;xp:number;specialization:SpecializationChoice;slot:number|null;acquiredAt:number}
export interface DerivedStats {hp:number;atk:number;armor:number;aps:number;move:number;range:number;critRate:number;critMult:number;regen:number;blockRate:number;blockReduction:number;lifesteal:number;damageType:DamageType;level:number}
export interface SlotWin {family:FamilyId;lines:number[];lineCount:number;rank:number;level:number;templateIds:string[]}
export type NodeKind='normal'|'elite'|'boss'|'shop'|'grave'|'workshop'|'event';
export interface EnemySpawn {templateId:string;count:number;hpScale?:number;atkScale?:number;boss?:boolean}
export interface WaveBuff {type:string;value:number;family?:FamilyId;uid?:string;source?:string}
export interface CombatInput {seed:number;team:UnitInstance[];enemies:EnemySpawn[];relics:string[];buffs:WaveBuff[];act:number;wave:number;nodeKind:NodeKind;phylacteryHp:number;timeLimit?:number}
export type BattleEventKind='hit'|'crit'|'heal'|'shield'|'shieldBreak'|'death'|'summon'|'dash'|'projectile'|'poison'|'lightning'|'taunt'|'bone'|'text'|'cast'|'freeze'|'burn'|'breach';
export interface BattleEffect {id:number;t:number;kind:BattleEventKind;x:number;y:number;toX?:number;toY?:number;amount?:number;color?:string;label?:string;duration:number;sourceId?:string;targetId?:string}
export interface CombatStatus {id:string;stacks:number;remaining:number;sourceId?:string;power?:number;[key:string]:unknown}
export interface CombatUnit {
 id:string;sourceUid?:string;templateId:string;name:string;family?:FamilyId;side:'ally'|'enemy';
 x:number;y:number;hp:number;maxHp:number;atk:number;armor:number;aps:number;range:number;move:number;
 critRate:number;critMult:number;blockRate:number;blockReduction:number;lifesteal:number;regen:number;
 damageType:DamageType;shield:number;alive:boolean;temporary:boolean;boss:boolean;rank:number;level:number;
 specialization:SpecializationChoice;action:'idle'|'move'|'attack'|'cast'|'hurt'|'dead';facing:1|-1;
 statuses:CombatStatus[];attackTimer:number;age:number;ttl?:number;ownerId?:string;
 counters:Record<string,number>;cooldowns:Record<string,number>;targetId?:string;
 damageDone:number;healingDone:number;shieldGiven:number;kills:number;summons:number;
 [key:string]:unknown;
}
export interface Corpse {id:string;x:number;y:number;side:'ally'|'enemy';family?:FamilyId;consumed:boolean;createdAt:number;templateId:string}
export interface BattleStats {damage:number;healing:number;shield:number;summons:number;crits:number;poisonDamage:number;explosionDamage:number;kills:number;comboCounts:Record<string,number>;unitStats:Record<string,{name:string;damage:number;healing:number;shield:number;kills:number;summons:number}>}
export interface BattleState {
 time:number;rngState:number;units:CombatUnit[];corpses:Corpse[];effects:BattleEffect[];nextEffectId:number;nextUnitId:number;
 result:null|'win'|'loss'|'retreat';phylacteryHp:number;phylacteryLoss:number;timeLimit:number;
 stats:BattleStats;input:CombatInput;eventCount:number;log:string[];
 [key:string]:unknown;
}
export interface ActionResult {ok:boolean;message?:string;sound?:string;newlySpecializableUids?:string[]}
