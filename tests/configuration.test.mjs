import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadRegistry, validateRegistry, resolveProject } from '../src/config.mjs';
import { runtime } from '../src/runtime.mjs';
import { inventory } from '../src/recovery.mjs';
import { handleHook } from '../src/hook.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const example=JSON.parse(readFileSync(new URL('../config/profiles.example.json',import.meta.url)));
const registry=()=>({...structuredClone(example),captureFrom:'2026-09-23T00:00:00Z'});

test('null default silently skips unassigned conversations in both clients without capture or API calls',async()=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'honcho-work-only-')));
  try {
    const input=registry();input.defaultProfile=null;
    input.profiles={projecta:structuredClone(input.profiles.main),projectb:structuredClone(input.profiles.main)};
    input.roots=['projecta','projectb'].map(profile=>({path:join(dir,profile),profile}));input.projects=[];
    const config=join(dir,'profiles.json');writeFileSync(config,JSON.stringify(input));
    const rt=runtime({config});
    try {
      for(const profile of ['projecta','projectb'])assert.equal(resolveProject(rt.registry,join(dir,profile)).profile,profile);
      assert.throws(()=>resolveProject(rt.registry,join(dir,'personal')),{code:'HONCHO_UNASSIGNED'});
      let calls=0;rt.api=()=>{calls++;throw new Error('Unexpected remote request');};rt.ledger.enable(true);
      for(const client of ['codex','claude'])for(const hook_event_name of ['SessionStart','UserPromptSubmit','PostToolUse','Stop','PreCompact']) {
        const hookInput={session_id:'unmatched-session',cwd:join(dir,'personal'),hook_event_name};
        const result=await handleHook(rt,client,hookInput);
        assert.deepEqual(result,{skipped:true,status:'unassigned',context:''});
        assert.equal(rt.ledger.find(client,'unmatched-session'),undefined);
        const child=spawnSync(process.execPath,[resolve('src/hook.mjs'),'--config',config,'--client',client],{input:JSON.stringify(hookInput),encoding:'utf8'});
        assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'');
      }
      assert.equal(calls,0);
      assert.equal(rt.ledger.db.prepare('SELECT count(*) AS count FROM events').get().count,0);
      assert.equal(rt.ledger.db.prepare('SELECT count(*) AS count FROM diagnostics').get().count,0);

      // A new assignment is picked up on the next hook without reinstalling.
      rt.ledger.enable(false);input.roots.push({path:join(dir,'personal'),profile:'projecta'});
      writeFileSync(config,JSON.stringify(input));
      const active=JSON.parse(execFileSync(process.execPath,[resolve('src/hook.mjs'),'--config',config,'--client','codex'],{input:JSON.stringify({session_id:'unmatched-session',cwd:join(dir,'personal'),hook_event_name:'SessionStart'}),encoding:'utf8'}));
      assert.match(active.hookSpecificOutput.additionalContext,/<honcho-route>/);
    } finally {rt.ledger.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('silent unassigned hooks preserve warnings for pinned conversations and routing conflicts',async()=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'honcho-hook-warning-')));
  const input=registry();input.defaultProfile=null;input.roots=[{path:join(dir,'assigned'),profile:'main'}];
  const config=join(dir,'profiles.json');writeFileSync(config,JSON.stringify(input));
  const rt=runtime({config});
  try {
    for(const client of ['codex','claude']) {
      const hookInput={session_id:'existing-session',cwd:join(dir,'assigned'),hook_event_name:'SessionStart'};
      const assigned=await handleHook(rt,client,hookInput);assert.match(assigned.context,/<honcho-route>/);
      rt.registry.roots=[];
      const removed=await handleHook(rt,client,hookInput);
      assert.equal(removed.failed,true);assert.match(removed.context,/Honcho memory unavailable: No Honcho workspace assigned/);
      rt.registry.roots=input.roots;
      const moved=await handleHook(rt,client,{...hookInput,cwd:join(dir,'unassigned')});
      assert.equal(moved.failed,true);assert.equal(moved.skipped,undefined);
    }
    rt.registry.profiles.other=structuredClone(rt.registry.profiles.main);
    rt.registry.roots.push({path:join(dir,'assigned'),profile:'other'});
    const conflict=await handleHook(rt,'codex',{session_id:'conflict-session',cwd:join(dir,'assigned'),hook_event_name:'SessionStart'});
    assert.equal(conflict.failed,true);assert.match(conflict.context,/Conflicting Honcho project assignments/);
  } finally {rt.ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test('registry resolves portable paths and arbitrary defaults, preserving pinned identities',()=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'honcho-config-')));
  try {
    const input=registry();input.profiles.main.user='another-user';input.roots=[{path:'~/work',profile:'main'}];
    const config=join(dir,'profiles.json');
    const data=validateRegistry(input,config,dir);
    assert.equal(data.roots[0].path,join(dir,'work'));
    assert.equal(data.profiles.main.credentialFile,join(dir,'credentials/primary.json'));
    assert.equal(data.installation.codexHome,join(dir,'.codex'));
    writeFileSync(config,JSON.stringify(data));
    const rt=runtime({config});
    try {
      assert.equal(rt.ledger.dir,join(dir,'state'));
      const project=resolveProject(rt.registry,join(dir,'unknown'));
      assert.equal(project.profile,'main');
      const route=rt.ledger.bind(rt.registry,'codex','new-conversation',project);
      assert.equal(route.identity.user,'another-user');
      rt.registry.profiles.main.user='changed-user';
      assert.throws(()=>rt.ledger.validate(rt.registry,route),/changed/);
    } finally {rt.ledger.close();}
    for (const modify of [r=>r.defaultProfile='missing',r=>r.roots=[{path:dir,profile:'missing'}],r=>r.recovery.codexQueueDirs='bad',r=>r.installation.codexHome='',r=>r.profiles.main.endpoint='http://example.com',r=>r.redactPatterns=['[']]) {
      const invalid=registry();modify(invalid);assert.throws(()=>validateRegistry(invalid,config));
    }
    const legacy=registry();legacy.profiles.personal=legacy.profiles.main;delete legacy.profiles.main;delete legacy.defaultProfile;
    assert.throws(()=>validateRegistry(legacy,config),/incomplete Honcho profile registry/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('custom client installation shares config and state across hooks and MCP, and rolls back',async()=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'honcho setup ')));
  const config=join(dir,'custom registry.json'),input=registry();
  input.profiles.main.user='fixture-user';
  input.installation={codexHome:'./clients/codex',claudeHome:'./clients/claude',claudeConfigFile:'./clients/claude.json'};
  delete input.captureFrom;
  const original=JSON.stringify(input);writeFileSync(config,original);
  const run=(...args)=>JSON.parse(execFileSync('python3',[resolve('scripts/install.py'),'--home',dir,'--config',config,'--node',process.execPath,...args],{encoding:'utf8',cwd:'/'}));
  try {
    assert.equal(run().applied,false);assert.equal(readFileSync(config,'utf8'),original);assert.ok(!existsSync(join(dir,'clients')));
    const installed=run('--apply');assert.equal(installed.applied,true);
    const data=loadRegistry(config);assert.ok(Number.isFinite(Date.parse(data.captureFrom)));
    assert.equal(data.profiles.main.user,'fixture-user');
    assert.deepEqual(run('--apply').changed,[]);
    assert.ok(!existsSync(join(dir,'.codex')));
    const hooksPath=join(dir,'clients/codex/hooks.json');
    const hooks=JSON.parse(readFileSync(hooksPath));
    const command=hooks.hooks.SessionStart[0].hooks[0].command;
    const result=JSON.parse(execFileSync('/bin/sh',['-c',command],{input:JSON.stringify({session_id:'custom-session',cwd:dir,hook_event_name:'SessionStart'}),encoding:'utf8',cwd:'/'}));
    assert.match(result.hookSpecificOutput.additionalContext,/workspace=your-workspace; user=fixture-user/);
    const claude=JSON.parse(readFileSync(join(dir,'clients/claude.json'))).mcpServers.honcho;
    const client=new Client({name:'configuration-test',version:'1'},{capabilities:{}});
    try {
      await client.connect(new StdioClientTransport({command:claude.command,args:claude.args,cwd:'/',stderr:'pipe'}));
      assert.equal((await client.listTools()).tools.length,16);
    } finally {await client.close();}
    const rt=runtime({config});
    try {assert.equal(rt.ledger.get(rt.ledger.find('codex','custom-session').id).identity.user,'fixture-user');} finally {rt.ledger.close();}
    // A relocated checkout's previous hook still belongs to this explicit config.
    hooks.hooks.SessionStart[0].hooks[0].command=command.replace(resolve('src/hook.mjs'),"'/old checkout/src/hook.mjs'");
    writeFileSync(hooksPath,JSON.stringify(hooks));run('--apply');
    assert.equal(JSON.parse(readFileSync(hooksPath)).hooks.SessionStart.length,1);
    run('--rollback',installed.backup);
    assert.equal(readFileSync(config,'utf8'),original);
    assert.ok(existsSync(join(dir,'state/ledger.sqlite')));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('recovery inventories configured queue and transcript directories',async()=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'honcho-recovery-')));
  try {
    const input=registry();input.roots=[{path:'./project',profile:'main'}];
    input.recovery={codexQueueDirs:['./old queues'],codexTranscriptDirs:['./transcripts'],claudeTranscriptDirs:[]};
    const config=join(dir,'profiles.json');writeFileSync(config,JSON.stringify(input));
    for(const name of ['old queues','transcripts','project'])mkdirSync(join(dir,name));
    writeFileSync(join(dir,'old queues/session.jsonl'),'{}');
    writeFileSync(join(dir,'transcripts/session.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'session',cwd:join(dir,'project')}})+'\n');
    const data=loadRegistry(config),report=await inventory(data,dir);
    assert.equal(report.entries.length,1);assert.equal(report.entries[0].profile,'main');assert.equal(report.entries[0].status,'ready');
    data.recovery.codexQueueDirs=[];assert.equal((await inventory(data,dir)).entries.length,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
