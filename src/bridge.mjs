import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema,ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { runtime,options } from './runtime.mjs';
import { digest } from './config.mjs';
import { errorText } from './api.mjs';
import { redactSecrets } from '../dist/redact.mjs';

const string={type:'string',minLength:1};
const limit={type:'integer',minimum:1,maximum:100};
const common={route_id:{...string,description:'Use the exact route_id injected by this conversation’s Honcho hook.'},workspace_id:{...string,description:'Optional consistency check; must equal the pinned workspace.'}};
const peer={peer_id:string};
const session={session_id:string};
const pagination={page:{type:'integer',minimum:1},size:limit};
const definitions={
  status:['Show this conversation’s selected memory area and upload health.',{},[]],
  search:['Search memory across the current area; optionally restrict messages to a session.',{query:string,limit,...session},['query']],
  get_peer_context:['Read stored context about a peer in the current area.',{...peer,max_conclusions:limit},[]],
  get_representation:['Read the stored representation of a peer.',peer,[]],
  chat:['Ask Honcho a question about the user in this area.',{query:string,...peer,reasoning_level:{type:'string',enum:['minimal','low','medium','high','max']}},['query']],
  list_conclusions:['List saved conclusions about a peer.',{...peer,...pagination},[]],
  query_conclusions:['Search conclusions about a peer.',{...peer,query:string,limit},['query']],
  create_conclusions:['Save user-authorized conclusions in the current conversation’s area.',{content:string},['content']],
  list_peers:['List participants in this memory area.',pagination,[]],
  list_sessions:['List conversations in this memory area.',pagination,[]],
  inspect_session:['Read metadata for a session in this memory area.',session,[]],
  get_session_context:['Read messages and summary for a session in this memory area.',session,[]],
  get_session_messages:['Read one page of messages for a session.',{...session,...pagination},[]],
  get_session_peers:['List participants in a session.',session,[]]
};
const aliases={get_context:'get_peer_context',create_conclusion:'create_conclusions'};
export const toolDefinitions=Object.entries({...definitions,...Object.fromEntries(Object.entries(aliases).map(([a,n])=>[a,definitions[n]]))}).map(([name,[description,properties,required]])=>({name,description,inputSchema:{type:'object',properties:{...common,...properties},required:['route_id',...required],additionalProperties:false},annotations:{readOnlyHint:!name.startsWith('create_'),destructiveHint:false}}));

function validate(name,args) {
  const schema=toolDefinitions.find(t=>t.name===name)?.inputSchema;
  if(!schema || !args || typeof args!=='object' || Array.isArray(args))throw new Error('Unknown tool or invalid arguments');
  for(const key of schema.required)if(args[key]===undefined)throw new Error('Missing required '+key);
  for(const [key,value] of Object.entries(args)) {
    const rule=schema.properties[key];
    if(!rule)throw new Error('Unexpected argument '+key);
    if(rule.type==='string' && (typeof value!=='string'||!value.trim()||value.length>100000))throw new Error('Invalid '+key);
    if(rule.type==='integer' && (!Number.isInteger(value)||value<rule.minimum||(rule.maximum&&value>rule.maximum)))throw new Error('Invalid '+key);
    if(rule.enum&&!rule.enum.includes(value))throw new Error('Invalid '+key);
  }
}
export function scrub(value) {
  if(typeof value==='string')return redactSecrets(value);
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!k.startsWith('_')&&!/api.?key|authorization|credential|password|^token$/i.test(k)).map(([k,v])=>[k,scrub(v)]));
  return value;
}
const pageResult=page=>({items:scrub(page.items),total:page.total,page:page.page,pages:page.pages});

export async function callMemory(rt,client,name,args) {
  validate(name,args);name=aliases[name]??name;
  const route=rt.ledger.get(args.route_id);
  if(route.client!==client)throw new Error('route_id belongs to another client');
  rt.ledger.validate(rt.registry,route);
  if(args.workspace_id && args.workspace_id!==route.identity.workspace)throw new Error('workspace_id conflicts with the pinned destination');
  if(name==='status') {
    const {warning,...health}=rt.ledger.writeHealth(route.id);
    let diagnostic=rt.ledger.db.prepare('SELECT status,updated_at FROM diagnostics WHERE route_id=?').get(route.id)??null;
    if(warning)diagnostic={status:warning,updated_at:diagnostic?.updated_at??null};
    return {route_id:route.id,profile:route.profile,account:route.identity.account,workspace:route.identity.workspace,uploads_enabled:rt.ledger.enabled(),...health,diagnostic};
  }
  const api=rt.api(route,name==='chat'?{timeout:120000}:undefined);
  const user=api.readPeer(args.peer_id??route.identity.user);
  const sess=api.readSession(args.session_id??route.remote_session);
  let result;
  switch(name) {
    case 'search': result={messages:await (args.session_id?sess.search(args.query,{limit:args.limit??10}):api.search(args.query,args.limit??10)),conclusions:await user.conclusions.query(args.query,args.limit??10)};break;
    case 'get_peer_context':result=await user.context({maxConclusions:args.max_conclusions??12,includeMostFrequent:true});break;
    case 'get_representation':result=await user.representation();break;
    case 'chat':result=await user.chat(args.query,{reasoningLevel:args.reasoning_level??'low'});break;
    case 'list_conclusions':result=pageResult(await user.conclusions.list({page:args.page??1,size:args.size??20}));break;
    case 'query_conclusions':result=await user.conclusions.query(args.query,args.limit??10);break;
    case 'create_conclusions': {
      if(!rt.ledger.enabled())throw new Error('Memory writes are paused');
      const content=redactSecrets(args.content);
      await api.ensure(route);
      result=await rt.ledger.once(route.id,digest(route.id+':conclusion:'+content),async()=>scrub(await user.conclusions.create({content,sessionId:route.remote_session})));break;
    }
    case 'list_peers':result=await api.list('peers',{page:args.page??1,size:args.size??20});break;
    case 'list_sessions':result=await api.list('sessions',{page:args.page??1,size:args.size??20});break;
    case 'inspect_session':result=await api.inspect(sess.id);break;
    case 'get_session_context':result=await sess.context({summary:true});break;
    case 'get_session_messages':result=pageResult(await sess.messages({page:args.page??1,size:args.size??20}));break;
    case 'get_session_peers':result=(await sess.peers()).map(p=>({id:p.id,metadata:p.metadata}));break;
  }
  return scrub(result);
}

export async function serve(args) {
  if(!['codex','claude'].includes(args.client))throw new Error('Bridge requires --client codex or claude');
  const rt=runtime(args);
  const server=new Server({name:'honcho',version:'1.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:toolDefinitions}));
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    try{return {content:[{type:'text',text:JSON.stringify(await callMemory(rt,args.client,request.params.name,request.params.arguments))}]};}
    catch(e){return {isError:true,content:[{type:'text',text:errorText(e)}]};}
  });
  await server.connect(new StdioServerTransport());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  serve(options(process.argv.slice(2))).catch(e=>{console.error(errorText(e));process.exitCode=1;});
}
