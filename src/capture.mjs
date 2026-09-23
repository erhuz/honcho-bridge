import { readFileSync } from 'node:fs';
import { digest } from './config.mjs';
import { redactSecrets } from '../dist/redact.mjs';

const injected = /^\s*<(?:environment_context|turn_aborted|user_instructions|apps_instructions|plugins_instructions|skills_instructions|collaboration_mode|system-reminder|honcho-route|summary)(?:\s|>)/;
function textOf(content) {
  if (typeof content === 'string') return content.trim();
  return Array.isArray(content) ? content.filter(b => ['text','input_text','output_text'].includes(b.type) && typeof b.text === 'string').map(b => b.text).join('\n').trim() : '';
}
export function splitContent(text, max = 20000) {
  const result=[];
  while (text.length > max) {
    let cut = text.lastIndexOf('\n',max);
    if (cut < max / 4) cut = max;
    // Do not split a surrogate pair.
    if (/[\uD800-\uDBFF]/.test(text[cut-1])) cut--;
    result.push(text.slice(0,cut));text=text.slice(cut);
  }
  if (text) result.push(text);
  return result;
}

export function parseTranscript(client, nativeId, raw, patterns = []) {
  const turns=[];const occurrences=new Map();
  const lines=raw.split('\n');
  for (let index=0;index<lines.length;index++) {
    if (!lines[index].trim()) continue;
    let e;
    try { e=JSON.parse(lines[index]); }
    catch { if(index===lines.length-1) break; throw new Error('Malformed complete transcript record at line '+(index+1)); }
    let payload;
    if (client==='codex') {
      if (e.type!=='response_item' || e.payload?.type!=='message') continue;
      payload=e.payload;
      if (payload.role==='assistant' && payload.channel && !['final','commentary'].includes(payload.channel)) continue;
    } else {
      if (!['user','assistant'].includes(e.type) || e.isMeta || e.isCompactSummary) continue;
      payload=e.message;
    }
    if (!payload || !['user','assistant'].includes(payload.role)) continue;
    const text=textOf(payload.content);
    if (!text || (payload.role==='user' && injected.test(text))) continue;
    if (!e.timestamp || !Number.isFinite(Date.parse(e.timestamp))) throw new Error('Transcript message lacks a stable timestamp');
    const fingerprint=digest(JSON.stringify([payload.role,e.timestamp,text]));
    const occurrence=occurrences.get(fingerprint)??0;occurrences.set(fingerprint,occurrence+1);
    const source=digest(JSON.stringify([client,nativeId,e.uuid??payload.id??fingerprint,occurrence,fingerprint]));
    const content=redactSecrets(text,patterns);
    splitContent(content).forEach((piece,part)=>turns.push({id:digest(source+':'+part),role:payload.role,content:piece,at:e.timestamp,metadata:{source_event_id:source,source_part:part,source_client:client}}));
  }
  return turns;
}

export function capture(ledger,route,path,patterns) {
  const events=parseTranscript(route.client,route.native_id,readFileSync(path,'utf8'),patterns);
  return ledger.enqueue(route,events,path);
}

export function originalCwd(client,raw) {
  for (const line of raw.split('\n')) {
    let e;try{e=JSON.parse(line);}catch{continue;}
    if (client==='codex' && e.type==='session_meta') return e.payload?.cwd;
    if (client==='claude' && e.cwd && ['user','assistant'].includes(e.type)) return e.cwd;
  }
  return null;
}
