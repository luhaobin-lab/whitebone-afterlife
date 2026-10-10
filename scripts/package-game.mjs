#!/usr/bin/env node
/** Package an existing Vite build. This command never builds or changes dist/. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=(key,fallback)=>{const i=args.indexOf(key);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`${key} needs a value`);return args[i+1]};
const allowed=new Set(['--dist','--out','--status','--version','--verify','--evidence','--help']);
for(const arg of args.filter(x=>x.startsWith('--')))if(!allowed.has(arg))throw Error(`Unknown option: ${arg}`);
if(args.includes('--help')){console.log('node scripts/package-game.mjs [--dist dist] [--out releases/Whitebone] [--status candidate|final] [--version VERSION] [--verify] [--evidence artifacts/offline/candidate]\nUses the existing single-JS/single-CSS build; never runs npm build.');process.exit(0)}
const dist=path.resolve(ROOT,option('--dist','dist')),out=path.resolve(ROOT,option('--out','releases/Whitebone'));
const status=option('--status','candidate');
if(!['candidate','final'].includes(status))throw Error('--status must be candidate or final');
if(dist===out||dist.startsWith(out+path.sep)||out.startsWith(dist+path.sep))throw Error('Distribution output must not overlap dist');
const evidence=path.resolve(ROOT,option('--evidence',`artifacts/offline/${status}`));
const gameName='白骨开张.html';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const relative=p=>path.relative(ROOT,p).split(path.sep).join('/');
const atomicWrite=async(file,bytes)=>{const temp=file+'.packaging-tmp';await writeFile(temp,bytes);await rename(temp,file)};
const json=object=>JSON.stringify(object,null,2)+'\n';
const inputFiles=[];
async function input(file){const bytes=await readFile(file);inputFiles.push({path:relative(file),sha256:sha(bytes),bytes:bytes.length});return bytes}
function assetPath(ref){
  if(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)||/[?#]/.test(ref))throw Error(`Nonlocal build asset: ${ref}`);
  const resolved=path.resolve(dist,decodeURIComponent(ref.replace(/^\//,'')));
  if(!resolved.startsWith(dist+path.sep))throw Error(`Asset escapes dist: ${ref}`);
  return resolved;
}

await mkdir(out,{recursive:true});
let prior;
try{prior=JSON.parse(await readFile(path.join(out,'version-manifest.json'),'utf8'))}catch{}
if(prior?.status==='final'&&status!=='final')throw Error('Refusing to overwrite a final package with a candidate. Choose another --out.');
const packageInfo=JSON.parse(await readFile(path.join(ROOT,'package.json'),'utf8'));
const version=option('--version',packageInfo.version);
if(!/^[a-zA-Z0-9.+_-]+$/.test(version))throw Error('Version must contain only letters, digits, dots, +, _ or -');
const builtAt=new Date().toISOString(),index=(await input(path.join(dist,'index.html'))).toString('utf8');
const scripts=[...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script\s*>/gi)];
const styles=[...index.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
if(scripts.length!==1||styles.length!==1)throw Error(`Expected one JS and one CSS asset, got ${scripts.length} and ${styles.length}. Add an explicit packaging strategy before shipping a split build.`);
const js=await input(assetPath(scripts[0][1])),css=await input(assetPath(styles[0][1]));
// Reject CSS assets which would no longer resolve after moving the single HTML.
const cssText=css.toString('utf8');
if(/@import\b/i.test(cssText)||[...cssText.matchAll(/url\(\s*["']?([^\s"')]+)/gi)].some(m=>!m[1].startsWith('data:')&&!m[1].startsWith('#')))throw Error('CSS references a separate asset; embed it before packaging.');
// Base64 keeps the original JS/CSS bytes intact, including literal HTML closing tags,
// Unicode and regex literals. Decoding into textContent avoids HTML-parser escaping.
const js64=js.toString('base64'),css64=css.toString('base64');
if(!Buffer.from(js64,'base64').equals(js)||!Buffer.from(css64,'base64').equals(css))throw Error('Embedded source roundtrip failed');
const loader=`<script type="module" id="whitebone-offline-loader">\nconst decode=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));\nconst style=document.createElement('style');style.textContent=decode('${css64}');document.head.append(style);\nconst game=document.createElement('script');game.type='module';game.textContent=decode('${js64}');document.head.append(game);\n</script>`;
const html=index.replace(scripts[0][0],()=>loader).replace(styles[0][0],'').replace('</head>',`<meta name="whitebone-version" content="${version}"><meta name="whitebone-release-status" content="${status}"><style>body{margin:0;background:#171d1a;color:#e8e6d4}</style></head>`).replace('</body>','<noscript>白骨开张需要启用浏览器 JavaScript。请使用桌面浏览器打开本文件。</noscript></body>');
if(/<(?:script|link|img|audio|video|source)\b[^>]*\b(?:src|href)\s*=/i.test(html))throw Error('Packaged HTML still contains an external resource reference');
await atomicWrite(path.join(out,gameName),html);

const licenses=[];
await mkdir(path.join(out,'licenses'),{recursive:true});
for(const [name,source,destination,role] of [
  ['phaser','node_modules/phaser/LICENSE.md','Phaser-MIT.txt','Phaser 游戏渲染框架'],
  ['eventemitter3','node_modules/eventemitter3/LICENSE','EventEmitter3-MIT.txt','Phaser 事件系统依赖'],
  ['vite','node_modules/vite/LICENSE.md','Vite-LICENSE.txt','构建产物中的模块预加载辅助代码'],
]){
  const bytes=await readFile(path.join(ROOT,source));
  const info=JSON.parse(await readFile(path.join(ROOT,'node_modules',name,'package.json'),'utf8'));
  await atomicWrite(path.join(out,'licenses',destination),bytes);
  licenses.push({package:name,installedVersion:info.version,role,path:`licenses/${destination}`,sha256:sha(bytes)});
}
const instructions=`白骨开张 · 离线版 ${version}\n${status==='candidate'?'候选包：用于离线验证，尚未标记为最终交付。':'最终交付包。'}\n\n打开游戏\n1. 双击“白骨开张.html”，或把它拖进桌面浏览器。建议使用 Chrome 或 Edge。\n2. 不需要安装游戏、不需要启动服务器，也不需要联网。若浏览器把文件当文本预览，请选择“打开方式”中的浏览器。\n3. 选择初始军团，保留随机种子或输入自定种子，然后点击“开张，出发”。\n\n基本流程\n地图选择发光的相连节点 → 免费拉杆 → 查看并领取招魂结果 → 整理军团 → 进攻。\n每个战斗节点包含三波，三章共36波。服务节点可购买遗物与道具、治疗、训练或调整轮盘。\n每波先用一次免费拉杆，再自行决定是否花骨头追加。盘面未领取、待安置新兵未处理或需要专精时，进攻按钮会说明原因。可选择领取到待命区，或招募并补空阵位。\n\n招募与成长\n3×3轮盘共有8条连线。同一家族一盘只产出一名：1/2/3/4条及以上中奖线分别为R1/R2/R3/R4。5/6/8条线时出生训练等级为Lv3/Lv5/Lv8。\nR2与R3在招魂结果中选择A/B职业分支。领取前可使用锁列、换格等改盘工具；领取后本盘固定。训练经验只提高等级；到Lv4选择训练专精，不会自动提高出生R阶。\n吸收会永久消耗供体，为另一名亡灵增加经验；确认窗口会列出收益。同族换壳要求更高R阶，保留较高训练经验，改用新职业并重新选择专精。\n正式亡灵战后复起。临时召唤物只存在于战斗中。命匣归零或首领节点失败会结束远征。\n\n操作\n鼠标点击兵牌，再点击阵位部署；也可以拖动兵牌到阵位。选中单位后可查看详情、放入后备、吸收或选择专精。\n空格：当前主要操作；战斗中暂停/恢复。F：全屏。Esc：关闭弹窗。\n战斗自动进行，可切换1×/2×速度；右上角提供图鉴、帮助、设置与存档。\n声音会在首次点击后启用，可在设置中静音或调节音量。\n\n存档\n游戏在当前浏览器自动保存。再次打开同一个文件后，可从标题页“继续上次”。\n文件位置、浏览器或电脑变更可能导致自动存档不共用；迁移前请在设置中导出存档，之后使用导入存档。\n隐私模式或浏览器禁止本地存储时，自动保存可能不可用；界面会提示保存失败。\n\n包内文件\n白骨开张.html：包含代码、样式、图形与合成音效的离线入口。\nversion-manifest.json：构建输入、成品校验值、候选/最终状态与验证摘要。\nlicenses：Phaser 等第三方组件的许可原文；转交本包时请一并保留。\n\n验收范围\n完整36波已使用多种合法经营策略验证。自动仿真速度不代表实际游玩时长；真人首局时长和长期重复游玩的乐趣仍需试玩。\n`;
await atomicWrite(path.join(out,'操作说明.txt'),instructions);
await atomicWrite(path.join(out,'THIRD-PARTY-NOTICES.txt'),`白骨开张第三方组件说明\n\n${licenses.map(l=>`${l.package} ${l.installedVersion}\n${l.role}\n许可原文：${l.path}\n`).join('\n')}\n以上版本来自本次打包环境。游戏实际构建以 version-manifest.json 内构建文件哈希为准。\n`);
const outputNames=[gameName,'操作说明.txt','THIRD-PARTY-NOTICES.txt',...licenses.map(x=>x.path)];
const outputs=[];
for(const name of outputNames){const bytes=await readFile(path.join(out,name));outputs.push({path:name,bytes:bytes.length,sha256:sha(bytes)})}
const manifest={game:'白骨开张',version,status,packagedAt:builtAt,entry:gameName,format:'single-file offline HTML',packagingCommand:'node scripts/package-game.mjs '+args.join(' '),buildPerformedByPackager:false,inputs:inputFiles,outputs,licenses,embeddedSources:{encoding:'base64 UTF-8 decoded into DOM textContent',javascriptSha256:sha(js),cssSha256:sha(css),byteExactRoundtrip:true},verification:{status:'not-run',scope:'Packaging does not establish complete gameplay quality or human play duration.'}};
await atomicWrite(path.join(out,'version-manifest.json'),json(manifest));

async function verifyOffline(){
  const {chromium}=await import('playwright');
  await mkdir(evidence,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:900},offline:true});
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const pageErrors=[],consoleErrors=[],network=[],actions=[],screenshots=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
  page.on('request',r=>network.push({url:r.url(),type:r.resourceType()}));
  const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
  const click=async(action,attrs={})=>{const selector=`[data-action="${action}"]`+Object.entries(attrs).map(([k,v])=>`[data-${k}="${v}"]`).join('');await page.locator(selector).first().click();actions.push({action,...attrs})};
  const shot=async(name)=>{const filename=`${name}.png`;await page.screenshot({path:path.join(evidence,filename),fullPage:true});screenshots.push(filename)};
  let failure=null,finalState=null,restoredSnapshot=null,automaticBirth=null,uiFlow='undetected';
  console.log('Offline QA: file://, networking disabled, real DOM controls and real-time first wave.');
  try{
    await page.goto(pathToFileURL(path.join(out,gameName)).href);
    await page.waitForFunction(()=>typeof window.render_game_to_text==='function');
    await page.waitForSelector('#world canvas');
    if((await state()).mode!=='title')throw Error('Initial screen is not title');
    await shot('01-title');
    await page.fill('#seed-input','offline-birth-1');await click('new-run');
    let s=await state();if(s.mode!=='map')throw Error('Start did not enter the map');
    const node=s.availableNodes.find(n=>n.kind==='normal')||s.availableNodes[0];
    await click('inspect-node',{id:node.id});await click('enter-node',{id:node.id});
    await shot('02-prep');const beforeBirth=await state();await click('spin');
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).slot?.materialized===true||!!document.querySelector('[data-action="claim-dialog"], [data-action="birth-branch"]'));
    s=await state();
    const automaticUi=s.slot?.materialized===true||await page.locator('[data-action="birth-branch"]').count()>0;
    if(automaticUi){
    uiFlow='automatic-birth';
    if(s.slot.settled||s.slot.provisionalUids?.length!==1)throw Error('Coverage seed did not automatically materialize one editable R2 recruit');
    const uid=s.slot.provisionalUids[0],birth=s.army.find(u=>u.uid===uid);
    if(!birth||birth.rank!==2||birth.slot!==3||birth.staged||beforeBirth.army.some(u=>u.uid===uid))throw Error('Automatic birth did not occupy the free fourth field slot');
    if(await page.locator('[data-action="claim-dialog"], [data-action="claim"]').count())throw Error('The removed claim-result flow is still present');
    await shot('03-automatic-birth');
    await click('birth-branch',{uid,choice:'B'});s=await state();
    if(s.slot.settled||s.slot.provisionalUids[0]!==uid||!s.army.find(u=>u.uid===uid)?.id.endsWith('B'))throw Error('Inline birth-branch change did not preserve the editable recruit');
    await click('select-tool',{source:'R_M01'});await click('slot-cell',{index:0});
    s=await state();
    if(s.slot.revision!==1||s.slot.interventions!==1||s.slot.settled||s.army.some(u=>u.uid===uid)||s.slot.provisionalUids?.length!==1)throw Error('Lock-column edit did not replace only the provisional birth');
    const replacement=s.army.find(u=>u.uid===s.slot.provisionalUids[0]);
    if(!replacement||replacement.rank!==1||replacement.slot!==3)throw Error('Edited birth is not the expected real R1 replacement');
    if(beforeBirth.army.some(old=>!s.army.some(u=>u.uid===old.uid&&u.id===old.id&&u.xp===old.xp&&u.slot===old.slot)))throw Error('Board editing changed an older soldier');
    automaticBirth={seed:'offline-birth-1',initialUid:uid,initialRank:birth.rank,branchChangedWithSameUid:true,replacementUid:replacement.uid,replacementRank:replacement.rank,revision:s.slot.revision,claimPanelAbsent:true};
    await shot('04-edited-birth');
    }else{
      uiFlow='claim-dialog';
      if(!s.slot||s.slot.settled)throw Error('Free spin did not produce an unsettled claimable board');
      await shot('03-spin');await click('claim-dialog');
      if(await page.locator('[data-action="claim"]').count()){
        await shot('04-claim-results');await click('claim',{auto:'1'});
      }
      s=await state();
      if(!s.slot?.settled)throw Error('Legacy claim did not settle the board');
      const recruited=s.army.filter(u=>!beforeBirth.army.some(old=>old.uid===u.uid));
      if(recruited.length!==1||recruited[0].rank!==2||recruited[0].slot!==3)throw Error('Legacy claim did not recruit and deploy the expected R2 unit');
    }
    for(const unit of s.army.filter(u=>u.staged)){await click('select-unit',{uid:unit.uid});await click('bench',{uid:unit.uid})}
    s=await state();
    for(const unit of s.army.filter(u=>u.slot!==null&&u.level>=4&&!u.specialization)){await click('select-unit',{uid:unit.uid});await click('spec-dialog',{uid:unit.uid});await click('choose-spec',{uid:unit.uid,choice:'A'})}
    if(!(await state()).canStart.ok)throw Error('Cannot start after legal preparation');
    await click('start-battle');
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).battle?.time>=3);
    await click('pause');await shot('05-battle');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('whitebone.save.v1')));
    if(!saved)throw Error('File origin did not save the campaign');
    await page.reload();await page.waitForFunction(()=>typeof window.render_game_to_text==='function');
    await click('continue-run');s=await state();
    if(s.mode!=='battle'||s.seed!=='offline-birth-1')throw Error('Reload did not resume the saved battle');
    restoredSnapshot={seed:s.seed,mode:s.mode,battleTime:s.battle.time};
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).mode!=='battle',{},{timeout:90000});
    finalState=await state();await shot('06-result');
    if(finalState.mode!=='waveResult'||finalState.runStats.wavesPlayed!==1)throw Error('First battle did not reach exactly one result');
    if(!Number.isFinite(finalState.battle.stats.damage)||finalState.battle.stats.damage<=0)throw Error('Battle produced no damage');
    await click('continue-wave');s=await state();
    if(finalState.battle.result==='win'&&(s.mode!=='prep'||s.wave!==2))throw Error('Cannot continue to wave two');
    const resources=await page.evaluate(()=>({scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src),styles:[...document.querySelectorAll('link[rel="stylesheet"]')].map(s=>s.href),canvasCount:document.querySelectorAll('#world canvas').length,bodyWidth:document.body.scrollWidth,windowWidth:innerWidth}));
    if(resources.scripts.length||resources.styles.length||resources.canvasCount!==1)throw Error('Unexpected external resources or canvas count');
    const external=network.filter(r=>!r.url.startsWith('file:')&&!r.url.startsWith('data:')&&!r.url.startsWith('blob:'));
    if(external.length)throw Error('Attempted external network requests: '+external.map(r=>r.url).join(', '));
    if(pageErrors.length||consoleErrors.length)throw Error('Browser errors: '+[...pageErrors,...consoleErrors].join('\n'));
    console.log(`Offline QA passed (${uiFlow}): first wave ${finalState.battle.result}, ${finalState.battle.time.toFixed(2)} seconds, zero external requests.`);
  }catch(error){failure=String(error);try{await shot('FAILURE');finalState=await state()}catch{}}finally{await browser.close()}
  const report={generatedAt:new Date().toISOString(),status:failure?'failed':'passed',packageStatus:status,entry:relative(path.join(out,gameName)),entrySha256:sha(Buffer.from(html)),browser:'Chromium headless 1440x900',mode:'file:// with browser networking disabled',uiFlow,timePolicy:'Real requestAnimationFrame timing, no advanceTime calls',mutationPolicy:'Game state changes only through visible DOM controls; no injected state, free resources, outcomes, or domain-action calls',pageErrors,consoleErrors,network,externalRequests:network.filter(r=>!/^file:|^data:|^blob:/.test(r.url)),actions,screenshots,automaticBirth,restoredSnapshot,finalState,failure};
  await atomicWrite(path.join(evidence,'report.json'),json(report));
  return report;
}

if(args.includes('--verify')){
  const report=await verifyOffline();
  manifest.verification={status:report.status,generatedAt:report.generatedAt,method:report.mode,browser:report.browser,uiFlow:report.uiFlow,automaticBirth:report.automaticBirth,firstWaveResult:report.finalState?.battle?.result,externalRequestCount:report.externalRequests.length,pageErrorCount:report.pageErrors.length,consoleErrorCount:report.consoleErrors.length,saveReload:!!report.restoredSnapshot,evidence:relative(path.join(evidence,'report.json')),scope:`Offline ${report.uiFlow} recruitment and first-wave smoke, not complete campaign or human play-quality acceptance.`};
  await atomicWrite(path.join(out,'version-manifest.json'),json(manifest));
  if(report.status!=='passed')throw Error(report.failure||'Offline verification failed');
}
for(const file of inputFiles)if(sha(await readFile(path.join(ROOT,file.path)))!==file.sha256){
  manifest.inputsUnchangedDuringPackaging=false;
  manifest.verification.status='failed';
  manifest.verification.reason=`Build changed during packaging: ${file.path}`;
  await atomicWrite(path.join(out,'version-manifest.json'),json(manifest));
  throw Error(`${manifest.verification.reason}. Repackage the final build.`);
}
manifest.inputsUnchangedDuringPackaging=true;
await atomicWrite(path.join(out,'version-manifest.json'),json(manifest));
console.log(json({status,version,entry:relative(path.join(out,gameName)),bytes:Buffer.byteLength(html),sha256:sha(Buffer.from(html)),verification:manifest.verification.status,distUnchanged:true}));
