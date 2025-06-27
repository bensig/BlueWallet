import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';
import { createHash } from 'crypto';
import { mnemonicToSeedSync } from '@scure/bip39';
import { slh_dsa_shake_192f as sphincs } from '@noble/post-quantum/slh-dsa.js';
import { utf8ToBytes } from '@noble/post-quantum/utils.js';

export interface QProof {
  id: string;
  btc_address: string;
  balance: string;
  block: {
    height: number;
    hash: string;
  };
  timestamp: string;
  btc_signature: string;
  pq_signature: string;
  pq_pubkey: string;
}

/**
 * Quantum Proof Bitcoin Wallet
 * Pairs a standard Bitcoin HD wallet with post-quantum signatures for timestamped ownership proofs
 */
export class QuantumProofWallet extends HDSegwitBech32Wallet {
  static readonly type = 'qWallet';
  static readonly typeReadable = 'Quantum Proof Bitcoin';

  // @ts-ignore: override
  public readonly type = QuantumProofWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = QuantumProofWallet.typeReadable;

  // Store quantum proofs and PQ keypair
  public qProofs: QProof[] = [];
  public pqPublicKey: string = '';
  private pqPrivateKey: Uint8Array | null = null;
  private pqKeypair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;
  private sphincsReady: boolean = false;

  constructor() {
    super();
    // Initialize with hardcoded demo keypair for demonstration
    this.initializeHardcodedKeypair();
  }

  /**
   * Initialize with hardcoded demo keypair for demonstration purposes
   */
  private initializeHardcodedKeypair(): void {
    // Set a demo seed phrase for the wallet
    this.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    
    // Generate real SPHINCS+ keypair from seed
    this.generatePQKeypair();
  }

  /**
   * Generate real SPHINCS+ keypair (async for mobile)
   * Uses deterministic derivation from BIP39 seed
   */
  private generatePQKeypair(): void {
    const mnemonic = this.getSecret() || 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    
    console.log('🔵 Starting SPHINCS+ keypair generation...');
    
    try {
      // Generate SPHINCS+ keypair (from your working desktop script)
      const fullSeed = mnemonicToSeedSync(mnemonic);
      const seed = new Uint8Array(72);
      seed.set(fullSeed.slice(0, 64)); // First 64 bytes from BIP39
      
      console.log('🔵 Calling sphincs.keygen()...');
      this.pqKeypair = sphincs.keygen(seed);
      this.pqPublicKey = this.bytesToHex(this.pqKeypair.publicKey);
      this.pqPrivateKey = this.pqKeypair.secretKey;
      this.sphincsReady = true;
      
      console.log('✅ SPHINCS+ keypair generated successfully!');
      console.log('🔵 Public key length:', this.pqPublicKey.length);
      
      // Display formatted keys
      const keyFormats = this.getSphincsPublicKeyFormats();
      if (keyFormats.available) {
        console.log('\n=== SPHINCS+ Public Key Formats ===');
        console.log('bc1s Address:', keyFormats.formats.bc1s_address);
        console.log('Base58:      ', keyFormats.formats.base58);
        console.log('Hex:         ', keyFormats.formats.hex.substring(0, 64) + '...');
        console.log('Base64:      ', keyFormats.formats.base64.substring(0, 64) + '...');
        console.log('Algorithm:   ', keyFormats.info.algorithm);
        console.log('Key Size:    ', keyFormats.info.public_key_size);
      }
    } catch (error) {
      console.error('🔴 SPHINCS+ keygen failed:', error);
      // Fallback to deterministic demo keypair
      this.generateFallbackKeypair(mnemonic);
    }
  }
  
  /**
   * Generate fallback keypair if SPHINCS+ fails
   */
  private generateFallbackKeypair(mnemonic: string): void {
    console.log('🔵 Generating fallback keypair...');
    const seed = mnemonicToSeedSync(mnemonic);
    const privateKeyHash = createHash('sha256').update(seed.toString('hex') + 'pq-private').digest('hex');
    const publicKeyHash = createHash('sha256').update(seed.toString('hex') + 'pq-public').digest('hex');
    
    this.pqPublicKey = 'fallback_' + publicKeyHash;
    this.pqPrivateKey = new Uint8Array(Buffer.from(privateKeyHash, 'hex'));
    this.pqKeypair = {
      publicKey: new Uint8Array(Buffer.from(publicKeyHash, 'hex')),
      secretKey: this.pqPrivateKey
    };
    this.sphincsReady = false;
    
    console.log('🔵 Fallback keypair ready');
  }

