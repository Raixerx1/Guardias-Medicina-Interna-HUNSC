import {photoDates,readPhoto} from '/ocr.js';

const root = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const names = {HUNSC_1:'HUNSC · 1.ª línea',HUNSC_2:'HUNSC · 2.ª línea',EAP:'EAP',HSUR:'Hospital del Sur',REF_HUNSC:'Refuerzo HUNSC',REF_HSUR:'Refuerzo Hospital del Sur'};
const statuses = {requested:'Pendiente del compañero',accepted:'Pendiente de coordinación',applied:'Aplicado',rejected:'Rechazado',cancelled:'Cancelado',invalidated:'Invalidado'};
const isRef = position => position.startsWith('REF_');
const slot = row => row.date+'/'+row.position;
const fmt = (date, options) => new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',...options}).format(new Date(date+'T12:00:00Z'));
const long = date => fmt(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Atlantic/Canary'}).format(new Date());
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session, state, tab='service', selected=today, month=today.slice(0,7), stale=false, noticeTimer, invite=null, loaded=false;
let profileSave=0, savingProfile=false;
let sharedLink=null, photo=null, photoDraft=null;
let servicePosition='';
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
  const started=profileSave;
  if (savingProfile && !force) return;
  try {
    const next=await api('state');
    if (started!==profileSave) return;
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
    const menuOpen=document.querySelector('.mobile-more[open]');
    if (force || (wasStale && tab!=='profile' && !menuOpen) || (JSON.stringify(old)!==JSON.stringify(next) && !dialog.open && !menuOpen && !['import','invite','profile'].includes(tab))) render();
    if (wasStale && tab==='profile' && !force) document.querySelector('#connection')?.setAttribute('hidden','');
  } catch(error) {
    if (started!==profileSave) return;
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
function profile() {
  const {name,email,hasPassword}=state.me;
  const current='<label>Contraseña actual<input type="password" name="currentPassword" autocomplete="current-password" maxlength="128" required></label>';
  const emailField='<input type="email" name="email" autocomplete="username" maxlength="254" value="'+escape(email)+'" '+(hasPassword?'required':'readonly')+'>';
  return '<div class="stack compact">'+
    '<section class="card"><h2 class="headspace">Nombre visible</h2><form id="profile-name"><label>Nombre y apellidos<input name="name" autocomplete="name" maxlength="100" value="'+escape(name)+'" required></label><div><button class="btn primary">Guardar nombre</button></div></form></section>'+
    '<section class="card"><h2 class="headspace">Correo de acceso</h2>'+
    (hasPassword?'<form id="profile-email"><label>Correo electrónico'+emailField+'</label>'+current+'<p class="muted">La próxima vez que entres, usa el correo nuevo.</p><div><button class="btn primary">Guardar correo</button></div></form>':
    '<label>Correo electrónico'+emailField+'</label><p class="muted">Esta cuenta de demostración no tiene contraseña.</p>')+'</section>'+
    (hasPassword?'<section class="card"><h2 class="headspace">Cambiar contraseña</h2><form id="profile-password">'+current+
    '<label>Nueva contraseña<input type="password" name="password" autocomplete="new-password" minlength="14" maxlength="128" required></label>'+
    '<label>Repite la nueva contraseña<input type="password" name="confirmPassword" autocomplete="new-password" minlength="14" maxlength="128" required></label>'+
    '<p class="muted">Usa al menos 14 caracteres. Si cambias el correo o la contraseña, se cerrarán tus otras sesiones.</p><div><button class="btn primary">Guardar contraseña</button></div></form></section>':'')+'</div>';
}
function rowsFor(date) {
  return state.assignments.filter(a=>a.date===date &&
    (tab==='mine'?a.physicianId===state.me.id:!servicePosition||a.position===servicePosition));
}
function restsFor(date) {
  return tab==='mine' ? state.rests.filter(r=>r.date===date&&r.physicianId===state.me.id) : [];
}
function rowHtml(row) {
  const ref=isRef(row.position);
  return '<div class="row line"><div><strong>'+names[row.position]+'</strong><p>'+name(row.physicianId)+' · '+(ref?'08:00–20:00':'08:00–08:00 (+1 día)')+'</p></div><span class="tag '+(ref?'ref':'')+'">'+(ref?'12 h':'24 h')+'</span>'+
    (state.me.id===row.physicianId?'<button class="btn" data-change="'+slot(row)+'">Pedir cambio</button>':'')+'</div>';
}
function positionFilter() {
  const options=Object.entries(names);
  const group=(label,reforcements)=>'<optgroup label="'+label+'">'+options.filter(([position])=>isRef(position)===reforcements)
    .map(([position,label])=>'<option value="'+position+'" '+(servicePosition===position?'selected':'')+'>'+label+'</option>').join('')+'</optgroup>';
  return '<label class="position-filter" for="service-position">Puesto en el calendario<select id="service-position">'+
    '<option value="">Todos los puestos</option>'+group('Guardias · 24 h',false)+group('Refuerzos · 12 h',true)+'</select></label>';
}
function calendarMark(rows,rests,filtered) {
  if (tab==='mine') return [rows.length&&rows.length+' T',rests&&'S'].filter(Boolean).join(' · ');
  if (!filtered) return rows.length?rows.length+'/6':'';
  if (!rows.length) return '';
  const full=state.people[rows[0].physicianId]?.name ?? rows[0].physicianId;
  const words=full.trim().split(/\s+/);
  const short=words.length>1?Array.from(words[0])[0]+'. '+words.at(-1):words[0];
  return '<span class="day-person-wide">'+escape(full)+'</span><span class="day-person-compact">'+escape(short)+'</span>';
}
function dailyAssignments(assignments,filtered) {
  if (tab==='mine'||filtered) return assignments.map(rowHtml).join('');
  return [['Guardias',false],['Refuerzos',true]].map(([label,reinforcements])=>{
    const rows=assignments.filter(row=>isRef(row.position)===reinforcements);
    return rows.length?'<section class="day-turn-group"><h3>'+label+'</h3>'+rows.map(rowHtml).join('')+'</section>':'';
  }).join('');
}
function calendar() {
  const [year,num]=month.split('-').map(Number);
  const first=new Date(Date.UTC(year,num-1,1));
  const offset=(first.getUTCDay()+6)%7;
  const count=new Date(Date.UTC(year,num,0)).getUTCDate();
  const filtered=tab==='service' && servicePosition;
  const cells=Array.from({length:offset},()=>'<span></span>');
  for(let i=1;i<=count;i++){
    const date=month+'-'+String(i).padStart(2,'0');
    const rows=rowsFor(date), rests=restsFor(date).length;
    const description=filtered?(rows.length?names[filtered]+' · '+name(rows[0].physicianId):'Sin turno publicado para '+names[filtered]):
      (rows.length?rows.length+' '+(rows.length===1?'turno':'turnos'):'');
    const label=long(date)+(description?', '+description:'')+(rests?', saliente':'');
    cells.push('<button class="day '+(date===today?'today':'')+'" data-date="'+date+'" aria-label="'+label+'" '+(filtered&&rows.length?'title="'+description+'" ':'')+'aria-pressed="'+(date===selected)+'">'+i+
      '<span class="day-mark">'+calendarMark(rows,rests,filtered)+'</span></button>');
  }
  const assignments=rowsFor(selected).sort((a,b)=>Object.keys(names).indexOf(a.position)-Object.keys(names).indexOf(b.position));
  const rests=restsFor(selected);
  return '<div class="layout"><section class="card"><div class="bar"><h2>'+fmt(month+'-01',{month:'long',year:'numeric'})+'</h2><div class="actions"><button class="btn" data-month="-1" aria-label="Mes anterior">‹</button><button class="btn" data-today>Hoy</button><button class="btn" data-month="1" aria-label="Mes siguiente">›</button></div></div>'+
    (tab==='service'?positionFilter():'')+'<div class="calendar '+(filtered?'calendar-filtered':'')+'">'+['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d=>'<span class="dow">'+d+'</span>').join('')+cells.join('')+'</div>'+(tab==='mine'?'<p class="day-label">T · Turno &nbsp; S · Saliente</p>':'')+'</section>'+
    '<section class="card"><h2>'+ (tab==='mine'?'Mi agenda':filtered?'Turno del día':'Puestos del día')+'</h2><p class="day-label">'+long(selected)+'</p>'+dailyAssignments(assignments,filtered)+rests.map(r=>'<div class="row"><span class="tag rest">Saliente</span><p>'+r.sources.map(s=>names[s.position]+' · '+fmt(s.date,{day:'numeric',month:'short'})).join(' / ')+'</p></div>').join('')+
    (!assignments.length&&!rests.length?'<p class="empty">'+(tab==='mine'?'Sin turnos ni salientes ese día.':filtered?'Sin turno publicado para '+names[filtered]+' ese día.':'Sin cuadrante publicado para ese día.')+'</p>':'')+'</section></div>';
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
const photoColumns=['date',...Object.keys(names)];
function photoForm() {
  return '<section class="card compact"><h2 class="headspace">Importar desde una foto</h2><p class="muted">Usa una foto de frente con una fila por día y siete columnas. Elige el primer y último día y marca las esquinas de las filas de datos, dejando fuera los encabezados.</p>'+
    '<form id="photo-import"><label>Foto del cuadrante<input type="file" name="image" accept="image/*" required></label>'+
    '<div class="date-fields"><label>Primer día<input type="date" name="from" required></label><label>Último día<input type="date" name="to" required></label></div>'+
    '<div id="photo-preview" hidden><canvas class="photo-preview" id="photo-canvas" aria-label="Vista previa de la foto"></canvas><p class="source" id="photo-hint">Marca la esquina superior izquierda y después la inferior derecha.</p></div>'+
    '<details><summary>Ajustar el recorte y las columnas</summary><div class="date-fields">'+
    [['left','Izquierda',0],['top','Arriba',0],['right','Derecha',100],['bottom','Abajo',100]].map(([key,label,value])=>
      '<label>'+label+' (%)<input name="'+key+'" type="number" min="0" max="100" step="0.1" value="'+value+'" required></label>').join('')+'</div>'+
    '<label>Separadores de columnas (%)<input name="divisions" value="12, 27, 42, 57, 72, 86" required></label><p class="source">Seis porcentajes dentro del recorte, de izquierda a derecha. Guíate por las líneas verdes.</p>'+
    '<div class="date-fields">'+photoColumns.map((_,index)=>select('Columna '+(index+1),'column'+index,
      photoColumns.map((value,i)=>'<option value="'+value+'" '+(i===index?'selected':'')+'>'+(value==='date'?'Fecha':names[value])+'</option>').join(''))).join('')+
    '</div></details><p class="source">La imagen se lee en tu dispositivo. Al guardar el borrador se envían las casillas transcritas.</p><p id="photo-status" role="status" aria-live="polite"></p><div><button class="btn primary">Leer foto y crear borrador</button></div></form></section>';
}
function photoBounds(form) {
  return Object.fromEntries(['left','top','right','bottom'].map(key=>[key,Number(form.elements[key].value)/100]));
}
function photoDivisions(value) {
  const edges=value.split(',').map(part=>Number(part.trim())/100);
  if(edges.length!==6||edges.some((edge,i)=>!(edge>(edges[i-1]??0)&&edge<1))) throw new Error('Indica seis separadores crecientes entre 0 y 100.');
  return [0,...edges,1];
}
function paintPhoto(form) {
  const canvas=form.querySelector('canvas'), context=canvas.getContext('2d');
  canvas.width=photo.image.naturalWidth;
  canvas.height=photo.image.naturalHeight;
  const scale=Math.min(1,1200/Math.max(canvas.width,canvas.height));
  canvas.width=Math.round(canvas.width*scale);
  canvas.height=Math.round(canvas.height*scale);
  context.drawImage(photo.image,0,0,canvas.width,canvas.height);
  const {left,top,right,bottom}=photoBounds(form);
  context.strokeStyle='#087b70';
  context.lineWidth=Math.max(2,canvas.width/330);
  context.strokeRect(left*canvas.width,top*canvas.height,(right-left)*canvas.width,(bottom-top)*canvas.height);
  let edges;
  try { edges=photoDivisions(form.elements.divisions.value); } catch { return; }
  context.beginPath();
  for(const edge of edges.slice(1,-1)){
    const x=(left+edge*(right-left))*canvas.width;
    context.moveTo(x,top*canvas.height);context.lineTo(x,bottom*canvas.height);
  }
  context.stroke();
}
function clearPhotoDraft() {
  if(photoDraft) URL.revokeObjectURL(photoDraft.url);
  photoDraft=null;
}
root.addEventListener('change',async event=>{
  if(event.target.id==='service-position'){
    servicePosition=Object.hasOwn(names,event.target.value)?event.target.value:'';
    render();
    document.querySelector('#service-position')?.focus({preventScroll:true});
    return;
  }
  const form=event.target.form;
  if(form?.id!=='photo-import') return;
  if(event.target.name!=='image'){if(photo) paintPhoto(form);return;}
  const file=event.target.files[0];
  const status=form.querySelector('#photo-status');
  photo=null;
  form.querySelector('#photo-preview').hidden=true;
  if(!file) return;
  if(file.size>20*1024*1024){status.textContent='Elige una imagen de hasta 20 MB.';return;}
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();
    image.src=url;
    await image.decode();
    if(event.target.files[0]!==file || !form.isConnected) return;
    photo={image,file,corner:null};
    form.querySelector('#photo-preview').hidden=false;
    status.textContent='';
    paintPhoto(form);
  } catch { status.textContent='No se pudo abrir esta imagen. Prueba con JPG o PNG.'; }
  finally { URL.revokeObjectURL(url); }
});
root.addEventListener('click',event=>{
  if(event.target.id!=='photo-canvas'||!photo) return;
  const canvas=event.target, form=canvas.closest('form'), rect=canvas.getBoundingClientRect();
  const x=Math.max(0,Math.min(100,Math.round(1000*(event.clientX-rect.left)/rect.width)/10));
  const y=Math.max(0,Math.min(100,Math.round(1000*(event.clientY-rect.top)/rect.height)/10));
  const hint=form.querySelector('#photo-hint');
  if(!photo.corner){
    photo.corner={x,y};
    hint.textContent='Ahora marca la esquina inferior derecha.';
    return;
  }
  form.elements.left.value=Math.min(photo.corner.x,x);
  form.elements.top.value=Math.min(photo.corner.y,y);
  form.elements.right.value=Math.max(photo.corner.x,x);
  form.elements.bottom.value=Math.max(photo.corner.y,y);
  photo.corner=null;
  hint.textContent='Recorte marcado. Puedes volver a marcar ambas esquinas.';
  paintPhoto(form);
});
async function importPhoto(form,data) {
  if(!photo || photo.file!==form.elements.image.files[0]) throw new Error('Selecciona una foto compatible.');
  const dates=photoDates(data.from,data.to), divisions=photoDivisions(data.divisions);
  const columns=photoColumns.map((_,i)=>data['column'+i]);
  if(new Set(columns).size!==7||!columns.every(value=>photoColumns.includes(value))) throw new Error('Cada fecha o puesto debe aparecer en una sola columna.');
  const {left,top,right,bottom}=photoBounds(form);
  const image=photo.image;
  const width=(right-left)*image.naturalWidth, height=(bottom-top)*image.naturalHeight;
  if(width<120||height<24) throw new Error('Marca un recorte más amplio que incluya las siete columnas.');
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,2600/Math.max(width,height));
  canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  const context=canvas.getContext('2d');
  context.drawImage(image,left*image.naturalWidth,top*image.naturalHeight,width,height,0,0,canvas.width,canvas.height);
  const status=form.querySelector('#photo-status');
  status.textContent='Preparando lector de fotos…';
  try {
    const assignments=await readPhoto(canvas,{dates,columns,divisions,people:Object.values(state.people)},text=>status.textContent=text);
    if(!session?.me || state?.me.role!=='coord') return;
    const {id}=await api('imports',{schemaVersion:'1.0',serviceId:'servicio-demo',timezone:'Atlantic/Canary',
      period:{from:data.from,to:data.to},source:{kind:'integrated_ocr',label:'Foto'},assignments});
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.83));
    clearPhotoDraft();
    if(blob) photoDraft={id,url:URL.createObjectURL(blob)};
    photo=null;
    await refresh({force:true});
    document.querySelector('#draft-'+id)?.scrollIntoView({block:'start'});
    message('Borrador de foto listo para revisar.');
  } finally { status.textContent=''; }
}
function imports() {
  return '<div class="stack">'+photoForm()+'<section class="card compact"><h2 class="headspace">Importar JSON</h2><form id="upload"><label>Archivo JSON<input name="file" type="file" accept=".json,application/json" required></label><div class="actions"><button class="btn primary">Importar borrador</button>'+(session.demo?'<button class="btn" type="button" data-fixture>Cargar ejemplo ficticio</button>':'')+'</div></form></section>'+
    state.drafts.filter(d=>d.status!=='published').map(d=>{
      const differences=d.rows.filter(r=>state.assignments.some(a=>slot(a)===slot(r)&&a.physicianId!==r.physicianId));
      return '<section class="card compact" id="draft-'+d.id+'"><div class="bar"><h2>'+(d.sourceKind==='photo'?'Borrador de foto':'Borrador')+'</h2><span class="pill">'+(d.status==='reviewed'?'Revisado':'Pendiente de revisión')+'</span></div><p>'+d.period.from+' a '+d.period.to+' · '+d.rows.length+' casillas · '+differences.length+' titulares distintos del publicado</p>'+
      (d.id===photoDraft?.id?'<details class="row"><summary>Comparar con la foto</summary><img class="photo-preview" alt="Foto recortada del cuadrante" src="'+escape(photoDraft.url)+'"></details>':'')+
      (d.sourceKind==='photo'?'<p class="muted">Compara todos los titulares y fechas con la foto original antes de confirmar.</p>':'')+
      (d.base!==state.revision?'<p class="banner">El calendario cambió desde esta importación.</p>':'')+
      (d.errors.length?'<p class="banner">'+d.errors.length+' incidencias. '+escape(d.errors[0])+'</p>':'')+
      '<div class="scroll">'+d.rows.map(r=>{
        const previous=state.assignments.find(a=>slot(a)===slot(r));
        const conflict=previous && previous.physicianId!==r.physicianId;
        return '<div class="row line"><div><strong>'+r.date+' · '+names[r.position]+'</strong><p>'+(r.physicianId?name(r.physicianId):'Sin identificar')+'</p>'+
        (r.sourceText?'<p class="source">Lectura: '+escape(r.sourceText)+'</p>':'')+
        (conflict?'<p class="source">Publicado: '+name(previous.physicianId)+(previous.protected?' · Cambio protegido':'')+'</p>':'')+'</div><button class="btn" data-edit="'+d.id+'|'+slot(r)+'">Corregir</button></div>';
      }).join('')+'</div><div class="actions">'+(d.status==='draft'?'<button class="btn primary" data-draft="'+d.id+'/review">Confirmar revisión</button>':'<button class="btn primary" data-draft="'+d.id+'/publish">Publicar cuadrante</button>')+'<button class="btn" data-draft="'+d.id+'/discard">Descartar</button></div></section>';
    }).join('')+'</div>';
}
function signupControls() {
  const active=state.signupLink?.expires>Date.now();
  const link=active&&sharedLink?.expires===state.signupLink.expires?sharedLink.url:null;
  return (active?'<p class="row">Tiempo restante: <strong id="signup-time">'+signupTime(state.signupLink.expires)+'</strong> · <span id="signup-uses">'+state.signupLink.uses+'</span> altas</p>':
    '<p class="row">No hay un enlace compartido activo.</p>')+
    '<div class="actions"><button class="btn primary" data-signup>'+ (active?'Sustituir enlace':'Crear enlace para el servicio')+'</button>'+(active?'<button class="btn" data-revoke-signup>Desactivar enlace</button>':'')+'</div>'+
    (link?'<label class="notice">Enlace de alta<input id="shared-link" readonly value="'+escape(link)+'"></label><button class="btn" data-copy-signup>Copiar enlace</button>':'');
}
function signupTime(expires) {
  const left=Math.max(0,Math.ceil((expires-Date.now())/1000));
  return Math.floor(left/60)+' min '+String(left%60).padStart(2,'0')+' s';
}
function updateSignupControls() {
  const panel=document.querySelector('#signup-controls');
  if(!panel || panel.querySelector('button:disabled')) return;
  const expires=state?.signupLink?.expires;
  const active=expires>Date.now();
  if(panel.dataset.active!==(active?String(expires):'')){
    panel.dataset.active=active?String(expires):'';
    panel.innerHTML=signupControls();
  }
  if(active){
    panel.querySelector('#signup-time').textContent=signupTime(expires);
    panel.querySelector('#signup-uses').textContent=state.signupLink.uses;
  }
}
function invitations() {
  const people=Object.values(state.people);
  const expires=state.signupLink?.expires;
  return '<div class="stack compact"><section class="card"><h2 class="headspace">Enlace de alta para el servicio</h2><p class="muted">Tus compañeros eligen su nombre visible, correo y contraseña. El enlace caduca una hora después de crearlo. Para admitir más altas, genera otro enlace.</p>'+
    '<div id="signup-controls" data-active="'+(expires>Date.now()?expires:'')+'">'+signupControls()+'</div></section>'+
    '<section class="card"><h2 class="headspace">Invitar a una persona</h2><form id="invite"><label>Correo<input type="email" name="email" required></label><label>Perfil existente<select name="physicianId"><option value="">Crear perfil</option>'+people.map(p=>'<option value="'+escape(p.id)+'">'+escape(p.name)+'</option>').join('')+'</select></label><label>Nombre visible para perfil nuevo<input name="name" maxlength="100"></label><div><button class="btn primary">Crear invitación individual</button></div></form>'+
    (invite?'<div class="notice"><p>Comparte este enlace privado con la persona invitada. Caduca en 24 horas.</p><input aria-label="Enlace de invitación" readonly value="'+escape(location.origin+'/#invite='+invite.token)+'"><p>Identificador para JSON: <code>'+escape(invite.physicianId)+'</code></p></div>':'')+
    '<details class="row"><summary>Identificadores para importar</summary>'+people.map(p=>'<p>'+escape(p.name)+' · <code>'+escape(p.id)+'</code></p>').join('')+'</details></section></div>';
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
    const registering=location.hash.startsWith('#register=');
    const setup=session?.setup && location.hash.startsWith('#setup=');
    const activation=joining||setup||registering;
    root.innerHTML='<main class="login"><section class="card">'+brand+'<h1>'+(registering?'Crear mi cuenta':setup?'Activar coordinación':joining?'Activar invitación':'Acceso al cuadrante')+'</h1><p class="muted">'+(registering?'Elige el nombre que verán tus compañeros en el cuadrante.':activation?'Elige una contraseña para tu cuenta.':'Consulta tus turnos y gestiona cambios con tus compañeros.')+'</p>'+
    (session?.demo&&!activation?'<div class="notice"><p>Demostración con datos ficticios</p><div class="actions"><button class="btn primary" data-demo="coord">Coordinación</button><button class="btn" data-demo="demo-001">Facultativo 01</button><button class="btn" data-demo="demo-002">Facultativo 02</button><button class="btn" data-demo="demo-007">Facultativo 07</button></div></div>':'')+
    '<form id="'+(registering?'register':setup?'setup':joining?'join':'login')+'">'+(registering?'<label>Nombre visible<input name="name" maxlength="100" autocomplete="name" required></label>':'')+(joining?'':'<label>Correo<input type="email" name="email" autocomplete="username" required></label>')+
    '<label>Contraseña<input type="password" name="password" autocomplete="'+(activation?'new-password':'current-password')+'" '+(activation?'minlength="14" maxlength="128" ':'')+'required></label><button class="btn primary">'+(registering?'Registrarme':activation?'Activar cuenta':'Entrar')+'</button></form>'+(registering?'<a href="/">Ya tengo una cuenta</a>':'')+'</section></main>';
    return;
  }
  if (!state) return;
  const nav={service:'Servicio',mine:'Mi calendario',request:'Solicitudes',notifications:'Avisos'};
  if(state.me.role==='coord') Object.assign(nav,{import:'Importar',invite:'Invitaciones',history:'Historial'});
  nav.profile='Mi perfil';
  if(!nav[tab]) tab='service';
  const pending=state.notifications.filter(n=>!n.read).length;
  const views={service:calendar,mine:calendar,request:requests,notifications,import:imports,invite:invitations,history,profile};
  const primary=['service','mine','request'];
  const sectionButton=(k,v)=>'<button type="button" data-tab="'+k+'" '+(tab===k?'aria-current="page"':'')+'>'+v+(k==='notifications'&&pending?' ('+pending+')':'')+'</button>';
  const desktopNav='<nav class="nav" aria-label="Secciones">'+Object.entries(nav).map(([k,v])=>sectionButton(k,v)).join('')+'</nav>';
  const mobileNav='<nav class="mobile-nav" aria-label="Secciones"><div class="mobile-nav-inner">'+
    primary.map(k=>sectionButton(k,k==='mine'?'Mi agenda':nav[k])).join('')+
    '<details class="mobile-more"><summary '+(!primary.includes(tab)?'class="current"':'')+'>Más'+(pending?' <span aria-label="'+pending+' avisos sin leer" class="nav-dot"></span>':'')+'</summary>'+
    '<div class="mobile-menu">'+Object.entries(nav).filter(([k])=>!primary.includes(k)).map(([k,v])=>sectionButton(k,v)).join('')+'</div></details></div></nav>';
  root.innerHTML='<div class="shell"><aside class="sidebar">'+brand+desktopNav+mobileNav+'<p class="session">'+escape(state.me.name)+'</p><button class="signout" data-logout>Salir</button></aside>'+
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
  tab='service';invite=null;sharedLink=null;loaded=false;await refresh({force:true});
}
function historyReplace(){ window.history.replaceState(null,'',location.pathname); }
root.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button || !Object.keys(button.dataset).length) return;
  const d=button.dataset;
  button.disabled=true;
  try {
    if(d.demo) await setSession('demo',{id:d.demo});
    if(d.logout!==undefined){await api('logout',{});state=null;session.me=null;invite=null;sharedLink=null;photo=null;clearPhotoDraft();loaded=false;render();}
    if(d.tab){tab=d.tab;render();await refresh({force:true});}
    if(d.date){selected=d.date;render();}
    if(d.today!==undefined){selected=today;month=today.slice(0,7);render();}
    if(d.month){const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m-1+Number(d.month),1)).toISOString().slice(0,7);selected=month+'-01';render();}
    if(d.change) propose(d.change);
    if(d.request){await api('changes/'+d.request,{});await refresh({force:true});message('Solicitud actualizada.');}
    if(d.read!==undefined){await api('notifications/read',{});await refresh({force:true});}
    if(d.fixture!==undefined){await api('imports',fixture);await refresh({force:true});message('Ejemplo importado como borrador.');}
    if(d.signup!==undefined){
      const created=await api('signup-link',{});
      sharedLink={url:location.origin+'/#register='+created.token,expires:created.expires};
      await refresh({force:true});
      message('Enlace reutilizable creado.');
    }
    if(d.revokeSignup!==undefined){
      await api('signup-link/revoke',{});
      sharedLink=null;await refresh({force:true});message('Enlace desactivado.');
    }
    if(d.copySignup!==undefined) {
      if(!sharedLink || sharedLink.expires<=Date.now()) throw new Error('El enlace ha caducado. Genera uno nuevo.');
      try { await navigator.clipboard.writeText(sharedLink.url); message('Enlace copiado.'); }
      catch { document.querySelector('#shared-link').select(); message('Copia el enlace seleccionado.'); }
    }
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
    if(form.id==='register') await setSession('register',{...data,token:location.hash.slice(10)});
    if(form.id==='setup') await setSession('setup',{...data,token:location.hash.slice(7)});
    if(form.id==='upload'){if(data.file.size>750000) throw new Error('El archivo supera el límite.');await api('imports',JSON.parse(await data.file.text()));await refresh({force:true});message('Borrador importado.');}
    if(form.id==='photo-import') await importPhoto(form,data);
    if(form.id==='invite'){invite=await api('invite',data);await refresh({force:true});}
    if(form.id.startsWith('profile-')){
      const field=form.id.slice(8);
      if(field==='password'){
        if(data.password!==data.confirmPassword) throw new Error('Las contraseñas nuevas no coinciden.');
        delete data.confirmPassword;
      }
      profileSave++;
      savingProfile=true;
      try { session.me=await api('profile/'+field,data); }
      finally { savingProfile=false; }
      await refresh({force:true});
      message({name:'Nombre actualizado.',email:'Correo actualizado.',password:'Contraseña actualizada.'}[field]);
    }
  }catch(error){message(error.message);}
  finally{button.disabled=false;}
});
try {
  session=await api('session');
  if(session.me) await refresh({force:true});else render();
} catch(error) {root.innerHTML='<main class="login"><section class="card">'+brand+'<h1>GuardiaMI</h1><p>'+escape(error.status===503?error.message:'No se puede conectar al servidor de GuardiaMI.')+'</p></section></main>';}
setInterval(()=>{if(session?.me)refresh();},5000);
setInterval(updateSignupControls,1000);
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

