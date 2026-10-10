import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='artifacts/ui/edge-final';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(5000);const errors=[],checks=[],actions=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const read=()=>page.evaluate(()=>window.__whitebone.getRun());
const click=async(action,attrs={})=>{await page.locator(`[data-action="${action}"]`+Object.entries(attrs).map(([k,v])=>`[data-${k}="${v}"]`).join('')).first().click();actions.push({action,...attrs})};
const close=async()=>{if(await page.locator('#modal-layer.open').count())await click('close-modal')};
const shot=async(name)=>page.screenshot({path:`${out}/${name}.png`});
try{
 await page.goto('http://127.0.0.1:4173/?test');await page.waitForFunction(()=>window.render_game_to_text);await click('settings');await click('toggle-motion');await close();await page.reload();await page.waitForFunction(()=>window.render_game_to_text);await click('settings');if(!(await page.locator('[data-action=toggle-motion]').innerText()).includes('已开启'))throw Error('title setting not saved');checks.push('Title reduced-motion persists');await close();await page.fill('#seed-input','failure-edge-v1');await click('new-run');
 let checkedBattle=false,savedExport='';
 for(let phases=0;phases<70;phases++){
  let s=await state(),r=await read();if(s.mode==='defeat')break;
  if(s.mode==='map'){await click('inspect-node',{id:s.availableNodes[0].id});await click('enter-node',{id:s.availableNodes[0].id})}
  else if(s.mode==='prep'){
   await click('spin');await page.evaluate(()=>window.advanceTime(1000));await click('claim-dialog');if(await page.locator('[data-action=claim]').count())await click('claim',{auto:'0'});r=await read();
   for(const u of r.staging){await click('select-unit',{uid:u.uid});await click('bench',{uid:u.uid})}
   r=await read();for(const u of r.army.filter(u=>u.slot!==null&&u.uid!=='u1')){await click('select-unit',{uid:u.uid});await click('bench',{uid:u.uid})}
   if(await page.locator('[data-action=spec-dialog]').count()){await click('spec-dialog');await click('choose-spec',{choice:'A'})}
   await click('start-battle');await page.evaluate(()=>window.advanceTime(8000));
   if(!checkedBattle&&(await state()).mode==='battle'){
    await click('pause');await shot('01-battle-effects');const u=await page.evaluate(()=>window.__whitebone.getBattle().units.find(u=>u.side==='ally'&&u.alive&&!u.temporary));if(u){const box=await page.locator('#world canvas').boundingBox();await page.mouse.click(box.x+32+u.x/40*(box.width-64),box.y+box.height*.53+u.y/12*(box.height*.33)-18);if((await state()).modal!=='unit')throw Error('battle ally click failed');await shot('02-live-unit');await close();checks.push('Combat ally click opens current unit stats')}
    await click('pause');checkedBattle=true;
   }
   if(!savedExport){await click('settings');const downloaded=page.waitForEvent('download');await click('export-save');const download=await downloaded;savedExport=`${out}/exported-battle-save.json`;await download.saveAs(savedExport);await close();checks.push('Actual in-battle export download');}
   for(let i=0;i<4&&(await state()).mode==='battle';i++)await page.evaluate(()=>window.advanceTime(30000));
  }else if(s.mode==='waveResult')await click('continue-wave');
  else if(s.mode==='reward')await click('take-reward',{id:'skip'});
  else if(['shop','grave','workshop','event'].includes(s.mode)){if(s.mode==='event')await click('event-choice',{choice:'c'});await click('leave-service')}
 }
 let s=await state();if(s.mode!=='defeat')throw Error('understrength legal policy did not reach defeat');if(s.hp>0&&!(await page.locator('.end-screen').innerText()).includes('首领守住了城门'))throw Error('boss defeat misstates HP');await shot('03-legitimate-defeat');checks.push('Legal one-unit campaign reached actual defeat with correct boss rule');
 await click('replay-seed');if((await state()).mode!=='map')throw Error('same-seed replay failed');if((await state()).seed!=='failure-edge-v1')throw Error('replay seed changed');checks.push('Same-seed replay resets run');
 await click('settings');await page.locator('#save-file-input').setInputFiles(savedExport);if(!(await page.locator('.modal-header h2').innerText()).includes('载入'))throw Error('file import preview missing');await close();if((await state()).mode!=='map')throw Error('cancelled import mutated run');checks.push('Import cancel is non-mutating');await click('settings');await page.locator('#save-file-input').setInputFiles(savedExport);await click('confirm-import');s=await state();if(!['battle','waveResult'].includes(s.mode))throw Error('valid import failed');await shot('04-imported-battle');checks.push('Actual exported save re-imports');
 await click('settings');writeFileSync(`${out}/invalid.json`,'{"bad":true}');await page.locator('#save-file-input').setInputFiles(`${out}/invalid.json`);if(!(await page.locator('#toast-area').innerText()).includes('损坏'))throw Error('corrupt import not rejected');checks.push('Corrupt import visibly rejected');await close();
 await page.keyboard.press('f');await page.waitForTimeout(100);if(!await page.evaluate(()=>!!document.fullscreenElement))throw Error('F failed fullscreen');await page.keyboard.press('f');checks.push('F enters and exits fullscreen');
 if(errors.length)throw Error(errors.join('\n'));writeFileSync(`${out}/report.json`,JSON.stringify({checks,errors,actions,defeatPolicy:'Only the initial u1 is deployed. All other permanent units kept in reserve. All transitions via actual UI; no state edits.',importSource:'A real browser export from this same legal run.'},null,2));console.log(JSON.stringify({checks,errors,actions:actions.length}));
}catch(e){await shot('FAILURE');writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(e),errors,state:await state(),actions:actions.slice(-20)},null,2));throw e}finally{await browser.close()}
