import { loadRegistry, defaultConfigPath, defaultStateDir } from './config.mjs';
import { Ledger } from './ledger.mjs';
import { HonchoAPI } from './api.mjs';

export function runtime({config=defaultConfigPath(),state}={}) {
  const registry=loadRegistry(config);
  const ledger=new Ledger(state ?? registry.stateDir ?? defaultStateDir());
  return {registry,ledger,api:(route,options)=>new HonchoAPI(ledger.validate(registry,route),options)};
}
export function options(argv) {
  const positional=[];const flags={};
  for(let i=0;i<argv.length;i++) {
    const a=argv[i];
    if(['--config','--state','--client','--profile','--manifest','--report','--route'].includes(a)) {
      if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Missing option value');
      flags[a.slice(2)]=argv[++i];
    } else if(a.startsWith('--'))flags[a.slice(2)]=true;
    else positional.push(a);
  }
  return {...flags,positional};
}
