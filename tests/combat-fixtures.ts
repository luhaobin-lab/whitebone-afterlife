import {createBattle,stepBattle} from '../src/domain/combat';
import {makeUnit} from '../src/content';
import type {BattleState,CombatInput,CombatUnit} from '../src/domain/types';
export function input(ids=['U_SK_1','U_ZM_1','U_BL_1'],relics:string[]=[]):CombatInput{return {seed:913,team:ids.map((id,i)=>makeUnit(id,'u'+i,30,i)),enemies:[{templateId:'E01',count:4,hpScale:3,atkScale:.8}],relics,buffs:[],act:1,wave:1,nodeKind:'normal',phylacteryHp:80,timeLimit:75}}
export function allies(s:BattleState){return s.units.filter(u=>u.side==='ally')}
export function enemies(s:BattleState){return s.units.filter(u=>u.side==='enemy')}
export function shield(u:CombatUnit,n:number,duration=10){u.shield=n;u.statuses.push({id:'BONE_ARMOR',stacks:1,remaining:duration,sourceId:u.id,power:n,tag:'fixture'})}
export function advance(s:BattleState,t:number){for(let i=0;i<t*20&&!s.result;i++)stepBattle(s,.05)}
export function arena(id:string,choice:'A'|'B'|null=null):BattleState{
 const i=input([id,'U_SK_2A','U_BL_3A','U_CF_3B'],['R_A04']);i.team[0].specialization=choice;i.enemies=[{templateId:'E01',count:8,hpScale:6,atkScale:.6}];i.timeLimit=25;
 const s=createBattle(i);allies(s).forEach((u,j)=>{u.x=j===3?16:12+(j===1?1:0);u.y=6+(j===2?1:0);u.hp=u.maxHp*(j===3?.25:.5);u.attackTimer=j===0?0:1;u.critRate=j===0?1:0;u.counters.hits=10;u.cooldowns.blink=100});
 enemies(s).forEach((u,j)=>{u.x=13.2+(j%4)*1.5;u.y=6+Math.floor(j/4);u.attackTimer=2;u.statuses.push({id:'POISON',stacks:2,remaining:10,sourceId:allies(s)[0].id,tag:'fixture'},{id:'WET',stacks:1,remaining:10,sourceId:allies(s)[0].id},{id:'EXPOSED',stacks:1,remaining:10,sourceId:allies(s)[0].id});});
 s.corpses.push({id:'fixtureCorpse',x:13,y:6,side:'enemy',consumed:false,createdAt:0,templateId:'E01'});return s;
}

export function passiveArena(id:string,choice:'A'|'B'|null=null):BattleState {
 const i:CombatInput={seed:2,team:[id,'U_SK_1','U_BL_1','U_CF_3B'].map((id,j)=>makeUnit(id,'u'+j,30,j)),enemies:[{templateId:'E01',count:8,hpScale:2,atkScale:2}],relics:['R_A04','R_A07'],buffs:[],act:1,wave:1,nodeKind:'normal',phylacteryHp:90,timeLimit:35};i.team[0].specialization=choice;
 const s=createBattle(i),a=allies(s),e=enemies(s);
 a.forEach((u,j)=>{u.x=j===2?11:12;u.y=6;u.hp=u.maxHp*.5;u.critRate=1;u.counters.hits=10;u.cooldowns.blink=100;if(j===0)u.aps=2;u.attackTimer=j===0?0:2;shield(u,1,20)});
 e.forEach((u,j)=>{u.x=13.2+(j%4)*1.2;u.y=6+Math.floor(j/4);u.attackTimer=1;u.statuses.push({id:'POISON',stacks:2,remaining:8,sourceId:a[0].id,tag:'fixture'},{id:'WET',stacks:1,remaining:8,sourceId:a[0].id},{id:'SOUL_BRAND',stacks:1,remaining:8,sourceId:a[0].id});});
 if(id==='U_ZM_2A'){for(const v of e)v.statuses=[];e[6].statuses=[{id:'POISON',stacks:2,remaining:8,sourceId:a[0].id,tag:'fixture'}]}
 if(id==='U_HR_2B'||id==='U_HR_3B'){a[3].x=17;a[3].hp=a[3].maxHp*.1}
 if(id==='U_BL_4'||id==='U_CF_3A'){a[1].hp=1;a[1].shield=0;a[1].statuses=[];a[1].x=13;e[0].x=13.3;e[0].atk=1000;e[0].attackTimer=0}
 if(id==='U_CF_3A'){a[0].attackTimer=1;a[0].counters.hits=0}
 e[1].hp=1;s.corpses.push({id:'fixture',side:'enemy',x:13,y:6,consumed:false,createdAt:0,templateId:'E01'});return s;
}
export function signature(s:BattleState){return {time:s.time,result:s.result,damage:s.stats.damage,healing:s.stats.healing,shield:s.stats.shield,summons:s.stats.summons,poison:s.stats.poisonDamage,explosions:s.stats.explosionDamage,counts:s.stats.comboCounts,units:s.units.map(u=>({hp:u.hp,shield:u.shield,x:u.x,y:u.y,damage:u.damageDone,healing:u.healingDone,shieldGiven:u.shieldGiven,atk:u.atk,maxHp:u.maxHp,ttl:u.ttl,statuses:u.statuses.map(t=>({id:t.id,stacks:t.stacks,remaining:t.remaining}))}))}}
