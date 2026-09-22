// 可用地址统计：随拓扑数据每次变化重新计算（界面层通过 useMemo 触发）。
import { parseCidr, parseIp, formatIp, usableRange, nextAvailable } from './ip.js';

// 网段内已被占用的地址（设备 IP + 网关），可排除某台设备（用于变更前预演）。
export function usedValuesFor(data, subnetId, excludeNodeId) {
  const used = new Set();
  const subnet = data.subnets.find((s) => s.id === subnetId);
  if (subnet) {
    const gw = parseIp(subnet.gateway);
    if (gw !== null) used.add(gw);
  }
  for (const [nodeId, addr] of Object.entries(data.addressing || {})) {
    if (nodeId === excludeNodeId || !addr || addr.subnetId !== subnetId) continue;
    const v = parseIp(addr.ip);
    if (v !== null) used.add(v);
  }
  return used;
}

export function nextFreeIp(data, subnetId, excludeNodeId) {
  const subnet = data.subnets.find((s) => s.id === subnetId);
  const cidr = subnet && parseCidr(subnet.cidr);
  if (!cidr) return null;
  const v = nextAvailable(cidr, usedValuesFor(data, subnetId, excludeNodeId));
  return v === null ? null : formatIp(v);
}

// 每个网段的占用情况：{ [subnetId]: { total, used, free, next, holders } }
export function computeUsage(data) {
  const usage = {};
  for (const s of data.subnets) {
    const cidr = parseCidr(s.cidr);
    const total = cidr ? usableRange(cidr).total : 0;
    const usedValues = usedValuesFor(data, s.id);
    const holders = {};
    for (const [nodeId, addr] of Object.entries(data.addressing || {})) {
      if (addr && addr.subnetId === s.id) holders[nodeId] = addr.ip;
    }
    const next = cidr ? nextAvailable(cidr, usedValues) : null;
    usage[s.id] = {
      subnetId: s.id,
      total,
      used: usedValues.size,
      free: Math.max(0, total - usedValues.size),
      next: next === null ? null : formatIp(next),
      holders,
    };
  }
  return usage;
}
