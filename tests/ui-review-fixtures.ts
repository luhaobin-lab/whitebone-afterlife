/** Structurally legal UI stress fixtures. These are not normal-campaign results. */
import fs from 'node:fs/promises';
import * as R from '../src/domain/run';
import { UNITS, makeUnit } from '../src/content';
const dir='artifacts/ui-independent-review/fixtures';
await fs.mkdir(dir,{recursive:true});
function base(){const r=R.createRun('ui-boundary-fixture','legion');R.chooseNode(r,R.availableNodes(r)[0].id);r.bones=100;r.ownedRelics=['R_M01','R_M08'];r.machineRelics=['R_M01','R_M08'];return r;}
async function save(name:string,r:R.RunState){const result=R.validateRun(r);if(!result.ok)throw new Error(name+': '+result.message);await fs.writeFile(`${dir}/${name}.json`,R.serializeRun(r));}
const full=base();full.capacity=8;
const templates=['U_SK_3A','U_ZM_3B','U_HR_3B','U_HD_3B','U_BL_3B','U_CF_3B','U_SK_4','U_CF_4',...UNITS.slice(0,8).map(u=>u.id),'U_SK_2A','U_ZM_2B','U_BL_2A','U_CF_2B'];
full.army=templates.slice(0,16).map((id,i)=>makeUnit(id,`u${i+1}`,i===0?30:76,i<8?i:null));full.staging=templates.slice(16).map((id,i)=>makeUnit(id,`u${i+17}`,16,null));full.nextUid=21;full.items={I06:3,I07:3,I08:3};R.spin(full);if(full.slot)full.slot.settled=true;await save('full-roster',full);
const copy=base();copy.items={I03:2,I04:2,I05:2};R.spin(copy);if(copy.slot){copy.slot.board=['SK','CF','BL','HD','SK','CF','BL','HD','BL'];copy.slot.wins=[];}await save('copy-center',copy);
const itemFixtures:Record<string,Record<string,number>>={prequeue:{I01:3,I02:3,I10:3},training:{I06:3,I07:3,I08:3},combat:{I09:3,I11:3,I12:3}};
for(const [name,items]of Object.entries(itemFixtures)){const r=base();r.items=items;r.hp=35;await save(`items-${name}`,r);}
console.log(JSON.stringify({validated:true,fixtures:['full-roster','copy-center','items-prequeue','items-training','items-combat'],note:'UI edge fixtures only; no campaign result claims.'}));
