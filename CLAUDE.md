# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## BlueWallet Overview

BlueWallet is a Bitcoin and Lightning wallet built with React Native. It's a cross-platform mobile application supporting iOS, Android, and macOS.

## Essential Development Commands

```bash
# Install dependencies
npm install

# iOS setup (required after npm install)
npx pod-install

# Start Metro bundler
npm start

# Run on platforms
npx react-native run-ios
npx react-native run-android

# Testing
npm run test          # Run all tests
npm run unit         # Unit tests only
npm run jest         # Integration tests
npm run lint         # ESLint
npm run tslint       # TypeScript checking

# Run a single test file
npm run jest -- tests/unit/hd-segwit-bech32-wallet.test.js

# E2E Testing
npm run e2e:debug    # Android debug build
npm run e2e:release  # Android release build
```

## Architecture & Code Organization

### Core Directories
- `/class/` - Core wallet logic and Bitcoin functionality. Key classes:
  - `wallets/` - Wallet implementations (HDSegwitBech32Wallet, LegacyWallet, etc.)
  - `deeplinkSchemaMatch.ts` - URL scheme handling
  - `blue-electrum.ts` - Electrum server connectivity

- `/screen/` - Screen components organized by feature:
  - `wallets/` - Wallet management screens
  - `send/` - Transaction creation screens
  - `receive/` - Address generation screens
  - `settings/` - App settings screens

- `/components/` - Reusable UI components (migrating from BlueComponents.js to TypeScript)

- `/blue_modules/` - Core modules:
  - `BlueElectrum.ts` - Electrum client wrapper
  - `encryption.ts` - Storage encryption
  - `analytics.ts` - Analytics wrapper

- `/navigation/` - React Navigation stack definitions with lazy loading

### State Management
- Uses React Context API with multiple providers:
  - `StorageProvider` - Wallet storage and management
  - `SettingsProvider` - App settings
  - Located in `/components/Context/`

### Wallet Types
The app supports multiple wallet types, each with its own class in `/class/wallets/`:
- HD SegWit (BIP84) - `HDSegwitBech32Wallet`
- HD Legacy (BIP44) - `HDLegacyBreadwalletWallet`
- Lightning - `LightningCustodianWallet`
- Multisig - `MultisigHDWallet`
- Watch-only - `WatchOnlyWallet`

### Bitcoin Libraries
- `bitcoinjs-lib` v7 - Core Bitcoin functionality
- Custom Electrum client implementation
- PSBT support for advanced transactions

## Platform-Specific Notes

### iOS
- Minimum iOS 15.1
- Uses CocoaPods (`npx pod-install` after npm install)
- Includes Apple Watch app and widgets
- Xcode project at `/ios/BlueWallet.xcworkspace`

### Android
- Gradle-based build at `/android/`
- ProGuard rules for release builds
- Firebase integration

## Testing Strategy

### Test Types
1. **Unit Tests** (`/tests/unit/`) - Test wallet classes and utilities
2. **Integration Tests** (`/tests/integration/`) - Test wallet operations
3. **E2E Tests** (`/tests/e2e/`) - Detox-based UI tests

### Running Tests
```bash
# Run specific test file
npm run jest -- tests/unit/hd-segwit-bech32-wallet.test.js

# Run tests matching pattern
npm run jest -- --testNamePattern="HDSegwitBech32Wallet"

# Debug tests
npm run jest -- --detectOpenHandles tests/unit/currency.test.js
```

## Code Standards

### TypeScript Migration
- Project is migrating from JavaScript to TypeScript
- New files should be TypeScript
- Type definitions in `/typings/` and `*.d.ts` files

### Import Patterns
- Use absolute imports: `import { BlueCard } from '../../BlueComponents';`
- Lazy load screens: `const WalletsList = lazy(() => import('../screen/wallets/WalletsList'));`

### Commit Conventions
Use prefixes:
- `REL` - Release-related
- `FIX` - Bug fixes
- `ADD` - New features
- `REF` - Refactoring
- `TST` - Tests
- `OPS` - DevOps/build
- `DOC` - Documentation

## Key Technical Concepts

### Electrum Connectivity
- Managed through `/blue_modules/BlueElectrum.ts`
- Automatic server selection and failover
- WebSocket and TCP support

### Transaction Creation
- Fee estimation via Electrum
- UTXO selection algorithms
- RBF (Replace-By-Fee) support
- Batch transaction support

### Storage Encryption
- Optional encryption for wallet storage
- Handled by `/blue_modules/encryption.ts`
- Biometric authentication integration

## Debugging Tips

### React Native Debugger
- Use Flipper for debugging
- React DevTools for component inspection
- Network inspection for Electrum calls

### Common Issues
- iOS: Run `npx pod-install` after dependency changes
- Android: Clean build with `cd android && ./gradlew clean`
- Metro cache: `npx react-native start --reset-cache`