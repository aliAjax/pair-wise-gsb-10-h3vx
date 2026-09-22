// addressing.js — 地址资料模块
// 只负责 IP/CIDR/VLAN 的原始计算与数据模型，不包含任何校验决策与界面逻辑。
// 无第三方依赖，全部基于 32 位无符号整数运算。

export const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipToInt(ip) {
  const m = IPV4_RE.exec(String(ip || '').trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n * 256 + o) >>> 0;
  }
  return n;
}

export function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function isValidIp(ip) {
  return ipToInt(ip) !== null;
}

// 返回规范化 CIDR，非法输入返回 null
export function parseCidr(cidr) {
  const parts = String(cidr || '').split('/');
  if (parts.length !== 2) return null;
  const ip = ipToInt(parts[0]);
  const prefix = Number(parts[1]);
  if (ip === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  return { network, mask, prefix, broadcast: (network | (~mask >>> 0)) >>> 0 };
}

export function canonicalCidr(cidr) {
  const c = parseCidr(cidr);
  return c ? `${intToIp(c.network)}/${c.prefix}` : null;
}

export function cidrContainsIp(cidr, ip) {
  const c = parseCidr(cidr);
  const n = ipToInt(ip);
  if (!c || n === null) return false;
  return (n & c.mask) >>> 0 === c.network;
}

// 两个网段是否重叠
export function cidrOverlap(a, b) {
  const ca = parseCidr(a);
  const cb = parseCidr(b);
  if (!ca || !cb) return false;
  return ca.network <= cb.broadcast && cb.network <= ca.broadcast;
}

// 可用主机地址（排除网络地址/广播地址；/31、/32 按实际地址数计）
export function cidrHosts(cidr) {
  const c = parseCidr(cidr);
  if (!c) return { count: 0, hosts: [] };
  let first = c.network;
  let last = c.broadcast;
  if (c.prefix <= 30) {
    first = c.network + 1;
    last = c.broadcast - 1;
  }
  const count = Math.max(0, last - first + 1);
  return { count, first, last };
}

export function isValidVlan(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4094;
}

export const DEVICE_TYPES = [
  { type: 'router', icon: '◉', label: '路由器' },
  { type: 'switch', icon: '▦', label: '交换机' },
  { type: 'server', icon: '▣', label: '服务器' },
  { type: 'device', icon: '▱', label: '终端设备' },
];

export const typeMeta = (t) => DEVICE_TYPES.find((d) => d.type === t) || DEVICE_TYPES[3];

let seq = 0;
export function uid(prefix) {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// 初始地址规划：网段 / 设备 / 连线（跨网段连线均标明 routed）
export const seedPlan = {
  subnets: [
    { id: 'core', name: '核心网段', cidr: '10.0.0.0/30', gateway: '10.0.0.1', vlan: 10 },
    { id: 'lanA', name: '办公区 A', cidr: '10.0.1.0/24', gateway: '10.0.1.1', vlan: 20 },
    { id: 'lanB', name: '办公区 B', cidr: '10.0.2.0/24', gateway: '10.0.2.1', vlan: 30 },
  ],
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 200, subnetId: 'core', ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 350, subnetId: 'lanA', ip: '10.0.1.2' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 350, subnetId: 'lanB', ip: '10.0.2.2' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 500, subnetId: 'lanA', ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 530, subnetId: 'lanA', ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 510, subnetId: 'lanB', ip: '10.0.2.22' },
  ],
  edges: [
    { id: 'e1', a: 'gw', b: 'sw1', routed: true },
    { id: 'e2', a: 'gw', b: 'sw2', routed: true },
    { id: 'e3', a: 'sw1', b: 'web', routed: false },
    { id: 'e4', a: 'sw1', b: 'db', routed: false },
    { id: 'e5', a: 'sw2', b: 'user', routed: false },
  ],
};