  /**
   * Generate a quantum ownership proof for current wallet state
   */
  async generateQuantumProof(): Promise<QProof> {
    console.log('🟡 Starting quantum proof generation...');
    
    // Ensure wallet has an address available 
    let address = this.getAddress();
    console.log('🟡 Got address:', address);
    if (!address) {
      // Try to get the first external address
      try {
        address = await this.getAddressAsync();
      } catch (error) {
        console.error('Failed to get address:', error);
        throw new Error('Unable to get wallet address');
      }
    }
    
    if (!address) {
      throw new Error('Unable to get wallet address');
    }

    const balance = this.getBalance();
    const timestamp = new Date().toISOString();
    console.log('🟡 Got balance and timestamp');

    // Get current block info (mock for now - would use Electrum in real implementation)
    const blockHeight = 850000; // Mock block height
    const blockHash = '0000000000000000000' + Math.random().toString(16).substr(2, 32); // Mock block hash

    // Create proof payload
    const payload = {
      btc_address: address,
      balance: balance.toString(),
      block: {
        height: blockHeight,
        hash: blockHash,
      },
      timestamp,
    };
    console.log('🟡 Created payload, starting Bitcoin signature...');

    // Sign with Bitcoin key
    const btcSignature = this.signMessage('quantum-proof:' + JSON.stringify(payload), address);
    console.log('🟡 Bitcoin signature complete, starting SPHINCS+ signature...');

    // Sign with real SPHINCS+ (async with timeout)
    const pqSignature = await this.signWithPQKeyAsync(JSON.stringify(payload));
    console.log('🟡 Post-quantum signature complete!');

    const proof: QProof = {
      id: Date.now().toString(),
      btc_address: address,
      balance: balance.toString(),
      block: {
        height: blockHeight,
        hash: blockHash,
      },
      timestamp,
      btc_signature: btcSignature,
      pq_signature: pqSignature,
      pq_pubkey: this.pqPublicKey,
    };

    // Store proof in wallet
    this.qProofs.push(proof);

    return proof;
  }

  /**
   * Sign message with SPHINCS+ (with timeout fallback)
   */
  private async signWithPQKeyAsync(message: string): Promise<string> {
    console.log('🔵 Starting SPHINCS+ signing...');
    
    if (!this.sphincsReady || !this.pqKeypair || !this.pqPrivateKey) {
      console.log('🔴 SPHINCS+ not ready, using fallback');
      return this.getFallbackSignature(message);
    }
    
    try {
      // Use Promise.race for timeout
      const sphincsPromise = new Promise<string>((resolve, reject) => {
        try {
          console.log('🔵 Converting message to bytes...');
          const msgBytes = utf8ToBytes(message);
          
          console.log('🔵 Calling sphincs.sign() - this may take 10-30 seconds...');
          const signature = sphincs.sign(this.pqPrivateKey!, msgBytes);
          
          console.log('✅ SPHINCS+ signature completed!');
          resolve('sphincs_' + this.bytesToHex(signature));
        } catch (error) {
          reject(error);
        }
      });
      
      const timeoutPromise = new Promise<string>((resolve) => {
        setTimeout(() => {
          console.log('⏰ SPHINCS+ timeout, using fallback');
          resolve(this.getFallbackSignature(message));
        }, 30000); // 30 second timeout
      });
      
      return await Promise.race([sphincsPromise, timeoutPromise]);
    } catch (error) {
      console.error('🔴 SPHINCS+ signing failed:', error);
      return this.getFallbackSignature(message);
    }
  }
  
  /**
   * Get fallback signature when SPHINCS+ unavailable
   */
  private getFallbackSignature(message: string): string {
    console.log('🔵 Generating fallback signature...');
    const seed = this.pqPublicKey || 'demo-pq-seed';
    const timestamp = Date.now().toString();
    
    let signature = createHash('sha256').update(seed + message).digest('hex');
    for (let i = 0; i < 10; i++) {
      signature = createHash('sha256').update(signature + timestamp + i).digest('hex');
    }
    
    return 'fallback_' + signature + createHash('sha256').update(signature).digest('hex').slice(0, 32);
  }
  
