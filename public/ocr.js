const normalize = value => value.normalize('NFD').replace(/\p{M}/gu,'')
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const iso = date => date.toISOString().slice(0,10);

export function photoDates(from,to) {
  if (![from,to].every(value=>/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error('Indica las fechas de la tabla.');
  const first=new Date(from+'T00:00:00Z'), last=new Date(to+'T00:00:00Z');
  if (!Number.isFinite(+first) || !Number.isFinite(+last) || iso(first)!==from || iso(last)!==to || last<first || +last-first>30*86400000) {
    throw new Error('La foto debe abarcar entre 1 y 31 días consecutivos.');
  }
  return Array.from({length:(last-first)/86400000+1},(_,i)=>iso(new Date(+first+i*86400000)));
}

export function readCells(words,{width,height,dates,columns,divisions,people}) {
  const table=dates.map(()=>columns.map(()=>[]));
  for (const word of words) {
    if (!word.bbox || !word.text?.trim()) continue;
    const {x0,x1,y0,y1}=word.bbox;
    const x=(x0+x1)/2/width, y=(y0+y1)/2/height;
    const row=Math.floor(y*dates.length);
    const col=divisions.findIndex((edge,i)=>i>0&&x>=divisions[i-1]&&x<edge)-1;
    if (table[row]?.[col]) table[row][col].push(word);
  }
  const read = cell => cell.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(word=>word.text).join(' ').trim();
  return table.flatMap((cells,row)=>{
    const date=dates[row];
    const dateText=read(cells[columns.indexOf('date')]);
    const parts=dateText.match(/\d+/g)?.map(Number) ?? [];
    const day=Number(date.slice(8)), month=Number(date.slice(5,7));
    const year=Number(date.slice(0,4));
    const dateOk=parts.length===1 && parts[0]===day ||
      parts.length===2 && parts[0]===day && parts[1]===month ||
      parts.length===3 && ((parts[0]===day && parts[1]===month && [year,year%100].includes(parts[2])) ||
        (parts[0]===year && parts[1]===month && parts[2]===day));
    return columns.flatMap((position,col)=>{
      if (position==='date') return [];
      const text=read(cells[col]);
      const matches=text ? people.filter(person=>normalize(person.name)===normalize(text)) : [];
      const certain=cells[col].every(word=>word.confidence>=65);
      return [{date,position,physicianId:dateOk&&certain&&matches.length===1?matches[0].id:null,
        sourceCell:'Fila '+(row+1)+', columna '+(col+1),
        sourceText:dateOk?text:(text?text+' · ':'')+'Revisa la fecha de esta fila ('+(dateText||'sin leer')+').'}];
    });
  });
}

let library;
function loadLibrary() {
  library ??= new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/ocr/tesseract.min.js';
    script.onload=()=>resolve(window.Tesseract);
    script.onerror=()=>reject(new Error('No se pudo cargar el lector de fotos.'));
    document.head.append(script);
  }).catch(error=>{library=null;throw error;});
  return library;
}

export async function readPhoto(canvas,settings,report) {
  const {createWorker,PSM}=await loadLibrary();
  const worker=await createWorker('spa',1,{
    workerPath:'/ocr/worker.min.js',workerBlobURL:false,
    corePath:'/ocr/tesseract-core-lstm.wasm.js',langPath:new URL('/ocr',location.origin).href,
    logger:status=>report(status.status==='recognizing text'?'Leyendo foto · '+Math.round(status.progress*100)+' %':'Preparando lector de fotos…')
  });
  try {
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
    const {data}=await worker.recognize(canvas,{}, {blocks:true});
    const words=(data.blocks ?? []).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)));
    if (!words.length) throw new Error('No se leyó texto. Prueba una foto más nítida o ajusta el recorte.');
    return readCells(words,{...settings,width:canvas.width,height:canvas.height});
  } finally {
    await worker.terminate();
  }
}

