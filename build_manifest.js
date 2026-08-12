const fs = require('fs');

const code = fs.readFileSync('index.ts', 'utf8');

const manifest = JSON.parse(fs.readFileSync('./seanime-mikan-provider.json', 'utf8'));

manifest.payload = code;
manifest.payloadURI = "";

fs.writeFileSync('./seanime-mikan-provider.json', JSON.stringify(manifest, null, 4));