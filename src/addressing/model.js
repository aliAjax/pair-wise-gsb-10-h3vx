// 地址资料：网段台账、设备地址登记，以及旧版本数据的迁移与持久化。
import { parseCidr, parseIp, inSubnet } from './ip.js';
import { nextFreeIp } from './availability.js';

export const DEVICE_TYPES = [
  ['router', '◉', '路由器'],
  ['switch', '▦', '交换机'],
  ['server', '▣', '服务器'],
  ['device', '▱', '终端设备'],
];

// 初始数据：设备、连线、网段台账与设备地址登记分离存放。
export const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220 },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370 },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370 },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520 },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550 },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530 },
  ],
  edges: [
    { id: 'e-gw-sw1', a: 'gw', b: 'sw1', route: 'via 10.0.0.1' },
    { id: 'e-gw-sw2', a: 'gw', b: 'sw2', route: 'via 10.0.0.1' },
    { id: 'e-sw1-web', a: 'sw1', b: 'web', route: '' },
    { id: 'e-sw1-db', a: 'sw1', b: 'db', route: '' },
    { id: 'e-sw2-user', a: 'sw2', b: 'user', route: '' },
  ],
  subnets: [
    { id: 'core', name: '核心骨干', cidr: '10.0.0.0/24', gateway: '10.0.0.1', vlan: 1 },
    { id: 'office-a', name: '办公网段 A', cidr: '10.0.1.0/24', gateway: '10.0.1.1', vlan: 10 },
    { id: 'office-b', name: '办公网段 B', cidr: '10.0.2.0/24', gateway: '10.0.2.1', vlan: 20 },
  ],
  addressing: {
    gw: { subnetId: 'core', ip: '10.0.0.1', gateway: '10.0.0.1', vlan: 1 },
    sw1: { subnetId: 'office-a', ip: '10.0.1.1', gateway: '10.0.1.1', vlan: 10 },
    sw2: { subnetId: 'office-b', ip: '10.0.2.1', gateway: '10.0.2.1', vlan: 20 },
    web: { subnetId: 'office-a', ip: '10.0.1.10', gateway: '10.0.1.1', vlan: 10 },
    db: { subnetId: 'office-a', ip: '10.0.1.20', gateway: '10.0.1.1', vlan: 10 },
    user: { subnetId: 'office-b', ip: '10.0.2.22', gateway: '10.0.2.1', vlan: 20 },
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
export const createSeed = () => clone(seed);

// 为设备在指定网段登记地址：取下一个可用 IP，网关与 VLAN 继承网段。
export function autoAddress(data, subnetId, excludeNodeId) {
  const subnet = data.subnets.find((s) => s.id === subnetId);
  if (!subnet) return null;
  const ip = nextFreeIp(data, subnetId, excludeNodeId);
  if (!ip) return null;
  return { subnetId, ip, gateway: subnet.gateway, vlan: Number(subnet.vlan) };
}

export function firstSubnetWithSpace(data, excludeNodeId) {
  return data.subnets.find((s) => nextFreeIp(data, s.id, excludeNodeId)) || null;
}

// 兼容旧版数据（IP 挂在节点上、连线为二元组、无网段台账），迁移为当前结构。
export function normalize(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !raw.nodes.length) return createSeed();
  const legacy =
    !raw.addressing ||
    !Array.isArray(raw.subnets) ||
    raw.nodes.some((n) => Object.prototype.hasOwnProperty.call(n, 'ip')) ||
    (raw.edges || []).some(Array.isArray);
  const subnets = (Array.isArray(raw.subnets) && raw.subnets.length ? raw.subnets : seed.subnets).map((s, i) => ({
    id: s.id || `subnet-${i}`,
    name: s.name || `网段 ${i + 1}`,
    cidr: s.cidr || '',
    gateway: s.gateway || '',
    vlan: Number(s.vlan) || 1,
  }));
  const data = {
    nodes: raw.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, x: n.x, y: n.y })),
    edges: (raw.edges || []).map((e, i) =>
      Array.isArray(e)
        ? { id: `e-${e[0]}-${e[1]}`, a: e[0], b: e[1], route: '' }
        : { id: e.id || `e-${i}`, a: e.a, b: e.b, route: e.route || '' },
    ),
    subnets,
    addressing: {},
  };
  for (const n of raw.nodes) {
    const a = raw.addressing?.[n.id];
    if (a && a.subnetId) {
      data.addressing[n.id] = { subnetId: a.subnetId, ip: a.ip || '', gateway: a.gateway || '', vlan: Number(a.vlan) || 0 };
      continue;
    }
    if (typeof n.ip === 'string' && n.ip) {
      const v = parseIp(n.ip);
      const sub =
        subnets.find((s) => {
          const c = parseCidr(s.cidr);
          return c && v !== null && inSubnet(v, c);
        }) || subnets[0];
      if (sub) data.addressing[n.id] = { subnetId: sub.id, ip: n.ip, gateway: sub.gateway, vlan: Number(sub.vlan) };
    }
  }
  // 为缺失地址资料的设备自动登记
  for (const n of data.nodes) {
    if (data.addressing[n.id]) continue;
    const sub = firstSubnetWithSpace(data);
    if (sub) data.addressing[n.id] = autoAddress(data, sub.id);
  }
  // 旧数据迁移：跨网段连线补标路由，避免迁移后即违反校验规则
  if (legacy) {
    for (const e of data.edges) {
      if (String(e.route || '').trim()) continue;
      const aa = data.addressing[e.a];
      const ab = data.addressing[e.b];
      if (aa && ab && aa.subnetId && ab.subnetId && aa.subnetId !== ab.subnetId) {
        const far = subnets.find((s) => s.id === ab.subnetId);
        e.route = `via ${far?.gateway || '网关'}`;
      }
    }
  }
  return data;
}

const STORAGE_KEY = 'topology';

export function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return createSeed();
  }
}

export function persist(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* 存储不可用时忽略 */
  }
}
