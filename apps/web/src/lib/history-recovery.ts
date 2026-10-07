import { loadOperations, unresolvedOperation, type Operation } from './operations';
export const OPERATION_KEY='arcmandate.operations.v1';
export function inspectHistory(raw:string):{ valid:Operation[]; invalid:number; unidentified:boolean }{
  let rows:unknown;try{rows=JSON.parse(raw);}catch{return{valid:[],invalid:1,unidentified:true};}
  if(!Array.isArray(rows))return{valid:[],invalid:1,unidentified:true};
  const valid:Operation[]=[];let invalid=0;
  for(const row of rows){try{valid.push(...loadOperations({getItem:()=>JSON.stringify([row])}));}catch{invalid++;}}
  return{valid,invalid,unidentified:false};
}
export function repairHistory(raw:string,replacement:string,accounted:boolean,storage:Pick<Storage,'setItem'>):Operation[]{
  const next=loadOperations({getItem:()=>replacement});const before=inspectHistory(raw);
  for(const op of before.valid){
    const restored=next.find(item=>item.id===op.id);
    if(!restored)throw new Error('Repair must preserve every valid saved operation.');
    if(unresolvedOperation(op) && (restored.account.toLowerCase()!==op.account.toLowerCase()||restored.dataHash!==op.dataHash||restored.hash!==op.hash||restored.stage!==op.stage))throw new Error('Repair cannot remove or resolve an existing pending operation. Use receipt reconciliation.');
  }
  if((before.invalid||before.unidentified)&&!accounted)throw new Error('Damaged rows may hide a submitted transaction. Account for them in wallet activity before restoring history.');
  // Quarantine is retained before replacement, including a user's explicit accounting statement.
  storage.setItem(`arcmandate.history-quarantine.${new Date().toISOString()}`,JSON.stringify({raw,accounted,at:new Date().toISOString()}));
  storage.setItem(OPERATION_KEY,JSON.stringify(next));return next;
}
