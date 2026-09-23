import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Ledger } from '../src/ledger.mjs';
import { HonchoAPI } from '../src/api.mjs';
import { callMemory } from '../src/bridge.mjs';
import { handleHook } from '../src/hook.mjs';

function fixture(t,client='codex') {
  const dir=mkdtempSync('/tmp/honcho-compat-');
  const profile={account:'fixture',workspace:'fixture',user:'fixture-user',endpoint:'https://example.invalid/v3',credentialFile:dir+'/key.json'};
  writeFileSync(profile.credentialFile,JSON.stringify({apiKey:'fixture-key'}),{mode:0o600});
  const registry={profiles:{personal:profile},roots:[{path:dir,profile:'personal'}],projects:[]};
  const ledger=new Ledger(dir);t.after(()=>ledger.close());
  const route=ledger.bind(registry,client,'compat-session',{profile:'personal',project:'fixture',cwd:dir});
  ledger.enable(true);
  return {dir,profile,registry,ledger,route,api:(_route,options)=>new HonchoAPI(profile,options)};
}

test('session context reaches SDK HTTP with summary and no incomplete perspective',async t=>{
  for(const client of ['codex','claude']) {
    const f=fixture(t,client),api=f.api(f.route),calls=[];
    api.http.get=async(path,{query})=>{
      calls.push(path);assert.equal(query.summary,true);
      assert.equal(query.peer_perspective,undefined);assert.equal(query.peer_target,undefined);
      return {messages:[{id:'message',peer_id:'fixture-user',content:'public message',created_at:'2026-09-22T10:00:00Z',metadata:{}}],summary:{content:'earlier summary',message_id:'previous',summary_type:'long',created_at:'2026-09-22T10:00:00Z',token_count:3}};
    };
    api.http.post=async()=>{throw new Error('Read must not create records');};
    const value=await callMemory({...f,api:()=>api},client,'get_session_context',{route_id:f.route.id});
    const serialized=JSON.parse(JSON.stringify(value));
    assert.equal(serialized.messages[0].content,'public message');
    assert.equal(serialized.summary.content,'earlier summary');
    assert.deepEqual(calls,[`/v3/workspaces/fixture/sessions/${f.route.remote_session}/context`]);
  }
});

test('chat survives a nine-second response while automatic recall still stops at eight seconds',async t=>{
  const f=fixture(t);
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(new Response(JSON.stringify({content:'recalled answer'}))),9000);
    signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});
  }));
  const chat=callMemory(f,'codex','chat',{route_id:f.route.id,query:'Known preferences?',reasoning_level:'medium'});
  await new Promise(setImmediate);t.mock.timers.tick(9000);
  assert.equal(await chat,'recalled answer');
  const recall=handleHook(f,'codex',{cwd:f.dir,session_id:f.route.native_id,hook_event_name:'UserPromptSubmit',prompt:'Known preferences?'});
  await new Promise(setImmediate);t.mock.timers.tick(8000);
  const result=await recall;assert.equal(result.failed,true);assert.match(result.status,/timed out after 8000ms/);
});

test('chat aborts at 120 seconds without an SDK retry',async t=>{
  const f=fixture(t);let calls=0;
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>{
    calls++;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  }));
  const rejected=assert.rejects(callMemory(f,'codex','chat',{route_id:f.route.id,query:'Known preferences?'}),/timed out after 120000ms/);
  await new Promise(setImmediate);t.mock.timers.tick(120000);await rejected;assert.equal(calls,1);
});

test('definitive conclusion rejections retry explicitly and successful aliases stay deduplicated',async t=>{
  for(const client of ['codex','claude']) {
    const f=fixture(t,client),api=f.api(f.route);let status=null,calls=0;
    api.ensure=async()=>{};
    api.http.post=async(path,{body})=>{
      calls++;assert.equal(path,'/v3/workspaces/fixture/conclusions');
      assert.equal(body.conclusions[0].session_id,f.route.remote_session);
      assert.equal(body.conclusions[0].observer_id,'fixture-user');assert.equal(body.conclusions[0].observed_id,'fixture-user');
      if(status)throw Object.assign(new Error('rejection with private body'),{status});
      return body.conclusions.map(c=>({...c,id:'saved',created_at:'2026-09-22T10:00:00Z',level:'explicit'}));
    };
    const rt={...f,api:()=>api};
    for(const code of [400,401,403,404,413,422,429]) {
      status=code;const args={route_id:f.route.id,content:'Fixture conclusion '+code};
      await assert.rejects(callMemory(rt,client,'create_conclusions',args),e=>e.status===code);
      f.ledger.diagnostic(f.route.id,'healthy');
      const health=await callMemory(rt,client,'status',{route_id:f.route.id});
      assert.equal(health.pending,1);assert.equal(health.uncertain,0);assert.equal(health.conclusions.rejected,1);
      assert.match(health.diagnostic.status,/conclusion writes rejected/);
      assert.ok(f.ledger.status().operations.every(o=>!o.error.includes('private body')));
      status=null;const before=calls;
      const result=await callMemory(rt,client,'create_conclusions',args);assert.equal(result[0].id,'saved');
      assert.deepEqual(await callMemory(rt,client,'create_conclusion',args),result);assert.equal(calls,before+1);
      assert.equal(f.ledger.writeHealth(f.route.id).pending,0);
    }
  }
});

