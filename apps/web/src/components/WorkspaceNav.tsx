export type WorkspacePanel='overview'|'agent'|'funds'|'key'|'activity';
export const workspacePanels=[
  {id:'overview',label:'Overview',mobileLabel:'Vault',hint:'Your vault at a glance',symbol:'◫'},
  {id:'agent',label:'Agent & session',mobileLabel:'Agent',hint:'Prepare, set limits, pay',symbol:'◎'},
  {id:'funds',label:'Funds',mobileLabel:'Funds',hint:'Deposit and withdraw',symbol:'↔'},
  {id:'key',label:'Vault Key',mobileLabel:'Key',hint:'Unlock and back up',symbol:'◇'},
  {id:'activity',label:'Activity',mobileLabel:'Activity',hint:'Transactions and recovery',symbol:'≡'},
] as const;
export function WorkspaceNav({panel,onChange}:{panel:WorkspacePanel;onChange(panel:WorkspacePanel):void}){
  return <nav id="workspace-tabs" role="tablist" aria-label="Vault workspace" className="workspace-nav" tabIndex={-1}>
    {workspacePanels.map((item,index)=><button key={item.id} id={`tab-${item.id}`} role="tab" aria-label={item.label} aria-selected={panel===item.id} aria-controls={`panel-${item.id}`} tabIndex={panel===item.id?0:-1} onClick={()=>onChange(item.id)} onKeyDown={event=>{
      if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?workspacePanels.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+workspacePanels.length)%workspacePanels.length;onChange(workspacePanels[next].id);}
    }}><span aria-hidden="true" className="nav-symbol">{item.symbol}</span><span><span className="nav-title">{item.label}</span><span className="nav-mobile-title">{item.mobileLabel}</span><small>{item.hint}</small></span></button>)}
  </nav>;
}
