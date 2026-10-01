import { Honcho, Peer, Session, Message } from '@honcho-ai/sdk';
import { PeerIdSchema, SessionIdSchema } from '@honcho-ai/sdk/dist/validation.js';
import { credential } from './config.mjs';
import { redactSecrets } from '../dist/redact.mjs';

export const definitiveRejection = error => [400,401,403,404,413,422,429].includes(error?.status);

export function errorText(error) {
  if (error?.status) return `Honcho HTTP ${error.status}${error.status===401 ? ': credential rejected' : ''}`;
  return redactSecrets(String(error?.message ?? error)).slice(0,300);
}

export class HonchoAPI {
  constructor(profile,{timeout=8000}={}) {
    this.profile=profile;
    this.key=credential(profile);
    this.honcho=new Honcho({apiKey:this.key,workspaceId:profile.workspace,baseURL:profile.endpoint,timeout,maxRetries:0});
    this.http=this.honcho.http;
    this.path='/v3/workspaces/'+encodeURIComponent(profile.workspace);
  }
  // SDK 2.5's normal factories use get-or-create. These handles deliberately
  // omit that callback, so reads never materialize a workspace, peer or session.
  readPeer(id) { return new Peer(PeerIdSchema.parse(id),this.profile.workspace,this.http); }
  readSession(id) { return new Session(SessionIdSchema.parse(id),this.profile.workspace,this.http); }
  list(kind,{page=1,size=100,filters}={}) {
    if(!['peers','sessions'].includes(kind))throw new Error('Invalid list kind');
    return this.http.post(`${this.path}/${kind}/list`,{body:{filters},query:{page,size}});
  }
  async all(kind) {
    const items=[];let page=1;
    for(;;){const data=await this.list(kind,{page});items.push(...data.items);if(page++>=data.pages)break;}
    return items;
  }
  async inspect(id) { return (await this.all('sessions')).find(s=>s.id===id)??null; }
  async search(query,limit) { const data=await this.http.post(`${this.path}/search`,{body:{query,limit}});return data.map(Message.fromApiResponse); }
  async probe() {
    // Listing peers does not require an admin key or create a workspace.
    const data=await this.list('peers');return {workspace:this.profile.workspace,peer_count:data.total};
  }
  async session(id) { return this.honcho.session(id); }
  async ensure(route) {
    const session=await this.session(route.remote_session);
    const [user,assistant]=await Promise.all([this.honcho.peer(route.identity.user),this.honcho.peer(route.client)]);
    await session.addPeers([user,assistant]);
    return session;
  }
  async messages(sessionId,filters) {
    try { return await (await this.readSession(sessionId).messages({size:100,...(filters?{filters}:{})})).toArray(); }
    catch(e) { if(e.status===404)return [];throw e; }
  }
  async add(route,events) {
    return (await this.session(route.remote_session)).addMessages(events.map(e=>({peerId:e.role==='user'?route.identity.user:route.client,content:e.content,createdAt:e.created_at,metadata:{...e.metadata,honcho_source_id:e.id,honcho_route_id:route.id},...(e.metadata?.verification?{configuration:{reasoning:{enabled:false}}}:{})})));
  }
}
