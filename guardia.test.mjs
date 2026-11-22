import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createApp,initialState} from './server.mjs';
import {positions,saliente} from './domain.mjs';

test('la activación de coordinación es de uso único y la sesión exige HTTPS',async t=>{
  let persisted=initialState();
  const store={
    async read(){return structuredClone(persisted);},
    async write(change){
      const next=structuredClone(persisted);
      const result=change(next);
      persisted=next;
      return result;
    }
  };
  const token='token-ficticio-de-activación';
  const setupHash=createHash('sha256').update(token).digest('hex');
  const server=createApp({store,setupHash,secure:true}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/gateway?route=';
  const session=async()=>await (await fetch(url+'session')).json();
  const activate=code=>fetch(url+'setup',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:code,email:'coord@example.invalid',password:'contraseña-demo-privada'})});
  assert.equal((await session()).setup,true);
  assert.equal((await activate('incorrecto')).status,403);
  const response=await activate(token);
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict;.*; Secure$/);
  assert.equal(persisted.users.coord.email,'coord@example.invalid');
  assert.equal((await session()).setup,false);
  assert.equal((await activate(token)).status,403);
});

test('salientes y límites de calendario', () => {
  const weeks = [
    ['2026-11-23','2026-11-24'],['2026-11-24','2026-11-25'],['2026-11-25','2026-11-26'],
    ['2026-12-31','2027-01-01'],['2026-11-27',null],['2027-01-30','2027-02-01'],['2027-01-31','2027-02-01']
  ];
  for (const [date,output] of weeks) {
    assert.equal(saliente({date,position:'HUNSC_1'}),output);
    assert.equal(saliente({date,position:'REF_HSUR'}),null);
  }
});

test('invitación, publicación revisada, intercambio, cobertura y protección',async t=>{
  const server=createApp({demo:true}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  function client() {
    let cookie='';
    return async (path,body,expected=200)=>{
      const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      if(response.headers.has('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
      const data=await response.json();
      assert.equal(response.status,expected,JSON.stringify(data));
      return data;
    };
  }
  const coord=client(), a=client(), b=client(), c=client(), guest=client();
  await guest('state',undefined,401);
  await coord('demo',{id:'coord'});
  await a('demo',{id:'demo-001'});
  await b('demo',{id:'demo-002'});
  await c('demo',{id:'demo-007'});
  const invite=await coord('invite',{email:'invitado@guardia.invalid',name:'Facultativo invitado'});
  await guest('join',{token:invite.token,password:'contraseña-de-prueba'});
  await client()('join',{token:invite.token,password:'contraseña-de-prueba'},409);
  const rows = (date,primary) => Object.keys(positions).map((position,i)=>({date,position,physicianId:[primary,'demo-003','demo-004','demo-005','demo-006','demo-008'][i],sourceCell:'fila-'+i}));
  const original={schemaVersion:'1.0',timezone:'Atlantic/Canary',serviceId:'servicio-demo',period:{from:'2026-11-23',to:'2026-11-24'},source:{kind:'manual_transcription',label:'Ficticio'},assignments:[...rows('2026-11-23','demo-001'),...rows('2026-11-24','demo-002')]};
  await a('imports',original,403);
  const {id}=await coord('imports',original);
  assert.equal((await a('state')).assignments.length,0);
  await coord('imports/'+id+'/publish',{version:1},409);
  await coord('imports/'+id+'/review',{version:1});
  await coord('imports/'+id+'/publish',{version:1},409);
  await coord('imports/'+id+'/publish',{version:2});
  assert.equal((await b('state')).assignments.length,12);
  const swap={type:'swap',own:'2026-11-23/HUNSC_1',target:'2026-11-24/HUNSC_1',ownVersion:1,targetVersion:1};
  const request=await a('changes',swap);
  const competing=await a('changes',swap);
  await c('changes/'+request.id+'/accept',{},404);
  await coord('changes/'+request.id+'/approve',{},403);
  await b('changes/'+request.id+'/accept',{});
  assert.equal((await a('state')).assignments[0].physicianId,'demo-001');
  await coord('changes/'+request.id+'/approve',{});
  const shared=await b('state');
  assert.equal(shared.assignments[0].physicianId,'demo-002');
  assert(shared.rests.some(r=>r.date==='2026-11-25' && r.physicianId==='demo-001'));
  assert.equal(shared.changes.find(r=>r.id===competing.id).status,'invalidated');
  assert.ok(shared.notifications.some(n=>n.message.includes('aplicado')));
  const draft=await coord('imports',original);
  await coord('imports/'+draft.id+'/review',{version:1},409);
  assert.equal((await a('state')).assignments[0].physicianId,'demo-002');
  const coverage=await b('changes',{type:'cover',own:'2026-11-23/HUNSC_1',ownVersion:2,recipient:'demo-007'});
  await c('changes/'+coverage.id+'/accept',{});
  await coord('changes/'+coverage.id+'/approve',{});
  assert.equal((await a('state')).assignments[0].physicianId,'demo-007');
  assert.ok((await coord('state')).audit.some(e=>e.action==='Cambio aplicado'));
  for(const path of ['/','/app.js','/manifest.webmanifest','/sw.js']) assert.equal((await fetch(base+path)).status,200);
});

