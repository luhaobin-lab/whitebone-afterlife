import type {FamilyId,NodeKind} from '../domain/types';
const frame=(body:string,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const paths:Record<FamilyId,string>={
 SK:'<path d="M15 30C9 9 55 9 49 30L46 42H41V53H23V42H18Z" fill="currentColor"/><path d="M22 29l6 2-1 7-8-1zm20 0-6 2 1 7 8-1zM32 36l-3 6h6z" fill="#17221e"/><path d="M28 44v9m8-9v9" stroke="#17221e" stroke-width="3"/>',
 ZM:'<path d="M32 51C19 42 8 32 12 20c3-9 15-10 20-2 7-9 18-6 20 4 2 11-8 22-20 29Z" fill="currentColor"/><path d="m24 12 4-7 9 4-3 10m-13 9 10 7-4 12m14-27-7 10 8 5" stroke="#17221e" stroke-width="4"/><path d="m19 26 7-5m12 20 7-5" stroke="#d3d89e" stroke-width="2"/>',
 HR:'<path d="m24 8 5 10 11-4 9 13-3 18-17 11H12l6-16 8-8-12-1-4-7Z" fill="currentColor"/><path d="m29 18 11 8-6 7-8-1m8 2 10 6m-17 7 5 5" stroke="#17221e" stroke-width="3"/><circle cx="31" cy="23" r="3" fill="#17221e"/><path d="m12 20 10-5m-2 23-7 8" stroke="currentColor" stroke-width="4"/>',
 HD:'<path d="M19 29V14c0-5 7-5 7 0v13V9c0-5 7-5 7 0v18V13c0-5 7-5 7 0v17-10c0-5 7-5 7 0v19L38 54H23L10 35c-3-5 3-9 7-4l6 7" fill="currentColor"/><path d="m25 34 8 4 7-4m-10 8 4 8M21 22h5m7-4h6m-6 11h6" stroke="#17221e" stroke-width="3"/>',
 BL:'<path d="M30 9h4v8c12 1 14 10 14 19l6 9H10l6-9c0-9 2-18 14-19Z" fill="currentColor"/><path d="M24 49c0 11 16 11 16 0" fill="currentColor"/><path d="M29 24c-6 2-6 8-6 12" stroke="#17221e" stroke-width="3"/><path d="m8 23-4 7m52-7 4 7M14 13l-4-4m40 4 4-4" stroke="currentColor" stroke-width="3"/>',
 CF:'<path d="M23 7h18l13 18-10 33H20L10 25Z" fill="currentColor"/><path d="M26 14h12l9 13-8 23H25l-8-23Z" stroke="#17221e" stroke-width="3"/><path d="M32 19v25m-8-16h16" stroke="#17221e" stroke-width="5"/>',
};
export const familyIcon=(family:FamilyId,cls='')=>frame(paths[family],cls);
const general:Record<string,string>={
 bones:'<path d="m19 20 26 24M18 13c-8-4-14 4-8 10-3 8 6 13 11 7l21 21c-3 8 7 13 12 6 8 2 12-7 6-12l-5-6c-3-3-8-2-10 2L24 20c4-5 1-12-6-7Z" fill="currentColor"/>',
 heart:'<path d="M32 54C7 36 5 23 14 15c6-5 14-3 18 4 5-7 13-9 19-4 10 9 5 23-19 39Z" fill="currentColor"/>',
 sword:'<path d="m41 7 15 1-1 15-24 21-9-9Z" fill="currentColor"/><path d="m15 32 19 19M22 44 11 55" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>',
 shield:'<path d="m32 7 23 9-4 22-19 20L13 38 9 16Z" fill="currentColor"/><path d="M32 15v31" stroke="#17221e" stroke-width="4"/>',
 crown:'<path d="m8 16 15 9 9-15 9 15 15-9-7 31H15Z" fill="currentColor"/><path d="M15 54h34" stroke="currentColor" stroke-width="5"/>',
 shop:'<path d="M13 28h38v27H13zM7 26l8-17h34l8 17Z" fill="currentColor"/><path d="M25 55V38h14v17M19 10l-3 16m15-16v16m12-16 4 16" stroke="#17221e" stroke-width="4"/>',
 grave:'<path d="M16 53V24c0-22 32-22 32 0v29M9 54h46" stroke="currentColor" stroke-width="6"/><path d="M32 18v25m-8-17h16" stroke="currentColor" stroke-width="5"/>',
 wrench:'<path d="M43 9a16 16 0 0 0-17 23L10 48a7 7 0 1 0 10 10l17-19A16 16 0 0 0 55 17L44 28l-9-9Z" fill="currentColor"/>',
 event:'<path d="M22 19c0-15 24-15 24 0 0 11-15 9-15 22" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><circle cx="31" cy="53" r="4" fill="currentColor"/>',
 lock:'<rect x="13" y="27" width="38" height="29" rx="5" fill="currentColor"/><path d="M22 28V16a10 10 0 0 1 20 0v12" stroke="currentColor" stroke-width="5"/><path d="M32 37v9" stroke="#17221e" stroke-width="4"/>',
 settings:'<path d="M28 5h8l3 10 9-1 6 7-6 9 4 8-6 7-10-3-5 9h-8l-3-10-9 1-6-7 6-9-4-8 6-7 10 3Z" stroke="currentColor" stroke-width="4"/><circle cx="29" cy="28" r="8" stroke="currentColor" stroke-width="4"/>',
 map:'<path d="m8 15 16-7 17 8 15-7v42l-15 6-17-8-16 7Z" stroke="currentColor" stroke-width="4"/><path d="M24 8v41m17-33v41" stroke="currentColor" stroke-width="3"/>',
 book:'<path d="M7 11c14-5 25 2 25 2s12-7 25-2v41c-15-5-25 1-25 1S20 47 7 52Z" stroke="currentColor" stroke-width="4"/><path d="M32 13v40m-18-31 10 1m-10 10 10 1m17-12 10-1m-10 12 10-1" stroke="currentColor" stroke-width="3"/>',
 arrow:'<path d="M9 32h44M36 15l17 17-17 17" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
 close:'<path d="m17 17 30 30m0-30L17 47" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>',
 check:'<path d="m12 33 13 13 28-29" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
 spark:'<path d="m32 5 7 20 20 7-20 7-7 20-7-20-20-7 20-7Z" fill="currentColor"/>',
 pause:'<path d="M18 12h9v40h-9zm19 0h9v40h-9z" fill="currentColor"/>',
 play:'<path d="M19 9v46l35-23Z" fill="currentColor"/>',
 sound:'<path d="m9 25 12-1 14-13v42L21 40H9Z" fill="currentColor"/><path d="M43 21c10 4 10 18 0 22m6-29c19 9 19 30 0 39" stroke="currentColor" stroke-width="4"/>',
 moon:'<path d="M41 8A24 24 0 1 0 57 42C35 50 24 25 41 8Z" fill="currentColor"/>',
 skull:paths.SK,
};
export const icon=(name:string,cls='')=>frame(general[name]||general.spark,cls);
export const nodeIcon=(kind:NodeKind)=>icon(({normal:'sword',elite:'shield',boss:'crown',shop:'shop',grave:'grave',workshop:'wrench',event:'event'} as const)[kind]);
