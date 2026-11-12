const http = require('http');
const payload = {
  files: [
    { name: '0_00-0_03.png', path: 'a', type: 'image' },
    { name: '0_30-0_33.png', path: 'b', type: 'image' },
    { name: '1_02-1_05.png', path: 'c', type: 'image' },
    { name: 'cover.png',     path: 'd', type: 'image' },
  ],
  gapMode: 'extend'
};
const d = JSON.stringify(payload);
const r = http.request({
  host: 'localhost', port: 3000,
  path: '/api/parse-filenames', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
}, (res) => {
  let o = '';
  res.on('data', c => o += c);
  res.on('end', () => {
    const result = JSON.parse(o);
    if (result.clips) {
      console.log('Timeline clips:');
      result.clips.forEach(c => {
        console.log('  #' + c.index + ' ' + c.name + ' | ' + c.startSec + 's to ' + c.endSec + 's | dur=' + c.durationSec + 's | timed=' + c.timed);
      });
    } else {
      console.log('Response:', o);
    }
  });
});
r.write(d); r.end();
