#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const keysDir = path.resolve(process.cwd(), 'apps/api/keys');
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

console.log('Generating 2048-bit RSA key pair for RS256 JWT signing...');
const keyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const privPath = path.join(keysDir, 'jwt-private.pem');
const pubPath = path.join(keysDir, 'jwt-public.pem');

fs.writeFileSync(privPath, keyPair.privateKey, 'utf8');
fs.writeFileSync(pubPath, keyPair.publicKey, 'utf8');

console.log(`Saved private key to: ${privPath}`);
console.log(`Saved public key to: ${pubPath}`);
console.log('\nTo use in environment variables (.env):');
console.log(`JWT_PRIVATE_KEY="${keyPair.privateKey.replace(/\n/g, '\\n')}"`);
console.log(`JWT_PUBLIC_KEY="${keyPair.publicKey.replace(/\n/g, '\\n')}"`);
