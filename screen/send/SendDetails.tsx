import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useFocusEffect, useRoute, useLocale } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Icon } from '@rneui/themed';
import assert from 'assert';
import BigNumber from 'bignumber.js';
import { TOptions } from 'bip21';
import * as bitcoin from 'bitcoinjs-lib';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  findNodeHandle,
  FlatList,
  Keyboard,
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import { btcToSatoshi, fiatToBTC } from '../../blue_modules/currency';
import * as fs from '../../blue_modules/fs';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { BlueText } from '../../BlueComponents';
import { HDSegwitBech32Wallet, MultisigHDWallet, WatchOnlyWallet } from '../../class';
import { ContactList } from '../../class/contact-list';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import { CreateTransactionTarget, CreateTransactionUtxo, TWallet } from '../../class/wallets/types';
import AddressInput from '../../components/AddressInput';
import presentAlert from '../../components/Alert';
import * as AmountInput from '../../components/AmountInput';
import Button from '../../components/Button';
import CoinsSelected from '../../components/CoinsSelected';
import { DismissKeyboardInputAccessory, DismissKeyboardInputAccessoryViewID } from '../../components/DismissKeyboardInputAccessory';
import HeaderMenuButton from '../../components/HeaderMenuButton';
import InputAccessoryAllFunds, { InputAccessoryAllFundsAccessoryViewID } from '../../components/InputAccessoryAllFunds';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { Action } from '../../components/types';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useKeyboard } from '../../hooks/useKeyboard';
import loc, { formatBalance, formatBalanceWithoutSuffix } from '../../loc';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import NetworkTransactionFees, { NetworkTransactionFee, NetworkTransactionFeeType } from '../../models/networkTransactionFees';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';
import { CommonToolTipActions, ToolTipAction } from '../../typings/CommonToolTipActions';
import ActionSheet from '../ActionSheet';

interface IPaymentDestinations {
  address: string; // btc address or payment code
  amountSats?: number | string;
  amount?: string | number | 'MAX';
  key: string; // random id to look up this record
  unit: BitcoinUnit;
}

export interface IFee {
  current: number | null;
  slowFee: number | null;
  mediumFee: number | null;
  fastestFee: number | null;
}
type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'SendDetails'>;
type RouteProps = RouteProp<SendDetailsStackParamList, 'SendDetails'>;

