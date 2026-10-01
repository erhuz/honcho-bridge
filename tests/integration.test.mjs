import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Ledger } from '../src/ledger.mjs';
import { resolveProject, normalizeRemote } from '../src/config.mjs';
import { parseTranscript } from '../src/capture.mjs';
import { deliver } from '../src/delivery.mjs';
import { callMemory } from '../src/bridge.mjs';
import { handleHook } from '../src/hook.mjs';
import { compareHistory } from '../src/recovery.mjs';
import { HonchoAPI } from '../src/api.mjs';
import { SessionIdSchema } from '@honcho-ai/sdk/dist/validation.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function fixture() {
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'honcho-test-')));
  const profiles=Object.fromEntries(['personal','team_a','team_b'].map(name=>[name,{account:name==='personal'?'personal':'work',workspace:name,user:'fixture-user',endpoint:'https://api.honcho.dev/v3',credentialFile:join(dir,name+'.json')}]));
  const registry={version:1,defaultProfile:'personal',captureFrom:'2026-09-22T00:00:00Z',profiles,roots:['personal','team_a','team_b'].map(profile=>({profile,path:join(dir,profile)})),projects:[]};
  for(const p of registry.roots)mkdirSync(p.path);
  const ledger=new Ledger(join(dir,'state'));
  const project=name=>resolveProject(registry,join(dir,name));
  const route=(client='codex',name='team_a',id='test-session')=>ledger.bind(registry,client,id,project(name));
  return {dir,registry,ledger,project,route};
}
const event=(id='event-one')=>({id,role:'user',content:'A stable preference',at:'2026-09-22T10:00:00Z',metadata:{}});

