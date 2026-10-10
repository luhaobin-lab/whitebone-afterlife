/** Standalone presentation harness, loaded only by tests/render-demo.html. */
import { BattleRenderer } from './BattleRenderer';
import { createBattle, stepBattle } from '../domain/combat';
import { ENEMIES, UNITS, getUnit, makeUnit } from '../content';
import type { BattleState, EnemySpawn, UnitInstance } from '../domain/types';

const stage=document.querySelector<HTMLElement>('#stage')!;
const status=document.querySelector<HTMLElement>('#status')!;
const roster=document.querySelector<HTMLElement>('#roster')!;
let act=1,selectedUid='',paused=false,battle:BattleState|null=null,batch=0,manualClock=false;
let team:UnitInstance[]=[];
let enemies:EnemySpawn[]=[{templateId:'E01',count:3},{templateId:'E02',count:2},{templateId:'E03',count:2},{templateId:'E04',count:1},{templateId:'E05',count:1,boss:true}];
const inputEvents:unknown[]=[];
const renderer=new BattleRenderer(stage,{
  onUnitClick:id=>{selectedUid=id;inputEvents.push({type:'click',id});},
  onSlotClick:slot=>{inputEvents.push({type:'slot',slot});move(selectedUid,slot);},
  onUnitDrop:(uid,slot)=>{inputEvents.push({type:'drop',uid,slot});move(uid,slot);},
});
function move(uid:string,slot:number){
  const u=team.find(x=>x.uid===uid);if(!u||battle)return;const occupant=team.find(x=>x.slot===slot&&x.uid!==uid),old=u.slot;
  u.slot=slot;if(occupant)occupant.slot=old;selectedUid=uid;
}
function setTeam(ids:string[]){team=ids.map((id,i)=>makeUnit(id,`demo-${i}`,30,i));battle=null;paused=false;selectedUid=team[0]?.uid??'';roster.replaceChildren(...team.map(u=>{const span=document.createElement('span');span.textContent=getUnit(u.templateId).name;return span;}));}
setTeam(['U_SK_2A','U_ZM_2A','U_HR_2A','U_HD_3B','U_BL_3A','U_CF_2B','U_SK_4','U_BL_4']);
function start(stress=false){
  if(stress){setTeam(['U_CF_2A','U_HD_2A','U_CF_4','U_HD_4','U_BL_3A','U_ZM_4','U_SK_4','U_HR_4']);enemies=[{templateId:'E11',count:12,hpScale:3},{templateId:'E07',count:8,hpScale:3},{templateId:'E13',count:3,hpScale:3},{templateId:'E15',count:1,hpScale:3,boss:true}];}
  battle=createBattle({seed:48732,team,enemies,relics:['R_A02','R_A04','R_A07','R_A14','R_A15','R_A18'],buffs:[],act,wave:0,nodeKind:'normal',phylacteryHp:60,timeLimit:75});paused=false;
}
document.querySelector('#fight')!.addEventListener('click',()=>start());
document.querySelector('#stress')!.addEventListener('click',()=>start(true));
document.querySelector('#prep')!.addEventListener('click',()=>{battle=null;paused=false;});
document.querySelector('#pause')!.addEventListener('click',()=>{paused=!paused;});
document.querySelector('#next')!.addEventListener('click',()=>{batch=(batch+1)%5;setTeam(Array.from({length:8},(_,i)=>UNITS[(batch*8+i)%UNITS.length].id));});
document.querySelector('#all-enemies')!.addEventListener('click',()=>{battle=null;enemies=ENEMIES.map(e=>({templateId:e.id,count:1,boss:e.role.includes('首领')}));});
document.querySelector<HTMLSelectElement>('#act')!.addEventListener('change',e=>{act=Number((e.target as HTMLSelectElement).value);});
document.querySelector<HTMLSelectElement>('#height')!.addEventListener('change',e=>{stage.style.height=`${(e.target as HTMLSelectElement).value}px`;renderer.resize();});
let last=performance.now(),accumulator=0;
function tick(now:number){
  const elapsed=Math.min(.06,(now-last)/1000);last=now;
  if(battle&&!paused&&!battle.result&&!manualClock){accumulator+=elapsed;while(accumulator>=1/60){stepBattle(battle,1/60);accumulator-=1/60;}}
  renderer.setView({battle,team,enemies,act,phase:battle?'battle':'prep',capacity:8,selectedUid,paused});
  status.textContent=JSON.stringify({phase:battle?'battle':'prep',time:battle?Number(battle.time.toFixed(1)):0,result:battle?.result??null,selectedUid,stats:renderer.getDebugStats(),live: battle?.units.filter(u=>u.alive).length??null,summons:battle?.stats.summons??0,lastInput:inputEvents.at(-1)??null},null,2);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
const fixture={renderer,get team(){return team;},get battle(){return battle;},get events(){return inputEvents;},setTeam,start,setPaused(value:boolean){paused=value;},step(seconds:number){if(battle)for(let t=0;t<seconds;t+=1/60)stepBattle(battle,1/60);},setAct(value:number){act=value;},prepare(){battle=null;}};
(window as unknown as {__rendererFixture:typeof fixture}).__rendererFixture=fixture;
const testingWindow=window as unknown as {render_game_to_text:()=>string;advanceTime:(ms:number)=>Promise<void>};
testingWindow.render_game_to_text=()=>JSON.stringify({phase:battle?'battle':'prep',coordinateSystem:'40m x 12m; origin top-left; allies left, enemies right',time:battle?.time??0,result:battle?.result??null,selectedUid,team:team.map(u=>({uid:u.uid,id:u.templateId,slot:u.slot})),units:battle?.units.filter(u=>u.alive).map(u=>({id:u.id,x:u.x,y:u.y,hp:u.hp,shield:u.shield,action:u.action,temporary:u.temporary,statuses:u.statuses.map(s=>s.id)})),renderer:renderer.getDebugStats(),lastInput:inputEvents.at(-1)});
testingWindow.advanceTime=async(ms:number)=>{manualClock=true;if(battle&&!paused)for(let left=ms;left>0;left-=1000/60)stepBattle(battle,Math.min(left/1000,1/60));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));};
