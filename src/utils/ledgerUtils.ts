import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { HWSDK, SigningType as LedgerSigningType } from '@coti-io/ledger-sdk';
import { listen as listenLedgerLog, Log } from '@ledgerhq/logs';
import { SignatureData, SigningType } from '../signature';
import * as signature from '../signature';
import { LedgerError } from '../cotiError';
import { Descriptor, DescriptorEvent, Observer } from '@ledgerhq/hw-transport';

const listenTimeout = 3000;
const exchangeTimeout = 60000;

export type LedgerTransportType = 'node' | 'web';

export type LedgerLog = Log;

const ledgerTransport = {
  node: TransportNodeHid,
  web: TransportWebUSB,
};

export function listenLog(callback: (ledgerLog: LedgerLog) => void) {
  listenLedgerLog(callback);
}

export function listen(observer: Observer<DescriptorEvent<Descriptor>>, transportType: LedgerTransportType = 'web') {
  ledgerTransport[transportType].listen(observer);
}

export async function connect(transportType: LedgerTransportType = 'web') {
  const transport = await ledgerTransport[transportType].create(undefined, listenTimeout);
  transport.setExchangeTimeout(exchangeTimeout);

  return new HWSDK(transport);
}

export async function getPublicKey(index: number, interactive?: boolean, transportType?: LedgerTransportType) {
  try {
    const hw = await connect(transportType);

    const res = await hw.getPublicKey(index, interactive);
    return res.publicKey;
  } catch (error) {
    throw new LedgerError(error.message, { debugMessage: `Error getting public key for index ${index} from ledger wallet`, cause: error });
  }
}

export async function getUserPublicKey(interactive?: boolean, transportType?: LedgerTransportType) {
  try {
    const hw = await connect(transportType);

    const res = await hw.getUserPublicKey(interactive);
    return res.publicKey;
  } catch (error) {
    throw new LedgerError(error.message, { debugMessage: `Error getting user public key from ledger wallet`, cause: error });
  }
}

export async function signMessage(
  index: number,
  messageHex: string,
  signingType?: SigningType,
  hashed?: boolean,
  transportType?: LedgerTransportType
): Promise<SignatureData> {
  try {
    const hw = await connect(transportType);

    const ledgerSigningType = getLedgerSigningType(signingType);
    const res = await hw.signMessage(index, messageHex, ledgerSigningType, hashed);
    return { r: res.r, s: res.s };
  } catch (error) {
    throw new LedgerError(error.message, { debugMessage: `Error signing message at ledger wallet`, cause: error });
  }
}

export async function signUserMessage(
  messageHex: string,
  signingType?: SigningType,
  hashed?: boolean,
  transportType?: LedgerTransportType
): Promise<SignatureData> {
  try {
    const hw = await connect(transportType);

    const ledgerSigningType = getLedgerSigningType(signingType);
    const res = await hw.signUserMessage(messageHex, ledgerSigningType, hashed);
    return { r: res.r, s: res.s };
  } catch (error) {
    throw new LedgerError(error.message, { debugMessage: `Error signing user message at ledger wallet`, cause: error });
  }
}

function getLedgerSigningType(signingType?: SigningType) {
  if (signingType) {
    const signingTypeKey = signature.signingTypeKeyMap.get(signingType);
    if (signingTypeKey) return LedgerSigningType[signingTypeKey];
  }
}
