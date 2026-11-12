const { pickFolder } = require('./src/dialog');

console.log('Testing pickFolder() timeout test (will test if process launches)...');
// We do not wait for user input, just verify it launches without immediate crash
const p = pickFolder();
console.log('pickFolder promise created');