// 规整任意输入（含旧版拓扑格式）为合法的规划结构
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') return structuredClone(seedPlan);
  // 旧版本（没有 subnets 字段的拓扑）直接重建为种子规划
  if (!Array.isArray(raw.subnets)) return structuredClone(seedPlan);

  const subnets = raw.subnets
    .filter((s) => s && s.id)
    .map((s) => ({
      id: String(s.id),
      name: String(s.name ?? '未命名网段'),
      cidr: String(s.cidr ?? ''),
      gateway: String(s.gateway ?? ''),
      vlan: s.vlan === '' || s.vlan == null ? '' : Number(s.vlan),
    }));

  const subnetIds = new Set(subnets.map((s) => s.id));
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .filter((n) => n && n.id)
    .map((n) => ({
      id: String(n.id),
      name: String(n.name ?? '未命名设备'),
      type: ['router', 'switch', 'server', 'device'].includes(n.type) ? n.type : 'device',
      x: Number.isFinite(+n.x) ? +n.x : 300,
      y: Number.isFinite(+n.y) ? +n.y : 300,
      subnetId: subnetIds.has(n.subnetId) ? n.subnetId : (subnets[0]?.id ?? ''),
      ip: String(n.ip ?? ''),
    }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seenEdges = new Set();
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .map((e) => {
      // 兼容旧版数组连线 ['gw','sw1']
      if (Array.isArray(e)) return { id: uid('e'), a: String(e[0]), b: String(e[1]), routed: false };
      return { id: e.id ? String(e.id) : uid('e'), a: String(e.a), b: String(e.b), routed: !!e.routed };
    })
    .filter((e) => nodeIds.has(e.a) && nodeIds.has(e.b) && e.a !== e.b)
    .filter((e) => {
      const k = edgeKey(e.a, e.b);
      if (seenEdges.has(k)) return false;
      seenEdges.add(k);
      return true;
    });

  return { subnets, nodes, edges };
}

export function findSubnet(plan, id) {
  return plan.subnets.find((s) => s.id === id) || null;
}

export function findNode(plan, id) {
  return plan.nodes.find((n) => n.id === id) || null;
}

export function edgesOfNode(plan, nodeId) {
  return plan.edges.filter((e) => e.a === nodeId || e.b === nodeId);
}

// 两设备是否属于同一网段（任一设备未登记网段时返回 null）
export function sameSubnet(plan, aId, bId) {
  const a = findNode(plan, aId);
  const b = findNode(plan, bId);
  if (!a || !b || !a.subnetId || !b.subnetId) return null;
  return a.subnetId === b.subnetId;
}

// 某网段的地址占用实况：可用地址随拓扑重算
export function subnetUsage(plan, subnet) {
  const { count, first, last } = cidrHosts(subnet.cidr);
  const members = plan.nodes.filter((n) => n.subnetId === subnet.id);
  const usedIps = new Set();
  const nodes = [];
  for (const n of members) {
    const ipInt = ipToInt(n.ip);
    const inRange = ipInt !== null && cidrContainsIp(subnet.cidr, n.ip);
    const usable = inRange && (!isValidIp(subnet.gateway) || n.ip !== subnet.gateway);
    const isHost = inRange && count > 0 && ipInt >= first && ipInt <= last;
    nodes.push({ node: n, ipInt, inRange, usable, isHost });
    if (usable && isHost) usedIps.add(n.ip);
  }
  let gatewayReserved = false;
  if (isValidIp(subnet.gateway) && cidrContainsIp(subnet.cidr, subnet.gateway)) {
    const g = ipToInt(subnet.gateway);
    if (count > 0 && g >= first && g <= last) {
      usedIps.add(subnet.gateway);
      gatewayReserved = true;
    }
  }
  const used = usedIps.size;
  return {
    count,
    used,
    free: Math.max(0, count - used),
    usedIps,
    nodes,
    gatewayReserved,
  };
}

// 建议网段内下一个空闲主机地址
export function nextFreeIp(plan, subnet) {
  const { count, first, last } = cidrHosts(subnet.cidr);
  if (!count) return '';
  const { usedIps } = subnetUsage(plan, subnet);
  for (let n = first; n <= last; n++) {
    const ip = intToIp(n);
    if (!usedIps.has(ip)) return ip;
  }
  return '';
}
