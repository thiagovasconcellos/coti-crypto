import { EventEmitter } from 'events';
import { Descriptor, DescriptorEvent } from '@ledgerhq/hw-transport';
//import type Log from '@ledgerhq/logs';
import { listen } from '@ledgerhq/logs';
import * as ledgerUtils from './utils/ledgerUtils';

type LedgerTransportType = ledgerUtils.LedgerTransportType;

export interface LedgerEvent {
  on(event: 'add' | 'remove', listener: (ledgerEvent: DescriptorEvent<Descriptor>) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'log', listener: (ledgerLog: any) => void): this;

  emit(event: 'add' | 'remove', ledgerEvent: DescriptorEvent<Descriptor>): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'log', ledgerLog: any): boolean;
}

export abstract class LedgerEvent extends EventEmitter {
  public onAdd(listener: (ledgerEvent: DescriptorEvent<Descriptor>) => void): this {
    return this.on('add', listener);
  }

  public onRemove(listener: (ledgerEvent: DescriptorEvent<Descriptor>) => void): this {
    return this.on('remove', listener);
  }

  public onError(listener: (error: Error) => void): this {
    return this.on('error', listener);
  }
}

export class LedgerDevice extends LedgerEvent {
  private transportType?: LedgerTransportType;

  constructor(transportType?: LedgerTransportType) {
    super();
    this.transportType = transportType;
  }

  public listen() {
    ledgerUtils.listen({ next: event => this.next(event), error: error => this.error(error), complete: () => this.complete() }, this.transportType);
  }

  public listenLog() {
    listen((ledgerLog: any) => this.emit('log', ledgerLog));
  }

  public next(event: DescriptorEvent<Descriptor>) {
    this.emit(event.type, event);
  }

  public error(error: Error) {
    this.emit('error', error);
  }

  public complete() {
    console.log(`Complete`);
  }
}
