import { useLayoutEffect, useRef, useState } from 'react';
export type WorkspacePanel='overview'|'agent'|'funds'|'key'|'activity';
export const workspacePanels=[
  {id:'overview',label:'Overview',mobileLabel:'Vault',hint:'Your vault at a glance',symbol:'◫'},
  {id:'agent',label:'Agent & session',mobileLabel:'Agent',hint:'Prepare, set limits, pay',symbol:'◎'},
  {id:'funds',label:'Funds',mobileLabel:'Funds',hint:'Deposit and withdraw',symbol:'↔'},
  {id:'key',label:'Vault Key',mobileLabel:'Key',hint:'Unlock and back up',symbol:'◇'},
  {id:'activity',label:'Activity',mobileLabel:'Activity',hint:'Transactions and recovery',symbol:'≡'},
] as const;
/** The four-point star from the ArcMandate mark; it marks the current page on the chart. */
const STAR="M12 1.5C12.9 8.4 15.6 11.1 22.5 12C15.6 12.9 12.9 15.6 12 22.5C11.1 15.6 8.4 12.9 1.5 12C8.4 11.1 11.1 8.4 12 1.5Z";
export function WorkspaceNav({panel,onChange}:{panel:WorkspacePanel;onChange(panel:WorkspacePanel):void}){
  const nav=useRef<HTMLElement>(null);
  const [marker,setMarker]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  useLayoutEffect(()=>{
    const element=nav.current;if(!element)return;
    const update=()=>{const selected=element.querySelector<HTMLElement>('[aria-selected="true"]');if(!selected||!selected.offsetWidth)return;setMarker({x:selected.offsetLeft,y:selected.offsetTop,width:selected.offsetWidth,height:selected.offsetHeight});};
    update();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(update);observer?.observe(element);
    element.querySelectorAll('button').forEach(button=>observer?.observe(button));
    return()=>observer?.disconnect();
  },[panel]);
  return <nav ref={nav} id="workspace-tabs" role="tablist" aria-label="Vault workspace" className="workspace-nav star-chart" data-marker={marker?'ready':undefined} tabIndex={-1}>
    <span aria-hidden="true" className="chart-rail"/>
    {marker&&<span aria-hidden="true" className="nav-active-marker" style={{transform:`translate(${marker.x}px, ${marker.y}px)`,width:marker.width,height:marker.height}}><span className="chart-star"><svg viewBox="0 0 24 24"><path d={STAR}/></svg></span></span>}
    {workspacePanels.map((item,index)=><button key={item.id} id={`tab-${item.id}`} role="tab" aria-label={item.label} aria-selected={panel===item.id} aria-controls={`panel-${item.id}`} tabIndex={panel===item.id?0:-1} onClick={()=>onChange(item.id)} onKeyDown={event=>{
      if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?workspacePanels.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+workspacePanels.length)%workspacePanels.length;onChange(workspacePanels[next].id);}
    }}><span aria-hidden="true" className="chart-node"/><span><span className="nav-title">{item.label}</span><span className="nav-mobile-title">{item.mobileLabel}</span><small>{item.hint}</small></span></button>)}
  </nav>;
}
