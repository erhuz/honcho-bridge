import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runtime,options } from './runtime.mjs';
import { inventory,recover } from './recovery.mjs';
import { errorText,HonchoAPI } from './api.mjs';
import { resolveProject } from './config.mjs';
import { deliver } from './delivery.mjs';
import { consolidate } from './consolidate.mjs';

process.umask(0o077);
const args=options(process.argv.slice(2));const rt=runtime(args);
try {
  let result;
  switch(args.positional[0]) {
    case 'status':result=rt.ledger.status();break;
    case 'pause':rt.ledger.enable(false);result={uploads_enabled:false};break;
    case 'enable':rt.ledger.enable(true);result={uploads_enabled:true};break;
    case 'flush': {
      result=[];
      for(const {route_id} of rt.ledger.db.prepare("SELECT DISTINCT route_id FROM events WHERE status!='sent'").all()) {
        const route=rt.ledger.get(route_id);
        try{result.push({route_id,...await deliver(rt.ledger,rt.registry,route,rt.api(route))});}
        catch(e){result.push({route_id,error:errorText(e)});}
      }
      break;
    }
    case 'resolve':result=resolveProject(rt.registry,args.positional[1]??process.cwd());break;
    case 'consolidate':result=await consolidate(rt,{apply:!!args.apply,profile:args.profile});break;
    case 'doctor': {
      result={};
      for(const [name,profile] of Object.entries(rt.registry.profiles)) {
        try{result[name]={status:'healthy',...await new HonchoAPI(profile).probe()};}
        catch(e){result[name]={status:'unavailable',reason:errorText(e)};}
      }
      break;
    }
    case 'inventory': {
      if(!args.manifest)throw new Error('inventory requires --manifest path');
      const data=await inventory(rt.registry);mkdirSync(dirname(args.manifest),{recursive:true,mode:0o700});writeFileSync(args.manifest,JSON.stringify(data,null,2)+'\n',{mode:0o600});
      result={manifest:args.manifest,counts:data.entries.reduce((a,e)=>{const key=(e.profile??'unknown')+':'+e.status;a[key]=(a[key]??0)+1;return a;},{})};break;
    }
    case 'recover': {
      if(!args.manifest||!args.report)throw new Error('recover requires --manifest and --report');
      const data=await recover(rt,JSON.parse(readFileSync(args.manifest)),{apply:!!args.apply,profile:args.profile,reportPath:args.report});
      result={report:args.report,profiles:data.profiles,conversations:data.entries.reduce((a,e)=>{a[e.status]=(a[e.status]??0)+1;return a;},{}),messages:Object.fromEntries(['missing','present','ambiguous','verified'].map(k=>[k,data.entries.reduce((total,e)=>total+(e[k]??0),0)]))};break;
    }
    default:throw new Error('Commands: doctor, status, resolve [cwd], pause, enable, flush, consolidate [--profile AREA] [--apply], inventory --manifest PATH, recover --manifest PATH --report PATH [--profile AREA] [--apply]');
  }
  console.log(JSON.stringify(result,null,2));
}catch(e){console.error(errorText(e));process.exitCode=1;}finally{rt.ledger.close();}
