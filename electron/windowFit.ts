export type FitBounds = {x:number;y:number;width:number;height:number};
/** All dimensions are Electron DIPs; Windows already accounts for display scaling. */
export function fitWindowBounds(bounds:FitBounds, work:FitBounds):FitBounds {
  const width=Math.min(work.width,Math.max(Math.min(640,work.width),Number.isFinite(bounds.width)?bounds.width:1500));
  const height=Math.min(work.height,Math.max(Math.min(400,work.height),Number.isFinite(bounds.height)?bounds.height:940));
  return {width:Math.round(width),height:Math.round(height),
    x:Math.round(Math.max(work.x,Math.min(work.x+work.width-width,Number.isFinite(bounds.x)?bounds.x:work.x))),
    y:Math.round(Math.max(work.y,Math.min(work.y+work.height-height,Number.isFinite(bounds.y)?bounds.y:work.y)))};
}
export function fittedUiZoom(width:number,height:number,specialMode=false) {
  if(specialMode || !Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0)return 1;
  return Math.max(.8,Math.min(1,width/1120,height/720));
}
