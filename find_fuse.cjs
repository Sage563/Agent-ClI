const fs = require('fs');

const nodePath = process.execPath;
console.log('Searching for fuse in:', nodePath);

const buffer = fs.readFileSync(nodePath);
const text = buffer.toString('binary');

const regex = /NODE_SEA_FUSE_[a-f0-9]{32}/g;
const matches = text.match(regex);

if (matches) {
    console.log('Found fuses:', matches);
} else {
    console.log('No fuses found.');
    // Try searching for just the prefix
    const shortRegex = /NODE_SEA_FUSE_/g;
    const shortMatches = text.match(shortRegex);
    if (shortMatches) {
        console.log('Found prefix NODE_SEA_FUSE_ but no 32-char hex suffix.');
    }
}
