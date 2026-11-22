export const zone = 'Atlantic/Canary';
export const positions = {
  HUNSC_1: 'HUNSC 1ª', HUNSC_2: 'HUNSC 2ª', EAP: 'EAP', HSUR: 'H. Sur',
  REF_HUNSC: 'Refuerzo HUNSC', REF_HSUR: 'Refuerzo H. Sur'
};
export const key = ({date, position}) => date + '/' + position;
export const ref = position => position.startsWith('REF_');
export function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0,10) === value;
}
export function add(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0,10);
}
export function saliente({date,position}) {
  if (ref(position)) return null;
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return dow === 5 ? null : add(date, dow === 6 ? 2 : 1);
}
export function validateRoster(rows) {
  const occupied = new Set();
  for (const row of rows) {
    // All posts begin at 08:00 and end at or before the next 08:00 local.
    const slot = row.date + '/' + row.physicianId;
    if (occupied.has(slot)) return 'Solapamiento de ' + row.physicianId + ' el ' + row.date;
    occupied.add(slot);
  }
  return null;
}
export function inspect(data, people) {
  const {period, assignments} = data ?? {};
  if (data?.schemaVersion !== '1.0' || data?.serviceId !== 'servicio-demo' || data?.timezone !== zone ||
      !day(period?.from) || !day(period?.to) || period.from > period.to || period.to > add(period.from,365) ||
      !Array.isArray(assignments) || assignments.length > 2196) {
    throw Object.assign(new Error('Formato, servicio, zona o período inválido.'), {status:400});
  }
  const rows = [], issues = [], seen = new Set();
  for (const [i, item] of assignments.entries()) {
    if (!item || !day(item.date) || item.date < period.from || item.date > period.to || !Object.hasOwn(positions,item.position)) {
      issues.push('Fila ' + (i+1) + ': fecha o puesto inválido. Corrige el JSON.');
      continue;
    }
    const row = {date:item.date, position:item.position, physicianId:item.physicianId ?? null,
      sourceCell: typeof item.sourceCell === 'string' ? item.sourceCell.slice(0,120) : ''};
    if (seen.has(key(row))) issues.push('Puesto duplicado: ' + key(row) + '. Corrige el JSON.');
    seen.add(key(row));
    rows.push(row);
  }
  for (let date = period.from; date <= period.to; date = add(date,1)) {
    for (const position of Object.keys(positions)) {
      if (seen.has(key({date, position}))) continue;
      rows.push({date,position,physicianId:null,sourceCell:''});
    }
  }
  return {period,rows,issues};
}
export function draftErrors(draft, people) {
  return [...draft.issues, ...draft.rows.flatMap(row => Object.hasOwn(people,row.physicianId ?? '')
    ? [] : ['Revisar titular en ' + key(row)]), ...[validateRoster(draft.rows.filter(r => r.physicianId))].filter(Boolean)];
}

