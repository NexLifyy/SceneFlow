const http = require('http');
http.get('http://localhost:3000/', r => {
  let b = '';
  r.on('data', d => b += d);
  r.on('end', () => {
    console.log('HTTP', r.statusCode);
    console.log('Has Media section:', b.includes('panel-media'));
    console.log('Has Settings section:', b.includes('panel-settings'));
    console.log('Has Captions section:', b.includes('panel-captions'));
    console.log('Has Timeline section:', b.includes('panel-timeline'));
    console.log('Has Export section:', b.includes('panel-export'));
    console.log('Has History drawer:', b.includes('history-drawer'));
    console.log('Has style buttons:', b.includes('caption-styles'));
    console.log('Page size (bytes):', b.length);
  });
});
