const root = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const names = {HUNSC_1:'HUNSC 1ª',HUNSC_2:'HUNSC 2ª',EAP:'EAP',HSUR:'H. Sur',REF_HUNSC:'Refuerzo HUNSC',REF_HSUR:'Refuerzo H. Sur'};
const statuses = {requested:'Pendiente del compañero',accepted:'Pendiente de coordinación',applied:'Aplicado',rejected:'Rechazado',cancelled:'Cancelado',invalidated:'Invalidado'};
const isRef = position => position.startsWith('REF_');
const slot = row => row.date+'/'+row.position;
const fmt = (date, options) => new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',...options}).format(new Date(date+'T12:00:00Z'));
const long = date => fmt(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Atlantic/Canary'}).format(new Date());
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session, state, tab='service', selected=today, month=today.slice(0,7), stale=false, noticeTimer, invite=null, loaded=false;
const brand = '<div class="brand"><img src="/icon.svg" alt=""><div>GuardiaMI<small>Medicina Interna</small></div></div>';
function message(text) {
  clearTimeout(noticeTimer);
  toast.textContent=text;
  noticeTimer=setTimeout(()=>toast.textContent='',6000);
}
async function api(path,body) {
  const response=await fetch('/api/'+path,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}
async function refresh({force=false}={}) {
  try {
    const next=await api('state');
    const old=state;
    const wasStale=stale;
    stale=false;
    state=next;
    if (!loaded) {
      loaded=true;
      if (next.assignments.length && !next.assignments.some(a=>a.date.slice(0,7)===month)) {
        selected=next.assignments.map(a=>a.date).sort()[0];
        month=selected.slice(0,7);
      }
    }
    if (force || wasStale || (JSON.stringify(old)!==JSON.stringify(next) && !dialog.open && !['import','invite'].includes(tab))) render();
  } catch(error) {
    if (error.status===401) {
      session.me=null; state=null; loaded=false; render(); return;
    }
    stale=true;
    const status=document.querySelector('#connection');
    if (status) {status.hidden=false; status.textContent='Sin conexión con el calendario. Los datos pueden estar desactualizados.';}
    if (force) throw error;
  }
}
function name(id) { return escape(state.people[id]?.name ?? id); }
function rowsFor(date) {
  return state.assignments.filter(a=>a.date===date && (tab!=='mine'||a.physicianId===state.me.id));
}
function restsFor(date) {
  return tab==='mine' ? state.rests.filter(r=>r.date===date&&r.physicianId===state.me.id) : [];
}
function rowHtml(row) {
  const ref=isRef(row.position);
  return '<div class="row line"><div><strong>'+names[row.position]+'</strong><p>'+name(row.physicianId)+' · '+(ref?'08:00–20:00':'08:00–08:00 (+1 día)')+'</p></div><span class="tag '+(ref?'ref':'')+'">'+(ref?'12 h':'24 h')+'</span>'+
    (state.me.id===row.physicianId?'<button class="btn" data-change="'+slot(row)+'">Pedir cambio</button>':'')+'</div>';
}
function calendar() {
  const [year,num]=month.split('-').map(Number);
  const first=new Date(Date.UTC(year,num-1,1));
  const offset=(first.getUTCDay()+6)%7;
  const count=new Date(Date.UTC(year,num,0)).getUTCDate();
  const cells=Array.from({length:offset},()=>'<span></span>');
  for(let i=1;i<=count;i++){
    const date=month+'-'+String(i).padStart(2,'0');
    const rows=rowsFor(date).length, rests=restsFor(date).length;
    const mark=tab==='mine' ? [rows&&rows+' T',rests&&'S'].filter(Boolean).join(' · ') : rows?rows+'/6':'';
    cells.push('<button class="day '+(date===today?'today':'')+'" data-date="'+date+'" aria-label="'+long(date)+(rows?', '+rows+' turnos':'')+(rests?', saliente':'')+'" aria-pressed="'+(date===selected)+'">'+i+'<span>'+mark+'</span></button>');
  }
  const assignments=rowsFor(selected).sort((a,b)=>Object.keys(names).indexOf(a.position)-Object.keys(names).indexOf(b.position));
  const rests=restsFor(selected);
  return '<div class="layout"><section class="card"><div class="bar"><h2>'+fmt(month+'-01',{month:'long',year:'numeric'})+'</h2><div class="actions"><button class="btn" data-month="-1" aria-label="Mes anterior">‹</button><button class="btn" data-today>Hoy</button><button class="btn" data-month="1" aria-label="Mes siguiente">›</button></div></div><div class="calendar">'+['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d=>'<span class="dow">'+d+'</span>').join('')+cells.join('')+'</div>'+(tab==='mine'?'<p class="day-label">T · Turno &nbsp; S · Saliente</p>':'')+'</section>'+
    '<section class="card"><h2>'+ (tab==='mine'?'Mi agenda':'Puestos del día')+'</h2><p class="day-label">'+long(selected)+'</p>'+assignments.map(rowHtml).join('')+rests.map(r=>'<div class="row"><span class="tag rest">Saliente</span><p>'+r.sources.map(s=>names[s.position]+' · '+fmt(s.date,{day:'numeric',month:'short'})).join(' / ')+'</p></div>').join('')+
    (!assignments.length&&!rests.length?'<p class="empty">'+(tab==='mine'?'Sin turnos ni salientes ese día.':'Sin cuadrante publicado para ese día.')+'</p>':'')+'</section></div>';
}
function requests() {
  return '<section class="card compact"><div class="stack">'+(state.changes.length?state.changes.map(c=>{
    const button=(action,label)=>'<button class="btn" data-request="'+c.id+'/'+action+'">'+label+'</button>';
    const mine=state.me.id;
    return '<article class="row"><div class="line"><strong>'+(c.type==='swap'?'Intercambio':'Cobertura')+'</strong><span class="pill">'+statuses[c.status]+'</span></div>'+
      c.legs.map(l=>{const [date,pos]=l.key.split('/');return '<p>'+fmt(date,{day:'numeric',month:'short'})+' · '+names[pos]+' · '+name(l.from)+' → '+name(l.to)+'</p>';}).join('')+
      '<div class="actions">'+(c.status==='requested'&&c.to===mine?button('accept','Aceptar')+button('reject','Rechazar'):'')+
      (c.status==='accepted'&&state.me.role==='coord'?button('approve','Aprobar y aplicar')+button('reject','Rechazar'):'')+
      (['requested','accepted'].includes(c.status)&&mine===c.from?button('cancel','Cancelar solicitud'):'')+'</div></article>';
  }).join(''):'<p class="empty">Todavía no hay solicitudes.</p>')+'</div></section>';
}
function imports() {
  return '<div class="stack"><section class="card compact"><h2 class="headspace">Añadir transcripción</h2><p class="muted">Sube el JSON de un cuadrante ya confeccionado. Podrás corregir cada casilla antes de publicar.</p><form id="upload"><label>Archivo JSON<input name="file" type="file" accept=".json,application/json" required></label><div class="actions"><button class="btn primary">Importar borrador</button>'+(session.demo?'<button class="btn" type="button" data-fixture>Cargar ejemplo ficticio</button>':'')+'</div></form></section>'+
    state.drafts.filter(d=>d.status!=='published').map(d=>{
      const differences=d.rows.filter(r=>state.assignments.some(a=>slot(a)===slot(r)&&a.physicianId!==r.physicianId));
      return '<section class="card compact"><div class="bar"><h2>Borrador</h2><span class="pill">'+(d.status==='reviewed'?'Revisado':'Pendiente de revisión')+'</span></div><p>'+d.period.from+' a '+d.period.to+' · '+d.rows.length+' casillas · '+differences.length+' titulares distintos del publicado</p>'+
      (d.base!==state.revision?'<p class="banner">El calendario cambió desde esta importación.</p>':'')+
      (d.errors.length?'<p class="banner">'+d.errors.length+' incidencias. '+escape(d.errors[0])+'</p>':'')+
      '<div class="scroll">'+d.rows.map(r=>{
        const previous=state.assignments.find(a=>slot(a)===slot(r));
        const conflict=previous && previous.physicianId!==r.physicianId;
        return '<div class="row line"><div><strong>'+r.date+' · '+names[r.position]+'</strong><p>'+(r.physicianId?name(r.physicianId):'Sin identificar')+'</p>'+
        (conflict?'<p class="source">Publicado: '+name(previous.physicianId)+(previous.protected?' · Cambio protegido':'')+'</p>':'')+'</div><button class="btn" data-edit="'+d.id+'|'+slot(r)+'">Corregir</button></div>';
      }).join('')+'</div><div class="actions">'+(d.status==='draft'?'<button class="btn primary" data-draft="'+d.id+'/review">Confirmar revisión</button>':'<button class="btn primary" data-draft="'+d.id+'/publish">Publicar cuadrante</button>')+'<button class="btn" data-draft="'+d.id+'/discard">Descartar</button></div></section>';
    }).join('')+'</div>';
}
function invitations() {
  const people=Object.values(state.people);
  return '<section class="card compact"><h2 class="headspace">Invitar a un facultativo</h2><form id="invite"><label>Correo<input type="email" name="email" required></label><label>Perfil existente<select name="physicianId"><option value="">Crear perfil</option>'+people.map(p=>'<option value="'+escape(p.id)+'">'+escape(p.name)+'</option>').join('')+'</select></label><label>Nombre visible para perfil nuevo<input name="name" maxlength="100"></label><div><button class="btn primary">Crear invitación</button></div></form>'+
    (invite?'<div class="notice"><p>Comparte este enlace privado con la persona invitada. Caduca en 24 horas.</p><input aria-label="Enlace de invitación" readonly value="'+escape(location.origin+'/#invite='+invite.token)+'"><p>Identificador para JSON: <code>'+escape(invite.physicianId)+'</code></p></div>':'')+
    '<details class="row"><summary>Identificadores para importar</summary>'+people.map(p=>'<p>'+escape(p.name)+' · <code>'+escape(p.id)+'</code></p>').join('')+'</details></section>';
}
function notifications() {
  return '<section class="card compact"><div class="bar"><h2>Bandeja</h2><button class="btn" data-read>Marcar todas como leídas</button></div>'+
    (state.notifications.length?state.notifications.map(n=>'<div class="row"><strong>'+escape(n.message)+'</strong><p>'+new Date(n.at).toLocaleString('es-ES')+(n.read?'':' · Sin leer')+'</p></div>').join(''):'<p class="empty">Todavía no hay notificaciones.</p>')+'</section>';
}
function history() {
  return '<section class="card compact">'+(state.audit.length?state.audit.map(a=>'<article class="row"><strong>'+escape(a.action)+'</strong><p>'+name(a.actor)+' · '+new Date(a.at).toLocaleString('es-ES')+'</p><details><summary>Detalle</summary><code>'+escape(JSON.stringify(a.details))+'</code></details></article>').join(''):'<p class="empty">Todavía no hay actividad.</p>')+'</section>';
}
function render() {
  if (!session?.me) {
    const joining=location.hash.startsWith('#invite=');
    const setup=session?.setup && location.hash.startsWith('#setup=');
    const activation=joining||setup;
    root.innerHTML='<main class="login"><section class="card">'+brand+'<h1>'+(setup?'Activar coordinación':joining?'Activar invitación':'Acceso al cuadrante')+'</h1><p class="muted">'+(activation?'Elige una contraseña para tu cuenta.':'Consulta tus turnos y gestiona cambios con tus compañeros.')+'</p>'+
    (session?.demo&&!joining?'<div class="notice"><p>Demostración con datos ficticios</p><div class="actions"><button class="btn primary" data-demo="coord">Coordinación</button><button class="btn" data-demo="demo-001">Facultativo 01</button><button class="btn" data-demo="demo-002">Facultativo 02</button><button class="btn" data-demo="demo-007">Facultativo 07</button></div></div>':'')+
    '<form id="'+(setup?'setup':joining?'join':'login')+'">'+(joining?'':'<label>Correo<input type="email" name="email" autocomplete="username" required></label>')+
    '<label>Contraseña<input type="password" name="password" autocomplete="'+(activation?'new-password':'current-password')+'" '+(activation?'minlength="14" ':'')+'required></label><button class="btn primary">'+(activation?'Activar cuenta':'Entrar')+'</button></form></section></main>';
    return;
  }
  if (!state) return;
  const nav={service:'Servicio',mine:'Mi calendario',request:'Solicitudes',notifications:'Avisos'};
  if(state.me.role==='coord') Object.assign(nav,{import:'Importar',invite:'Invitaciones',history:'Historial'});
  if(!nav[tab]) tab='service';
  const pending=state.notifications.filter(n=>!n.read).length;
  const views={service:calendar,mine:calendar,request:requests,notifications,import:imports,invite:invitations,history};
  root.innerHTML='<div class="shell"><aside class="sidebar">'+brand+'<nav class="nav" aria-label="Secciones">'+Object.entries(nav).map(([k,v])=>'<button data-tab="'+k+'" '+(tab===k?'aria-current="page"':'')+'>'+v+(k==='notifications'&&pending?' ('+pending+')':'')+'</button>').join('')+'</nav><p class="session">'+escape(state.me.name)+'</p><button class="signout" data-logout>Salir</button></aside>'+
    '<main class="content"><header class="top"><div><h1>'+nav[tab]+'</h1><p class="muted">'+escape(state.me.name)+'</p></div>'+(session.demo?'<span class="pill">Datos ficticios</span>':'')+'</header><p id="connection" class="banner" '+(stale?'':'hidden')+'>Sin conexión con el calendario. Los datos pueden estar desactualizados.</p>'+views[tab]()+'</main></div>';
}
function showDialog(title,html,onSubmit) {
  dialog.innerHTML='<div class="bar"><h2>'+title+'</h2><button class="btn" type="button" id="closeDialog">Cerrar</button></div><form id="dialogForm">'+html+'<p class="dialog-error" role="status"></p><button class="btn primary">Confirmar</button></form>';
  dialog.querySelector('#closeDialog').onclick=()=>dialog.close();
  const form=dialog.querySelector('form');
  form.onsubmit=async event=>{
    event.preventDefault();
    const submit=form.querySelector('button[type=submit],button:not([type])');
    submit.disabled=true;
    try{await onSubmit(Object.fromEntries(new FormData(form)));dialog.close();await refresh({force:true});}
    catch(error){form.querySelector('.dialog-error').textContent=error.message;}
    finally{submit.disabled=false;}
  };
  dialog.showModal();
}
function select(label,id,options) { return '<label>'+label+'<select name="'+id+'">'+options+'</select></label>'; }
function propose(k) {
  const own=state.assignments.find(a=>slot(a)===k);
  showDialog('Pedir cambio','<p>'+names[own.position]+' · '+long(own.date)+'</p>'+
    select('Tipo','type','<option value="swap">Intercambio de dos turnos</option><option value="cover">Pedir cobertura</option>')+
    select('Turno del compañero','target','<option value="">Seleccionar</option>'+state.assignments.filter(a=>a.physicianId!==state.me.id).sort((a,b)=>a.date.localeCompare(b.date)).map(a=>'<option value="'+slot(a)+'">'+a.date+' · '+names[a.position]+' · '+name(a.physicianId)+'</option>').join(''))+
    select('Compañero que cubrirá','recipient','<option value="">Seleccionar</option>'+Object.values(state.people).filter(p=>p.id!==state.me.id).map(p=>'<option value="'+escape(p.id)+'">'+escape(p.name)+'</option>').join(''))+
    '<p class="muted">El compañero debe aceptar y coordinación debe aprobar. Los salientes se actualizan al aplicar el cambio.</p>',
    async data=>{await api('changes',{...data,own:k,ownVersion:own.version,targetVersion:state.assignments.find(a=>slot(a)===data.target)?.version});tab='request';message('Solicitud enviada.');});
  const form=dialog.querySelector('form');
  const update=()=>{form.elements.target.closest('label').hidden=form.elements.type.value!=='swap';form.elements.recipient.closest('label').hidden=form.elements.type.value!=='cover';};
  form.elements.type.onchange=update;update();
}
const fixture={schemaVersion:'1.0',serviceId:'servicio-demo',timezone:'Atlantic/Canary',period:{from:'2026-11-23',to:'2026-11-24'},source:{kind:'manual_transcription',label:'Ejemplo ficticio'},assignments:[
  ['2026-11-23','HUNSC_1','demo-001'],['2026-11-23','HUNSC_2','demo-003'],['2026-11-23','EAP','demo-004'],['2026-11-23','HSUR','demo-005'],['2026-11-23','REF_HUNSC','demo-006'],['2026-11-23','REF_HSUR','demo-008'],
  ['2026-11-24','HUNSC_1','demo-002'],['2026-11-24','HUNSC_2','demo-003'],['2026-11-24','EAP','demo-004'],['2026-11-24','HSUR','demo-005'],['2026-11-24','REF_HUNSC','demo-006'],['2026-11-24','REF_HSUR','demo-008']
].map(([date,position,physicianId])=>({date,position,physicianId}))};
async function setSession(path,data) {
  session.me=await api(path,data);
  if(location.hash) historyReplace();
  tab='service';invite=null;loaded=false;await refresh({force:true});
}
function historyReplace(){ window.history.replaceState(null,'',location.pathname); }
root.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button || !Object.keys(button.dataset).length) return;
  const d=button.dataset;
  button.disabled=true;
  try {
    if(d.demo) await setSession('demo',{id:d.demo});
    if(d.logout!==undefined){await api('logout',{});state=null;session.me=null;invite=null;loaded=false;render();}
    if(d.tab){tab=d.tab;render();await refresh({force:true});}
    if(d.date){selected=d.date;render();}
    if(d.today!==undefined){selected=today;month=today.slice(0,7);render();}
    if(d.month){const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m-1+Number(d.month),1)).toISOString().slice(0,7);selected=month+'-01';render();}
    if(d.change) propose(d.change);
    if(d.request){await api('changes/'+d.request,{});await refresh({force:true});message('Solicitud actualizada.');}
    if(d.read!==undefined){await api('notifications/read',{});await refresh({force:true});}
    if(d.fixture!==undefined){await api('imports',fixture);await refresh({force:true});message('Ejemplo importado como borrador.');}
    if(d.draft){
      const draft=state.drafts.find(a=>a.id===d.draft.split('/')[0]);
      if(d.draft.endsWith('/publish')) {
        showDialog('Publicar cuadrante','<p>Publicar del '+draft.period.from+' al '+draft.period.to+' para todo el servicio.</p>',async()=>{
          await api('imports/'+d.draft,{version:draft.version});selected=draft.period.from;month=selected.slice(0,7);tab='service';message('Cuadrante publicado.');
        });
      } else {await api('imports/'+d.draft,{version:draft.version});await refresh({force:true});}
    }
    if(d.edit){
      const [id,k]=d.edit.split('|'), draft=state.drafts.find(a=>a.id===id), row=draft.rows.find(a=>slot(a)===k);
      showDialog('Corregir casilla','<p>'+row.date+' · '+names[row.position]+'</p>'+select('Titular','physicianId','<option value="">Sin identificar</option>'+Object.values(state.people).map(p=>'<option '+(p.id===row.physicianId?'selected ':'')+'value="'+escape(p.id)+'">'+escape(p.name)+'</option>').join('')),
        data=>api('imports/'+id+'/edit',{version:draft.version,key:k,physicianId:data.physicianId||null}));
    }
  }catch(error){message(error.message);}
  finally{button.disabled=false;}
});
root.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.target, data=Object.fromEntries(new FormData(form));
  const button=form.querySelector('button');button.disabled=true;
  try{
    if(form.id==='login') await setSession('login',data);
    if(form.id==='join') await setSession('join',{...data,token:location.hash.slice(8)});
    if(form.id==='setup') await setSession('setup',{...data,token:location.hash.slice(7)});
    if(form.id==='upload'){if(data.file.size>750000) throw new Error('El archivo supera el límite.');await api('imports',JSON.parse(await data.file.text()));await refresh({force:true});message('Borrador importado.');}
    if(form.id==='invite'){invite=await api('invite',data);await refresh({force:true});}
  }catch(error){message(error.message);}
  finally{button.disabled=false;}
});
try {
  session=await api('session');
  if(session.me) await refresh({force:true});else render();
} catch(error) {root.innerHTML='<main class="login"><section class="card">'+brand+'<h1>GuardiaMI</h1><p>'+escape(error.status===503?error.message:'No se puede conectar al servidor de GuardiaMI.')+'</p></section></main>';}
setInterval(()=>{if(session?.me)refresh();},5000);
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

