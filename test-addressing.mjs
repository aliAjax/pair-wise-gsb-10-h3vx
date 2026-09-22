// 业务模块冒烟测试：node test-addressing.mjs（测试后可删除）
import { parseIp, parseCidr, isUsable, nextAvailable, formatIp } from './src/addressing/ip.js';
import { createSeed, normalize, autoAddress } from './src/addressing/model.js';
import { computeUsage, nextFreeIp } from './src/addressing/availability.js';
import { validateAll, validateDeviceAddress, isCrossSubnet, validateSubnetForm } from './src/addressing/validation.js';
import { deviceRemovalImpact, subnetChangeImpact, deviceMoveImpact, subnetRemovalImpact } from './src/addressing/impact.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };

// --- ip.js ---
ok(parseIp('10.0.1.10') === 0x0a00010a, 'parseIp');
ok(parseIp('256.1.1.1') === null && parseIp('1.2.3') === null && parseIp('') === null, 'parseIp invalid');
ok(parseCidr('10.0.1.0/24').network === parseIp('10.0.1.0'), 'parseCidr');
ok(parseCidr('10.0.1.7/24').cidr === '10.0.1.0/24', 'parseCidr normalize');
ok(parseCidr('10.0.1.0/33') === null, 'parseCidr bad prefix');
ok(isUsable(parseIp('10.0.1.254'), parseCidr('10.0.1.0/24')), 'usable 254');
ok(!isUsable(parseIp('10.0.1.0'), parseCidr('10.0.1.0/24')), 'network addr not usable');
ok(!isUsable(parseIp('10.0.1.255'), parseCidr('10.0.1.0/24')), 'broadcast not usable');
ok(!isUsable(parseIp('10.0.2.5'), parseCidr('10.0.1.0/24')), 'out of range');
ok(formatIp(nextAvailable(parseCidr('10.0.1.0/24'), new Set([parseIp('10.0.1.1')]))) === '10.0.1.2', 'nextAvailable');

// --- seed 全量校验应为零问题 ---
const seed = createSeed();
const seedIssues = validateAll(seed);
ok(seedIssues.length === 0, 'seed validates clean: ' + JSON.stringify(seedIssues));

// --- 同网段重复 IP ---
let d = structuredClone(seed);
d.addressing.web.ip = '10.0.1.20';
let issues = validateAll(d);
ok(issues.some((i) => i.rule === 'ip-duplicate'), 'duplicate ip detected');
ok(validateDeviceAddress('web', d.addressing.web, d).some((i) => i.rule === 'ip-duplicate'), 'dup on device');

// --- 地址越界 ---
d = structuredClone(seed);
d.addressing.web.ip = '10.0.9.10';
ok(validateDeviceAddress('web', d.addressing.web, d).some((i) => i.rule === 'ip-out-of-subnet'), 'out of subnet');
d.addressing.web.ip = '10.0.1.255';
ok(validateDeviceAddress('web', d.addressing.web, d).some((i) => i.rule === 'ip-out-of-subnet'), 'broadcast rejected');

// --- 网关不在网段 ---
d = structuredClone(seed);
d.addressing.web.gateway = '192.168.1.1';
ok(validateDeviceAddress('web', d.addressing.web, d).some((i) => i.rule === 'gateway-out-of-subnet'), 'gateway out');

// --- VLAN 与网段不一致 ---
d = structuredClone(seed);
d.addressing.web.vlan = 99;
ok(validateDeviceAddress('web', d.addressing.web, d).some((i) => i.rule === 'vlan-mismatch'), 'vlan mismatch');

// --- 跨网段连线未标明路由 ---
d = structuredClone(seed);
d.edges.find((e) => e.id === 'e-gw-sw1').route = '';
ok(validateAll(d).some((i) => i.rule === 'cross-subnet-no-route'), 'cross-subnet no route');
ok(isCrossSubnet(d.edges.find((e) => e.id === 'e-gw-sw1'), seed), 'gw-sw1 is cross');
ok(!isCrossSubnet(d.edges.find((e) => e.id === 'e-sw1-web'), seed), 'sw1-web not cross');