test('uncertain conclusion outcomes survive reopening and remain visible after successful recall',async t=>{
  const f=fixture(t);let calls=0;
  for(const [i,error] of [new Error('connection lost after commit'),new Error('Request timed out after 8000ms'),Object.assign(new Error('server error'),{status:500})].entries()) {
    await assert.rejects(f.ledger.once(f.route.id,'uncertain-'+i,async()=>{calls++;throw error;}));
  }
  await assert.rejects(f.ledger.once(f.route.id,'rejected',async()=>{throw Object.assign(new Error('rejected'),{status:429});}));
  const reopened=new Ledger(f.dir);t.after(()=>reopened.close());
  await assert.rejects(reopened.once(f.route.id,'uncertain-0',async()=>{calls++;}),/Previous write outcome is uncertain/);
  assert.equal(calls,3);
  const rt={...f,ledger:reopened,api:()=>({readPeer:()=>({context:async()=>({representation:'available'})})})};
  const recalled=await handleHook(rt,'codex',{cwd:f.dir,session_id:f.route.native_id,hook_event_name:'UserPromptSubmit'});
  assert.equal(recalled.failed,undefined);assert.match(recalled.status,/receipt review/);assert.match(recalled.status,/conclusion writes rejected/);
  const health=await callMemory(rt,'codex','status',{route_id:f.route.id});
  assert.equal(health.pending,4);assert.equal(health.uncertain,3);assert.deepEqual(health.conclusions,{rejected:1,uncertain:3});
  const other=reopened.bind(f.registry,'codex','other-session',{profile:'personal',project:'fixture',cwd:f.dir});
  assert.equal(reopened.writeHealth(other.id).pending,0);
});

test('concurrent conclusion claims send once and preserve the cached result',async t=>{
  const f=fixture(t),second=new Ledger(f.dir);t.after(()=>second.close());
  let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
  const first=f.ledger.once(f.route.id,'same-operation',async()=>{calls++;await gate;return [{id:'receipt'}];});
  await assert.rejects(second.once(f.route.id,'same-operation',async()=>{calls++;}),/Previous write outcome is uncertain/);
  release();const result=await first;
  assert.deepEqual(await second.once(f.route.id,'same-operation',async()=>{calls++;}),result);assert.equal(calls,1);
  await assert.rejects(second.once('another-route','same-operation',async()=>{}),/another route/);
});

test('migration preserves legacy receipts and reports unattributed uncertainty without guessing routes',async t=>{
  const dir=mkdtempSync('/tmp/honcho-migration-'),db=new DatabaseSync(dir+'/ledger.sqlite');
  db.exec('CREATE TABLE operations (id TEXT PRIMARY KEY,state TEXT NOT NULL,result TEXT)');
  db.prepare('INSERT INTO operations VALUES (?,?,?)').run('completed','done','[{"id":"receipt"}]');
  db.prepare('INSERT INTO operations VALUES (?,?,NULL)').run('unknown','uncertain');db.close();
  for(let i=0;i<2;i++) {
    const ledger=new Ledger(dir);
    try {
      assert.deepEqual(await ledger.once('some-route','completed',async()=>assert.fail('must reuse receipt')),[{id:'receipt'}]);
      await assert.rejects(ledger.once('some-route','unknown',async()=>assert.fail('must not replay')),/Previous write outcome is uncertain/);
      assert.deepEqual(JSON.parse(JSON.stringify(ledger.status().operations)),[{id:'unknown',route_id:null,state:'uncertain',error:null}]);
      assert.equal(ledger.db.prepare('SELECT count(*) AS n FROM operations').get().n,2);
    } finally {ledger.close();}
  }
});
