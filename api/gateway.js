import {get, put, BlobPreconditionFailedError} from '@vercel/blob';
import {createHandler, initialState} from '../server.mjs';

const pathname = 'guardia-mi/v1.json';
const environment = process.env.VERCEL_ENV;
const storeId = process.env.BLOB_STORE_ID;
const token = process.env.BLOB_READ_WRITE_TOKEN;
const configured = environment === 'production' && Boolean(storeId || token);
const options = {access:'private', ...(token ? {token} : {storeId})};

async function snapshot() {
  const result = await get(pathname, {...options,useCache:false});
  if (!result) return {state:initialState(), etag:null};
  if (result.statusCode !== 200 || !result.stream || !result.blob.etag) throw new Error('Lectura inválida del almacenamiento.');
  return {state:await new Response(result.stream).json(),etag:result.blob.etag};
}

const handler = createHandler({
  secure:true,
  setupHash:process.env.GUARDIAMI_SETUP_SHA256,
  store:{
    async read() { return (await snapshot()).state; },
    async write(change) {
      for (let i=0; i<4; i++) {
        const {state,etag} = await snapshot();
        const response = change(state);
        try {
          await put(pathname,JSON.stringify(state),{
            ...options,contentType:'application/json',addRandomSuffix:false,
            allowOverwrite:Boolean(etag),...(etag ? {ifMatch:etag} : {})
          });
          return response;
        } catch(error) {
          if (!(error instanceof BlobPreconditionFailedError) &&
              !(etag === null && (await snapshot()).etag)) throw error;
        }
      }
      throw Object.assign(new Error('Otro usuario guardó cambios. Vuelve a intentarlo.'),{status:409});
    }
  }
});

export default function gateway(req,res) {
  if (!configured) {
    res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'El almacenamiento privado de GuardiaMI está pendiente de configuración.'}));
    return;
  }
  return handler(req,res);
}