// --- 网段重叠 / 表单 ---
d = structuredClone(seed);
ok(validateSubnetForm({ name: 'X', cidr: '10.0.1.0/25', gateway: '10.0.1.1', vlan: '5' }, d).some((e) => e.includes('重叠')), 'overlap detected');
ok(validateSubnetForm({ name: 'X', cidr: '10.0.5.0/24', gateway: '10.0.6.1', vlan: '5' }, d).some((e) => e.includes('不在网段')), 'form gateway out');
ok(validateSubnetForm({ name: 'X', cidr: '10.0.5.0/24', gateway: '10.0.5.1', vlan: '5' }, d).length === 0, 'form valid');

// --- 可用地址 ---
const usage = computeUsage(seed);
ok(usage['office-a'].total === 254, 'office-a total 254');
ok(usage['office-a'].used === 3, 'office-a used 3 (gateway 与 sw1 同址去重), got ' + usage['office-a'].used);
ok(usage['office-a'].next === '10.0.1.2', 'office-a next 10.0.1.2, got ' + usage['office-a'].next);
ok(nextFreeIp(seed, 'core') === '10.0.0.2', 'core next free');

// --- 自动登记 ---
const addr = autoAddress(seed, 'office-a');
ok(addr.ip === '10.0.1.2' && addr.gateway === '10.0.1.1' && addr.vlan === 10, 'autoAddress inherits gw/vlan');

// --- 影响分析：删除设备 ---
const rem = deviceRemovalImpact('sw1', seed);
ok(rem.devices.length === 4 && rem.links.length === 3, 'removal impact sw1: ' + rem.devices.length + '/' + rem.links.length);

// --- 影响分析：网段变更（VLAN 调整级联 + 网关级联） ---
const ch = subnetChangeImpact('office-a', { name: '办公网段 A', cidr: '10.0.1.0/24', gateway: '10.0.1.254', vlan: 30 }, seed);
ok(ch.devices.length === 3, 'subnet change affects 3 devices');
ok(ch.nextData.addressing.web.vlan === 30, 'vlan cascades');
ok(ch.nextData.addressing.web.gateway === '10.0.1.254', 'gateway cascades');
ok(ch.blockers.length === 0, 'no blockers for valid change: ' + ch.blockers);

// --- 影响分析：网段缩小导致 IP 越界 → 阻断 ---
const shrink = subnetChangeImpact('office-a', { name: '办公网段 A', cidr: '10.0.1.0/28', gateway: '10.0.1.1', vlan: 10 }, seed);
ok(shrink.blockers.length > 0, 'shrink blocks (ip out of range)');

// --- 影响分析：设备跨网段迁移，连线变跨网段需路由 ---
const move = deviceMoveImpact('web', { subnetId: 'office-b', ip: '10.0.2.50', gateway: '10.0.2.1', vlan: 20 }, seed);
ok(move.links.some((l) => l.needsRoute), 'move creates cross-subnet link needing route');

// --- 网段删除：有设备时阻断 ---
const delS = subnetRemovalImpact('office-a', seed);
ok(delS.blockers.length === 1 && delS.devices.length === 3, 'subnet removal blocked with members');

// --- 旧版数据迁移 ---
const legacy = {
  nodes: [
    { id: 'r1', name: 'R1', type: 'router', x: 1, y: 1, ip: '10.0.0.1' },
    { id: 's1', name: 'S1', type: 'switch', x: 2, y: 2, ip: '10.0.1.1' },
  ],
  edges: [['r1', 's1']],
};
const migrated = normalize(legacy);
ok(migrated.subnets.length === 3, 'legacy gets seed subnets');
ok(migrated.addressing.r1.subnetId === 'core' && migrated.addressing.s1.subnetId === 'office-a', 'legacy ip mapped to subnets');
ok(migrated.edges[0].route.length > 0, 'legacy cross-subnet edge auto-routed: ' + migrated.edges[0].route);
ok(validateAll(migrated).length === 0, 'migrated data validates clean: ' + JSON.stringify(validateAll(migrated)));
ok(!('ip' in migrated.nodes[0]), 'legacy node.ip removed');

// --- 当前格式数据 normalize 幂等 ---
const again = normalize(JSON.parse(JSON.stringify(seed)));
ok(validateAll(again).length === 0 && again.edges[0].route === 'via 10.0.0.1', 'normalize idempotent on new format');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
