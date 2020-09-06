import * as utils from './utils/utils';
import { keccak256 } from 'js-sha3';
import { IndexedAddress } from './address';
import { IndexedWallet } from './wallet';

export interface SignatureData {
  r: string;
  s: string;
}

export abstract class Signature {
  protected signatureData!: SignatureData;

  constructor() {}

  public async sign<T extends IndexedAddress>(wallet: IndexedWallet<T>, isHash = false) {
    const messageInBytes = isHash ? this.getBytes() : this.createBasicSignatureHash();
    this.signatureData = await wallet.signMessage(messageInBytes);
    return this.signatureData;
  }

  public createBasicSignatureHash() {
    let baseTxBytes = this.getBytes();
    let baseTxHashedArray = keccak256.update(baseTxBytes).array();
    return new Uint8Array(baseTxHashedArray);
  }

  abstract getBytes(): Uint8Array;
}

export class FullNodeFeeSignature extends Signature {
  private amount: number;

  constructor(amount: number) {
    super();
    this.amount = amount;
  }

  getBytes() {
    return utils.getBytesFromString(utils.removeZerosFromEndOfNumber(this.amount));
  }
}
