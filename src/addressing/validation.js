// 校验规则：全部为纯函数，输入拓扑与地址资料，返回问题列表，不修改任何数据。
import { parseIp, parseCidr, inSubnet, isUsable, cidrsOverlap } from './ip.js';

// 规则编号 → 中文说明（用于校验结果展示与导出报告）
export const RULE_TEXT = {
  'addressing-missing': '地址资料缺失',
  'subnet-unknown': '网段不存在',
  'ip-format': 'IP 格式不正确',
  'ip-out-of-subnet': '地址越界',
  'ip-duplicate': '同网段重复 IP',
  'gateway-format': '网关格式不正确',
  'gateway-out-of-subnet': '网关不在网段',
  'vlan-invalid': 'VLAN 无效',
  'vlan-mismatch': 'VLAN 与网段不一致',
  'edge-dangling': '连线悬空',
  'cross-subnet-no-route': '跨网段未标明路由',
  'cidr-format': '网段格式不正确',
  'cidr-not-network': '网段地址未对齐',
  'cidr-gateway-format': '网段网关格式不正确',
  'cidr-gateway-out': '网段网关不在网段内',
  'cidr-vlan-invalid': '网段 VLAN 无效',
  'cidr-overlap': '网段地址范围重叠',
  'isolated-node': '孤立节点',
};

export function subnetOf(data, nodeId) {
  const addr = data.addressing?.[nodeId];
  return data.subnets.find((s) => s.id === addr?.subnetId) || null;
}

// 连线两端是否登记在不同网段；任一端未登记时不判定为跨网段。
export function isCrossSubnet(edge, data) {
  const a = data.addressing?.[edge.a];
  const b = data.addressing?.[edge.b];
  if (!a || !b || !a.subnetId || !b.subnetId) return false;
  return a.subnetId !== b.subnetId;
}

// 校验单台设备的地址登记；data 用于重复 IP 等横向检查。
export function validateDeviceAddress(nodeId, addr, data) {
  const node = data.nodes.find((n) => n.id === nodeId);
  const label = node?.name || nodeId;
  if (!addr || !addr.subnetId) {
    return [{ rule: 'addressing-missing', target: nodeId, message: `「${label}」未登记网段与地址资料` }];
  }
  const subnet = data.subnets.find((s) => s.id === addr.subnetId);
  if (!subnet) {
    return [{ rule: 'subnet-unknown', target: nodeId, message: `「${label}」登记的网段不存在` }];
  }
  const issues = [];
  const cidr = parseCidr(subnet.cidr);
  const ip = parseIp(addr.ip);
  if (ip === null) {
    issues.push({ rule: 'ip-format', target: nodeId, message: `「${label}」IP 地址格式不正确：${addr.ip || '(空)'}` });
  } else {
    if (cidr && !isUsable(ip, cidr)) {
      issues.push({ rule: 'ip-out-of-subnet', target: nodeId, message: `「${label}」IP ${addr.ip} 超出网段 ${subnet.cidr} 的可用范围` });
    }
    const dup = data.nodes.find(
      (n) => n.id !== nodeId && data.addressing?.[n.id]?.subnetId === addr.subnetId && data.addressing[n.id].ip === addr.ip,
    );
    if (dup) {
      issues.push({ rule: 'ip-duplicate', target: nodeId, message: `「${label}」与「${dup.name}」在网段「${subnet.name}」内重复使用 ${addr.ip}` });
    }
  }
  const gw = parseIp(addr.gateway);
  if (gw === null) {
    issues.push({ rule: 'gateway-format', target: nodeId, message: `「${label}」网关格式不正确：${addr.gateway || '(空)'}` });
  } else if (cidr && !inSubnet(gw, cidr)) {
    issues.push({ rule: 'gateway-out-of-subnet', target: nodeId, message: `「${label}」网关 ${addr.gateway} 不在网段 ${subnet.cidr} 内` });
  }
  const vlan = Number(addr.vlan);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) {
    issues.push({ rule: 'vlan-invalid', target: nodeId, message: `「${label}」VLAN「${addr.vlan}」无效（应为 1-4094）` });
  } else if (Number(subnet.vlan) !== vlan) {
    issues.push({ rule: 'vlan-mismatch', target: nodeId, message: `「${label}」VLAN ${vlan} 与网段「${subnet.name}」的 VLAN ${subnet.vlan} 不一致` });
  }
  return issues;
}

