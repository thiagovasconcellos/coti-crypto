import * as stomp from 'webstomp-client';
import SockJS from 'sockjs-client';
import { walletUtils } from './utils/walletUtils';
import { nodeUtils } from './utils/nodeUtils';
import { BigDecimal } from './utils/utils';
import { BaseWallet, IndexedWallet } from './wallet';
import { BaseAddress, IndexedAddress } from './address';
import { TransactionData } from './transaction';

export type StompClient = stomp.Client;

export class WebSocket {
  private readonly wallet: BaseWallet;
  private readonly socketUrl: string;
  private client!: StompClient;
  private reconnectCounter = 0;
  private readonly propagationSubscriptions = new Map();
  private readonly balanceSubscriptions = new Map();
  private readonly transactionsSubscriptions = new Map();

  constructor(wallet: BaseWallet) {
    this.wallet = wallet;
    this.socketUrl = nodeUtils.getSocketUrl(wallet.getNetwork());
  }

  public connect(successCallback?: () => Promise<void>, reconnectFailedCallback?: () => Promise<void>) {
    const addressesInHex = this.wallet.getAddressHexes();
    console.log(`Connecting to web socket with url ${this.socketUrl}`);
    this.setClient();
    return new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        clearTimeout(timeout);
        reject(`Web socket connection timeout`);
      }, 120000);
      this.client.connect(
        {},
        async () => {
          console.log('Web socket client connected.');
          await this.onConnected(addressesInHex, successCallback);
          resolve();
        },
        error => {
          console.error('Web socket connection error:', error);
          this.addressesUnsubscribe();
          this.reconnect(this.socketUrl, addressesInHex, successCallback, reconnectFailedCallback);
        }
      );
    });
  }

  private setClient() {
    const ws = new SockJS(this.socketUrl);
    this.client = stomp.over(ws, { debug: false });
  }

  private closeSocketConnection() {
    this.addressesUnsubscribe();
    this.client.disconnect();
  }

  private async addressesUnsubscribe() {
    this.propagationSubscriptions.forEach(async propagationSubscription => await propagationSubscription.unsubscribe());
    this.balanceSubscriptions.forEach(async balanceSubscription => await balanceSubscription.unsubscribe());
    this.transactionsSubscriptions.forEach(async transactionsSubscription => await transactionsSubscription.unsubscribe());
  }

  private reconnect(socketUrl: string, addresses: string[], successCallback?: () => Promise<void>, reconnectFailedCallback?: () => Promise<void>) {
    let connected = false;
    console.log(`Reconnecting to web socket with url ${this.socketUrl}`);
    this.setClient();
    this.client.connect(
      {},
      async () => {
        console.log('Web socket client reconnected.');
        connected = true;
        await this.onConnected(addresses, successCallback);
      },
      () => {
        if (!connected && this.reconnectCounter <= 6) {
          console.log('Web socket trying to reconnect. Counter: ', this.reconnectCounter);
          this.reconnectCounter++;
          this.reconnect(socketUrl, addresses, successCallback, reconnectFailedCallback);
        } else {
          console.log('Web socket client reconnect unsuccessful');
          if (reconnectFailedCallback) reconnectFailedCallback();
        }
      }
    );
  }

  private async onConnected(addresses: string[], callback?: () => Promise<void>) {
    this.reconnectCounter = 0;
    console.log('Connected and monitoring addresses: ', addresses);
    if (!addresses) addresses = [];

    addresses.forEach(address => {
      this.connectToAddress(address);
    });
    if (this.wallet instanceof IndexedWallet) {
      const maxAddress = this.wallet.getMaxAddress();
      for (let i = addresses.length; i < addresses.length + 10 && (!maxAddress || i < maxAddress); i++) {
        const address = await this.wallet.generateAddressByIndex(i);
        this.addressPropagationSubscriber(address);
      }
      console.log(
        'PropagationSubscriptions: ',
        [...this.propagationSubscriptions.keys()].map(a => a.getAddressHex())
      );
    }
    console.log('BalanceSubscriptions: ', [...this.balanceSubscriptions.keys()]);
    console.log('TransactionsSubscriptions: ', [...this.transactionsSubscriptions.keys()]);

    if (callback) return await callback();
  }

  private connectToAddress(addressHex: string) {
    if (!this.balanceSubscriptions.get(addressHex)) {
      let balanceSubscription = this.client.subscribe(`/topic/${addressHex}`, async ({ body }) => {
        try {
          const data = JSON.parse(body);
          if (data.message === 'Balance Updated!') {
            const address = this.wallet.getAddressMap().get(data.addressHash);
            if (address === undefined) {
              const errorMsg = `Error - Address not found for addressHex: ${data.addressHash}`;
              console.log(errorMsg);
              throw new Error(errorMsg);
            }
            const { balance, preBalance } = data;
            this.setAddressWithBalance(balance === null ? 0 : balance, preBalance === null ? 0 : preBalance, address);
          }
        } catch (e) {
          console.error(`Address balance subscription callback error for address ${addressHex}: `, e);
        }
      });

      this.balanceSubscriptions.set(addressHex, balanceSubscription);
    }

    if (!this.transactionsSubscriptions.get(addressHex)) {
      let transactionSubscription = this.client.subscribe(`/topic/addressTransactions/${addressHex}`, async ({ body }) => {
        try {
          const data = JSON.parse(body);
          let { transactionData } = data;
          transactionData = new TransactionData(transactionData);
          transactionData.setStatus();
          this.wallet.setTransaction(transactionData);
        } catch (e) {
          console.error(`Address transaction subscription callback error for address ${addressHex}: `, e);
        }
      });

      this.transactionsSubscriptions.set(addressHex, transactionSubscription);
    }
  }

  private addressPropagationSubscriber(address: IndexedAddress) {
    console.log('Subscribing for address:', address.getAddressHex());
    const alreadySubscribed = this.propagationSubscriptions.get(address);
    const addressHex = address.getAddressHex();
    if (alreadySubscribed) {
      console.log('Attempting to resubscribe in address propagation, skip resubscription of:', addressHex);
    }

    let addressPropagationSubscription = this.client.subscribe(`/topic/address/${addressHex}`, async ({ body }) => {
      try {
        const data = JSON.parse(body);
        console.log('Received an address through address propagation:', data.addressHash, ' index:', address.getIndex());
        if (data.addressHash !== addressHex) throw new Error('Error in addressPropagationSubscriber');

        const subscription = this.propagationSubscriptions.get(address);
        if (subscription) {
          subscription.unsubscribe();
          this.propagationSubscriptions.delete(address);
          this.wallet.emit('generateAddress', addressHex);
          await this.checkBalanceAndSubscribeNewAddress(address);
        }
      } catch (e) {
        console.error(`Propagation subscription callback error for address ${addressHex}: `, e);
      }
    });
    this.propagationSubscriptions.set(address, addressPropagationSubscription);
  }

  private async checkBalanceAndSubscribeNewAddress<T extends IndexedAddress>(address: IndexedAddress) {
    if (this.wallet instanceof IndexedWallet) {
      const nextPropagationAddressIndex = Array.from(this.propagationSubscriptions.keys()).pop().getIndex() + 1;
      const nextAddress = <T>await this.wallet.generateAddressByIndex(nextPropagationAddressIndex);

      this.addressPropagationSubscriber(nextAddress);

      const addressHex = address.getAddressHex();

      const balances = await walletUtils.checkBalances([addressHex], this.wallet);
      const { addressBalance, addressPreBalance } = balances[addressHex];
      this.setAddressWithBalance(new BigDecimal(addressBalance), new BigDecimal(addressPreBalance), address);

      const addressIndex = address.getIndex();
      console.log(`Subscribing the balance and transactions for address: ${addressHex} and index: ${addressIndex}`);
      this.connectToAddress(addressHex);
    }
  }

  private setAddressWithBalance(addressBalance: BigDecimal, addressPreBalance: BigDecimal, address: BaseAddress) {
    this.wallet.setAddressWithBalance(address, addressBalance, addressPreBalance);
  }
}
