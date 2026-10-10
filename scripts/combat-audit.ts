import {writeFileSync,readFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {UNITS} from '../src/content';
import type {CombatInput} from '../src/domain/types';
import {arena,passiveArena,advance,signature} from '../tests/combat-fixtures';
const metrics=(s:ReturnType<typeof arena>,id:string)=>({primary:s.stats.comboCounts[id+':P']||0,passive:s.stats.comboCounts[id+':V']||0,damage:+s.stats.damage.toFixed(2),healing:+s.stats.healing.toFixed(2),shield:+s.stats.shield.toFixed(2),summons:s.stats.summons,poisonDamage:+s.stats.poisonDamage.toFixed(2),corpseConsumptions:s.stats.comboCounts['corpse:consume']||0,events:s.eventCount});
const units=UNITS.map(d=>{
 const cases=([null,'A','B'] as const).map(choice=>{const p=arena(d.id,choice),v=passiveArena(d.id,choice);advance(p,14);advance(v,35);return {choice,primaryFixture:metrics(p,d.id),passiveFixture:metrics(v,d.id),behaviorSha256:createHash('sha256').update(JSON.stringify([signature(p),signature(v)])).digest('hex')}});
 return {id:d.id,name:d.name,primaryObserved:cases.every(x=>x.primaryFixture.primary>0),baselinePassiveObserved:cases[0].passiveFixture.passive>0,choiceAChangesBehavior:cases[0].behaviorSha256!==cases[1].behaviorSha256,choiceBChangesBehavior:cases[0].behaviorSha256!==cases[2].behaviorSha256,cases};
});
const result={generatedAt:new Date().toISOString(),sourceSha256:createHash('sha256').update(readFileSync('src/domain/combat.ts')).digest('hex'),scope:'Synthetic controlled combat fixtures verify executable mechanics, not campaign balance or human play quality.',scenarioDescription:'Primary fixture supplies nearby opponents, injured allies, a consumable corpse and existing status contributions; passive fixture creates the relevant hit, heal, shield-break, dash, summon death, native death or corpse event through real simulation ticks. No direct call to a skill handler is used.',totals:{professions:units.length,workingPrimaries:units.filter(u=>u.primaryObserved).length,workingBaselinePassives:units.filter(u=>u.baselinePassiveObserved).length,choicesWithMeasurableChange:units.reduce((n,u)=>n+Number(u.choiceAChangesBehavior)+Number(u.choiceBChangesBehavior),0)},units};
mkdirSync('artifacts/combat',{recursive:true});writeFileSync('artifacts/combat/profession-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.totals));
if(result.totals.workingPrimaries!==36||result.totals.workingBaselinePassives!==36||result.totals.choicesWithMeasurableChange!==72)process.exitCode=1;

// Optional bounded, paired combat study. These deliberately fixed rosters isolate
// battle mechanics from recruitment probabilities; they are not legal run claims.
if(process.argv.includes('--balance-review')){
 const {simulateBattle,createBattle,stepBattle}=await import('../src/domain/combat');
 const {makeUnit,ENCOUNTERS}=await import('../src/content');
 const stages=[{id:'r2-mid-normal',encounter:'EN15',rank:2,xp:30},{id:'r3-late-elite',encounter:'EN33',rank:3,xp:50},{id:'r4-late-normal',encounter:'EN27',rank:4,xp:110},{id:'r4-final-boss',encounter:'EN36',rank:4,xp:110}];
 const plans=[{id:'coffin',core:{2:'U_CF_2A',3:'U_CF_3B',4:'U_CF_4'}},{id:'plague',core:{2:'U_ZM_2A',3:'U_ZM_3A',4:'U_ZM_4'}},{id:'cavalry',core:{2:'U_HR_2A',3:'U_HR_3A',4:'U_HR_4'}}];
 const records:unknown[]=[];const mean=(a:number[])=>+(a.reduce((s,v)=>s+v,0)/Math.max(1,a.length)).toFixed(4);
 for(const stage of stages)for(const plan of plans)for(const variant of plan.id==='plague'?['full','withoutRegeneration','withoutSkills']:['full']){
  const rows=[];
  for(let seed=0;seed<12;seed++){
   const core=plan.core[stage.rank as 2|3|4],team=[core,core,core,core,'U_SK_2A','U_BL_2A'].map((id,j)=>({...makeUnit(id,'u'+j,stage.xp,j),specialization:(j<4?'B':'A') as 'A'|'B'}));
   const encounter=ENCOUNTERS.find(e=>e.id===stage.encounter)!;
   const input={seed:71000+seed,team,enemies:encounter.enemy_composition.split(',').map(s=>{const [templateId,count]=s.split(':');return{templateId,count:Number(count)}}),relics:[],buffs:[],act:encounter.act,wave:encounter.wave,nodeKind:(stage.id.includes('boss')?'boss':stage.id.includes('elite')?'elite':'normal') as 'normal'|'elite'|'boss',phylacteryHp:60,timeLimit:75};
   const s=createBattle(input);
   for(const u of s.units.filter(u=>u.side==='ally'&&u.templateId===core)){if(variant==='withoutRegeneration')u.regen=0;if(variant==='withoutSkills'){u.cooldowns.P=999;u.cooldowns.V=999}}
   while(!s.result)stepBattle(s,.25);
   const formal=s.units.filter(u=>u.side==='ally'&&!u.temporary),alive=formal.filter(u=>u.alive).length;
   rows.push({seed:input.seed,result:s.result,seconds:s.time,alive,healthFraction:formal.reduce((n,u)=>n+u.hp,0)/formal.reduce((n,u)=>n+u.maxHp,0),damage:s.stats.damage,healing:s.stats.healing,shield:s.stats.shield,poison:s.stats.poisonDamage,summons:s.stats.summons});
  }
  records.push({stage:stage.id,plan:plan.id,variant,roster:[...Array(4).fill(plan.core[stage.rank as 2|3|4]),'U_SK_2A','U_BL_2A'],levelXp:stage.xp,encounter:stage.encounter,summary:{wins:rows.filter(r=>r.result==='win').length,n:rows.length,seconds:mean(rows.map(r=>r.seconds)),alive:mean(rows.map(r=>r.alive)),healthFraction:mean(rows.map(r=>r.healthFraction)),healing:mean(rows.map(r=>r.healing)),shield:mean(rows.map(r=>r.shield)),poisonShare:mean(rows.map(r=>r.poison/Math.max(1,r.damage)))},rows});
 }
 const report={generatedAt:new Date().toISOString(),sourceSha256:result.sourceSha256,description:'240 paired deterministic combat fixtures: three equal-size birth-rank-matched rosters; plague additionally tested without native regeneration or without core primary/passive skills. All start in the same formation with the same two support templates, XP, no relics, enemy composition and twelve seeds. This is causal fixture evidence, not a campaign balance estimate.',records};
 writeFileSync('artifacts/combat/balance-review-controlled.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(records.map(r=>{const v=r as {stage:string;plan:string;variant:string;summary:unknown};return{stage:v.stage,plan:v.plan,variant:v.variant,...v.summary as object}}),null,2));
}
if(process.argv.includes('--freeze-review')){
 const live=await import('../src/domain/combat'),{makeUnit}=await import('../src/content');
 const afterSource=readFileSync('artifacts/combat/before-counters-engine.txt','utf8');
 const baselinePath='artifacts/combat/before-freeze-engine.txt',baselineSource=readFileSync(baselinePath,'utf8'),temp=mkdtempSync(join(tmpdir(),'necromancer-freeze-audit-'));
 const baselineModule=baselineSource.replace("'../content/index'",JSON.stringify(resolve('src/content/index'))).replace("'./types'",JSON.stringify(resolve('src/domain/types')));
 writeFileSync(join(temp,'before.ts'),baselineModule);
 writeFileSync(join(temp,'after.ts'),afterSource.replace("'../content/index'",JSON.stringify(resolve('src/content/index'))).replace("'./types'",JSON.stringify(resolve('src/domain/types'))));
 try{
  const before=await import(pathToFileURL(join(temp,'before.ts')).href) as {simulateBattle:typeof live.simulateBattle};
  const after=await import(pathToFileURL(join(temp,'after.ts')).href) as {simulateBattle:typeof live.simulateBattle},simulateBattle=after.simulateBattle;
  const cases=[{id:'archer-line',enemies:[{templateId:'E07',count:3},{templateId:'E06',count:2},{templateId:'E08',count:1}]},{id:'king-alone',enemies:[{templateId:'E15',count:1}]},{id:'king-and-support',enemies:[{templateId:'E15',count:1},{templateId:'E12',count:1},{templateId:'E13',count:1}]}];
   const summarize=(s:ReturnType<typeof simulateBattle>)=>({result:s.result,seconds:s.time,alive:s.units.filter(u=>u.side==='ally'&&u.alive&&!u.temporary).length,enemyDamage:s.units.filter(u=>u.side==='enemy').reduce((n,u)=>n+u.damageDone,0),freezeEvents:s.stats.comboCounts['chill:freeze']||0,heavyReleases:s.stats.comboCounts['E15:skill']||0});
  const rows:{scenario:string;seed:number;before:ReturnType<typeof summarize>;after:ReturnType<typeof summarize>}[]=[];
  for(const scenario of cases)for(let seed=0;seed<12;seed++){
   const team=['U_SK_3A','U_SK_3A','U_HD_2B','U_BL_2B','U_BL_3B','U_BL_3A'].map((id,j)=>({...makeUnit(id,'u'+j,110,j),specialization:'A' as const}));
   const input={seed:84000+seed,team,enemies:scenario.enemies,relics:[],buffs:[],act:3,wave:3,nodeKind:'boss' as const,phylacteryHp:60,timeLimit:75};
   rows.push({scenario:scenario.id,seed:input.seed,before:summarize(before.simulateBattle(input)),after:summarize(simulateBattle(input))});
  }
  const mean=(a:number[])=>+(a.reduce((s,v)=>s+v,0)/Math.max(1,a.length)).toFixed(3);
  const summary=cases.map(c=>{const r=rows.filter(r=>r.scenario===c.id);return{scenario:c.id,beforeWins:r.filter(r=>r.before.result==='win').length,afterWins:r.filter(r=>r.after.result==='win').length,beforeSeconds:mean(r.map(r=>r.before.seconds)),afterSeconds:mean(r.map(r=>r.after.seconds)),beforeEnemyDamage:mean(r.map(r=>r.before.enemyDamage)),afterEnemyDamage:mean(r.map(r=>r.after.enemyDamage)),beforeHeavyReleases:mean(r.map(r=>r.before.heavyReleases)),afterHeavyReleases:mean(r.map(r=>r.after.heavyReleases))}});
  const report={generatedAt:new Date().toISOString(),beforeSha256:createHash('sha256').update(baselineSource).digest('hex'),afterSha256:createHash('sha256').update(afterSource).digest('hex'),description:'36 paired cases, 12 fixed seeds per encounter. Fixed six-unit cold/wet composition, identical level, specialization, placement and enemy lineup. The only engine difference is pausing unfinished preparations under FROZEN.',summary,rows};
  writeFileSync('artifacts/combat/freeze-review.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
 }finally{rmSync(temp,{recursive:true,force:true})}
}
if(process.argv.includes('--enemy-counter-review')){
 const current=await import('../src/domain/combat'),{makeUnit}=await import('../src/content');
 type Sim=typeof current;
 type Roster={id:string;xp:number;spec:'A'|'B'|null;slot:number|null};
 const rosterSnapshot=JSON.parse(readFileSync('artifacts/combat/counter-rosters.json','utf8')) as {candidate:string;strategy:string;rosterSeed:string;seed:number;team:Roster[]}[];
 const source=readFileSync('artifacts/combat/before-counters-engine.txt','utf8'),targetLine="const t=forced||(u.templateId==='U_HD_3B'&&previous?previous:nearest);";
 const patches=[
  {id:'E12-summon-priority',act:3,enemies:[{templateId:'E11',count:3},{templateId:'E12',count:2},{templateId:'E13',count:1}],needle:targetLine,replacement:"const summonTarget=u.templateId==='E12'?this.enemies(u,u.range+.25).find(v=>v.temporary):undefined;const t=forced||summonTarget||(u.templateId==='U_HD_3B'&&previous?previous:nearest);"},
  {id:'E07-third-shot-backline',act:2,enemies:[{templateId:'E06',count:2},{templateId:'E07',count:3},{templateId:'E08',count:1}],needle:targetLine,replacement:"const backlineTarget=u.templateId==='E07'&&((u.counters.attacks||0)+1)%3===0?this.enemies(u,u.range+.25).find(v=>!v.temporary&&v.range>=4):undefined;const t=forced||backlineTarget||(u.templateId==='U_HD_3B'&&previous?previous:nearest);"},
  {id:'E09-dense-fire',act:2,enemies:[{templateId:'E06',count:2},{templateId:'E07',count:2},{templateId:'E09',count:1},{templateId:'E08',count:1}],needle:"const t=this.enemies(u)[0],id=u.templateId;if(!t)return;",replacement:"const id=u.templateId;const t=id==='E09'?this.enemies(u,6.5).sort((a,b)=>this.enemies(u,1.3,b).length-this.enemies(u,1.3,a).length||dist(u,a)-dist(u,b)||a.id.localeCompare(b.id))[0]:this.enemies(u)[0];if(!t)return;"}
 ];
 const tmp=mkdtempSync(join(tmpdir(),'necromancer-counters-'));
 const fight=(engine:Sim,input:CombatInput)=>{
  const s=engine.createBattle(input);let lastEffect=0,firstKo:number|null=null;
  const eventCounts={antiSummonHits:0,antiSummonPermanentHits:0,backlineArrows:0,frontlineArrows:0,fireInitialHits:0,fireCasts:0};let lastFireCasts=0;
  while(!s.result){engine.stepBattle(s,.05);for(const effect of s.effects.filter(e=>e.id>lastEffect)){
   const from=s.units.find(u=>u.id===effect.sourceId),to=s.units.find(u=>u.id===effect.targetId);if(!from||!to||from.side!=='enemy'||to.side!=='ally')continue;
   if(from.templateId==='E12'&&effect.kind==='hit'){if(to.temporary)eventCounts.antiSummonHits++;else eventCounts.antiSummonPermanentHits++}
   if(from.templateId==='E07'&&effect.kind==='projectile'){if(!to.temporary&&to.range>=4)eventCounts.backlineArrows++;else eventCounts.frontlineArrows++}
   if(from.templateId==='E09'&&effect.kind==='burn'&&(effect.amount||0)>2.01)eventCounts.fireInitialHits++;
  }lastEffect=s.nextEffectId-1;
   const casts=s.stats.comboCounts['E09:skill']||0;if(casts>lastFireCasts){eventCounts.fireCasts+=casts-lastFireCasts;lastFireCasts=casts}
   if(firstKo===null&&s.units.some(u=>u.side==='ally'&&!u.temporary&&!u.alive))firstKo=s.time;
  }
  const formal=s.units.filter(u=>u.side==='ally'&&!u.temporary);
  return{result:s.result,seconds:s.time,alive:formal.filter(u=>u.alive).length,healthFraction:formal.reduce((n,u)=>n+u.hp,0)/formal.reduce((n,u)=>n+u.maxHp,0),enemyDamage:s.units.filter(u=>u.side==='enemy').reduce((n,u)=>n+u.damageDone,0),firstKo,...eventCounts};
 };
 const rows:{candidate:string;strategy:string;rosterSeed:string;seed:number;team:Roster[];before:ReturnType<typeof fight>;after:ReturnType<typeof fight>}[]=[];
 try{
  const baselinePath=join(tmp,'baseline.ts');writeFileSync(baselinePath,source.replace("'../content/index'",JSON.stringify(resolve('src/content/index'))).replace("'./types'",JSON.stringify(resolve('src/domain/types'))));
  const baseline=await import(pathToFileURL(baselinePath).href) as Sim;
  for(const patch of patches){
   if(!source.includes(patch.needle))throw new Error('Counter patch anchor missing: '+patch.id);
   const code=source.replace(patch.needle,patch.replacement).replace("'../content/index'",JSON.stringify(resolve('src/content/index'))).replace("'./types'",JSON.stringify(resolve('src/domain/types'))),path=join(tmp,patch.id+'.ts');writeFileSync(path,code);
   const candidate=await import(pathToFileURL(path).href) as Sim;
   for(const strategy of ['balanced','plague','cavalry']){
    const rosters=rosterSnapshot.filter(r=>r.candidate===patch.id&&r.strategy===strategy);
    for(const row of rosters){
     const team=row.team.map((u,j)=>({...makeUnit(u.id,'u'+j,u.xp,u.slot),specialization:u.spec}));
     const input:CombatInput={seed:row.seed,team,enemies:patch.enemies,relics:[],buffs:[],act:patch.act,wave:3,nodeKind:'elite',phylacteryHp:60,timeLimit:75};
     rows.push({candidate:patch.id,strategy,rosterSeed:row.rosterSeed,seed:input.seed,team:row.team,before:fight(baseline,input),after:fight(candidate,input)});
    }
   }
  }
 }finally{rmSync(tmp,{recursive:true,force:true})}
 const mean=(a:number[])=>+(a.reduce((n,v)=>n+v,0)/Math.max(1,a.length)).toFixed(3);
 const summary=patches.flatMap(p=>['balanced','plague','cavalry'].map(strategy=>{const r=rows.filter(r=>r.candidate===p.id&&r.strategy===strategy);const side=(key:'before'|'after')=>{const a=r.map(x=>x[key]);return{wins:a.filter(v=>v.result==='win').length,n:a.length,seconds:mean(a.map(v=>v.seconds)),alive:mean(a.map(v=>v.alive)),healthFraction:mean(a.map(v=>v.healthFraction)),enemyDamage:mean(a.map(v=>v.enemyDamage)),antiSummonHits:mean(a.map(v=>v.antiSummonHits)),antiSummonPermanentHits:mean(a.map(v=>v.antiSummonPermanentHits)),backlineArrows:mean(a.map(v=>v.backlineArrows)),frontlineArrows:mean(a.map(v=>v.frontlineArrows)),fireInitialHits:mean(a.map(v=>v.fireInitialHits)),fireCasts:mean(a.map(v=>v.fireCasts)),earliestKo:Math.min(...a.map(v=>v.firstKo??Infinity))}};return{candidate:p.id,strategy,before:side('before'),after:side('after')}}));
 const report={generatedAt:new Date().toISOString(),sourceSha256:createHash('sha256').update(source).digest('hex'),description:'90 paired tests (180 battles), using first ten arrived campaign rosters per strategy at the chosen act/layer. All relics and consumables omitted in both arms. Each pair uses identical seed, roster, XP, formation and enemy lineup. Three candidate target selectors compiled in isolated temporary modules; no production combat change.',patches,summary,rows};
 writeFileSync('artifacts/combat/enemy-counter-review.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
}
