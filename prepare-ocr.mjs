import {copyFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';

const require = createRequire(import.meta.url);
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(createRequire(join(tesseract,'package.json')).resolve('tesseract.js-core/package.json'));
const spanish = dirname(require.resolve('@tesseract.js-data/spa/package.json'));
const output = new URL('./public/ocr/',import.meta.url);
mkdirSync(output,{recursive:true});
for (const [from,file] of [
  [join(tesseract,'dist'),'tesseract.min.js'],[join(tesseract,'dist'),'worker.min.js'],
  [join(tesseract,'dist'),'tesseract.min.js.LICENSE.txt'],[join(tesseract,'dist'),'worker.min.js.LICENSE.txt'],
  [core,'tesseract-core-lstm.wasm.js'],[core,'tesseract-core-lstm.wasm'],
  [join(spanish,'4.0.0_best_int'),'spa.traineddata.gz']
]) copyFileSync(join(from,file),new URL(file,output));
copyFileSync(join(core,'LICENSE'),new URL('core.LICENSE.txt',output));

