import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identity } from './config.mjs';
import { definitiveRejection, errorText } from './api.mjs';

export class Ledger {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'ledger.sqlite'));
    chmodSync(join(dir, 'ledger.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY, client TEXT NOT NULL, native_id TEXT NOT NULL,
        profile TEXT NOT NULL, identity TEXT NOT NULL, project TEXT NOT NULL,
        cwd TEXT NOT NULL, remote_session TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(client,native_id));
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, route_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', receipts TEXT, error TEXT);
      CREATE INDEX IF NOT EXISTS events_route ON events(route_id,status);
      CREATE TABLE IF NOT EXISTS progress (route_id TEXT PRIMARY KEY, source TEXT NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks (route_id TEXT PRIMARY KEY,pid INTEGER NOT NULL,token TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diagnostics (route_id TEXT PRIMARY KEY,status TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,state TEXT NOT NULL,result TEXT);
      INSERT OR IGNORE INTO settings VALUES ('uploads_enabled','false');`);
    this.transaction(() => {
      const columns=this.db.prepare('PRAGMA table_info(operations)').all().map(c=>c.name);
      if(!columns.includes('route_id'))this.db.exec('ALTER TABLE operations ADD COLUMN route_id TEXT');
      if(!columns.includes('error'))this.db.exec('ALTER TABLE operations ADD COLUMN error TEXT');
      this.db.exec('CREATE INDEX IF NOT EXISTS operations_route ON operations(route_id,state)');
    });
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM routes WHERE id=?').get(id);
    if (!row) throw new Error('Unknown route_id; use the ID injected by the current conversation hook');
    return { ...row, identity: JSON.parse(row.identity) };
  }
  find(client, nativeId) { return this.db.prepare('SELECT id FROM routes WHERE client=? AND native_id=?').get(client, nativeId); }
  bind(registry, client, nativeId, project, { remoteSession } = {}) {
    if (!['codex','claude'].includes(client) || typeof nativeId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(nativeId)) throw new Error('Missing or invalid native conversation ID');
    return this.transaction(() => {
      const existing = this.find(client, nativeId);
      if (existing) {
        const route = this.get(existing.id);
        this.validate(registry, route);
        if (project.recognized && route.profile !== project.profile) throw new Error('Conversation destination conflict; start a new conversation for the other area');
        return route;
      }
      const id = `${client}-${nativeId}`;
      const profile = registry.profiles[project.profile];
      if (!profile) throw new Error('Unknown profile');
      const createdAt = new Date().toISOString();
      let session = remoteSession;
      if (!session) {
        const name = basename(project.directory ?? project.cwd).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'project';
        const base = `${name}-${client}-${createdAt.replace(/[:.]/g, '-')}`;
        const used = this.db.prepare('SELECT 1 FROM routes WHERE remote_session=? LIMIT 1');
        session = base;
        for (let count=2; used.get(session); count++) session = `${base}-${count}`;
      }
      this.db.prepare('INSERT INTO routes VALUES (?,?,?,?,?,?,?,?,?)').run(id,client,nativeId,project.profile,JSON.stringify(identity(profile)),project.project,project.cwd,session,createdAt);
      return this.get(id);
    });
  }
  validate(registry, route) {
    const profile = registry.profiles[route.profile];
    if (!profile || JSON.stringify(identity(profile)) !== JSON.stringify(route.identity)) throw new Error('Pinned Honcho destination changed; explicit migration is required');
    return profile;
  }
  enqueue(route, events, source = '') {
    return this.transaction(() => {
      let added = 0;
      const insert = this.db.prepare('INSERT OR IGNORE INTO events (id,route_id,role,content,created_at,metadata) VALUES (?,?,?,?,?,?)');
      for (const event of events) {
        added += insert.run(event.id,route.id,event.role,event.content,event.at,JSON.stringify(event.metadata ?? {})).changes;
      }
      if (source) this.db.prepare('INSERT INTO progress VALUES (?,?,?) ON CONFLICT(route_id) DO UPDATE SET source=excluded.source,count=excluded.count').run(route.id,source,events.length);
      return added;
    });
  }
  pending(routeId) { return this.db.prepare("SELECT * FROM events WHERE route_id=? AND status!='sent' ORDER BY rowid").all(routeId).map(e => ({...e, metadata:JSON.parse(e.metadata)})); }
  mark(id, status, receipts = null, error = null) { this.db.prepare('UPDATE events SET status=?,receipts=?,error=? WHERE id=?').run(status,receipts ? JSON.stringify(receipts) : null,error,id); }
  enabled() { return this.db.prepare("SELECT value FROM settings WHERE key='uploads_enabled'").get()?.value === 'true'; }
  enable(value) { this.db.prepare("UPDATE settings SET value=? WHERE key='uploads_enabled'").run(String(value)); }
  diagnostic(routeId, status) { this.db.prepare('INSERT INTO diagnostics VALUES (?,?,?) ON CONFLICT(route_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(routeId,status,new Date().toISOString()); }
  writeHealth(routeId) {
    const messages=this.pending(routeId);
    const conclusions={rejected:0,uncertain:0};
    for(const row of this.db.prepare("SELECT state,count(*) AS count FROM operations WHERE route_id=? AND state!='done' GROUP BY state").all(routeId))conclusions[row.state]=row.count;
    const uncertain=messages.filter(e=>['sending','uncertain'].includes(e.status)).length+conclusions.uncertain;
    const warning=[uncertain?`${uncertain} writes need receipt review`:'',conclusions.rejected?`${conclusions.rejected} conclusion writes rejected; retry after resolving the cause`:''].filter(Boolean).join('; ');
    return {pending:messages.length+conclusions.rejected+conclusions.uncertain,uncertain,conclusions,warning};
  }
  async once(routeId, id, fn) {
    const cached=this.transaction(()=>{
      const previous=this.db.prepare('SELECT * FROM operations WHERE id=?').get(id);
      if(previous?.route_id && previous.route_id!==routeId)throw new Error('Conclusion operation belongs to another route');
      if(previous?.state==='done')return {result:JSON.parse(previous.result)};
      if(previous && previous.state!=='rejected')throw new Error('Previous write outcome is uncertain; review remote state before retrying');
      if(previous)this.db.prepare("UPDATE operations SET state='uncertain',route_id=?,error=NULL WHERE id=?").run(routeId,id);
      else this.db.prepare("INSERT INTO operations (id,state,route_id) VALUES (?,'uncertain',?)").run(id,routeId);
      return null;
    });
    if(cached)return cached.result;
    try {
      const result=await fn();
      this.db.prepare("UPDATE operations SET state='done',result=?,error=NULL WHERE id=?").run(JSON.stringify(result),id);
      return result;
    } catch(e) {
      this.db.prepare('UPDATE operations SET state=?,error=? WHERE id=?').run(definitiveRejection(e)?'rejected':'uncertain',errorText(e),id);
      throw e;
    }
  }
  lock(routeId) {
    return this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM locks WHERE route_id=?').get(routeId);
      if (old) {
        try { process.kill(old.pid,0); return null; } catch (e) { if (e.code !== 'ESRCH') return null; }
        this.db.prepare('DELETE FROM locks WHERE route_id=?').run(routeId);
      }
      const token = randomUUID();
      this.db.prepare('INSERT INTO locks VALUES (?,?,?)').run(routeId,process.pid,token);
      return () => this.db.prepare('DELETE FROM locks WHERE route_id=? AND token=?').run(routeId,token);
    });
  }
  status() {
    return { uploads_enabled:this.enabled(),routes:this.db.prepare('SELECT id,profile,client,cwd,remote_session FROM routes').all(),events:this.db.prepare('SELECT status,count(*) AS count FROM events GROUP BY status').all(),operations:this.db.prepare("SELECT id,route_id,state,error FROM operations WHERE state!='done'").all(),diagnostics:this.db.prepare('SELECT * FROM diagnostics').all() };
  }
}
