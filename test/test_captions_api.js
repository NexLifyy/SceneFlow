const http = require('http');

const text = `(0:00) It's a random Tuesday. You're doing something completely
(0:03) ordinary, washing a cup, waiting for a bus, scrolling
(0:06) past a song, and suddenly you miss them. The person who`;

const reqData = JSON.stringify({ text });
const req = http.request({
  host: 'localhost', port: 3000, path: '/api/parse-captions', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqData) }
}, res => {
  let buf = '';
  res.on('data', c => buf += c);
  res.on('end', () => {
    const data = JSON.parse(buf);
    console.log('Lines count:', data.lines.length);
    data.lines.forEach((l, idx) => {
      console.log(`  Line #${idx+1} [${l.startSec}s -> ${l.endSec}s]: "${l.text}"`);
    });
    console.log('Total words:', data.wordCount);
  });
});
req.write(reqData);
req.end();
