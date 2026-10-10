import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import readline from 'node:readline';
const out='artifacts/ui-independent-review';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const snap=async(name,fullPage=false)=>{await page.screenshot({path:`${out}/${name}.png`,fullPage});return await state();};
const state=async()=>page.evaluate(()=>({game:window.render_game_to_text?JSON.parse(window.render_game_to_text()):null,buttons:[...document.querySelectorAll('button')].filter(b=>b.offsetWidth&&b.offsetHeight).map(b=>({text:b.textContent.trim().slice(0,90),action:b.dataset.action,id:b.dataset.id,uid:b.dataset.uid,disabled:b.disabled})),scroll:{x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,docHeight:document.documentElement.scrollHeight,docWidth:document.documentElement.scrollWidth}}));
const click=async(action,extra='')=>{await page.locator(`[data-action="${action}"]${extra}`).first().click();await page.waitForTimeout(120);};
await page.goto('http://127.0.0.1:5173/?test=1');
await page.waitForFunction(()=>!!window.render_game_to_text);
console.log(JSON.stringify({ready:true,state:await snap('1440-title')}));
for await(const line of readline.createInterface({input:process.stdin,terminal:false})){
  try{const result=await eval(`(async()=>{${line}})()`);console.log(JSON.stringify({result,errors}));}
  catch(e){console.log(JSON.stringify({error:String(e),stack:e.stack,errors}));}
}
await browser.close();
