import { backup } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveProject, projectSession, digest } from './config.mjs';

const equalMessage = (a,b) => a.content===b.content && a.peerId===b.peerId && Date.parse(a.createdAt)===Date.parse(b.createdAt);
function copiedMessage(source, message, target) {
  const matches=target.filter(m=>
    (m.metadata?.honcho_consolidated_from?.session===source && m.metadata.honcho_consolidated_from.message===message.id) ||
    (message.metadata?.honcho_source_id && m.metadata?.honcho_source_id===message.metadata.honcho_source_id));
  if(matches.length>1 || (matches.length===1 && !equalMessage(message,matches[0])))throw new Error('Conflicting consolidation receipt; history requires review');
  return matches[0];
}

export async function consolidate(rt,{apply=false,profile,onProgress=()=>{}}={}) {
  const {ledger,registry}=rt,groups=new Map();
  if(apply && ledger.enabled())throw new Error('Pause uploads before consolidating sessions');
  for(const {id} of ledger.db.prepare('SELECT id FROM routes ORDER BY id').all()) {
    const route=ledger.get(id);
    if(profile && route.profile!==profile)continue;
    ledger.validate(registry,route);
    const project=resolveProject(registry,route.cwd);
    if(project.profile!==route.profile)throw new Error('Project assignment changed; consolidation refused');
    const target=projectSession(project);
    const sources=new Set(ledger.db.prepare('SELECT source FROM session_moves WHERE route_id=? AND completed=0').all(route.id).map(m=>m.source));
    if(target!==route.remote_session)sources.add(route.remote_session);
    for(const source of sources) {
      const key=JSON.stringify([route.identity,source]);
      const group=groups.get(key)??{profile:route.profile,source,target,routes:[]};
      if(group.target!==target)throw new Error('One source session maps to different projects; consolidation refused');
      group.routes.push(route);groups.set(key,group);
    }
  }
  const report={applied:apply,sessions:[...groups.values()].map(g=>({profile:g.profile,source:g.source,target:g.target,routes:g.routes.length}))};
  if(!apply || !groups.size)return report;
  report.backup=join(ledger.dir,`before-consolidation-${randomUUID()}.sqlite`);
  await backup(ledger.db,report.backup);chmodSync(report.backup,0o600);
  onProgress({backup:report.backup,total:groups.size});
  const releases=[],locked=new Set();
  try {
    for(const group of groups.values())for(const route of group.routes) {
      if(!locked.has(route.id)) {
        const release=ledger.lock(route.id);
        if(!release)throw new Error('Conversation upload is active; consolidation refused');
        releases.push(release);locked.add(route.id);
        if(ledger.db.prepare("SELECT 1 FROM operations WHERE route_id=? AND state='uncertain' AND id NOT LIKE 'consolidate-%'").get(route.id))throw new Error('Uncertain conclusion write requires review before consolidation');
      }
    }
    ledger.transaction(()=>{
      for(const group of groups.values())for(const route of group.routes)ledger.assignSession(ledger.get(route.id),group.target);
    });
    onProgress({cutover:true,routes:locked.size,total:groups.size});
    for(const [index,group] of [...groups.values()].entries()) {
      const route=group.routes[0],api=rt.api(route),source=await api.messages(group.source);
      const events=group.routes.flatMap(r=>ledger.db.prepare('SELECT * FROM events WHERE route_id=? AND rowid<=(SELECT event_cutoff FROM session_moves WHERE route_id=? AND source=? AND target=?)').all(r.id,r.id,group.source,group.target).map(e=>({...e,peerId:e.role==='user'?r.identity.user:r.client,createdAt:e.created_at})));
      const originals=new Map();
      for(const event of events) {
        const matches=source.filter(m=>m.metadata?.honcho_source_id===event.id || JSON.parse(event.receipts??'[]').includes(m.id));
        if(matches.length>1 || (matches.length===1 && !equalMessage(event,matches[0])))throw new Error('Conflicting original delivery receipt; consolidation refused');
        if(matches.length)originals.set(event.id,matches[0]);
        else if(event.status!=='pending')throw new Error('Sent or uncertain message has no original receipt; consolidation refused');
      }
      const sourceIds=source.map(m=>m.metadata?.honcho_source_id).filter(Boolean);
      const targetMessages=()=>api.messages(group.target,{OR:[
        {metadata:{honcho_consolidated_from:{session:group.source}}},
        ...(sourceIds.length?[{metadata:{honcho_source_id:{in:sourceIds}}}]:[])
      ]});
      let target=await targetMessages();
      const missing=source.filter(m=>!copiedMessage(group.source,m,target));
      const operation='consolidate-'+digest(JSON.stringify([route.identity,group.source,group.target]));
      if(missing.length)await ledger.once(route.id,operation,async()=>{
        const session=await api.ensure({...route,remote_session:group.target});
        await session.addPeers([...new Set(source.map(m=>m.peerId))]);
        for(let i=0;i<missing.length;i+=100) {
          const batch=missing.slice(i,i+100);
          const receipts=await session.addMessages(batch.map(m=>({peerId:m.peerId,content:m.content,createdAt:m.createdAt,
            metadata:{...m.metadata,honcho_consolidated_from:{session:group.source,message:m.id}},configuration:{reasoning:{enabled:false}}})));
          if(receipts.length!==batch.length || receipts.some((m,j)=>!m.id || !equalMessage(m,batch[j]) || m.metadata?.honcho_consolidated_from?.message!==batch[j].id))throw new Error('Incomplete consolidation receipt; inspect remote history before retrying');
        }
        return {source:group.source,target:group.target,messages:source.length};
      });
      else await api.ensure({...route,remote_session:group.target});
      target=await targetMessages();
      const copied=new Map(source.map(m=>[m.id,copiedMessage(group.source,m,target)]));
      if([...copied.values()].some(m=>!m))throw new Error('Consolidated history did not verify; history requires review');
      const current=await api.messages(group.source);
      if(current.length!==source.length || current.some(m=>!source.some(old=>old.id===m.id && equalMessage(old,m))))throw new Error('Original history changed during consolidation; history requires review');
      ledger.transaction(()=>{
        if(ledger.enabled())throw new Error('Uploads were enabled during consolidation');
        for(const r of group.routes) {
          ledger.validate(registry,ledger.get(r.id));
          if(ledger.get(r.id).remote_session!==group.target)throw new Error('Session changed during consolidation');
          ledger.db.prepare('UPDATE session_moves SET completed=1 WHERE route_id=? AND source=? AND target=?').run(r.id,group.source,group.target);
        }
        for(const [id,original] of originals)ledger.mark(id,'sent',[copied.get(original.id).id]);
        // A lost response is settled only after every copied message is read back.
        ledger.db.prepare("UPDATE operations SET state='done',error=NULL,result=? WHERE id=?").run(JSON.stringify({source:group.source,target:group.target,messages:source.length}),operation);
      });
      Object.assign(report.sessions[index],{status:'verified',messages:source.length});
      onProgress({...report.sessions[index],completed:index+1,total:groups.size});
    }
  } finally {for(const release of releases.reverse())release();}
  return report;
}
