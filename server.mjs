import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {add,positions,key,saliente,inspect,draftErrors,validateRoster,zone} from './domain.mjs';

const token = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
function fail(status,message) { throw Object.assign(new Error(message),{status}); }
function requireThat(condition,status,message) { if (!condition) fail(status,message); }
function passwordHash(password,salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password,salt,64).toString('hex');
}
function passwordMatches(password,saved) {
  return timingSafeEqual(Buffer.from(passwordHash(password,saved.split(':')[0])),Buffer.from(saved));
}
function log(state,actor,action,details) {
  state.audit.unshift({id:randomUUID(),at:now(),actor,action,details});
}
function notify(state,recipients,message) {
  for (const to of new Set(recipients)) state.notifications.unshift({id:randomUUID(),to,message,at:now(),read:false});
}
function me(user) { return {id:user.id,name:user.name,role:user.role,email:user.email,hasPassword:!!user.password}; }
const cleanEmail = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validPassword = value => typeof value === 'string' && value.length >= 14 && value.length <= 128;
const signupLifetime = 60 * 60 * 1000;
function activeSignupLink(state) {
  const link = state.signupLink;
  return Number.isFinite(link?.issuedAt) &&
    link.expires === link.issuedAt + signupLifetime && link.expires > Date.now() ? link : null;
}
function coordinators(state) { return Object.values(state.users).filter(u => u.role === 'coord').map(u => u.id); }
const staticFiles = {
  '/':['index.html','text/html; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8'], '/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'],
  '/sw.js':['sw.js','text/javascript; charset=utf-8'], '/icon.svg':['icon.svg','image/svg+xml'],
  '/ocr.js':['ocr.js','text/javascript; charset=utf-8']
};
const ocrAssets = {
  'tesseract.min.js':'text/javascript; charset=utf-8', 'worker.min.js':'text/javascript; charset=utf-8',
  'tesseract-core-lstm.wasm.js':'text/javascript; charset=utf-8', 'tesseract-core-lstm.wasm':'application/wasm',
  'spa.traineddata.gz':'application/gzip'
};

export function createApp({filename=':memory:', store, ...options}={}) {
  const persistence = store ?? sqliteStore(filename, options);
  const server = createServer(createHandler({...options,store:persistence}));
  if (persistence.close) server.on('close', () => persistence.close());
  return server;
}

