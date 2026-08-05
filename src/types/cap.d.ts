declare module 'cap' {
  import { EventEmitter } from 'events';

  interface Device {
    name: string;
    addresses: Array<{
      addr: string;
      netmask?: string;
      broadaddr?: string;
    }>;
    description?: string;
    flags?: string;
  }

  class Cap extends EventEmitter {
    open(device: string, filter: string, bufSize: number, buffer: Buffer): void;
    close(): void;
    setMinBytes?(bytes: number): void;
    linkType: string;
  }

  function findDevice(addr: string): string | undefined;
  function deviceList(): Device[];

  const decoders: {
    Ethernet: (buffer: Buffer, offset?: number) => { info: { type: number }; offset: number };
    IPV4: (buffer: Buffer, offset?: number) => { info: { protocol: number; srcaddr: string; dstaddr: string; totallen: number; ttl: number }; offset: number; hdrlen: number };
    TCP: (buffer: Buffer, offset?: number) => { info: { srcport: number; dstport: number; flags: number }; offset: number };
    UDP: (buffer: Buffer, offset?: number) => { info: { srcport: number; dstport: number; length: number }; offset: number };
  };

  const PROTOCOL: {
    ETHERNET: { IPV4: number; IPV6: number; ARP: number };
    IP: { TCP: number; UDP: number; ICMP: number };
  };

  export { Cap, findDevice, deviceList, decoders, PROTOCOL };
}
