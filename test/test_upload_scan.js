const http = require('http');
const fs = require('fs');
const path = require('path');

// Test 1: Test /api/settings
http.get('http://localhost:3000/api/settings', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const s = JSON.parse(data);
    console.log('✅ Settings loaded. Default saveFolder:', s.saveFolder);

    // Test 2: Test /api/scan-folder
    const sampleDir = path.join(__dirname, 'sample_images');
    const reqData = JSON.stringify({ folderPath: sampleDir });
    const req = http.request({
      host: 'localhost', port: 3000, path: '/api/scan-folder', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqData) }
    }, (res2) => {
      let data2 = '';
      res2.on('data', c => data2 += c);
      res2.on('end', () => {
        const scan = JSON.parse(data2);
        console.log(`✅ Scan folder found ${scan.count} files with full paths:`);
        console.log('   Sample clip #1 path:', scan.files[0]?.path);
      });
    });
    req.write(reqData);
    req.end();
  });
});
