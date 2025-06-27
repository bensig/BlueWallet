/* global __DEV__, localStorage */
if (typeof Buffer === 'undefined') global.Buffer = require('buffer').Buffer;
if (typeof __dirname === 'undefined') global.__dirname = '/';
if (typeof __filename === 'undefined') global.__filename = '';
if (typeof process === 'undefined') {
  global.process = require('process');
} else {
  const bProcess = require('process');
  for (const p in bProcess) {
    if (!(p in process)) {
      process[p] = bProcess[p];
    }
  }
}

process.browser = false;

// global.location = global.location || { port: 80 }
const isDev = typeof __DEV__ === 'boolean' && __DEV__;
process.env.NODE_ENV = isDev ? 'development' : 'production';
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}

// If using the crypto shim, uncomment the following line to ensure
// crypto is loaded first, so it can populate global.crypto
require('crypto');

// Additional polyfills for React Native
// Base64 encoding/decoding polyfills
if (typeof global.atob === 'undefined') {
  global.atob = function(str) {
    return Buffer.from(str, 'base64').toString('binary');
  };
}

if (typeof global.btoa === 'undefined') {
  global.btoa = function(str) {
    return Buffer.from(str, 'binary').toString('base64');
  };
}

if (typeof global.base64ToArrayBuffer === 'undefined') {
  global.base64ToArrayBuffer = function(base64) {
    const binaryString = global.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };
}

if (typeof global.arrayBufferToBase64 === 'undefined') {
  global.arrayBufferToBase64 = function(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return global.btoa(binary);
  };
}

if (typeof global.base64FromArrayBuffer === 'undefined') {
  global.base64FromArrayBuffer = function(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return global.btoa(binary);
  };
}
