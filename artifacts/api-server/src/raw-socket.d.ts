declare module "raw-socket" {
  export function createSocket(protocol: number, addressFamily?: number): RawSocket;
  export const AddressFamily: { IPv4: number; IPv6: number };
  export const Protocol: { None: number; ICMP: number; ICMPv6: number };
  export interface RawSocket {
    send(buffer: Buffer, offset: number, length: number, address: string, cb?: (err: Error | null, bytes: number) => void): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    close(): void;
  }
}
