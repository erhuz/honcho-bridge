import { readdirSync, readFileSync, existsSync, createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { digest, resolveProject } from './config.mjs';
import { parseTranscript, originalCwd } from './capture.mjs';
import { redactSecrets } from '../dist/redact.mjs';
import { deliver } from './delivery.mjs';
import { errorText, HonchoAPI } from './api.mjs';

function files(dir,suffix='.jsonl') {
  if(!existsSync(dir))return [];
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name),suffix):e.name.endsWith(suffix)?[join(dir,e.name)]:[]);
}
async function firstRecord(path) {
  const stream=createReadStream(path);const lines=createInterface({input:stream,crlfDelay:Infinity});
  try {for await(const line of lines){try{return JSON.parse(line);}catch{}}}finally{lines.close();stream.destroy();}
}

export async function inventory(registry,home=homedir()) {
  const queues=new Map();
  for(const dir of registry.recovery?.codexQueueDirs ?? []) {
    for(const path of files(dir)) {
      const id=basename(path,'.jsonl');const list=queues.get(id)??[];list.push(path);queues.set(id,list);
    }
  }
  const transcripts=new Map();
  for(const path of (registry.recovery?.codexTranscriptDirs ?? [join(home,'.codex/sessions'), join(home,'.codex/archived_sessions')]).flatMap(dir=>files(dir))) {
    const first=await firstRecord(path);const id=first?.payload?.id??first?.payload?.session_id;
    if(id&&queues.has(id)) {
      const list=transcripts.get(id)??[];list.push(path);transcripts.set(id,list);
    }
  }
  const entries=[];
  for(const [nativeId,sources] of queues) {
    const paths=transcripts.get(nativeId)??[];
    if(paths.length!==1){entries.push({client:'codex',nativeId,sources,status:'ambiguous',reason:'missing or multiple source transcripts'});continue;}
    entries.push(describe(registry,'codex',nativeId,paths[0],sources));
  }
  for(const path of (registry.recovery?.claudeTranscriptDirs ?? [join(home,'.claude/projects')]).flatMap(dir=>files(dir))) {
    if(path.includes('/subagents/'))continue;
    const nativeId=basename(path,'.jsonl');
    if(!/^[a-f0-9-]{36}$/.test(nativeId))continue;
    entries.push(describe(registry,'claude',nativeId,path,[]));
  }
  return {version:1,createdAt:new Date().toISOString(),entries};
}
function describe(registry,client,nativeId,path,sources) {
  const entry={client,nativeId,path,sources};
  try {
    const raw=readFileSync(path,'utf8');const cwd=originalCwd(client,raw);
    if(!cwd)throw new Error('source transcript lacks original cwd');
    const project=resolveProject(registry,cwd);
    if(!project.recognized)throw new Error('legacy destination unknown; new-session fallback forbidden');
    const events=parseTranscript(client,nativeId,raw,registry.redactPatterns).filter(e=>Date.parse(e.at)<Date.parse(registry.captureFrom));
    return {...entry,cwd,profile:project.profile,project:project.project,eventsDigest:digest(JSON.stringify(events)),count:events.length,status:'ready'};
  } catch(e){return {...entry,status:'ambiguous',reason:errorText(e)};}
}

// Equal content with a different timestamp is ambiguous, not proof of absence.
// The old Claude prompt hook stamped upload time rather than transcript time.
export function compareHistory(events,remote,client,user,patterns=[]) {
  const byContent=new Map();
  for(const message of remote) {
    const key=digest(JSON.stringify([message.peerId,redactSecrets(message.content,patterns)]));
    const list=byContent.get(key)??[];list.push(message);byContent.set(key,list);
  }
  const counts=new Map();for(const e of events)counts.set(e.metadata.source_event_id,(counts.get(e.metadata.source_event_id)??0)+1);
  return events.map(event=>{
    if(counts.get(event.metadata.source_event_id)>1)return {event,status:'ambiguous',reason:'legacy chunk boundaries require review'};
    const matches=byContent.get(digest(JSON.stringify([event.role==='user'?user:client,event.content])))??[];
    const exact=matches.filter(m=>Date.parse(m.createdAt)===Date.parse(event.at));
    if(exact.length===1)return {event,status:'present',receipt:exact[0].id};
    if(matches.length)return {event,status:'ambiguous',reason:'matching text has different or duplicate remote timestamps'};
    return {event,status:'missing'};
  });
}

