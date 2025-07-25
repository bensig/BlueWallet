import './gesture-handler';
import './shim.js';

// Setup crypto polyfills for Noble post-quantum cryptography
import 'react-native-get-random-values';
import { install } from 'react-native-quick-crypto';
install();

import React, { useEffect } from 'react';
import { AppRegistry, LogBox } from 'react-native';

import App from './App';
import A from './blue_modules/analytics';
import { restoreSavedPreferredFiatCurrencyAndExchangeFromStorage } from './blue_modules/currency';

if (!Error.captureStackTrace) {
  // captureStackTrace is only available when debugging
  Error.captureStackTrace = () => {};
}

LogBox.ignoreLogs([
  'Require cycle:',
  'Battery state `unknown` and monitoring disabled, this is normal for simulators and tvOS.',
  'Open debugger to view warnings.',
  'Non-serializable values were found in the navigation state',
]);

const BlueAppComponent = () => {
  useEffect(() => {
    restoreSavedPreferredFiatCurrencyAndExchangeFromStorage();
    A(A.ENUM.INIT);
  }, []);

  return <App />;
};

AppRegistry.registerComponent('BlueWallet', () => BlueAppComponent);
