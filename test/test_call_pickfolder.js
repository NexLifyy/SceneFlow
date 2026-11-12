const { pickFolder } = require('../src/dialog');

console.log('Calling pickFolder()...');
pickFolder().then(res => {
  console.log('Result:', JSON.stringify(res));
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
