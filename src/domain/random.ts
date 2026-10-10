export function hashSeed(input:string|number):number {
 const s=String(input);let h=2166136261;
 for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
 return h>>>0;
}
export class Rng {
 state:number;
 constructor(seed:number|string){this.state=typeof seed==='number'?seed>>>0:hashSeed(seed)}
 next():number{let t=this.state+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);this.state>>>=0;return ((t^t>>>14)>>>0)/4294967296}
 int(min:number,max:number):number{return min+Math.floor(this.next()*(max-min+1))}
 pick<T>(values:readonly T[]):T{if(!values.length)throw new Error('Empty random pool');return values[this.int(0,values.length-1)]}
 shuffle<T>(values:readonly T[]):T[]{const copy=[...values];for(let i=copy.length-1;i>0;i--){const j=this.int(0,i);[copy[i],copy[j]]=[copy[j],copy[i]]}return copy}
 weighted<T>(values:readonly T[],weight:(v:T)=>number):T{const total=values.reduce((s,v)=>s+Math.max(0,weight(v)),0);if(total<=0)return this.pick(values);let p=this.next()*total;for(const v of values){p-=Math.max(0,weight(v));if(p<0)return v}return values[values.length-1]}
}
