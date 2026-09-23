import { errorText, definitiveRejection } from './api.mjs';

export async function deliver(ledger,registry,route,api,{allowPaused=false}={}) {
  ledger.validate(registry,route);
  if(!ledger.enabled()&&!allowPaused)return {paused:true,pending:ledger.pending(route.id).length};
  const release=ledger.lock(route.id);
  if(!release)return {busy:true};
  try {
    const pending=ledger.pending(route.id);
    if(!pending.length)return {sent:0};
    await api.ensure(route);
    const remote=await api.messages(route.remote_session);
    const receipts=new Map();
    for(const m of remote) {
      const id=m.metadata?.honcho_source_id;
      if(id) { const list=receipts.get(id)??[];list.push(m);receipts.set(id,list); }
    }
    const ready=[];let verified=0,uncertain=0;
    for(const event of pending) {
      const matches=receipts.get(event.id)??[];
      if(matches.length===1 && matches[0].content===event.content && matches[0].peerId===(event.role==='user'?route.identity.user:route.client) && Date.parse(matches[0].createdAt)===Date.parse(event.created_at)) {
        ledger.mark(event.id,'sent',[matches[0].id]);verified++;continue;
      }
      if(matches.length || ['sending','uncertain'].includes(event.status)) {
        ledger.mark(event.id,'uncertain',null,'Remote receipt is absent or ambiguous; no automatic replay');uncertain++;continue;
      }
      ready.push(event);
    }
    let sent=0;
    for(let i=0;i<ready.length;i+=100) {
      const batch=ready.slice(i,i+100);
      ledger.transaction(()=>batch.forEach(e=>ledger.mark(e.id,'sending')));
      try {
        const result=await api.add(route,batch);
        if(result.length!==batch.length || result.some((m,j)=>!m.id || m.content!==batch[j].content || m.metadata?.honcho_source_id!==batch[j].id || m.peerId!==(batch[j].role==='user'?route.identity.user:route.client) || Date.parse(m.createdAt)!==Date.parse(batch[j].created_at))) throw new Error('Incomplete Honcho upload receipt');
        ledger.transaction(()=>batch.forEach((e,j)=>ledger.mark(e.id,'sent',[result[j].id])));
        sent+=batch.length;
      } catch(e) {
        // A definitive rejection is safe to retry after the cause is resolved.
        const rejected=definitiveRejection(e);
        ledger.transaction(()=>batch.forEach(item=>ledger.mark(item.id,rejected?'pending':'uncertain',null,errorText(e))));
        throw e;
      }
    }
    ledger.diagnostic(route.id,uncertain?`${uncertain} uploads need receipt review`:'healthy');
    return {sent,verified,uncertain};
  } catch(e) {ledger.diagnostic(route.id,errorText(e));throw e;}
  finally {release();}
}
