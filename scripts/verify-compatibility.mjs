// Read-only Honcho checks against existing verification sessions. No hooks,
// new conversations, test messages or conclusions are created by this script.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runtime, options } from '../src/runtime.mjs';
import { defaultConfigPath } from '../src/config.mjs';
import { toolDefinitions } from '../src/bridge.mjs';
import { errorText } from '../src/api.mjs';

process.umask(0o077);
const args=options(process.argv.slice(2));
const runtimeArgs=['--config',resolve(args.config ?? defaultConfigPath()),...(args.state?['--state',resolve(args.state)]:[])];
const rt=runtime(args),report={at:new Date().toISOString(),checks:[]};
const reportPath=join(rt.ledger.dir,'compatibility-verification.json');
const variants=[['status',{}],['search',{query:'Honcho integration verification',limit:2}],['get_peer_context',{max_conclusions:2}],['get_context',{max_conclusions:2}],['get_representation',{}],['chat',{query:'Answer briefly: what stable preferences are known about this user?',reasoning_level:'minimal'}],['list_conclusions',{size:2}],['query_conclusions',{query:'preferences',limit:2}],['list_peers',{size:2}],['list_sessions',{size:2}],['inspect_session',{}],['get_session_context',{}],['get_session_messages',{size:2}],['get_session_peers',{}]];
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
try {
  for(const client of ['codex','claude']) {
    const mcp=new Client({name:'honcho-compatibility-verification',version:'1'},{capabilities:{}});
    const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/bridge.mjs',import.meta.url)),'--client',client,...runtimeArgs],cwd:'/',stderr:'pipe',env:{...process.env,HONCHO_API_KEY:'ignored-ambient-key',HONCHO_WORKSPACE:'wrong-workspace'}});
    transport.stderr?.resume();
    try {
      await mcp.connect(transport);
      const {tools}=await mcp.listTools();
      assert.deepEqual(tools.map(t=>t.name).sort(),toolDefinitions.map(t=>t.name).sort());
      assert.ok(tools.every(t=>t.inputSchema.required.includes('route_id')));
      report.checks.push({client,kind:'catalog',ok:true,count:tools.length});
      for(const profile of Object.keys(rt.registry.profiles)) {
        const found=rt.ledger.db.prepare("SELECT id FROM routes WHERE client=? AND profile=? AND native_id LIKE 'verify-%' ORDER BY created_at DESC LIMIT 1").get(client,profile);
        assert.ok(found,`Missing existing verification session for ${client}/${profile}`);
        const route=rt.ledger.get(found.id);rt.ledger.validate(rt.registry,route);
        const check=async(name,args,kind='read')=>{
          const start=Date.now();let record;
          try {
            const result=await mcp.callTool({name,arguments:{route_id:route.id,...args}},undefined,{timeout:150000});
            if(result.isError)throw new Error(result.content[0].text);
            const value=JSON.parse(result.content[0].text);
            if(name==='status')assert.equal(value.workspace,profile);
            if(name==='get_session_context')assert.ok(value.messages.length>0);
            record={client,profile,kind,name,...(args.reasoning_level?{reasoning_level:args.reasoning_level}:{}),ok:true,ms:Date.now()-start};
          } catch(e) {record={client,profile,kind,name,...(args.reasoning_level?{reasoning_level:args.reasoning_level}:{}),ok:false,ms:Date.now()-start,error:errorText(e)};}
          report.checks.push(record);save();
          if(kind==='reasoning'||!record.ok)console.log(JSON.stringify(record));
        };
        for(let i=0;i<variants.length;i+=3)await Promise.all(variants.slice(i,i+3).map(([name,args])=>check(name,args)));
        const reads=report.checks.filter(r=>r.client===client&&r.profile===profile&&r.kind==='read');
        console.log(JSON.stringify({client,profile,reads:reads.length,passed:reads.filter(r=>r.ok).length}));
        if(profile===Object.keys(rt.registry.profiles).at(-1))for(const reasoning_level of ['low','medium','high','max'])await check('chat',{query:'Summarize the user\'s established preferences for infrastructure work, distinguishing recurring preferences from isolated decisions. Keep the answer brief and use only known information.',reasoning_level},'reasoning');
      }
    } finally {await mcp.close();}
  }
  if(report.checks.some(r=>!r.ok))process.exitCode=1;
} catch(e) {report.error=errorText(e);console.error(report.error);process.exitCode=1;}
finally {save();rt.ledger.close();console.log(JSON.stringify({report:reportPath,failed:report.checks.filter(r=>!r.ok).length}));}
