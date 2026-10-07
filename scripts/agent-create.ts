import { mkdirSync, writeFileSync, existsSync, chmodSync, realpathSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
export function createAgent(name:string,root=resolve('private/agents')):{address:string;path:string}{
  if(!/^[a-z][a-z0-9-]{0,47}$/.test(name))throw new Error('Use a name starting with a lowercase letter, followed by letters, digits or hyphens (max 48).');
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))throw new Error('Choose a name that is not a reserved Windows device.');
  mkdirSync(root,{recursive:true,mode:0o700});const privateRoot=realpathSync(root);
  const directory=resolve(privateRoot,name); if(!directory.startsWith(privateRoot+sep))throw new Error('Agent directory must remain under private/agents.');
  const path=join(directory,'key.json');if(existsSync(directory))throw new Error('This agent directory already exists. It will not be reused or overwritten. Choose a new name.');
  mkdirSync(directory,{mode:0o700});
  if(process.platform==='win32'){
    const identity=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}); const sid=identity.match(/S-1-[0-9-]+/)?.[0];
    if(!sid)throw new Error('Unable to establish the Windows owner SID. No agent key was written.');
    execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'pipe',windowsHide:true});
  }else chmodSync(directory,0o700);
  const key=generatePrivateKey();writeFileSync(path,JSON.stringify({privateKey:key})+'\n',{flag:'wx',mode:0o600});
  return {address:privateKeyToAccount(key).address,path};
}
if(process.argv[1]&&/agent-create\.(ts|js)$/.test(process.argv[1])){
  try{const at=process.argv.indexOf('--name');const result=createAgent(at>=0?process.argv[at+1]:'test-agent');console.log(JSON.stringify({chain:'Arc Testnet',...result,note:'Only this public address is printed. The unencrypted local agent key is not a Vault Key backup; never share it or use your owner key.'},null,2));}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
