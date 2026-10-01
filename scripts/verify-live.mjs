// Creates twelve labeled, non-reasoning verification messages. Retains them as
// receipts; never deletes remote history. Run only for an authorized live check.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runtime, options } from '../src/runtime.mjs';
import { resolveProject,digest,defaultConfigPath } from '../src/config.mjs';
import { HonchoAPI,errorText } from '../src/api.mjs';
import { deliver } from '../src/delivery.mjs';
import { handleHook } from '../src/hook.mjs';

process.umask(0o077);
const args=options(process.argv.slice(2));
const runtimeArgs=['--config',resolve(args.config ?? defaultConfigPath()),...(args.state?['--state',resolve(args.state)]:[])];
const rt=runtime(args);const report={at:new Date().toISOString(),checks:[]};
try {
  for(const profile of Object.keys(rt.registry.profiles))for(const client of ['codex','claude']) {
    const cwd=(rt.registry.roots ?? []).find(r=>r.profile===profile)?.path ?? (rt.registry.projects ?? []).find(r=>r.profile===profile)?.path;
    if (!cwd) throw new Error('Live verification requires a configured root or project for ' + profile);
    const nativeId=`verify-20260922-${profile}-${client}`;
    const route=rt.ledger.bind(rt.registry,client,nativeId,resolveProject(rt.registry,cwd));
    const events=['user','assistant'].map(role=>({id:digest(route.id+':verification:'+role),role,content:`Honcho integration verification: ${profile}/${client}/${role}. Test receipt only; no user preference.`,at:route.created_at,metadata:{verification:true}}));
    rt.ledger.enqueue(route,events);
    await deliver(rt.ledger,rt.registry,route,rt.api(route),{allowPaused:true});
    const remote=await rt.api(route).messages(route.remote_session);
    assert.ok(events.every(e=>remote.some(m=>m.metadata?.honcho_source_id===e.id&&m.peerId===(e.role==='user'?rt.registry.profiles[profile].user:client))));
    for(const [other,p] of Object.entries(rt.registry.profiles))if(other!==profile)assert.ok((await new HonchoAPI(p).messages(route.remote_session)).every(m=>!events.some(e=>e.id===m.metadata?.honcho_source_id)));
    const transport=new StdioClientTransport({command:process.execPath,args:[resolve('src/bridge.mjs'),'--client',client,...runtimeArgs],cwd:'/',env:{...process.env,HONCHO_API_KEY:'ignored-ambient-key',HONCHO_WORKSPACE:'wrong-workspace'},stderr:'pipe'});
    const mcp=new Client({name:'honcho-live-verification',version:'1'},{capabilities:{}});
    try {
      await mcp.connect(transport);
      const call=async(name,args={})=>{const response=await mcp.callTool({name,arguments:{route_id:route.id,...args}});assert.ok(!response.isError,response.content?.[0]?.text);return JSON.parse(response.content[0].text);};
      assert.equal((await call('status')).workspace,profile);
      assert.equal((await call('inspect_session')).id,route.remote_session);
      assert.ok((await call('get_session_messages')).items.length>0);
      await call('get_peer_context');
      const conflict=await mcp.callTool({name:'status',arguments:{route_id:route.id,workspace_id:'wrong'}});assert.equal(conflict.isError,true);
    }finally{await mcp.close();}
    // Exercise normal adapters without enabling unrelated pending uploads yet.
    const ledger=Object.create(rt.ledger);ledger.enabled=()=>true;
    for(const hook_event_name of ['SessionStart','UserPromptSubmit']) {
      const result=await handleHook({...rt,ledger},client,{cwd,session_id:nativeId,hook_event_name,prompt:'Check the Honcho route assigned to this verification conversation.'});
      assert.ok(!result.failed,result.status);assert.ok(result.context.includes(`workspace=${profile}`));
    }
    report.checks.push({client,profile,route_id:route.id,status:'passed',remote_receipts:remote.length,receipts_absent_from_other_areas:true,stdio:true,recall_hooks:true});
    writeFileSync(join(rt.ledger.dir,'live-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(report.checks.at(-1)));
  }
}catch(e){report.error=errorText(e);console.error(report.error);process.exitCode=1;}
finally{writeFileSync(join(rt.ledger.dir,'live-verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});rt.ledger.close();}
