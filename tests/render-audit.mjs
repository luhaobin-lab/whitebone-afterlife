import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const output=path.resolve('tests/render-evidence/audit');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const checks={};
try {
  await page.goto('http://127.0.0.1:5173/tests/render-demo.html');
  await page.waitForFunction(()=>window.__rendererFixture?.renderer.getDebugStats().ready);
  await page.evaluate(()=>window.advanceTime(0));
  await page.waitForTimeout(120);
  const stage=await page.locator('#stage canvas').boundingBox();
  const actorSize=Math.min(68,Math.max(38,stage.width/19));
  const slotPoint=slot=>({x:stage.x+32+(12-Math.floor(slot/2)*3)/40*(stage.width-64),y:stage.y+stage.height*.53+(slot%2===0?4:8)/12*stage.height*.33});
  const from=slotPoint(0),to=slotPoint(3);
  checks.clientSlotMapping=await page.evaluate(points=>points.map(p=>window.__rendererFixture.renderer.slotAtClient(p.x,p.y)),Array.from({length:8},(_,i)=>slotPoint(i)));
  assert.deepEqual(checks.clientSlotMapping,[0,1,2,3,4,5,6,7]);
  assert.equal(await page.evaluate(()=>window.__rendererFixture.renderer.slotAtClient(-1,-1)),null);
  await page.mouse.move(from.x,from.y-actorSize*.4);await page.mouse.down();
  await page.mouse.move(to.x,to.y-actorSize*.4,{steps:16});await page.mouse.up();
  await page.waitForTimeout(180);
  checks.drag=await page.evaluate(()=>({slots:window.__rendererFixture.team.map(u=>u.slot),event:window.__rendererFixture.events.at(-1)}));
  assert.equal(checks.drag.event.type,'drop');assert.equal(checks.drag.event.uid,'demo-0');assert.equal(checks.drag.event.slot,3);
  assert.equal(checks.drag.slots[0],3);assert.equal(checks.drag.slots[3],0);
  const click=slotPoint(0);await page.mouse.click(click.x,click.y-actorSize*.35);
  await page.waitForTimeout(80);
  checks.unitClick=await page.evaluate(()=>window.__rendererFixture.events.at(-1));assert.equal(checks.unitClick.type,'click');
  await page.evaluate(()=>window.__rendererFixture.setTeam(['U_SK_1','U_ZM_1']));
  await page.waitForTimeout(100);
  const empty=slotPoint(4);await page.mouse.click(empty.x,empty.y+6);
  await page.waitForTimeout(80);
  checks.emptySlot=await page.evaluate(()=>({event:window.__rendererFixture.events.at(-1),slot:window.__rendererFixture.team[0].slot}));
  assert.equal(checks.emptySlot.event.type,'slot');assert.equal(checks.emptySlot.event.slot,4);assert.equal(checks.emptySlot.slot,4);
  checks.professions=[];
  for(let batch=0;batch<5;batch++){
    await page.click('#next');await page.waitForTimeout(80);
    checks.professions.push(await page.evaluate(()=>window.__rendererFixture.team.map(u=>u.templateId)));
    assert.equal(await page.evaluate(()=>window.__rendererFixture.renderer.getDebugStats().textureMismatches),0);
    await page.locator('#stage').screenshot({path:path.join(output,`professions-${batch+1}.png`)});
  }
  assert.equal(new Set(checks.professions.flat()).size,36);
  await page.click('#all-enemies');
  for(let act=1;act<=3;act++){
    await page.selectOption('#act',String(act));await page.waitForTimeout(80);
    await page.locator('#stage').screenshot({path:path.join(output,`act-${act}-all-enemies.png`)});
  }
  for(const [width,height,stageHeight]of [[1280,720,'320'],[1440,1000,'620'],[720,900,'470']]){
    await page.setViewportSize({width,height});await page.selectOption('#height',stageHeight);await page.waitForTimeout(100);
    await page.locator('#stage').screenshot({path:path.join(output,`stage-${width}-${stageHeight}.png`)});
  }
  await page.setViewportSize({width:1440,height:1000});await page.selectOption('#height','620');
  checks.stress=[];
  for(let cycle=0;cycle<3;cycle++){
    await page.click('#stress');
    for(const seconds of [2,5,8,12]){
      await page.evaluate(s=>window.advanceTime(s*1000),seconds);
      const snapshot=await page.evaluate(()=>({stats:window.__rendererFixture.renderer.getDebugStats(),live:window.__rendererFixture.battle.units.filter(u=>u.alive).length,history:window.__rendererFixture.battle.units.length,summons:window.__rendererFixture.battle.stats.summons,time:window.__rendererFixture.battle.time,result:window.__rendererFixture.battle.result,canvasCount:document.querySelectorAll('#stage canvas').length}));
      assert.equal(snapshot.stats.actors,snapshot.live);assert.equal(snapshot.stats.displayObjects,snapshot.live+46);assert.equal(snapshot.stats.numberPool,30);assert.equal(snapshot.canvasCount,1);
      checks.stress.push(snapshot);
      if(cycle===0)await page.locator('#stage').screenshot({path:path.join(output,`stress-${Math.round(snapshot.time)}s.png`)});
    }
    await page.click('#prep');await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.__rendererFixture.renderer.getDebugStats().actors),32);
  }
  await page.click('#stress');await page.evaluate(()=>window.advanceTime(2400));
  assert.equal(await page.evaluate(p=>window.__rendererFixture.renderer.slotAtClient(p.x,p.y),from),null);
  const before=await page.evaluate(()=>{window.__rendererFixture.setPaused(true);return JSON.stringify(window.__rendererFixture.battle);});
  await page.waitForTimeout(250);
  const after=await page.evaluate(()=>JSON.stringify(window.__rendererFixture.battle));
  assert.equal(after,before);checks.pausedSnapshotImmutable=true;
  const ally=await page.evaluate(()=>{const u=window.__rendererFixture.battle.units.find(u=>u.side==='ally'&&u.alive);return {id:u.id,x:u.x,y:u.y};});
  const battleCanvas=await page.locator('#stage canvas').boundingBox();
  const battleActorSize=Math.min(68,battleCanvas.width/19,battleCanvas.height*.145);
  await page.mouse.click(battleCanvas.x+32+ally.x/40*(battleCanvas.width-64),battleCanvas.y+battleCanvas.height*.53+ally.y/12*battleCanvas.height*.33-battleActorSize*.4);
  await page.waitForTimeout(80);
  checks.battleClickId=await page.evaluate(()=>window.__rendererFixture.events.at(-1));
  assert.equal(checks.battleClickId.id,ally.id);
  await page.locator('#stage').screenshot({path:path.join(output,'stress-paused.png')});
  await page.evaluate(()=>window.__rendererFixture.renderer.destroy());await page.waitForTimeout(100);
  assert.equal(await page.locator('#stage canvas').count(),0);checks.destroyRemovesCanvas=true;
  assert.deepEqual(errors,[]);checks.errors=errors;checks.passed=true;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(checks,null,2));
  console.log(JSON.stringify({passed:true,professionCount:36,stressSnapshots:checks.stress.length,maxActorCount:Math.max(...checks.stress.map(s=>s.stats.actors)),maxHistory:Math.max(...checks.stress.map(s=>s.history)),maxSummons:Math.max(...checks.stress.map(s=>s.summons)),errors,output},null,2));
} finally {await browser.close();}
