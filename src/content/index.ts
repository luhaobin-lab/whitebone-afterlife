import unitData from './units.json';
import systemData from './systems.json';
import worldData from './world.json';
import type {UnitDefinition,FamilyDefinition,SpecializationDefinition,RelicDefinition,ItemDefinition,EnemyDefinition,UnitInstance,DerivedStats,FamilyId} from '../domain/types';
export const UNITS=unitData.units as unknown as UnitDefinition[];
export const FAMILIES=unitData.families as unknown as FamilyDefinition[];
export const SPECIALIZATIONS=unitData.specializations as unknown as SpecializationDefinition[];
export const SYNERGIES=unitData.synergies;
export const RELICS=systemData.relics as unknown as RelicDefinition[];
export const ITEMS=systemData.items as unknown as ItemDefinition[];
export const STATUSES=systemData.statuses;
export const BUILDS=systemData.builds;
export const ENEMIES=worldData.enemies as unknown as EnemyDefinition[];
export const ENCOUNTERS=worldData.encounters;
export const EVENTS=worldData.events;
export const NODES=worldData.nodes;
export const XP_THRESHOLDS=[0,6,16,30,50,76,110,150] as const;
export const FAMILY_COLORS:Record<FamilyId,string>={SK:'#e6d9b7',ZM:'#92bc74',HR:'#c57e69',HD:'#bc9ad7',BL:'#82c8cb',CF:'#c8a875'};
export const FAMILY_NAMES:Record<FamilyId,string>={SK:'骷髅',ZM:'腐尸',HR:'丧马',HD:'断手',BL:'骨铃',CF:'棺材'};
export const getUnit=(id:string):UnitDefinition=>{const u=UNITS.find(x=>x.id===id);if(!u)throw new Error('Unknown unit '+id);return u};
export const getRelic=(id:string):RelicDefinition=>{const r=RELICS.find(x=>x.id===id);if(!r)throw new Error('Unknown relic '+id);return r};
export const getItem=(id:string):ItemDefinition=>{const r=ITEMS.find(x=>x.id===id);if(!r)throw new Error('Unknown item '+id);return r};
export const getEnemy=(id:string):EnemyDefinition=>{const r=ENEMIES.find(x=>x.id===id);if(!r)throw new Error('Unknown enemy '+id);return r};
export const levelForXp=(xp:number):number=>{let level=1;for(let i=1;i<XP_THRESHOLDS.length;i++)if(xp>=XP_THRESHOLDS[i])level=i+1;return level};
export const xpForLevel=(level:number):number=>XP_THRESHOLDS[Math.max(0,Math.min(7,Math.floor(level)-1))];
export function getStats(unit:UnitInstance):DerivedStats {
 const d=getUnit(unit.templateId),level=levelForXp(unit.xp);
 return {hp:Math.round(d.hp*(1+.08*(level-1))),atk:d.atk*(1+.06*(level-1)),armor:d.armor+2*(level-1),aps:d.aps,move:d.move,range:d.range,critRate:d.crit_rate,critMult:d.crit_mult,regen:d.regen,blockRate:d.block_rate,blockReduction:d.block_reduction,lifesteal:d.lifesteal,damageType:d.basic_damage_type,level};
}
export function makeUnit(templateId:string,uid:string,xp=0,slot:number|null=null):UnitInstance {getUnit(templateId);return {uid,templateId,xp:Math.max(0,Math.min(150,xp)),specialization:null,slot,acquiredAt:0}}
export function specializationsFor(id:string){return SPECIALIZATIONS.filter(x=>x.unit_id===id)}
