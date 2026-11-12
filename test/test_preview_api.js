const http = require('http');
const p = encodeURIComponent('d:\\Apps\\video export\\frame-maker\\test\\sample_images\\0_00-0_03.png');
http.get('http://localhost:3000/api/media-preview?path=' + p, r => {
  console.log('Preview HTTP status:', r.statusCode, 'content-type:', r.headers['content-type']);
});