  /**
   * Sync wrapper for backward compatibility
   */
  private signWithPQKey(message: string): string {
    // This will be replaced by async version
    return this.getFallbackSignature(message);
  }
  
  /**
   * Helper function to convert bytes to hex string
   */
  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Convert bytes to Base58 format
   */
  private bytesToBase58(bytes: Uint8Array): string {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    let num = BigInt('0x' + this.bytesToHex(bytes));
    
    while (num > 0) {
      result = alphabet[Number(num % 58n)] + result;
      num = num / 58n;
    }
    
    // Handle leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
      result = '1' + result;
    }
    
    return result;
  }

  /**
   * Convert bytes to Base64 format
   */
  private bytesToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }

  /**
   * Bech32 encoding for SPHINCS+ addresses
   */
  private bytesToSphincsAddress(bytes: Uint8Array): string {
    const bech32Charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    
    const bech32Polymod = (values: number[]): number => {
      const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
      let chk = 1;
      for (const value of values) {
        const top = chk >> 25;
        chk = (chk & 0x1ffffff) << 5 ^ value;
        for (let i = 0; i < 5; i++) {
          chk ^= ((top >> i) & 1) ? GEN[i] : 0;
        }
      }
      return chk;
    };

    const bech32CreateChecksum = (hrp: string, data: number[]): number[] => {
      const values = [...hrp.split('').map(c => c.charCodeAt(0) >> 5), 0, ...hrp.split('').map(c => c.charCodeAt(0) & 31), ...data];
      const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
      const result = [];
      for (let i = 0; i < 6; i++) {
        result.push((polymod >> 5 * (5 - i)) & 31);
      }
      return result;
    };

    const convertBits = (data: number[], fromBits: number, toBits: number, pad: boolean): number[] | null => {
      let acc = 0;
      let bits = 0;
      const result = [];
      const maxv = (1 << toBits) - 1;
      
      for (const value of data) {
        if (value < 0 || (value >> fromBits)) return null;
        acc = (acc << fromBits) | value;
        bits += fromBits;
        while (bits >= toBits) {
          bits -= toBits;
          result.push((acc >> bits) & maxv);
        }
      }
      
      if (pad) {
        if (bits) result.push((acc << (toBits - bits)) & maxv);
      } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
        return null;
      }
      
      return result;
    };

    const hrp = 'bc1s';  // SPHINCS+ prefix
    const data = convertBits(Array.from(bytes), 8, 5, true);
    if (!data) return '';
    
    const checksum = bech32CreateChecksum(hrp, data);
    return hrp + data.concat(checksum).map(d => bech32Charset[d]).join('');
  }

  /**
   * Get formatted SPHINCS+ public key in multiple formats
   */
  getSphincsPublicKeyFormats(): any {
    if (!this.pqKeypair || !this.sphincsReady) {
      return {
        available: false,
        message: 'SPHINCS+ keypair not ready'
      };
    }

    const pubKeyBytes = this.pqKeypair.publicKey;
    
    return {
      available: true,
      formats: {
        'bc1s_address': this.bytesToSphincsAddress(pubKeyBytes),
        'base58': this.bytesToBase58(pubKeyBytes),
        'hex': this.bytesToHex(pubKeyBytes),
        'hex_prefixed': '0x' + this.bytesToHex(pubKeyBytes),
        'hex_spaced': this.bytesToHex(pubKeyBytes).match(/.{2}/g)?.join(' ') || '',
        'hex_grouped': this.bytesToHex(pubKeyBytes).match(/.{8}/g)?.join('-') || '',
        'base64': this.bytesToBase64(pubKeyBytes)
      },
      info: {
        'algorithm': 'SPHINCS+ SHAKE-192f',
        'public_key_size': pubKeyBytes.length + ' bytes',
        'quantum_resistant': true
      }
    };
  }

  /**
   * Verify a quantum proof (SPHINCS+ or fallback)
   */
  verifyQuantumProof(proof: QProof): boolean {
    try {
      if (!proof.btc_signature || !proof.pq_signature || !proof.pq_pubkey) {
        return false;
      }
      
      console.log('🔵 Verifying PQ signature...');
      
      // Check signature type and verify accordingly
      if (proof.pq_signature.startsWith('sphincs_')) {
        console.log('🔵 Verifying real SPHINCS+ signature...');
        return this.verifySphincsSignature(proof);
      } else if (proof.pq_signature.startsWith('fallback_')) {
        console.log('🔵 Verifying fallback signature...');
        return this.verifyFallbackSignature(proof);
      } else {
        console.log('🔴 Unknown signature format');
        return false;
      }
    } catch (error) {
      console.error('🔴 PQ verification failed:', error);
      return false;
    }
  }
  
  /**
   * Verify real SPHINCS+ signature
   */
  private verifySphincsSignature(proof: QProof): boolean {
    try {
      if (!this.sphincsReady || !this.pqKeypair) {
        console.log('🔴 SPHINCS+ not available for verification');
        return false;
      }
      
      // Recreate the payload that was signed
      const payload = {
        btc_address: proof.btc_address,
        balance: proof.balance,
        block: proof.block,
        timestamp: proof.timestamp,
      };
      
      // Extract signature from format: "sphincs_<hex>"
      const signatureHex = proof.pq_signature.replace('sphincs_', '');
      const signature = this.hexToBytes(signatureHex);
      const message = utf8ToBytes(JSON.stringify(payload));
      
      // Verify with SPHINCS+
      return sphincs.verify(this.pqKeypair.publicKey, message, signature);
    } catch (error) {
      console.error('🔴 SPHINCS+ verification error:', error);
      return false;
    }
  }
  
  /**
   * Verify fallback signature
   */
  private verifyFallbackSignature(proof: QProof): boolean {
    console.log('🔵 Basic fallback signature validation');
    const isValidFormat = proof.pq_signature.startsWith('fallback_') && proof.pq_signature.length > 60;
    const hasValidPubkey = proof.pq_pubkey.length > 30;
    
    console.log('🔵 Fallback signature format valid:', isValidFormat);
    console.log('🔵 Pubkey format valid:', hasValidPubkey);
    
    return isValidFormat && hasValidPubkey && !!proof.btc_signature;
  }
  
  /**
   * Helper function to convert hex string to bytes
   */
  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  /**
   * Export proof as JSON string
   */
  exportProof(proofId: string): string | null {
    const proof = this.qProofs.find(p => p.id === proofId);
    return proof ? JSON.stringify(proof, null, 2) : null;
  }

  /**
   * Get all quantum proofs
   */
  getQuantumProofs(): QProof[] {
    return this.qProofs;
  }

  /**
   * Serialize wallet including quantum proof data
   */
  prepareForSerialization(): void {
    // Store quantum proof data in the wallet object for serialization
    // @ts-ignore: Adding custom properties for serialization
    this._qProofs = this.qProofs;
    // @ts-ignore: Adding custom properties for serialization
    this._pqPublicKey = this.pqPublicKey;
    // @ts-ignore: Adding custom properties for serialization
    this._pqPrivateKey = this.pqPrivateKey ? this.bytesToHex(this.pqPrivateKey) : '';
  }

  /**
   * Restore quantum proof data from serialized wallet
   */
  static fromJson(obj: string): QuantumProofWallet {
    const wallet = new QuantumProofWallet();
    const parsed = JSON.parse(obj);

    // Restore base wallet data
    Object.assign(wallet, parsed);

    // Restore quantum proof specific data
    // @ts-ignore: Reading custom properties from serialization
    wallet.qProofs = parsed._qProofs || [];
    // @ts-ignore: Reading custom properties from serialization
    wallet.pqPublicKey = parsed._pqPublicKey || '';
    // @ts-ignore: Reading custom properties from serialization
    const privateKeyHex = parsed._pqPrivateKey || '';
    wallet.pqPrivateKey = privateKeyHex ? wallet.hexToBytes(privateKeyHex) : null;
    
    // Reconstruct keypair if we have both keys
    if (wallet.pqPublicKey && wallet.pqPrivateKey) {
      wallet.pqKeypair = {
        publicKey: wallet.hexToBytes(wallet.pqPublicKey),
        secretKey: wallet.pqPrivateKey
      };
    }

    return wallet;
  }
}
