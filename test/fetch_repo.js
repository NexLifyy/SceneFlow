const https = require('https');
const zlib = require('zlib');

const tarUrl = 'https://registry.npmjs.org/remotion-captions-themes/-/remotion-captions-themes-1.0.8.tgz';

https.get(tarUrl, (res) => {
  const gunzip = zlib.createGunzip();
  let buffer = Buffer.alloc(0);
  res.pipe(gunzip).on('data', chunk => buffer = Buffer.concat([buffer, chunk])).on('end', () => {
    let offset = 0;
    while (offset < buffer.length - 512) {
      const name = buffer.slice(offset, offset + 100).toString('utf8').replace(/\0/g, '').trim();
      const size = parseInt(buffer.slice(offset + 124, offset + 136).toString('utf8').replace(/\0/g, '').trim(), 8);
      offset += 512;
      if (size > 0) {
        const content = buffer.slice(offset, offset + size).toString('utf8');
        if (['pop.tsx', 'grape.tsx', 'hustle.tsx', 'karaoke.tsx'].some(t => name.endsWith(t))) {
          console.log(`\n================== ${name} ==================`);
          console.log(content);
        }
        offset += Math.ceil(size / 512) * 512;
      }
    }
  });
});
