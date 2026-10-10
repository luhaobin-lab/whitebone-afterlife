/** Small original synthesised cues. No downloaded sound assets. */
export class GameAudio {
 private ctx:AudioContext|null=null; muted=false;volume=.22;private lastHit=0;
 unlock(){if(!this.ctx)this.ctx=new AudioContext();if(this.ctx.state==='suspended')void this.ctx.resume()}
 play(name:string){if(this.muted||this.volume<=0)return;this.unlock();const c=this.ctx!;const t=c.currentTime;
  if(name==='hit'&&t-this.lastHit<.10)return;if(name==='hit')this.lastHit=t;
  const notes:Record<string,number[]>={click:[240],confirm:[300,450],spin:[90,130,180,240],win:[330,440,550,660],jackpot:[220,330,440,550,660,880],purchase:[440,660],upgrade:[260,390,520],deny:[100,75],hit:[135],heal:[500,640],travel:[180,270,360],event:[240,320],death:[130,80],victory:[330,440,550,660,880],defeat:[220,165,130]};
  const seq=notes[name]||notes.click;seq.forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.type=name==='hit'?'triangle':name==='spin'?'square':'sine';o.frequency.setValueAtTime(f,t+i*.075);o.frequency.exponentialRampToValueAtTime(f*.98,t+i*.075+.16);g.gain.setValueAtTime(0,t+i*.075);g.gain.linearRampToValueAtTime(this.volume*(name==='hit'?.12:.3),t+i*.075+.008);g.gain.exponentialRampToValueAtTime(.001,t+i*.075+.18);o.connect(g);g.connect(c.destination);o.start(t+i*.075);o.stop(t+i*.075+.2)})
 }
}
