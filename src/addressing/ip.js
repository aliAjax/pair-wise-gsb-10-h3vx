// IP 与网段的纯计算工具：不依赖界面、状态或任何外部包。

// 将 "a.b.c.d" 解析为 32 位无符号整数；格式非法时返回 null。
export function parseIp(str) {
  if (typeof str !== 'string') return null;
  const parts = str.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

export function formatIp(value) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

// 解析 "10.0.1.0/24"，返回 { network, prefix, mask, cidr }；非法时返回 null。
export function parseCidr(str) {
  if (typeof str !== 'string') return null;
  const match = str.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) return null;
  const base = parseIp(match[1]);
  if (base === null) return null;
  const prefix = Number(match[2]);
  if (prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  return { network, prefix, mask, cidr: `${formatIp(network)}/${prefix}` };
}

export function inSubnet(ipValue, cidr) {
  return ((ipValue & cidr.mask) >>> 0) === cidr.network;
}

export function subnetSize(cidr) {
  return 2 ** (32 - cidr.prefix);
}

// 可用主机范围；/31、/32 按点到点/主机路由处理，全部可用。
export function usableRange(cidr) {
  const size = subnetSize(cidr);
  if (cidr.prefix >= 31) return { first: cidr.network, last: cidr.network + size - 1, total: size };
  return { first: cidr.network + 1, last: cidr.network + size - 2, total: size - 2 };
}

export function isUsable(ipValue, cidr) {
  const { first, last } = usableRange(cidr);
  return ipValue >= first && ipValue <= last;
}

// 在可用范围内找第一个未被占用的地址；占满返回 null。
export function nextAvailable(cidr, usedValues) {
  const { first, last } = usableRange(cidr);
  for (let v = first; v <= last; v += 1) {
    if (!usedValues.has(v)) return v;
  }
  return null;
}

export function cidrsOverlap(a, b) {
  const aEnd = a.network + subnetSize(a) - 1;
  const bEnd = b.network + subnetSize(b) - 1;
  return a.network <= bEnd && b.network <= aEnd;
}
