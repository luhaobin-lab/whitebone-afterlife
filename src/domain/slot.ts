import { UNITS } from '../content';
import { Rng } from './random';
import type {FamilyId,SlotWin} from './types';
export interface FamilyWeight {family:FamilyId;weight:number}
export const PAYLINES:readonly (readonly number[])[]=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export const PAYLINE_NAMES=['上横线','中横线','下横线','左竖线','中竖线','右竖线','左斜线','右斜线'];
export const LINE_LEVEL:Record<number,number>={1:1,2:1,3:1,4:1,5:3,6:5,8:8};
export const RANK_NAMES=['','普通','精英','统领','领主'];
const FAMILIES:FamilyId[]=['SK','ZM','HR','HD','BL','CF'];
export function validateWeights(weights:FamilyWeight[]):boolean {
 return weights.length===4&&new Set(weights.map(x=>x.family)).size===4&&weights.every(x=>FAMILIES.includes(x.family)&&Number.isInteger(x.weight)&&x.weight>=2&&x.weight<=10)&&weights.reduce((s,x)=>s+x.weight,0)===20;
}
export function analyzeBoard(board:readonly FamilyId[]):SlotWin[] {
 if(board.length!==9||board.some(x=>!FAMILIES.includes(x)))throw new Error('盘面必须有九个合法符号');
 const wins=new Map<FamilyId,number[]>();
 PAYLINES.forEach((line,i)=>{const f=board[line[0]];if(line.every(n=>board[n]===f)){const arr=wins.get(f)||[];arr.push(i);wins.set(f,arr)}});
 return [...wins.entries()].map(([family,lines])=>{
  const lineCount=lines.length;if(lineCount===7)throw new Error('非法七线盘面');
  const rank=Math.min(4,lineCount),level=LINE_LEVEL[lineCount];
  return {family,lines,lineCount,rank,level,templateIds:UNITS.filter(u=>u.family===family&&u.rank===rank).map(u=>u.id)};
 });
}
export function rollBoard(weights:FamilyWeight[],rng:Rng):FamilyId[] {
 if(!validateWeights(weights))throw new Error('四族权重必须合计20且每族2至10');
 return Array.from({length:9},()=>rng.weighted(weights,x=>x.weight).family);
}
export type SlotIntervention =
 | {kind:'lockColumn'|'rerollCell'|'rotateRow'|'rerollRow'|'rotateColumn';index:number}
 | {kind:'swap'|'copy'|'swapRows'|'swapColumns';a:number;b:number}
 | {kind:'rotateCorners'};
export function interventionBoard(board:readonly FamilyId[],action:SlotIntervention,weights:FamilyWeight[],rng:Rng):FamilyId[] {
 analyzeBoard(board);if(!validateWeights(weights))throw new Error('非法权重');
 const result=[...board],symbol=()=>rng.weighted(weights,x=>x.weight).family;
 const check=(v:number,max:number)=>{if(!Number.isInteger(v)||v<0||v>max)throw new Error('非法格子或卷轴索引')};
 if(action.kind==='lockColumn'){check(action.index,2);for(let i=0;i<9;i++)if(i%3!==action.index)result[i]=symbol()}
 else if(action.kind==='rerollCell'){check(action.index,8);result[action.index]=symbol()}
 else if(action.kind==='swap'||action.kind==='copy'){
  check(action.a,8);check(action.b,8);if(action.a===action.b)throw new Error('请选择两个不同格子');
  if(action.kind==='swap')[result[action.a],result[action.b]]=[result[action.b],result[action.a]];else result[action.b]=result[action.a];
 } else if(action.kind==='swapColumns'){
  check(action.a,2);check(action.b,2);if(action.a===action.b)throw new Error('请选择不同列');
  for(let r=0;r<3;r++)[result[r*3+action.a],result[r*3+action.b]]=[result[r*3+action.b],result[r*3+action.a]];
 } else if(action.kind==='rotateColumn'){
  check(action.index,2);const c=action.index;[result[c],result[c+3],result[c+6]]=[board[c+6],board[c],board[c+3]];
 } else if(action.kind==='swapRows'){
  check(action.a,2);check(action.b,2);if(action.a===action.b)throw new Error('请选择不同横排');
  for(let c=0;c<3;c++)[result[action.a*3+c],result[action.b*3+c]]=[result[action.b*3+c],result[action.a*3+c]];
 } else if(action.kind==='rotateRow'){
  check(action.index,2);const row=action.index*3;[result[row],result[row+1],result[row+2]]=[board[row+2],board[row],board[row+1]];
 } else if(action.kind==='rerollRow'){
  check(action.index,2);for(let c=0;c<3;c++)result[action.index*3+c]=symbol();
 } else if(action.kind==='rotateCorners'){
  [result[0],result[2],result[8],result[6]]=[board[6],board[0],board[2],board[8]];
 }
 return result;
}
export function isAdjacent(a:number,b:number):boolean{return Math.abs(a%3-b%3)+Math.abs(Math.floor(a/3)-Math.floor(b/3))===1}
export function predictedRankDescription(win:SlotWin):string{return `${win.lineCount}线 → ${RANK_NAMES[win.rank]} R${win.rank}${win.level>1?' · 训练'+win.level+'级':''} · 1名`}
