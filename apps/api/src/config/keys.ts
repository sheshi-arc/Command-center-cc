import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ENV } from './env.js';

let privateKey: string;
let publicKey: string;

export function getJwtKeys(): { privateKey: string; publicKey: string } {
  if (privateKey && publicKey) {
    return { privateKey, publicKey };
  }

  // 1. Read directly from environment variables if provided
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY) {
    privateKey = process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
    publicKey = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
    return { privateKey, publicKey };
  }

  const keysDir = path.resolve(process.cwd(), 'keys');
  const privateKeyPath = path.resolve(process.cwd(), ENV.JWT_PRIVATE_KEY_PATH);
  const publicKeyPath = path.resolve(process.cwd(), ENV.JWT_PUBLIC_KEY_PATH);

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    return { privateKey, publicKey };
  }

  // Auto-generate 2048-bit RSA keypair if missing
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

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

  fs.writeFileSync(privateKeyPath, keyPair.privateKey, 'utf8');
  fs.writeFileSync(publicKeyPath, keyPair.publicKey, 'utf8');

  privateKey = keyPair.privateKey;
  publicKey = keyPair.publicKey;

  return { privateKey, publicKey };
}