function sqliteStore(filename,{demo=false,bootstrapPassword}={}) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS app (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  const select = db.prepare('SELECT data FROM app WHERE id=1');
  const save = db.prepare('UPDATE app SET data=? WHERE id=1');
  if (!select.get()) {
    requireThat(demo || (typeof bootstrapPassword === 'string' && bootstrapPassword.length >= 14),500,
      'Configura GUARDIAMi_ADMIN_PASSWORD (mínimo 14 caracteres) o inicia con --demo.');
    db.prepare('INSERT INTO app VALUES (1,?)').run(JSON.stringify(initialState({demo,bootstrapPassword})));
  }
  const read = () => JSON.parse(select.get().data);
  if (read().demo !== demo) throw new Error('Usa bases separadas para demostración y operación.');
  function write(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = read();
      const result = fn(state);
      save.run(JSON.stringify(state));
      db.exec('COMMIT');
      return result;
    } catch(error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {read,write,close:()=>db.close()};
}

export function initialState({demo=false,bootstrapPassword}={}) {
    const people = {}, users = {};
    const admin = {id:'coord',email:'coord@guardia.invalid',name:'Coordinación',role:'coord'};
    if (bootstrapPassword) admin.password = passwordHash(bootstrapPassword);
    users.coord = admin;
    if (demo) for (let i=1; i<=8; i++) {
      const id = 'demo-' + String(i).padStart(3,'0');
      people[id] = {id,name:'Facultativo ' + String(i).padStart(2,'0')};
    }
    if (demo) for (const id of ['demo-001','demo-002','demo-007']) {
      users[id] = {...people[id],email:id+'@guardia.invalid',role:'doctor'};
    }
    return {
      demo,people,users,revision:0,assignments:{},drafts:{},changes:{},audit:[],sessions:{},invites:{},notifications:[]
    };
}

export function createHandler({store,demo=false,secure=false,setupHash}={}) {
  const {read,write} = store;
  const cookie = (value,maxAge) => 'gm_session=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (secure ? '; Secure' : '');
  function signIn(state,user) {
    const id = token();
    state.sessions[hash(id)] = {userId:user.id,expires:Date.now()+86400000};
    return {data:me(user),setCookie:cookie(id,86400)};
  }
  function identity(state,sessionId) {
    const session = state.sessions[sessionId];
    return session?.expires > Date.now() ? state.users[session.userId] : null;
  }
  function schedule(state) {
    const assignments = Object.values(state.assignments);
    const rests = new Map();
    for (const row of assignments) {
      const date = saliente(row);
      if (!date) continue;
      const id = date + '/' + row.physicianId;
      if (!rests.has(id)) rests.set(id,{date,physicianId:row.physicianId,sources:[]});
      rests.get(id).sources.push({date:row.date,position:row.position});
    }
    return {assignments,rests:[...rests.values()]};
  }
  function applyChange(state,change,actor) {
    const next = {...state.assignments};
    for (const leg of change.legs) {
      const old = next[leg.key];
      requireThat(old?.version === leg.version && old.physicianId === leg.from,409,'El turno cambió. Crea una solicitud nueva.');
      next[leg.key] = {...old,physicianId:leg.to,version:old.version+1,protected:true};
    }
    const problem = validateRoster(Object.values(next));
    requireThat(!problem,422,problem);
    state.assignments = next;
    state.revision++;
    change.status = 'applied';
    log(state,actor,'Cambio aplicado',change.legs);
    for (const other of Object.values(state.changes)) {
      if (other.id === change.id || !['requested','accepted'].includes(other.status)) continue;
      if (!other.legs.some(leg => change.legs.some(current => current.key === leg.key))) continue;
      other.status = 'invalidated';
      log(state,actor,'Solicitud invalidada',other.id);
      notify(state,[other.from,other.to],'Una solicitud quedó invalidada por un cambio de turno.');
    }
  }
  function route(state,user,path,body) {
    const coord = user.role === 'coord';
    if (path === '/state') {
      const changes = Object.values(state.changes).filter(c => coord || c.from === user.id || c.to === user.id);
      const link = coord ? activeSignupLink(state) : null;
      return {me:me(user), revision:state.revision,people:state.people,...schedule(state),
        drafts:coord ? Object.values(state.drafts).map(d => ({...d,errors:draftErrors(d,state.people)})) : [],
        changes, notifications:state.notifications.filter(n => n.to === user.id),audit:coord ? state.audit : [],
        signupLink:link ? {expires:link.expires,uses:link.uses} : null};
    }
    if (path === '/notifications/read') {
      state.notifications.filter(n => n.to === user.id).forEach(n => {n.read=true;});
      return {};
    }
    if (path === '/invite') {
      requireThat(coord,403,'Solo coordinación puede invitar.');
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      requireThat(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Correo inválido.');
      requireThat(!Object.values(state.users).some(u => u.email === email),409,'Ya existe una cuenta con ese correo.');
      const id = body.physicianId || 'p-' + randomUUID();
      if (body.physicianId) {
        requireThat(Object.hasOwn(state.people,id) && !Object.hasOwn(state.users,id),409,'Perfil inexistente o vinculado.');
      } else {
        requireThat(name && name.length <= 100,400,'Indica el nombre visible.');
        state.people[id] = {id,name};
      }
      for (const invite of Object.values(state.invites)) {
        if (invite.email === email || invite.id === id) invite.revoked = true;
      }
      const secret = token();
      state.invites[hash(secret)] = {email,id,expires:Date.now()+86400000};
      log(state,user.id,'Invitación creada',id);
      return {token:secret,physicianId:id};
    }
    if (path === '/signup-link' || path === '/signup-link/revoke') {
      requireThat(coord,403,'Solo coordinación puede gestionar el enlace de alta.');
      if (path.endsWith('/revoke')) {
        state.signupLink = null;
        log(state,user.id,'Enlace de alta revocado',user.id);
        return {};
      }
      const secret = token();
      const issuedAt = Date.now();
      state.signupLink = {hash:hash(secret),issuedAt,expires:issuedAt+signupLifetime,uses:0};
      log(state,user.id,'Enlace de alta creado',user.id);
      return {token:secret,expires:state.signupLink.expires};
    }
    if (path.startsWith('/imports')) {
      requireThat(coord,403,'Solo coordinación puede importar.');
      if (path === '/imports') {
        const inspected = inspect(body,state.people);
        const draft = {...inspected,id:randomUUID(),base:state.revision,version:1,status:'draft'};
        state.drafts[draft.id] = draft;
        log(state,user.id,'Borrador importado',draft.period);
        return {id:draft.id};
      }
      const [, , id, action] = path.split('/');
      const draft = state.drafts[id];
      requireThat(draft && draft.status !== 'published',404,'Borrador activo no encontrado.');
      requireThat(draft.version === body.version,409,'El borrador cambió. Vuelve a revisarlo.');
      if (action === 'discard') {
        delete state.drafts[id];
        log(state,user.id,'Borrador descartado',id);
        return {};
      }
      if (action === 'edit') {
        const row = draft.rows.find(r => key(r) === body.key);
        requireThat(row && (body.physicianId === null || Object.hasOwn(state.people,body.physicianId)),400,'Casilla o persona inválida.');
        row.physicianId = body.physicianId;
        draft.status = 'draft';
        draft.version++;
        return {};
      }
      if (action === 'review' || action === 'publish') {
        requireThat(draft.base === state.revision,409,'El calendario cambió. Compara el cuadrante e importa un borrador nuevo.');
        const errors = draftErrors(draft,state.people);
        requireThat(!errors.length,422,errors[0]);
        const protectedRow = draft.rows.find(r => state.assignments[key(r)]?.protected && state.assignments[key(r)].physicianId !== r.physicianId);
        requireThat(!protectedRow,409,'Cambio acordado protegido en ' + key(protectedRow ?? {date:'',position:''}) + '. Revisa su titular en el borrador.');
        if (action === 'review') {
          draft.status = 'reviewed';
          draft.reviewedBy = user.id;
          draft.version++;
          log(state,user.id,'Borrador revisado',id);
          return {};
        }
        requireThat(draft.status === 'reviewed',409,'Revisa el borrador antes de publicar.');
        const changedKeys = new Set();
        for (const row of draft.rows) {
          const k = key(row), old = state.assignments[k];
          if (old?.physicianId === row.physicianId) continue;
          changedKeys.add(k);
          const {sourceText, ...assignment} = row;
          state.assignments[k] = {...assignment,version:(old?.version ?? 0)+1,protected:false};
        }
        const problem = validateRoster(Object.values(state.assignments));
        requireThat(!problem,422,problem);
        for (const request of Object.values(state.changes)) {
          if (['requested','accepted'].includes(request.status) && request.legs.some(l => changedKeys.has(l.key))) {
            request.status = 'invalidated';
            log(state,user.id,'Solicitud invalidada',request.id);
          }
        }
        draft.status = 'published';
        state.revision++;
        log(state,user.id,'Cuadrante publicado',{period:draft.period,revision:state.revision,changed:[...changedKeys]});
        notify(state,Object.keys(state.users),'Se ha publicado el cuadrante.');
        return {};
      }
    }
    if (path === '/changes') {
      requireThat(user.role === 'doctor',403,'Solo el titular puede iniciar una solicitud.');
      const own = state.assignments[body.own], target = state.assignments[body.target];
      const type = body.type;
      requireThat(own?.physicianId === user.id && ['swap','cover'].includes(type),400,'Selecciona un turno propio y un tipo válido.');
      requireThat(body.ownVersion === own.version,409,'Tu turno cambió. Abre la solicitud de nuevo.');
      const to = type === 'swap' ? target?.physicianId : body.recipient;
      requireThat(to && to !== user.id && Object.hasOwn(state.users,to) && state.users[to].role === 'doctor',400,'Elige un compañero con cuenta activa.');
      if (type === 'swap') requireThat(body.targetVersion === target.version,409,'El otro turno cambió.');
      const today = new Intl.DateTimeFormat('sv-SE',{timeZone:zone}).format(new Date());
      requireThat(demo || (own.date > today && (type !== 'swap' || target.date > today)),422,'Solo se admiten cambios de turnos futuros.');
      const legs = [{key:key(own),version:own.version,from:user.id,to}];
      if (type === 'swap') legs.push({key:key(target),version:target.version,from:to,to:user.id});
      const proposed = {...state.assignments};
      for (const leg of legs) proposed[leg.key] = {...proposed[leg.key],physicianId:leg.to};
      const problem = validateRoster(Object.values(proposed));
      requireThat(!problem,422,problem);
      const id = randomUUID();
      state.changes[id] = {id,type,from:user.id,to,legs,status:'requested',at:now()};
      log(state,user.id,'Solicitud creada',id);
      notify(state,[to],'Tienes una solicitud de cambio.');
      return {id};
    }
    if (path.startsWith('/changes/')) {
      const [, , id, action] = path.split('/');
      const change = state.changes[id];
      requireThat(change && (coord || [change.from,change.to].includes(user.id)),404,'Solicitud no encontrada.');
      const pending = ['requested','accepted'].includes(change.status);
      requireThat(pending,409,'La solicitud ya está cerrada.');
      if (action === 'accept' && change.to === user.id && change.status === 'requested') {
        change.status = 'accepted';
        notify(state,[change.from,...coordinators(state)],'Una solicitud espera la aprobación de coordinación.');
      } else if (action === 'approve' && coord && change.status === 'accepted') {
        const today = new Intl.DateTimeFormat('sv-SE',{timeZone:zone}).format(new Date());
        requireThat(demo || change.legs.every(leg => state.assignments[leg.key]?.date > today),422,'El turno ya no es futuro.');
        applyChange(state,change,user.id);
        notify(state,[change.from,change.to],'El cambio se ha aplicado al cuadrante.');
      } else if (action === 'reject' && ((change.status === 'requested' && change.to === user.id) || (coord && change.status === 'accepted'))) {
        change.status = 'rejected';
        notify(state,[change.from,change.to],'La solicitud fue rechazada.');
      } else if (action === 'cancel' && change.from === user.id) {
        change.status = 'cancelled';
        notify(state,[change.to],'La solicitud fue cancelada.');
      } else fail(403,'Acción no permitida.');
      log(state,user.id,'Estado de solicitud', {id,status:change.status});
      return {};
    }
    fail(404,'Ruta desconocida.');
  }
  const attempts = new Map();
  return async(req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status,data) => {
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url,'http://localhost');
      const path = url.pathname === '/api/gateway' && url.searchParams.has('route')
        ? '/api/' + url.searchParams.get('route') : url.pathname;
      if (req.method === 'GET' && Object.hasOwn(staticFiles,path)) {
        const [file,mime] = staticFiles[path];
        res.writeHead(200,{'Content-Type':mime});
        return res.end(readFileSync(new URL('./public/'+file,import.meta.url)));
      }
      if (req.method === 'GET' && path.startsWith('/ocr/') && Object.hasOwn(ocrAssets,path.slice(5))) {
        const file = path.slice(5);
        const content = readFileSync(new URL('./public/ocr/'+file,import.meta.url));
        res.writeHead(200,{'Content-Type':ocrAssets[file]});
        return res.end(content);
      }
      requireThat(path.startsWith('/api/'),404,'No encontrado.');
      const action = path.slice(4);
      const sessionId = hash(req.headers.cookie?.match(/(?:^|; )gm_session=([^;]+)/)?.[1] ?? '');
      if (req.method === 'GET' && action === '/session') {
        const state = await read(), user = identity(state,sessionId);
        return json(200,{demo,me:user ? me(user) : null,setup:!!setupHash && !state.users.coord.password});
      }
      if (req.method === 'GET' && action === '/state') {
        const state = await read(), user = identity(state,sessionId);
        requireThat(user,401,'Inicia sesión.');
        return json(200,route(state,user,action,{}));
      }
      requireThat(req.method === 'POST' && /^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''),405,'Petición no admitida.');
      requireThat(!req.headers.origin || req.headers.origin === (secure ? 'https://' : 'http://') + req.headers.host,403,'Origen no permitido.');
      let body = req.body;
      if (body === undefined) {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          requireThat(length <= 750000,413,'Archivo demasiado grande.');
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch {fail(400,'JSON inválido.');}
      }
      requireThat(body && typeof body === 'object' && !Array.isArray(body),400,'Se esperaba un objeto JSON.');
      requireThat(Buffer.byteLength(JSON.stringify(body)) <= 750000,413,'Archivo demasiado grande.');
      if (['/login','/join','/register','/demo','/setup','/profile/email','/profile/password'].includes(action)) {
        const ip = req.socket.remoteAddress;
        const count = attempts.get(ip);
        if (!count || count.until < Date.now()) attempts.set(ip,{n:1,until:Date.now()+60000});
        else requireThat(++count.n <= 25,429,'Espera un minuto y vuelve a intentarlo.');
      }
      const result = await write(state => {
        for (const [id,session] of Object.entries(state.sessions)) {
          if (session.expires <= Date.now()) delete state.sessions[id];
        }
        if (action === '/setup') {
          const supplied = typeof body.token === 'string' ? hash(body.token) : '';
          requireThat(setupHash && /^[a-f0-9]{64}$/.test(setupHash) && supplied &&
            timingSafeEqual(Buffer.from(supplied),Buffer.from(setupHash)) && !state.users.coord.password,403,'Activación no disponible.');
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
          requireThat(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Correo inválido.');
          requireThat(typeof body.password === 'string' && body.password.length >= 14 && body.password.length <= 128,400,'Usa entre 14 y 128 caracteres.');
          const user = state.users.coord;
          user.email = email;
          user.password = passwordHash(body.password);
          log(state,user.id,'Coordinación activada',user.id);
          return signIn(state,user);
        }
        if (action === '/demo') {
          requireThat(demo && ['coord','demo-001','demo-002','demo-007'].includes(body.id),403,'Demostración no disponible.');
          return signIn(state,state.users[body.id]);
        }
        if (action === '/login') {
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
          const user = Object.values(state.users).find(u => u.email === email);
          requireThat(user?.password && typeof body.password === 'string' && body.password.length <= 128 &&
            passwordMatches(body.password,user.password),401,'Credenciales incorrectas.');
          return signIn(state,user);
        }
        if (action === '/join') {
          const invite = typeof body.token === 'string' ? state.invites[hash(body.token)] : null;
          requireThat(invite && !invite.revoked && !invite.used && invite.expires > Date.now() &&
            !Object.hasOwn(state.users,invite.id) && !Object.values(state.users).some(u => u.email === invite.email),409,'Invitación inválida, vencida o utilizada.');
          requireThat(typeof body.password === 'string' && body.password.length >= 14 && body.password.length <= 128,400,'Usa entre 14 y 128 caracteres.');
          const user = {...state.people[invite.id],email:invite.email,role:'doctor',password:passwordHash(body.password)};
          invite.used = true;
          state.users[user.id] = user;
          log(state,user.id,'Cuenta activada',user.id);
          return signIn(state,user);
        }
        if (action === '/register') {
          const link = activeSignupLink(state);
          requireThat(link && typeof body.token === 'string' &&
            timingSafeEqual(Buffer.from(hash(body.token)),Buffer.from(link.hash)),403,'El enlace de alta ha caducado o ya no está activo.');
          const email = cleanEmail(body.email);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          requireThat(validEmail(email) && name && name.length <= 100,400,'Indica un nombre visible y un correo válido.');
          requireThat(validPassword(body.password),400,'Usa entre 14 y 128 caracteres.');
          const used = Object.values(state.users).some(u => u.email === email);
          const reserved = Object.values(state.invites).some(i => i.email === email && !i.used && !i.revoked && i.expires > Date.now());
          requireThat(!used && !reserved,409,'Ese correo ya tiene una cuenta o una invitación individual activa.');
          const id = 'p-' + randomUUID();
          state.people[id] = {id,name};
          const user = {id,name,email,password:passwordHash(body.password),role:'doctor'};
          state.users[id] = user;
          link.uses++;
          log(state,id,'Alta por enlace compartido',id);
          return signIn(state,user);
        }
        const user = identity(state,sessionId);
        requireThat(user,401,'Inicia sesión.');
        if (action === '/logout') {
          delete state.sessions[sessionId];
          return {data:{},setCookie:cookie('',0)};
        }
        if (action === '/profile/name') {
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          requireThat(name && name.length <= 100,400,'Escribe un nombre de entre 1 y 100 caracteres.');
          user.name = name;
          if (Object.hasOwn(state.people,user.id)) state.people[user.id].name = name;
          log(state,user.id,'Nombre de perfil actualizado',user.id);
          return {data:me(user)};
        }
        if (action === '/profile/email' || action === '/profile/password') {
          const current = body.currentPassword;
          requireThat(user.password && typeof current === 'string' && current.length <= 128 &&
            passwordMatches(current,user.password),403,'La contraseña actual no es correcta.');
          if (action === '/profile/email') {
            const email = cleanEmail(body.email);
            requireThat(validEmail(email),400,'Correo inválido.');
            if (email === user.email) return {data:me(user)};
            const used = Object.values(state.users).some(u => u.email === email);
            const reserved = Object.values(state.invites).some(i =>
              i.email === email && !i.revoked && !i.used && i.expires > Date.now());
            requireThat(!used && !reserved,409,'Ese correo no está disponible.');
            user.email = email;
            log(state,user.id,'Correo de acceso actualizado',user.id);
          } else {
            requireThat(validPassword(body.password),400,'Usa entre 14 y 128 caracteres.');
            requireThat(body.password !== current,400,'Elige una contraseña diferente a la actual.');
            user.password = passwordHash(body.password);
            log(state,user.id,'Contraseña actualizada',user.id);
          }
          for (const [id,active] of Object.entries(state.sessions)) {
            if (active.userId === user.id) delete state.sessions[id];
          }
          return signIn(state,user);
        }
        return {data:route(state,user,action,body)};
      });
      if (result.setCookie) res.setHeader('Set-Cookie',result.setCookie);
      return json(200,result.data);
    } catch(error) {
      if (!error.status) console.error(error);
      json(error.status ?? 500,{error:error.status ? error.message : 'Error interno.'});
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = process.argv.includes('--demo');
  const directory = new URL('./data/',import.meta.url);
  mkdirSync(directory,{recursive:true});
  const server = createApp({filename:fileURLToPath(new URL(demo ? 'demo.sqlite' : 'guardia.sqlite',directory)),demo,
    bootstrapPassword:process.env.GUARDIAMi_ADMIN_PASSWORD,secure:process.env.GUARDIAMi_SECURE === '1'});
  const port = Number(process.env.PORT || 4317);
  server.listen(port,'127.0.0.1',() => console.log('GuardiaMI · http://127.0.0.1:' + port));
}