test('unknown folders default personal; same basenames do not choose company',()=>{
  const f=fixture();assert.equal(resolveProject(f.registry,join(f.dir,'elsewhere/team_a')).profile,'personal');f.ledger.close();
});
test('worktrees and registered remotes retain their area; conflicts fail',()=>{
  const f=fixture(),repo=join(f.dir,'team_b/repo'),tree=join(f.dir,'elsewhere');mkdirSync(repo);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{stdio:'pipe'});
  git('init');git('-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-m','fixture');git('worktree','add',tree);
  assert.equal(resolveProject(f.registry,tree).profile,'team_b');
  assert.equal(resolveProject(f.registry,tree).directory,repo);
  const nested=join(repo,'src');mkdirSync(nested);
  assert.equal(resolveProject(f.registry,nested).directory,repo);
  git('remote','add','origin','git@example.test:company/repo.git');
  f.registry.projects=[{id:'registered',path:repo,remote:'example.test/company/repo',profile:'team_a'}];
  assert.throws(()=>resolveProject(f.registry,tree),/Conflicting/);
  assert.equal(normalizeRemote('https://name:secret@example.test/company/repo.git'),'example.test/company/repo');f.ledger.close();
});
test('pin survives unknown cwd; rejects known other area and changed identity',()=>{
  const f=fixture(),r=f.route();assert.equal(f.ledger.bind(f.registry,'codex','test-session',resolveProject(f.registry,f.dir)).id,r.id);
  assert.throws(()=>f.ledger.bind(f.registry,'codex','test-session',f.project('team_b')),/conflict/);
  f.registry.profiles.team_a.workspace='changed';assert.throws(()=>f.ledger.validate(f.registry,r),/changed/);f.ledger.close();
});
test('two clients and two concurrent instances never share route state',()=>{
  const f=fixture();const routes=[f.route(),f.route('claude'),f.route('codex','team_b','another-thread')];
  assert.equal(new Set(routes.map(r=>r.remote_session)).size,3);
  const second=new Ledger(join(f.dir,'state'));const release=f.ledger.lock(routes[0].id);assert.equal(second.lock(routes[0].id),null);release();assert.ok(second.lock(routes[0].id));second.close();f.ledger.close();
});
test('sessions use readable project names and UTC time while preserving unique pinned destinations',t=>{
  const f=fixture();t.after(()=>f.ledger.close());
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-01T12:34:56.789Z')});
  const first=f.route(),second=f.route('codex','team_a','second-chat'),claude=f.route('claude');
  assert.equal(first.remote_session,'team_a-codex-2026-10-01T12-34-56-789Z');
  assert.equal(second.remote_session,first.remote_session+'-2');
  assert.equal(claude.remote_session,'team_a-claude-2026-10-01T12-34-56-789Z');
  const other=new Ledger(join(f.dir,'state'));t.after(()=>other.close());
  const third=other.bind(f.registry,'codex','third-chat',f.project('team_a'));
  assert.equal(third.remote_session,first.remote_session+'-3');
  assert.equal(other.bind(f.registry,'codex',first.native_id,resolveProject(f.registry,f.dir)).remote_session,first.remote_session);
  const legacy=other.bind(f.registry,'codex','legacy-chat',f.project('team_a'),{remoteSession:'codex-existing-hash'});
  assert.equal(f.ledger.bind(f.registry,'codex','legacy-chat',f.project('team_a')).remote_session,legacy.remote_session);
});
test('session labels use the primary directory and satisfy Honcho identifier rules',t=>{
  const f=fixture();t.after(()=>f.ledger.close());
  for(const [index,name] of ['My App','Ångström & café','项目'].entries()) {
    const route=f.ledger.bind(f.registry,'codex',`label-chat-${index}`,{...f.project('team_a'),directory:join(f.dir,name),cwd:join(f.dir,name,'src')});
    const expected=['my-app','angstrom-cafe','project'][index];
    assert.ok(route.remote_session.startsWith(`${expected}-codex-`));
    assert.equal(SessionIdSchema.parse(route.remote_session),route.remote_session);
  }
});
test('capture omits reasoning, tool results and injected turns; stable across repeats',()=>{
  const raw=['analysis','commentary','final'].map(channel=>JSON.stringify({type:'response_item',timestamp:'2026-09-22T10:00:00Z',payload:{type:'message',role:'assistant',channel,content:[{type:'output_text',text:channel}]}})).join('\n');
  const parsed=parseTranscript('codex','test-session',raw);assert.deepEqual(parsed.map(e=>e.content),['commentary','final']);assert.deepEqual(parsed,parseTranscript('codex','test-session',raw+'\n{"partial"'));
  const claude=JSON.stringify({type:'assistant',uuid:'stable',timestamp:'2026-09-22T10:00:00Z',message:{role:'assistant',content:[{type:'thinking',thinking:'private'},{type:'tool_result',content:'secret'},{type:'text',text:'public'}]}});
  assert.deepEqual(parseTranscript('claude','test-session',claude).map(e=>e.content),['public']);
});
test('capture does not replay pre-cutover transcript',async()=>{
  const f=fixture(),path=join(f.dir,'transcript.jsonl');
  writeFileSync(path,['2026-09-21T10:00:00Z','2026-09-22T10:00:00Z'].map(timestamp=>JSON.stringify({type:'response_item',timestamp,payload:{type:'message',role:'user',content:'hello'}})).join('\n'));
  const rt={...f,api:()=>{throw new Error('must not call while paused');}};
  const result=await handleHook(rt,'codex',{cwd:join(f.dir,'team_b'),session_id:'test-session',transcript_path:path,hook_event_name:'UserPromptSubmit'});
  assert.equal(result.failed,undefined);assert.match(result.context,/workspace=team_b/);assert.equal(f.ledger.pending(result.route.id).length,1);f.ledger.close();
});
test('lost upload response is resolved by receipt without a duplicate send',async()=>{
  const f=fixture(),r=f.route();f.ledger.enable(true);f.ledger.enqueue(r,[event()]);let remote=[],calls=0;
  const api={ensure:async()=>{},messages:async()=>remote,add:async(_r,events)=>{calls++;remote=events.map(e=>({id:'remote-id',content:e.content,peerId:'fixture-user',createdAt:e.created_at,metadata:{honcho_source_id:e.id}}));throw new Error('connection lost after commit');}};
  await assert.rejects(deliver(f.ledger,f.registry,r,api),/connection lost/);assert.equal(f.ledger.pending(r.id)[0].status,'uncertain');
  assert.equal((await deliver(f.ledger,f.registry,r,api)).verified,1);assert.equal(calls,1);assert.equal(f.ledger.pending(r.id).length,0);f.ledger.close();
});
test('uncertain absent receipt is quarantined; definitive authentication failure remains pending',async()=>{
  const f=fixture(),r=f.route();f.ledger.enable(true);f.ledger.enqueue(r,[event()]);let calls=0;
  const api={ensure:async()=>{},messages:async()=>[],add:async()=>{calls++;const e=new Error('rejected');e.status=401;throw e;}};
  await assert.rejects(deliver(f.ledger,f.registry,r,api));assert.equal(f.ledger.pending(r.id)[0].status,'pending');
  f.ledger.mark('event-one','uncertain');assert.equal((await deliver(f.ledger,f.registry,r,api)).uncertain,1);assert.equal(calls,1);f.ledger.close();
});
test('successful recall cannot hide an uncertain upload',async()=>{
  const f=fixture(),r=f.route();f.ledger.enable(true);f.ledger.enqueue(r,[event()]);f.ledger.mark('event-one','uncertain');
  const rt={...f,api:()=>({ensure:async()=>{},messages:async()=>[],readPeer:()=>({context:async()=>({representation:'available context'})})})};
  const result=await handleHook(rt,'codex',{cwd:r.cwd,session_id:r.native_id,hook_event_name:'UserPromptSubmit',prompt:'Recall previous decisions'});
  assert.match(result.status,/receipt review/);
  const status=await callMemory(rt,'codex','status',{route_id:r.id});assert.equal(status.uncertain,1);assert.match(status.diagnostic.status,/receipt review/);f.ledger.close();
});
test('bridge rejects missing route, other client and workspace conflict',async()=>{
  const f=fixture(),r=f.route();const rt={...f,api:()=>{throw new Error('unexpected remote request');}};
  await assert.rejects(callMemory(rt,'codex','status',{}),/route_id/);
  await assert.rejects(callMemory(rt,'claude','status',{route_id:r.id}),/another client/);
  await assert.rejects(callMemory(rt,'codex','status',{route_id:r.id,workspace_id:'team_b'}),/conflicts/);
  assert.equal((await callMemory(rt,'codex','status',{route_id:r.id})).workspace,'team_a');f.ledger.close();
});
test('read handles avoid create calls and validate identifiers before HTTP',async()=>{
  const f=fixture();writeFileSync(f.registry.profiles.personal.credentialFile,JSON.stringify({apiKey:'fixture'}));
  const api=new HonchoAPI(f.registry.profiles.personal);const calls=[];
  api.http.get=async path=>{calls.push(path);return {peer_id:'fixture-user',target_id:'fixture-user',representation:'',peer_card:[]};};
  api.http.post=async path=>{calls.push(path);return {items:[],total:0,page:1,pages:1};};
  await api.readPeer('fixture-user').context();await api.messages('missing-session');
  assert.deepEqual(calls,['/v3/workspaces/personal/peers/fixture-user/context','/v3/workspaces/personal/sessions/missing-session/messages/list']);
  assert.throws(()=>api.readSession('../team_b'));assert.throws(()=>api.readPeer('foo/bar'));f.ledger.close();
});
test('recovery distinguishes exact receipt, changed timestamp and verified absence',()=>{
  const events=['exact','ambiguous','absent'].map((content,i)=>({...event(String(i)),content,metadata:{source_event_id:String(i)}}));
  const remote=[{id:'r1',peerId:'fixture-user',content:'exact',createdAt:events[0].at},{id:'r2',peerId:'fixture-user',content:'ambiguous',createdAt:'2026-09-22T10:01:00Z'}];
  assert.deepEqual(compareHistory(events,remote,'codex','fixture-user').map(e=>e.status),['present','ambiguous','missing']);
});
test('installed STDIO protocol publishes route requirement and returns pinned status',async()=>{
  const f=fixture(),r=f.route();const config=join(f.dir,'profiles.json');writeFileSync(config,JSON.stringify(f.registry));
  const client=new Client({name:'verification',version:'1'},{capabilities:{}});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('src/bridge.mjs'),'--client','codex','--config',config,'--state',join(f.dir,'state')],stderr:'pipe'});
  try{await client.connect(transport);const list=await client.listTools();assert.ok(list.tools.every(t=>t.inputSchema.required.includes('route_id')));
    const result=await client.callTool({name:'status',arguments:{route_id:r.id}});assert.equal(JSON.parse(result.content[0].text).workspace,'team_a');
    const rejected=await client.callTool({name:'status',arguments:{}});assert.equal(rejected.isError,true);
  }finally{await client.close();f.ledger.close();}
});
test('installer is idempotent, preserves unrelated hooks and supports guarded rollback',()=>{
  const f=fixture(),home=f.dir;mkdirSync(join(home,'.codex'));mkdirSync(join(home,'.claude'));
  const original=JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'unrelated'}]}]}});writeFileSync(join(home,'.codex/hooks.json'),original);
  const config=join(home,'profiles.json');writeFileSync(config,JSON.stringify(f.registry));
  const run=(...args)=>JSON.parse(execFileSync('python3',['scripts/install.py','--home',home,'--config',config,...args],{encoding:'utf8'}));
  const installed=run('--apply');assert.ok(installed.applied);assert.deepEqual(run('--apply').changed,[]);
  assert.match(readFileSync(join(home,'.codex/config.toml'),'utf8'),/tool_timeout_sec = 150/);
  assert.equal(JSON.parse(readFileSync(join(home,'.claude.json'))).mcpServers.honcho.timeout,150000);
  const claudePath=join(home,'.claude.json'),claudeBytes=readFileSync(claudePath);
  writeFileSync(claudePath,JSON.stringify(JSON.parse(claudeBytes)));assert.deepEqual(run().changed,[]);writeFileSync(claudePath,claudeBytes);
  const data=JSON.parse(readFileSync(join(home,'.codex/hooks.json')));assert.equal(data.hooks.Stop.length,2);
  run('--rollback',installed.backup);assert.equal(readFileSync(join(home,'.codex/hooks.json'),'utf8'),original);f.ledger.close();
});