export async function recover(rt,manifest,{apply=false,profile,reportPath}={}) {
  const report={version:1,createdAt:new Date().toISOString(),apply,entries:[],profiles:{}};
  const remoteByProfile=new Map();
  const save=()=>{if(reportPath){mkdirSync(join(reportPath,'..'),{recursive:true,mode:0o700});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});}};
  // Read all sessions in each relevant destination. No candidate-name guess can
  // establish absence, because legacy naming strategies were inconsistent.
  for(const name of new Set(manifest.entries.filter(e=>e.status==='ready'&&(!profile||e.profile===profile)).map(e=>e.profile))) {
    try {
      const api=new HonchoAPI(rt.registry.profiles[name]);await api.probe();
      const sessions=await api.all('sessions');const messages=[];
      for(const session of sessions)messages.push(...await api.messages(session.id));
      remoteByProfile.set(name,messages);report.profiles[name]={sessions:sessions.length,messages:messages.length,status:'read-complete'};
    }catch(e){report.profiles[name]={status:'unavailable',reason:errorText(e)};}
    save();
  }
  for(const entry of manifest.entries) {
    if(profile&&entry.profile!==profile)continue;
    const result={client:entry.client,nativeId:entry.nativeId,profile:entry.profile,status:entry.status};
    report.entries.push(result);
    if(entry.status!=='ready'){result.reason=entry.reason;continue;}
    if(!remoteByProfile.has(entry.profile)){result.status='blocked';result.reason='destination history unavailable';continue;}
    try {
      const raw=readFileSync(entry.path,'utf8');
      const project=resolveProject(rt.registry,entry.cwd);
      if(project.profile!==entry.profile||!project.recognized)throw new Error('destination changed after inventory');
      const events=parseTranscript(entry.client,entry.nativeId,raw,rt.registry.redactPatterns).filter(e=>Date.parse(e.at)<Date.parse(rt.registry.captureFrom));
      if(digest(JSON.stringify(events))!==entry.eventsDigest)throw new Error('historical transcript changed after inventory; regenerate inventory');
      const compared=compareHistory(events,remoteByProfile.get(entry.profile),entry.client,rt.registry.profiles[entry.profile].user,rt.registry.redactPatterns);
      const missing=compared.filter(e=>e.status==='missing').map(e=>e.event);
      result.present=compared.filter(e=>e.status==='present').length;result.ambiguous=compared.filter(e=>e.status==='ambiguous').length;result.missing=missing.length;
      result.status='reviewed';
      if(apply&&missing.length) {
        const route=rt.ledger.bind(rt.registry,entry.client,entry.nativeId,project);
        rt.ledger.enqueue(route,missing,entry.path);
        result.delivery=await deliver(rt.ledger,rt.registry,route,rt.api(route),{allowPaused:true});
        const after=await rt.api(route).messages(route.remote_session);
        const confirmed=new Set(after.filter(m=>m.metadata?.honcho_route_id===route.id).map(m=>m.metadata.honcho_source_id));
        result.verified=missing.filter(e=>confirmed.has(e.id)).length;
        if(result.verified!==missing.length)throw new Error('recovery read-back incomplete; receipts retained for review');
        result.status='recovered';remoteByProfile.get(entry.profile).push(...after);
      }
    }catch(e){result.status='blocked';result.reason=errorText(e);}
    save();
  }
  save();return report;
}