export function validateEdge(edge, data) {
  const a = data.nodes.find((n) => n.id === edge.a);
  const b = data.nodes.find((n) => n.id === edge.b);
  if (!a || !b) return [{ rule: 'edge-dangling', target: edge.id, message: `连线 ${edge.id} 引用了不存在的设备` }];
  if (isCrossSubnet(edge, data) && !String(edge.route || '').trim()) {
    return [{ rule: 'cross-subnet-no-route', target: edge.id, message: `「${a.name}」与「${b.name}」为跨网段连线，未标明路由` }];
  }
  return [];
}

export function validateSubnets(data) {
  const issues = [];
  const parsed = new Map();
  for (const s of data.subnets) {
    const c = parseCidr(s.cidr);
    if (!c) {
      issues.push({ rule: 'cidr-format', target: s.id, message: `网段「${s.name}」CIDR 格式不正确：${s.cidr || '(空)'}` });
      continue;
    }
    if (parseIp(String(s.cidr).split('/')[0]) !== c.network) {
      issues.push({ rule: 'cidr-not-network', target: s.id, message: `网段「${s.name}」地址未对齐，应为 ${c.cidr}` });
    }
    const gw = parseIp(s.gateway);
    if (gw === null) {
      issues.push({ rule: 'cidr-gateway-format', target: s.id, message: `网段「${s.name}」网关格式不正确：${s.gateway || '(空)'}` });
    } else if (!inSubnet(gw, c)) {
      issues.push({ rule: 'cidr-gateway-out', target: s.id, message: `网段「${s.name}」网关 ${s.gateway} 不在 ${c.cidr} 内` });
    }
    const vlan = Number(s.vlan);
    if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) {
      issues.push({ rule: 'cidr-vlan-invalid', target: s.id, message: `网段「${s.name}」VLAN「${s.vlan}」无效（应为 1-4094）` });
    }
    parsed.set(s.id, c);
  }
  const valid = data.subnets.filter((s) => parsed.has(s.id));
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      if (cidrsOverlap(parsed.get(valid[i].id), parsed.get(valid[j].id))) {
        issues.push({ rule: 'cidr-overlap', message: `网段「${valid[i].name}」与「${valid[j].name}」地址范围重叠` });
      }
    }
  }
  return issues;
}

// 全量校验：网段台账、每台设备的地址登记、每条连线。
export function validateAll(data) {
  const issues = [
    ...validateSubnets(data),
    ...data.nodes.flatMap((n) => validateDeviceAddress(n.id, data.addressing?.[n.id], data)),
    ...data.edges.flatMap((e) => validateEdge(e, data)),
  ];
  const linked = new Set(data.edges.flatMap((e) => [e.a, e.b]));
  for (const n of data.nodes) {
    if (!linked.has(n.id)) issues.push({ rule: 'isolated-node', target: n.id, message: `「${n.name}」没有任何连线（孤立节点）` });
  }
  return issues;
}

// 网段表单校验（新建/编辑网段对话框使用），excludeId 用于编辑时排除自身。
export function validateSubnetForm(form, data, excludeId) {
  const errors = [];
  if (!String(form.name || '').trim()) errors.push('网段名称不能为空');
  const c = parseCidr(form.cidr);
  if (!c) {
    errors.push('CIDR 格式不正确（示例：10.0.1.0/24）');
  } else {
    if (parseIp(String(form.cidr).split('/')[0]) !== c.network) errors.push(`网段地址未对齐，应为 ${c.cidr}`);
    const gw = parseIp(form.gateway);
    if (gw === null) errors.push('网关地址格式不正确');
    else if (!inSubnet(gw, c)) errors.push(`网关 ${form.gateway} 不在网段 ${c.cidr} 内`);
    for (const s of data.subnets) {
      if (s.id === excludeId) continue;
      const other = parseCidr(s.cidr);
      if (other && cidrsOverlap(c, other)) errors.push(`与网段「${s.name}」（${s.cidr}）地址范围重叠`);
    }
  }
  const vlan = Number(form.vlan);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) errors.push('VLAN 需为 1-4094 的整数');
  return errors;
}