const SendDetails = () => {
  const { wallets, sleep, txMetadata, saveToDisk } = useStorage();
  const navigation = useExtendedNavigation<NavigationProps>();
  const { direction } = useLocale();
  const selectedDataProcessor = useRef<ToolTipAction | undefined>();
  const setParams = navigation.setParams;
  const route = useRoute<RouteProps>();
  const feeUnit = route.params?.feeUnit ?? BitcoinUnit.BTC;
  const amountUnit = route.params?.amountUnit ?? BitcoinUnit.BTC;
  const frozenBalance = route.params?.frozenBalance ?? 0;
  const transactionMemo = route.params?.transactionMemo;
  const utxos = route.params?.utxos;
  const payjoinUrl = route.params?.payjoinUrl;
  const isTransactionReplaceable = route.params?.isTransactionReplaceable;
  const routeParams = route.params;
  const scrollView = useRef<FlatList<any>>(null);
  const scrollIndex = useRef(0);
  const { colors } = useTheme();

  // state
  const [dimensions, setDimensions] = useState({ width: Dimensions.get('window').width, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [wallet, setWallet] = useState<TWallet | null>(null);
  const { isVisible } = useKeyboard();
  const [addresses, setAddresses] = useState<IPaymentDestinations[]>([{ address: '', key: String(Math.random()), unit: amountUnit }]);
  const [networkTransactionFees, setNetworkTransactionFees] = useState(new NetworkTransactionFee(3, 2, 1));
  const [networkTransactionFeesIsLoading, setNetworkTransactionFeesIsLoading] = useState(false);
  const [customFee, setCustomFee] = useState<string | null>(null);
  const [selectedPresetFeeRate, setSelectedPresetFeeRate] = useState<string | null>(null);
  const [feePrecalc, setFeePrecalc] = useState<IFee>({ current: null, slowFee: null, mediumFee: null, fastestFee: null });
  const [changeAddress, setChangeAddress] = useState<string | null>(null);
  const [dumb, setDumb] = useState(false);
  const { isEditable } = routeParams;
  // if utxo is limited we use it to calculate available balance
  const balance: number = utxos ? utxos.reduce((prev, curr) => prev + curr.value, 0) : (wallet?.getBalance() ?? 0);
  const allBalance = formatBalanceWithoutSuffix(balance, BitcoinUnit.BTC, true);

  // if cutomFee is not set, we need to choose highest possible fee for wallet balance
  // if there are no funds for even Slow option, use 1 sat/vbyte fee
  const feeRate = useMemo(() => {
    console.log('SendDetails: feeRate useMemo - customFee:', customFee);
    console.log('SendDetails: feeRate useMemo - selectedPresetFeeRate:', selectedPresetFeeRate);
    console.log('SendDetails: feeRate useMemo - feePrecalc:', feePrecalc);
    console.log('SendDetails: feeRate useMemo - networkTransactionFees:', networkTransactionFees);

    if (customFee) {
      console.log('SendDetails: Using customFee:', customFee);
      return customFee;
    }

    if (selectedPresetFeeRate) {
      console.log('SendDetails: Using selectedPresetFeeRate:', selectedPresetFeeRate);
      return selectedPresetFeeRate;
    }

    // If we have precalculated fees, use them to determine the default fee
    if (feePrecalc.slowFee !== null) {
      let initialFee;
      if (feePrecalc.fastestFee !== null) {
        initialFee = String(networkTransactionFees.fastestFee);
        console.log('SendDetails: Using fastestFee:', initialFee);
      } else if (feePrecalc.mediumFee !== null) {
        initialFee = String(networkTransactionFees.mediumFee);
        console.log('SendDetails: Using mediumFee:', initialFee);
      } else {
        initialFee = String(networkTransactionFees.slowFee);
        console.log('SendDetails: Using slowFee:', initialFee);
      }
      console.log('SendDetails: Final feeRate:', initialFee);
      return initialFee;
    }

    // If no precalc fees yet, default to fastestFee from network fees
    const defaultFee = String(networkTransactionFees.fastestFee);
    console.log('SendDetails: No precalc fees yet, using default networkTransactionFees.fastestFee:', defaultFee);
    return defaultFee;
  }, [customFee, selectedPresetFeeRate, feePrecalc, networkTransactionFees]);

  useEffect(() => {
    // decode route params
    const currentAddress = addresses[scrollIndex.current];
    if (routeParams.uri) {
      try {
        const { address, amount, memo, payjoinUrl: pjUrl } = DeeplinkSchemaMatch.decodeBitcoinUri(routeParams.uri);

        setAddresses(addrs => {
          addrs[scrollIndex.current].unit = BitcoinUnit.BTC;
          return [...addrs];
        });

        setAddresses(addrs => {
          if (currentAddress) {
            currentAddress.address = address;
            if (Number(amount) > 0) {
              currentAddress.amount = amount!;
              currentAddress.amountSats = btcToSatoshi(amount!);
            }
            addrs[scrollIndex.current] = currentAddress;
            return [...addrs];
          } else {
            return [...addrs, { address, amount, amountSats: btcToSatoshi(amount!), key: String(Math.random()), unit: amountUnit }];
          }
        });

        if (memo?.trim().length > 0) {
          setParams({ transactionMemo: memo });
        }
        setParams({ payjoinUrl: pjUrl, amountUnit: BitcoinUnit.BTC });
      } catch (error) {
        console.log(error);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ title: loc.errors.error, message: loc.send.details_error_decode });
      }
    } else if (routeParams.address) {
      // screen was called with `address` parameter, so we just prefill it
      setAddresses(prevAddresses => {
        const updatedAddresses = [...prevAddresses];
        updatedAddresses[0] = {
          ...updatedAddresses[0],
          address: routeParams.address!,
          amount: 0,
          amountSats: 0,
        };
        return updatedAddresses;
      });
    } else if (routeParams.addRecipientParams) {
      // used to add a recipient, mainly from contacts aka paymentcodes screen
      const index = addresses.length === 0 ? 0 : scrollIndex.current;
      const { address, amount } = routeParams.addRecipientParams;

      setAddresses(prevAddresses => {
        const updatedAddresses = [...prevAddresses];
        if (address) {
          updatedAddresses[index] = {
            ...updatedAddresses[index],
            address,
            amount: amount ?? updatedAddresses[index].amount,
            amountSats: amount ? btcToSatoshi(amount) : updatedAddresses[index].amountSats,
          };
        }
        return updatedAddresses;
      });

      // @ts-ignore: Fix later
      setParams(prevParams => ({ ...prevParams, addRecipientParams: undefined }));
    } else {
      setAddresses([{ address: '', key: String(Math.random()), unit: amountUnit }]); // key is for the FlatList
    }
    // this effect only to run once when screen is mounted or params change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams.uri, routeParams.address, routeParams.addRecipientParams]);

  useEffect(() => {
    // check if we have a suitable wallet
    const suitable = wallets.filter(w => w.chain === Chain.ONCHAIN && w.allowSend());
    if (suitable.length === 0) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      presentAlert({ title: loc.errors.error, message: loc.send.details_wallet_before_tx });
      navigation.goBack();
      return;
    }
    const newWallet = (routeParams.walletID && wallets.find(w => w.getID() === routeParams.walletID)) || suitable[0];
    setWallet(newWallet);
    setParams({ feeUnit: newWallet.getPreferredBalanceUnit(), amountUnit: newWallet.getPreferredBalanceUnit() });

    // we are ready!
    setIsLoading(false);

    // load cached fees
    AsyncStorage.getItem(NetworkTransactionFee.StorageKey)
      .then(res => {
        if (!res) return;
        const fees = JSON.parse(res);
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
      })
      .catch(e => console.log('loading cached recommendedFees error', e));

    // load fresh fees from servers

    setNetworkTransactionFeesIsLoading(true);
    NetworkTransactionFees.recommendedFees()
      .then(async fees => {
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
        await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(fees));
      })
      .catch(e => console.log('loading recommendedFees error', e))
      .finally(() => {
        setNetworkTransactionFeesIsLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // change header and reset state on wallet change
  useEffect(() => {
    if (!wallet) return;

    // reset other values
    setChangeAddress(null);
    setParams({
      utxos: null,
      isTransactionReplaceable: wallet.type === HDSegwitBech32Wallet.type && !routeParams.isTransactionReplaceable ? true : undefined,
    });
    // update wallet UTXO
    wallet
      .fetchUtxo()
      .then(() => {
        // we need to re-calculate fees
        setDumb(v => !v);
      })
      .catch(e => console.log('fetchUtxo error', e));
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // recalc fees in effect so we don't block render
  useEffect(() => {
    if (!wallet) return; // wait for it
    const fees = networkTransactionFees;
    const requestedSatPerByte = Number(feeRate);
    const lutxo = utxos || wallet.getUtxo();
    let frozen = 0;
    if (!utxos) {
      // if utxo is not limited search for frozen outputs and calc it's balance
      frozen = wallet
        .getUtxo(true)
        .filter(o => !lutxo.some(i => i.txid === o.txid && i.vout === o.vout))
        .reduce((prev, curr) => prev + curr.value, 0);
    }

    const options = [
      { key: 'current', fee: requestedSatPerByte },
      { key: 'slowFee', fee: fees.slowFee },
      { key: 'mediumFee', fee: fees.mediumFee },
      { key: 'fastestFee', fee: fees.fastestFee },
    ] as const;

    const newFeePrecalc: /* Record<string, any> */ IFee = { ...feePrecalc };

    let targets = [];
    for (const transaction of addresses) {
      if (transaction.amount === BitcoinUnit.MAX) {
        // single output with MAX
        targets = [{ address: transaction.address }];
        break;
      }
      const value = transaction.amountSats;
      if (Number(value) > 0) {
        targets.push({ address: transaction.address, value });
      } else if (transaction.amount) {
        if (btcToSatoshi(transaction.amount) > 0) {
          targets.push({ address: transaction.address, value: btcToSatoshi(transaction.amount) });
        }
      }
    }

    // if targets is empty, insert dust
    if (targets.length === 0) {
      targets.push({ address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV', value: 546 });
    }

    // replace wrong addresses with dump
    targets = targets.map(t => {
      if (!wallet.isAddressValid(t.address)) {
        return { ...t, address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV' };
      } else {
        return t;
      }
    });

    for (const opt of options) {
      let flag = false;
      while (true) {
        try {
          const { fee } = wallet.coinselect(lutxo, targets, opt.fee);
          newFeePrecalc[opt.key] = fee;
          break;
        } catch (e: any) {
          if (e.message.includes('Not enough') && !flag) {
            flag = true;
            targets = targets.map((t, index) => (index > 0 ? { ...t, value: 546 } : { address: t.address }));
            continue;
          }
          newFeePrecalc[opt.key] = null;
          break;
        }
      }
    }

    setFeePrecalc(newFeePrecalc);
    setParams({ frozenBalance: frozen });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, networkTransactionFees, utxos, addresses, feeRate, dumb]);

  // we need to re-calculate fees if user opens-closes coin control
  useFocusEffect(
    useCallback(() => {
      setIsLoading(false);
      setDumb(v => !v);
      return () => {};
    }, []),
  );

  const handleLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setDimensions({ width, height });
  };

  const getChangeAddressAsync = async () => {
    if (changeAddress) return changeAddress; // cache

    let change;
    if (WatchOnlyWallet.type === wallet?.type && !wallet.isHd()) {
      // plain watchonly - just get the address
      change = wallet.getAddress();
    } else {
      // otherwise, lets call widely-used getChangeAddressAsync()
      try {
        change = await Promise.race([sleep(2000), wallet?.getChangeAddressAsync()]);
      } catch (_) {}

      if (!change) {
        // either sleep expired or getChangeAddressAsync threw an exception
        if (wallet instanceof AbstractHDElectrumWallet) {
          change = wallet._getInternalAddressByIndex(wallet.getNextFreeChangeAddressIndex());
        } else {
          // legacy wallets
          change = wallet?.getAddress();
        }
      }
    }

    if (change) setChangeAddress(change); // cache

    return change;
  };
  /**
   * TODO: refactor this mess, get rid of regexp, use https://github.com/bitcoinjs/bitcoinjs-lib/issues/890 etc etc
   *
   * @param data {String} Can be address or `bitcoin:xxxxxxx` uri scheme, or invalid garbage
   */

  const processAddressData = useCallback(
    (data: string | { data?: any }) => {
      assert(wallet, 'Internal error: wallet not set');
      if (typeof data !== 'string') {
        data = String(data.data);
      }
      const currentIndex = scrollIndex.current;
      setIsLoading(true);
      if (!data.replace) {
        // user probably scanned PSBT and got an object instead of string..?
        setIsLoading(false);
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        return presentAlert({ title: loc.errors.error, message: loc.send.details_address_field_is_not_valid });
      }

      const cl = new ContactList();

      const dataWithoutSchema = data.replace('bitcoin:', '').replace('BITCOIN:', '');
      if (wallet.isAddressValid(dataWithoutSchema) || cl.isPaymentCodeValid(dataWithoutSchema)) {
        setAddresses(addrs => {
          addrs[scrollIndex.current].address = dataWithoutSchema;
          return [...addrs];
        });
        setIsLoading(false);
        setTimeout(() => scrollView.current?.scrollToIndex({ index: currentIndex, animated: false }), 50);
        return;
      }

      let address = '';
      let options: TOptions;
      try {
        if (!data.toLowerCase().startsWith('bitcoin:')) data = `bitcoin:${data}`;
        const decoded = DeeplinkSchemaMatch.bip21decode(data);
        address = decoded.address;
        options = decoded.options;
      } catch (error) {
        data = data.replace(/(amount)=([^&]+)/g, '').replace(/(amount)=([^&]+)&/g, '');
        const decoded = DeeplinkSchemaMatch.bip21decode(data);
        decoded.options.amount = 0;
        address = decoded.address;
        options = decoded.options;
      }

      console.log('options', options);
      if (wallet.isAddressValid(address)) {
        setAddresses(addrs => {
          addrs[scrollIndex.current].address = address;
          addrs[scrollIndex.current].amount = options?.amount ?? 0;
          addrs[scrollIndex.current].amountSats = new BigNumber(options?.amount ?? 0).multipliedBy(100000000).toNumber();
          return [...addrs];
        });
        setAddresses(addrs => {
          addrs[scrollIndex.current].unit = BitcoinUnit.BTC;
          return [...addrs];
        });
        setParams({ transactionMemo: options.label || '', amountUnit: BitcoinUnit.BTC, payjoinUrl: options.pj || '' }); // there used to be `options.message` here as well. bug?
        // RN Bug: contentOffset gets reset to 0 when state changes. Remove code once this bug is resolved.
        setTimeout(() => scrollView.current?.scrollToIndex({ index: currentIndex, animated: false }), 50);
      }

      setIsLoading(false);
    },
    [setParams, wallet],
  );

  const createTransaction = async () => {
    assert(wallet, 'Internal error: wallet is not set');
    Keyboard.dismiss();
    setIsLoading(true);
    const requestedSatPerByte = feeRate;
    for (const [index, transaction] of addresses.entries()) {
      let error;
      if (!transaction.amount || Number(transaction.amount) < 0 || parseFloat(String(transaction.amount)) === 0) {
        error = loc.send.details_amount_field_is_not_valid;
        console.log('validation error');
      } else if (parseFloat(String(transaction.amountSats)) <= 500) {
        error = loc.send.details_amount_field_is_less_than_minimum_amount_sat;
        console.log('validation error');
      } else if (!requestedSatPerByte || parseFloat(requestedSatPerByte) < 1) {
        error = loc.send.details_fee_field_is_not_valid;
        console.log('validation error');
      } else if (!transaction.address) {
        error = loc.send.details_address_field_is_not_valid;
        console.log('validation error');
      } else if (balance - Number(transaction.amountSats) < 0) {
        // first sanity check is that sending amount is not bigger than available balance
        error = frozenBalance > 0 ? loc.send.details_total_exceeds_balance_frozen : loc.send.details_total_exceeds_balance;
        console.log('validation error');
      } else if (transaction.address) {
        const address = transaction.address.trim().toLowerCase();
        if (address.startsWith('lnb') || address.startsWith('lightning:lnb')) {
          error = loc.send.provided_address_is_invoice;
          console.log('validation error');
        }
      }

      if (!error) {
        const cl = new ContactList();
        if (!wallet.isAddressValid(transaction.address) && !cl.isPaymentCodeValid(transaction.address)) {
          console.log('validation error');
          error = loc.send.details_address_field_is_not_valid;
        }
      }

      // validating payment codes, if any
      if (!error) {
        if (transaction.address.startsWith('sp1')) {
          if (!wallet.allowSilentPaymentSend()) {
            console.log('validation error');
            error = loc.send.cant_send_to_silentpayment_adress;
          }
        }

        if (transaction.address.startsWith('PM')) {
          if (!wallet.allowBIP47()) {
            console.log('validation error');
            error = loc.send.cant_send_to_bip47;
          } else if (!(wallet as unknown as AbstractHDElectrumWallet).getBIP47NotificationTransaction(transaction.address)) {
            console.log('validation error');
            error = loc.send.cant_find_bip47_notification;
          } else {
            // BIP47 is allowed, notif tx is in place, lets sync joint addresses with the receiver
            await (wallet as unknown as AbstractHDElectrumWallet).syncBip47ReceiversAddresses(transaction.address);
          }
        }
      }

      if (error) {
        // Scroll to the recipient that caused the error with animation
        scrollView.current?.scrollToIndex({ index, animated: true });
        setIsLoading(false);
        presentAlert({
          title:
            addresses.length > 1
              ? loc.formatString(loc.send.details_recipient_title, { number: index + 1, total: addresses.length })
              : undefined,
          message: error,
        });
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        return;
      }
    }

    try {
      await createPsbtTransaction();
    } catch (Err: any) {
      setIsLoading(false);
      presentAlert({ title: loc.errors.error, message: Err.message });
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
    }
  };
  const navigateToQRCodeScanner = useCallback(() => {
    navigation.navigate('ScanQRCode', {
      showFileImportButton: true,
    });
  }, [navigation]);

  const createPsbtTransaction = async () => {
    if (!wallet) return;
    const change = await getChangeAddressAsync();
    assert(change, 'Could not get change address');
    const requestedSatPerByte = Number(feeRate);
    const lutxo: CreateTransactionUtxo[] = utxos || (wallet?.getUtxo() ?? []);
    console.log({ requestedSatPerByte, lutxo: lutxo.length });

    const targets: CreateTransactionTarget[] = [];
    for (const transaction of addresses) {
      if (transaction.amount === BitcoinUnit.MAX) {
        // output with MAX
        targets.push({ address: transaction.address });
        continue;
      }
      const value = parseInt(String(transaction.amountSats), 10);
      if (value > 0) {
        targets.push({ address: transaction.address, value });
      } else if (transaction.amount) {
        if (btcToSatoshi(transaction.amount) > 0) {
          targets.push({ address: transaction.address, value: btcToSatoshi(transaction.amount) });
        }
      }
    }

    const targetsOrig = JSON.parse(JSON.stringify(targets));
    // preserving original since it will be mutated

    // without forcing `HDSegwitBech32Wallet` i had a weird ts error, complaining about last argument (fp)
    const { tx, outputs, psbt, fee } = (wallet as HDSegwitBech32Wallet)?.createTransaction(
      lutxo,
      targets,
      requestedSatPerByte,
      change,
      isTransactionReplaceable ? HDSegwitBech32Wallet.defaultRBFSequence : HDSegwitBech32Wallet.finalRBFSequence,
      false,
      0,
    );

    if (tx && routeParams.launchedBy && psbt) {
      console.warn('navigating back to ', routeParams.launchedBy);

      // @ts-ignore idk how to fix FIXME?

      navigation.navigate(routeParams.launchedBy, { psbt });
    }

    if (wallet?.type === WatchOnlyWallet.type) {
      // watch-only wallets with enabled HW wallet support have different flow. we have to show PSBT to user as QR code
      // so he can scan it and sign it. then we have to scan it back from user (via camera and QR code), and ask
      // user whether he wants to broadcast it
      navigation.navigate('PsbtWithHardwareWallet', {
        memo: transactionMemo,
        walletID: wallet.getID(),
        psbt,
        launchedBy: routeParams.launchedBy,
      });
      setIsLoading(false);
      return;
    }

    if (wallet?.type === MultisigHDWallet.type) {
      navigation.navigate('PsbtMultisig', {
        memo: transactionMemo,
        psbtBase64: psbt.toBase64(),
        walletID: wallet.getID(),
        launchedBy: routeParams.launchedBy,
      });
      setIsLoading(false);
      return;
    }

    assert(tx, 'createTRansaction failed');

    txMetadata[tx.getId()] = {
      memo: transactionMemo,
    };
    await saveToDisk();

    let recipients = outputs.filter(({ address }) => address !== change);

    if (recipients.length === 0) {
      // special case. maybe the only destination in this transaction is our own change address..?
      // (ez can be the case for single-address wallet when doing self-payment for consolidation)
      recipients = outputs;
    }

    navigation.navigate('Confirm', {
      fee: new BigNumber(fee).dividedBy(100000000).toNumber(),
      memo: transactionMemo,
      walletID: wallet.getID(),
      tx: tx.toHex(),
      targets: targetsOrig,
      recipients,
      satoshiPerByte: requestedSatPerByte,
      payjoinUrl,
      psbt,
    });
    setIsLoading(false);
  };

  useEffect(() => {
    const newWallet = wallets.find(w => w.getID() === routeParams.walletID);
    if (newWallet) {
      setWallet(newWallet);
    }
  }, [routeParams.walletID, wallets]);

  const setTransactionMemo = (memo: string) => {
    setParams({ transactionMemo: memo });
  };

  /**
   * same as `importTransaction`, but opens camera instead.
   *
   * @returns {Promise<void>}
   */
  const importQrTransaction = useCallback(async () => {
    if (wallet?.type !== WatchOnlyWallet.type) {
      return presentAlert({ title: loc.errors.error, message: 'Importing transaction in non-watchonly wallet (this should never happen)' });
    }

    navigateToQRCodeScanner();
  }, [navigateToQRCodeScanner, wallet?.type]);

  const importQrTransactionOnBarScanned = useCallback(
    (ret: any) => {
      if (!wallet) return;
      if (!ret.data) ret = { data: ret };
      if (ret.data.toUpperCase().startsWith('UR')) {
        presentAlert({ title: loc.errors.error, message: 'BC-UR not decoded. This should never happen' });
      } else if (ret.data.indexOf('+') === -1 && ret.data.indexOf('=') === -1 && ret.data.indexOf('=') === -1) {
        // this looks like NOT base64, so maybe its transaction's hex
        // we dont support it in this flow
      } else {
        // psbt base64?

        // we construct PSBT object and pass to next screen
        // so user can do smth with it:
        const psbt = bitcoin.Psbt.fromBase64(ret.data);

        navigation.navigate('PsbtWithHardwareWallet', {
          memo: transactionMemo,
          walletID: wallet.getID(),
          psbt,
        });

        setIsLoading(false);
      }
    },
    [navigation, transactionMemo, wallet],
  );

  /**
   * watch-only wallets with enabled HW wallet support have different flow. we have to show PSBT to user as QR code
   * so he can scan it and sign it. then we have to scan it back from user (via camera and QR code), and ask
   * user whether he wants to broadcast it.
   * alternatively, user can export psbt file, sign it externally and then import it
   *
   * @returns {Promise<void>}
   */
  const importTransaction = useCallback(async () => {
    if (wallet?.type !== WatchOnlyWallet.type) {
      return presentAlert({ title: loc.errors.error, message: 'Importing transaction in non-watchonly wallet (this should never happen)' });
    }

    try {
      const res = await DocumentPicker.pickSingle({
        type:
          Platform.OS === 'ios'
            ? ['io.bluewallet.psbt', 'io.bluewallet.psbt.txn', DocumentPicker.types.plainText, DocumentPicker.types.json]
            : [DocumentPicker.types.allFiles],
      });

      if (DeeplinkSchemaMatch.isPossiblySignedPSBTFile(res.uri)) {
        // we assume that transaction is already signed, so all we have to do is get txhex and pass it to next screen
        // so user can broadcast:
        const file = await RNFS.readFile(res.uri, 'ascii');
        const psbt = bitcoin.Psbt.fromBase64(file);
        const txhex = psbt.extractTransaction().toHex();
        navigation.navigate('PsbtWithHardwareWallet', { memo: transactionMemo, walletID: wallet.getID(), txhex });
        setIsLoading(false);

        return;
      }

      if (DeeplinkSchemaMatch.isPossiblyPSBTFile(res.uri)) {
        // looks like transaction is UNsigned, so we construct PSBT object and pass to next screen
        // so user can do smth with it:
        const file = await RNFS.readFile(res.uri, 'ascii');
        const psbt = bitcoin.Psbt.fromBase64(file);
        navigation.navigate('PsbtWithHardwareWallet', { memo: transactionMemo, walletID: wallet.getID(), psbt });
        setIsLoading(false);

        return;
      }

      if (DeeplinkSchemaMatch.isTXNFile(res.uri)) {
        // plain text file with txhex ready to broadcast
        const file = (await RNFS.readFile(res.uri, 'ascii')).replace('\n', '').replace('\r', '');
        navigation.navigate('PsbtWithHardwareWallet', { memo: transactionMemo, walletID: wallet.getID(), txhex: file });
        setIsLoading(false);

        return;
      }

      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      presentAlert({ title: loc.errors.error, message: loc.send.details_unrecognized_file_format });
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ title: loc.errors.error, message: loc.send.details_no_signed_tx });
      }
    }
  }, [navigation, setIsLoading, transactionMemo, wallet]);

  const askCosignThisTransaction = async () => {
    return new Promise(resolve => {
      Alert.alert(
        '',
        loc.multisig.cosign_this_transaction,
        [
          {
            text: loc._.no,
            style: 'cancel',
            onPress: () => resolve(false),
          },
          {
            text: loc._.yes,
            onPress: () => resolve(true),
          },
        ],
        { cancelable: false },
      );
    });
  };

  const _importTransactionMultisig = useCallback(
    async (base64arg: string | false) => {
      try {
        const base64 = base64arg || (await fs.openSignedTransaction());
        if (!base64) return;
        const psbt = bitcoin.Psbt.fromBase64(base64); // if it doesnt throw - all good, its valid

        if ((wallet as MultisigHDWallet)?.howManySignaturesCanWeMake() > 0 && (await askCosignThisTransaction())) {
          setIsLoading(true);
          await sleep(100);
          (wallet as MultisigHDWallet).cosignPsbt(psbt);
          setIsLoading(false);
          await sleep(100);
        }

        if (wallet) {
          navigation.navigate('PsbtMultisig', {
            memo: transactionMemo,
            psbtBase64: psbt.toBase64(),
            walletID: wallet.getID(),
          });
        }
      } catch (error: any) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ title: loc.send.problem_with_psbt, message: error.message });
      }
      setIsLoading(false);
    },
    [navigation, sleep, transactionMemo, wallet],
  );

  const importTransactionMultisig = useCallback(() => {
    return _importTransactionMultisig(false);
  }, [_importTransactionMultisig]);

  const onBarScanned = useCallback(
    (ret: any) => {
      if (!ret.data) ret = { data: ret };
      if (ret.data.toUpperCase().startsWith('UR')) {
        presentAlert({ title: loc.errors.error, message: 'BC-UR not decoded. This should never happen' });
      } else if (ret.data.indexOf('+') === -1 && ret.data.indexOf('=') === -1 && ret.data.indexOf('=') === -1) {
        // this looks like NOT base64, so maybe its transaction's hex
        // we dont support it in this flow
      } else {
        // psbt base64?
        return _importTransactionMultisig(ret.data);
      }
    },
    [_importTransactionMultisig],
  );

  const handlePsbtSign = useCallback(
    async (psbtBase64: string) => {
      let tx;
      let psbt;
      try {
        psbt = bitcoin.Psbt.fromBase64(psbtBase64);
        tx = (wallet as MultisigHDWallet).cosignPsbt(psbt).tx;
      } catch (e: any) {
        presentAlert({ title: loc.errors.error, message: e.message });
        return;
      } finally {
        setIsLoading(false);
      }

      if (!tx || !wallet) return setIsLoading(false);

      // we need to remove change address from recipients, so that Confirm screen show more accurate info
      const changeAddresses: string[] = [];
      // @ts-ignore hacky
      for (let c = 0; c < wallet.next_free_change_address_index + wallet.gap_limit; c++) {
        // @ts-ignore hacky
        changeAddresses.push(wallet._getInternalAddressByIndex(c));
      }
      const recipients = psbt.txOutputs
        .filter(({ address }) => !changeAddresses.includes(String(address)))
        .map(recipient => ({ ...recipient, value: Number(recipient.value) }));

      navigation.navigate('CreateTransaction', {
        fee: Number(new BigNumber(psbt.getFee()).dividedBy(100000000).toNumber()),
        feeSatoshi: Number(psbt.getFee()),
        tx: tx.toHex(),
        recipients,
        satoshiPerByte: psbt.getFeeRate(),
        showAnimatedQr: true,
        psbt,
      });
    },
    [navigation, wallet],
  );

  useEffect(() => {
    const data = routeParams.onBarScanned;
    if (data) {
      if (selectedDataProcessor.current) {
        console.debug('SendDetails - selectedDataProcessor:', selectedDataProcessor.current);
        switch (selectedDataProcessor.current) {
          case CommonToolTipActions.ImportTransactionQR:
            importQrTransactionOnBarScanned(data);
            break;
          case CommonToolTipActions.SignPSBT:
            handlePsbtSign(data);
            break;
          case CommonToolTipActions.CoSignTransaction:
          case CommonToolTipActions.ImportTransactionMultsig:
            _importTransactionMultisig(data);
            break;
          case CommonToolTipActions.ImportTransaction:
            processAddressData(data);
            break;
          default:
            console.debug('Unknown selectedDataProcessor:', selectedDataProcessor.current);
        }
      } else {
        processAddressData(data);
      }
    }
    selectedDataProcessor.current = undefined;
    setParams({ onBarScanned: undefined });
  }, [
    importQrTransactionOnBarScanned,
    onBarScanned,
    routeParams.onBarScanned,
    setParams,
    processAddressData,
    _importTransactionMultisig,
    handlePsbtSign,
  ]);

  const handleAddRecipient = useCallback(() => {
    // Check if any recipient is incomplete (missing address or amount)
    const incompleteIndex = addresses.findIndex(item => !item.address || !item.amount);
    if (incompleteIndex !== -1) {
      scrollIndex.current = incompleteIndex;
      scrollView.current?.scrollToIndex({ index: incompleteIndex, animated: true });
      presentAlert({
        title: loc.send.please_complete_recipient_title,
        message: loc.formatString(loc.send.please_complete_recipient_details, { number: incompleteIndex + 1 }),
      });
      return;
    }
    // Add new recipient as usual if all recipients are complete
    setAddresses(prevAddresses => [...prevAddresses, { address: '', key: String(Math.random()), unit: amountUnit }]);
    // Wait for the state to update before scrolling
    setTimeout(() => {
      scrollIndex.current = addresses.length; // New index at the end
      scrollView.current?.scrollToIndex({
        index: scrollIndex.current,
        animated: true,
      });
    }, 0);
  }, [addresses, amountUnit]);

  const onRemoveAllRecipientsConfirmed = useCallback(() => {
    setAddresses([{ address: '', key: String(Math.random()), unit: amountUnit }]);
  }, [amountUnit]);

  const handleRemoveAllRecipients = useCallback(() => {
    Alert.alert(loc.send.details_recipients_title, loc.send.details_add_recc_rem_all_alert_description, [
      {
        text: loc._.cancel,
        onPress: () => {},
        style: 'cancel',
      },
      {
        text: loc._.ok,
        onPress: onRemoveAllRecipientsConfirmed,
      },
    ]);
  }, [onRemoveAllRecipientsConfirmed]);

  const handleRemoveRecipient = useCallback(() => {
    if (addresses.length > 1) {
      const newAddresses = [...addresses];
      newAddresses.splice(scrollIndex.current, 1);

      // Adjust the current index if the last item was removed
      const newIndex = scrollIndex.current >= newAddresses.length ? newAddresses.length - 1 : scrollIndex.current;

      setAddresses(newAddresses);

      // Wait for the state to update before scrolling
      setTimeout(() => {
        scrollView.current?.scrollToIndex({
          index: newIndex,
          animated: true,
        });
      }, 0);

      // Update the scroll index reference
      scrollIndex.current = newIndex;
    }
  }, [addresses]);

  const handleCoinControl = useCallback(() => {
    if (!wallet) return;
    navigation.navigate('CoinControl', {
      walletID: wallet?.getID(),
    });
  }, [navigation, wallet]);

  const handleInsertContact = useCallback(() => {
    if (!wallet) return;
    navigation.navigate('PaymentCodeList', { walletID: wallet.getID() });
  }, [navigation, wallet]);

  const onReplaceableFeeSwitchValueChanged = useCallback(
    (value: boolean) => {
      setParams({ isTransactionReplaceable: value });
    },
    [setParams],
  );

  const onUseAllPressed = useCallback(() => {
    triggerHapticFeedback(HapticFeedbackTypes.NotificationWarning);
    const message = frozenBalance > 0 ? loc.send.details_adv_full_sure_frozen : loc.send.details_adv_full_sure;

    const anchor = findNodeHandle(scrollView.current);
    const options = {
      title: loc.send.details_adv_full,
      message,
      options: [loc._.cancel, loc._.ok],
      cancelButtonIndex: 0,
      anchor: anchor ?? undefined,
    };

    ActionSheet.showActionSheetWithOptions(options, buttonIndex => {
      if (buttonIndex === 1) {
        Keyboard.dismiss();
        setAddresses(addrs => {
          addrs[scrollIndex.current].amount = BitcoinUnit.MAX;
          addrs[scrollIndex.current].amountSats = BitcoinUnit.MAX;
          return [...addrs];
        });
        setAddresses(addrs => {
          addrs[scrollIndex.current].unit = BitcoinUnit.BTC;
          return [...addrs];
        });
      }
    });
  }, [frozenBalance]);
  // Header Right Button

  const headerRightOnPress = useCallback(
    (id: string) => {
      Keyboard.dismiss();
      if (id === CommonToolTipActions.AddRecipient.id) {
        handleAddRecipient();
      } else if (id === CommonToolTipActions.RemoveRecipient.id) {
        handleRemoveRecipient();
      } else if (id === CommonToolTipActions.SignPSBT.id) {
        selectedDataProcessor.current = CommonToolTipActions.SignPSBT;
        navigateToQRCodeScanner();
      } else if (id === CommonToolTipActions.SendMax.id) {
        onUseAllPressed();
      } else if (id === CommonToolTipActions.AllowRBF.id) {
        onReplaceableFeeSwitchValueChanged(!isTransactionReplaceable);
      } else if (id === CommonToolTipActions.ImportTransaction.id) {
        selectedDataProcessor.current = CommonToolTipActions.ImportTransaction;
        importTransaction();
      } else if (id === CommonToolTipActions.ImportTransactionQR.id) {
        selectedDataProcessor.current = CommonToolTipActions.ImportTransactionQR;
        importQrTransaction();
      } else if (id === CommonToolTipActions.ImportTransactionMultsig.id) {
        selectedDataProcessor.current = CommonToolTipActions.ImportTransactionMultsig;
        importTransactionMultisig();
      } else if (id === CommonToolTipActions.CoSignTransaction.id) {
        selectedDataProcessor.current = CommonToolTipActions.CoSignTransaction;
        navigateToQRCodeScanner();
      } else if (id === CommonToolTipActions.CoinControl.id) {
        handleCoinControl();
      } else if (id === CommonToolTipActions.InsertContact.id) {
        handleInsertContact();
      } else if (id === CommonToolTipActions.RemoveAllRecipients.id) {
        handleRemoveAllRecipients();
      }
    },
    [
      handleAddRecipient,
      handleRemoveRecipient,
      navigateToQRCodeScanner,
      onUseAllPressed,
      onReplaceableFeeSwitchValueChanged,
      isTransactionReplaceable,
      importTransaction,
      importQrTransaction,
      importTransactionMultisig,
      handleCoinControl,
      handleInsertContact,
      handleRemoveAllRecipients,
    ],
  );

  const headerRightActions = useCallback(() => {
    if (!wallet) return [];

    const walletActions: Action[][] = [];

    const recipientActions: Action[] = [
      CommonToolTipActions.AddRecipient,
      {
        ...CommonToolTipActions.RemoveRecipient,
        hidden: addresses.length <= 1,
      },
      {
        ...CommonToolTipActions.RemoveAllRecipients,
        hidden: !(addresses.length > 1),
      },
    ];
    walletActions.push(recipientActions);

    const isSendMaxUsed = addresses.some(element => element.amount === BitcoinUnit.MAX);
    const sendMaxAction: Action[] = [
      {
        ...CommonToolTipActions.SendMax,
        disabled: wallet.getBalance() === 0 || isSendMaxUsed,
        hidden: !isEditable || !(Number(wallet.getBalance()) > 0),
      },
    ];
    walletActions.push(sendMaxAction);

    const rbfAction: Action[] = [
      {
        ...CommonToolTipActions.AllowRBF,
        menuState: isTransactionReplaceable,
        hidden: !(wallet.type === HDSegwitBech32Wallet.type && isTransactionReplaceable !== undefined),
      },
    ];
    walletActions.push(rbfAction);

    const transactionActions: Action[] = [
      {
        ...CommonToolTipActions.ImportTransaction,
        hidden: !(wallet.type === WatchOnlyWallet.type && wallet.isHd()),
      },
      {
        ...CommonToolTipActions.ImportTransactionQR,
        hidden: !(wallet.type === WatchOnlyWallet.type && wallet.isHd()),
      },
      {
        ...CommonToolTipActions.ImportTransactionMultsig,
        hidden: !(wallet.type === MultisigHDWallet.type),
      },
      {
        ...CommonToolTipActions.CoSignTransaction,
        hidden: !(wallet.type === MultisigHDWallet.type && wallet.howManySignaturesCanWeMake() > 0),
      },
      {
        ...CommonToolTipActions.SignPSBT,
        hidden: !(wallet as MultisigHDWallet)?.allowCosignPsbt(),
      },
    ];
    walletActions.push(transactionActions);

    const specificWalletActions: Action[] = [
      {
        ...CommonToolTipActions.InsertContact,
        hidden: !(isEditable && wallet.allowBIP47() && wallet.isBIP47Enabled()),
      },
      CommonToolTipActions.CoinControl,
    ];
    walletActions.push(specificWalletActions);

    return walletActions;
  }, [addresses, isEditable, wallet, isTransactionReplaceable]);

  const HeaderRight = useCallback(
    () => <HeaderMenuButton disabled={isLoading} onPressMenuItem={headerRightOnPress} actions={headerRightActions()} />,
    [headerRightOnPress, isLoading, headerRightActions],
  );

  const setHeaderRightOptions = useCallback(() => {
    navigation.setOptions({
      headerRight: HeaderRight,
    });
  }, [HeaderRight, navigation]);

  useEffect(() => {
    console.log('send/details - useEffect');
    if (wallet) {
      setHeaderRightOptions();
    }
  }, [colors, wallet, isTransactionReplaceable, balance, addresses, isEditable, isLoading, setHeaderRightOptions]);

  // Handle selectedFeeRate and selectedFeeType returned from SelectFeeScreen
  useEffect(() => {
    const selectedFeeRate = routeParams.selectedFeeRate;
    const selectedFeeType = routeParams.selectedFeeType;

    console.log('SendDetails: Fee selection useEffect triggered');
    console.log('SendDetails: selectedFeeRate:', selectedFeeRate);
    console.log('SendDetails: selectedFeeType:', selectedFeeType);
    console.log('SendDetails: current customFee:', customFee);
    console.log('SendDetails: current selectedPresetFeeRate:', selectedPresetFeeRate);
    console.log('SendDetails: networkTransactionFees:', networkTransactionFees);

    if (selectedFeeRate !== undefined || selectedFeeType !== undefined) {
      console.log('SendDetails: Processing fee selection...');

      if (selectedFeeType === NetworkTransactionFeeType.CUSTOM) {
        console.log('SendDetails: CUSTOM fee selected, setting customFee to:', selectedFeeRate);
        // Custom fee was selected - set the custom fee rate and clear preset
        setCustomFee(selectedFeeRate || null);
        setSelectedPresetFeeRate(null);
      } else if (
        selectedFeeType === NetworkTransactionFeeType.FAST ||
        selectedFeeType === NetworkTransactionFeeType.MEDIUM ||
        selectedFeeType === NetworkTransactionFeeType.SLOW
      ) {
        console.log('SendDetails: Preset fee selected:', selectedFeeType);
        console.log('SendDetails: Setting selectedPresetFeeRate to:', selectedFeeRate);
        // Preset fee was selected - set the preset fee rate and clear custom fee
        setSelectedPresetFeeRate(selectedFeeRate || null);
        setCustomFee(null);
      }

      console.log('SendDetails: Clearing route params...');
      // Clear the parameters to prevent re-processing
      setParams({ selectedFeeRate: undefined, selectedFeeType: undefined });
    }
  }, [routeParams.selectedFeeRate, routeParams.selectedFeeType, networkTransactionFees, setParams, customFee, selectedPresetFeeRate]);

  const handleRecipientsScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffset = e.nativeEvent.contentOffset;
    const viewSize = e.nativeEvent.layoutMeasurement;
    const index = Math.floor(contentOffset.x / viewSize.width);
    scrollIndex.current = index;
  };

  const formatFee = (fee: number) => formatBalance(fee, feeUnit!, true);

  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },

    selectLabel: {
      color: colors.buttonTextColor,
    },
    of: {
      color: colors.feeText,
    },
    memo: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    feeLabel: {
      color: colors.feeText,
    },

    feeRow: {
      backgroundColor: colors.feeLabel,
    },
    feeValue: {
      color: colors.feeValue,
    },
  });

  const calculateTotalAmount = () => {
    const totalAmount = addresses.reduce((total, item) => total + Number(item.amountSats || 0), 0);
    const totalWithFee = totalAmount + (feePrecalc.current || 0);
    return totalWithFee;
  };

  const renderCreateButton = () => {
    const totalWithFee = calculateTotalAmount();
    const isDisabled = totalWithFee === 0 || totalWithFee > balance || balance === 0 || isLoading || addresses.length === 0;

    return (
      <View style={styles.createButton}>
        {isLoading ? (
          <ActivityIndicator />
        ) : (
          <Button onPress={createTransaction} disabled={isDisabled} title={loc.send.details_next} testID="CreateTransactionButton" />
        )}
      </View>
    );
  };

  const renderWalletSelectionOrCoinsSelected = () => {
    if (isVisible) return null;
    if (utxos && utxos?.length > 0) {
      return (
        <View style={styles.select}>
          <CoinsSelected
            number={utxos.length}
            onContainerPress={handleCoinControl}
            onClose={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setParams({ utxos: null });
            }}
          />
        </View>
      );
    }

    return (
      <View style={styles.select}>
        {!isLoading && isEditable && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.selectTouch}
            onPress={() => {
              navigation.navigate('SelectWallet', { chainType: Chain.ONCHAIN, selectedWalletID: wallet?.getID() });
            }}
          >
            <Text style={styles.selectText}>{loc.wallets.select_wallet.toLowerCase()}</Text>
            <Icon name={direction === 'rtl' ? 'angle-left' : 'angle-right'} size={18} type="font-awesome" color="#9aa0aa" />
          </TouchableOpacity>
        )}
        <View style={styles.selectWrap}>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.selectTouch}
            onPress={() => {
              navigation.navigate('SelectWallet', { chainType: Chain.ONCHAIN, selectedWalletID: wallet?.getID() });
            }}
            disabled={!isEditable || isLoading}
          >
            <Text style={[styles.selectLabel, stylesHook.selectLabel]}>{wallet?.getLabel()}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderBitcoinTransactionInfoFields = (params: { item: IPaymentDestinations; index: number }) => {
    const { item, index } = params;
    return (
      <View style={[styles.transactionItemContainer, { width: dimensions.width }]} testID={'Transaction' + index}>
        <View style={styles.amountInputContainer}>
          <AmountInput.AmountInput
            isLoading={isLoading}
            amount={item.amount ? item.amount.toString() : undefined}
            onAmountUnitChange={(unit: BitcoinUnit) => {
              setAddresses(addrs => {
                const addr = addrs[index];

                switch (unit) {
                  case BitcoinUnit.SATS:
                    addr.amountSats = parseInt(String(addr.amount), 10);
                    break;
                  case BitcoinUnit.BTC:
                    addr.amountSats = btcToSatoshi(String(addr.amount));
                    break;
                  case BitcoinUnit.LOCAL_CURRENCY:
                    // also accounting for cached fiat->sat conversion to avoid rounding error
                    addr.amountSats = AmountInput.getCachedSatoshis(String(addr.amount)) || btcToSatoshi(fiatToBTC(Number(addr.amount)));
                    break;
                }

                addrs[index] = addr;
                return [...addrs];
              });
              setAddresses(addrs => {
                addrs[index].unit = unit;
                return [...addrs];
              });
            }}
            onChangeText={(text: string) => {
              setAddresses(addrs => {
                item.amount = text;
                switch (item.unit || amountUnit) {
                  case BitcoinUnit.BTC:
                    item.amountSats = btcToSatoshi(item.amount);
                    break;
                  case BitcoinUnit.LOCAL_CURRENCY:
                    item.amountSats = btcToSatoshi(fiatToBTC(Number(item.amount)));
                    break;
                  case BitcoinUnit.SATS:
                  default:
                    item.amountSats = parseInt(text, 10);
                    break;
                }
                addrs[index] = item;
                return [...addrs];
              });
            }}
            unit={item.unit || amountUnit}
            editable={isEditable}
            disabled={!isEditable}
            inputAccessoryViewID={InputAccessoryAllFundsAccessoryViewID}
          />
        </View>

        {frozenBalance > 0 && (
          <TouchableOpacity accessibilityRole="button" style={styles.frozenContainer} onPress={handleCoinControl}>
            <BlueText>
              {loc.formatString(loc.send.details_frozen, { amount: formatBalanceWithoutSuffix(frozenBalance, BitcoinUnit.BTC, true) })}
            </BlueText>
          </TouchableOpacity>
        )}

        <View style={styles.addressInputContainer}>
          <AddressInput
            onChangeText={text => {
              const { address, amount, memo, payjoinUrl: pjUrl } = DeeplinkSchemaMatch.decodeBitcoinUri(text.trim());
              setAddresses(addrs => {
                item.address = address || text.trim();
                item.amount = amount || item.amount;
                addrs[index] = item;
                return [...addrs];
              });
              if (memo) {
                setParams({ transactionMemo: memo });
              }
              setIsLoading(false);
              setParams({ payjoinUrl: pjUrl });
            }}
            address={item.address}
            isLoading={isLoading}
            inputAccessoryViewID={DismissKeyboardInputAccessoryViewID}
            editable={isEditable}
            style={styles.fullWidthInput}
          />
        </View>

        {addresses.length > 1 && (
          <Text style={[styles.of, stylesHook.of, styles.ofMargin]}>
            {loc.formatString(loc._.of, { number: index + 1, total: addresses.length })}
          </Text>
        )}
      </View>
    );
  };

  const getItemLayout = (_: any, index: number) => ({
    length: dimensions.width,
    offset: dimensions.width * index,
    index,
  });

  return (
    <SafeArea style={[styles.root, stylesHook.root]}>
      <View>
        <FlatList
          onLayout={handleLayout}
          keyboardShouldPersistTaps="always"
          scrollEnabled={addresses.length > 1}
          data={addresses}
          renderItem={renderBitcoinTransactionInfoFields}
          horizontal
          ref={scrollView}
          automaticallyAdjustKeyboardInsets
          pagingEnabled
          removeClippedSubviews={false}
          onMomentumScrollBegin={Keyboard.dismiss}
          onScroll={handleRecipientsScroll}
          scrollEventThrottle={16}
          scrollIndicatorInsets={styles.scrollViewIndicator}
          contentContainerStyle={styles.scrollViewContent}
          getItemLayout={getItemLayout}
        />
        <View style={[styles.memo, stylesHook.memo]}>
          <TextInput
            onChangeText={setTransactionMemo}
            placeholder={loc.send.details_note_placeholder}
            placeholderTextColor="#81868e"
            value={transactionMemo}
            numberOfLines={1}
            style={styles.memoText}
            editable={!isLoading}
            onSubmitEditing={Keyboard.dismiss}
            inputAccessoryViewID={DismissKeyboardInputAccessoryViewID}
          />
        </View>
        <TouchableOpacity
          testID="chooseFee"
          accessibilityRole="button"
          onPress={() => {
            Keyboard.dismiss();
            navigation.navigate('SelectFee', {
              networkTransactionFees,
              feePrecalc,
              feeRate,
              feeUnit,
              walletID: wallet?.getID() || '',
              customFee,
            });
          }}
          disabled={isLoading}
          style={styles.fee}
        >
          <Text style={[styles.feeLabel, stylesHook.feeLabel]}>{loc.send.create_fee}</Text>

          {networkTransactionFeesIsLoading ? (
            <ActivityIndicator />
          ) : (
            <View style={[styles.feeRow, stylesHook.feeRow]}>
              <Text style={stylesHook.feeValue}>
                {feePrecalc.current ? formatFee(feePrecalc.current) : feeRate + ' ' + loc.units.sat_vbyte}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        {renderCreateButton()}
      </View>
      <DismissKeyboardInputAccessory />
      {Platform.select({
        ios: <InputAccessoryAllFunds canUseAll={balance > 0} onUseAllPressed={onUseAllPressed} balance={String(allBalance)} />,
        android: isVisible && (
          <InputAccessoryAllFunds canUseAll={balance > 0} onUseAllPressed={onUseAllPressed} balance={String(allBalance)} />
        ),
      })}

      {renderWalletSelectionOrCoinsSelected()}
    </SafeArea>
  );
};

export default SendDetails;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  scrollViewContent: {
    flexDirection: 'row',
  },
  scrollViewIndicator: {
    top: 0,
    left: 8,
    bottom: 0,
    right: 8,
  },
  createButton: {
    marginVertical: 16,
    marginHorizontal: 16,
    alignContent: 'center',
    minHeight: 44,
  },
  select: {
    marginBottom: 24,
    marginHorizontal: 24,
    alignItems: 'center',
  },
  selectTouch: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectText: {
    color: '#9aa0aa',
    fontSize: 14,
    marginRight: 8,
  },
  selectWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  selectLabel: {
    fontSize: 14,
  },
  of: {
    alignSelf: 'flex-end',
    marginRight: 18,
    marginVertical: 8,
  },
  ofMargin: {
    marginTop: 4,
  },
  memo: {
    flexDirection: 'row',
    borderWidth: 1,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    marginHorizontal: 16,
    alignItems: 'center',
    marginVertical: 8,
    borderRadius: 4,
  },
  memoText: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 33,
    color: '#81868e',
  },
  fee: {
    flexDirection: 'row',
    marginHorizontal: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feeLabel: {
    fontSize: 14,
  },
  feeRow: {
    minWidth: 40,
    height: 25,
    borderRadius: 4,
    justifyContent: 'space-between',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  frozenContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  transactionItemContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  amountInputContainer: {
    marginBottom: 8,
  },
  addressInputContainer: {
    marginTop: 8,
  },
  fullWidthInput: {
    width: '100%',
  },
});
