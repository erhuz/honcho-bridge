import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/ledger.mjs';
import { resolveProject } from '../src/config.mjs';
import { consolidate } from '../src/consolidate.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'honcho-consolidation-')),cwd=join(dir,'honcho-bridge');
  const registry={defaultProfile:'fixture',profiles:{fixture:{account:'fixture',workspace:'fixture',user:'user',endpoint:'https://example.test',credentialFile:'unused'}}};
  const ledger=new Ledger(join(dir,'state'));
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
  const routes=['claude','codex'].map((client,index)=>{
    const route=ledger.bind(registry,client,'existing-chat',resolveProject(registry,cwd));
    ledger.db.prepare('UPDATE routes SET remote_session=? WHERE id=?').run(`previous-session-${index}`,route.id);
    return ledger.get(route.id);
  });
  const sessions=new Map();let calls=0,writes=0,fail;
  for(const route of routes) {
    const event={id:route.id+'-event',role:'user',content:'Original history',at:'2026-09-23T01:02:03.456Z'};
    ledger.enqueue(route,[event]);ledger.mark(event.id,'sent',[route.id+'-receipt']);
    sessions.set(route.remote_session,[{id:route.id+'-receipt',content:event.content,peerId:'user',createdAt:event.at,metadata:{honcho_source_id:event.id,honcho_route_id:route.id}}]);
  }
  const api={messages:async(id,filters)=>{calls++;return structuredClone((sessions.get(id)??[]).filter(m=>!filters || filters.OR.some(f=>
    (f.metadata.honcho_consolidated_from && m.metadata.honcho_consolidated_from?.session===f.metadata.honcho_consolidated_from.session) ||
    f.metadata.honcho_source_id?.in.includes(m.metadata.honcho_source_id))));},ensure:async route=>{
    calls++;if(!sessions.has(route.remote_session))sessions.set(route.remote_session,[]);
    return {addPeers:async()=>{},addMessages:async messages=>{
      writes++;if(fail==='reject'){fail=null;throw Object.assign(new Error('rejected'),{status:401});}
      const receipts=messages.map((m,i)=>({...m,id:`copy-${writes}-${i}`}));
      sessions.get(route.remote_session).push(...(fail==='partial'?receipts.slice(0,1):receipts));
      if(fail){fail=null;throw new Error('lost response');}return receipts;
    }};
  }};
  return {dir,registry,ledger,routes,sessions,api:()=>api,stats:()=>({calls,writes}),fail:kind=>{fail=kind;}};
}

test('consolidation preview is local and apply requires paused uploads',async t=>{
  const f=fixture(t);f.ledger.enable(true);
  const preview=await consolidate(f);
  assert.deepEqual(preview.sessions.map(s=>s.target),['honcho-bridge','honcho-bridge']);
  assert.equal(preview.backup,undefined);assert.deepEqual(f.stats(),{calls:0,writes:0});
  await assert.rejects(consolidate(f,{apply:true}),/Pause uploads/);
  assert.deepEqual(f.stats(),{calls:0,writes:0});
});

test('consolidation preserves all authors and timestamps, verifies history, and moves receipts once',async t=>{
  const f=fixture(t),route=f.routes[0];
  f.sessions.get(route.remote_session).push({id:'other-client-message',content:'History from another client',peerId:'other-client',createdAt:'2026-09-23T02:00:00.000Z',metadata:{custom:'retained'}});
  f.ledger.enqueue(route,[{id:'pending-event',role:'assistant',content:'Not uploaded yet',at:'2026-09-23T03:00:00.000Z'}]);
  const before=structuredClone([...f.sessions]);
  const report=await consolidate(f,{apply:true});
  assert.equal(statSync(report.backup).mode&0o777,0o600);
  assert.deepEqual(report.sessions.map(s=>s.status),['verified','verified']);
  for(const [id,messages] of before)assert.deepEqual(f.sessions.get(id),messages);
  const merged=f.sessions.get('honcho-bridge');assert.equal(merged.length,3);
  for(const original of before.flatMap(([,messages])=>messages)) {
    const copy=merged.find(m=>m.metadata.honcho_consolidated_from.message===original.id);
    assert.equal(copy.peerId,original.peerId);assert.equal(copy.content,original.content);assert.equal(copy.createdAt,original.createdAt);
    assert.deepEqual(copy.configuration,{reasoning:{enabled:false}});
  }
  for(const r of f.routes) {
    assert.equal(f.ledger.get(r.id).remote_session,'honcho-bridge');
    const receipt=JSON.parse(f.ledger.db.prepare('SELECT receipts FROM events WHERE id=?').get(r.id+'-event').receipts)[0];
    assert.ok(merged.some(m=>m.id===receipt));
    assert.equal(f.ledger.bind(f.registry,r.client,r.native_id,resolveProject(f.registry,r.cwd)).remote_session,'honcho-bridge');
  }
  assert.equal(f.ledger.pending(route.id)[0].id,'pending-event');
  const stats=f.stats();assert.deepEqual((await consolidate(f,{apply:true})).sessions,[]);assert.deepEqual(f.stats(),stats);
});

test('a lost migration response is settled by read-back without copying twice',async t=>{
  const f=fixture(t);f.fail('lost');
  await assert.rejects(consolidate(f,{apply:true}),/lost response/);
  assert.equal(f.ledger.get(f.routes[0].id).remote_session,'honcho-bridge');
  await consolidate(f,{apply:true});
  assert.equal(f.sessions.get('honcho-bridge').length,2);assert.equal(f.stats().writes,2);
  assert.equal(f.ledger.db.prepare("SELECT count(*) AS count FROM operations WHERE state='uncertain'").get().count,0);
});

test('partial uncertain copies refuse replay after direct project cutover',async t=>{
  const f=fixture(t),route=f.routes[0];
  f.sessions.get(route.remote_session).push({id:'second-message',content:'Second',peerId:'claude',createdAt:'2026-09-23T02:00:00.000Z',metadata:{}});
  f.fail('partial');await assert.rejects(consolidate(f,{apply:true}),/lost response/);
  await assert.rejects(consolidate(f,{apply:true}),/uncertain/);
  assert.equal(f.stats().writes,1);assert.equal(f.ledger.get(route.id).remote_session,'honcho-bridge');
});

test('definitive migration rejections can resume after the cause is resolved',async t=>{
  const f=fixture(t);f.fail('reject');await assert.rejects(consolidate(f,{apply:true}),/rejected/);
  await consolidate(f,{apply:true});assert.equal(f.sessions.get('honcho-bridge').length,2);
});

test('missing original receipts, active delivery and changed identities stop migration',async t=>{
  const f=fixture(t),route=f.routes[0],release=f.ledger.lock(route.id);
  await assert.rejects(consolidate(f,{apply:true}),/upload is active/);release();
  f.sessions.set(route.remote_session,[]);
  await assert.rejects(consolidate(f,{apply:true}),/no original receipt/);assert.equal(f.stats().writes,0);
  f.registry.profiles.fixture.workspace='changed';
  await assert.rejects(consolidate(f,{apply:true}),/destination changed/);
  assert.equal(f.ledger.get(route.id).remote_session,'honcho-bridge');
});
