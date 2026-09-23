import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadRegistry, validateRegistry, resolveProject } from '../src/config.mjs';
import { runtime } from '../src/runtime.mjs';
import { inventory } from '../src/recovery.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const example=JSON.parse(readFileSync(new URL('../config/profiles.example.json',import.meta.url)));
const registry=()=>({...structuredClone(example),captureFrom:'2026-09-23T00:00:00Z'});

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
