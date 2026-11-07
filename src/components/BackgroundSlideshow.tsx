import { useEffect, useState } from "react";

export function BackgroundSlideshow({url}:{url:string}) {
  const [layers,setLayers]=useState<string[]>([]);
  useEffect(()=>{
    let cancelled=false;
    const image=new Image();
    image.onload=()=>{if(!cancelled) setLayers(previous=>previous.at(-1)===url?previous:[...previous.slice(-1),url]);};
    image.src=url;
    return ()=>{cancelled=true;image.onload=null;};
  },[url]);
  return <div className="custom-background-layer" aria-hidden="true">
    {layers.map((source,index)=><div key={source} style={{position:"absolute",inset:0,backgroundPosition:"center",backgroundSize:"cover",backgroundImage:`url("${source.replace(/"/g,"%22")}")`,animation:index===layers.length-1?"background-crossfade 1.2s ease both":undefined}} />)}
  </div>;
}
