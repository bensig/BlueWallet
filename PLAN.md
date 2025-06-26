# Simple Implementation Plan: Quantum Proof Bitcoin Wallet (Demo Version)

## Overview
Add a minimal "Quantum Proof Bitcoin" wallet type that demonstrates the concept of quantum-proofing Bitcoin addresses using fake quantum signatures for demo purposes.

## Simplified Approach
- Extend existing `HDSegwitBech32Wallet` (most common Bitcoin wallet type)
- Use fake quantum hash generation for proof-of-concept
- Minimal UI changes following existing patterns
- No real cryptography - just demo functionality

## Implementation Steps

### Step 1: Create Quantum Proof Wallet Class
**File**: `/class/wallets/quantum-proof-wallet.ts`

```typescript
import { HDSegwitBech32Wallet } from './hd-segwit-bech32-wallet';

export class QuantumProofWallet extends HDSegwitBech32Wallet {
  static readonly type = 'quantumProofWallet';
  static readonly typeReadable = 'Quantum Proof Bitcoin';
  
  public readonly type = QuantumProofWallet.type;
  public readonly typeReadable = QuantumProofWallet.typeReadable;
  
  // Store quantum proofs as simple JSON array
  public qProofs: QProof[] = [];
  
  // Generate fake quantum proof for demo
  generateQuantumProof(): QProof {
    const proof: QProof = {
      id: Date.now().toString(),
      btc_address: this.getAddress(),
      balance: this.getBalance().toString(),
      timestamp: new Date().toISOString(),
      btc_signature: this.signMessage('quantum-proof-demo', this.getAddress()),
      fake_quantum_signature: this.generateFakeQuantumSignature(),
    };
    
    this.qProofs.push(proof);
    return proof;
  }
  
  private generateFakeQuantumSignature(): string {
    // Fake quantum signature for demo - just a hash
    const data = `${this.getAddress()}-${Date.now()}-quantum-proof`;
    return require('crypto').createHash('sha256').update(data).digest('hex');
  }
}

interface QProof {
  id: string;  
  btc_address: string;
  balance: string;
  timestamp: string;
  btc_signature: string;
  fake_quantum_signature: string;
}
```

### Step 2: Register Wallet Type
**File**: `/class/index.ts`
```typescript
// Add this line
export * from './wallets/quantum-proof-wallet';
```

**File**: `/class/wallets/types.ts`
```typescript
// Add to imports
import { QuantumProofWallet } from './quantum-proof-wallet';

// Add to TWallet union type
export type TWallet =
  | QuantumProofWallet  // Add this
  | HDSegwitBech32Wallet
  // ... rest unchanged
```

**File**: `/class/blue-app.ts` (around line 200+ in the switch statement)
```typescript
case QuantumProofWallet.type:
  unserializedWallet = QuantumProofWallet.fromJson(key) as unknown as QuantumProofWallet;
  break;
```

### Step 3: Add to Wallet Creation UI
**File**: `/screen/wallets/Add.tsx`

Find the wallet creation section and add new option:
```typescript
// Add after existing wallet options (around line 340)
else if (selectedIndex === 3) {  // Adjust index based on current options
  w = new QuantumProofWallet();
  w.setLabel(label || 'Quantum Proof Bitcoin');
}
```

Add button configuration:
```typescript
// In the button configuration area
{
  text: 'Quantum Proof Bitcoin',
  subtext: 'Bitcoin with quantum-proof signatures',
  // Use existing Bitcoin icon or add quantum-specific one later
}
```

### Step 4: Add Quantum Proofs to Wallet Details
**File**: `/screen/wallets/details.tsx`

Add a simple "Generate Quantum Proof" button for quantum wallets:
```typescript
// Check if wallet is quantum proof type
if (wallet.type === QuantumProofWallet.type) {
  // Add button to generate proof
  // Add list to display existing proofs
}
```

### Step 5: Simple Quantum Proof Display
Create basic component to show proofs:
```typescript
// In wallet details, show quantum proofs
{wallet.qProofs.map(proof => (
  <View key={proof.id}>
    <Text>Proof: {proof.id}</Text>
    <Text>Address: {proof.btc_address}</Text>
    <Text>Time: {proof.timestamp}</Text>
    <Text>Quantum Sig: {proof.fake_quantum_signature.substring(0, 16)}...</Text>
  </View>
))}
```

## Files to Create/Modify

### New Files:
1. `/class/wallets/quantum-proof-wallet.ts` - Main wallet class

### Files to Modify:
1. `/class/index.ts` - Export new wallet
2. `/class/wallets/types.ts` - Add to type system  
3. `/class/blue-app.ts` - Add deserialization
4. `/screen/wallets/Add.tsx` - Add to wallet creation
5. `/screen/wallets/details.tsx` - Add quantum proof UI

## Timeline
- **Day 1**: Create wallet class and register it
- **Day 2**: Add to wallet creation UI
- **Day 3**: Add quantum proof generation and display
- **Day 4**: Testing and refinement

## Demo Features
- [x] Create quantum proof Bitcoin wallet (inherits all Bitcoin functionality)
- [x] Generate fake quantum proofs with timestamps
- [x] Display quantum proofs in wallet details
- [x] Export/share quantum proofs as JSON
- [x] Minimal UI integration following existing patterns

## Future Enhancements
- Replace fake quantum signatures with real post-quantum cryptography
- Add external verification
- Add blockchain anchoring
- Add batch proof generation

This simplified approach gets a working demo with minimal code changes while following BlueWallet's existing patterns.