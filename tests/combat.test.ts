import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, simulateBattle, COMBAT_UNIT_IDS } from '../src/domain/combat';
import { UNITS, makeUnit } from '../src/content';
import type { BattleState, CombatInput, CombatUnit } from '../src/domain/types';

import {input,allies,enemies,shield,advance,arena,passiveArena,signature} from './combat-fixtures';

test('identical seeds and save/resume preserve the exact battle',()=>{
 const a=createBattle(input()),b=createBattle(input());advance(a,8);advance(b,8);assert.deepEqual(a,b);
 const restored=JSON.parse(JSON.stringify(a));advance(a,20);advance(restored,20);assert.deepEqual(a,restored);
 assert.equal(JSON.stringify(a).includes('null'),true);assert.ok(a.effects.length<=150);assert.ok(a.log.length<=30);
});
test('fixed simulation step is independent of caller chunk size',()=>{const a=createBattle(input()),b=createBattle(input());for(let i=0;i<200;i++)stepBattle(a,.05);for(let i=0;i<40;i++)stepBattle(b,.25);a.accumulator=0;b.accumulator=0;assert.deepEqual(a,b)});
test('every profession has a working primary and both level-four choices run',()=>{
 assert.equal(COMBAT_UNIT_IDS.length,36);for(const d of UNITS)for(const choice of [null,'A','B'] as const){const s=arena(d.id,choice);advance(s,14);assert.ok((s.stats.comboCounts[d.id+':P']||0)>0,d.id+' '+choice+' primary not executed');assert.ok(s.units.every(u=>Number.isFinite(u.hp)&&u.hp>=0),d.id+' finite HP');assert.ok(s.eventCount<100000,d.id+' bounded events')}
});
test('temporary summons obey army/owner caps and expire without corpses or KO rewards',()=>{
 const s=createBattle(input(['U_HD_4','U_HD_4','U_HD_4','U_HD_4','U_HD_4','U_HD_4','U_HD_4','U_HD_4'],['R_A14','R_A18']));
 for(const u of allies(s)){u.x=12;u.y=6;u.aps=3;u.atk=.01;u.specialization='B';u.counters.hits=4}for(const u of enemies(s)){u.x=13;u.y=6;u.hp=u.maxHp=100000;u.atk=0}
 for(let i=0;i<800;i++){stepBattle(s,.05);assert.ok(s.units.filter(u=>u.alive&&u.temporary&&u.side==='ally').length<=12)}
 assert.ok(s.stats.summons>12);assert.equal(s.corpses.length,0);assert.equal(s.stats.comboCounts['U_HD_4:R_A14']||0,0);assert.equal(s.stats.comboCounts['U_HD_4:V']||0,0);
});
test('lethal shield breaking cannot be undone by shield-break healing',()=>{
 const s=createBattle(input(['U_SK_1','U_BL_3A'],['R_A07'])),[tank,healer]=allies(s),foe=enemies(s)[0];
 tank.x=12;tank.y=6;tank.hp=1;tank.attackTimer=100;shield(tank,1);healer.x=10;healer.y=6;healer.attackTimer=100;foe.x=13;foe.y=6;foe.atk=10000;foe.attackTimer=0;
 advance(s,.1);assert.equal(tank.alive,false);assert.equal(tank.hp,0);assert.equal(healer.healingDone,0);
});
test('pure shield absorption never accrues DAMAGE_TAKEN credit',()=>{
 const s=createBattle(input(['U_SK_1'],['R_A09'])),u=allies(s)[0],v=enemies(s)[0];u.x=12;u.y=6;u.attackTimer=100;shield(u,80);v.x=13;v.y=6;v.atk=5;v.attackTimer=0;advance(s,.1);assert.equal(u.hp,u.maxHp);assert.equal(u.counters.relicDamage||0,0);
});
test('shield expiry does not invoke shield-break skills',()=>{
 const s=createBattle(input(['U_SK_1'],['R_A07'])),u=allies(s)[0];u.attackTimer=100;u.hp=u.maxHp/2;shield(u,20,.1);for(const v of enemies(s)){v.atk=0;v.move=0}advance(s,.2);assert.equal(u.shield,0);assert.equal(s.stats.comboCounts['U_SK_1:V']||0,0);assert.equal(u.healingDone,0);
});
test('separate copies of a profession may both react within one causal chain',()=>{
 const s=createBattle(input(['U_SK_1','U_SK_3A','U_SK_3A'])),[tank,a,b]=allies(s),foe=enemies(s)[0];
 for(const u of allies(s)){u.x=12;u.y=6;u.attackTimer=100}tank.hp=100;shield(tank,1);foe.x=13;foe.y=6;foe.atk=10;foe.attackTimer=0;advance(s,.1);
 assert.equal(a.counters['proc:V'],1);assert.equal(b.counters['proc:V'],1);assert.equal(s.stats.comboCounts['U_SK_3A:V'],2);
});
test('corpse consumption is atomic across competing listeners',()=>{
 const s=createBattle(input(['U_CF_1','U_CF_1','U_HD_1'],['R_A03'])),[a,b,killer]=allies(s),foe=enemies(s)[0];
 for(const u of allies(s)){u.x=12;u.y=6;u.hp=u.maxHp/2;u.attackTimer=100}killer.attackTimer=0;killer.atk=10000;foe.x=12.7;foe.y=6;foe.hp=1;advance(s,.1);
 assert.equal(s.corpses.filter(c=>c.id==='c'+foe.id&&c.consumed).length,1);assert.equal(s.stats.comboCounts['corpse:consume'],1);assert.ok((a.healingDone>0)!==(b.healingDone>0));
});
test('SHOCK conducts once and cannot recursively trigger fresh charges',()=>{
 const s=createBattle(input(['U_HD_2B'],['R_A17'])),u=allies(s)[0],[a,b]=enemies(s);u.x=12;u.y=6;u.atk=1;u.critRate=0;u.counters.hits=0;
 for(const v of [a,b]){v.x=13;v.y=6;v.statuses=[{id:'WET',stacks:1,remaining:10,sourceId:u.id},{id:'SHOCK',stacks:1,remaining:10,sourceId:u.id}];v.atk=0;v.move=0;v.attackTimer=100}
 advance(s,.05);assert.equal(s.stats.comboCounts['shock:consume'],1);assert.ok(a.statuses.some(t=>t.id==='SHOCK'),'relic new charge waits for later hit');assert.ok(b.statuses.some(t=>t.id==='SHOCK'),'reaction does not consume secondary charge');assert.equal(s.stats.crits,0);
});
test('live item commands apply once and same-source preparation buffs reach each unit',()=>{
 const i=input(['U_SK_1','U_SK_1']);i.buffs=[{type:'openingShield',value:15,uid:'u0',source:'R_M13'},{type:'openingShield',value:15,uid:'u1',source:'R_M13'}];const s=createBattle(i),[a,b]=allies(s);assert.equal(a.shield,15);assert.equal(b.shield,15);
 a.hp-=30;for(const u of s.units){u.atk=0;u.move=0;u.attackTimer=100}const old=a.hp;s.input.buffs.push({type:'itemHeal',value:10,uid:a.sourceUid,source:'I11:1'});advance(s,.1);assert.equal(a.hp,old+10);advance(s,.1);assert.equal(a.hp,old+10);
});
test('assassin periodically selects and reaches ranged backline',()=>{
 const s=createBattle({...input(['U_HD_3B']),enemies:[{templateId:'E02',count:1},{templateId:'E03',count:1}]});advance(s,2.05);const u=allies(s)[0],archer=s.units.find(v=>v.templateId==='E03')!;assert.equal(u.targetId,archer.id);assert.ok(Math.hypot(u.x-archer.x,u.y-archer.y)<2);assert.equal(s.stats.comboCounts['U_HD_3B:blink'],1);assert.ok(u.statuses.some(t=>t.id==='ASSASSIN_CRIT'));
});
test('phylactery losses are bounded and barriers absorb actual breach',()=>{
 const i=input(['U_HD_1']);i.enemies=[{templateId:'E15',count:4}];i.buffs=[{type:'phylacteryBarrier',value:6,source:'barrier'}];i.timeLimit=.1;const s=simulateBattle(i);assert.equal(s.result,'loss');assert.equal(s.phylacteryLoss,14);assert.equal(s.phylacteryHp,66);
});
test('all 36 baseline passives execute under their actual triggering conditions',()=>{
 for(const d of UNITS){const s=passiveArena(d.id);advance(s,35);assert.ok((s.stats.comboCounts[d.id+':V']||0)>0,d.id+' passive not observed')}
});
test('all 72 specializations cause a measurable behavioral change',()=>{
 for(const d of UNITS){const base=arena(d.id),basePassive=passiveArena(d.id);advance(base,14);advance(basePassive,35);const baseline=JSON.stringify([signature(base),signature(basePassive)]);
  for(const choice of ['A','B'] as const){const s=arena(d.id,choice),p=passiveArena(d.id,choice);advance(s,14);advance(p,35);assert.notEqual(JSON.stringify([signature(s),signature(p)]),baseline,d.id+' '+choice+' has no behavioral effect')}
 }
});
test('all fifteen enemy professions execute their configured combat behavior',()=>{
 for(let n=1;n<=15;n++){
  const id='E'+String(n).padStart(2,'0'),s=createBattle({...input(['U_HD_1','U_HD_1','U_HD_1']),enemies:[{templateId:id,count:1},{templateId:'E01',count:1}],timeLimit:26});
  const a=allies(s),[u,patient]=enemies(s);for(const [j,v] of a.entries()){v.x=12;v.y=6+j*.3;v.hp=v.maxHp=10000;v.atk=.01;v.armor=0;v.blockRate=0;v.attackTimer=100;shield(v,300)}
  u.x=13;u.y=6;u.move=0;u.hp=u.maxHp=10000;patient.x=14;patient.y=6;patient.hp=1;patient.maxHp=2000;patient.atk=0;patient.move=0;patient.attackTimer=100;
  if(id==='E05'||id==='E15')u.hp=u.maxHp*.3;
  if(id==='E11'){a[0].atk=200;a[0].attackTimer=0;a[0].critRate=0}
  const opening=u.shield;advance(s,25);
  if(id==='E01')assert.ok(u.counters.attacks>0);
  else if(id==='E02')assert.equal(opening,30);
  else if(id==='E11')assert.equal(u.counters.guardEnrage,1);
  else assert.ok((s.stats.comboCounts[id+':skill']||0)>0,id+' skill not observed');
  if(id==='E05'||id==='E15')assert.equal(s.units.filter(v=>v.ownerId===u.id&&v.temporary).length,2,id+' should summon twice');
 }
});
test('crossbow aims for half a second and cancels a dead target without redirecting',()=>{
 const s=createBattle({...input(['U_HD_1','U_HD_1']),enemies:[{templateId:'E07',count:1}]});const [a,b]=allies(s),v=enemies(s)[0];
 for(const u of [a,b]){u.x=12;u.y=6;u.attackTimer=100;u.blockRate=0;u.armor=0;u.hp=u.maxHp=1000}v.x=15;v.y=6;v.attackTimer=0;const hp=a.hp;advance(s,.3);assert.equal(a.hp,hp);assert.ok(s.effects.some(e=>e.kind==='cast'&&e.label==='弩手瞄准'));a.alive=false;a.hp=0;a.action='dead';advance(s,.3);assert.equal(b.hp,1000);
});
test('poison sources aggregate into one tick, preserving source listeners',()=>{
 const s=createBattle(input(['U_ZM_2A','U_ZM_2A'],['R_A05'])),[a,b]=allies(s),v=enemies(s)[0];for(const u of s.units){u.move=0;u.atk=0;u.attackTimer=100}
 a.x=12;b.x=12;v.x=13;v.y=6;a.y=b.y=6;v.statuses=[{id:'POISON',stacks:2,remaining:3,sourceId:a.id,tag:'fixture'},{id:'POISON',stacks:3,remaining:3,sourceId:b.id,tag:'fixture'}];for(const [j,u] of enemies(s).entries())if(j){u.x=14;u.y=6+j*.2}
 advance(s,1.05);assert.equal(v.counters.relicPoisonTicks,1);assert.ok((a.counters['proc:V']||0)>0);assert.ok((b.counters['proc:V']||0)>0);
});
test('true damage bypasses both physical armor and block',()=>{
 const s=createBattle({...input(['U_SK_3B']),enemies:[{templateId:'E01',count:1}]}),a=allies(s)[0],v=enemies(s)[0];a.x=12;a.y=6;a.atk=10;a.critRate=0;a.counters.hits=3;v.x=13;v.y=6;v.hp=v.maxHp=1000;v.armor=1e20;v.blockRate=1;v.blockReduction=1;v.attackTimer=100;v.statuses=[{id:'EXPOSED',stacks:1,remaining:5,sourceId:a.id}];advance(s,.05);assert.equal(v.hp,996);
});
test('corpse-burst brand never jumps to an enemy outside the hit list',()=>{
 const s=createBattle({...input(['U_CF_3B']),enemies:[{templateId:'E01',count:5}]}),a=allies(s)[0];a.x=12;a.y=6;a.atk=100;a.critRate=0;a.counters.hits=2;enemies(s).forEach((v,j)=>{v.x=13+j*.2;v.y=6;v.hp=v.maxHp=j===4?1000:1;v.attackTimer=100});
 s.corpses.push({id:'fixture',x:12,y:6,side:'enemy',createdAt:0,templateId:'E01',consumed:false});advance(s,.05);assert.ok(enemies(s)[4].alive);assert.equal(enemies(s)[4].statuses.some(t=>t.id==='SOUL_BRAND'),false);
});
test('new bone armor is clamped to sixty percent maximum HP',()=>{
 const i=input(['U_SK_1']);i.buffs=[{type:'openingShield',uid:'u0',value:10000,source:'s1'},{type:'openingShield',uid:'u0',value:10000,source:'s2'}];const s=createBattle(i),u=allies(s)[0];assert.equal(u.shield,u.maxHp*.6);assert.equal(s.stats.shield,u.maxHp*.6);
});
test('native regeneration uses maximum-HP fraction and full health is silent',()=>{
 const s=createBattle(input(['U_ZM_1'])),u=allies(s)[0];for(const v of s.units){v.move=0;v.atk=0;v.attackTimer=100}advance(s,1);assert.equal(s.stats.healing,0);u.hp-=20;const old=u.hp;advance(s,1);assert.ok(Math.abs(u.hp-old-u.maxHp*u.regen)<1e-8);assert.ok(s.stats.comboCounts['U_ZM_1:V']>0);
});
test('wet and burn interact in event order without stacking burn damage',()=>{
 for(const id of ['U_HD_2B','U_CF_2B']){
  const s=createBattle({...input([id]),enemies:[{templateId:'E01',count:1}]}),a=allies(s)[0],v=enemies(s)[0];a.x=12;a.y=6;a.critRate=0;a.counters.hits=2;v.x=13;v.y=6;v.hp=v.maxHp=10000;v.attackTimer=100;
  v.statuses=[{id:id==='U_HD_2B'?'BURN':'WET',stacks:1,remaining:5,sourceId:a.id,power:2}];advance(s,.05);
  assert.equal(v.statuses.some(t=>t.id==='BURN'),false);assert.equal(v.statuses.some(t=>t.id==='WET'),id==='U_HD_2B');
 }
});
test('wet plus chill freezes, then freeze resistance caps follow-up chill',()=>{
 const i=input(['U_BL_2B']);i.team[0].specialization='A';i.enemies=[{templateId:'E01',count:1}];const s=createBattle(i),a=allies(s)[0],v=enemies(s)[0];a.x=12;a.y=6;a.critRate=0;a.counters.hits=2;a.atk=1;v.x=13;v.y=6;v.hp=v.maxHp=10000;v.attackTimer=100;v.move=0;v.statuses=[{id:'WET',stacks:1,remaining:5,sourceId:a.id}];advance(s,.05);assert.ok(v.statuses.some(t=>t.id==='FROZEN'));assert.equal(v.statuses.some(t=>t.id==='WET'||t.id==='CHILL'),false);
 a.attackTimer=100;advance(s,1.55);assert.equal(v.statuses.some(t=>t.id==='FROZEN'),false);assert.ok(v.cooldowns.freezeImmunity>0);a.counters.hits=2;a.cooldowns.P=0;a.attackTimer=0;advance(s,.05);assert.equal(v.statuses.some(t=>t.id==='FROZEN'),false);assert.equal(v.statuses.filter(t=>t.id==='CHILL').reduce((n,t)=>n+t.stacks,0),2);
});
test('wet shock conducts even when the charged target dies from the triggering hit',()=>{
 const s=createBattle({...input(['U_HD_1']),enemies:[{templateId:'E01',count:2}]}),u=allies(s)[0],[a,b]=enemies(s);u.x=12;u.y=6;u.atk=50;u.critRate=0;u.counters.hits=0;a.x=12.7;b.x=13.5;a.y=b.y=6;a.hp=1;b.hp=b.maxHp=1000;a.attackTimer=b.attackTimer=100;a.statuses=[{id:'WET',stacks:1,remaining:10,sourceId:u.id},{id:'SHOCK',stacks:1,remaining:10,sourceId:u.id}];advance(s,.05);assert.equal(a.alive,false);assert.equal(b.hp,996);assert.equal(s.stats.comboCounts['shock:consume'],1);
});
test('assassin critical kill retains the hit-time brand for its heal',()=>{
 const s=createBattle({...input(['U_HD_3B']),enemies:[{templateId:'E01',count:2}]}),a=allies(s)[0],v=enemies(s)[0];a.x=12;a.y=6;a.hp=a.maxHp/2;a.critRate=1;a.counters.hits=0;v.x=13;v.y=6;v.hp=1;v.attackTimer=100;v.statuses=[{id:'SOUL_BRAND',stacks:1,remaining:10,sourceId:a.id}];advance(s,.05);assert.equal(v.alive,false);assert.ok(a.healingDone>0);assert.equal(a.counters['proc:V'],1);
});
test('attack speed, crit, block, reduction and lifesteal stop at authored caps',()=>{
 const run=(above:boolean)=>{const s=createBattle({...input(['U_HD_1']),enemies:[{templateId:'E01',count:1}]}),a=allies(s)[0],v=enemies(s)[0];a.x=12;a.y=6;a.hp=500;a.maxHp=1000;a.atk=10;a.armor=0;a.aps=above?20:4;a.critRate=above?1:.8;a.lifesteal=above?1:.3;v.x=12.7;v.y=6;v.hp=v.maxHp=10000;v.atk=10;v.armor=0;v.blockRate=above?1:.65;v.blockReduction=above?1:.7;advance(s,8);return signature(s)};
 assert.deepEqual(run(true),run(false));
});
test('breach costs use ordinary two, elite four and boss ten before the wave cap',()=>{
 for(const [kind,id,loss] of [['normal','E01',2],['elite','E01',4],['boss','E15',10]] as const){const s=simulateBattle({...input(['U_SK_1']),enemies:[{templateId:id,count:1}],nodeKind:kind,timeLimit:.1});assert.equal(s.phylacteryLoss,loss)}
});
test('freezing a boss pauses an unfinished heavy wind-up until it can resume',()=>{
 const s=createBattle({...input(['U_HD_1']),enemies:[{templateId:'E05',count:1}]}),a=allies(s)[0],v=enemies(s)[0];a.x=12;a.y=6;a.hp=a.maxHp=10000;a.attackTimer=100;a.armor=0;a.blockRate=0;v.x=13;v.y=6;v.cooldowns.enemySkill=0;v.attackTimer=100;
 advance(s,.05);assert.ok(v.cast);v.statuses.push({id:'FROZEN',stacks:1,remaining:2,sourceId:a.id});const hp=a.hp;advance(s,2.2);assert.equal(a.hp,hp,'the unspent wind-up must remain after thaw');assert.equal(s.stats.comboCounts['E05:skill']||0,0);advance(s,1);assert.ok(a.hp<hp);assert.equal(s.stats.comboCounts['E05:skill'],1);
});
test('freezing an archer pauses aiming, while its target remains selected',()=>{
 const s=createBattle({...input(['U_HD_1']),enemies:[{templateId:'E07',count:1}]}),a=allies(s)[0],v=enemies(s)[0];a.x=12;a.y=6;a.hp=a.maxHp=1000;a.attackTimer=100;a.armor=0;a.blockRate=0;v.x=15;v.y=6;v.attackTimer=0;
 advance(s,.05);v.statuses.push({id:'FROZEN',stacks:1,remaining:2,sourceId:a.id});const hp=a.hp;advance(s,2.2);assert.equal(a.hp,hp);advance(s,.4);assert.ok(a.hp<hp);assert.equal(v.targetId,a.id);
});
test('inquisitor targets an in-range summon but a formal taunt takes priority',()=>{
 const s=createBattle({...input(['U_SK_1','U_HD_1']),enemies:[{templateId:'E12',count:1}]}),[tank,summon]=allies(s),v=enemies(s)[0];
 for(const u of [tank,summon]){u.y=6;u.atk=0;u.move=0;u.attackTimer=100;u.hp=u.maxHp=10000}tank.x=12;summon.x=11;summon.temporary=true;summon.ttl=10;summon.ownerId=tank.id;v.x=15;v.y=6;v.attackTimer=0;advance(s,.05);assert.equal(v.targetId,summon.id);
 v.attackTimer=0;v.statuses.push({id:'TAUNTED',stacks:1,remaining:2,sourceId:tank.id});advance(s,.05);assert.equal(v.targetId,tank.id);
});
test('crossbow third aim targets a ranged permanent soldier only inside its range',()=>{
 for(const reachable of [true,false]){
  const s=createBattle({...input(['U_SK_1','U_BL_1']),enemies:[{templateId:'E07',count:1}]}),[tank,bell]=allies(s),v=enemies(s)[0];for(const u of [tank,bell]){u.y=6;u.atk=0;u.move=0;u.attackTimer=100}tank.x=12;bell.x=reachable?9:1;v.x=15;v.y=6;v.attackTimer=0;v.counters.attacks=2;advance(s,.05);assert.equal(v.targetId,reachable?bell.id:tank.id);assert.equal(v.action,'cast');assert.ok(s.effects.some(e=>e.kind==='cast'&&e.label==='弩手瞄准'));
 }
});
test('fire oil warns at the densest in-range cluster and still caps damage targets',()=>{
 const s=createBattle({...input(['U_SK_1','U_HD_1','U_BL_1','U_ZM_1']),enemies:[{templateId:'E09',count:1}]}),a=allies(s),v=enemies(s)[0];a.forEach((u,j)=>{u.x=j===0?14:12+(j-2)*.2;u.y=6;u.atk=0;u.move=0;u.attackTimer=100;u.hp=u.maxHp=10000;u.blockRate=0;u.regen=0});v.x=16;v.y=6;v.attackTimer=100;v.cooldowns.enemySkill=0;advance(s,.05);assert.ok((v.cast as {x:number}).x<13);assert.equal(a[0].hp,10000);advance(s,.9);assert.equal(a.filter(u=>u.hp<10000).length,0);advance(s,.2);assert.equal(a.filter(u=>u.hp<10000).length,3);assert.equal(a[0].hp,10000);
});
