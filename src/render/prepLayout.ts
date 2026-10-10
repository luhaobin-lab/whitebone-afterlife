export interface PrepPoint {x:number;y:number}
export interface PrepRect {x:number;y:number;width:number;height:number}
export type CampRegion='reserve'|'staging';
export interface CampLayout {region:CampRegion;rect:PrepRect;columns:number;rows:number;pitch:number;size:number;points:PrepPoint[]}
export interface PreparationLayout {
  width:number;height:number;safeBottom:number;fieldTop:number;fieldBottom:number;actorSize:number;
  camps:Record<CampRegion,CampLayout>;slots:Array<{foot:PrepPoint;badge:PrepPoint}>;
}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));

/** One screen-space layout supplies drawing, hit testing and automation coordinates. */
export function preparationLayout(width:number,height:number,reserves:number,staged:number):PreparationLayout {
  const safeBottom=64,margin=18,gap=14,bottom=Math.max(150,height-safeBottom);
  const contentWidth=Math.max(280,width-margin*2),share=clamp(Math.max(4,staged)/(Math.max(8,reserves)+Math.max(4,staged)),.36,.62);
  const stagingWidth=Math.round((contentWidth-gap)*share),reserveWidth=contentWidth-gap-stagingWidth;
  const cellWidth=clamp(width/16,48,74),stagingColumns=Math.max(1,Math.floor((stagingWidth-16)/cellWidth)),reserveColumns=Math.max(1,Math.floor((reserveWidth-16)/cellWidth));
  const stagingRows=Math.max(1,Math.ceil(staged/stagingColumns)),reserveRows=Math.max(1,Math.ceil(reserves/reserveColumns)),rows=Math.max(stagingRows,reserveRows);
  const pitch=clamp((bottom*.45-34)/rows,38,76),campHeight=34+rows*pitch,campTop=Math.max(110,bottom-campHeight);
  const fieldTop=clamp(height*.16,68,102),fieldBottom=Math.max(fieldTop+64,campTop-18);
  const actorSize=clamp(Math.min(width/15,(fieldBottom-fieldTop)*.32),30,68);
  const size=clamp(Math.min(cellWidth*.76,pitch*.62),26,55);
  const makeCamp=(region:CampRegion,x:number,w:number,count:number,columns:number,rowCount:number):CampLayout=>{
    const rect={x,y:campTop,width:w,height:Math.max(54,bottom-campTop)};
    const step=(w-16)/columns;
    const points=Array.from({length:count},(_,i)=>({x:x+8+step*(i%columns+.5),y:campTop+27+pitch*(Math.floor(i/columns)+.78)}));
    return {region,rect,columns,rows:rowCount,pitch,size,points};
  };
  const camps={staging:makeCamp('staging',margin,stagingWidth,staged,stagingColumns,stagingRows),reserve:makeCamp('reserve',margin+stagingWidth+gap,reserveWidth,reserves,reserveColumns,reserveRows)};
  const slots=Array.from({length:8},(_,slot)=>{
    const foot={x:width*(.43-Math.floor(slot/2)*.11),y:fieldTop+(slot%2===0?.38:.78)*(fieldBottom-fieldTop)};
    return{foot,badge:{x:foot.x+actorSize*.68+12,y:foot.y+2}};
  });
  return{width,height,safeBottom,fieldTop,fieldBottom,actorSize,camps,slots};
}

export function insideRect(point:PrepPoint,rect:PrepRect,inset=0){return point.x>=rect.x+inset&&point.x<=rect.x+rect.width-inset&&point.y>=rect.y+inset&&point.y<=rect.y+rect.height-inset;}
